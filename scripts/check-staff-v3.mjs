import assert from 'node:assert/strict';
import fs from 'node:fs';

const staff = JSON.parse(fs.readFileSync(new URL('../correntes-staff-v3/staff.json', import.meta.url), 'utf8'));
const migration = fs.readFileSync(new URL('../supabase/migrations/202608290001_staff_v3_mechanics_v085.sql', import.meta.url), 'utf8');

assert.equal(staff.package, 'STAFF_V3');
assert.equal(staff.npcs.length, 6);

const expected = {
  'Aventurine Tsukihara': { level: 76, ps: 258, ea: 284, pa: 6, ca: 24 },
  'Akane Kurogami': { level: 48, ps: 168, ea: 194, pa: 4, ca: 20 },
  'Haruki Kisaragi': { level: 22, ps: 88, ea: 100, pa: 3, ca: 15 },
  'Kiyomi Fushizato': { level: 34, ps: 122, ea: 144, pa: 4, ca: 16 },
  'Marcão': { level: 30, ps: 134, ea: 106, pa: 4, ca: 19 },
  'Kento Nanami': { level: 52, ps: 210, ea: 176, pa: 5, ca: 22 },
};

const mod = (value) => Math.floor(Number(value || 0) / 2);
for (const npc of staff.npcs) {
  const c = npc.character;
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  const attrBudget = 15 + c.level;
  const skillBudget = 9 + c.level;
  const attrCap = Math.min(20, 5 + Math.floor((c.level - 1) / 6));
  const skillCap = Math.min(10, 3 + Math.floor((c.level - 1) / 12));
  assert.equal(Object.values(c.attributes).reduce((a, b) => a + b, 0), attrBudget, `${name}: orçamento de atributos`);
  assert.equal(Object.values(c.skills).reduce((a, b) => a + b, 0), skillBudget, `${name}: orçamento de perícias`);
  assert.ok(Math.max(...Object.values(c.attributes)) <= attrCap, `${name}: teto de atributo`);
  assert.ok(Math.max(...Object.values(c.skills)) <= skillCap, `${name}: teto de perícia`);
  assert.equal(c.growth_vigor + c.growth_reserve, c.level, `${name}: crescimento`);
  const actual = {
    level: c.level,
    ps: 18 + 2 * c.level + 2 * c.attributes.resistance + 2 * c.growth_vigor,
    ea: 18 + 2 * c.level + 2 * c.attributes.cursed_control + 2 * c.growth_reserve,
    pa: c.level >= 100 ? 7 : c.level >= 75 ? 6 : c.level >= 50 ? 5 : c.level >= 25 ? 4 : 3,
    ca: Math.max(10 + mod(c.attributes.dexterity) + Number(c.skills.reflexes || 0), 10 + mod(c.attributes.resistance) + Number(c.skills.defend || 0), 10 + mod(c.attributes.resistance) + Number(c.skills.fortitude || 0), 10 + mod(c.attributes.cursed_control) + Number(c.skills.reinforcement || 0)),
  };
  assert.deepEqual(actual, expected[name], `${name}: valores derivados`);
  assert.equal(npc.replace_all_abilities, true, `${name}: substituição de habilidades`);
}

const aventurine = staff.npcs.find((npc) => npc.character.first_name === 'Aventurine');
assert.equal(aventurine.equipment.length, 0, 'Acessórios não podem conceder poder a Aventurine.');
assert.equal(aventurine.character.special_resources[0].key, 'blind_bet');
assert.ok(aventurine.abilities.find((a) => a.name === 'Aposta Fortificada').config.combat_effect.data.source_resource_gain_on_hit_key === 'blind_bet');

const kiyomi = staff.npcs.find((npc) => npc.character.first_name === 'Kiyomi');
assert.equal(kiyomi.abilities.find((a) => a.name === 'Selo de Retaliação').config.combat_effect.data.damage_reflect_percent, 50);

const haruki = staff.npcs.find((npc) => npc.character.first_name === 'Haruki');
assert.ok(!haruki.character.technique_name.toLowerCase().includes('inata'));
assert.equal(haruki.abilities.find((a) => a.name === 'Selo de Supressão').config.combat_effect.data.blocks_cursed_abilities, true);

const nanami = staff.npcs.find((npc) => npc.character.first_name === 'Kento');
const ratio = nanami.abilities.find((a) => a.name === 'Golpe de Proporção 7:3');
assert.equal(ratio.config.critical_threshold, 18);
assert.equal(ratio.config.forced_critical, false);
assert.ok(nanami.equipment[0].attack_config.enabled, 'Nanami precisa preservar os dados físicos da arma.');

for (const fragment of ['resolve_combat_hit_staff_v3_core', 'source_resource_gain_on_hit_key', 'damage_reflect_percent', 'result.damage_total']) assert.ok(migration.includes(fragment), `Migration sem ${fragment}`);
assert.ok(migration.indexOf('result := public.resolve_combat_hit_staff_v3_core(p_action_id,p_half)') < migration.lastIndexOf("s.data->>'damage_reflect_percent'"), 'O núcleo físico/Staff V2 deve rodar antes do V3.');

console.log('Staff V3: dados, orçamentos, valores derivados e mecânicas validados.');
