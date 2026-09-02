import './styles.css';
import { isConfigured, supabase } from './lib/supabase.js';
import { signInCharacter, signUpCharacter, signOut } from './lib/auth.js';
import * as api from './lib/api.js';
import {
  ATTRIBUTES,
  SKILLS,
  ATTRIBUTE_BY_KEY,
  ABILITY_CATEGORIES,
  ENTITY_TYPES,
  GRADE_OPTIONS,
  attributeModifier,
  attributePointBudget,
  attributeCap,
  skillPointBudget,
  skillCap,
  growthPointBudget,
  actionPoints,
  xpForNextLevel,
  characterDerived,
  validateBuild,
  slotBudget,
  VP_OPTIONS,
  estimateAbilityVP,
  SYSTEM_VERSION,
} from './lib/system.js';
import { renderTestsPage, quickSkillRoll, renderPlayerCombatPageV2, renderMasterCombatPageV2, abilityCombatConfigFields, abilityConfigFromForm } from './lib/combat-ui.js';
import { renderPlayerEquipmentPage, renderMasterEquipmentManager, pendingEquipmentQueueHtml, bindPendingEquipmentQueue } from './lib/equipment-ui.js';

const app = document.querySelector('#app');

const state = {
  authSession: null,
  profile: null,
  character: null,
  editingCharacter: null,
  conditions: [],
  activeSession: null,
  tab: 'sheet',
  authMode: 'login',
  masterCharacters: [],
  masterSelectedCharacter: null,
  activeEncounter: null,
  encounterParticipants: [],
  summonSelected: null,
  realtimeChannel: null,
  loading: false,
};

const playerTabs = [
  ['sheet', 'Ficha'],
  ['tests', 'Testes'],
  ['system', 'Sistema'],
  ['abilities', 'Habilidades'],
  ['training', 'Treino'],
  ['vows', 'Votos'],
  ['equipment', 'Inventário'],
  ['combat', 'Combate'],
  ['history', 'Histórico'],
];

const masterTabs = [
  ['master', 'Mestre'],
  ['tests', 'Testes'],
  ['system', 'Sistema'],
  ['combat', 'Combate'],
  ['history', 'Histórico'],
];

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(message, type = '') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  wrap.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

function showInfoModal(title, body) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal"><div class="btn-row" style="justify-content:space-between"><h2>${esc(title)}</h2><button class="btn" data-close-modal>Fechar</button></div><p>${esc(body)}</p></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-close-modal]').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

function bindConditionLinks(root = document) {
  root.querySelectorAll('[data-condition-key]').forEach((button) => {
    button.onclick = () => {
      const condition = state.conditions.find(c => c.key === button.dataset.conditionKey);
      if (condition) showInfoModal(condition.name, condition.description);
    };
  });
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


const MASTER_ENTITY_GROUPS = [
  { key:'player', title:'Players', label:'PLAYER', cls:'player', empty:'Nenhum player.' },
  { key:'npc', title:'NPCs', label:'NPC', cls:'npc', empty:'Nenhum NPC.' },
  { key:'curse', title:'Maldições', label:'MALDIÇÃO', cls:'curse', empty:'Nenhuma maldição.' },
  { key:'enemy', title:'Inimigos', label:'INIMIGO', cls:'enemy', empty:'Nenhum inimigo.' },
  { key:'summon', title:'Invocações / Fichas Filhas', label:'INVOCAÇÃO', cls:'summon', empty:'Nenhuma invocação.' },
];

function masterEntityGroupsHtml(characters=[]) {
  return MASTER_ENTITY_GROUPS.map(group=>{
    const rows=characters.filter(c=>c.entity_type===group.key);
    if(!rows.length) return '';
    return `<section class="entity-group entity-group-${group.cls}">
      <div class="entity-group-head"><div><span class="entity-group-dot"></span><strong>${group.title}</strong></div><span class="pill">${rows.length}</span></div>
      <div class="list">${rows.map(c=>`<button class="list-item entity-select-card entity-type-${group.cls}" data-select-entity="${c.id}"><div class="btn-row"><div class="title">${esc(getName(c))}</div><span class="entity-type-badge">${group.label}</span></div><div class="meta">Nv ${c.level} • ${esc(c.grade)}</div></button>`).join('')}</div>
    </section>`;
  }).join('') || '<p class="muted">Nenhuma entidade cadastrada.</p>';
}
function getName(character) {
  return [character?.first_name, character?.last_name].filter(Boolean).join(' ').trim() || 'Sem nome';
}

async function withBusy(task, successMessage = '') {
  if (state.loading) return;
  state.loading = true;
  try {
    const result = await task();
    if (successMessage) toast(successMessage, 'good');
    return result;
  } catch (error) {
    console.error(error);
    toast(error?.message || String(error), 'bad');
    throw error;
  } finally {
    state.loading = false;
  }
}

function setupScreen() {
  app.innerHTML = `
    <div class="auth-shell">
      <section class="auth-card">
        <div class="eyebrow">Configuração necessária</div>
        <h1>Correntes<br>do Destino</h1>
        <p>O projeto está pronto, mas o arquivo <strong>.env</strong> ainda não contém as chaves públicas do Supabase.</p>
        <div class="notice">
          Copie <code>.env.example</code> para <code>.env</code>, preencha <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, e execute novamente <code>npm run dev</code>.
        </div>
      </section>
    </div>`;
}

function authScreen() {
  const register = state.authMode === 'register';
  app.innerHTML = `
    <div class="auth-shell">
      <section class="auth-card">
        <div class="eyebrow">Ficha digital • Sistema ${esc(SYSTEM_VERSION)}</div>
        <h1>Correntes<br>do Destino</h1>
        <p>${register ? 'Crie o acesso do personagem. Cada conta de jogador possui uma ficha principal.' : 'Entre usando o nome completo do personagem e o sobrenome definido como senha.'}</p>
        <form id="auth-form">
          <label>Nome completo do personagem
            <input name="name" autocomplete="username" placeholder="Jin Okkotsu" required />
          </label>
          <label>${register ? 'Sobrenome usado como senha' : 'Senha'}
            <input name="password" type="password" autocomplete="current-password" placeholder="Sobrenome" required />
          </label>
          <button class="btn primary" type="submit">${register ? 'Criar acesso' : 'Entrar'}</button>
        </form>
        <div class="switcher">
          <button class="btn ghost" id="switch-auth">${register ? 'Já tenho acesso' : 'Primeiro acesso'}</button>
        </div>
        <p class="small muted">A conta usa autenticação do Supabase. As regras de acesso aos dados são aplicadas também no banco, não apenas na interface.</p>
      </section>
    </div>`;

  document.querySelector('#switch-auth').onclick = () => {
    state.authMode = register ? 'login' : 'register';
    authScreen();
  };

  document.querySelector('#auth-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    const password = String(form.get('password') || '').trim();
    try {
      if (register) {
        const { data, error } = await signUpCharacter(name, password);
        if (error) throw error;
        if (!data.session) {
          toast('Conta criada. Se a confirmação de e-mail estiver ligada no Supabase, desative-a para este projeto e tente entrar.', 'warn');
          state.authMode = 'login';
          authScreen();
          return;
        }
      } else {
        const { error } = await signInCharacter(name, password);
        if (error) throw error;
      }
      await loadApp();
    } catch (error) {
      toast(error.message, 'bad');
    }
  };
}

async function loadApp() {
  const { data } = await supabase.auth.getSession();
  state.authSession = data.session;
  if (!state.authSession) return authScreen();

  await withBusy(async () => {
    state.profile = await api.getProfile();
    state.conditions = await api.getSystemConditions();
    state.activeSession = await api.getActiveSession();

    if (state.profile.role === 'master') {
      state.masterCharacters = await api.listAllCharacters();
      state.character = null;
      if (state.tab !== 'system' && state.tab !== 'combat' && state.tab !== 'history') state.tab = 'master';
    } else {
      state.character = await api.ensureMyCharacter(state.authSession.user);
      state.editingCharacter = structuredClone(state.character);
      if (state.tab === 'master') state.tab = 'sheet';
    }
  });

  renderShell();
}

function renderShell() {
  const isMaster = state.profile?.role === 'master';
  const tabs = isMaster ? masterTabs : playerTabs;
  const title = isMaster ? 'Painel do Mestre' : getName(state.character);

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">呪</div>
          <div>
            <div class="brand-title">Correntes do Destino</div>
            <div class="brand-sub">${esc(title)}</div>
          </div>
        </div>
        <div class="top-actions">
          ${state.activeSession ? '<span class="pill bad hide-mobile">Sessão ativa</span>' : '<span class="pill good hide-mobile">Interlúdio</span>'}
          <button class="btn ghost" id="logout-btn">Sair</button>
        </div>
      </header>
      <div class="layout">
        <aside class="sidebar">${tabs.map(([key,name]) => `<button class="nav-btn ${state.tab===key?'active':''}" data-tab="${key}">${name}</button>`).join('')}</aside>
        <main class="content" id="page"></main>
      </div>
      <nav class="bottom-nav">${tabs.map(([key,name]) => `<button class="nav-btn ${state.tab===key?'active':''}" data-tab="${key}">${name}</button>`).join('')}</nav>
    </div>`;

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.onclick = () => {
      state.tab = button.dataset.tab;
      renderShell();
    };
  });
  document.querySelector('#logout-btn').onclick = async () => {
    await signOut();
    Object.assign(state, { authSession: null, profile: null, character: null, editingCharacter: null, tab: 'sheet' });
    authScreen();
  };

  renderCurrentPage();
}

function renderCurrentPage() {
  if (state.tab !== 'combat' && state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
  switch (state.tab) {
    case 'sheet': return renderSheetPage();
    case 'tests': return renderTestsPage(combatContext(document.querySelector('#page')));
    case 'system': return renderSystemPage();
    case 'abilities': return renderAbilitiesPage();
    case 'training': return renderTrainingPage();
    case 'vows': return renderVowsPage();
    case 'equipment': return renderEquipmentPage();
    case 'combat': {
      const root=document.querySelector('#page');
      const ctx=combatContext(root);
      const task=state.profile.role === 'master' ? renderMasterCombatPageV2(ctx) : renderPlayerCombatPageV2(ctx);
      // Um recurso opcional novo nunca deve deixar a página inteira em branco.
      // Se alguma leitura de combate falhar, mostramos o erro e preservamos a navegação
      // para que o Mestre consiga diagnosticar sem perder o restante da aplicação.
      task?.catch?.((error)=>{
        console.error('[Combate] falha ao renderizar:',error);
        root.innerHTML=`${pageHeader('Falha ao carregar','Combate')}<section class="card"><h2>O combate não pôde ser carregado</h2><div class="notice bad">${esc(error?.message||error)}</div><div class="muted small" style="margin-top:10px">Recarregue a página. Se persistir, copie esta mensagem; a interface não ficará mais vazia silenciosamente.</div></section>`;
      });
      return task;
    }
    case 'history': return renderHistoryPage();
    case 'master': return renderMasterPage();
    default: return renderSystemPage();
  }
}

function combatContext(root=document.querySelector('#page')) {
  return { root, state, pageHeader, esc, getName, withBusy, toast, subscribeCombatRealtime };
}

function pageHeader(kicker, title, extra = '') {
  return `<div class="page-title"><div><div class="kicker">${esc(kicker)}</div><h1>${esc(title)}</h1></div>${extra}</div>`;
}

function characterStatsHtml(character) {
  const d = characterDerived(character);
  return `
    <div class="grid grid-4">
      <div class="card stat"><span class="label">PS Máximo</span><span class="value">${d.ps}</span></div>
      <div class="card stat"><span class="label">EA Máxima</span><span class="value">${d.ea}</span></div>
      <div class="card stat"><span class="label">CA</span><span class="value">${d.ca}</span><span class="small muted">Ref ${d.reflex} • Def ${d.defend} • For ${d.fortitude} • Ref. EA ${d.reinforcement}</span></div>
      <div class="card stat"><span class="label">PA / rodada</span><span class="value">${d.pa}</span></div>
    </div>`;
}

function renderSheetPage() {
  if (!state.character) return;
  state.editingCharacter ||= structuredClone(state.character);
  renderCharacterEditor(state.editingCharacter, false, document.querySelector('#page'));
}

function renderCharacterEditor(character, isMasterEditor, root) {
  const validation = validateBuild(character);
  const respecLocked = !isMasterEditor && Boolean(state.activeSession);
  const attrUsed = ATTRIBUTES.reduce((sum,a)=>sum+Number(character.attributes?.[a.key]||0),0);
  const skillUsed = SKILLS.reduce((sum,s)=>sum+Number(character.skills?.[s.key]||0),0);
  const growthUsed = Number(character.growth_vigor||0)+Number(character.growth_reserve||0);
  const xpCost = xpForNextLevel(character.level);
  const canLevel = !isMasterEditor && character.entity_type==='player' && !state.activeSession && xpCost && character.xp >= xpCost;
  const image = character.image_url
    ? `<img class="avatar" src="${esc(character.image_url)}" alt="${esc(getName(character))}" />`
    : `<div class="avatar-placeholder">?</div>`;

  root.innerHTML = `
    ${pageHeader(isMasterEditor ? 'Editor administrativo' : `Nível ${character.level} • ${character.grade}`, getName(character), `<span class="pill ${validation.valid?'good':'bad'}">${validation.valid?'Build válida':'Revisar build'}</span>`)}
    <section class="card paper character-hero">
      ${image}
      <div>
        <div class="field-row">
          <label>Nome<input id="char-first" value="${esc(character.first_name)}" /></label>
          <label>Sobrenome<input id="char-last" value="${esc(character.last_name)}" /></label>
        </div>
        <div class="field-row" style="margin-top:8px">
          <label>Apelido<input id="char-nick" value="${esc(character.nickname||'')}" /></label>
          <label>Grau
            <select id="char-grade" ${isMasterEditor?'':'disabled'}>${GRADE_OPTIONS.map(g=>`<option ${g===character.grade?'selected':''}>${g}</option>`).join('')}</select>
          </label>
        </div>
        ${isMasterEditor ? `<div class="field-row-3" style="margin-top:8px">
          <label>Nível<input id="char-level" type="number" min="1" max="100" value="${character.level}" /></label>
          <label>XP<input id="char-xp" type="number" min="0" value="${character.xp}" /></label>
          <label>Tipo<select id="char-type">${ENTITY_TYPES.map(t=>`<option value="${t.key}" ${t.key===character.entity_type?'selected':''}>${t.name}</option>`).join('')}</select></label>
        </div>` : character.entity_type==='player' ? `<div class="btn-row" style="margin-top:10px"><span class="pill">XP ${character.xp}${xpCost ? ` / ${xpCost}` : ''}</span><button class="btn primary" id="level-up" ${canLevel?'':'disabled'}>Subir de nível</button></div>` : `<div class="btn-row" style="margin-top:10px"><span class="pill">Ficha filha • Nv ${character.level}</span></div>`}
      </div>
    </section>

    <div style="height:14px"></div>
    ${characterStatsHtml(character)}
    ${respecLocked?'<div class="notice" style="margin-top:14px">Redistribuição de atributos, perícias e crescimento fica bloqueada enquanto uma sessão está ativa.</div>':''}

    <div style="height:14px"></div>
    <section class="grid grid-2">
      <div class="card">
        <div class="section-head"><h2>Atributos</h2><span class="budget ${attrUsed>attributePointBudget(character.level)?'over':''}">${attrUsed}/${attributePointBudget(character.level)} • máx. ${attributeCap(character.level)}</span></div>
        <div class="attribute-grid">
          ${ATTRIBUTES.map(attr => {
            const value=Number(character.attributes?.[attr.key]||1);
            return `<div class="attribute-card"><div class="name">${attr.name}</div><div class="mod">Modificador +${attributeModifier(value)}</div><div class="stepper"><button data-attr-minus="${attr.key}" ${respecLocked?'disabled':''}>−</button><div class="number">${value}</div><button data-attr-plus="${attr.key}" ${respecLocked?'disabled':''}>+</button></div></div>`;
          }).join('')}
        </div>
      </div>
      <div class="card">
        <div class="section-head"><h2>Crescimento</h2><span class="budget ${growthUsed>growthPointBudget(character.level)?'over':''}">${growthUsed}/${growthPointBudget(character.level)}</span></div>
        <p class="muted">Vigor aumenta PS. Reserva aumenta EA. Pontos redistribuíveis apenas fora de sessão.</p>
        <div class="field-row">
          <div class="attribute-card"><div class="name">Vigor</div><div class="stepper"><button data-growth="vigor" data-delta="-1" ${respecLocked?'disabled':''}>−</button><div class="number">${character.growth_vigor||0}</div><button data-growth="vigor" data-delta="1" ${respecLocked?'disabled':''}>+</button></div></div>
          <div class="attribute-card"><div class="name">Reserva</div><div class="stepper"><button data-growth="reserve" data-delta="-1" ${respecLocked?'disabled':''}>−</button><div class="number">${character.growth_reserve||0}</div><button data-growth="reserve" data-delta="1" ${respecLocked?'disabled':''}>+</button></div></div>
        </div>
        ${isMasterEditor ? `<div class="field-row" style="margin-top:10px"><label>Bônus permanente de PS<input id="perm-ps" type="number" value="${character.permanent_ps_bonus||0}" /></label><label>Bônus permanente de EA<input id="perm-ea" type="number" value="${character.permanent_ea_bonus||0}" /></label></div>` : ''}
      </div>
    </section>

    <div style="height:14px"></div>
    <section class="card">
      <div class="section-head"><h2>Perícias</h2><span class="budget ${skillUsed>skillPointBudget(character.level)?'over':''}">${skillUsed}/${skillPointBudget(character.level)} • máx. ${skillCap(character.level)}</span></div>
      ${ATTRIBUTES.map(attr => `<div class="skills-group"><h3>${attr.name}</h3>${SKILLS.filter(s=>s.attribute===attr.key).map(skill=>{
        const v=Number(character.skills?.[skill.key]||0);
        return `<div class="skill-line"><div><div class="skill-name">${skill.name}</div><div class="skill-desc">${skill.description}</div></div><div class="skill-actions"><button class="btn ghost" data-quick-skill="${skill.key}" title="Rolar ${skill.name}">🎲</button><div class="stepper"><button data-skill-minus="${skill.key}" ${respecLocked?'disabled':''}>−</button><div class="number">${v}</div><button data-skill-plus="${skill.key}" ${respecLocked?'disabled':''}>+</button></div></div></div>`;
      }).join('')}</div>`).join('')}
    </section>

    <div style="height:14px"></div>
    <section class="grid grid-2">
      <div class="card"><h2>Técnica Amaldiçoada</h2><label>Nome<input id="tech-name" value="${esc(character.technique_name||'')}" /></label><label style="margin-top:8px">Descrição<textarea id="tech-desc">${esc(character.technique_description||'')}</textarea></label></div>
      <div class="card"><h2>Imagem</h2><label>URL da imagem<input id="image-url" value="${esc(character.image_url||'')}" placeholder="https://..." /></label><label style="margin-top:10px">Ou envie uma imagem<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label></div>
    </section>

    <div style="height:14px"></div>
    <section class="grid grid-2">
      <div class="card"><h2>Personagem</h2><label>História<textarea id="bio">${esc(character.biography||'')}</textarea></label><label>Personalidade<textarea id="personality">${esc(character.personality||'')}</textarea></label></div>
      <div class="card"><h2>Detalhes</h2><label>Objetivos<textarea id="goals">${esc(character.goals||'')}</textarea></label><label>Aparência<textarea id="appearance">${esc(character.appearance||'')}</textarea></label><label>Notas<textarea id="notes">${esc(character.notes||'')}</textarea></label></div>
    </section>

    ${validation.valid ? '' : `<div class="notice bad" style="margin-top:14px">${validation.errors.map(esc).join('<br>')}</div>`}
    <div class="btn-row" style="margin-top:16px"><button class="btn primary" id="save-character">Salvar ficha</button><button class="btn" id="export-character">Exportar JSON</button></div>
  `;

  const rerender = () => renderCharacterEditor(character, isMasterEditor, root);
  root.querySelectorAll('[data-attr-minus]').forEach(btn=>btn.onclick=()=>{ const k=btn.dataset.attrMinus; character.attributes[k]=Math.max(1,Number(character.attributes[k]||1)-1); rerender(); });
  root.querySelectorAll('[data-attr-plus]').forEach(btn=>btn.onclick=()=>{ const k=btn.dataset.attrPlus; const used=ATTRIBUTES.reduce((s,a)=>s+Number(character.attributes[a.key]||0),0); if(used<attributePointBudget(character.level) && character.attributes[k]<attributeCap(character.level)) character.attributes[k]++; rerender(); });
  root.querySelectorAll('[data-skill-minus]').forEach(btn=>btn.onclick=()=>{ const k=btn.dataset.skillMinus; character.skills[k]=Math.max(0,Number(character.skills[k]||0)-1); rerender(); });
  root.querySelectorAll('[data-skill-plus]').forEach(btn=>btn.onclick=()=>{ const k=btn.dataset.skillPlus; const used=SKILLS.reduce((s,a)=>s+Number(character.skills[a.key]||0),0); if(used<skillPointBudget(character.level) && Number(character.skills[k]||0)<skillCap(character.level)) character.skills[k]=Number(character.skills[k]||0)+1; rerender(); });
  root.querySelectorAll('[data-quick-skill]').forEach(btn=>btn.onclick=()=>quickSkillRoll(character,btn.dataset.quickSkill,combatContext(root)));
  root.querySelectorAll('[data-growth]').forEach(btn=>btn.onclick=()=>{ const key=btn.dataset.growth==='vigor'?'growth_vigor':'growth_reserve'; const delta=Number(btn.dataset.delta); const used=Number(character.growth_vigor||0)+Number(character.growth_reserve||0); if(delta<0) character[key]=Math.max(0,Number(character[key]||0)-1); else if(used<growthPointBudget(character.level)) character[key]=Number(character[key]||0)+1; rerender(); });

  if (!isMasterEditor) {
    const levelButton = root.querySelector('#level-up');
    if (levelButton) levelButton.onclick = async () => {
      const updated = await withBusy(()=>api.levelUpCharacter(character.id),'Nível aumentado. Distribua os novos pontos fora de sessão.');
      state.character = updated;
      state.editingCharacter = structuredClone(updated);
      await loadApp();
    };
  }

  root.querySelector('#save-character').onclick = async () => {
    character.first_name=root.querySelector('#char-first').value.trim();
    character.last_name=root.querySelector('#char-last').value.trim();
    character.nickname=root.querySelector('#char-nick').value.trim();
    character.technique_name=root.querySelector('#tech-name').value.trim();
    character.technique_description=root.querySelector('#tech-desc').value.trim();
    character.image_url=root.querySelector('#image-url').value.trim();
    character.biography=root.querySelector('#bio').value;
    character.personality=root.querySelector('#personality').value;
    character.goals=root.querySelector('#goals').value;
    character.appearance=root.querySelector('#appearance').value;
    character.notes=root.querySelector('#notes').value;

    if (isMasterEditor) {
      character.grade=root.querySelector('#char-grade').value;
      character.level=Number(root.querySelector('#char-level').value);
      character.xp=Number(root.querySelector('#char-xp').value);
      character.entity_type=root.querySelector('#char-type').value;
      character.permanent_ps_bonus=Number(root.querySelector('#perm-ps').value);
      character.permanent_ea_bonus=Number(root.querySelector('#perm-ea').value);
    }

    const file = root.querySelector('#image-file').files?.[0];
    if (file) {
      const userId = state.authSession.user.id;
      const result = await withBusy(()=>api.uploadCharacterImage(userId,character.id,file));
      character.image_url=result.publicUrl;
      character.image_path=result.path;
    }

    const check=validateBuild(character);
    if(!check.valid) return toast(check.errors[0],'bad');

    if(isMasterEditor) {
      const saved=await withBusy(()=>api.masterSaveCharacter(character),'Entidade salva.');
      state.masterSelectedCharacter=saved;
      state.masterCharacters=await api.listAllCharacters();
    } else {
      const saved=await withBusy(()=>api.saveCharacter(character),'Ficha salva.');
      if (saved.entity_type === 'player') {
        state.character=saved;
        state.editingCharacter=structuredClone(saved);
      } else {
        state.summonSelected=structuredClone(saved);
      }
    }
    renderShell();
  };

  root.querySelector('#export-character').onclick = async()=>{
    const json=await withBusy(()=>api.exportCharacterJson(character.id));
    downloadJson(`${getName(character).replace(/\s+/g,'_')}.json`,json);
  };
}

function renderSystemPage() {
  const root=document.querySelector('#page');
  root.innerHTML=`
    ${pageHeader('Compêndio do sistema', 'Sistema')}
    <div class="notice">O atributo listado em uma perícia é seu atributo padrão. Uma habilidade ou situação específica pode determinar outra combinação quando o funcionamento justificar isso.</div>
    <div style="height:14px"></div>
    <section class="card">
      <h2>Atributos e Perícias</h2>
      <div class="rule-list">
        ${ATTRIBUTES.map(attr=>`<details class="rule-row"><summary>${attr.name}</summary><p>${attr.description}</p><div class="list">${SKILLS.filter(s=>s.attribute===attr.key).map(s=>`<div class="list-item"><div class="title">${s.name}</div><div class="body">${s.description}</div></div>`).join('')}</div></details>`).join('')}
      </div>
    </section>
    <div style="height:14px"></div>
    <section class="grid grid-2">
      <div class="card"><h2>Teste universal</h2><p><strong>1d20 + Modificador do Atributo + Nível da Perícia</strong></p><p class="muted">Modificador do atributo = valor do atributo dividido por 2, arredondado para baixo.</p></div>
      <div class="card"><h2>Defesa passiva</h2><p>A CA é o maior resultado entre Reflexos, Defender, Fortitude e Reforço.</p><p class="muted">Se um ataque superar a CA, o alvo ainda pode gastar PA para reagir quando possuir uma reação válida.</p></div>
      <div class="card"><h2>Crítico e Kokusen</h2><p>20 natural é crítico e pode ser elegível a Kokusen quando Energia Amaldiçoada estiver envolvida e o golpe realmente conectar.</p><p class="muted">Crítico forçado ou faixa de crítico ampliada não transforma outros resultados em Kokusen.</p></div>
      <div class="card"><h2>Pontos de Ação</h2><p>PA são universais e podem ser gastos em ações, técnicas e reações. PA não usados permanecem até o início do próximo turno e então são redefinidos ao máximo.</p></div>
    </section>
    <div style="height:14px"></div>
    <section class="card"><h2>Equipamentos e Ferramentas Amaldiçoadas</h2>
      <p><strong>Golpe corpo a corpo:</strong> continua disponível mesmo sem arma e causa 1d6 + Mod. Força por 1 PA.</p>
      <p><strong>Perfis de arma:</strong> Leve 1d6/1 PA/1 mão; Padrão 1d8/1 PA/1 mão, podendo usar duas mãos no ataque para 1d10 quando a mão secundária estiver livre; Pesada 1d12/1 PA/2 mãos; Muito pesada 2d10/2 PA/2 mãos.</p>
      <p><strong>Mãos:</strong> Mão principal e Mão secundária são slots físicos. Nenhuma concede bônus ou penalidade de acerto. Armas de duas mãos são ancoradas na Mão principal e ocupam as duas mãos.</p>
      <p><strong>Corpo:</strong> itens podem ocupar Cabeça, Pescoço, Corpo, Braços/Pulsos, Cintura, Pés ou um dos dois slots genéricos de Acessório. Um amuleto não precisa ocupar uma mão se puder ser vestido.</p>
      <p><strong>Segurar acessórios:</strong> quando a ficha do item permitir, um amuleto ou outro objeto pode ser ativado na Mão principal ou Mão secundária em vez de seu slot corporal. Isso ocupa fisicamente a mão.</p>
      <p><strong>Sintonia:</strong> cada item amaldiçoado aprovado e equipado consome 1 Sintonia, inclusive armas. Capacidade: 3 (Nv 1–24), 4 (25–49), 5 (50–74), 6 (75–99), 7 (100). Itens comuns e consumíveis não gastam Sintonia.</p>
      <p><strong>VP:</strong> o ataque físico básico da arma não consome VP. Somente efeitos sobrenaturais usam o orçamento: Grau 4 = 2 VP, Grau 3 = 4 VP, Grau 2 = 6 VP, Grau 1 = 9 VP, Grau Especial = 12 VP base.</p>
      <p><strong>Acerto:</strong> o Grau da ferramenta não fornece bônus automático. O ataque continua usando Atributo + Perícia.</p>
      <p><strong>Kokusen:</strong> uma arma amaldiçoada não torna o golpe elegível sozinha. É necessário conduzir Energia Amaldiçoada no ataque.</p>
      <p class="muted">Ferramentas amaldiçoadas propostas por jogadores ficam pendentes até aprovação do Mestre. Itens precisam estar equipados para seus passivos permanecerem ativos; consumíveis aprovados podem ser usados diretamente do inventário.</p>
    </section>
    <div style="height:14px"></div>
    <section class="card"><h2>Condições</h2><div class="list">${state.conditions.length?state.conditions.map(c=>`<div class="list-item"><div class="title">${esc(c.name)}</div><div class="body">${esc(c.description)}</div></div>`).join(''):'<p class="muted">Nenhuma condição cadastrada.</p>'}</div></section>
  `;
}

async function renderAbilitiesPage() {
  const root=document.querySelector('#page');
  root.innerHTML=`${pageHeader('Construção e aprovação', 'Habilidades')}<div class="card">Carregando...</div>`;
  const [abilities, childSheets, cursedBody]=await Promise.all([
    api.getAbilities(state.character.id),
    api.getChildSheets(state.character.id),
    api.getCursedBodyTechnique(state.character.id),
  ]);
  const normalAbilities=abilities.filter(a=>!a.cursed_body_technique_id);
  const cursedBodyAbilities=abilities.filter(a=>a.cursed_body_technique_id && cursedBody && a.cursed_body_technique_id===cursedBody.id);
  const childAbilityPairs=await Promise.all(childSheets.map(async child=>({child,abilities:await api.getAbilities(child.id)})));
  const childAbilityMap=Object.fromEntries(childAbilityPairs.map(x=>[x.child.id,x.abilities]));
  const budget=slotBudget(state.character.level);
  root.innerHTML=`
    ${pageHeader('Construção e aprovação', 'Habilidades')}
    <section class="grid grid-2">
      <div class="card">
        <h2>Nova habilidade</h2>
        <form id="ability-form" class="grid">
          <label>Categoria<select name="category">${ABILITY_CATEGORIES.map(c=>`<option value="${c.key}">${c.name}</option>`).join('')}</select></label>
          <label>Nome<input name="name" required /></label>
          <label>Descrição narrativa<textarea name="description" placeholder="Explique o que a habilidade faz no mundo e como ela se manifesta."></textarea></label>
          <label>Mecânica<textarea name="mechanics" placeholder="Explique regras especiais, gatilhos e exceções em linguagem humana. Os campos estruturados abaixo executam a automação no combate."></textarea></label>
          <div class="notice ability-builder-note"><strong>Como montar:</strong> a Descrição e a Mecânica documentam a habilidade para a mesa. PA, EA, alvos, ataque, cura, resistência, efeitos e Sobrecarga abaixo viram regras executáveis no painel de combate. Não é necessário repetir todos os números no texto.</div>
          <div class="field-row-3">
            <label>PA<input name="pa" type="number" min="0" max="7" value="1" /></label>
            <label>EA<input name="ea" type="number" min="0" value="3" /></label>
            <label>Dado de dano<select name="die"><option value="0">Sem dano</option>${[4,6,8,10,12,20].map(v=>`<option value="${v}">d${v}</option>`).join('')}</select></label>
          </div>
          <div class="field-row-3"><label>Quantidade de dados<input name="diceCount" type="number" min="0" max="12" value="0" /></label><label>Alcance<select name="range">${Object.entries(VP_OPTIONS.range).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label><label>Alvos<select name="targets">${Object.entries(VP_OPTIONS.targets).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label></div>
          <div class="field-row"><label>Duração<select name="duration">${Object.entries(VP_OPTIONS.duration).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label><label>Severidade da condição<select name="condition">${Object.entries(VP_OPTIONS.conditionSeverity).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label></div><label>Condição aplicada<select name="conditionKey"><option value="">Nenhuma / efeito próprio</option>${state.conditions.map(c=>`<option value="${c.key}">${esc(c.name)}</option>`).join('')}</select></label>
          <div class="field-row"><label><input name="onceCombat" type="checkbox" style="width:auto" /> 1 vez por combate</label><label><input name="onceMission" type="checkbox" style="width:auto" /> 1 vez por missão</label></div>
          <div class="field-row"><label><input name="preparation" type="checkbox" style="width:auto" /> Exige preparação</label><label><input name="drawback" type="checkbox" style="width:auto" /> Desvantagem relevante</label></div>
          ${abilityCombatConfigFields(state.character?.special_resources||[])}
          <div class="notice" id="vp-preview">VP estimado: 1</div>
          <button class="btn primary">Enviar para aprovação</button>
        </form>
      </div>
      <div class="card">
        <h2>Capacidade atual</h2>
        ${['technique','general','manifestation','transformation'].map(k=>`<div class="list-item"><div class="title">${ABILITY_CATEGORIES.find(c=>c.key===k)?.name}</div><div class="meta">${budget[k].slots} slots • ${budget[k].vp} VP total • ${budget[k].maxSingle} VP máximo por habilidade</div></div>`).join('')}
        <div class="notice" style="margin-top:10px">O VP do construtor é uma estimativa para triagem. Aprovação e VP final pertencem ao mestre.</div>
      </div>
    </section>
    <div style="height:14px"></div>
    <section class="card"><h2>Minhas habilidades</h2><div class="list">${normalAbilities.length?normalAbilities.map(a=>abilityCard(a)).join(''):'<p class="muted">Nenhuma habilidade enviada ainda.</p>'}</div></section>
    ${cursedBody?`<div style="height:14px"></div><section class="card cursed-body-zone"><div class="btn-row"><div><div class="eyebrow">CONCESSÃO DO MESTRE</div><h2 style="margin:4px 0">Técnica do Corpo · ${esc(cursedBody.name)}</h2></div><span class="pill good">LIBERADA</span></div><div class="body">${esc(cursedBody.description||'Esta Técnica do Corpo foi liberada pelo Mestre.')}</div><div class="notice" style="margin-top:10px">Técnicas e habilidades do Corpo Amaldiçoado são extras narrativos concedidos pelo Mestre. Elas não consomem os slots ou VP normais da sua build e não podem ser editadas pelo jogador.</div><h3 style="margin-top:14px">Habilidades do Corpo</h3><div class="list">${cursedBodyAbilities.length?cursedBodyAbilities.map(a=>abilityCard(a)).join(''):'<p class="muted">A Técnica do Corpo foi revelada, mas ainda não possui habilidades liberadas.</p>'}</div></section>`:''}
    <div style="height:14px"></div>
    <section class="grid grid-2"><div class="card"><h2>Fichas filhas de invocação</h2><p class="muted">Uma ficha filha pode ser criada quando existe ao menos uma Manifestação aprovada.</p><form id="summon-form" class="field-row"><label>Nome da invocação<input name="name" required /></label><button class="btn primary" style="align-self:end">Criar ficha filha</button></form></div><div class="card"><h2>Invocações</h2><div class="list">${childSheets.length?childSheets.map(c=>`<button class="list-item" style="text-align:left;color:inherit;width:100%" data-select-summon="${c.id}"><div class="title">${esc(getName(c))}</div><div class="meta">Nv ${c.level}</div></button>`).join(''):'<p class="muted">Nenhuma ficha filha.</p>'}</div></div></section>
    ${state.summonSelected?`<div style="height:14px"></div><section class="card"><div class="btn-row"><h2 style="margin:0">Habilidades de ${esc(getName(state.summonSelected))}</h2><span class="pill">Ficha filha</span></div><div class="notice" style="margin-top:8px">Estas habilidades pertencem à invocação e podem ser travadas no combate até a manifestação correspondente estar ativa.</div><div class="list" style="margin-top:10px">${(childAbilityMap[state.summonSelected.id]||[]).length?(childAbilityMap[state.summonSelected.id]||[]).map(a=>abilityCard(a)).join(''):'<p class="muted">Nenhuma habilidade cadastrada nesta ficha filha.</p>'}</div></section><div style="height:14px"></div><section id="summon-editor"></section>`:''}`;

  const form=root.querySelector('#ability-form');
  const getConfig=()=>abilityConfigFromForm(form);
  const updateVp=()=>root.querySelector('#vp-preview').textContent=`VP estimado: ${estimateAbilityVP(getConfig())}`;
  form.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',updateVp));
  updateVp();
  bindConditionLinks(root);
  root.querySelector('#summon-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);state.summonSelected=await withBusy(()=>api.createSummonSheet(state.character.id,f.get('name')),'Ficha filha criada.');renderAbilitiesPage();};
  root.querySelectorAll('[data-select-summon]').forEach(btn=>btn.onclick=()=>{state.summonSelected=structuredClone(childSheets.find(c=>c.id===btn.dataset.selectSummon));renderAbilitiesPage();});
  if(state.summonSelected){renderCharacterEditor(state.summonSelected,false,root.querySelector('#summon-editor'));}
  form.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(form); const config=getConfig(); const vp=estimateAbilityVP(config);
    await withBusy(()=>api.createAbility({character_id:state.character.id,category:f.get('category'),name:f.get('name'),description:f.get('description'),mechanics:f.get('mechanics'),config,vp_estimated:vp,status:'pending'}),'Habilidade enviada.');
    renderAbilitiesPage();
  };
}

function abilityCard(a, master=false) {
  const statusClass=a.status==='approved'?'good':a.status==='rejected'?'bad':'warn';
  const bodyPill=a.cursed_body_technique_id?'<span class="pill bad">CORPO AMALDIÇOADO</span>':'';
  return `<div class="list-item" data-ability-id="${a.id}"><div class="btn-row"><div class="title">${esc(a.name)}</div>${bodyPill}<span class="pill ${statusClass}">${esc(a.status)}</span><span class="pill">VP ${a.vp_approved??a.vp_estimated}</span></div><div class="meta">${esc(ABILITY_CATEGORIES.find(c=>c.key===a.category)?.name||a.category)} ${a.config?.condition_key?`• <button class="btn ghost" data-condition-key="${esc(a.config.condition_key)}">Ver condição</button>`:''}</div><div class="body">${esc(a.description)}${a.mechanics?`\n\n${esc(a.mechanics)}`:''}</div>${a.master_response?`<div class="notice" style="margin-top:8px">Mestre: ${esc(a.master_response)}</div>`:''}${master&&a.status==='pending'?`<div class="btn-row" style="margin-top:9px"><button class="btn good" data-approve-ability="${a.id}">Aprovar</button><button class="btn bad" data-reject-ability="${a.id}">Rejeitar</button></div>`:''}</div>`;
}

async function renderTrainingPage() {
  const root=document.querySelector('#page');
  root.innerHTML=`${pageHeader('Dias livres e atividades', 'Treino')}<div class="card">Carregando...</div>`;
  const [balance,tickets,requests]=await Promise.all([api.getFreeTimeBalance(state.character.id),api.getTrainingTickets(state.character.id),api.getMasterRequests(state.character.id)]);
  const available=balance?balance.granted-balance.committed-balance.spent:0;
  root.innerHTML=`
    ${pageHeader('Dias livres e atividades', 'Treino', `<span class="pill">Disponíveis ${available}</span>`)}
    <div class="notice">Dias livres representam o que o personagem decidiu fazer com o próprio tempo. Recompensas e requisitos ocultos não são exibidos aqui.</div>
    <div style="height:14px"></div>
    <section class="grid grid-2"><div class="card"><h2>Usar tempo livre</h2><form id="training-form" class="grid"><label>Atividade<input name="activity" required placeholder="O que o personagem fará?" /></label><label>Dias<input name="days" type="number" min="1" max="${Math.max(1,available)}" value="1" required /></label><label>Descrição opcional<textarea name="description"></textarea></label><button class="btn primary" ${available<=0?'disabled':''}>Enviar ticket</button></form></div><div class="card"><h2>Saldo</h2><div class="grid grid-3"><div class="stat"><span class="label">Concedidos</span><span class="value">${balance?.granted||0}</span></div><div class="stat"><span class="label">Reservados</span><span class="value">${balance?.committed||0}</span></div><div class="stat"><span class="label">Gastos</span><span class="value">${balance?.spent||0}</span></div></div></div></section>
    <div style="height:14px"></div><section class="card"><h2>Tickets</h2><div class="list">${tickets.length?tickets.map(trainingCard).join(''):'<p class="muted">Nenhum ticket.</p>'}</div></section>
    <div style="height:14px"></div><section class="grid grid-2"><div class="card"><h2>Nota ao mestre</h2><form id="request-form" class="grid"><label>Título<input name="title" required placeholder="Ex.: alteração permanente percebida" /></label><label>Mensagem<textarea name="message" required></textarea></label><button class="btn primary">Enviar nota</button></form></div><div class="card"><h2>Minhas solicitações</h2><div class="list">${requests.length?requests.map(r=>`<div class="list-item"><div class="btn-row"><div class="title">${esc(r.title)}</div><span class="pill ${r.status==='answered'?'good':r.status==='rejected'?'bad':'warn'}">${esc(r.status)}</span></div><div class="body">${esc(r.message)}</div>${r.master_response?`<div class="notice" style="margin-top:8px">${esc(r.master_response)}</div>`:''}</div>`).join(''):'<p class="muted">Nenhuma nota.</p>'}</div></div></section>`;
  root.querySelector('#training-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.submitTrainingTicket(state.character.id,f.get('activity'),f.get('description'),f.get('days')),'Tempo reservado e ticket enviado.');renderTrainingPage();};
  root.querySelector('#request-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.createMasterRequest(state.character.id,f.get('title'),f.get('message')),'Nota enviada ao mestre.');renderTrainingPage();};
}

function trainingCard(t, master=false) {
  const cls=t.status==='approved'?'good':t.status==='rejected'?'bad':'warn';
  return `<div class="list-item"><div class="btn-row"><div class="title">${esc(t.activity)}</div><span class="pill ${cls}">${esc(t.status)}</span><span class="pill">${t.days_requested} dia(s)</span></div>${master?`<div class="meta">${esc(getName(t.characters))}</div>`:''}<div class="body">${esc(t.description||'')}</div>${t.master_response?`<div class="notice" style="margin-top:8px">${esc(t.master_response)}</div>`:''}${master&&t.status==='pending'?`<div class="btn-row" style="margin-top:8px"><button class="btn good" data-training-approve="${t.id}">Aprovar</button><button class="btn bad" data-training-reject="${t.id}">Rejeitar</button></div>`:''}</div>`;
}

async function renderVowsPage() {
  const root=document.querySelector('#page');
  const vows=await withBusy(()=>api.getVows(state.character.id));
  root.innerHTML=`${pageHeader('Restrições e benefícios', 'Votos Vinculativos')}<section class="grid grid-2"><div class="card"><h2>Propor voto</h2><form id="vow-form" class="grid"><label>Nome<input name="name" required /></label><label>Restrição<textarea name="restriction" required></textarea></label><label>Benefício pretendido<textarea name="benefit" required></textarea></label><label>Condição de quebra<textarea name="break" required></textarea></label><label>Duração<select name="duration"><option value="permanent">Permanente</option><option value="temporary">Temporário</option></select></label><button class="btn primary">Enviar ao mestre</button></form></div><div class="card"><h2>Estados</h2><p class="muted">Um voto bloqueado pelo mestre permanece na ficha sem benefício e não pode ser reativado pelo jogador até que o mestre libere essa ação.</p></div></section><div style="height:14px"></div><section class="card"><h2>Meus votos</h2><div class="list">${vows.length?vows.map(vowCard).join(''):'<p class="muted">Nenhum voto.</p>'}</div></section>`;
  root.querySelector('#vow-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.createVow({character_id:state.character.id,name:f.get('name'),restriction:f.get('restriction'),benefit:f.get('benefit'),break_condition:f.get('break'),duration_type:f.get('duration'),status:'pending'}),'Voto enviado.');renderVowsPage();};
  root.querySelectorAll('[data-vow-status]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.setVowStatus(btn.dataset.vowId,btn.dataset.vowStatus),'Estado do voto atualizado.');renderVowsPage();});
}

function vowCard(v, master=false) {
  const cls=v.status==='active'?'good':v.status==='master_locked'||v.status==='rejected'?'bad':'warn';
  const playerButton=v.status==='active'?`<button class="btn warn" data-vow-id="${v.id}" data-vow-status="player_disabled">Desativar: percebi uma quebra</button>`:v.status==='available_reactivation'?`<button class="btn good" data-vow-id="${v.id}" data-vow-status="active">Reativar voto</button>`:'';
  return `<div class="list-item"><div class="btn-row"><div class="title">${esc(v.name)}</div><span class="pill ${cls}">${esc(v.status)}</span></div>${master?`<div class="meta">${esc(getName(v.characters))}</div>`:''}<div class="body"><strong>Restrição:</strong> ${esc(v.restriction)}\n<strong>Benefício:</strong> ${esc(v.benefit)}\n<strong>Quebra:</strong> ${esc(v.break_condition)}</div>${v.master_response?`<div class="notice" style="margin-top:8px">${esc(v.master_response)}</div>`:''}${master?`<div class="btn-row" style="margin-top:8px">${['active','master_locked','available_reactivation','rejected'].map(s=>`<button class="btn" data-master-vow="${v.id}" data-status="${s}">${s}</button>`).join('')}</div>`:`<div class="btn-row" style="margin-top:8px">${playerButton}</div>`}</div>`;
}

async function renderEquipmentPage() {
  return renderPlayerEquipmentPage(combatContext(document.querySelector('#page')));
}

async function renderHistoryPage() {
  const root=document.querySelector('#page'); root.innerHTML=`${pageHeader('Registro de alterações', 'Histórico')}<div class="card">Carregando...</div>`;
  const logs=await withBusy(()=>api.getAuditLogs(state.profile.role==='master'?null:state.character.id));
  root.innerHTML=`${pageHeader('Registro de alterações', 'Histórico')}<section class="card"><div class="list">${logs.length?logs.map(l=>`<div class="list-item"><div class="title">${esc(l.table_name)} • ${esc(l.action)}</div><div class="meta">${formatDate(l.created_at)}</div><div class="body">${esc(l.summary)}</div></div>`).join(''):'<p class="muted">Sem alterações registradas.</p>'}</div></section>`;
}

async function renderMasterPage() {
  const root=document.querySelector('#page');
  state.masterCharacters=await withBusy(()=>api.listAllCharacters());
  const [tickets,vows,requests,pendingEquipment] = await Promise.all([api.getTrainingTickets(),api.getVows(),api.getMasterRequests(),api.listPendingEquipment()]);
  const pendingAbilitiesResult=await supabase.from('abilities').select('*, characters(first_name,last_name)').eq('status','pending').order('created_at');
  const pendingAbilities=pendingAbilitiesResult.data||[];
  root.innerHTML=`
    ${pageHeader('Administração', 'Mestre', `<span class="pill">${state.masterCharacters.length} entidades</span>`)}
    <section class="master-zone">
      <div class="grid grid-2">
        <div class="card"><h2>Sessão</h2>${state.activeSession?`<p><span class="pill bad">Ativa</span> ${esc(state.activeSession.title||'Sessão')}</p><form id="end-session-form"><div class="list">${state.masterCharacters.filter(c=>c.entity_type==='player').map(c=>`<div class="list-item"><div class="title">${esc(getName(c))}</div><div class="field-row"><label>XP<input type="number" min="0" value="0" data-award-xp="${c.id}" /></label><label>Dias livres<input type="number" min="0" value="0" data-award-days="${c.id}" /></label></div></div>`).join('')}</div><button class="btn bad" style="margin-top:10px">Encerrar sessão</button></form>`:`<form id="start-session-form" class="grid"><label>Título<input name="title" placeholder="Sessão" /></label><button class="btn good">Iniciar sessão</button></form>`}</div>
        <div class="card"><h2>Criar entidade</h2><form id="entity-form" class="grid"><div class="field-row"><label>Nome<input name="first" required /></label><label>Sobrenome<input name="last" /></label></div><div class="field-row-3"><label>Tipo<select name="type">${ENTITY_TYPES.filter(t=>t.key!=='player').map(t=>`<option value="${t.key}">${t.name}</option>`).join('')}</select></label><label>Nível<input name="level" type="number" min="1" max="100" value="5" /></label><label>Grau<select name="grade">${GRADE_OPTIONS.map(g=>`<option>${g}</option>`).join('')}</select></label></div><button class="btn primary">Criar e editar</button></form></div>
      </div>
    </section>
    <div style="height:14px"></div>
    <section class="grid grid-2">
      <div class="card"><h2>Fichas por categoria</h2><div class="entity-groups">${masterEntityGroupsHtml(state.masterCharacters)}</div></div>
      <div class="card"><h2>Fila de habilidades</h2><div class="list">${pendingAbilities.length?pendingAbilities.map(a=>`<div class="list-item"><div class="title">${esc(a.name)}</div><div class="meta">${esc(getName(a.characters))} • VP estimado ${a.vp_estimated}</div><div class="body">${esc(a.description)}\n${esc(a.mechanics)}</div><div class="field-row" style="margin-top:8px"><label>VP aprovado<input type="number" min="1" value="${a.vp_estimated}" data-vp-approved="${a.id}" /></label><label>Resposta<input data-ability-response="${a.id}" /></label></div><div class="btn-row" style="margin-top:8px"><button class="btn good" data-approve-ability="${a.id}">Aprovar</button><button class="btn bad" data-reject-ability="${a.id}">Rejeitar</button></div></div>`).join(''):'<p class="muted">Nada pendente.</p>'}</div></div>
    </section>
    <div style="height:14px"></div>
    <section class="card"><h2>Fila de equipamentos amaldiçoados</h2><div class="list">${pendingEquipmentQueueHtml(pendingEquipment,esc,getName)}</div></section>
    <div style="height:14px"></div>
    <section class="grid grid-2"><div class="card"><h2>Treinamentos pendentes</h2><div class="list">${tickets.filter(t=>t.status==='pending').map(t=>trainingCard(t,true)).join('')||'<p class="muted">Nada pendente.</p>'}</div></div><div class="card"><h2>Votos</h2><div class="list">${vows.map(v=>vowCard(v,true)).join('')||'<p class="muted">Nenhum voto.</p>'}</div></div></section>
    <div style="height:14px"></div><section class="card"><h2>Notas ao mestre</h2><div class="list">${requests.filter(r=>r.status==='pending').map(r=>`<div class="list-item"><div class="title">${esc(r.title)}</div><div class="meta">${esc(getName(r.characters))}</div><div class="body">${esc(r.message)}</div><div class="field-row" style="margin-top:8px"><label>Resposta<input data-request-response="${r.id}" /></label><div class="btn-row" style="align-self:end"><button class="btn good" data-request-answer="${r.id}">Responder</button><button class="btn bad" data-request-reject="${r.id}">Rejeitar</button></div></div></div>`).join('')||'<p class="muted">Nada pendente.</p>'}</div></section>
    <div style="height:14px"></div><section class="card"><h2>Condições do sistema</h2><div class="grid grid-2"><form id="condition-form" class="grid"><label>Chave técnica<input name="key" placeholder="ex: frozen" required /></label><label>Nome<input name="name" required /></label><label>Descrição<textarea name="description" required></textarea></label><button class="btn primary">Adicionar / atualizar</button></form><div class="list">${state.conditions.map(c=>`<div class="list-item"><div class="title">${esc(c.name)}</div><div class="body">${esc(c.description)}</div><button class="btn bad" data-condition-disable="${c.id}">Desativar</button></div>`).join('')}</div></div></section>
    ${state.masterSelectedCharacter?`<div style="height:14px"></div><section id="master-editor"></section>`:''}
  `;

  root.querySelector('#start-session-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);state.activeSession=await withBusy(()=>api.startSession(f.get('title')),'Sessão iniciada.');try{await api.triggerBackup('session-start');toast('Backup do início da sessão enviado.','good');}catch(err){toast(`Sessão iniciou, mas o backup falhou: ${err.message}`,'warn');}renderMasterPage();});
  root.querySelector('#end-session-form')?.addEventListener('submit',async e=>{e.preventDefault();const awards={};state.masterCharacters.filter(c=>c.entity_type==='player').forEach(c=>{awards[c.id]={xp:Number(root.querySelector(`[data-award-xp="${c.id}"]`).value||0),days:Number(root.querySelector(`[data-award-days="${c.id}"]`).value||0)};});await withBusy(()=>api.endSession(awards),'Sessão encerrada.');state.activeSession=null;try{await api.triggerBackup('session-end');toast('Backup do encerramento enviado.','good');}catch(err){toast(`Sessão encerrou, mas o backup falhou: ${err.message}`,'warn');}renderMasterPage();});
  root.querySelector('#entity-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const entity=await withBusy(()=>api.createMasterEntity({entityType:f.get('type'),firstName:f.get('first'),lastName:f.get('last'),level:Number(f.get('level')),grade:f.get('grade')}),'Entidade criada.');state.masterSelectedCharacter=entity;renderMasterPage();};
  root.querySelectorAll('[data-select-entity]').forEach(btn=>btn.onclick=()=>{state.masterSelectedCharacter=structuredClone(state.masterCharacters.find(c=>c.id===btn.dataset.selectEntity));renderMasterPage();});
  root.querySelectorAll('[data-training-approve]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.resolveTrainingTicket(btn.dataset.trainingApprove,'approved',''),'Treino aprovado.');renderMasterPage();});
  root.querySelectorAll('[data-training-reject]').forEach(btn=>btn.onclick=async()=>{const response=prompt('Motivo/resposta ao jogador:')||'';await withBusy(()=>api.resolveTrainingTicket(btn.dataset.trainingReject,'rejected',response),'Treino rejeitado.');renderMasterPage();});
  root.querySelectorAll('[data-master-vow]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.setVowStatus(btn.dataset.masterVow,btn.dataset.status),'Voto atualizado.');renderMasterPage();});
  root.querySelectorAll('[data-approve-ability]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.approveAbility;const vp=Number(root.querySelector(`[data-vp-approved="${id}"]`)?.value||1);const response=root.querySelector(`[data-ability-response="${id}"]`)?.value||'';const ability=pendingAbilities.find(a=>a.id===id);const {error}=await supabase.from('abilities').update({status:'approved',vp_approved:vp,master_response:response,limit_override:ability?.category==='domain'}).eq('id',id);if(error)return toast(error.message,'bad');toast('Habilidade aprovada.','good');renderMasterPage();});
  root.querySelectorAll('[data-reject-ability]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.rejectAbility;const response=root.querySelector(`[data-ability-response="${id}"]`)?.value||prompt('Resposta:')||'';const {error}=await supabase.from('abilities').update({status:'rejected',master_response:response}).eq('id',id);if(error)return toast(error.message,'bad');toast('Habilidade rejeitada.','good');renderMasterPage();});
  bindPendingEquipmentQueue(root,pendingEquipment,combatContext(root),renderMasterPage);
  root.querySelector('#condition-form').insertAdjacentHTML('afterbegin','<div class="notice">O catálogo público usa estados genéricos estáveis. Novas condições cadastradas aqui ficam restritas ao Mestre. Para um efeito específico em jogo, use Efeito Improvisado no combate.</div>');
  root.querySelector('#condition-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.upsertSystemCondition({key:String(f.get('key')).trim(),name:String(f.get('name')).trim(),description:String(f.get('description')).trim(),active:true}),'Condição salva.');state.conditions=await api.getSystemConditions();renderMasterPage();};
  root.querySelectorAll('[data-condition-disable]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.deactivateSystemCondition(btn.dataset.conditionDisable),'Condição desativada.');state.conditions=await api.getSystemConditions();renderMasterPage();});
  root.querySelectorAll('[data-request-answer]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.requestAnswer;const response=root.querySelector(`[data-request-response="${id}"]`)?.value||'';await withBusy(()=>api.resolveMasterRequest(id,'answered',response),'Solicitação respondida.');renderMasterPage();});
  root.querySelectorAll('[data-request-reject]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.requestReject;const response=root.querySelector(`[data-request-response="${id}"]`)?.value||'';await withBusy(()=>api.resolveMasterRequest(id,'rejected',response),'Solicitação rejeitada.');renderMasterPage();});
  bindConditionLinks(root);

  if(state.masterSelectedCharacter) {
    const editor=root.querySelector('#master-editor');
    editor.innerHTML='<div class="master-zone"><div id="master-char-editor"></div><div id="master-secret"></div></div>';
    renderCharacterEditor(state.masterSelectedCharacter,true,editor.querySelector('#master-char-editor'));
    renderMasterSecret(editor.querySelector('#master-secret'),state.masterSelectedCharacter);
  }
}

async function renderMasterSecret(root,character){
  const [secret,tracks,abilities,cursedBody]=await Promise.all([
    api.getMasterSecret(character.id),
    api.listMasterProgress(character.id),
    api.getAbilities(character.id),
    api.getCursedBodyTechnique(character.id),
  ]);
  const normalAbilities=abilities.filter(a=>!a.cursed_body_technique_id);
  const cursedBodyAbilities=cursedBody?abilities.filter(a=>a.cursed_body_technique_id===cursedBody.id):[];
  const budgets=slotBudget(character.level);

  const cursedBodyHtml=!cursedBody?`
    <div style="height:14px"></div>
    <div class="master-zone cursed-body-master-zone">
      <div class="btn-row"><div><div class="eyebrow">EXCLUSIVO DO MESTRE</div><h2 style="margin:4px 0">Corpo Amaldiçoado</h2></div><span class="pill bad">NÃO CONFIGURADO</span></div>
      <div class="notice">Use isto somente quando a história do personagem conceder uma <strong>Técnica do Corpo</strong> separada da Técnica Amaldiçoada normal. O jogador não saberá que ela existe até você liberar o acesso.</div>
      <form id="cursed-body-create-form" class="card grid" style="margin-top:10px">
        <label>Nome da Técnica do Corpo<input name="name" required placeholder="Ex.: Circuito Hemático" /></label>
        <label>Descrição que o jogador verá quando for liberada<textarea name="description"></textarea></label>
        <label>Notas exclusivas do Mestre<textarea name="masterNotes" placeholder="Origem, gatilhos narrativos, plano de evolução..."></textarea></label>
        <button class="btn bad">Criar Técnica do Corpo oculta</button>
      </form>
    </div>`:`
    <div style="height:14px"></div>
    <div class="master-zone cursed-body-master-zone">
      <div class="btn-row"><div><div class="eyebrow">EXCLUSIVO DO MESTRE · BACKSTORY</div><h2 style="margin:4px 0">Técnica do Corpo · ${esc(cursedBody.name)}</h2></div><span class="pill ${cursedBody.is_released?'good':'bad'}">${cursedBody.is_released?'LIBERADA':'OCULTA'}</span></div>
      <div class="notice">Esta Técnica do Corpo e suas habilidades são <strong>extras concedidos pelo Mestre</strong>. Não gastam slots nem VP da build normal. Enquanto estiver oculta, o jogador não consegue vê-la nem usar suas habilidades.</div>
      <div class="grid grid-2" style="margin-top:10px">
        <form id="cursed-body-edit-form" class="card grid">
          <label>Nome<input name="name" required value="${esc(cursedBody.name)}" /></label>
          <label>Descrição para o jogador<textarea name="description">${esc(cursedBody.description||'')}</textarea></label>
          <label>Notas exclusivas do Mestre<textarea name="masterNotes">${esc(cursedBody.master_notes||'')}</textarea></label>
          <button class="btn">Salvar Técnica do Corpo</button>
          <div class="btn-row">
            <button type="button" class="btn ${cursedBody.is_released?'warn':'good'}" id="toggle-cursed-body">${cursedBody.is_released?'Retirar acesso do jogador':'Liberar técnica + habilidades'}</button>
            <button type="button" class="btn bad" id="delete-cursed-body">Excluir Técnica do Corpo</button>
          </div>
        </form>
        <div class="card">
          <h3>Estado de acesso</h3>
          <div class="list-item"><div class="title">${cursedBody.is_released?'O jogador tem acesso':'Somente o Mestre vê'}</div><div class="body">${cursedBody.is_released?'A Técnica do Corpo aparece na aba Habilidades e suas habilidades aprovadas entram normalmente no combate.':'A técnica, descrição e habilidades ficam completamente ocultas para a conta do jogador.'}</div></div>
          <div class="list-item"><div class="title">Capacidade separada</div><div class="body">Habilidades corporais não contam contra os limites normais de Técnica, Habilidade Geral, Manifestação ou Transformação. O VP continua visível como referência de equilíbrio para o Mestre.</div></div>
        </div>
      </div>
      <div class="grid grid-2" style="margin-top:10px">
        <form id="cursed-body-ability-form" class="card grid">
          <h3>Nova habilidade do Corpo</h3>
          <label>Categoria<select name="category">${ABILITY_CATEGORIES.filter(c=>c.key!=='domain').map(c=>`<option value="${c.key}">${c.name}</option>`).join('')}</select></label>
          <label>Nome<input name="name" required /></label>
          <label>Descrição<textarea name="description" placeholder="O que a habilidade representa e faz na ficção."></textarea></label>
          <label>Mecânica<textarea name="mechanics" placeholder="Gatilhos, exceções e regras especiais. A automação vem dos campos estruturados abaixo."></textarea></label>
          <div class="notice ability-builder-note"><strong>Motor estruturado:</strong> use os campos de combate para dizer ao sistema o que deve ser calculado automaticamente. O texto continua sendo a referência humana para regras excepcionais.</div>
          <div class="field-row-3"><label>PA<input name="pa" type="number" min="0" max="7" value="1" /></label><label>EA<input name="ea" type="number" min="0" value="2" /></label><label>Dado<select name="die"><option value="0">Sem dano</option>${[4,6,8,10,12,20].map(v=>`<option value="${v}">d${v}</option>`).join('')}</select></label></div>
          <div class="field-row-3"><label>Qtd. dados<input name="diceCount" type="number" min="0" max="12" value="0" /></label><label>Alcance<select name="range">${Object.entries(VP_OPTIONS.range).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label><label>Alvos<select name="targets">${Object.entries(VP_OPTIONS.targets).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label></div>
          <div class="field-row"><label>Duração<select name="duration">${Object.entries(VP_OPTIONS.duration).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label><label>Condição<select name="condition">${Object.entries(VP_OPTIONS.conditionSeverity).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label></div>
          <label>Condição do compêndio<select name="conditionKey"><option value="">Nenhuma</option>${state.conditions.map(c=>`<option value="${c.key}">${esc(c.name)}</option>`).join('')}</select></label>
          <div class="field-row"><label><input name="onceCombat" type="checkbox" style="width:auto" /> 1x combate</label><label><input name="onceMission" type="checkbox" style="width:auto" /> 1x missão</label></div>
          <div class="field-row"><label><input name="preparation" type="checkbox" style="width:auto" /> Exige preparação</label><label><input name="drawback" type="checkbox" style="width:auto" /> Desvantagem relevante</label></div>
          ${abilityCombatConfigFields(character?.special_resources||[])}
          <div class="notice" id="cursed-body-vp-preview">VP de referência: 1</div>
          <label>VP definido pelo Mestre<input name="vpApproved" type="number" min="1" value="1" /></label>
          <button class="btn bad">Adicionar habilidade do Corpo</button>
        </form>
        <div class="card"><h3>Habilidades do Corpo</h3><div class="list">${cursedBodyAbilities.length?cursedBodyAbilities.map(a=>`<div>${abilityCard(a)}<button class="btn bad" data-delete-body-ability="${a.id}" style="margin:6px 0 10px">Excluir habilidade do Corpo</button></div>`).join(''):'<p class="muted">Nenhuma habilidade corporal criada.</p>'}</div></div>
      </div>
    </div>`;

  root.innerHTML=`<div style="height:14px"></div>
    <div class="secret-box"><h2>Informações exclusivas do mestre</h2><label>Segredos<textarea id="secret-text">${esc(secret?.secret_text||'')}</textarea></label><button class="btn bad" id="save-secret" style="margin-top:8px">Salvar segredo</button>
    <h3>Progressos ocultos</h3><div class="list">${tracks.map(t=>`<div class="list-item"><div class="title">${esc(t.title)}</div><div class="meta">${t.current_points}${t.target_points!=null?` / ${t.target_points}`:''}</div><div class="body">${esc(t.master_notes||'')}</div></div>`).join('')||'<p class="muted">Nenhum progresso oculto.</p>'}</div>
    <form id="track-form" class="grid" style="margin-top:10px"><div class="field-row"><label>Chave<input name="key" required /></label><label>Título<input name="title" required /></label></div><div class="field-row"><label>Pontos atuais<input name="current" type="number" value="0" /></label><label>Alvo oculto<input name="target" type="number" /></label></div><label>Notas do mestre<textarea name="notes"></textarea></label><label>Recompensa/efeito<textarea name="reward"></textarea></label><button class="btn">Adicionar/atualizar progresso</button></form></div>

    <div style="height:14px"></div>
    <div class="master-zone"><h2>Habilidades da entidade</h2>
      <div class="grid grid-2">
        <form id="master-ability-form" class="card grid">
          <label>Categoria<select name="category">${ABILITY_CATEGORIES.map(c=>`<option value="${c.key}">${c.name}</option>`).join('')}</select></label>
          <label>Nome<input name="name" required /></label>
          <label>Descrição<textarea name="description" placeholder="O que a habilidade representa e faz na ficção."></textarea></label>
          <label>Mecânica<textarea name="mechanics" placeholder="Gatilhos, exceções e regras especiais. A automação vem dos campos estruturados abaixo."></textarea></label>
          <div class="notice ability-builder-note"><strong>Motor estruturado:</strong> use os campos de combate para dizer ao sistema o que deve ser calculado automaticamente. O texto continua sendo a referência humana para regras excepcionais.</div>
          <div class="field-row-3"><label>PA<input name="pa" type="number" min="0" max="7" value="1" /></label><label>EA<input name="ea" type="number" min="0" value="3" /></label><label>Dado<select name="die"><option value="0">Sem dano</option>${[4,6,8,10,12,20].map(v=>`<option value="${v}">d${v}</option>`).join('')}</select></label></div>
          <div class="field-row-3"><label>Qtd. dados<input name="diceCount" type="number" min="0" max="12" value="0" /></label><label>Alcance<select name="range">${Object.entries(VP_OPTIONS.range).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label><label>Alvos<select name="targets">${Object.entries(VP_OPTIONS.targets).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label></div>
          <div class="field-row"><label>Duração<select name="duration">${Object.entries(VP_OPTIONS.duration).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label><label>Condição<select name="condition">${Object.entries(VP_OPTIONS.conditionSeverity).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label></div>
          <label>Condição do compêndio<select name="conditionKey"><option value="">Nenhuma</option>${state.conditions.map(c=>`<option value="${c.key}">${esc(c.name)}</option>`).join('')}</select></label>
          <div class="field-row"><label><input name="onceCombat" type="checkbox" style="width:auto" /> 1x combate</label><label><input name="onceMission" type="checkbox" style="width:auto" /> 1x missão</label></div>
          ${abilityCombatConfigFields(character?.special_resources||[])}
          <div class="notice" id="master-vp-preview">VP estimado: 1</div>
          <label>VP final aprovado<input name="vpApproved" type="number" min="1" value="1" /></label>
          <label><input name="override" type="checkbox" style="width:auto" /> Ignorar limite normal (somente exceção narrativa do mestre)</label>
          <button class="btn primary">Criar habilidade aprovada</button>
        </form>
        <div class="card"><h3>Orçamentos no nível ${character.level}</h3>${['technique','general','manifestation','transformation'].map(k=>`<div class="list-item"><div class="title">${ABILITY_CATEGORIES.find(c=>c.key===k)?.name}</div><div class="meta">${budgets[k].slots} slots • ${budgets[k].vp} VP • máx. individual ${budgets[k].maxSingle}</div></div>`).join('')}<h3>Existentes</h3><div class="list">${normalAbilities.length?normalAbilities.map(a=>abilityCard(a)).join(''):'<p class="muted">Nenhuma habilidade.</p>'}</div></div>
      </div>
    </div>

    ${cursedBodyHtml}

    <div style="height:14px"></div>
    <div id="master-equipment-manager"></div>`;

  root.querySelector('#save-secret').onclick=async()=>{await withBusy(()=>api.saveMasterSecret(character.id,root.querySelector('#secret-text').value),'Segredo salvo.');};
  root.querySelector('#track-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.upsertMasterProgress({character_id:character.id,key:f.get('key'),title:f.get('title'),current_points:Number(f.get('current')||0),target_points:f.get('target')===''?null:Number(f.get('target')),master_notes:f.get('notes'),reward_notes:f.get('reward')}),'Progresso oculto salvo.');renderMasterSecret(root,character);};

  const abilityForm=root.querySelector('#master-ability-form');
  const configFromMasterAbility=()=>abilityConfigFromForm(abilityForm);
  const updateMasterVp=()=>{const vp=estimateAbilityVP(configFromMasterAbility());root.querySelector('#master-vp-preview').textContent=`VP estimado: ${vp}`;const field=abilityForm.elements.vpApproved;if(!field.dataset.touched)field.value=vp;};
  abilityForm.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',()=>{if(el.name==='vpApproved')el.dataset.touched='1';updateMasterVp();}));
  updateMasterVp();
  abilityForm.onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const config=configFromMasterAbility();const estimated=estimateAbilityVP(config);await withBusy(()=>api.createAbility({character_id:character.id,category:f.get('category'),name:f.get('name'),description:f.get('description'),mechanics:f.get('mechanics'),config,vp_estimated:estimated,vp_approved:Number(f.get('vpApproved')||estimated),limit_override:f.get('override')==='on',status:'approved'}),'Habilidade criada.');renderMasterSecret(root,character);};

  const createBodyForm=root.querySelector('#cursed-body-create-form');
  if(createBodyForm) createBodyForm.onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.createCursedBodyTechnique({character_id:character.id,name:String(f.get('name')).trim(),description:f.get('description')||'',master_notes:f.get('masterNotes')||'',is_released:false}),'Técnica do Corpo criada e mantida oculta.');renderMasterSecret(root,character);};

  if(cursedBody){
    const bodyEdit=root.querySelector('#cursed-body-edit-form');
    bodyEdit.onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.updateCursedBodyTechnique(cursedBody.id,{name:String(f.get('name')).trim(),description:f.get('description')||'',master_notes:f.get('masterNotes')||''}),'Técnica do Corpo atualizada.');renderMasterSecret(root,character);};
    root.querySelector('#toggle-cursed-body').onclick=async()=>{const releasing=!cursedBody.is_released;const msg=releasing?'Liberar esta Técnica do Corpo e todas as habilidades atuais para o jogador?':'Retirar o acesso do jogador? As habilidades do Corpo deixarão de poder ser usadas.';if(!confirm(msg))return;await withBusy(()=>api.updateCursedBodyTechnique(cursedBody.id,{is_released:releasing}),releasing?'Técnica do Corpo liberada.':'Acesso à Técnica do Corpo retirado.');renderMasterSecret(root,character);};
    root.querySelector('#delete-cursed-body').onclick=async()=>{if(!confirm(`Excluir definitivamente a Técnica do Corpo "${cursedBody.name}" e todas as habilidades ligadas a ela?`))return;await withBusy(()=>api.deleteCursedBodyTechnique(cursedBody.id),'Técnica do Corpo excluída.');renderMasterSecret(root,character);};

    const bodyAbilityForm=root.querySelector('#cursed-body-ability-form');
    const bodyAbilityConfig=()=>abilityConfigFromForm(bodyAbilityForm);
    const updateBodyVp=()=>{const vp=estimateAbilityVP(bodyAbilityConfig());root.querySelector('#cursed-body-vp-preview').textContent=`VP de referência: ${vp}`;const field=bodyAbilityForm.elements.vpApproved;if(!field.dataset.touched)field.value=vp;};
    bodyAbilityForm.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',()=>{if(el.name==='vpApproved')el.dataset.touched='1';updateBodyVp();}));
    updateBodyVp();
    bodyAbilityForm.onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const config=bodyAbilityConfig();const estimated=estimateAbilityVP(config);await withBusy(()=>api.createAbility({character_id:character.id,cursed_body_technique_id:cursedBody.id,category:f.get('category'),name:f.get('name'),description:f.get('description'),mechanics:f.get('mechanics'),config,vp_estimated:estimated,vp_approved:Number(f.get('vpApproved')||estimated),limit_override:false,status:cursedBody.is_released?'approved':'disabled',master_response:cursedBody.is_released?'Concedida pelo Mestre através da Técnica do Corpo.':'Oculta até o Mestre liberar a Técnica do Corpo.'}),'Habilidade do Corpo criada.');renderMasterSecret(root,character);};
    root.querySelectorAll('[data-delete-body-ability]').forEach(btn=>btn.onclick=async()=>{const a=cursedBodyAbilities.find(x=>x.id===btn.dataset.deleteBodyAbility);if(!a||!confirm(`Excluir a habilidade corporal "${a.name}"?`))return;await withBusy(()=>api.deleteAbility(a.id),'Habilidade do Corpo excluída.');renderMasterSecret(root,character);});
  }

  await renderMasterEquipmentManager(root.querySelector('#master-equipment-manager'),character,combatContext(root),()=>renderMasterSecret(root,character));
  bindConditionLinks(root);
}
function subscribeCombatRealtime(encounterId, rerender) {
  if (state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
  if (!encounterId) return;
  let timer;
  const refresh = () => {
    // Não força a tela de combate se o usuário já navegou para outra aba.
    if (state.tab !== 'combat') return;
    clearTimeout(timer);
    timer = setTimeout(() => rerender(), 180);
  };
  state.realtimeChannel = supabase
    .channel(`combat-${encounterId}-${state.profile.role}`)
    // Participantes, ações e efeitos sinalizam mudanças pelo encontro. O player
    // refaz as projeções seguras sem receber arrays privados pela assinatura.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'roll_logs', filter: `encounter_id=eq.${encounterId}` }, refresh)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'combat_encounters', filter: `id=eq.${encounterId}` }, refresh)
    .subscribe();
}

async function boot(){
  if(!isConfigured) return setupScreen();
  supabase.auth.onAuthStateChange((_event,session)=>{state.authSession=session;});
  const {data}=await supabase.auth.getSession();
  if(!data.session) return authScreen();
  await loadApp();
}

boot();
