import { spawnSync } from 'node:child_process';

const checks = [
  ['check-system.mjs'], ['check-staff-v3.mjs'], ['check-ability-engine.mjs'],
  ['check-player-mechanics.mjs'], ['check-combat-visibility.mjs'],
  ['check-tactical-board.mjs'], ['check-antonio.mjs'],
  ['sync-condition-catalog.mjs','--check'], ['check-improvised-combat.mjs'], ['check-improvised-ui.mjs'],
  ['check-effect-coverage.mjs'], ['check-table-control.mjs'],
];
let failures=0;
for (const [script,...args] of checks) {
  const result=spawnSync(process.execPath,[`scripts/${script}`,...args],{stdio:'inherit'});
  if (result.error || result.status!==0) { failures++; console.error(`FALHOU: ${script}`,result.error?.message||''); }
}
console.log(`\n${checks.length-failures}/${checks.length} verificações aprovadas.`);
process.exitCode=failures?1:0;
