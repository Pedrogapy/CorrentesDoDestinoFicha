import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

/**
 * Correntes do Destino - sincronizador de fichas de PLAYER já existentes.
 *
 * OBJETIVO:
 * - preencher ficha mecânica sem criar/trocar conta;
 * - preservar owner_id, XP, autenticação e identidade não declarada no JSON;
 * - autenticar como Mestre normal e continuar respeitando RLS/triggers;
 * - sincronizar atributos, perícias, Crescimento, Técnica, habilidades e equipamentos.
 *
 * IMPORTANTE:
 * - este script NUNCA cria player nem mexe em profiles/auth.users;
 * - se o player não existir, ele aborta;
 * - execute fora de um combate ativo para não substituir IDs de habilidades em uso.
 *
 * Uso:
 *   node .\\scripts\\apply-players.mjs .\\data\\players
 *   node .\\scripts\\apply-players.mjs .\\data\\players\\kotone.json
 *   node .\\scripts\\apply-players.mjs .\\data\\players --dry-run
 */

const ALL_SKILLS = [
  'athletics','fight','grapple','impact',
  'acrobatics','reflexes','stealth','aim',
  'defend','fortitude','steadiness','survival',
  'investigation','occultism','technical_sorcery','medicine','technology',
  'attention','intuition','tracking','combat_reading',
  'concentration','self_control','mental_resistance','spiritual_resistance',
  'persuasion','deception','intimidation','leadership','performance',
  'channeling','reinforcement','technique_control','cursed_suppression',
];
const ALL_ATTRIBUTES = ['strength','dexterity','resistance','intelligence','perception','will','presence','cursed_control'];

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
  return { ...parseEnvFile(path.resolve('.env')), ...parseEnvFile(path.resolve('.env.local')), ...process.env };
}

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}
function authEmailFromCharacter(fullName) { return `${normalizeName(fullName) || 'personagem'}@example.com`; }
function authPasswordFromVisiblePassword(password) {
  const raw = String(password || '');
  return raw.length >= 6 ? raw : `${raw}::CD`;
}

async function askHidden(promptText) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Execute em terminal interativo para informar a senha do Mestre.');
  process.stdout.write(promptText);
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return await new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') { cleanup(); process.stdout.write('\n'); reject(new Error('Operação cancelada.')); return; }
        if (ch === '\r' || ch === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) { value = value.slice(0,-1); process.stdout.write('\b \b'); }
          continue;
        }
        value += ch; process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

function fullName(c) { return [c.first_name, c.last_name].filter(Boolean).join(' ').trim(); }
function attrMod(v) { return Math.floor((Number(v)||0)/2); }
function levelBudgets(level) {
  const lv = Number(level)||1;
  return {
    attrTotal: 15+lv,
    attrCap: Math.min(20, 5+Math.floor((lv-1)/6)),
    skillTotal: 9+lv,
    skillCap: Math.min(10, 3+Math.floor((lv-1)/12)),
    growthTotal: lv,
    abilities: {
      technique: { slots: 3+Math.floor((lv-1)/10), vp: 7+Math.ceil(lv/5), maxSingle: Math.min(10,4+Math.floor((lv-1)/15)) },
      general: { slots: 3+Math.floor((lv-1)/15), vp: 5+Math.ceil(lv/5), maxSingle: Math.min(8,3+Math.floor((lv-1)/18)) },
      manifestation: { slots: 1+Math.floor((lv-1)/25), vp: 7+Math.ceil(lv/5), maxSingle: Math.min(12,5+Math.floor((lv-1)/12)) },
      transformation: { slots: 1+Math.floor((lv-1)/25), vp: 4+Math.ceil(lv/5), maxSingle: Math.min(12,5+Math.floor((lv-1)/12)) },
    },
  };
}
function derived(c) {
  const a = c.attributes || {}, s = c.skills || {}, level = Number(c.level)||1;
  const pa = level>=100?7:level>=75?6:level>=50?5:level>=25?4:3;
  const ps = 18+2*level+2*Number(a.resistance||0)+2*Number(c.growth_vigor||0)+Number(c.permanent_ps_bonus||0);
  const ea = 18+2*level+2*Number(a.cursed_control||0)+2*Number(c.growth_reserve||0)+Number(c.permanent_ea_bonus||0);
  const routes = {
    Reflexos: 10+attrMod(a.dexterity)+Number(s.reflexes||0),
    Defender: 10+attrMod(a.resistance)+Number(s.defend||0),
    Fortitude: 10+attrMod(a.resistance)+Number(s.fortitude||0),
    Reforco: 10+attrMod(a.cursed_control)+Number(s.reinforcement||0),
  };
  return {ps,ea,pa,ca:Math.max(...Object.values(routes)),routes};
}

function validateSpec(spec) {
  const errors = [];
  const c = spec.character || {};
  if (!c.first_name) errors.push('character.first_name obrigatório');
  if (!c.last_name) errors.push('character.last_name obrigatório');
  if ((c.entity_type||'player') !== 'player') errors.push('este importador aceita apenas entity_type=player');
  const b = levelBudgets(c.level||5);
  const attrs = c.attributes || {};
  for (const k of ALL_ATTRIBUTES) if (!Number.isFinite(Number(attrs[k]))) errors.push(`atributo ausente/inválido: ${k}`);
  const attrTotal = ALL_ATTRIBUTES.reduce((sum,k)=>sum+Number(attrs[k]||0),0);
  if (attrTotal !== b.attrTotal) errors.push(`atributos somam ${attrTotal}; esperado ${b.attrTotal}`);
  for (const k of ALL_ATTRIBUTES) if (Number(attrs[k])<1 || Number(attrs[k])>b.attrCap) errors.push(`${k}=${attrs[k]} fora do intervalo 1..${b.attrCap}`);

  const skills = c.skills || {};
  const unknownSkills = Object.keys(skills).filter(k=>!ALL_SKILLS.includes(k));
  if (unknownSkills.length) errors.push(`perícias desconhecidas: ${unknownSkills.join(', ')}`);
  const skillTotal = ALL_SKILLS.reduce((sum,k)=>sum+Number(skills[k]||0),0);
  if (skillTotal !== b.skillTotal) errors.push(`perícias somam ${skillTotal}; esperado ${b.skillTotal}`);
  for (const k of ALL_SKILLS) if (Number(skills[k]||0)<0 || Number(skills[k]||0)>b.skillCap) errors.push(`${k}=${skills[k]} fora do intervalo 0..${b.skillCap}`);
  if (Number(c.growth_vigor||0)+Number(c.growth_reserve||0)!==b.growthTotal) errors.push(`Crescimento não soma ${b.growthTotal}`);

  const grouped = {};
  for (const a of spec.abilities||[]) {
    grouped[a.category] ||= [];
    grouped[a.category].push(a);
  }
  for (const category of ['technique','general','manifestation','transformation']) {
    const rows = grouped[category]||[];
    const lim = b.abilities[category];
    const normalRows = rows.filter(a=>!a.limit_override);
    if (normalRows.length>lim.slots) errors.push(`${category}: ${normalRows.length} slots > ${lim.slots}`);
    const totalVp = normalRows.reduce((sum,a)=>sum+Number(a.vp_approved??a.vp_estimated??0),0);
    if (totalVp>lim.vp) errors.push(`${category}: ${totalVp} VP > ${lim.vp}`);
    for (const a of normalRows) if (Number(a.vp_approved??a.vp_estimated??0)>lim.maxSingle) errors.push(`${a.name}: VP acima do máximo ${lim.maxSingle}`);
  }
  return errors;
}

function printPreview(spec) {
  const c=spec.character; const d=derived(c); const b=levelBudgets(c.level);
  const attrTotal=ALL_ATTRIBUTES.reduce((s,k)=>s+Number(c.attributes?.[k]||0),0);
  const skillTotal=ALL_SKILLS.reduce((s,k)=>s+Number(c.skills?.[k]||0),0);
  console.log(`\n=== ${fullName(c).toUpperCase()} ===`);
  console.log(`${c.grade} • Nível ${c.level} • conta existente será preservada`);
  console.log(`Atributos ${attrTotal}/${b.attrTotal} • Perícias ${skillTotal}/${b.skillTotal} • Crescimento ${Number(c.growth_vigor||0)+Number(c.growth_reserve||0)}/${b.growthTotal}`);
  console.log(`PS ${d.ps} • EA ${d.ea} • PA ${d.pa} • CA ${d.ca}`);
  console.log('Rotas:', d.routes);
  console.log(`Técnica: ${c.technique_name||'—'}`);
  const groups=['technique','general','manifestation','transformation'];
  for (const g of groups) {
    const arr=(spec.abilities||[]).filter(a=>a.category===g);
    if (arr.length) console.log(`${g}: ${arr.map(a=>`${a.name} [${a.vp_approved??a.vp_estimated} VP]`).join(' | ')}`);
  }
  console.log(`Equipamentos: ${(spec.equipment||[]).map(x=>`${x.name}${x.equip_slot?` [${x.equip_slot}]`:''}`).join(' | ')||'—'}`);
}

function loadSpecs(target) {
  const resolved=path.resolve(target);
  if (!fs.existsSync(resolved)) throw new Error(`Caminho não encontrado: ${resolved}`);
  const files=fs.statSync(resolved).isDirectory()
    ? fs.readdirSync(resolved).filter(n=>n.toLowerCase().endsWith('.json')).sort().map(n=>path.join(resolved,n))
    : [resolved];
  if (!files.length) throw new Error('Nenhum JSON encontrado.');
  return files.map(file=>({ file, spec:JSON.parse(fs.readFileSync(file,'utf8')) }));
}

async function authenticateMaster(supabase) {
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const masterName=(await rl.question('Nome usado para entrar como Mestre: ')).trim(); rl.close();
  const visiblePassword=await askHidden('Senha visível do Mestre: ');
  const {data:authData,error:authError}=await supabase.auth.signInWithPassword({email:authEmailFromCharacter(masterName),password:authPasswordFromVisiblePassword(visiblePassword)});
  if (authError) throw new Error(`Falha no login do Mestre: ${authError.message}`);
  const user=authData?.user; if(!user) throw new Error('Supabase não retornou usuário autenticado.');
  const {data:profile,error}=await supabase.from('profiles').select('id,display_name,role').eq('id',user.id).single();
  if(error) throw new Error(`Não foi possível confirmar perfil: ${error.message}`);
  if(profile.role!=='master') throw new Error(`Conta autenticada é '${profile.role}', não master.`);
  console.log(`Autenticado como Mestre: ${profile.display_name||masterName}`);
  return profile;
}

async function findExistingPlayer(supabase, c) {
  const {data,error}=await supabase.from('characters').select('*').eq('entity_type','player').eq('first_name',c.first_name).eq('last_name',c.last_name||'').limit(2);
  if(error) throw error;
  if((data||[]).length!==1) {
    if(!(data||[]).length) throw new Error(`Player ${fullName(c)} não existe. Este script não cria conta/personagem.`);
    throw new Error(`Há múltiplos players chamados ${fullName(c)}.`);
  }
  if(!data[0].owner_id) throw new Error(`${fullName(c)} existe sem owner_id. Para segurança, a sincronização foi interrompida.`);
  return data[0];
}

const CHARACTER_PATCH_KEYS=[
  'grade','level','biography','personality','goals','appearance','notes','image_url','image_path',
  'technique_name','technique_description','attributes','skills','growth_vigor','growth_reserve',
  'permanent_ps_bonus','permanent_ea_bonus'
];

async function updateExistingPlayer(supabase, spec) {
  const existing=await findExistingPlayer(supabase,spec.character);
  const payload={updated_at:new Date().toISOString()};
  for(const k of CHARACTER_PATCH_KEYS) if(Object.hasOwn(spec.character,k)) payload[k]=spec.character[k];
  // Segurança: nunca envia owner_id, profile, senha, nickname ou xp se não solicitado por ferramenta específica.
  const {data,error}=await supabase.from('characters').update(payload).eq('id',existing.id).select('*').single();
  if(error) throw error;
  if(data.owner_id!==existing.owner_id) throw new Error(`Falha de segurança: owner_id de ${fullName(data)} mudou inesperadamente.`);
  console.log(`Player atualizado: ${fullName(data)} • owner_id preservado`);
  return data;
}

async function syncAbilities(supabase, characterId, spec) {
  const rows=spec.abilities||[];
  if(spec.replace_abilities) {
    const {error}=await supabase.from('abilities').delete().eq('character_id',characterId);
    if(error) throw error;
  } else if(rows.length) {
    const names=rows.map(x=>x.name);
    const {error}=await supabase.from('abilities').delete().eq('character_id',characterId).in('name',names);
    if(error) throw error;
  }
  if(!rows.length) return [];
  const payload=rows.map(row=>({character_id:characterId,...row,status:'approved',master_response:row.master_response||'Convertido e aprovado pelo Mestre para o sistema atual.'}));
  const {data,error}=await supabase.from('abilities').insert(payload).select('*');
  if(error) throw error;
  return data||[];
}

async function syncEquipment(supabase, characterId, items) {
  if(!items?.length) return [];
  const names=items.map(x=>x.name);
  const {error:delErr}=await supabase.from('equipment').delete().eq('character_id',characterId).in('name',names);
  if(delErr) throw delErr;
  const created=[];
  for(const source of items) {
    const desiredSlot=source.equip_slot||null;
    const item={...source}; delete item.equip_slot;
    item.character_id=characterId; item.equipped=false; item.status='approved';
    const {data,error}=await supabase.from('equipment').insert(item).select('*').single();
    if(error) throw error;
    let final=data;
    if(desiredSlot) {
      const {data:equipped,error:equipError}=await supabase.rpc('equip_equipment',{p_item_id:data.id,p_slot:desiredSlot});
      if(equipError) throw equipError;
      final=equipped;
    }
    created.push(final);
  }
  return created;
}

async function applyOne(supabase, spec) {
  const character=await updateExistingPlayer(supabase,spec);
  const abilities=await syncAbilities(supabase,character.id,spec);
  const equipment=await syncEquipment(supabase,character.id,spec.equipment||[]);
  const d=derived(character);
  console.log(`  Habilidades: ${abilities.length} • Equipamentos sincronizados: ${equipment.length}`);
  console.log(`  Resultado: PS ${d.ps} • EA ${d.ea} • PA ${d.pa} • CA ${d.ca}`);
  return {character,abilities,equipment};
}

async function main() {
  const args=process.argv.slice(2);
  const dryRun=args.includes('--dry-run');
  const target=args.find(a=>!a.startsWith('--'));
  if(!target) {
    console.error('Uso: node .\\scripts\\apply-players.mjs .\\data\\players [--dry-run]');
    process.exitCode=2; return;
  }
  const loaded=loadSpecs(target);
  let invalid=false;
  for(const {file,spec} of loaded) {
    const errors=validateSpec(spec);
    printPreview(spec);
    if(errors.length) { invalid=true; console.error(`ERROS em ${path.basename(file)}:`); for(const e of errors) console.error(` - ${e}`); }
  }
  if(invalid) throw new Error('Pré-validação falhou. Nada foi enviado ao banco.');
  if(dryRun) { console.log('\nDRY-RUN concluído. Nenhum dado foi alterado.'); return; }

  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const confirmation=(await rl.question(`\nSincronizar ${loaded.length} ficha(s) de player existente(s)? Digite SIM: `)).trim().toUpperCase(); rl.close();
  if(confirmation!=='SIM') { console.log('Cancelado. Nada foi alterado.'); return; }

  const env=loadProjectEnv(); const url=env.VITE_SUPABASE_URL; const key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key) throw new Error('VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY não encontrados.');
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  try {
    await authenticateMaster(supabase);
    console.log('\n=== APLICANDO ===');
    for(const {spec} of loaded) {
      console.log(`\n${fullName(spec.character)}:`);
      await applyOne(supabase,spec);
    }
    console.log('\n=== CONCLUÍDO ===');
    console.log('Contas, senhas, profiles e owner_id foram preservados.');
    console.log('Abra o site e confira Atributos, Perícias, Habilidades e Inventário de cada player.');
  } finally {
    await supabase.auth.signOut().catch(()=>{});
  }
}

main().catch(error=>{
  console.error('\nERRO:',error?.message||error);
  if(error?.details) console.error('Detalhes:',error.details);
  if(error?.hint) console.error('Dica:',error.hint);
  process.exitCode=1;
});
