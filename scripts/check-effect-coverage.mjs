import fs from 'node:fs';
import assert from 'node:assert/strict';

const catalog=JSON.parse(fs.readFileSync('data/system/conditions.json','utf8'));
const keys=new Set(catalog.map(c=>c.key));
// Mapa de auditoria local: nunca é importado pelo cliente ou publicado como catálogo.
const mechanicalStates={
  attack_bonus:'attack_bonus',conditional_attack_bonus:'attack_bonus',physical_attack_bonus:'attack_bonus',
  ca_bonus:'protected',damage_reduction_dice_count:'damage_reduction',damage_reduction_die:'damage_reduction',damage_reduction_flat:'damage_reduction',
  bonus_damage_dice_count:'strengthened',bonus_damage_die:'strengthened',pa_penalty_next_turn:'slowed',
  blocks_actions:'incapacitated',blocks_reactions:'no_reaction',blocks_movement:'no_movement',blocks_cursed_abilities:'suppression',
  immune_to_damage:'protected',immune_to_external_changes:'stasis',ea_discount:'empowered',skill_modifiers:'weakened',
  source_resource_gain_on_hit:'empowered',source_resource_gain_on_hit_key:'empowered',source_resource_gain_on_hit_self_bonus:'empowered',
  damage_reflect_percent:'reflection',spatial_infinity:'barrier',royal_refusal:'protected',
  start_turn_damage_dice_count:'ongoing_damage',start_turn_damage_die:'ongoing_damage',extinguish_pa_cost:'burning',
  narrative_push:'unbalanced',silenced:'silenced',
};
const parameters=new Set(['allowed_attack_skill','allowed_attack_attribute','allowed_ability_tag','allowed_source_types','exclude_source_types','applies_to',
  'decrement_on','expires_on_source_turn_start','remove_on_target_turn_start','remove_when_empty','reset_uses']);
let effects=0, files=0;
function inspect(value) {
  if (!value||typeof value!=='object') return;
  for (const [key,item] of Object.entries(value)) {
    if(key==='condition_key' && item) assert.ok(keys.has(item),`Condição sem cobertura genérica: ${item}`);
    if(['combat_effect','on_hit_effect'].includes(key) && item && typeof item==='object') {
      effects++;
      if(item.type==='burn') assert.ok(keys.has('burning'));
      for(const data of [item.data,item.on_fail_data]) for(const field of Object.keys(data||{})) {
        assert.ok(parameters.has(field)||keys.has(mechanicalStates[field]),`Efeito mecânico sem estado genérico: ${field}`);
      }
    }
    inspect(item);
  }
}
for(const dir of ['data/players','data/npcs','data/curses','correntes-staff-v2','correntes-staff-v3']) {
  for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.json'))) {
    inspect(JSON.parse(fs.readFileSync(`${dir}/${file}`,'utf8')));files++;
  }
}
console.log(`OK: ${effects} efeitos estruturados em ${files} arquivos de PCs/NPCs cobertos por estados genéricos, sem publicar nomes de habilidades.`);
