import fs from 'node:fs';
import assert from 'node:assert/strict';

const main=fs.readFileSync('src/main.js','utf8');
const combat=fs.readFileSync('src/lib/combat-ui.js','utf8');
const panel=fs.readFileSync('src/lib/combat-live-panel.js','utf8');
const api=fs.readFileSync('src/lib/api.js','utf8');
const system=fs.readFileSync('src/lib/system.js','utf8');
const css=fs.readFileSync('src/styles.css','utf8');
const workflow=fs.readFileSync('.github/workflows/deploy-pages.yml','utf8');

for(const token of ['playerNavGroups','masterNavGroups','data-nav-more','renderMasterRosterPage','renderMasterApprovalsPage'])
  assert.ok(main.includes(token),`Navegação reorganizada ausente: ${token}`);
assert.ok(main.includes('downloadCharacterPdf'),'Ficha não oferece exportação PDF.');
assert.ok(main.includes('hasApprovedManifestation'),'Criação de ficha filha precisa refletir o requisito de Manifestação aprovada.');
assert.ok(main.includes("table: 'combat_participants'"),'Realtime precisa reagir a mudanças manuais de PS/EA/PA/visibilidade/posição.');
assert.ok(main.includes('data-master-entity-search'),'Mestre precisa conseguir localizar fichas rapidamente.');
assert.ok(combat.includes("state.testCharacterId=characterId"),'Teste secreto do Mestre precisa preservar a entidade selecionada.');
assert.ok(combat.includes('combat-history'),'Histórico do combate deve ficar separado do fluxo atual.');
assert.ok(panel.includes("options.phase==='reaction'"),'Painel Agora deve abrir automaticamente em uma reação pendente.');
assert.ok(api.includes("onConflict: 'character_id,key'"),'Progresso oculto precisa atualizar pela chave, não duplicar registros.');
assert.ok(system.includes("SYSTEM_VERSION = '0.8.7'"),'Versão visível do sistema precisa acompanhar a revisão atual.');
assert.ok(system.includes("name: 'Controle Amaldiçoado'"),'Terminologia de Controle Amaldiçoado precisa coincidir com o livro.');
assert.ok(system.includes("['defend', 'Defender'"),'Perícia Defender precisa coincidir com o livro.');
assert.ok(css.includes('.nav-section-label')&&css.includes('.sheet-signature'),'CSS da nova hierarquia e identidade individual ausente.');
assert.ok(workflow.includes('npm test'),'Deploy precisa executar a suíte de validação antes do build.');
assert.ok(!main.includes('Grau Especial = 12 VP base'),'Interface ainda apresenta orçamento de item divergente do motor.');
console.log('OK: auditoria de UX/lógica v0.8.7 — navegação, ficha, PDF, combate, consistência e CI presentes.');
