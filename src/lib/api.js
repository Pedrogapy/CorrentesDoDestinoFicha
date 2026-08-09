import { supabase } from './supabase.js';
import { createBalancedBuild } from './system.js';

export async function getProfile() {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
}

export async function getMyCharacter() {
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('entity_type', 'player')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function ensureMyCharacter(user) {
  let character = await getMyCharacter();
  if (character) return character;

  const metadata = user.user_metadata || {};
  const level = 5;
  const build = createBalancedBuild(level);
  const payload = {
    owner_id: user.id,
    entity_type: 'player',
    first_name: metadata.character_first_name || metadata.display_name || 'Personagem',
    last_name: metadata.character_last_name || '',
    level,
    grade: 'Grau 4',
    ...build,
  };
  const { data, error } = await supabase.from('characters').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function saveCharacter(character) {
  const { data, error } = await supabase
    .from('characters')
    .update({
      first_name: character.first_name,
      last_name: character.last_name,
      nickname: character.nickname,
      grade: character.grade,
      biography: character.biography,
      personality: character.personality,
      goals: character.goals,
      appearance: character.appearance,
      notes: character.notes,
      image_url: character.image_url,
      image_path: character.image_path,
      technique_name: character.technique_name,
      technique_description: character.technique_description,
      attributes: character.attributes,
      skills: character.skills,
      growth_vigor: character.growth_vigor,
      growth_reserve: character.growth_reserve,
      updated_at: new Date().toISOString(),
    })
    .eq('id', character.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function levelUpCharacter(characterId) {
  const { data, error } = await supabase.rpc('level_up_character', { p_character_id: characterId });
  if (error) throw error;
  return data;
}


export async function getChildSheets(parentCharacterId) {
  const { data, error } = await supabase.from('characters').select('*').eq('parent_character_id', parentCharacterId).order('created_at');
  if (error) throw error;
  return data || [];
}

export async function createSummonSheet(parentCharacterId, name) {
  const { data, error } = await supabase.rpc('create_summon_sheet', { p_parent_id: parentCharacterId, p_name: name });
  if (error) throw error;
  return data;
}

export async function getSystemConditions() {
  const { data, error } = await supabase.from('system_conditions').select('*').eq('active', true).order('name');
  if (error) throw error;
  return data || [];
}


export async function upsertSystemCondition(payload) {
  const { data, error } = await supabase.from('system_conditions').upsert(payload, { onConflict: 'key' }).select('*').single();
  if (error) throw error;
  return data;
}

export async function deactivateSystemCondition(id) {
  const { data, error } = await supabase.from('system_conditions').update({ active: false }).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function getAbilities(characterId) {
  const { data, error } = await supabase.from('abilities').select('*').eq('character_id', characterId).order('created_at');
  if (error) throw error;
  return data || [];
}

export async function createAbility(payload) {
  const { data, error } = await supabase.from('abilities').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function getTrainingTickets(characterId = null) {
  let query = supabase.from('training_tickets').select('*, characters(first_name,last_name)').order('created_at', { ascending: false });
  if (characterId) query = query.eq('character_id', characterId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getFreeTimeBalance(characterId) {
  const { data, error } = await supabase
    .from('free_time_balances')
    .select('*')
    .eq('character_id', characterId)
    .eq('expired', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function submitTrainingTicket(characterId, activity, description, days) {
  const { data, error } = await supabase.rpc('submit_training_ticket', {
    p_character_id: characterId,
    p_activity: activity,
    p_description: description,
    p_days: Number(days),
  });
  if (error) throw error;
  return data;
}

export async function resolveTrainingTicket(ticketId, status, masterResponse = '') {
  const { data, error } = await supabase.rpc('resolve_training_ticket', {
    p_ticket_id: ticketId,
    p_status: status,
    p_master_response: masterResponse,
  });
  if (error) throw error;
  return data;
}


export async function getMasterRequests(characterId = null) {
  let query = supabase.from('master_requests').select('*, characters(first_name,last_name)').order('created_at', { ascending: false });
  if (characterId) query = query.eq('character_id', characterId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createMasterRequest(characterId, title, message) {
  const { data, error } = await supabase.from('master_requests').insert({ character_id: characterId, title, message }).select('*').single();
  if (error) throw error;
  return data;
}

export async function resolveMasterRequest(id, status, masterResponse = '') {
  const { data, error } = await supabase.from('master_requests').update({ status, master_response: masterResponse, resolved_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function getVows(characterId = null) {
  let query = supabase.from('vows').select('*, characters(first_name,last_name)').order('created_at', { ascending: false });
  if (characterId) query = query.eq('character_id', characterId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createVow(payload) {
  const { data, error } = await supabase.from('vows').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function setVowStatus(id, status) {
  const { data, error } = await supabase.from('vows').update({ status }).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function getEquipment(characterId) {
  const { data, error } = await supabase.from('equipment').select('*').eq('character_id', characterId).order('equipped', { ascending: false }).order('created_at');
  if (error) throw error;
  return data || [];
}

export async function addEquipment(payload) {
  const { data, error } = await supabase.from('equipment').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function updateEquipment(id, changes) {
  const { data, error } = await supabase.from('equipment').update(changes).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function deleteEquipment(id) {
  const { error } = await supabase.rpc('delete_equipment', { p_item_id: id });
  if (error) throw error;
}

export async function listPendingEquipment() {
  const { data, error } = await supabase
    .from('equipment')
    .select('*, characters(first_name,last_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function setEquipmentStatus(id, status, masterResponse='') {
  const { data, error } = await supabase
    .from('equipment')
    .update({ status, master_response: masterResponse })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function equipEquipment(id, slot) {
  const { data, error } = await supabase.rpc('equip_equipment', { p_item_id: id, p_slot: slot });
  if (error) throw error;
  return data;
}

export async function unequipEquipment(id) {
  const { data, error } = await supabase.rpc('unequip_equipment', { p_item_id: id });
  if (error) throw error;
  return data;
}

export async function spendEquipmentCharges(id, amount=1) {
  const { data, error } = await supabase.rpc('spend_equipment_charges', { p_item_id: id, p_amount: Number(amount) || 0 });
  if (error) throw error;
  return data;
}

export async function getAuditLogs(characterId = null) {
  let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
  if (characterId) query = query.eq('character_id', characterId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function uploadCharacterImage(userId, characterId, file) {
  const extension = file.name.split('.').pop() || 'png';
  const path = `${userId}/${characterId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('character-images').upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('character-images').getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

// MASTER
export async function listAllCharacters() {
  const { data, error } = await supabase.from('characters').select('*').order('entity_type').order('first_name');
  if (error) throw error;
  return data || [];
}

export async function createMasterEntity({ entityType, firstName, lastName, level, grade }) {
  const build = createBalancedBuild(level);
  const { data, error } = await supabase
    .from('characters')
    .insert({
      entity_type: entityType,
      first_name: firstName,
      last_name: lastName,
      level: Number(level),
      grade,
      ...build,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function masterSaveCharacter(character) {
  const payload = { ...character };
  const id = payload.id;
  delete payload.id;
  delete payload.created_at;
  delete payload.updated_at;
  const { data, error } = await supabase.from('characters').update(payload).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function getMasterSecret(characterId) {
  const { data, error } = await supabase.from('character_master_secrets').select('*').eq('character_id', characterId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveMasterSecret(characterId, secretText) {
  const { data, error } = await supabase
    .from('character_master_secrets')
    .upsert({ character_id: characterId, secret_text: secretText }, { onConflict: 'character_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listMasterProgress(characterId = null) {
  let query = supabase.from('master_progress_tracks').select('*, characters(first_name,last_name)').order('created_at');
  if (characterId) query = query.eq('character_id', characterId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function upsertMasterProgress(payload) {
  const { data, error } = await supabase.from('master_progress_tracks').upsert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function getActiveSession() {
  const { data, error } = await supabase.from('sessions').select('*').eq('status', 'active').maybeSingle();
  if (error) throw error;
  return data;
}

export async function startSession(title = '') {
  const { data, error } = await supabase.rpc('start_session', { p_title: title });
  if (error) throw error;
  return data;
}

export async function endSession(awards) {
  const { data, error } = await supabase.rpc('end_session', { p_awards: awards });
  if (error) throw error;
  return data;
}

export async function triggerBackup(reason) {
  const { data, error } = await supabase.functions.invoke('session-backup', { body: { reason } });
  if (error) throw error;
  return data;
}

export async function getEncounters() {
  const { data, error } = await supabase.from('combat_encounters').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createEncounter(name) {
  const { data, error } = await supabase.from('combat_encounters').insert({ name, status: 'active' }).select('*').single();
  if (error) throw error;
  return data;
}

// Encerra o combate sem apagar participantes, rolagens ou histórico.
// A política RLS de combat_encounters permite esta alteração apenas ao Mestre.
export async function endEncounter(encounterId) {
  const { data, error } = await supabase
    .from('combat_encounters')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', encounterId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function addCombatParticipant(encounterId, character) {
  const { data, error } = await supabase
    .from('combat_participants')
    .insert({ encounter_id: encounterId, character_id: character.id })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function getCombatParticipants(encounterId) {
  const { data, error } = await supabase
    .from('combat_participants')
    .select('*, characters(*)')
    .eq('encounter_id', encounterId)
    .order('initiative', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updateCombatParticipant(id, changes) {
  const { data, error } = await supabase.from('combat_participants').update(changes).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function logRoll(payload) {
  const { data, error } = await supabase.from('roll_logs').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function getRollLogs(encounterId) {
  const { data, error } = await supabase
    .from('roll_logs')
    .select('*')
    .eq('encounter_id', encounterId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

export async function exportCharacterJson(characterId) {
  const tables = {};
  const [character, abilities, vows, equipment] = await Promise.all([
    supabase.from('characters').select('*').eq('id', characterId).single(),
    supabase.from('abilities').select('*').eq('character_id', characterId),
    supabase.from('vows').select('*').eq('character_id', characterId),
    supabase.from('equipment').select('*').eq('character_id', characterId),
  ]);
  for (const result of [character, abilities, vows, equipment]) if (result.error) throw result.error;
  tables.character = character.data;
  tables.abilities = abilities.data;
  tables.vows = vows.data;
  tables.equipment = equipment.data;
  return tables;
}

// ============================================================
// TESTES E MOTOR DE COMBATE v0.4
// ============================================================

export async function rollGeneralTest({ characterId, label, attributeKey, skillKey, mode='normal', count=1, visibility='public', encounterId=null }) {
  const { data, error } = await supabase.rpc('roll_general_test', {
    p_character_id: characterId,
    p_label: label,
    p_attribute_key: attributeKey,
    p_skill_key: skillKey,
    p_mode: mode,
    p_count: Number(count) || 1,
    p_visibility: visibility,
    p_encounter_id: encounterId,
  });
  if (error) throw error;
  return data;
}

export async function getGeneralRollLogs(characterId=null) {
  let query = supabase.from('roll_logs').select('*').is('encounter_id', null).order('created_at', { ascending: false }).limit(50);
  if (characterId) query = query.eq('character_id', characterId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getCombatTargets(encounterId) {
  const { data, error } = await supabase.rpc('get_combat_targets', { p_encounter_id: encounterId });
  if (error) throw error;
  return data || [];
}

export async function getVisibleCombatActions(encounterId) {
  const { data, error } = await supabase.rpc('get_visible_combat_actions', { p_encounter_id: encounterId });
  if (error) throw error;
  return data || [];
}

export async function createCombatAttack(payload) {
  const { data, error } = await supabase.rpc('create_combat_attack', {
    p_encounter_id: payload.encounterId,
    p_attacker_character_id: payload.attackerCharacterId,
    p_target_character_id: payload.targetCharacterId,
    p_label: payload.label || 'Ataque',
    p_source_type: payload.sourceType || 'basic',
    p_source_id: payload.sourceId || null,
    p_attack_attribute_key: payload.attackAttributeKey || 'strength',
    p_attack_skill_key: payload.attackSkillKey || 'fight',
    p_pa_cost: Number(payload.paCost ?? 1),
    p_ea_cost: Number(payload.eaCost ?? 0),
    p_uses_cursed_energy: Boolean(payload.usesCursedEnergy),
    p_forced_critical: Boolean(payload.forcedCritical),
    p_critical_threshold: Number(payload.criticalThreshold ?? 20),
    p_damage_dice_count: Number(payload.damageDiceCount ?? 1),
    p_damage_die: Number(payload.damageDie ?? 6),
    p_damage_flat_attribute_key: payload.damageFlatAttributeKey || null,
    p_condition_key: payload.conditionKey || null,
    p_roll_mode: payload.rollMode || 'normal',
    p_roll_count: Number(payload.rollCount ?? 1),
  });
  if (error) throw error;
  return data;
}

export async function resolveCombatDefense(actionId, defenseType, mode='normal', count=1) {
  const { data, error } = await supabase.rpc('resolve_combat_defense', {
    p_action_id: actionId,
    p_defense_type: defenseType,
    p_mode: mode,
    p_count: Number(count) || 1,
  });
  if (error) throw error;
  return data;
}

export async function createBasicCounterattack(actionId, useCursedEnergy=false) {
  const { data, error } = await supabase.rpc('create_basic_counterattack', {
    p_action_id: actionId,
    p_use_cursed_energy: Boolean(useCursedEnergy),
  });
  if (error) throw error;
  return data;
}

export async function useCombatEffect(payload) {
  const { data, error } = await supabase.rpc('use_combat_effect', {
    p_encounter_id: payload.encounterId,
    p_character_id: payload.characterId,
    p_target_character_id: payload.targetCharacterId,
    p_label: payload.label || 'Habilidade',
    p_source_id: payload.sourceId || null,
    p_pa_cost: Number(payload.paCost ?? 1),
    p_ea_cost: Number(payload.eaCost ?? 0),
    p_damage_dice_count: Number(payload.damageDiceCount ?? 0),
    p_damage_die: Number(payload.damageDie ?? 0),
    p_damage_flat_attribute_key: payload.damageFlatAttributeKey || null,
    p_condition_key: payload.conditionKey || null,
  });
  if (error) throw error;
  return data;
}

export async function startCombatTurn(participantId) {
  const { data, error } = await supabase.rpc('start_combat_turn', { p_participant_id: participantId });
  if (error) throw error;
  return data;
}

export async function endCombatTurn(participantId) {
  const { data, error } = await supabase.rpc('end_combat_turn', { p_participant_id: participantId });
  if (error) throw error;
  return data;
}

export async function rollCombatInitiative(participantId) {
  const { data, error } = await supabase.rpc('roll_combat_initiative', { p_participant_id: participantId });
  if (error) throw error;
  return data;
}

export async function removeCombatCondition(participantId, conditionKey) {
  const { data, error } = await supabase.rpc('remove_combat_condition', { p_participant_id: participantId, p_condition_key: conditionKey });
  if (error) throw error;
  return data;
}
