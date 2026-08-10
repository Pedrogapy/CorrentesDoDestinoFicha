import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM_VERSION } from '../src/lib/system.js';

const assert=(cond,msg)=>{if(!cond) throw new Error(msg);};
const read=p=>fs.readFileSync(path.resolve(p),'utf8');
const combat=read('src/lib/combat-ui.js');
const main=read('src/main.js');
const css=read('src/styles.css');
const migration=read('supabase/migrations/202608100004_ability_engine_v08.sql');

assert(SYSTEM_VERSION==='0.8.0','SYSTEM_VERSION precisa ser 0.8.0.');

// O bug da captura: a UI precisa nascer com o campo e também ligar seus eventos
// depois que o HTML do combate é inserido no DOM, em player e Mestre.
assert(combat.includes('data-secondary-wrap="${key}"'),'O controle estruturado de segundo alvo não existe.');
assert(combat.includes('function bindStructuredAbilityControls(root)'),'Falta o binder de controles estruturados.');
const bindCalls=(combat.match(/bindStructuredAbilityControls\(root\);/g)||[]).length;
assert(bindCalls>=2,'O binder de Sobrecarga precisa ser executado nos combates de player e Mestre.');
assert(combat.includes("options.secondary_target_id=secondary.value"),'O segundo alvo não está sendo enviado ao RPC.');
assert(combat.includes("o.disabled=Boolean(primary.value && o.value===primary.value)"),'O segundo alvo precisa impedir repetir o alvo principal.');

// Criação de habilidades: deve existir configuração mecânica estruturada, não só textarea.
for(const field of ['targetRelation','usesContest','healingDiceCount','resourceKey','effectKind','effectTiming','hasOverload','overloadSecondTarget','overloadSecondDieFactor','overloadSecondFlatFactor']) {
  assert(combat.includes(`name="${field}"`),`Construtor não possui o campo estruturado ${field}.`);
}
assert(main.includes('abilityConfigFromForm'),'main.js precisa serializar o motor estruturado.');
assert(main.includes('ability-builder-note'),'A UI precisa explicar a diferença entre texto e automação.');
assert(css.includes('.advanced-builder') && css.includes('.ability-secondary-target') && css.includes('.ability-structured-summary'),'Estilos do construtor v0.8 ausentes.');

// Servidor: relação de alvo e cálculo separado de dados/modificador.
for(const sqlToken of [
  'side_key text not null default \'neutral\'',
  'combat_target_relation_allowed',
  'assert_combat_target_relation',
  'damage_dice_factor numeric not null default 1',
  'damage_flat_factor numeric not null default 1',
  'secondary_target_die_factor',
  'secondary_target_flat_factor',
  "special='reroll_recent_damage'",
  "special='reroll_recent_attack_against_self'",
  "special='reroll_recent_natural_one'",
]) assert(migration.includes(sqlToken),`Migration v0.8 não contém: ${sqlToken}`);

// A Linha usa metade somente dos dados no segundo alvo e mantém o modificador.
const antonio=JSON.parse(read('data/players/antonio.json'));
const linha=antonio.abilities.find(a=>a.name==='A Linha Que Separa');
const over=linha?.config?.overloads?.find(o=>o.key==='second_target');
assert(over?.overrides?.requires_secondary_target===true,'A Linha precisa exigir segundo alvo na Sobrecarga.');
assert(Number(over?.overrides?.secondary_target_die_factor)===0.5,'Segundo alvo de A Linha precisa receber metade dos dados.');
assert(Number(over?.overrides?.secondary_target_flat_factor)===1,'Segundo alvo de A Linha precisa manter o modificador inteiro.');
assert(over?.overrides?.secondary_target_relation==='enemy','Segundo alvo de A Linha precisa ser inimigo.');
const arrows=antonio.abilities.find(a=>a.name==='As Setas Indicam a Direção');
assert(arrows?.config?.recent_action_actor_relation==='ally_or_self','As Setas só podem corrigir ataque de Antônio ou aliado.');
assert(migration.includes('recent_action_actor_relation'),'O servidor precisa validar a origem da ação recente apoiada.');

// O pacote público do Antônio jamais deve carregar a explicação reservada da origem do fogo.
const publicAntonio=(read('data/players/antonio.json')+combat+main).toLowerCase();
for(const forbidden of ['demônio','demonio','possessão','possessao']) {
  assert(!publicAntonio.includes(forbidden),`Conteúdo público contém segredo do Antônio: ${forbidden}`);
}

// Sanidade estrutural da migration. Não substitui executar db push no PostgreSQL.
assert((migration.match(/\$\$/g)||[]).length%2===0,'Migration possui bloco $$ não fechado.');
assert(!migration.includes('characters(*)'),'Migration não deve reintroduzir embed ambíguo de characters.');

console.log('OK: motor v0.8, segundo alvo, relações de alvo, construtor estruturado, rerrolagens e segurança pública validados.');
