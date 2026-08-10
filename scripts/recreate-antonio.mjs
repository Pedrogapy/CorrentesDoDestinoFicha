import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

/**
 * Correntes do Destino — reparo/recriação idempotente da conta de Antônio Fagulhas.
 *
 * Faz, em uma execução:
 * 1) reutiliza o usuário Auth existente ou o recria se estiver ausente;
 * 2) confirma que o profile é player;
 * 3) reaproveita a ficha órfã ou reassocia uma ficha presa a owner_id antigo;
 * 4) cria a ficha se ela também tiver sido apagada;
 * 5) sincroniza atributos, perícias, Técnica, habilidades e Tecido de Desvio;
 * 6) preserva XP/ID da ficha antiga quando uma ficha órfã é recuperada.
 *
 * Não usa service_role. O cadastro usa a chave pública e as alterações da ficha
 * são feitas após autenticar com a conta normal do Mestre, respeitando RLS.
 */

const PLAYER_DISPLAY_NAME = 'Antônio Fagulhas';
const PLAYER_FIRST_NAME = 'Antônio';
const PLAYER_LAST_NAME = 'Fagulhas';
const PLAYER_VISIBLE_PASSWORD = 'Fagulhas';
const SPEC_PATH = path.resolve('data/players/antonio.json');

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
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

function authEmailFromCharacter(fullName) {
  return `${normalizeName(fullName) || 'personagem'}@example.com`;
}

function authPasswordFromVisiblePassword(password) {
  const raw = String(password || '');
  return raw.length >= 6 ? raw : `${raw}::CD`;
}

function fullName(row) {
  return [row?.first_name, row?.last_name].filter(Boolean).join(' ').trim();
}

async function askHidden(promptText) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Execute em um terminal interativo.');
  process.stdout.write(promptText);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return await new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          cleanup(); process.stdout.write('\n'); reject(new Error('Operação cancelada.')); return;
        }
        if (ch === '\r' || ch === '\n') {
          cleanup(); process.stdout.write('\n'); resolve(value); return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        value += ch; process.stdout.write('*');
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

async function getOrCreateAuthAccount(publicClient) {
  const email = authEmailFromCharacter(PLAYER_DISPLAY_NAME);
  const password = authPasswordFromVisiblePassword(PLAYER_VISIBLE_PASSWORD);
  console.log('\n=== CONTA DO PLAYER ===');
  console.log(`Nome de login: ${PLAYER_DISPLAY_NAME}`);
  console.log(`Senha visível: ${PLAYER_VISIBLE_PASSWORD}`);
  console.log(`E-mail técnico: ${email}`);

  // Primeiro tenta usar a conta canônica já existente. Isto torna o reparo idempotente:
  // se uma execução anterior criou o Auth e falhou depois, basta executar novamente.
  const { data: loginData, error: loginError } = await publicClient.auth.signInWithPassword({ email, password });
  if (!loginError && loginData?.user?.id) {
    console.log(`Auth existente reutilizado: ${loginData.user.id}`);
    const user = loginData.user;
    await publicClient.auth.signOut().catch(() => {});
    return { user, created: false };
  }

  // Se não foi possível entrar, tenta cadastro. Em um projeto onde a conta já existe com
  // outra senha, o cadastro será recusado e paramos em vez de criar ambiguidade.
  const { data, error } = await publicClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: PLAYER_DISPLAY_NAME,
        character_first_name: PLAYER_FIRST_NAME,
        character_last_name: PLAYER_LAST_NAME,
      },
    },
  });
  if (error) {
    throw new Error(`Não foi possível entrar nem criar ${email}: ${error.message}. Se a conta existe com outra senha, ajuste a senha no Auth e execute novamente.`);
  }
  if (!data?.user?.id) throw new Error('Supabase não retornou o ID do usuário criado.');
  if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error(`O Auth aparenta já existir para ${email}, mas a senha não corresponde a '${PLAYER_VISIBLE_PASSWORD}'. Não vou prosseguir com uma identidade ambígua.`);
  }
  console.log(`Auth criado: ${data.user.id}`);
  const user = data.user;
  await publicClient.auth.signOut().catch(() => {});
  return { user, created: true };
}

async function ensurePlayerProfile(masterClient, userId) {
  // O trigger de auth.users normalmente cria o profile. A consulta abaixo apenas confirma.
  const { data, error } = await masterClient.from('profiles').select('id,display_name,role').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('O usuário foi criado, mas o profile não apareceu. Verifique o trigger handle_new_user.');
  if (data.role !== 'player') {
    const { error: updateError } = await masterClient.from('profiles').update({ role: 'player', display_name: PLAYER_DISPLAY_NAME, updated_at: new Date().toISOString() }).eq('id', userId);
    if (updateError) throw updateError;
  } else if (data.display_name !== PLAYER_DISPLAY_NAME) {
    const { error: updateError } = await masterClient.from('profiles').update({ display_name: PLAYER_DISPLAY_NAME, updated_at: new Date().toISOString() }).eq('id', userId);
    if (updateError) throw updateError;
  }
}

async function confirmText(expected, message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(message)).trim().toUpperCase();
  rl.close();
  return answer === expected.toUpperCase();
}

async function findOrAttachCharacter(masterClient, userId, spec) {
  // 1) Se a ficha já estiver ligada ao Auth canônico, ótimo: apenas sincroniza.
  const { data: owned, error: ownedError } = await masterClient.from('characters').select('*').eq('entity_type', 'player').eq('owner_id', userId);
  if (ownedError) throw ownedError;
  if ((owned || []).length > 1) throw new Error('Mais de uma ficha player está ligada ao Auth canônico de Antônio. Corrija duplicatas antes de continuar.');
  if ((owned || []).length === 1) {
    if (normalizeName(fullName(owned[0])) !== normalizeName(PLAYER_DISPLAY_NAME)) {
      throw new Error(`O Auth canônico já está ligado a outra ficha player: '${fullName(owned[0])}'. Não vou sobrescrever essa relação.`);
    }
    console.log(`Ficha já ligada ao Auth correto: ${owned[0].id} • XP ${owned[0].xp}`);
    return owned[0];
  }

  // 2) Procura a ficha pelo nome normalizado (Antonio/Antônio são equivalentes).
  const { data: players, error } = await masterClient.from('characters').select('*').eq('entity_type', 'player');
  if (error) throw error;
  const wanted = normalizeName(PLAYER_DISPLAY_NAME);
  const matching = (players || []).filter(row => normalizeName(fullName(row)) === wanted);
  if (matching.length > 1) throw new Error('Existem múltiplas fichas player equivalentes a Antônio Fagulhas. Não é seguro escolher automaticamente.');

  if (matching.length === 1) {
    const old = matching[0];

    if (!old.owner_id) {
      const { data, error: updateError } = await masterClient.from('characters').update({
        owner_id: userId,
        first_name: PLAYER_FIRST_NAME,
        last_name: PLAYER_LAST_NAME,
        updated_at: new Date().toISOString(),
      }).eq('id', old.id).select('*').single();
      if (updateError) throw updateError;
      console.log(`Ficha órfã recuperada: ${data.id} • XP ${data.xp}`);
      return data;
    }

    // 3) Caso real que ocorreu: a ficha sobreviveu ainda com outro owner_id, mas o Auth
    // canônico foi recriado. Como estamos autenticados como Mestre, podemos reassociar.
    const { data: oldProfile } = await masterClient.from('profiles').select('id,display_name,role').eq('id', old.owner_id).maybeSingle();
    console.log('\n=== FICHA EXISTENTE COM OWNER ANTIGO ===');
    console.log(`Ficha: ${old.id}`);
    console.log(`Nome: ${fullName(old)}`);
    console.log(`XP preservado: ${old.xp}`);
    console.log(`owner_id atual: ${old.owner_id}`);
    if (oldProfile) console.log(`Perfil ligado atualmente: ${oldProfile.display_name || '(sem nome)'} • ${oldProfile.role}`);
    console.log(`Novo owner_id canônico: ${userId}`);
    console.log('A reassociação muda somente o dono da ficha. O ID da ficha, XP, histórico e relações continuam os mesmos.');

    const ok = await confirmText('REASSOCIAR', 'Digite REASSOCIAR para ligar esta ficha à nova conta de Antônio: ');
    if (!ok) throw new Error('Reassociação cancelada. Nenhum owner_id foi alterado.');

    const { data, error: rebindError } = await masterClient.from('characters').update({
      owner_id: userId,
      first_name: PLAYER_FIRST_NAME,
      last_name: PLAYER_LAST_NAME,
      updated_at: new Date().toISOString(),
    }).eq('id', old.id).select('*').single();
    if (rebindError) throw rebindError;
    console.log(`Ficha reassociada com sucesso: ${data.id} • owner_id ${data.owner_id}`);
    return data;
  }

  // 4) Se a ficha também foi apagada, cria uma nova já ligada ao Auth canônico.
  const c = spec.character;
  const { data, error: insertError } = await masterClient.from('characters').insert({
    owner_id: userId,
    entity_type: 'player',
    first_name: PLAYER_FIRST_NAME,
    last_name: PLAYER_LAST_NAME,
    grade: c.grade || 'Grau 4',
    level: c.level || 5,
    attributes: c.attributes || {},
    skills: c.skills || {},
    growth_vigor: c.growth_vigor || 0,
    growth_reserve: c.growth_reserve || 0,
  }).select('*').single();
  if (insertError) throw insertError;
  console.log(`Nova ficha player criada: ${data.id}`);
  return data;
}

async function syncCharacter(masterClient, character, spec) {
  const source = spec.character;
  const patch = {
    first_name: PLAYER_FIRST_NAME,
    last_name: PLAYER_LAST_NAME,
    grade: source.grade,
    level: source.level,
    biography: source.biography ?? character.biography ?? '',
    personality: source.personality ?? character.personality ?? '',
    goals: source.goals ?? character.goals ?? '',
    appearance: source.appearance ?? character.appearance ?? '',
    notes: source.notes ?? character.notes ?? '',
    image_url: source.image_url ?? character.image_url ?? '',
    image_path: source.image_path ?? character.image_path ?? '',
    technique_name: source.technique_name ?? '',
    technique_description: source.technique_description ?? '',
    attributes: source.attributes,
    skills: source.skills,
    growth_vigor: source.growth_vigor,
    growth_reserve: source.growth_reserve,
    permanent_ps_bonus: source.permanent_ps_bonus ?? 0,
    permanent_ea_bonus: source.permanent_ea_bonus ?? 0,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await masterClient.from('characters').update(patch).eq('id', character.id).select('*').single();
  if (error) throw error;
  return data;
}

async function syncAbilities(masterClient, characterId, spec) {
  if (spec.replace_abilities) {
    // v0.7.x possui cursed_body_technique_id. Antônio não usa Técnica do Corpo, mas
    // mantemos o filtro para nunca apagar uma concessão secreta por acidente.
    const { error } = await masterClient.from('abilities').delete().eq('character_id', characterId).is('cursed_body_technique_id', null);
    if (error) throw error;
  } else {
    const names = (spec.abilities || []).map(x => x.name);
    if (names.length) {
      const { error } = await masterClient.from('abilities').delete().eq('character_id', characterId).in('name', names);
      if (error) throw error;
    }
  }

  if (!(spec.abilities || []).length) return [];
  const payload = spec.abilities.map(row => ({
    character_id: characterId,
    ...row,
    status: 'approved',
    master_response: row.master_response || 'Convertido e aprovado pelo Mestre para o sistema atual.',
  }));
  const { data, error } = await masterClient.from('abilities').insert(payload).select('*');
  if (error) throw error;
  return data || [];
}

async function syncEquipment(masterClient, characterId, items) {
  if (!items?.length) return [];
  const names = items.map(x => x.name);
  const { error: deleteError } = await masterClient.from('equipment').delete().eq('character_id', characterId).in('name', names);
  if (deleteError) throw deleteError;

  const created = [];
  for (const source of items) {
    const desiredSlot = source.equip_slot || null;
    const item = { ...source };
    delete item.equip_slot;
    item.character_id = characterId;
    item.equipped = false;
    item.status = 'approved';
    const { data, error } = await masterClient.from('equipment').insert(item).select('*').single();
    if (error) throw error;
    let final = data;
    if (desiredSlot) {
      const { data: equipped, error: equipError } = await masterClient.rpc('equip_equipment', { p_item_id: data.id, p_slot: desiredSlot });
      if (equipError) throw equipError;
      final = equipped;
    }
    created.push(final);
  }
  return created;
}

function derived(c) {
  const mod = v => Math.floor(Number(v || 0) / 2);
  const a = c.attributes || {}, s = c.skills || {}, level = Number(c.level) || 1;
  const ps = 18 + 2 * level + 2 * Number(a.resistance || 0) + 2 * Number(c.growth_vigor || 0) + Number(c.permanent_ps_bonus || 0);
  const ea = 18 + 2 * level + 2 * Number(a.cursed_control || 0) + 2 * Number(c.growth_reserve || 0) + Number(c.permanent_ea_bonus || 0);
  const pa = level >= 100 ? 7 : level >= 75 ? 6 : level >= 50 ? 5 : level >= 25 ? 4 : 3;
  const ca = Math.max(
    10 + mod(a.dexterity) + Number(s.reflexes || 0),
    10 + mod(a.resistance) + Number(s.defend || 0),
    10 + mod(a.resistance) + Number(s.fortitude || 0),
    10 + mod(a.cursed_control) + Number(s.reinforcement || 0),
  );
  return { ps, ea, pa, ca };
}

async function main() {
  if (!fs.existsSync(SPEC_PATH)) throw new Error(`Arquivo não encontrado: ${SPEC_PATH}`);
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  // O nome canônico do banco deve manter o acento correto.
  spec.character.first_name = PLAYER_FIRST_NAME;
  spec.character.last_name = PLAYER_LAST_NAME;

  const env = loadProjectEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY não encontrados em .env/.env.local.');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('=== RECRIAR ANTÔNIO FAGULHAS ===');
  console.log('Este script recria o Auth e liga/recria a ficha mecânica sem usar service_role.');
  console.log(`Login final: ${PLAYER_DISPLAY_NAME} / ${PLAYER_VISIBLE_PASSWORD}`);
  const confirm = (await rl.question('Digite RECRIAR para continuar: ')).trim().toUpperCase();
  rl.close();
  if (confirm !== 'RECRIAR') { console.log('Cancelado.'); return; }

  const publicClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const masterClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  const { user, created: authCreated } = await getOrCreateAuthAccount(publicClient);
  try {
    console.log('\n=== VINCULANDO AO BANCO ===');
    await authenticateMaster(masterClient);
    await ensurePlayerProfile(masterClient, user.id);
    const baseCharacter = await findOrAttachCharacter(masterClient, user.id, spec);
    const character = await syncCharacter(masterClient, baseCharacter, spec);
    const abilities = await syncAbilities(masterClient, character.id, spec);
    const equipment = await syncEquipment(masterClient, character.id, spec.equipment || []);
    const d = derived(character);

    console.log('\n=== CONCLUÍDO ===');
    console.log(`Conta: ${PLAYER_DISPLAY_NAME}`);
    console.log(`Senha visível: ${PLAYER_VISIBLE_PASSWORD}`);
    console.log(`Auth: ${user.id} (${authCreated ? 'criado nesta execução' : 'reutilizado'})`);
    console.log(`Ficha: ${character.id}`);
    console.log(`PS ${d.ps} • EA ${d.ea} • PA ${d.pa} • CA ${d.ca}`);
    console.log(`Habilidades aprovadas: ${abilities.length}`);
    console.log(`Equipamentos sincronizados: ${equipment.length}`);
    console.log('O jogador já pode entrar no site com o nome e a senha acima.');
  } catch (error) {
    console.error('\nA conta Auth foi criada, mas a sincronização da ficha falhou.');
    console.error('A execução pode ser repetida com segurança: o script agora reutiliza a conta Auth existente.');
    throw error;
  } finally {
    await masterClient.auth.signOut().catch(() => {});
  }
}

main().catch(error => {
  console.error('\nERRO:', error?.message || error);
  if (error?.details) console.error('Detalhes:', error.details);
  if (error?.hint) console.error('Dica:', error.hint);
  process.exitCode = 1;
});
