import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const SPEC_PATH = path.join(HERE, 'staff.json');
const MARKER = 'STAFF_V3';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(fs.readFileSync(filePath, 'utf8').split(/\r?\n/).flatMap((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) return [];
    const index = line.indexOf('=');
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[line.slice(0, index).trim(), value]];
  }));
}

function loadProjectEnv() {
  return { ...parseEnvFile(path.resolve(ROOT, '.env')), ...parseEnvFile(path.resolve(ROOT, '.env.local')), ...process.env };
}

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}

function fullName(row) { return [row?.first_name, row?.last_name].filter(Boolean).join(' ').trim(); }
function wantedName(spec) { return fullName(spec.character); }
function authEmailFromCharacter(name) { return `${normalizeName(name) || 'personagem'}@example.com`; }
function authPasswordFromVisiblePassword(password) { return String(password || '').length >= 6 ? String(password) : `${password}::CD`; }

async function askHidden(promptText) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Execute o importador em um terminal interativo.');
  process.stdout.write(promptText);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') { cleanup(); process.stdout.write('\n'); reject(new Error('Operação cancelada.')); return; }
        if (ch === '\r' || ch === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
        if (ch === '\u007f' || ch === '\b') { if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        value += ch;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

async function authenticateMaster(client) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const masterName = (await rl.question('Nome usado para entrar como Mestre: ')).trim();
  rl.close();
  const visiblePassword = await askHidden('Senha visível do Mestre: ');
  const { data, error } = await client.auth.signInWithPassword({
    email: authEmailFromCharacter(masterName),
    password: authPasswordFromVisiblePassword(visiblePassword),
  });
  if (error) throw new Error(`Falha no login do Mestre: ${error.message}`);
  const { data: profile, error: profileError } = await client.from('profiles').select('id,display_name,role').eq('id', data.user.id).single();
  if (profileError) throw new Error(`Não foi possível confirmar o perfil do Mestre: ${profileError.message}`);
  if (profile.role !== 'master') throw new Error(`A conta autenticada é '${profile.role}', não master.`);
  console.log(`Mestre autenticado: ${profile.display_name || masterName}`);
}

function derived(c) {
  const mod = (value) => Math.floor(Number(value || 0) / 2);
  const a = c.attributes || {};
  const s = c.skills || {};
  const level = Number(c.level) || 1;
  return {
    ps: 18 + 2 * level + 2 * Number(a.resistance || 0) + 2 * Number(c.growth_vigor || 0) + Number(c.permanent_ps_bonus || 0),
    ea: 18 + 2 * level + 2 * Number(a.cursed_control || 0) + 2 * Number(c.growth_reserve || 0) + Number(c.permanent_ea_bonus || 0),
    pa: level >= 100 ? 7 : level >= 75 ? 6 : level >= 50 ? 5 : level >= 25 ? 4 : 3,
    ca: Math.max(10 + mod(a.dexterity) + Number(s.reflexes || 0), 10 + mod(a.resistance) + Number(s.defend || 0), 10 + mod(a.resistance) + Number(s.fortitude || 0), 10 + mod(a.cursed_control) + Number(s.reinforcement || 0)),
  };
}

function validateSpec(spec) {
  if (spec?.package !== MARKER || !Array.isArray(spec.npcs) || spec.npcs.length !== 6) throw new Error('staff.json não é um pacote STAFF_V3 completo.');
  const names = new Set();
  for (const npc of spec.npcs) {
    const c = npc.character || {};
    const name = wantedName(npc);
    const normalized = normalizeName(name);
    if (!name || names.has(normalized)) throw new Error(`Nome ausente ou duplicado: ${name || '(vazio)'}.`);
    names.add(normalized);
    if (c.entity_type !== 'npc' || c.level < 1 || c.level > 100) throw new Error(`${name}: tipo ou nível inválido.`);
    const attrBudget = 15 + c.level;
    const attrCap = Math.min(20, 5 + Math.floor((c.level - 1) / 6));
    const skillBudget = 9 + c.level;
    const skillCap = Math.min(10, 3 + Math.floor((c.level - 1) / 12));
    const attrs = Object.values(c.attributes || {}).map(Number);
    const skills = Object.values(c.skills || {}).map(Number);
    if (attrs.length !== 8 || attrs.reduce((a, b) => a + b, 0) > attrBudget || Math.max(...attrs) > attrCap || Math.min(...attrs) < 1) throw new Error(`${name}: atributos não cabem no nível.`);
    if (skills.reduce((a, b) => a + b, 0) > skillBudget || (skills.length && Math.max(...skills) > skillCap) || skills.some((x) => x < 0)) throw new Error(`${name}: perícias não cabem no nível.`);
    if (Number(c.growth_vigor || 0) + Number(c.growth_reserve || 0) > c.level) throw new Error(`${name}: crescimento excede o nível.`);
  }
}

async function fetchExisting(client) {
  const { data, error } = await client.from('characters').select('*').eq('entity_type', 'npc');
  if (error) throw error;
  return data || [];
}

function matchExisting(rows, name) {
  const wanted = normalizeName(name);
  return rows.filter((row) => normalizeName(fullName(row)) === wanted);
}

async function backupTargets(client, characters) {
  const ids = characters.map((x) => x.id);
  const backup = { created_at: new Date().toISOString(), package: MARKER, characters, abilities: [], vows: [], equipment: [], secrets: [] };
  if (ids.length) {
    const [abilities, vows, equipment, secrets] = await Promise.all([
      client.from('abilities').select('*').in('character_id', ids),
      client.from('vows').select('*').in('character_id', ids),
      client.from('equipment').select('*').in('character_id', ids),
      client.from('character_master_secrets').select('*').in('character_id', ids),
    ]);
    for (const result of [abilities, vows, equipment, secrets]) if (result.error) throw result.error;
    backup.abilities = abilities.data || [];
    backup.vows = vows.data || [];
    backup.equipment = equipment.data || [];
    backup.secrets = secrets.data || [];
  }
  const directory = path.resolve(ROOT, 'staff-backups');
  fs.mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(directory, `staff-v3-before-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8');
  return file;
}

async function upsertCharacter(client, npc, existing) {
  const c = npc.character;
  const payload = {
    entity_type: 'npc', first_name: c.first_name, last_name: c.last_name || '', nickname: c.nickname || '', grade: c.grade, level: c.level,
    biography: c.biography || '', personality: c.personality || '', goals: c.goals || '', appearance: c.appearance || '', notes: c.notes || '',
    technique_name: c.technique_name || '', technique_description: c.technique_description || '', attributes: c.attributes || {}, skills: c.skills || {},
    growth_vigor: Number(c.growth_vigor || 0), growth_reserve: Number(c.growth_reserve || 0),
    permanent_ps_bonus: Number(c.permanent_ps_bonus || 0), permanent_ea_bonus: Number(c.permanent_ea_bonus || 0),
    special_resources: c.special_resources || [], updated_at: new Date().toISOString(),
  };
  if (existing) {
    const { data, error } = await client.from('characters').update(payload).eq('id', existing.id).select('*').single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await client.from('characters').insert({ ...payload, owner_id: null, xp: 0 }).select('*').single();
  if (error) throw error;
  return data;
}

async function replaceAbilities(client, characterId, npc) {
  const rows = npc.abilities || [];
  if (npc.replace_all_abilities) {
    const { error } = await client.from('abilities').delete().eq('character_id', characterId);
    if (error) throw error;
  } else if (rows.length) {
    const { error } = await client.from('abilities').delete().eq('character_id', characterId).in('name', rows.map((x) => x.name));
    if (error) throw error;
  }
  if (!rows.length) return [];
  const payload = rows.map((a) => ({ character_id: characterId, category: a.category, name: a.name, description: a.description || '', mechanics: a.mechanics || '', config: a.config || {}, vp_estimated: Number(a.vp_estimated || 1), vp_approved: Number(a.vp_approved || a.vp_estimated || 1), limit_override: true, status: 'approved', master_response: MARKER }));
  const { data, error } = await client.from('abilities').insert(payload).select('*');
  if (error) throw error;
  return data || [];
}

async function replaceVows(client, characterId, npc) {
  const rows = npc.vows || [];
  if (npc.replace_all_vows) {
    const { error } = await client.from('vows').delete().eq('character_id', characterId);
    if (error) throw error;
  } else if (rows.length) {
    const { error } = await client.from('vows').delete().eq('character_id', characterId).in('name', rows.map((x) => x.name));
    if (error) throw error;
  }
  if (!rows.length) return [];
  const { data, error } = await client.from('vows').insert(rows.map((v) => ({ character_id: characterId, ...v, status: v.status || 'active' }))).select('*');
  if (error) throw error;
  return data || [];
}

async function replaceEquipment(client, characterId, npc) {
  const rows = npc.equipment || [];
  if (npc.replace_all_equipment) {
    const { error } = await client.from('equipment').delete().eq('character_id', characterId);
    if (error) throw error;
  } else if (rows.length) {
    const { error } = await client.from('equipment').delete().eq('character_id', characterId).in('name', rows.map((x) => x.name));
    if (error) throw error;
  }
  const created = [];
  for (const source of rows) {
    const desiredSlot = source.equip_slot || null;
    const item = { ...source, character_id: characterId, equipped: false };
    delete item.equip_slot;
    const { data, error } = await client.from('equipment').insert(item).select('*').single();
    if (error) throw error;
    if (!desiredSlot) { created.push(data); continue; }
    const { data: equipped, error: equipError } = await client.rpc('equip_equipment', { p_item_id: data.id, p_slot: desiredSlot });
    if (equipError) throw equipError;
    created.push(equipped);
  }
  return created;
}

async function syncSecret(client, characterId, secretText) {
  const { error } = await client.from('character_master_secrets').upsert({ character_id: characterId, secret_text: secretText || '', updated_at: new Date().toISOString() }, { onConflict: 'character_id' });
  if (error) throw error;
}

async function main() {
  if (!fs.existsSync(path.resolve(ROOT, 'package.json')) || !fs.existsSync(path.resolve(ROOT, 'supabase'))) throw new Error('Execute a partir da raiz do projeto Correntes do Destino.');
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  validateSpec(spec);
  if (process.argv.includes('--validate-only')) {
    for (const npc of spec.npcs) console.log(`${wantedName(npc)}:`, derived(npc.character));
    console.log('STAFF_V3 válido.');
    return;
  }
  const env = loadProjectEnv();
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error('VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY não encontrados.');
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    console.log('=== CORRENTES DO DESTINO — STAFF V3 ===');
    await authenticateMaster(client);
    const current = await fetchExisting(client);
    const matched = [];
    console.log('\n=== PRÉVIA ===');
    for (const npc of spec.npcs) {
      const found = matchExisting(current, wantedName(npc));
      if (found.length > 1) throw new Error(`Há mais de um NPC chamado ${wantedName(npc)}.`);
      if (found[0]) matched.push(found[0]);
      console.log(`${found[0] ? 'ATUALIZAR' : 'CRIAR   '} ${wantedName(npc)} — Nv ${npc.character.level} ${npc.character.grade}`);
    }
    const backupFile = await backupTargets(client, matched);
    console.log(`\nBackup salvo em:\n${backupFile}`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const confirmation = (await rl.question('\nDigite APLICAR para gravar o Staff V3 no Supabase: ')).trim().toUpperCase();
    rl.close();
    if (confirmation !== 'APLICAR') { console.log('Cancelado. Nenhum NPC foi alterado.'); return; }
    const refreshed = await fetchExisting(client);
    for (const npc of spec.npcs) {
      const found = matchExisting(refreshed, wantedName(npc));
      if (found.length > 1) throw new Error(`Há mais de um NPC chamado ${wantedName(npc)}.`);
      const character = await upsertCharacter(client, npc, found[0] || null);
      const abilities = await replaceAbilities(client, character.id, npc);
      const vows = await replaceVows(client, character.id, npc);
      const equipment = await replaceEquipment(client, character.id, npc);
      await syncSecret(client, character.id, npc.secret_text || '');
      const d = derived(character);
      console.log(`OK ${wantedName(npc)}: PS ${d.ps} • EA ${d.ea} • PA ${d.pa} • CA ${d.ca} • ${abilities.length} habilidades • ${vows.length} votos • ${equipment.length} itens`);
    }
  } finally {
    await client.auth.signOut().catch(() => {});
  }
}

main().catch((error) => {
  console.error('\nERRO:', error?.message || error);
  if (error?.details) console.error('Detalhes:', error.details);
  if (error?.hint) console.error('Dica:', error.hint);
  process.exitCode = 1;
});
