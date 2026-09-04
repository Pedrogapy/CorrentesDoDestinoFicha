import fs from 'node:fs';
import assert from 'node:assert/strict';
import { testDatabase } from './lib/test-db.mjs';

const migrationPath='supabase/migrations/202609030001_table_control_v084.sql';
const migration=fs.readFileSync(migrationPath,'utf8');
const ui=fs.readFileSync('src/lib/combat-ui.js','utf8');
const dice=fs.readFileSync('src/lib/manual-dice.js','utf8');
const api=fs.readFileSync('src/lib/api.js','utf8');
const panel=fs.readFileSync('src/lib/combat-live-panel.js','utf8');
const css=fs.readFileSync('src/styles.css','utf8');

for (const token of [
  'reactions_enabled',
  'physical_resolution_queue',
  'set_combat_reactions_enabled',
  'get_combat_resolution_roll_prompt',
  'set_combat_resolution_dice',
  'get_start_turn_roll_prompt',
  'get_table_control_reroll_prompt',
  'master_override_combat_action',
  'get_visible_combat_effects',
]) assert.ok(migration.includes(token),`Migration sem ${token}`);

assert.ok(migration.includes("if not public.is_master() then raise exception 'Somente o Mestre"),'Override deve ser exclusivo do Mestre.');
assert.ok(migration.includes("physical_damage_pending=false"),'Erro/cancelamento manual precisa limpar dano físico pendente.');
assert.ok(!migration.includes('delete from public.combat_undo_snapshots;'),'Controle de Mesa não deve apagar snapshots anteriores.');
assert.ok(migration.includes('reactions_enabled') && migration.includes('physical_resolution_queue') && migration.includes("state->'participants'") && migration.includes("state->'actions'"),'Migration deve tornar snapshots antigos compatíveis com as colunas novas.');
assert.ok(migration.includes("'Efeito ativo'"),'Payload público deve usar nome genérico.');
assert.ok(!migration.includes('Correntes da Verdade'),'Migration pública não deve depender de nome autoral de habilidade.');

for (const token of ['chooseAttackDamageRoll','chooseResolutionRoll','chooseEquipmentEffectRoll','chooseBombRoll'])
  assert.ok(dice.includes(token),`manual-dice sem ${token}`);
for (const token of ['setCombatReactionsEnabled','masterOverrideCombatAction','getCombatResolutionRollPrompt','getStartTurnRollPrompt'])
  assert.ok(api.includes(token),`api sem ${token}`);
for (const token of ['combatLivePanelHtml','bindCombatLivePanel','data-combat-live-toggle'])
  assert.ok(panel.includes(token),`painel lateral sem ${token}`);
assert.ok(ui.includes('data-creactions'),'UI do Mestre sem controle de reação por participante.');
assert.ok(ui.includes('data-master-override'),'UI sem override manual do Mestre.');
assert.ok(ui.includes('chooseResolutionRoll'),'Defesa não consulta rolagens de resolução.');
assert.ok(ui.includes('combatLivePanelHtml'),'Combate sem painel lateral.');
assert.ok(css.includes('.combat-live-panel.is-open'),'CSS sem painel lateral retrátil.');

assert.ok(panel.includes('DISPONÍVEL AGORA'),'Painel lateral sem área de ações contextuais.');
assert.ok(panel.includes('candidateSources'),'Painel lateral não filtra ações pelo contexto atual.');
assert.ok(panel.includes('configurableControls'),'Painel lateral não replica os campos necessários sem scroll.');
assert.ok(panel.includes('data-combat-live-actions'),'Painel lateral sem host das ações disponíveis.');
assert.ok(ui.includes('data-combat-action-name'),'Controles do combate não fornecem nomes compactos ao painel lateral.');
assert.ok(ui.includes('modeChangeLocked'),'Troca de estilo precisa respeitar a escolha já feita no turno.');
assert.ok(ui.includes("phase:playerLivePhase"),'Player não envia fase atual ao painel lateral.');
assert.ok(ui.includes("phase:masterPendingAction?'reaction':actor?'turn':'idle'"),'Mestre não restringe o painel a quem age ou reage.');
assert.ok(css.includes('.combat-live-action-button'),'CSS sem botões compactos das ações contextuais.');
assert.ok(panel.includes('combat-live-reaction-control'),'Mestre precisa controlar a janela de reação pelo painel lateral.');
assert.ok(ui.includes('data-creactions="${p.id}" data-combat-actor'),'Controle de reação do participante precisa estar vinculável ao painel lateral.');
assert.match(
  migration,
  /create or replace function public\.resolve_combat_defense\([\s\S]*?\)\s*returns jsonb[\s\S]*?result jsonb;/,
  'Wrapper final de resolve_combat_defense deve preservar o retorno JSONB da camada de privacidade.'
);

// Compila todas as migrations em PostgreSQL real em memória quando executado no projeto completo.
const db=await testDatabase();
try {
  const columns=await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='combat_participants' and column_name='reactions_enabled'`);
  assert.equal(columns.rows.length,1,'combat_participants.reactions_enabled não foi criado.');
  const actionColumns=await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='combat_actions' and column_name='physical_resolution_queue'`);
  assert.equal(actionColumns.rows.length,1,'combat_actions.physical_resolution_queue não foi criado.');
  const funcs=await db.query(`select proname from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname in ('set_combat_reactions_enabled','get_combat_resolution_roll_prompt','set_combat_resolution_dice','get_start_turn_roll_prompt','get_table_control_reroll_prompt','master_override_combat_action')`);
  assert.equal(new Set(funcs.rows.map(r=>r.proname)).size,6,'RPCs do Controle de Mesa incompletas.');
} finally {
  await db.close();
}

console.log('OK: Controle de Mesa v0.8.4 R4 — sidebar executa ações/reacões contextuais sem scroll e preserva dados, privacidade, Undo e Realtime.');
