import fs from 'node:fs';
import path from 'node:path';

const file=path.resolve('data/players/antonio.json');
const spec=JSON.parse(fs.readFileSync(file,'utf8'));
const assert=(cond,msg)=>{ if(!cond) throw new Error(msg); };
const find=name=>(spec.abilities||[]).find(a=>a.name===name);
const attrs=spec.character?.attributes||{};
const skills=spec.character?.skills||{};

assert(spec.character?.first_name==='Antônio' && spec.character?.last_name==='Fagulhas','A ficha deve pertencer a Antônio Fagulhas.');
assert(Object.values(attrs).reduce((a,b)=>a+Number(b||0),0)===20,'Antonio nível 5 precisa somar 20 pontos de atributo.');
assert(Object.values(skills).reduce((a,b)=>a+Number(b||0),0)===14,'Antonio nível 5 precisa somar 14 pontos de perícia.');
assert(Number(spec.character?.growth_vigor||0)+Number(spec.character?.growth_reserve||0)===5,'Crescimento precisa somar 5.');

const brush=find('Invocar Pincel Mágico');
const stance=find('Assumir Postura de Luta');
assert(brush?.config?.special_action==='set_combat_mode' && brush.config.combat_mode_key==='magic_brush','Pincel precisa ativar o modo magic_brush.');
assert(stance?.config?.special_action==='set_combat_mode' && stance.config.combat_mode_key==='flame_monk','Postura precisa ativar o modo flame_monk.');

for(const name of ['A Linha Que Separa','Explosão Artística','Eu Pintei Eles Queimando','As Setas Indicam a Direção']) {
  const a=find(name);
  assert(a,`Falta técnica de pintura: ${name}`);
  assert(a.config?.requires_combat_mode==='magic_brush',`${name} precisa exigir Pincel Mágico.`);
}
for(const name of ['Golpe de Explosão','Chute de Ruptura','Sequência Escaldante','Ponto de Ignição','Punho da Fornalha']) {
  const a=find(name);
  assert(a,`Falta golpe da Postura de Luta: ${name}`);
  assert(a.config?.requires_combat_mode==='flame_monk',`${name} precisa exigir Postura de Luta.`);
}

assert(find('A Linha Que Separa')?.config?.overloads?.some(x=>x.key==='second_target'),'A Linha Que Separa precisa manter a Sobrecarga de segundo alvo.');
assert(find('Explosão Artística')?.config?.special_action==='place_delayed_bomb','Explosão Artística precisa criar bomba atrasada.');
assert(find('Eu Pintei Eles Queimando')?.config?.on_hit_effect?.refresh_only_if_existing===true,'A técnica de pintura em chamas precisa renovar sem reaplicar o dano inicial.');
assert(find('As Setas Indicam a Direção')?.config?.special_action==='boost_recent_attack','As Setas precisam modificar a última rolagem de ataque.');
assert(find('As Setas Indicam a Direção')?.config?.is_reaction===true,'As Setas precisam ser reação.');
assert(find('Sequência Escaldante')?.config?.prior_turn_same_target_attack_bonus===1,'Sequência Escaldante precisa reconhecer pressão no mesmo alvo.');
assert(find('Punho da Fornalha')?.config?.damage_flat_bonus===2,'Punho da Fornalha precisa manter +2 fixo no dano.');

const tecido=(spec.equipment||[]).find(x=>x.name==='Tecido de Desvio');
assert(tecido,'Tecido de Desvio precisa existir.');
assert(tecido.equip_slot==='body' && tecido.is_cursed===true && tecido.grade==='Grau 4','Tecido de Desvio precisa ser roupa amaldiçoada Grau 4 equipada no Corpo.');
assert((tecido.effects||[]).some(e=>e.config?.special_action==='reroll_recent_damage' && e.config?.once_per_combat===true),'Tecido de Desvio precisa rerrolar dano 1x/combate.');

// O pacote público não deve registrar a explicação secreta da origem do fogo.
const raw=fs.readFileSync(file,'utf8').toLowerCase();
for(const forbidden of ['demônio','demonio','infernal','possessão','possessao']) {
  assert(!raw.includes(forbidden),`O JSON público de Antonio contém informação reservada (${forbidden}).`);
}

console.log('OK: Antônio Fagulhas, Pincel Mágico, Postura de Luta, golpes, pinturas e Tecido de Desvio validados.');
