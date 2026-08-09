function randomInt(max) {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] % max) + 1;
}

export function rollDie(sides = 20) {
  return randomInt(Number(sides));
}

export function rollDice(count = 1, sides = 20) {
  return Array.from({ length: Number(count) }, () => rollDie(sides));
}

export function rollD20({ disadvantageDice = 1, bonus = 0 } = {}) {
  const count = Math.max(1, Number(disadvantageDice) || 1);
  const rolls = rollDice(count, 20);
  const natural = count === 1 ? rolls[0] : Math.min(...rolls);
  return {
    rolls,
    natural,
    bonus: Number(bonus) || 0,
    total: natural + (Number(bonus) || 0),
    naturalCritical: natural === 20,
    naturalFailure: natural === 1,
    kokusenEligible: natural === 20,
  };
}

export function rollDamage(count, sides, flat = 0, critical = false) {
  const diceCount = critical ? Number(count) * 2 : Number(count);
  const rolls = rollDice(diceCount, sides);
  const rolled = rolls.reduce((sum, value) => sum + value, 0);
  return {
    rolls,
    flat: Number(flat) || 0,
    total: rolled + (Number(flat) || 0),
    critical,
  };
}
