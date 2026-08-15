import fs from 'node:fs';
import path from 'node:path';

const base=path.resolve('data/players');
const load=n=>JSON.parse(fs.readFileSync(path.join(base,n),'utf8'));
const find=(rows,name)=>rows.find(x=>x.name===name);
const assert=(cond,msg)=>{if(!cond) throw new Error(msg);};
const sum=o=>Object.values(o||{}).reduce((a,b)=>a+Number(b||0),0);

for(const file of ['aiko.json','kotone.json','jin.json']){
  const s=load(file);
  assert(sum(s.character?.attributes)===20,`${file}: atributos precisam somar 20.`);
  assert(sum(s.character?.skills)===14,`${file}: perícias precisam somar 14.`);
  assert(Number(s.character?.growth_vigor||0)+Number(s.character?.growth_reserve||0)===5,`${file}: Crescimento precisa somar 5.`);
}

// AIKO ----------------------------------------------------------------------
const aiko=load('aiko.json');
const escudo=find(aiko.abilities,'Escudo Temporal');
const regen=find(aiko.abilities,'Regeneração Temporal');
const ataque=find(aiko.abilities,'Ataque Temporal');
const interrupcao=find(aiko.abilities,'Interrupção Temporal');
assert(escudo && regen && ataque && interrupcao,'Aiko precisa manter as quatro habilidades temporais separadas.');
assert(escudo.config?.is_reaction===true && escudo.config?.target_relation==='ally_or_self','Escudo Temporal precisa ser reação para si/aliado.');
assert(escudo.config?.combat_effect?.data?.damage_reduction_dice_count===1 && escudo.config?.combat_effect?.data?.damage_reduction_die===6,'Escudo Temporal precisa reduzir 1d6.');
assert(escudo.config?.combat_effect?.damage_reduction_flat_attribute_key==='cursed_control','Escudo Temporal precisa somar Mod. Controle Amaldiçoado à redução.');
assert(escudo.config?.overloads?.find(o=>o.key==='second_impact')?.overrides?.effect_charges===2,'Sobrecarga do Escudo precisa proteger dois impactos.');
assert(regen.config?.target_relation==='ally_or_self' && regen.config?.healing_dice_count===1 && regen.config?.healing_die===6,'Regeneração base precisa curar 1d6 em si/aliado.');
assert(regen.config?.overloads?.find(o=>o.key==='intensive')?.overrides?.healing_dice_count===2,'Regeneração intensiva precisa curar 2d6.');
assert(ataque.config?.target_relation==='other' && ataque.config?.requires_attack===true,'Ataque Temporal precisa ser ofensivo e aceitar qualquer outro alvo válido.');
const enemyMode=interrupcao.config?.modes?.find(m=>m.key==='enemy');
const allyMode=interrupcao.config?.modes?.find(m=>m.key==='ally');
assert(enemyMode?.contest && enemyMode?.once_per_combat_per_target===true,'Interrupção contra inimigo precisa usar teste resistido e limite por alvo.');
assert(enemyMode?.combat_effect?.data?.pa_penalty_next_turn===1,'Interrupção inimiga precisa retirar 1 PA no próximo turno em falha.');
assert(enemyMode?.contest_resisted_effect?.data?.movement_factor===0.5,'Resistir à Interrupção precisa manter desaceleração parcial.');
assert(allyMode?.is_reaction===true && allyMode?.target_relation==='ally_or_self','Suspensão de aliado precisa ser reação para aliado/próprio.');
assert(allyMode?.combat_effect?.data?.immune_to_damage===true && allyMode?.combat_effect?.data?.immune_to_external_changes===true,'Suspensão de aliado precisa congelar alterações externas.');
const costura=(aiko.equipment||[]).find(x=>x.name==='Costura do Acaso');
assert(costura?.effects?.some(e=>e.config?.special_action==='reroll_recent_natural_one' && e.config?.once_per_round===true),'Costura do Acaso precisa rerrolar o 1 natural próprio mais recente, 1x/rodada.');

// KOTONE --------------------------------------------------------------------
const kotone=load('kotone.json');
const orfeu=(kotone.summons||[]).find(x=>x.name==='Orfeu');
const invocar=find(kotone.abilities,'Invocar Orfeu');
assert(orfeu,'Orfeu precisa existir como ficha filha.');
assert(['Agi','Dia','Pancada','Tarukaja'].every(n=>find(orfeu.abilities,n)), 'As quatro técnicas de Orfeu precisam morar na ficha filha.');
assert(invocar?.config?.special_action==='activate_summon' && invocar?.config?.target_mode==='self','Invocar Orfeu precisa ativar a ficha filha sem escolher alvo.');
assert(find(orfeu.abilities,'Agi')?.config?.target_relation==='other','Agi precisa poder mirar qualquer outro participante liberado pelo Mestre.');
assert(find(orfeu.abilities,'Dia')?.config?.target_relation==='ally_or_self','Dia precisa permitir Kotone ou aliado.');
const taru=find(orfeu.abilities,'Tarukaja');
assert(taru?.config?.combat_effect?.data?.bonus_damage_die===4 && taru?.config?.combat_effect?.data?.reset_uses===1,'Tarukaja precisa dar +1d4 no primeiro acerto de cada turno durante o buff.');
const guarda=find(kotone.abilities,'Guarda de Alcance I');
assert(guarda?.config?.is_reaction===true && guarda?.config?.usage_scope==='source','Guarda de Alcance precisa ser uma reação com uso compartilhado.');
assert(['reflex','fight','counter'].every(k=>guarda.config?.modes?.some(m=>m.key===k)),'Guarda precisa preservar os três usos possíveis do treino.');
assert(find(kotone.abilities,'Teoria de Manifestação I')?.config?.combat_usable===false,'Teoria de Manifestação precisa permanecer fora da automação de combate.');
const veu=(kotone.equipment||[]).find(x=>x.name==='Véu da Fortuna');
assert(veu?.effects?.some(e=>e.config?.special_action==='reroll_recent_attack_against_self' && e.config?.once_per_combat===true),'Véu da Fortuna precisa forçar nova rolagem de acerto 1x/combate.');

// JIN -----------------------------------------------------------------------
const jin=load('jin.json');
const clot=(jin.character?.special_resources||[]).find(r=>r.key==='blood_clot');
assert(clot?.max===3 && clot?.start_combat===3,'Jin precisa iniciar combate com 3/3 Coágulos.');
assert(clot?.recharge?.pa_cost===1 && clot?.recharge?.self_damage_die===4,'Recarga de Coágulo precisa custar 1 PA + 1d4 PS.');
const perf=find(jin.abilities,'Sangue Perfurante');
const expl=find(jin.abilities,'Sangue Explosivo');
assert(perf?.config?.resource_cost?.amount===1 && perf.config.ea_cost===4 && perf.config.damage_die===6 && perf.config.damage_flat_bonus===2,'Sangue Perfurante precisa manter 1 Coágulo, 4 EA e 1d6+2+mod.');
assert(expl?.config?.resource_cost?.amount===1 && expl.config.ea_cost===7 && expl.config.damage_die===8,'Sangue Explosivo precisa manter 1 Coágulo, 7 EA e 1d8+mod.');
const arm=find(jin.abilities,'Armamento de Sangue');
const fluxo=find(jin.abilities,'Fluxo das Escamas Vermelhas');
assert(arm?.config?.special_action==='create_weapon' && arm?.config?.target_mode==='self','Armamento de Sangue precisa criar equipamento temporário sem seletor de alvo.');
assert(JSON.stringify(arm?.config?.weapon_attack_skill_best_of)==='["channeling","fight"]','A arma de sangue precisa usar o melhor entre Canalização e Lutar.');
assert(JSON.stringify(arm?.config?.weapon_damage_attribute_best_of)==='["cursed_control","dexterity","strength"]','A arma de sangue precisa usar o melhor modificador entre Controle, Destreza e Força.');
assert(fluxo?.config?.target_mode==='self' && fluxo?.config?.once_per_combat===true,'Fluxo das Escamas precisa ser próprio e 1x/combate.');
assert(fluxo?.config?.combat_effect?.data?.ca_bonus===1 && fluxo?.config?.combat_effect?.data?.physical_attack_bonus===2,'Fluxo precisa conceder +1 CA e +2 ataques físicos.');
assert(fluxo?.config?.combat_effect?.data?.skill_modifiers?.reflexes===2 && fluxo?.config?.combat_effect?.data?.skill_modifiers?.defend===2 && fluxo?.config?.combat_effect?.data?.skill_modifiers?.fortitude===2,'Fluxo precisa fortalecer reações físicas em +2.');
assert((jin.equipment||[]).some(x=>x.name==='Uniforme Okkotsu'),'Uniforme Okkotsu precisa estar no pacote do Jin.');
assert(jin.cursed_body?.name==='Circuito Hemático' && jin.cursed_body?.is_released===false && jin.cursed_body?.seed_only===true,'Circuito Hemático precisa existir oculto, preservando decisões futuras do Mestre.');

console.log('OK: Aiko, Kotone e Jin preservam suas mecânicas canônicas dentro do motor estruturado v0.8.2.');
