import {
  createBalancedBuild,
  validateBuild,
  characterDerived,
  attributePointBudget,
  skillPointBudget,
  growthPointBudget,
  slotBudget,
  equipmentVpBudget,
  equipmentEffectsVp,
  WEAPON_PROFILES,
  weaponAttackConfig,
} from '../src/lib/system.js';

for (const level of [1,5,25,50,75,100]) {
  const build = createBalancedBuild(level);
  const character = {
    level,
    ...build,
    permanent_ps_bonus: 0,
    permanent_ea_bonus: 0,
  };
  const validation = validateBuild(character);
  if (!validation.valid) {
    console.error(`Build inválida no nível ${level}:`, validation.errors);
    process.exit(1);
  }
  const attrSum = Object.values(build.attributes).reduce((a,b)=>a+b,0);
  const skillSum = Object.values(build.skills).reduce((a,b)=>a+b,0);
  const growthSum = build.growth_vigor + build.growth_reserve;
  if (attrSum !== attributePointBudget(level)) throw new Error(`Atributos incorretos no nível ${level}`);
  if (skillSum !== skillPointBudget(level)) throw new Error(`Perícias incorretas no nível ${level}`);
  if (growthSum !== growthPointBudget(level)) throw new Error(`Crescimento incorreto no nível ${level}`);
  console.log(`Nível ${level}:`, characterDerived(character), slotBudget(level));
}

const expectedEquipmentVp = { 'Sem Grau':0, 'Grau 4':2, 'Grau 3':4, 'Grau 2':6, 'Grau 1':9, 'Grau Especial':12 };
for (const [grade,expected] of Object.entries(expectedEquipmentVp)) {
  if (equipmentVpBudget(grade,true)!==expected) throw new Error(`VP de equipamento incorreto para ${grade}`);
}
if (equipmentEffectsVp([{vp:1},{vp:3}])!==4) throw new Error('Soma de VP de efeitos incorreta');
const profileChecks={ light:[6,1], standard:[8,1], heavy:[10,1], very_heavy:[12,2] };
for (const [profile,[die,pa]] of Object.entries(profileChecks)) {
  const c=weaponAttackConfig({profile});
  if (c.damage_die!==die || c.pa_cost!==pa || c.damage_dice_count!==1) throw new Error(`Perfil de arma incorreto: ${profile}`);
  if (!WEAPON_PROFILES[profile]) throw new Error(`Perfil ausente: ${profile}`);
}

console.log('OK: fórmulas básicas, equipamentos e distribuições neutras válidas.');
