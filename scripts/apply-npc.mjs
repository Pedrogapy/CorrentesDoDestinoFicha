import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

/**
 * Correntes do Destino - importador de NPCs.
 *
 * Objetivo:
 * - aplicar NPCs de teste sem usar service_role;
 * - autenticar como Mestre normal e respeitar RLS/triggers do projeto;
 * - criar/atualizar personagem, habilidades, votos e equipamentos;
 * - ser idempotente para os nomes declarados no arquivo JSON.
 *
 * Uso:
 *   node .\\scripts\\apply-npc.mjs .\\data\\npcs\\nanami.json
 *   node .\\scripts\\apply-npc.mjs .\\data\\npcs\\nanami.json --remove
 */

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadProjectEnv() {
  // Mesmo princípio do Vite: .env base e .env.local sobrescrevendo.
  return {
    ...parseEnvFile(path.resolve('.env')),
    ...parseEnvFile(path.resolve('.env.local')),
    ...process.env,
  };
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

// Mantém a mesma convenção da tela de login atual do projeto.
function authEmailFromCharacter(fullName) {
  const slug = normalizeName(fullName);
  return `${slug || 'personagem'}@example.com`;
}

function authPasswordFromVisiblePassword(password) {
  const raw = String(password || '');
  return raw.length >= 6 ? raw : `${raw}::CD`;
}

async function askHidden(promptText) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Este script precisa ser executado em um terminal interativo para pedir a senha do Mestre.');
  }

  process.stdout.write(promptText);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return await new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Operação cancelada.'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        value += ch;
        process.stdout.write('*');
      }
    };
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.on('data', onData);
  });
}

function fullName(character) {
  return [character.first_name, character.last_name].filter(Boolean).join(' ').trim();
}

function attrMod(value) {
  return Math.floor((Number(value) || 0) / 2);
}

function derived(character) {
  const a = character.attributes || {};
  const s = character.skills || {};
  const level = Number(character.level) || 1;
  const pa = level >= 100 ? 7 : level >= 75 ? 6 : level >= 50 ? 5 : level >= 25 ? 4 : 3;
  const ps = 18 + 2 * level + 2 * Number(a.resistance || 0) + 2 * Number(character.growth_vigor || 0) + Number(character.permanent_ps_bonus || 0);
  const ea = 18 + 2 * level + 2 * Number(a.cursed_control || 0) + 2 * Number(character.growth_reserve || 0) + Number(character.permanent_ea_bonus || 0);
  const routes = {
    Reflexos: 10 + attrMod(a.dexterity) + Number(s.reflexes || 0),
    Defender: 10 + attrMod(a.resistance) + Number(s.defend || 0),
    Fortitude: 10 + attrMod(a.resistance) + Number(s.fortitude || 0),
    Reforco: 10 + attrMod(a.cursed_control) + Number(s.reinforcement || 0),
  };
  return { ps, ea, pa, ca: Math.max(...Object.values(routes)), routes };
}

function printPreview(spec) {
  const c = spec.character;
  const d = derived(c);
  console.log('\n=== PRÉVIA DO NPC ===');
  console.log(`${fullName(c)} • ${c.grade} • Nível ${c.level}`);
  console.log(`PS ${d.ps} • EA ${d.ea} • PA ${d.pa} • CA ${d.ca}`);
  console.log('Rotas de defesa:', d.routes);
  console.log(`Técnica: ${c.technique_name || '—'}`);
  console.log(`Habilidades: ${(spec.abilities || []).map((x) => `${x.name} (${x.category}, VP ${x.vp_approved ?? x.vp_estimated})`).join(', ') || '—'}`);
  console.log(`Votos: ${(spec.vows || []).map((x) => x.name).join(', ') || '—'}`);
  console.log(`Equipamentos: ${(spec.equipment || []).map((x) => `${x.name}${x.equip_slot ? ` [${x.equip_slot}]` : ''}`).join(', ') || '—'}`);
  console.log('=====================\n');
}

async function authenticateMaster(supabase) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const masterName = (await rl.question('Nome usado para entrar como Mestre: ')).trim();
  rl.close();
  const visiblePassword = await askHidden('Senha visível do Mestre: ');

  const email = authEmailFromCharacter(masterName);
  const password = authPasswordFromVisiblePassword(visiblePassword);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) throw new Error(`Falha no login do Mestre: ${authError.message}`);

  const user = authData?.user;
  if (!user) throw new Error('Supabase não retornou usuário autenticado.');

  const { data: profile, error: profileError } = await supabase.from('profiles').select('id,display_name,role').eq('id', user.id).single();
  if (profileError) throw new Error(`Não foi possível confirmar o perfil: ${profileError.message}`);
  if (profile.role !== 'master') throw new Error(`A conta autenticada é '${profile.role}', não 'master'. Nada foi alterado.`);

  console.log(`Autenticado como Mestre: ${profile.display_name || masterName}`);
  return profile;
}

async function findExistingCharacter(supabase, spec) {
  let query = supabase
    .from('characters')
    .select('*')
    .eq('entity_type', spec.character.entity_type || 'npc')
    .eq('first_name', spec.character.first_name)
    .eq('last_name', spec.character.last_name || '');
  const { data, error } = await query.limit(2);
  if (error) throw error;
  if ((data || []).length > 1) {
    throw new Error(`Existem múltiplos personagens chamados ${fullName(spec.character)}. Remova/renomeie o duplicado antes de sincronizar.`);
  }
  return data?.[0] || null;
}

async function upsertCharacter(supabase, spec) {
  const existing = await findExistingCharacter(supabase, spec);
  const payload = { ...spec.character, owner_id: null, updated_at: new Date().toISOString() };
  if (existing) {
    const { data, error } = await supabase.from('characters').update(payload).eq('id', existing.id).select('*').single();
    if (error) throw error;
    console.log(`NPC atualizado: ${fullName(data)} (${data.id})`);
    return data;
  }
  const { data, error } = await supabase.from('characters').insert(payload).select('*').single();
  if (error) throw error;
  console.log(`NPC criado: ${fullName(data)} (${data.id})`);
  return data;
}

async function replaceNamedRows(supabase, table, characterId, rows, payloadMapper = (row) => row) {
  if (!rows?.length) return [];
  const names = rows.map((x) => x.name);
  const { error: deleteError } = await supabase.from(table).delete().eq('character_id', characterId).in('name', names);
  if (deleteError) throw deleteError;
  const payload = rows.map((row) => ({ character_id: characterId, ...payloadMapper(row) }));
  const { data, error } = await supabase.from(table).insert(payload).select('*');
  if (error) throw error;
  return data || [];
}

async function syncEquipment(supabase, characterId, items) {
  if (!items?.length) return [];
  const names = items.map((x) => x.name);
  const { error: deleteError } = await supabase.from('equipment').delete().eq('character_id', characterId).in('name', names);
  if (deleteError) throw deleteError;

  const created = [];
  for (const source of items) {
    const desiredSlot = source.equip_slot || null;
    const item = { ...source };
    delete item.equip_slot;
    item.character_id = characterId;
    item.equipped = false;

    const { data, error } = await supabase.from('equipment').insert(item).select('*').single();
    if (error) throw error;
    let finalItem = data;

    if (desiredSlot) {
      const { data: equipped, error: equipError } = await supabase.rpc('equip_equipment', {
        p_item_id: data.id,
        p_slot: desiredSlot,
      });
      if (equipError) throw equipError;
      finalItem = equipped;
    }
    created.push(finalItem);
  }
  return created;
}

async function removeNpc(supabase, spec) {
  const existing = await findExistingCharacter(supabase, spec);
  if (!existing) {
    console.log('NPC não existe. Nada para remover.');
    return;
  }
  const { error } = await supabase.from('characters').delete().eq('id', existing.id);
  if (error) throw error;
  console.log(`NPC removido: ${fullName(existing)}. Habilidades, votos e equipamentos vinculados foram removidos por cascade.`);
}

async function main() {
  const args = process.argv.slice(2);
  const removeMode = args.includes('--remove');
  const fileArg = args.find((arg) => !arg.startsWith('--'));
  if (!fileArg) {
    console.error('Uso: node .\\scripts\\apply-npc.mjs .\\data\\npcs\\arquivo.json [--remove]');
    process.exitCode = 2;
    return;
  }

  const specPath = path.resolve(fileArg);
  if (!fs.existsSync(specPath)) throw new Error(`Arquivo não encontrado: ${specPath}`);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  if (!spec?.character?.first_name) throw new Error('JSON inválido: character.first_name é obrigatório.');

  printPreview(spec);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = removeMode
    ? `REMOVER ${fullName(spec.character)} do banco? Digite REMOVER para confirmar: `
    : `Aplicar/sincronizar ${fullName(spec.character)} no banco? Digite SIM para confirmar: `;
  const confirmation = (await rl.question(question)).trim().toUpperCase();
  rl.close();
  if ((!removeMode && confirmation !== 'SIM') || (removeMode && confirmation !== 'REMOVER')) {
    console.log('Cancelado. Nada foi alterado.');
    return;
  }

  const env = loadProjectEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error('VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY não encontrados em .env ou .env.local.');
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    await authenticateMaster(supabase);

    if (removeMode) {
      await removeNpc(supabase, spec);
      return;
    }

    const character = await upsertCharacter(supabase, spec);

    const abilities = await replaceNamedRows(supabase, 'abilities', character.id, spec.abilities || [], (row) => ({
      ...row,
      status: 'approved',
      master_response: row.master_response || 'Aplicado diretamente pelo importador do Mestre.',
    }));
    console.log(`Habilidades sincronizadas: ${abilities.length}`);

    const vows = await replaceNamedRows(supabase, 'vows', character.id, spec.vows || [], (row) => ({
      ...row,
      status: row.status || 'active',
    }));
    console.log(`Votos sincronizados: ${vows.length}`);

    const equipment = await syncEquipment(supabase, character.id, spec.equipment || []);
    console.log(`Equipamentos sincronizados: ${equipment.length}`);

    const d = derived(character);
    console.log('\n=== CONCLUÍDO ===');
    console.log(`${fullName(character)} • ${character.grade} • Nível ${character.level}`);
    console.log(`PS ${d.ps} • EA ${d.ea} • PA ${d.pa} • CA ${d.ca}`);
    for (const item of equipment) {
      console.log(`Equipamento: ${item.name} • ${item.equipped ? `equipado em ${item.equip_slot}` : 'inventário'}`);
    }
    console.log('Abra o painel do Mestre no site e selecione o NPC para ver exatamente como os dados ficaram na UI.');
  } finally {
    await supabase.auth.signOut().catch(() => {});
  }
}

main().catch((error) => {
  console.error('\nERRO:', error?.message || error);
  if (error?.details) console.error('Detalhes:', error.details);
  if (error?.hint) console.error('Dica:', error.hint);
  process.exitCode = 1;
});
