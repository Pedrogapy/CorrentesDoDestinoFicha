import fs from 'node:fs';
import path from 'node:path';

const file=path.resolve('data/players/antonio.json');
const spec=JSON.parse(fs.readFileSync(file,'utf8'));
const assert=(cond,msg)=>{ if(!cond) throw new Error(msg); };
const find=name=>(spec.abilities||[]).find(a=>a.name===name);
const attrs=spec.character?.attributes||{};
const skills=spec.character?.skills||{};

assert(spec.character?.first_name==='Antônio' && spec.character?.last_name==='Fagulhas','A ficha deve pertencer a Antônio Fagulhas.');
assert(Object.values(attrs).reduce((a,b)=>a+Number(b||0),0)===20,'Antônio nível 5 precisa somar 20 pontos de atributo.');
assert(Object.values(skills).reduce((a,b)=>a+Number(b||0),0)===14,'Antônio nível 5 precisa somar 14 pontos de perícia.');
assert(Number(spec.character?.growth_vigor||0)+Number(spec.character?.growth_reserve||0)===5,'Crescimento precisa somar 5.');

const brush=find('Invocar Pincel Mágico');
const stance=find('Assumir Postura de Luta');
assert(brush?.config?.special_action==='set_combat_mode' && brush.config.combat_mode_key==='magic_brush','Pincel precisa ativar magic_brush.');
assert(stance?.config?.special_action==='set_combat_mode' && stance.config.combat_mode_key==='flame_monk','Postura precisa ativar flame_monk.');
assert(brush?.config?.target_mode==='self' && stance?.config?.target_mode==='self','Mudança de estilo não pode pedir alvo.');

for(const name of ['A Linha Que Separa','Explosão Artística','Eu Pintei Eles Queimando','As Setas Indicam a Direção']) {
  const a=find(name); assert(a,`Falta técnica de pintura: ${name}`); assert(a.config?.requires_combat_mode==='magic_brush',`${name} precisa exigir Pincel.`);
}
for(const name of ['Golpe de Explosão','Chute de Ruptura','Sequência Escaldante','Ponto de Ignição','Punho da Fornalha']) {
  const a=find(name); assert(a,`Falta golpe: ${name}`); assert(a.config?.requires_combat_mode==='flame_monk',`${name} precisa exigir Postura.`); assert(a.config?.target_relation==='other',`${name} deve mirar qualquer outro participante válido.`);
}

const linha=find('A Linha Que Separa');
const overload=linha?.config?.overloads?.find(x=>x.key==='second_target');
assert(overload,'A Linha precisa manter a Sobrecarga de segundo alvo.');
assert(overload.overrides?.requires_secondary_target===true,'Sobrecarga precisa exigir um segundo alvo real.');
assert(overload.overrides?.secondary_target_relation==='other','Segundo alvo precisa ser qualquer outro participante válido.');
assert(Number(overload.overrides?.secondary_target_die_factor)===0.5,'Somente os dados do segundo alvo devem ser reduzidos à metade.');
assert(Number(overload.overrides?.secondary_target_flat_factor)===1,'O modificador do segundo alvo deve permanecer inteiro.');
assert(find('Explosão Artística')?.config?.special_action==='place_delayed_bomb','Explosão Artística precisa criar bomba atrasada.');
assert(find('Explosão Artística')?.config?.target_mode==='multiple','Explosão Artística precisa permitir seleção múltipla.');
assert(find('Eu Pintei Eles Queimando')?.config?.on_hit_effect?.refresh_only_if_existing===true,'Pintura em chamas precisa renovar sem reaplicar dano inicial.');
assert(find('As Setas Indicam a Direção')?.config?.special_action==='boost_recent_attack' && find('As Setas Indicam a Direção')?.config?.is_reaction===true,'Setas precisam corrigir ataque recente como reação.');
assert(find('As Setas Indicam a Direção')?.config?.recent_action_actor_relation==='ally_or_self','Setas só podem apoiar Antônio ou um aliado.');
assert(find('Sequência Escaldante')?.config?.prior_turn_same_target_attack_bonus===1,'Sequência precisa reconhecer pressão no mesmo alvo.');
assert(find('Punho da Fornalha')?.config?.damage_flat_bonus===2,'Punho da Fornalha precisa manter +2 fixo.');

const tecido=(spec.equipment||[]).find(x=>x.name==='Tecido de Desvio');
assert(tecido?.equip_slot==='body' && tecido?.is_cursed===true && tecido?.grade==='Grau 4','Tecido de Desvio precisa ser Grau 4 no Corpo.');
assert((tecido.effects||[]).some(e=>e.config?.special_action==='reroll_recent_damage' && e.config?.once_per_combat===true),'Tecido precisa rerrolar dano 1x/combate.');

// O pacote público não registra a explicação que o personagem/player desconhecem.
const raw=fs.readFileSync(file,'utf8').toLowerCase();
for(const forbidden of ['demônio','demonio','infernal','possessão','possessao']) assert(!raw.includes(forbidden),`JSON público contém informação reservada (${forbidden}).`);

console.log('OK: Antônio, segundo alvo real, Pincel, Postura, golpes, pinturas e Tecido de Desvio validados.');
