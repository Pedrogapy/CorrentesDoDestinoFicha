import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM_VERSION, TARGET_RELATIONS } from '../src/lib/system.js';
import { fileURLToPath } from 'node:url';

function assert(condition,message){ if(!condition){ console.error(`ERRO: ${message}`); process.exit(1); } }
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const combat=fs.readFileSync(path.join(root,'src/lib/combat-ui.js'),'utf8');
const api=fs.readFileSync(path.join(root,'src/lib/api.js'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/202608100005_combat_visibility_targeting.sql'),'utf8');

assert(SYSTEM_VERSION==='0.8.3','SYSTEM_VERSION precisa ser 0.8.3.');
assert(TARGET_RELATIONS.some(x=>x.key==='other'),'O sistema precisa da relaÃ§Ã£o "Qualquer outro participante".');
assert(combat.includes('data-combat-search'), 'Seletor de participantes precisa possuir pesquisa por nome.');
assert(combat.includes('createEncounterWithParticipants'), 'Tela do Mestre precisa iniciar combate com participantes selecionados.');
assert(combat.includes('addCombatParticipants'), 'Tela do Mestre precisa adicionar participantes durante o combate.');
assert(combat.includes('visible_to_players'), 'UI precisa controlar visibilidade para jogadores.');
assert(combat.includes('targetable_by_players'), 'UI precisa controlar se uma ficha Ã© alvo vÃ¡lido.');
assert(combat.includes('playerInitiativeHtml') && combat.includes('Nenhuma entidade visível na iniciativa.'), 'Jogador precisa ver iniciativa apenas das entidades reveladas.');
assert(combat.includes('t.selectable!==false'), 'Seletores estruturados precisam respeitar alvo liberado pelo Mestre.');
assert(api.includes('create_combat_encounter_with_participants'), 'API precisa usar criaÃ§Ã£o transacional do encontro.');
assert(api.includes('addCombatParticipants'), 'API precisa suportar adiÃ§Ã£o em lote no meio do combate.');
for(const token of [
  'visible_to_players boolean not null default true',
  'targetable_by_players boolean not null default true',
  'create_combat_encounter_with_participants',
  'combat_target_relation_allowed',
  "if rel='other' then return not own_target",
  'touch_combat_encounter_from_participant',
  'Entidade oculta',
  'create_combat_attack_v080_core',
]) assert(sql.includes(token),`Migration v0.8.1 nÃ£o contÃ©m: ${token}`);

console.log('OK: seleção inicial, pesquisa, entrada no meio do combate, iniciativa visível e trava de alvos validadas para v0.8.3.');

