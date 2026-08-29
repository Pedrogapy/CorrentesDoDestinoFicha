import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const SPEC_PATH = path.join(HERE, 'staff.json');
const MARKER = 'STAFF_V2';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}
function loadProjectEnv() {
  return { ...parseEnvFile(path.resolve(ROOT,'.env')), ...parseEnvFile(path.resolve(ROOT,'.env.local')), ...process.env };
}
function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'');
}
function authEmailFromCharacter(fullName) {
  return `${normalizeName(fullName) || 'personagem'}@example.com`;
}
function authPasswordFromVisiblePassword(password) {
  const raw=String(password||'');
  return raw.length>=6 ? raw : `${raw}::CD`;
}
function fullName(row) { return [row?.first_name,row?.last_name].filter(Boolean).join(' ').trim(); }
function wantedName(spec) { return fullName(spec.character); }

async function askHidden(promptText) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Execute em um terminal interativo.');
  process.stdout.write(promptText);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return await new Promise((resolve,reject)=>{
    let value='';
    const cleanup=()=>{ process.stdin.off('data',onData); process.stdin.setRawMode(false); process.stdin.pause(); };
    const onData=chunk=>{
      for(const ch of chunk){
        if(ch==='\u0003'){ cleanup();process.stdout.write('\n');reject(new Error('Operação cancelada.'));return; }
        if(ch==='\r'||ch==='\n'){ cleanup();process.stdout.write('\n');resolve(value);return; }
        if(ch==='\u007f'||ch==='\b'){ if(value.length){value=value.slice(0,-1);process.stdout.write('\b \b');} continue; }
        value+=ch;process.stdout.write('*');
      }
    };
    process.stdin.on('data',onData);
  });
}

async function authenticateMaster(client) {
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const masterName=(await rl.question('Nome usado para entrar como Mestre: ')).trim();
  rl.close();
  const visiblePassword=await askHidden('Senha visível do Mestre: ');
  const {data,error}=await client.auth.signInWithPassword({
    email:authEmailFromCharacter(masterName),
    password:authPasswordFromVisiblePassword(visiblePassword),
  });
  if(error) throw new Error(`Falha no login do Mestre: ${error.message}`);
  const {data:profile,error:profileError}=await client.from('profiles').select('id,display_name,role').eq('id',data.user.id).single();
  if(profileError) throw new Error(`Não foi possível confirmar o perfil do Mestre: ${profileError.message}`);
  if(profile.role!=='master') throw new Error(`A conta autenticada é '${profile.role}', não master.`);
  console.log(`Mestre autenticado: ${profile.display_name||masterName}`);
}

function derived(c){
  const mod=v=>Math.floor(Number(v||0)/2);
  const a=c.attributes||{},s=c.skills||{},level=Number(c.level)||1;
  const ps=18+2*level+2*Number(a.resistance||0)+2*Number(c.growth_vigor||0)+Number(c.permanent_ps_bonus||0);
  const ea=18+2*level+2*Number(a.cursed_control||0)+2*Number(c.growth_reserve||0)+Number(c.permanent_ea_bonus||0);
  const pa=level>=100?7:level>=75?6:level>=50?5:level>=25?4:3;
  const ca=Math.max(
    10+mod(a.dexterity)+Number(s.reflexes||0),
    10+mod(a.resistance)+Number(s.defend||0),
    10+mod(a.resistance)+Number(s.fortitude||0),
    10+mod(a.cursed_control)+Number(s.reinforcement||0),
  );
  return {ps,ea,pa,ca};
}

function validateSpec(spec){
  const names=new Set();
  for(const npc of spec.npcs||[]){
    const c=npc.character;
    const name=wantedName(npc);
    if(!name) throw new Error('NPC sem nome.');
    const norm=normalizeName(name);
    if(names.has(norm)) throw new Error(`Nome duplicado no pacote: ${name}`);
    names.add(norm);
    if(c.entity_type!=='npc') throw new Error(`${name}: entity_type deve ser npc.`);
    if(c.level<1||c.level>100) throw new Error(`${name}: nível inválido.`);
    const attrBudget=15+c.level, attrCap=Math.min(20,5+Math.floor((c.level-1)/6));
    const skillBudget=9+c.level, skillCap=Math.min(10,3+Math.floor((c.level-1)/12));
    const attrs=Object.values(c.attributes||{}).map(Number), skills=Object.values(c.skills||{}).map(Number);
    if(attrs.reduce((a,b)=>a+b,0)>attrBudget||Math.max(...attrs)>attrCap||Math.min(...attrs)<1) throw new Error(`${name}: atributos não cabem no nível.`);
    if(skills.reduce((a,b)=>a+b,0)>skillBudget||(skills.length&&Math.max(...skills)>skillCap)||skills.some(x=>x<0)) throw new Error(`${name}: perícias não cabem no nível.`);
    if(Number(c.growth_vigor||0)+Number(c.growth_reserve||0)>c.level) throw new Error(`${name}: crescimento excede o nível.`);
  }
}

async function fetchExisting(client){
  const {data,error}=await client.from('characters').select('*').eq('entity_type','npc');
  if(error) throw error;
  return data||[];
}

function matchExisting(rows,name){
  const wanted=normalizeName(name);
  return rows.filter(r=>normalizeName(fullName(r))===wanted);
}

async function backupTargets(client, matches, spec){
  const ids=matches.map(x=>x.id);
  const data={created_at:new Date().toISOString(),package:MARKER,characters:matches,abilities:[],equipment:[],secrets:[]};
  if(ids.length){
    const [ab,eq,se]=await Promise.all([
      client.from('abilities').select('*').in('character_id',ids),
      client.from('equipment').select('*').in('character_id',ids),
      client.from('character_master_secrets').select('*').in('character_id',ids),
    ]);
    if(ab.error) throw ab.error;if(eq.error) throw eq.error;if(se.error) throw se.error;
    data.abilities=ab.data||[];data.equipment=eq.data||[];data.secrets=se.data||[];
  }
  const dir=path.resolve(ROOT,'staff-backups');
  fs.mkdirSync(dir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const file=path.join(dir,`staff-v2-before-${stamp}.json`);
  fs.writeFileSync(file,JSON.stringify(data,null,2),'utf8');
  return file;
}

async function upsertCharacter(client,npc,existing){
  const c=npc.character;
  const patch={
    entity_type:'npc',
    first_name:c.first_name,last_name:c.last_name||'',nickname:c.nickname||'',
    grade:c.grade,level:c.level,
    biography:c.biography||'',personality:c.personality||'',goals:c.goals||'',
    appearance:c.appearance||'',notes:c.notes||'',
    technique_name:c.technique_name||'',technique_description:c.technique_description||'',
    attributes:c.attributes||{},skills:c.skills||{},
    growth_vigor:Number(c.growth_vigor||0),growth_reserve:Number(c.growth_reserve||0),
    permanent_ps_bonus:Number(c.permanent_ps_bonus||0),permanent_ea_bonus:Number(c.permanent_ea_bonus||0),
    updated_at:new Date().toISOString(),
  };
  if(existing){
    const {data,error}=await client.from('characters').update(patch).eq('id',existing.id).select('*').single();
    if(error) throw error;
    return data;
  }
  const {data,error}=await client.from('characters').insert({...patch,owner_id:null,xp:0}).select('*').single();
  if(error) throw error;
  return data;
}

async function syncAbilities(client,characterId,abilities){
  const names=(abilities||[]).map(x=>x.name);
  const {data:old,error:readError}=await client.from('abilities').select('id,name,master_response').eq('character_id',characterId);
  if(readError) throw readError;
  const ids=(old||[]).filter(x=>x.master_response===MARKER||names.includes(x.name)).map(x=>x.id);
  if(ids.length){
    const {error}=await client.from('abilities').delete().in('id',ids);
    if(error) throw error;
  }
  if(!abilities?.length) return [];
  const payload=abilities.map(a=>({
    character_id:characterId,category:a.category,name:a.name,description:a.description||'',
    mechanics:a.mechanics||'',config:a.config||{},vp_estimated:Number(a.vp_estimated||1),
    vp_approved:Number(a.vp_approved||a.vp_estimated||1),limit_override:true,status:'approved',
    master_response:MARKER,
  }));
  const {data,error}=await client.from('abilities').insert(payload).select('*');
  if(error) throw error;
  return data||[];
}

async function syncEquipment(client,characterId,equipment){
  const names=(equipment||[]).map(x=>x.name);
  if(names.length){
    const {error}=await client.from('equipment').delete().eq('character_id',characterId).in('name',names);
    if(error) throw error;
  }
  if(!equipment?.length) return [];
  const payload=equipment.map(item=>({
    character_id:characterId,
    name:item.name,
    equipment_type:item.equipment_type||'Outro',
    grade:item.grade||'Sem Grau',
    description:item.description||'',
    mechanics:item.mechanics||'',
    image_url:item.image_url||'',
    charges_current:item.charges_current??null,
    charges_max:item.charges_max??null,
    active:item.active!==false,
  }));
  const {data,error}=await client.from('equipment').insert(payload).select('*');
  if(error) throw error;
  return data||[];
}

async function syncSecret(client,characterId,secretText){
  const {error}=await client.from('character_master_secrets').upsert({
    character_id:characterId,secret_text:secretText||'',updated_at:new Date().toISOString()
  },{onConflict:'character_id'});
  if(error) throw error;
}

async function main(){
  if(!fs.existsSync(path.resolve(ROOT,'package.json'))||!fs.existsSync(path.resolve(ROOT,'src'))){
    throw new Error('Execute a partir da raiz do projeto CorrentesDoDestinoFicha.');
  }
  if(!fs.existsSync(SPEC_PATH)) throw new Error(`Arquivo ausente: ${SPEC_PATH}`);
  const spec=JSON.parse(fs.readFileSync(SPEC_PATH,'utf8'));
  validateSpec(spec);

  const env=loadProjectEnv();
  const url=env.VITE_SUPABASE_URL;
  const key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key) throw new Error('VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY não encontrados em .env/.env.local.');

  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  console.log('=== CORRENTES DO DESTINO — STAFF V2 ===');
  console.log('Pacote V2: Sakura Gojo, Sayuri Aozora, Akiya e Daiki Arashiro — mecânicas avançadas.');
  console.log('Não usa service_role. As alterações são feitas autenticando sua conta normal de Mestre.\n');
  await authenticateMaster(client);

  const current=await fetchExisting(client);
  const matched=[];
  console.log('\n=== PRÉVIA ===');
  for(const npc of spec.npcs){
    const name=wantedName(npc);
    const found=matchExisting(current,name);
    if(found.length>1) throw new Error(`Há mais de um NPC chamado ${name}; não vou adivinhar qual atualizar.`);
    const existing=found[0]||null;
    if(existing) matched.push(existing);
    console.log(`${existing?'ATUALIZAR':'CRIAR   '} ${name} ${existing?`(Nv ${existing.level} ${existing.grade} -> Nv ${npc.character.level} ${npc.character.grade})`:`(Nv ${npc.character.level} ${npc.character.grade})`}`);
  }

  const backupFile=await backupTargets(client,matched,spec);
  console.log(`\nBackup remoto dos NPCs já existentes salvo em:\n${backupFile}`);

  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const confirm=(await rl.question('\nDigite APLICAR para gravar este lote no Supabase: ')).trim().toUpperCase();
  rl.close();
  if(confirm!=='APLICAR'){ console.log('Cancelado. Nenhum NPC foi alterado.'); await client.auth.signOut(); return; }

  const refreshed=await fetchExisting(client);
  console.log('\n=== APLICANDO ===');
  for(const npc of spec.npcs){
    const name=wantedName(npc);
    const found=matchExisting(refreshed,name);
    if(found.length>1) throw new Error(`Há mais de um NPC chamado ${name}.`);
    const character=await upsertCharacter(client,npc,found[0]||null);
    const abilities=await syncAbilities(client,character.id,npc.abilities||[]);
    const equipment=await syncEquipment(client,character.id,npc.equipment||[]);
    await syncSecret(client,character.id,npc.secret_text||'');
    const d=derived(character);
    console.log(`OK ${name}: Nv ${character.level} • ${character.grade} • PS ${d.ps} • EA ${d.ea} • PA ${d.pa} • CA ${d.ca} • ${abilities.length} habilidades • ${equipment.length} itens`);
  }

  console.log('\nConcluído. Atualize o Painel do Mestre no site.');
  console.log('Este pacote alterou apenas dados no Supabase; não exige db push nem git push.');
  await client.auth.signOut().catch(()=>{});
}

main().catch(async error=>{
  console.error('\nERRO:',error?.message||error);
  if(error?.details) console.error('Detalhes:',error.details);
  if(error?.hint) console.error('Dica:',error.hint);
  process.exitCode=1;
});
