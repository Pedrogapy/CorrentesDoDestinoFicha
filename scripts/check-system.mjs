import {
  createBalancedBuild,
  validateBuild,
  characterDerived,
  attributePointBudget,
  skillPointBudget,
  growthPointBudget,
  slotBudget,
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

console.log('OK: fórmulas básicas e distribuições neutras válidas.');
