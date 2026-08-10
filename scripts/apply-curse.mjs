import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

/**
 * Correntes do Destino - importador de Maldições.
 *
 * Uso:
 *   node .\scripts\apply-curse.mjs .\data\curses\maldicao-rua-sem-nome.json
 *   node .\scripts\apply-curse.mjs .\data\curses\maldicao-rua-sem-nome.json --remove
 *
 * Autentica com a conta normal do Mestre e respeita RLS/triggers do projeto.
 */
function parseEnvFile(filePath){
  if(!fs.existsSync(filePath)) return {};
  const out={};
  for(const raw of fs.readFileSync(filePath,'utf8').split(/\r?\n/)){
    const line=raw.trim(); if(!line||line.startsWith('#')) continue;
    const idx=line.indexOf('='); if(idx<1) continue;
    const key=line.slice(0,idx).trim(); let value=line.slice(idx+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    out[key]=value;
  }
  return out;
}
function env(){return {...parseEnvFile(path.resolve('.env')),...parseEnvFile(path.resolve('.env.local')),...process.env};}
function slug(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'');}
function authEmail(name){return `${slug(name)||'personagem'}@example.com`;}
function authPassword(raw){const s=String(raw||''); return s.length>=6?s:`${s}::CD`;}
function fullName(c){return [c.first_name,c.last_name].filter(Boolean).join(' ').trim();}
function attrMod(v){return Math.floor((Number(v)||0)/2);}
function derived(c){
  const a=c.attributes||{}, s=c.skills||{}, lvl=Number(c.level)||1;
  const ps=18+2*lvl+2*Number(a.resistance||0)+2*Number(c.growth_vigor||0)+Number(c.permanent_ps_bonus||0);
  const ea=18+2*lvl+2*Number(a.cursed_control||0)+2*Number(c.growth_reserve||0)+Number(c.permanent_ea_bonus||0);
  const pa=lvl>=100?7:lvl>=75?6:lvl>=50?5:lvl>=25?4:3;
  const ca=Math.max(
    10+attrMod(a.dexterity)+Number(s.reflexes||0),
    10+attrMod(a.resistance)+Number(s.defend||0),
    10+attrMod(a.resistance)+Number(s.fortitude||0),
    10+attrMod(a.cursed_control)+Number(s.reinforcement||0)
  );
  return {ps,ea,pa,ca};
}
async function hidden(text){
  process.stdout.write(text); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return await new Promise((resolve,reject)=>{
    let value='';
    const done=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();};
    const onData=(chunk)=>{for(const ch of chunk){
      if(ch==='\u0003'){done();process.stdout.write('\n');reject(new Error('Cancelado.'));return;}
      if(ch==='\r'||ch==='\n'){done();process.stdout.write('\n');resolve(value);return;}
      if(ch==='\u007f'||ch==='\b'){if(value.length){value=value.slice(0,-1);process.stdout.write('\b \b');}continue;}
      value+=ch;process.stdout.write('*');
    }};
    process.stdin.on('data',onData);
  });
}
async function authenticateMaster(db){
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const name=(await rl.question('Nome usado para entrar como Mestre: ')).trim(); rl.close();
  const visible=await hidden('Senha visível do Mestre: ');
  const {data,error}=await db.auth.signInWithPassword({email:authEmail(name),password:authPassword(visible)});
  if(error) throw new Error(`Falha no login do Mestre: ${error.message}`);
  const {data:profile,error:pe}=await db.from('profiles').select('id,display_name,role').eq('id',data.user.id).single();
  if(pe) throw pe; if(profile.role!=='master') throw new Error('A conta informada não é Mestre.');
  console.log(`Autenticado como Mestre: ${profile.display_name||name}`);
}
async function findExisting(db,spec){
  const c=spec.character;
  const {data,error}=await db.from('characters').select('*').eq('entity_type','curse').eq('first_name',c.first_name).eq('last_name',c.last_name||'').limit(2);
  if(error) throw error; if((data||[]).length>1) throw new Error('Existem múltiplas maldições com esse nome.');
  return data?.[0]||null;
}
async function syncCharacter(db,spec){
  const existing=await findExisting(db,spec);
  const payload={...spec.character,entity_type:'curse',owner_id:null,updated_at:new Date().toISOString()};
  if(existing){const {data,error}=await db.from('characters').update(payload).eq('id',existing.id).select('*').single();if(error)throw error;return data;}
  const {data,error}=await db.from('characters').insert(payload).select('*').single();if(error)throw error;return data;
}
async function replaceAbilities(db,id,rows=[]){
  const names=rows.map(x=>x.name); if(!names.length)return [];
  const {error:de}=await db.from('abilities').delete().eq('character_id',id).in('name',names);if(de)throw de;
  const payload=rows.map(r=>({character_id:id,...r,status:'approved',master_response:r.master_response||'Aplicado diretamente pelo importador do Mestre.'}));
  const {data,error}=await db.from('abilities').insert(payload).select('*');if(error)throw error;return data||[];
}
async function syncEquipment(db,id,rows=[]){
  const names=rows.map(x=>x.name); if(!names.length)return [];
  const {error:de}=await db.from('equipment').delete().eq('character_id',id).in('name',names);if(de)throw de;
  const out=[];
  for(const source of rows){
    const desired=source.equip_slot||null; const item={...source,character_id:id,equipped:false}; delete item.equip_slot;
    const {data,error}=await db.from('equipment').insert(item).select('*').single();if(error)throw error;
    let final=data;
    if(desired){const {data:eq,error:ee}=await db.rpc('equip_equipment',{p_item_id:data.id,p_slot:desired});if(ee)throw ee;final=eq;}
    out.push(final);
  }
  return out;
}
async function main(){
  const args=process.argv.slice(2), remove=args.includes('--remove'), file=args.find(a=>!a.startsWith('--'));
  if(!file) throw new Error('Uso: node .\\scripts\\apply-curse.mjs .\\data\\curses\\arquivo.json [--remove]');
  const spec=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
  if(!spec?.character?.first_name) throw new Error('JSON inválido.');
  const d=derived(spec.character);
  console.log('\n=== PRÉVIA DA MALDIÇÃO ===');
  console.log(`${fullName(spec.character)} • ${spec.character.grade} • Nv ${spec.character.level}`);
  console.log(`PS ${d.ps} • EA ${d.ea} • PA ${d.pa} • CA ${d.ca}`);
  console.log(`Habilidades: ${(spec.abilities||[]).map(a=>a.name).join(', ')||'—'}`);
  console.log(`Equipamentos: ${(spec.equipment||[]).map(a=>a.name).join(', ')||'—'}\n`);
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const answer=(await rl.question(remove?`REMOVER ${fullName(spec.character)}? Digite REMOVER: `:`Aplicar/sincronizar ${fullName(spec.character)}? Digite SIM: `)).trim().toUpperCase();rl.close();
  if((remove&&answer!=='REMOVER')||(!remove&&answer!=='SIM')){console.log('Cancelado.');return;}
  const e=env(), url=e.VITE_SUPABASE_URL,key=e.VITE_SUPABASE_PUBLISHABLE_KEY;if(!url||!key)throw new Error('Variáveis Supabase não encontradas.');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  try{
    await authenticateMaster(db);
    const existing=await findExisting(db,spec);
    if(remove){if(!existing){console.log('A maldição não existe.');return;}const {error}=await db.from('characters').delete().eq('id',existing.id);if(error)throw error;console.log('Maldição removida.');return;}
    const c=await syncCharacter(db,spec);
    const abilities=await replaceAbilities(db,c.id,spec.abilities||[]);
    const equipment=await syncEquipment(db,c.id,spec.equipment||[]);
    const fin=derived(c);
    console.log('\n=== CONCLUÍDO ===');
    console.log(`${fullName(c)} • ${c.grade} • Nv ${c.level}`);
    console.log(`PS ${fin.ps} • EA ${fin.ea} • PA ${fin.pa} • CA ${fin.ca}`);
    console.log(`Habilidades sincronizadas: ${abilities.length}`);
    console.log(`Equipamentos sincronizados: ${equipment.length}`);
    console.log('Ela já pode ser adicionada pelo Mestre em Combate.');
  }finally{await db.auth.signOut().catch(()=>{});}
}
main().catch(err=>{console.error('\nERRO:',err?.message||err);if(err?.details)console.error('Detalhes:',err.details);if(err?.hint)console.error('Dica:',err.hint);process.exitCode=1;});
