import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ui = read('src/lib/combat-ui.js');
const api = read('src/lib/api.js');
const system = read('src/lib/system.js');
const sql = read('supabase/migrations/202608150001_tactical_board.sql');
const css = read('src/styles.css');

const checks = [
  [system.includes("SYSTEM_VERSION = '0.8.3'"), 'versão 0.8.3'],
  [sql.includes('board_blocked_cells') && sql.includes('board_walls'), 'estado de terreno'],
  [sql.includes('board_x int') && sql.includes('board_y int'), 'posição por participante'],
  [sql.includes('move_combat_token') && sql.includes('Somente o Mestre pode mover peças'), 'movimento protegido no banco'],
  [sql.includes('protect_combat_board_position_trigger'), 'trigger anti-movimento de player'],
  [sql.includes('set_combat_board_state'), 'edição de terreno protegida'],
  [sql.includes('board_x int,') && /board_y int\s*\)/.test(sql), 'roster público com posição'],
  [api.includes('export async function moveCombatToken') && api.includes('withCombatUndo'), 'movimento ligado ao Undo'],
  [api.includes('export async function setCombatBoardState'), 'API de terreno'],
  [ui.includes('combatBoardHtml({encounter:active,tokens:targets') && ui.includes('editable:false'), 'tabuleiro read-only do player'],
  [ui.includes('combatBoardHtml({encounter:active,tokens:boardTokens') && ui.includes('editable:true'), 'tabuleiro editável do Mestre'],
  [ui.includes('data-board-wall="N"') && ui.includes('data-board-wall="E"') && ui.includes('data-board-wall="S"') && ui.includes('data-board-wall="W"'), 'paredes nas quatro direções'],
  [ui.includes('Arraste da iniciativa para o plano') && ui.includes('Retirar peça selecionada'), 'movimentação por drag/click'],
  [css.includes('.combat-board-grid') && css.includes('.combat-board-cell.is-blocked') && css.includes('.combat-board-token'), 'estilos do mapa'],
];

const failed=checks.filter(([ok])=>!ok).map(([,label])=>label);
if(failed.length){
  console.error('FALHA:', failed.join(', '));
  process.exit(1);
}
console.log('OK: tabuleiro tático, peças, paredes, quadrados bloqueados, visibilidade e proteção do Mestre validados para v0.8.3.');
