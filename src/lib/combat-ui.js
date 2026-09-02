import * as api from './api.js';
import { improvisedFormHtml, bindImprovisedForm, improvisedEventsHtml } from './improvised-combat.js';
import { ATTRIBUTES, SKILLS, ATTRIBUTE_BY_KEY, SKILL_BY_KEY, characterDerived, weaponDamageProfile } from './system.js';
import { equipmentEffectCombatDefaults } from './equipment-ui.js';
import { chooseD20Roll, chooseAbilityRoll, chooseEquipmentEffectRoll, chooseResourceRechargeRoll, chooseBombRoll, findRechargeConfig, runWithRollChoice, finishPhysicalAttack } from './manual-dice.js';

const COMBAT_ENTITY_GROUPS = [
  { key:'player', title:'Players', cls:'player' },
  { key:'npc', title:'NPCs', cls:'npc' },
  { key:'curse', title:'Maldições', cls:'curse' },
  { key:'enemy', title:'Inimigos', cls:'enemy' },
  { key:'summon', title:'Invocações', cls:'summon' },
];

const COMBAT_MODE_LABELS = {
  magic_brush: 'PINCEL MÁGICO',
  flame_monk: 'POSTURA DE LUTA',
};
function combatModeLabel(key) { return COMBAT_MODE_LABELS[key] || key || 'SEM ESTILO'; }


const TARGET_RELATION_LABELS = {
  any: 'Qualquer participante',
  other: 'Qualquer outro participante',
  enemy: 'Inimigo',
  ally: 'Aliado',
  ally_or_self: 'Aliado ou próprio',
  self: 'Próprio',
};

function actorSide(targets=[], actorId='') {
  return targets.find(t=>String(t.character_id)===String(actorId))?.side_key || 'ally';
}

function isRelationAllowed(target, actorId, targets, relation='any') {
  const own = String(target.character_id)===String(actorId);
  const aSide=actorSide(targets,actorId);
  const tSide=target.side_key || (own?aSide:'neutral');
  if(relation==='self') return own;
  if(relation==='other') return !own;
  if(relation==='ally_or_self') return own || tSide===aSide;
  if(relation==='ally') return !own && tSide===aSide;
  if(relation==='enemy') return !own && tSide!==aSide && tSide!=='neutral';
  return true;
}

function inferredTargetRelation(config={}) {
  if(isSelfTarget(config)) return 'self';
  if(config.target_relation) return config.target_relation;
  if(config.requires_attack) return 'other';
  if(config.contest) return 'enemy';
  return 'any';
}

function defaultCombatSide(character) {
  return ['curse','enemy'].includes(character?.entity_type) ? 'enemy' : 'ally';
}

function normalizeCombatSearch(value='') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}

/**
 * Seletor reutilizado tanto antes de iniciar o combate quanto para entradas no
 * meio da cena. A visibilidade é uma propriedade DO PARTICIPANTE no encontro:
 * não altera a ficha original e pode ser trocada pelo Mestre a qualquer hora.
 */
function combatEntityPickerHtml(characters=[], inCombat=new Set(), esc=(v)=>String(v), getName=(c)=>c?.first_name||'Entidade', prefix='combat') {
  const available=characters.filter(c=>!inCombat.has(c.id));
  if(!available.length) return '<p class="muted">Todas as fichas disponíveis já estão no combate.</p>';
  return `<div class="combat-entity-picker" data-combat-picker="${prefix}">
    <div class="combat-picker-toolbar"><label>Pesquisar por nome<input type="search" data-combat-search="${prefix}" placeholder="Digite parte do nome..." autocomplete="off" /></label><span class="pill" data-combat-selection-count="${prefix}">0 selecionado(s)</span></div>
    <div class="notice combat-visibility-help">Visível aos players controla se a ficha aparece na ordem de iniciativa deles. <strong>Alvo válido</strong> controla se pode aparecer nos seletores de alvo. Se Visível estiver desligado, o alvo também fica indisponível para jogadores.</div>
    ${COMBAT_ENTITY_GROUPS.map(group=>{
      const rows=available.filter(c=>c.entity_type===group.key);
      if(!rows.length) return '';
      return `<section class="combat-entity-group entity-group-${group.cls}" data-combat-picker-group="${prefix}"><div class="combat-entity-group-title"><span class="entity-group-dot"></span>${group.title}<span class="pill">${rows.length}</span></div><div class="combat-picker-list">${rows.map(c=>{
        const name=getName(c);
        const side=defaultCombatSide(c);
        return `<div class="combat-picker-row entity-type-${group.cls}" data-combat-entity-row="${prefix}" data-character-id="${c.id}" data-search-name="${esc(normalizeCombatSearch(name))}">
          <label class="combat-picker-select"><input type="checkbox" data-combat-select="${prefix}" value="${c.id}" /> <span><strong>${esc(name)}</strong><span class="muted small">${esc(group.title.replace(/s$/,''))} • Nv ${Number(c.level||0)} • ${esc(c.grade||'Sem Grau')}</span></span></label>
          <label>Lado<select data-combat-side="${prefix}:${c.id}"><option value="ally" ${side==='ally'?'selected':''}>Aliado</option><option value="enemy" ${side==='enemy'?'selected':''}>Inimigo</option><option value="neutral">Neutro</option></select></label>
          <label class="combat-toggle"><input type="checkbox" data-combat-visible="${prefix}:${c.id}" checked /> Visível aos players</label>
          <label class="combat-toggle"><input type="checkbox" data-combat-targetable="${prefix}:${c.id}" checked /> Alvo válido</label>
        </div>`;
      }).join('')}</div></section>`;
    }).join('')}
  </div>`;
}

function bindCombatEntityPicker(root, prefix) {
  const search=root.querySelector(`[data-combat-search="${prefix}"]`);
  const rows=[...root.querySelectorAll(`[data-combat-entity-row="${prefix}"]`)];
  const selected=[...root.querySelectorAll(`[data-combat-select="${prefix}"]`)];
  const count=root.querySelector(`[data-combat-selection-count="${prefix}"]`);
  const syncCount=()=>{ if(count) count.textContent=`${selected.filter(x=>x.checked).length} selecionado(s)`; };
  const syncSearch=()=>{
    const q=normalizeCombatSearch(search?.value||'');
    rows.forEach(row=>{ row.hidden=Boolean(q && !String(row.dataset.searchName||'').includes(q)); });
    root.querySelectorAll(`[data-combat-picker-group="${prefix}"]`).forEach(group=>{
      group.hidden=![...group.querySelectorAll(`[data-combat-entity-row="${prefix}"]`)].some(row=>!row.hidden);
    });
  };
  selected.forEach(x=>x.addEventListener('change',syncCount));
  search?.addEventListener('input',syncSearch);
  syncCount(); syncSearch();
}

function collectCombatPickerEntries(root, prefix) {
  return [...root.querySelectorAll(`[data-combat-select="${prefix}"]:checked`)].map(input=>{
    const id=input.value;
    const row=input.closest(`[data-combat-entity-row="${prefix}"]`);
    return {
      character_id:id,
      side_key:row?.querySelector('[data-combat-side]')?.value||'neutral',
      visible_to_players:Boolean(row?.querySelector('[data-combat-visible]')?.checked),
      targetable_by_players:Boolean(row?.querySelector('[data-combat-targetable]')?.checked),
    };
  });
}

function optionList(items, selected='') {
  return items.map(item => `<option value="${item.key}" ${item.key===selected?'selected':''}>${item.name}</option>`).join('');
}

function modeFields(prefix='') {
  return `<div class="field-row"><label>Modo<select name="${prefix}mode"><option value="normal">Normal</option><option value="advantage">Vantagem</option><option value="disadvantage">Desvantagem</option></select></label><label>Quantidade de d20<input name="${prefix}count" type="number" min="1" max="10" value="2" /></label></div>`;
}

function sourceDefaults(ability) {
  const c = ability?.config || {};
  const techniqueLike = ['technique','manifestation','transformation','domain'].includes(ability?.category);
  const damageCount = Number(c.damage_dice_count || 0);
  return {
    requiresAttack: c.requires_attack ?? (damageCount > 0 || Boolean(c.condition_key)),
    attackAttributeKey: c.attack_attribute_key || (techniqueLike ? 'cursed_control' : 'strength'),
    attackSkillKey: c.attack_skill_key || (techniqueLike ? 'technique_control' : 'fight'),
    paCost: Number(c.pa_cost ?? 1),
    eaCost: Number(c.ea_cost ?? 0),
    usesCursedEnergy: c.uses_cursed_energy ?? (Number(c.ea_cost || 0) > 0),
    forcedCritical: Boolean(c.forced_critical),
    criticalThreshold: Number(c.critical_threshold || 20),
    damageDiceCount: damageCount,
    damageDie: Number(c.damage_die || 0),
    damageFlatAttributeKey: c.damage_flat_attribute_key || (damageCount ? (techniqueLike ? 'cursed_control' : 'strength') : null),
    conditionKey: c.condition_key || null,
  };
}

function equipmentDefaults(item) {
  const c = item?.attack_config || {};
  return {
    enabled: Boolean(c.enabled),
    attackAttributeKey: c.attack_attribute_key || 'strength',
    attackSkillKey: c.attack_skill_key || 'fight',
    paCost: Number(c.pa_cost ?? 1),
    eaCost: Number(c.ea_cost ?? 0),
    usesCursedEnergy: Boolean(c.uses_cursed_energy),
    forcedCritical: Boolean(c.forced_critical),
    criticalThreshold: Number(c.critical_threshold || 20),
    damageDiceCount: Number(c.damage_dice_count ?? 1),
    damageDie: Number(c.damage_die ?? 8),
    damageFlatAttributeKey: c.damage_flat_attribute_key || 'strength',
    conditionKey: c.condition_key || null,
  };
}

function targetOptions(targets, actorId, selected='') {
  return targets.filter(t=>t.character_id!==actorId && !t.defeated).map(t=>`<option value="${t.character_id}" ${t.character_id===selected?'selected':''}>${t.display_name} • CA ${t.ca}</option>`).join('');
}

function conditionNames(keys, conditions, esc) {
  const names=(keys||[]).map(key=>conditions.find(c=>c.key===key)?.name || 'Efeito ativo');
  return names.length ? names.map(n=>`<span class="pill warn">${esc(n)}</span>`).join(' ') : '<span class="muted small">Sem condições</span>';
}

function actionCard(action, ctx) {
  const { esc, state } = ctx;
  const statusLabel={pending_defense:'Aguardando defesa',miss:'Não acertou',defended:'Defendido',resolved:'Resolvido',cancelled:'Cancelado'}[action.status]||'Ação';
  const defenseLabel={dodge:'Esquiva',defend:'Bloqueio',reinforce:'Reforço',fortitude:'Resistência',accept:'Golpe aceito'}[action.defense_type]||'Defesa';
  const incoming = state.profile.role!=='master' && action.target_character_id===state.character?.id;
  const attackText = action.attack_hidden
    ? '<strong>Rolagem do Mestre oculta.</strong>'
    : action.attack_total!=null
      ? `Ataque: <strong>${action.attack_total}</strong>${action.attack_natural!=null?` (natural ${action.attack_natural})`:''}`
      : '';
  const defenseText = action.defense_type
    ? action.defense_hidden
      ? '<br>Defesa do Mestre: <strong>oculta</strong>'
      : `<br>${defenseLabel}: ${action.defense_total??'—'}${action.defense_natural!=null?` (natural ${action.defense_natural})`:''}`
    : '';
  const tags=[action.is_critical?'<span class="pill warn">Crítico</span>':'',action.is_kokusen?'<span class="pill bad">Kokusen</span>':'',action.kokusen_denied?'<span class="pill">Kokusen anulado</span>':''].filter(Boolean).join(' ');
  // O Mestre pode resolver qualquer reação pendente (útil para NPCs e para destravar testes).
  // Jogadores só podem reagir quando são o alvo da ação.
  const pending = action.status==='pending_defense' && (state.profile.role==='master' || incoming);
  const counter = action.counterattack_available && (state.profile.role==='master' || action.target_character_id===state.character?.id);
  return `<div class="list-item combat-action ${pending?'incoming':''}">
    <div class="btn-row"><div class="title">${esc(action.attacker_name)} → ${esc(action.target_name)} • ${esc(action.label)}</div><span class="pill">${statusLabel}</span>${tags}</div>
    <div class="body">${attackText}${defenseText}${action.damage_total>0?`<br>Dano: <strong>${action.damage_total}</strong>${action.damage_reduction==='half'?' (reduzido pela metade)':''}`:''}${action.summary?`<br>${esc(action.summary)}`:''}</div>
    ${pending?`<div class="reaction-panel" data-reaction="${action.id}"><div class="notice">O ataque superou sua CA. Escolha uma reação ou aceite o golpe.</div><div class="btn-row" style="margin-top:8px"><button class="btn" data-defense="dodge" data-action="${action.id}">Esquivar • 1 PA</button><button class="btn" data-defense="defend" data-action="${action.id}">Defender • 1 PA</button><button class="btn" data-defense="reinforce" data-action="${action.id}">Reforçar • 1 PA</button><button class="btn" data-defense="fortitude" data-action="${action.id}">Resistir • 1 PA</button><button class="btn bad" data-defense="accept" data-action="${action.id}">Aceitar golpe</button></div></div>`:''}
    ${counter?`<div class="btn-row" style="margin-top:8px"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" style="width:auto" data-counter-ea="${action.id}" /> Reforçar contra-ataque com 1 EA</label><button class="btn good" data-counter="${action.id}">Contra-atacar • 1 PA</button></div>`:''}
  </div>`;
}

function participantCard(p, ctx, editable=false, activeParticipantId=null, caMap={}) {
  const { esc, state } = ctx;
  const c=p.characters; const d=characterDerived(c);
  const conditions=Array.isArray(p.conditions)?p.conditions:[];
  const displayName=[c.first_name,c.last_name].filter(Boolean).join(' ') || 'Personagem';
  const isActive=p.id===activeParticipantId;
  const anotherActive=Boolean(activeParticipantId && !isActive);
  const turnControls=editable
    ? (isActive
      ? `<button class="btn warn" data-end-turn="${p.id}" data-turn-name="${esc(displayName)}">Encerrar turno</button>`
      : `<button class="btn good" data-start-turn="${p.id}" data-turn-name="${esc(displayName)}" ${anotherActive?'disabled':''}>Iniciar turno</button>`)
    : (isActive
      ? `<button class="btn warn" data-end-turn="${p.id}" data-turn-name="${esc(displayName)}">Encerrar meu turno</button>`
      : '');
  return `<div class="list-item combat-participant ${isActive?'turn-active':''}" data-participant="${p.id}">
    <div class="btn-row"><div class="title">${esc(displayName)}</div><span class="pill">Iniciativa ${p.initiative}</span>${editable?`<span class="pill ${p.visible_to_players===false?'bad':'good'}">${p.visible_to_players===false?'OCULTO DOS PLAYERS':'VISÍVEL'}</span><span class="pill ${p.targetable_by_players===false?'warn':'good'}">${p.targetable_by_players===false?'NÃO É ALVO':'ALVO VÁLIDO'}</span>`:''}${p.active_combat_mode?`<span class="pill combat-mode-pill">${esc(combatModeLabel(p.active_combat_mode))}</span>`:''}${p.combat_bridge_type?`<span class="pill warn">Ritmo Híbrido: ${p.combat_bridge_type==='brush_damage'?'+1 dano na próxima pintura':'+1 acerto no próximo corpo a corpo'}</span>`:''}${isActive?'<span class="pill good">TURNO ATIVO</span>':''}${p.black_flash_turns>0?`<span class="pill bad">Fluxo Negro ${p.black_flash_turns}</span>`:''}${p.defeated?'<span class="pill bad">Derrotado</span>':''}</div>
    <div class="grid grid-4 compact-stats" style="margin-top:10px"><div><span class="muted small">PS</span><div><strong>${p.current_ps??d.ps}</strong> / ${d.ps}</div></div><div><span class="muted small">EA</span><div><strong>${p.current_ea??d.ea}</strong> / ${d.ea}</div></div><div><span class="muted small">PA</span><div><strong>${p.current_pa??d.pa}</strong> / ${d.pa}</div></div><div><span class="muted small">CA</span><div><strong>${caMap[p.character_id]??d.ca}</strong></div></div></div>
    <div style="margin-top:9px">${conditionNames(conditions,state.conditions,esc)}</div>
    ${editable?`<div class="field-row-3" style="margin-top:10px"><label>PS<input data-cps="${p.id}" type="number" value="${p.current_ps??d.ps}" /></label><label>EA<input data-cea="${p.id}" type="number" value="${p.current_ea??d.ea}" /></label><label>PA<input data-cpa="${p.id}" type="number" value="${p.current_pa??d.pa}" /></label></div><label class="combat-side-field" style="margin-top:8px">Lado no combate<select data-cside="${p.id}"><option value="ally" ${p.side_key==='ally'?'selected':''}>Aliado</option><option value="enemy" ${p.side_key==='enemy'?'selected':''}>Inimigo</option><option value="neutral" ${p.side_key==='neutral'?'selected':''}>Neutro</option></select><span class="muted small">Define relações de aliado/inimigo para habilidades. Não altera a categoria da ficha.</span></label><div class="combat-participant-visibility"><label class="combat-toggle"><input type="checkbox" data-cvisible="${p.id}" ${p.visible_to_players===false?'':'checked'} /> Visível aos players</label><label class="combat-toggle"><input type="checkbox" data-ctargetable="${p.id}" ${p.targetable_by_players===false?'':'checked'} /> Alvo válido para players</label><span class="muted small">Esses controles são do encontro. Ocultar remove a ficha da iniciativa e dos alvos dos jogadores; deixar visível e desmarcar Alvo permite mostrar alguém sem deixá-lo selecionável.</span></div>`:''}
    <div class="btn-row" style="margin-top:8px">${editable?`<button class="btn" data-save-combat="${p.id}">Salvar recursos</button>`:''}<button class="btn" data-roll-init="${p.id}">Rolar iniciativa</button>${turnControls}</div>
    ${conditions.length&&(editable||isActive)?`<div class="btn-row" style="margin-top:8px">${conditions.filter(k=>editable||state.conditions.some(c=>c.key===k)).map(k=>`<button class="btn ghost" data-remove-condition="${p.id}" data-condition="${esc(k)}">Remover ${esc(state.conditions.find(c=>c.key===k)?.name||'efeito ativo')}</button>`).join('')}</div>`:''}
  </div>`;
}

async function bindCommonCombatButtons(root, ctx, encounterId, rerender) {
  const { toast, withBusy, state }=ctx;
  const playerOwnsRoll=state.profile.role!=='master';
  root.querySelectorAll('[data-defense]').forEach(btn=>btn.onclick=async()=>{
    const actionId=btn.dataset.action; const type=btn.dataset.defense;
    if(type==='accept' || !playerOwnsRoll){
      await withBusy(()=>api.resolveCombatDefense(actionId,type,'normal',1,encounterId),type==='accept'?'Golpe resolvido.':'Reação resolvida.');
      rerender(); return;
    }
    const title=type==='dodge'?'Esquivar':type==='defend'?'Defender':type==='reinforce'?'Reforçar':'Resistir';
    const choice=await chooseD20Roll({title,mode:'normal',count:1,label:'Defesa',details:'Role 1d20 natural. O site soma automaticamente o bônus defensivo correto.'});
    const executed=await runWithRollChoice(choice,()=>withBusy(()=>api.resolveCombatDefense(actionId,type,'normal',1,encounterId),'Reação resolvida.'));
    if(!executed.cancelled) rerender();
  });
  root.querySelectorAll('[data-counter]').forEach(btn=>btn.onclick=async()=>{
    const id=btn.dataset.counter; const useEA=Boolean(root.querySelector(`[data-counter-ea="${id}"]`)?.checked);
    let mode='normal',count=1;
    if(playerOwnsRoll){
      const participants=await api.getCombatParticipants(encounterId);
      const mine=participants.find(p=>String(p.character_id)===String(state.character?.id));
      count=Math.max(1,Number(mine?.counterattack_count||0)+1);
      mode=count>1?'disadvantage':'normal';
    }
    const choice=playerOwnsRoll
      ? await chooseD20Roll({title:'Contra-ataque',mode,count,label:'Ataque',details:count>1?`Este é o ${count}º contra-ataque antes do próximo turno: use o menor d20.`:'Role o d20 natural. O site soma Força + Lutar e demais bônus.'})
      : {source:'digital',tokens:[]};
    const executed=await runWithRollChoice(choice,()=>withBusy(()=>api.createBasicCounterattack(id,useEA,encounterId),'Contra-ataque realizado.'));
    if(executed.cancelled)return;
    if(choice?.source==='physical') await finishPhysicalAttack(executed.value,'Dano do contra-ataque');
    rerender();
  });
  root.querySelectorAll('[data-roll-init]').forEach(btn=>btn.onclick=async()=>{
    if(!playerOwnsRoll){
      const total=await withBusy(()=>api.rollCombatInitiative(btn.dataset.rollInit,encounterId));
      toast(`Iniciativa: ${total}`,'good'); rerender(); return;
    }
    const choice=await chooseD20Roll({title:'Iniciativa',mode:'normal',count:1,label:'Iniciativa',details:'Informe o d20 natural. Destreza + Reflexos são aplicados pelo sistema.'});
    const executed=await runWithRollChoice(choice,()=>withBusy(()=>api.rollCombatInitiative(btn.dataset.rollInit,encounterId),'Iniciativa registrada.'));
    if(!executed.cancelled){toast(`Iniciativa: ${executed.value}`,'good');rerender();}
  });
  root.querySelectorAll('[data-start-turn]').forEach(btn=>btn.onclick=async()=>{
    const name=btn.dataset.turnName||'';
    await withBusy(()=>api.startCombatTurn(btn.dataset.startTurn,encounterId,name),name?`Sua vez, ${name}.`:'Turno iniciado.');
    rerender();
  });
  root.querySelectorAll('[data-end-turn]').forEach(btn=>btn.onclick=async()=>{
    const name=btn.dataset.turnName||'';
    await withBusy(()=>api.endCombatTurn(btn.dataset.endTurn,encounterId,name),'Turno encerrado.');
    rerender();
  });
  root.querySelectorAll('[data-remove-condition]').forEach(btn=>btn.onclick=async()=>{
    await withBusy(()=>api.removeCombatCondition(btn.dataset.removeCondition,btn.dataset.condition,encounterId),'Condição removida.');
    rerender();
  });
}

function mergedModeConfig(source, modeKey=null) {
  const base={...(source?.config||{})};
  if (!modeKey) return base;
  const mode=(Array.isArray(base.modes)?base.modes:[]).find(m=>String(m.key)===String(modeKey));
  return mode ? {...base,...mode,modes:base.modes,overloads:base.overloads} : base;
}

function abilityVariants(ability) {
  const modes=Array.isArray(ability?.config?.modes)?ability.config.modes:[];
  return modes.length
    ? modes.map(m=>({modeKey:m.key,label:m.label||m.key,config:mergedModeConfig(ability,m.key)}))
    : [{modeKey:null,label:ability.name,config:mergedModeConfig(ability,null)}];
}

function effectVariants(effect) {
  const modes=Array.isArray(effect?.config?.modes)?effect.config.modes:[];
  return modes.length
    ? modes.map(m=>({modeKey:m.key,label:m.label||m.key,config:{...(effect.config||{}),...m,modes:effect.config.modes}}))
    : [{modeKey:null,label:effect.name,config:{...(effect.config||{})}}];
}

function isReactionConfig(config={}) {
  return Boolean(config.is_reaction) || config.activation_timing==='reaction';
}

function isSelfTarget(config={}) {
  return config.target_mode==='self' || config.targets==='self' || config.range==='self';
}

function configCostText(config={}) {
  const parts=[`${Number(config.pa_cost||0)} PA`,`${Number(config.ea_cost||0)} EA`];
  const r=config.resource_cost;
  if (r?.key && Number(r.amount||0)>0) parts.push(`${Number(r.amount)} recurso especial`);
  if (Number(config.self_damage_dice_count||0)>0 && Number(config.self_damage_die||0)>0) parts.push(`${config.self_damage_dice_count}d${config.self_damage_die} PS`);
  if (config.once_per_combat) parts.push('1×/combate');
  if (config.once_per_combat_per_target) parts.push('1×/combate por alvo');
  if (config.once_per_round) parts.push('1×/rodada');
  return parts.join(' • ');
}

function overloadSelectHtml(ability, key, esc, disabled=false) {
  const overloads=Array.isArray(ability?.config?.overloads)?ability.config.overloads:[];
  if(!overloads.length) return '';
  return `<label style="margin-top:8px">Execução<select data-overload="${key}" ${disabled?'disabled':''}><option value="">Normal</option>${overloads.map(o=>`<option value="${esc(o.key)}">${esc(o.label||o.key)}</option>`).join('')}</select></label>`;
}

function targetControlHtml({config,key,targets,actorId,actorName,esc,disabled=false,prefix='ability'}) {
  const special=config.special_action||'';
  if(special==='set_combat_mode' || special==='boost_recent_attack' || config.combat_usable===false) return '';
  if(isSelfTarget(config)) return `<div class="meta" style="margin-top:8px">Alvo: <strong>${esc(actorName)}</strong> (próprio)</div>`;
  const relation=inferredTargetRelation(config);
  const available=targets.filter(t=>!t.defeated && t.selectable!==false && isRelationAllowed(t,actorId,targets,relation));
  const multiple=config.target_mode==='multiple' || config.targets==='few' || config.targets==='area';
  if(multiple) {
    const opts=available.map(t=>`<option value="${t.character_id}">${esc(t.display_name)} • CA ${t.ca}</option>`).join('');
    return `<label style="margin-top:8px">Alvos <span class="muted small">${relation!=='any'?`• ${esc(TARGET_RELATION_LABELS[relation]||relation)}`:''} • Ctrl/clique para vários</span><select multiple size="${Math.min(6,Math.max(2,available.length))}" data-${prefix}-targets="${key}" ${disabled?'disabled':''}>${opts}</select></label>`;
  }
  const opts=available.map(t=>`<option value="${t.character_id}">${esc(t.display_name)} • CA ${t.ca}</option>`).join('');
  return `<label style="margin-top:8px">Alvo <span class="muted small">${relation!=='any'?`(${esc(TARGET_RELATION_LABELS[relation]||relation)})`:''}</span><select data-${prefix}-target="${key}" ${disabled?'disabled':''}>${opts||'<option value="">Nenhum alvo válido</option>'}</select></label>`;
}

function structuredMechanicsHtml(cfg={}, esc=(v)=>String(v)) {
  const rows=[];
  if(cfg.requires_attack) rows.push(`<span><b>Teste:</b> ${esc(ATTRIBUTE_BY_KEY[cfg.attack_attribute_key]?.name||cfg.attack_attribute_key||'—')} + ${esc(SKILL_BY_KEY[cfg.attack_skill_key]?.name||cfg.attack_skill_key||'—')}</span>`);
  if(cfg.contest) rows.push(`<span><b>Resistência:</b> ${esc(ATTRIBUTE_BY_KEY[cfg.contest.defender_attribute]?.name||cfg.contest.defender_attribute||'—')} + ${esc(SKILL_BY_KEY[cfg.contest.defender_skill]?.name||cfg.contest.defender_skill||'—')}</span>`);
  if(Number(cfg.damage_dice_count||0)>0 && Number(cfg.damage_die||0)>0) rows.push(`<span><b>Dano:</b> ${Number(cfg.damage_dice_count)}d${Number(cfg.damage_die)}${cfg.damage_flat_attribute_key?` + Mod. ${esc(ATTRIBUTE_BY_KEY[cfg.damage_flat_attribute_key]?.name||cfg.damage_flat_attribute_key)}`:''}${Number(cfg.damage_flat_bonus||0)?` + ${Number(cfg.damage_flat_bonus)}`:''}</span>`);
  if(Number(cfg.healing_dice_count||0)>0 && Number(cfg.healing_die||0)>0) rows.push(`<span><b>Cura:</b> ${Number(cfg.healing_dice_count)}d${Number(cfg.healing_die)}${cfg.healing_flat_attribute_key?` + Mod. ${esc(ATTRIBUTE_BY_KEY[cfg.healing_flat_attribute_key]?.name||cfg.healing_flat_attribute_key)}`:''}</span>`);
  const relation=inferredTargetRelation(cfg); if(relation!=='any') rows.push(`<span><b>Alvo:</b> ${esc(TARGET_RELATION_LABELS[relation]||relation)}</span>`);
  if(cfg.once_per_round) rows.push('<span><b>Limite:</b> 1× por rodada</span>');
  if(cfg.once_per_combat_per_target) rows.push('<span><b>Limite:</b> 1× por combate por alvo</span>');
  if(cfg.once_per_combat) rows.push('<span><b>Limite:</b> 1× por combate</span>');
  return rows.length?`<div class="ability-structured-summary">${rows.join('')}</div>`:'';
}

function abilityCardCombat({ability,variant,targets,actorId,actorName,esc,enabled,locked=false,prefix='ability',summonName='',activeCombatMode=null,boostableActions=[]}) {
  const cfg=variant.config||{};
  const reaction=isReactionConfig(cfg);
  const special=cfg.special_action||'';
  const requiredMode=cfg.requires_combat_mode||null;
  const modeLocked=Boolean(requiredMode && special!=='set_combat_mode' && activeCombatMode!==requiredMode);
  const alreadyMode=special==='set_combat_mode' && activeCombatMode===cfg.combat_mode_key;
  const nonCombat=cfg.combat_usable===false;
  const canUse=!nonCombat && !locked && !modeLocked && !alreadyMode && (enabled || reaction);
  const key=`${ability.id}:${variant.modeKey||'base'}`;
  const resourceText=cfg.resource_cost?.key?` • usa ${Number(cfg.resource_cost.amount||1)} ${esc(cfg.resource_cost.label||cfg.resource_cost.key)}`:'';
  const notices=[];
  if(locked) notices.push(`TRAVADO: manifeste ${esc(summonName||'a invocação')} para liberar esta habilidade.`);
  if(modeLocked) notices.push(`TRAVADO: exige ${esc(combatModeLabel(requiredMode))}. Escolha esse estilo no início do seu turno.`);
  if(alreadyMode) notices.push(`${esc(combatModeLabel(cfg.combat_mode_key))} já está ativo.`);
  if(nonCombat) notices.push('Esta capacidade é de uso narrativo/fora do combate e não gera um botão de execução aqui.');
  const lockNote=notices.map(n=>`<div class="notice" style="margin-top:8px">${n}</div>`).join('');
  const reactionPill=reaction?'<span class="pill good">REAÇÃO</span>':'';
  const bodyPill=ability.cursed_body_technique_id?'<span class="pill bad">TÉCNICA DO CORPO</span>':'';
  const stylePill=requiredMode||special==='set_combat_mode'?`<span class="pill combat-mode-pill">${esc(combatModeLabel(requiredMode||cfg.combat_mode_key))}</span>`:'';
  const nonCombatPill=nonCombat?'<span class="pill">FORA DE COMBATE</span>':'';
  const modeTitle=variant.modeKey?`<div class="meta">Modo: ${esc(variant.label)}</div>`:'';
  const overload=overloadSelectHtml(ability,key,esc,!canUse);
  const target=targetControlHtml({config:cfg,key,targets,actorId,actorName,esc,disabled:!canUse,prefix});
  const weaponOptions=special==='create_weapon'?`<div class="field-row" style="margin-top:8px"><label>Perfil da arma<select data-weapon-profile="${key}" ${canUse?'':'disabled'}><option value="light">Leve • 1 PS</option><option value="standard" selected>Padrão • 1d4 PS</option><option value="heavy">Pesada • 1d6 PS</option><option value="very_heavy">Muito pesada • 1d8 PS</option></select></label><label>Atributo da arma<select data-weapon-attribute="${key}" ${canUse?'':'disabled'}><option value="strength">Força</option><option value="dexterity">Destreza</option></select></label></div>`:'';
  const secondaryOverloads=(Array.isArray(ability?.config?.overloads)?ability.config.overloads:[]).filter(o=>o?.overrides?.requires_secondary_target);
  const secondaryKeys=secondaryOverloads.map(o=>String(o.key));
  // Uma execução/modo pode exigir segundo alvo por si só, mesmo sem existir um
  // seletor de Sobrecarga. Nesse caso o campo precisa nascer visível.
  const secondaryAlways=Boolean(cfg.requires_secondary_target && !secondaryOverloads.some(o=>String(o.key)===String(variant.modeKey||'')));
  const relation=cfg.secondary_target_relation||secondaryOverloads[0]?.overrides?.secondary_target_relation||inferredTargetRelation(cfg);
  const secondaryOptions=targets.filter(t=>!t.defeated && t.selectable!==false && String(t.character_id)!==String(actorId) && isRelationAllowed(t,actorId,targets,relation)).map(t=>`<option value="${t.character_id}">${esc(t.display_name)} • CA ${t.ca}</option>`).join('');
  const secondary=(secondaryKeys.length||secondaryAlways)?`<label class="ability-secondary-target" data-secondary-wrap="${key}" data-secondary-overloads="${esc(secondaryKeys.join(','))}" data-secondary-always="${secondaryAlways?'1':'0'}" style="display:${secondaryAlways?'block':'none'};margin-top:8px">Segundo alvo <span class="muted small">(deve ser diferente do alvo principal)</span><select data-secondary-target="${key}" ${canUse?'':'disabled'}>${secondaryOptions||'<option value="">Nenhum segundo alvo válido</option>'}</select></label>`:'';
  const recentRelation=cfg.recent_action_actor_relation||'any';
  const recent=boostableActions.filter(a=>{
    if(recentRelation==='any') return true;
    const sourceTarget=targets.find(t=>String(t.character_id)===String(a.attacker_character_id));
    return sourceTarget ? isRelationAllowed(sourceTarget,actorId,targets,recentRelation) : false;
  }).slice(0,8).map(a=>`<option value="${a.id}">${esc(a.attacker_name)} → ${esc(a.target_name)} • ${esc(a.label)} • ${a.attack_total??'—'} vs CA ${a.target_ca??'—'}</option>`).join('');
  const actionPicker=special==='boost_recent_attack'?`<label style="margin-top:8px">Ataque que acabou de ser rolado<select data-recent-action="${key}" ${canUse&&recent?'':'disabled'}>${recent||'<option value="">Nenhum ataque elegível agora</option>'}</select></label>`:'';
  const buttonLabel=special==='activate_summon'?'Manifestar':special==='create_weapon'?'Criar arma':special==='set_combat_mode'?(alreadyMode?'Estilo ativo':cfg.combat_mode_key==='magic_brush'?'Invocar Pincel Mágico':'Assumir Postura de Luta'):special==='place_delayed_bomb'?'Preparar bomba':special==='boost_recent_attack'?'Aplicar bônus no acerto':'Usar habilidade';
  const button=nonCombat?'':`<button class="btn primary" data-${prefix}-use="${key}" data-ability-id="${ability.id}" data-mode-key="${esc(variant.modeKey||'')}" style="margin-top:8px" ${canUse?'':'disabled'}>${buttonLabel}</button>`;
  return `<div class="list-item ${locked||modeLocked?'locked':''}"><div class="btn-row"><div class="title">${esc(ability.name)}</div>${bodyPill}${stylePill}${reactionPill}${nonCombatPill}${locked||modeLocked?'<span class="pill bad">TRAVADO</span>':''}</div>${modeTitle}<div class="meta">${esc(configCostText(cfg))}${resourceText}</div><div class="body">${esc(ability.description||'')}</div>${structuredMechanicsHtml(cfg,esc)}${ability.mechanics?`<details class="ability-rules-details"><summary>Regras completas</summary><div class="body">${esc(ability.mechanics)}</div></details>`:''}${target}${overload}${secondary}${actionPicker}${weaponOptions}${lockNote}${button}</div>`;
}

function bindStructuredAbilityControls(root) {
  // O campo de segundo alvo pode ser condicionado a uma Sobrecarga OU ser uma
  // exigência permanente de um modo. Processamos o próprio wrapper, em vez de
  // depender da existência de um <select data-overload>.
  root.querySelectorAll('[data-secondary-wrap]').forEach(wrap=>{
    const key=wrap.dataset.secondaryWrap;
    const overload=root.querySelector(`[data-overload="${CSS.escape(key)}"]`);
    const valid=(wrap.dataset.secondaryOverloads||'').split(',').filter(Boolean);
    const always=wrap.dataset.secondaryAlways==='1';
    const primarySelectors=[
      `[data-ability-target="${CSS.escape(key)}"]`,
      `[data-master-ability-target="${CSS.escape(key)}"]`,
      `[data-master-reaction-target="${CSS.escape(key)}"]`,
    ].join(', ');
    const primaries=root.querySelectorAll(primarySelectors);
    const sync=()=>{
      const active=always || Boolean(overload && valid.includes(overload.value));
      wrap.style.display=active?'block':'none';
      const secondary=wrap.querySelector('select');
      if(secondary) secondary.disabled=!active || Boolean(overload?.disabled);
      const primary=[...primaries].find(Boolean);
      if(primary && secondary){
        [...secondary.options].forEach(o=>o.disabled=Boolean(primary.value && o.value===primary.value));
        if(secondary.value===primary.value){
          const next=[...secondary.options].find(o=>!o.disabled&&o.value);
          secondary.value=next?.value||'';
        }
      }
    };
    overload?.addEventListener('change',sync);
    primaries.forEach(p=>p.addEventListener('change',sync));
    sync();
  });
}

function equipmentEffectCardCombat({item,effect,variant,targets,actorId,actorName,esc,enabled,prefix='equipment-effect'}) {
  const cfg=variant.config||{};
  const reaction=effect.type==='reaction' || isReactionConfig(cfg);
  const canUse=enabled || reaction;
  const key=`${item.id}:${effect.id}:${variant.modeKey||'base'}`;
  const target=targetControlHtml({config:cfg,key,targets,actorId,actorName,esc,disabled:!canUse,prefix});
  const special=cfg.special_action||'';
  const useLabel=special==='reroll_recent_damage'?'Rerrolar dano':special==='reroll_recent_attack_against_self'?'Forçar nova rolagem de acerto':special==='reroll_recent_natural_one'?'Rerrolar 1 natural':'Usar efeito';
  return `<div class="list-item"><div class="btn-row"><div class="title">${esc(item.name)} • ${esc(effect.name)}</div>${reaction?'<span class="pill good">REAÇÃO</span>':''}</div>${variant.modeKey?`<div class="meta">Modo: ${esc(variant.label)}</div>`:''}<div class="meta">${esc(configCostText(cfg))}</div><div class="body">${esc(effect.mechanics||effect.description||'')}</div>${target}${structuredMechanicsHtml(cfg,esc)}<button class="btn primary" data-${prefix}-use="${key}" data-item-id="${item.id}" data-effect-id="${esc(effect.id)}" data-mode-key="${esc(variant.modeKey||'')}" style="margin-top:8px" ${canUse?'':'disabled'}>${useLabel}</button></div>`;
}

function combatEffectsHtml(effects, characterId, esc, {ownTurn=false,prefix='combat'}={}) {
  const mine=effects.filter(e=>e.target_character_id===characterId);
  if(!mine.length) return '<span class="muted small">Nenhum efeito temporário ativo.</span>';
  return mine.map(e=>{
    const data=e?.data&&typeof e.data==='object'?e.data:{};
    const extinguishCost=Number(e.extinguish_pa_cost??data.extinguish_pa_cost??0);
    const extinguish=extinguishCost>0?`<button class="btn ghost" data-extinguish-effect="${e.id}" ${ownTurn?'':'disabled'}>Apagar • ${extinguishCost} PA</button>`:'';
    const detonate=e.can_detonate||(e.effect_key==='art_bomb'&&e.source_character_id===characterId)?`<button class="btn bad" data-detonate-bomb="${characterId}">Detonar no fim da rodada</button>`:'';
    const manage=prefix==='master'&&e.source_type==='improvised'?`<button class="btn ghost" data-remove-improvised="${e.id}">Remover</button>${e.uses_remaining!=null?`<button class="btn ghost" data-consume-improvised="${e.id}">Consumir uso</button>`:''}`:'';
    return `<span class="combat-effect-chip"><span class="pill warn">${esc(e.name)}${e.remaining_turns!=null?` • ${e.remaining_turns} turno(s)`:''}${e.uses_remaining!=null?` • ${e.uses_remaining} uso(s)`:''}</span>${e.description?`<span class="small">${esc(e.description)}</span>`:''}${extinguish}${detonate}${manage}</span>`;
  }).join(' ');
}

function specialResourcesHtml(participant, esc, ownTurn, prefix='resource') {
  const resources=participant?.resources && typeof participant.resources==='object'?participant.resources:{};
  const entries=Object.entries(resources);
  if(!entries.length) return '';
  return `<div class="list" style="margin-top:10px">${entries.map(([key,r])=>`<div class="list-item"><div class="btn-row"><div><div class="title">${esc(r.name||key)}</div><div class="meta">${Number(r.current||0)} / ${Number(r.max||0)}</div></div><button class="btn" data-${prefix}-recharge="${esc(key)}" ${ownTurn && Number(r.current||0)<Number(r.max||0)?'':'disabled'}>Recarregar</button></div></div>`).join('')}</div>`;
}

async function executeEquipment(item, actorId, encounterId, targetId, reinforce=false, twoHanded=false) {
  const c=equipmentDefaults(item);
  if (!item?.equipped || item?.status!=='approved') throw new Error('O equipamento precisa estar aprovado e equipado.');
  if (!c.enabled) throw new Error('Este equipamento não possui ataque configurado.');
  if (twoHanded && (item.weapon_profile!=='standard' || item.equip_slot!=='main_hand')) throw new Error('Somente uma arma Padrão na Mão principal pode usar a empunhadura de duas mãos.');
  if (twoHanded) {
    const equipped=await api.getEquipment(actorId);
    if (equipped.some(other=>other.id!==item.id && other.status==='approved' && other.equipped && other.equip_slot==='off_hand')) throw new Error('A Mão secundária precisa estar livre para empunhar esta arma com duas mãos.');
  }
  const damage=weaponDamageProfile(item.weapon_profile||'standard',twoHanded);
  const extraEa=reinforce && !c.usesCursedEnergy ? 1 : 0;
  return api.createCombatAttack({
    encounterId, attackerCharacterId:actorId, targetCharacterId:targetId, label:twoHanded?`${item.name} (duas mãos)`:item.name,
    sourceType:'equipment', sourceId:item.id, attackAttributeKey:c.attackAttributeKey, attackSkillKey:c.attackSkillKey,
    paCost:damage.paCost, eaCost:c.eaCost+extraEa, usesCursedEnergy:c.usesCursedEnergy||extraEa>0, forcedCritical:c.forcedCritical,
    criticalThreshold:c.criticalThreshold, damageDiceCount:damage.damageDiceCount, damageDie:damage.damageDie,
    damageFlatAttributeKey:c.damageFlatAttributeKey, conditionKey:c.conditionKey,
  });
}

async function safeCombatRead(label, operation, fallback) {
  try {
    return await operation();
  } catch (error) {
    console.warn(`[Combate] ${label} indisponível; usando fallback.`, error);
    return typeof fallback === 'function' ? fallback(error) : fallback;
  }
}

function fallbackTargetsFromParticipants(participants=[]) {
  return participants.filter(p=>p?.characters).map(p=>{
    const c=p.characters;
    const d=characterDerived(c);
    return {
      participant_id:p.id,
      character_id:p.character_id,
      display_name:[c.first_name,c.last_name].filter(Boolean).join(' ') || 'Personagem',
      entity_type:c.entity_type,
      ca:d.ca,
      defeated:Boolean(p.defeated),
      side_key:p.side_key||'neutral',
      initiative:Number(p.initiative||0),
      visible_to_players:Boolean(p.visible_to_players??true),
      targetable_by_players:Boolean(p.targetable_by_players??true),
      selectable:true,
    };
  });
}

function playerInitiativeHtml(targets=[], activeParticipantId=null, esc=(v)=>String(v)) {
  const ordered=[...targets].sort((a,b)=>Number(b.initiative||0)-Number(a.initiative||0) || String(a.display_name||'').localeCompare(String(b.display_name||''),'pt-BR'));
  if(!ordered.length) return '<p class="muted">Nenhuma entidade visível na iniciativa.</p>';
  return `<div class="combat-visible-initiative">${ordered.map(t=>{
    const active=String(t.participant_id||'')===String(activeParticipantId||'');
    const type=COMBAT_ENTITY_GROUPS.find(g=>g.key===t.entity_type)?.title?.replace(/s$/,'')||'Entidade';
    return `<div class="combat-initiative-row ${active?'turn-active':''}"><div><strong>${esc(t.display_name)}</strong><span class="muted small">${esc(type)}</span></div><div class="btn-row"><span class="pill">Iniciativa ${Number(t.initiative||0)}</span>${active?'<span class="pill good">TURNO</span>':''}${t.defeated?'<span class="pill bad">DERROTADO</span>':''}</div></div>`;
  }).join('')}</div>`;
}

// ============================================================
// TABULEIRO TÁTICO v0.8.2
// ============================================================
// O tabuleiro é deliberadamente uma camada de posicionamento. Ele não converte
// quadrados em metros e não gasta PA automaticamente, preservando o alcance
// narrativo já usado pelo sistema. O estado estruturado de paredes já permite
// adicionar validação de movimento no futuro sem refazer os mapas.
function safeJsonList(value) {
  return Array.isArray(value) ? value.map(v=>String(v)) : [];
}

function boardCellKey(x,y) { return `${Number(x)}:${Number(y)}`; }

// Paredes são normalizadas por LINHA da grade, não duplicadas por quadrado.
// h:x:y = segmento horizontal de x..x+1 na altura y
// v:x:y = segmento vertical de y..y+1 na coluna x
function boardWallKey(x,y,dir) {
  const xx=Number(x), yy=Number(y);
  if(dir==='N') return `h:${xx}:${yy}`;
  if(dir==='S') return `h:${xx}:${yy+1}`;
  if(dir==='W') return `v:${xx}:${yy}`;
  if(dir==='E') return `v:${xx+1}:${yy}`;
  return '';
}

function boardColumnLabel(index) {
  let n=Number(index)+1, out='';
  while(n>0){n-=1;out=String.fromCharCode(65+(n%26))+out;n=Math.floor(n/26);}
  return out;
}

function boardEntityLabel(type='') {
  return COMBAT_ENTITY_GROUPS.find(g=>g.key===type)?.title?.replace(/s$/,'') || 'Entidade';
}

function boardTokensFromMasterParticipants(participants=[], getName=(c)=>c?.first_name||'Entidade') {
  return participants.map(p=>({
    participant_id:p.id,
    character_id:p.character_id,
    display_name:getName(p.characters),
    entity_type:p.characters?.entity_type||'npc',
    initiative:Number(p.initiative||0),
    defeated:Boolean(p.defeated),
    side_key:p.side_key||'neutral',
    visible_to_players:p.visible_to_players!==false,
    targetable_by_players:p.targetable_by_players!==false,
    board_x:p.board_x==null?null:Number(p.board_x),
    board_y:p.board_y==null?null:Number(p.board_y),
  }));
}

function combatBoardTokenHtml(token,{esc=(v)=>String(v),editable=false,activeParticipantId=null,palette=false}={}) {
  const name=token.display_name||'Entidade';
  const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'?';
  const active=String(token.participant_id||'')===String(activeParticipantId||'');
  const hidden=token.visible_to_players===false;
  const noTarget=token.targetable_by_players===false;
  const pos=token.board_x==null||token.board_y==null?'fora do plano':`${boardColumnLabel(token.board_x)}${token.board_y+1}`;
  return `<button type="button" class="combat-board-token entity-type-${esc(token.entity_type||'npc')} ${active?'turn-active':''} ${hidden?'is-hidden-token':''} ${noTarget?'not-targetable-token':''} ${palette?'is-palette-token':''}" data-board-token="${token.participant_id}" ${editable?'draggable="true"':''} title="${esc(name)} • ${esc(boardEntityLabel(token.entity_type))} • Iniciativa ${Number(token.initiative||0)} • ${esc(pos)}${hidden?' • oculto dos players':''}${noTarget?' • não é alvo válido':''}">
    <span class="combat-board-token-initials">${esc(initials)}</span><span class="combat-board-token-name">${esc(name)}</span>${active?'<span class="combat-board-token-turn">TURNO</span>':''}
  </button>`;
}

function combatBoardHtml({encounter,tokens=[],esc=(v)=>String(v),editable=false,activeParticipantId=null}={}) {
  const cols=Math.max(4,Math.min(30,Number(encounter?.board_cols||14)));
  const rows=Math.max(4,Math.min(30,Number(encounter?.board_rows||10)));
  const blocked=new Set(safeJsonList(encounter?.board_blocked_cells));
  const walls=new Set(safeJsonList(encounter?.board_walls));
  const positioned=tokens.filter(t=>t.board_x!=null&&t.board_y!=null&&t.board_x>=0&&t.board_y>=0&&t.board_x<cols&&t.board_y<rows);
  const byCell=new Map();
  positioned.forEach(t=>{const key=boardCellKey(t.board_x,t.board_y);if(!byCell.has(key))byCell.set(key,[]);byCell.get(key).push(t);});
  const ordered=[...tokens].sort((a,b)=>Number(b.initiative||0)-Number(a.initiative||0)||String(a.display_name||'').localeCompare(String(b.display_name||''),'pt-BR'));
  const cells=[];
  for(let y=0;y<rows;y++){
    for(let x=0;x<cols;x++){
      const key=boardCellKey(x,y), here=byCell.get(key)||[];
      const wallClasses=['N','E','S','W'].filter(dir=>walls.has(boardWallKey(x,y,dir))).map(dir=>`wall-${dir.toLowerCase()}`).join(' ');
      cells.push(`<div class="combat-board-cell ${blocked.has(key)?'is-blocked':''} ${wallClasses}" data-board-cell="${key}" data-board-x="${x}" data-board-y="${y}" title="${boardColumnLabel(x)}${y+1}${blocked.has(key)?' • intransponível':''}"><span class="combat-board-coordinate">${boardColumnLabel(x)}${y+1}</span><div class="combat-board-cell-tokens">${here.map(t=>combatBoardTokenHtml(t,{esc,editable,activeParticipantId})).join('')}</div></div>`);
    }
  }
  const publicCount=tokens.filter(t=>t.visible_to_players!==false).length;
  const placedCount=positioned.length;
  return `<section class="card combat-board-card" data-combat-board>
    <div class="combat-board-heading"><div><div class="eyebrow">PLANO DE COMBATE</div><h2 style="margin:2px 0 4px">Posicionamento da cena</h2><div class="muted small">${cols} × ${rows} quadrados • ${placedCount}/${tokens.length} peça(s) posicionada(s)${editable?` • ${publicCount} visível(is) aos players`:''}</div></div>${editable?`<div class="combat-board-modes"><button type="button" class="btn primary" data-board-mode="move">Mover peças</button><button type="button" class="btn" data-board-mode="terrain">Editar terreno</button></div>`:''}</div>
    ${editable?`<div class="notice combat-board-help"><strong>Mover peças:</strong> arraste qualquer peça da lista para um quadrado, ou clique na peça e depois no destino. <strong>Editar terreno:</strong> selecione um quadrado para bloqueá-lo ou marcar paredes nas quatro bordas. Essas marcações não gastam PA e podem ser alteradas a qualquer momento.</div>`:'<div class="notice combat-board-help">O plano mostra apenas participantes que o Mestre tornou visíveis. A posição é referência espacial da cena; quadrados não equivalem automaticamente a metros ou PA.</div>'}
    ${editable?`<div class="combat-board-roster"><div class="combat-board-roster-title"><strong>Peças do combate</strong><span class="muted small">Arraste da iniciativa para o plano.</span></div><div class="combat-board-roster-list">${ordered.map(t=>combatBoardTokenHtml(t,{esc,editable:true,activeParticipantId,palette:true})).join('')||'<span class="muted">Nenhuma peça.</span>'}</div></div>`:''}
    <div class="combat-board-scroll"><div class="combat-board-grid" style="--combat-board-cols:${cols}">${cells.join('')}</div></div>
    ${editable?`<div class="combat-board-editor" data-board-editor>
      <div><strong data-board-editor-title>Nenhum quadrado selecionado</strong><div class="muted small" data-board-editor-help>No modo Terreno, clique em um quadrado.</div></div>
      <div class="btn-row combat-board-terrain-buttons"><button type="button" class="btn" data-board-block disabled>Bloquear quadrado</button><button type="button" class="btn" data-board-wall="N" disabled>Parede ↑</button><button type="button" class="btn" data-board-wall="E" disabled>Parede →</button><button type="button" class="btn" data-board-wall="S" disabled>Parede ↓</button><button type="button" class="btn" data-board-wall="W" disabled>Parede ←</button><button type="button" class="btn warn" data-board-unplace disabled>Retirar peça selecionada</button><button type="button" class="btn bad" data-board-clear-terrain>Limpar terreno</button></div>
    </div>`:''}
  </section>`;
}

function bindMasterCombatBoard(root, encounter, tokens, ctx, rerender) {
  const board=root.querySelector('[data-combat-board]'); if(!board)return;
  const { state, withBusy, toast }=ctx;
  let mode=state.combatBoardMode||'move';
  let selectedParticipantId=state.combatBoardSelectedParticipant||null;
  let selectedCell=state.combatBoardSelectedCell||null;
  const blocked=new Set(safeJsonList(encounter.board_blocked_cells));
  const walls=new Set(safeJsonList(encounter.board_walls));

  const modeButtons=[...board.querySelectorAll('[data-board-mode]')];
  const cellEls=[...board.querySelectorAll('[data-board-cell]')];
  const tokenEls=[...board.querySelectorAll('[data-board-token]')];
  const title=board.querySelector('[data-board-editor-title]');
  const help=board.querySelector('[data-board-editor-help]');
  const blockBtn=board.querySelector('[data-board-block]');
  const wallBtns=[...board.querySelectorAll('[data-board-wall]')];
  const unplaceBtn=board.querySelector('[data-board-unplace]');

  const sync=()=>{
    state.combatBoardMode=mode;
    state.combatBoardSelectedParticipant=selectedParticipantId;
    state.combatBoardSelectedCell=selectedCell;
    modeButtons.forEach(btn=>btn.classList.toggle('primary',btn.dataset.boardMode===mode));
    board.classList.toggle('terrain-mode',mode==='terrain');
    tokenEls.forEach(el=>el.classList.toggle('is-selected-token',String(el.dataset.boardToken)===String(selectedParticipantId||'')));
    cellEls.forEach(el=>el.classList.toggle('is-selected-cell',String(el.dataset.boardCell)===String(selectedCell||'')));
    const hasCell=Boolean(selectedCell&&mode==='terrain');
    if(blockBtn)blockBtn.disabled=!hasCell;
    wallBtns.forEach(btn=>btn.disabled=!hasCell);
    if(unplaceBtn)unplaceBtn.disabled=!selectedParticipantId;
    if(hasCell){
      const [x,y]=selectedCell.split(':').map(Number);
      if(title)title.textContent=`Quadrado ${boardColumnLabel(x)}${y+1}`;
      if(help)help.textContent=blocked.has(selectedCell)?'Quadrado intransponível. Clique novamente para liberar.':'Quadrado transitável.';
      if(blockBtn){blockBtn.textContent=blocked.has(selectedCell)?'Desbloquear quadrado':'Bloquear quadrado';blockBtn.classList.toggle('warn',blocked.has(selectedCell));}
      wallBtns.forEach(btn=>btn.classList.toggle('warn',walls.has(boardWallKey(x,y,btn.dataset.boardWall))));
    }else{
      if(title)title.textContent=mode==='move'?(selectedParticipantId?'Peça selecionada':'Selecione uma peça para mover'):'Nenhum quadrado selecionado';
      if(help)help.textContent=mode==='move'?'Arraste uma peça ou clique nela e depois no destino.':'Clique em um quadrado para editar paredes e bloqueio.';
    }
  };

  const move=async(participantId,x,y)=>{
    if(!participantId)return;
    const key=boardCellKey(x,y);
    if(blocked.has(key)){toast('Este quadrado está marcado como intransponível.','bad');return;}
    const token=tokens.find(t=>String(t.participant_id)===String(participantId));
    await withBusy(()=>api.moveCombatToken(encounter.id,participantId,x,y,`Mover ${token?.display_name||'peça'} no tabuleiro`),'Peça reposicionada.');
    await rerender();
  };

  modeButtons.forEach(btn=>btn.onclick=()=>{mode=btn.dataset.boardMode;selectedCell=null;sync();});
  tokenEls.forEach(el=>{
    el.addEventListener('click',e=>{if(mode!=='move')return;e.stopPropagation();selectedParticipantId=el.dataset.boardToken;sync();});
    el.addEventListener('dragstart',e=>{if(mode!=='move'){e.preventDefault();return;}selectedParticipantId=el.dataset.boardToken;e.dataTransfer?.setData('text/combat-participant',selectedParticipantId);e.dataTransfer.effectAllowed='move';sync();});
  });
  cellEls.forEach(cell=>{
    cell.addEventListener('dragover',e=>{if(mode==='move'){e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';}});
    cell.addEventListener('drop',async e=>{if(mode!=='move')return;e.preventDefault();const pid=e.dataTransfer?.getData('text/combat-participant')||selectedParticipantId;await move(pid,Number(cell.dataset.boardX),Number(cell.dataset.boardY));});
    cell.addEventListener('click',async e=>{
      if(e.target.closest('[data-board-token]'))return;
      if(mode==='move'){
        if(!selectedParticipantId){toast('Selecione uma peça da iniciativa primeiro.','bad');return;}
        await move(selectedParticipantId,Number(cell.dataset.boardX),Number(cell.dataset.boardY));
      }else{
        selectedCell=cell.dataset.boardCell; sync();
      }
    });
  });
  blockBtn?.addEventListener('click',async()=>{
    if(!selectedCell)return;
    if(blocked.has(selectedCell))blocked.delete(selectedCell);else blocked.add(selectedCell);
    await withBusy(()=>api.setCombatBoardState(encounter.id,{blockedCells:[...blocked],walls:[...walls]}),blocked.has(selectedCell)?'Quadrado bloqueado.':'Quadrado liberado.');
    await rerender();
  });
  wallBtns.forEach(btn=>btn.onclick=async()=>{
    if(!selectedCell)return;
    const [x,y]=selectedCell.split(':').map(Number);const key=boardWallKey(x,y,btn.dataset.boardWall);
    if(walls.has(key))walls.delete(key);else walls.add(key);
    await withBusy(()=>api.setCombatBoardState(encounter.id,{blockedCells:[...blocked],walls:[...walls]}),walls.has(key)?'Parede marcada.':'Parede removida.');
    await rerender();
  });
  unplaceBtn?.addEventListener('click',async()=>{
    if(!selectedParticipantId)return;
    const token=tokens.find(t=>String(t.participant_id)===String(selectedParticipantId));
    await withBusy(()=>api.moveCombatToken(encounter.id,selectedParticipantId,null,null,`Retirar ${token?.display_name||'peça'} do tabuleiro`),'Peça retirada do plano.');
    selectedParticipantId=null;state.combatBoardSelectedParticipant=null;await rerender();
  });
  board.querySelector('[data-board-clear-terrain]')?.addEventListener('click',async()=>{
    if(!confirm('Remover TODOS os quadrados bloqueados e paredes deste combate? As posições das peças serão mantidas.'))return;
    await withBusy(()=>api.setCombatBoardState(encounter.id,{blockedCells:[],walls:[]}),'Terreno limpo.');
    selectedCell=null;state.combatBoardSelectedCell=null;await rerender();
  });
  sync();
}

async function loadAbilityBundle(parentCharacterId) {
  const parentAbilities=await safeCombatRead('habilidades do personagem',()=>api.getAbilities(parentCharacterId),[]);
  const children=await safeCombatRead('fichas filhas',()=>api.getChildSheets(parentCharacterId),[]);
  const childRows=await Promise.all(children.map(async child=>({
    child,
    abilities:await safeCombatRead(`habilidades da ficha filha ${child?.id||''}`,()=>api.getAbilities(child.id),[]),
  })));
  return {parentAbilities,children:childRows};
}

export async function renderTestsPage(ctx) {
  const { root, state, pageHeader, esc, getName, withBusy, toast }=ctx;
  if (state.profile.role==='master' && !state.masterCharacters?.length) state.masterCharacters=await api.listAllCharacters();
  const characters=state.profile.role==='master'?state.masterCharacters:[state.character];
  const selectedId=state.testCharacterId || characters[0]?.id; state.testCharacterId=selectedId;
  const selected=characters.find(c=>c.id===selectedId)||characters[0];
  const logs=await api.getGeneralRollLogs(state.profile.role==='master'?null:selected?.id);
  root.innerHTML=`${pageHeader('Rolagens livres','Testes')}
    <section class="grid grid-2"><div class="card"><h2>Novo teste</h2><form id="general-test" class="grid">
      ${state.profile.role==='master'?`<label>Entidade<select name="character">${characters.map(c=>`<option value="${c.id}" ${c.id===selected?.id?'selected':''}>${esc(getName(c))}</option>`).join('')}</select></label>`:''}
      <label>Perícia<select name="skill">${optionList(SKILLS)}</select></label>
      <label>Atributo<select name="attribute"><option value="">Atributo padrão da perícia</option>${optionList(ATTRIBUTES)}</select></label>
      ${modeFields('')}
      <button class="btn primary">Fazer teste</button>
    </form><div class="notice" style="margin-top:10px">Players podem escolher entre rolar pelo site ou usar dados físicos. O d20 informado é o valor natural; o sistema aplica o bônus.</div></div>
    <div class="card"><h2>Histórico de testes</h2><div class="list">${logs.map(r=>`<div class="list-item"><div class="title">${esc(r.label)}: ${r.total}</div><div class="meta">${esc(r.expression)} • ${esc(JSON.stringify(r.rolls))} • bônus ${r.bonus>=0?'+':''}${r.bonus}</div></div>`).join('')||'<p class="muted">Nenhuma rolagem.</p>'}</div></div></section>`;
  root.querySelector('#general-test').onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    const characterId=state.profile.role==='master'?f.get('character'):state.character.id;
    const skill=SKILL_BY_KEY[f.get('skill')];
    const attributeKey=f.get('attribute')||skill.attribute;
    const mode=f.get('mode'); const count=Number(f.get('count')||2);
    if(state.profile.role==='master'){
      const result=await withBusy(()=>api.rollGeneralTest({characterId,label:skill.name,attributeKey,skillKey:skill.key,mode,count,visibility:'master'}));
      toast(`${skill.name}: ${result.total}`,'good');renderTestsPage(ctx);return;
    }
    const choice=await chooseD20Roll({title:`Teste de ${skill.name}`,mode,count,label:skill.name,details:'Informe somente o(s) d20 natural(is). O site calcula atributo, perícia e bônus válidos.'});
    const executed=await runWithRollChoice(choice,()=>withBusy(()=>api.rollGeneralTest({characterId,label:skill.name,attributeKey,skillKey:skill.key,mode,count,visibility:'public'}),'Teste registrado.'));
    if(!executed.cancelled){toast(`${skill.name}: ${executed.value.total}`,'good');renderTestsPage(ctx);}
  };
}
export async function quickSkillRoll(character, skillKey, ctx) {
  const { toast, withBusy, state }=ctx; const skill=SKILL_BY_KEY[skillKey];
  if(state.profile.role==='master'){
    const result=await withBusy(()=>api.rollGeneralTest({characterId:character.id,label:skill.name,attributeKey:skill.attribute,skillKey:skill.key,mode:'normal',count:1,visibility:'master'}));
    toast(`${skill.name}: ${result.total}`,'good'); return result;
  }
  const choice=await chooseD20Roll({title:`Teste de ${skill.name}`,mode:'normal',count:1,label:skill.name,details:'Informe o d20 natural; o bônus da ficha é somado automaticamente.'});
  const executed=await runWithRollChoice(choice,()=>withBusy(()=>api.rollGeneralTest({characterId:character.id,label:skill.name,attributeKey:skill.attribute,skillKey:skill.key,mode:'normal',count:1,visibility:'public'}),'Teste registrado.'));
  if(executed.cancelled)return null;
  toast(`${skill.name}: ${executed.value.total}`,'good'); return executed.value;
}

export async function renderPlayerCombatPageV2(ctx) {
  const { root, state, pageHeader, esc, withBusy, toast }=ctx;
  const encounters=await api.getEncounters();
  const active=encounters.find(e=>e.status==='active');
  if(!active){ctx.subscribeCombatRealtime?.(null,()=>{});root.innerHTML=`${pageHeader('Sala de combate','Combate')}<div class="notice">Nenhum combate ativo.</div>`;return;}
  ctx.subscribeCombatRealtime?.(active.id,()=>renderPlayerCombatPageV2(ctx));

  // A tabela combat_participants continua protegida por RLS: o jogador lê nela apenas
  // o próprio participante. A lista pública/selecionável vem do RPC get_combat_targets,
  // que já respeita a visibilidade definida pelo Mestre.
  const ownedParticipants=await api.getCombatParticipants(active.id);
  const [targetsRaw,actions,equipment,bundle,effects,boostableActions,improvisedEvents]=await Promise.all([
    safeCombatRead('alvos do combate',()=>api.getCombatTargets(active.id),null),
    safeCombatRead('histórico de ações',()=>api.getVisibleCombatActions(active.id),[]),
    safeCombatRead('equipamentos em combate',()=>api.getEquipment(state.character.id),[]),
    loadAbilityBundle(state.character.id),
    safeCombatRead('efeitos temporários',()=>api.getCombatEffects(active.id),[]),
    safeCombatRead('ataques que podem receber bônus',()=>api.getBoostableCombatActions(active.id),[]),
    api.getImprovisedEvents(active.id),
  ]);
  const sideByCharacter=Object.fromEntries(ownedParticipants.map(p=>[String(p.character_id),p.side_key||'neutral']));
  const targets=(Array.isArray(targetsRaw)?targetsRaw:fallbackTargetsFromParticipants(ownedParticipants)).map(t=>({
    ...t,
    side_key:t.side_key||sideByCharacter[String(t.character_id)]||'neutral',
    // O Mestre pode exibir alguém na iniciativa sem permitir que jogadores o
    // selecionem. O RPC já remove completamente participantes invisíveis.
    selectable:Boolean(t.targetable_by_players??true),
  }));
  const mine=ownedParticipants.find(p=>p.character_id===state.character.id);
  const activeVisibleTarget=targets.find(t=>String(t.participant_id)===String(active.active_participant_id||''))||null;
  const isMyTurn=Boolean(mine && String(active.active_participant_id||'')===String(mine.id));
  const myName=[state.character.first_name,state.character.last_name].filter(Boolean).join(' ') || 'Personagem';
  const activeName=activeVisibleTarget?.display_name||'';
  const caMap=Object.fromEntries(targets.map(t=>[t.character_id,t.ca]));
  const approvedAbilities=bundle.parentAbilities.filter(a=>a.status==='approved');
  const activeSummonId=mine?.active_summon_character_id||null;
  const activeSummon=bundle.children.find(x=>x.child.id===activeSummonId)||null;
  const childAbilityCards=bundle.children.flatMap(({child,abilities})=>abilities.filter(a=>a.status==='approved').flatMap(a=>abilityVariants(a).map(variant=>abilityCardCombat({ability:a,variant,targets,actorId:state.character.id,actorName:myName,esc,enabled:isMyTurn,locked:child.id!==activeSummonId,prefix:'ability',summonName:[child.first_name,child.last_name].filter(Boolean).join(' '),activeCombatMode:mine?.active_combat_mode||null,boostableActions}))));
  const parentAbilityCards=approvedAbilities.flatMap(a=>abilityVariants(a).map(variant=>abilityCardCombat({ability:a,variant,targets,actorId:state.character.id,actorName:myName,esc,enabled:isMyTurn,prefix:'ability',activeCombatMode:mine?.active_combat_mode||null,boostableActions})));

  const usableEquipment=equipment.filter(i=>i.status==='approved'&&(i.equipped||i.category==='consumable'));
  const attackEquipment=usableEquipment.filter(i=>i.equipped&&equipmentDefaults(i).enabled);
  const effectEquipment=usableEquipment.flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>['active','reaction','attack'].includes(e.type)).flatMap(effect=>effectVariants(effect).map(variant=>({item:i,effect,variant}))));
  const passiveEquipment=equipment.filter(i=>i.status==='approved'&&i.equipped).flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>e.type==='passive').map(effect=>({item:i,effect})));
  const offHandFree=!equipment.some(i=>i.status==='approved'&&i.equipped&&i.equip_slot==='off_hand');
  // Golpes básicos e ataques de arma podem atingir qualquer OUTRO participante
  // que o Mestre marcou como alvo válido. Habilidades continuam respeitando a
  // relação específica declarada em suas próprias regras.
  const attackTargets=targets.filter(t=>!t.defeated&&t.selectable!==false&&String(t.character_id)!==String(state.character.id));
  const targetOpts=attackTargets.map(t=>`<option value="${t.character_id}">${esc(t.display_name)} • CA ${t.ca}</option>`).join('');

  const turnBanner=!mine
    ? `<section class="card"><div class="notice">Seu personagem ainda não foi adicionado a este combate.</div></section>`
    : isMyTurn
      ? `<section class="card"><div class="eyebrow">TURNO ATIVO</div><h2 style="margin-bottom:6px">Sua vez, ${esc(myName)}!</h2><div class="notice">Suas ações de turno estão liberadas. Habilidades marcadas como <strong>REAÇÃO</strong> também podem ser usadas fora do seu turno quando a situação permitir.</div></section>`
      : active.active_participant_id && activeVisibleTarget
        ? `<section class="card"><div class="eyebrow">AGUARDANDO TURNO</div><h2 style="margin-bottom:6px">Agora é a vez de ${esc(activeName)}.</h2><div class="notice">Ações normais estão bloqueadas. Suas <strong>reações próprias</strong>, além das reações defensivas oferecidas por ataques, continuam disponíveis.</div></section>`
        : active.active_participant_id
          ? `<section class="card"><div class="eyebrow">AGUARDANDO TURNO</div><h2 style="margin-bottom:6px">Há um turno em andamento.</h2><div class="notice">A entidade ativa não está visível para sua ficha. Suas reações continuam funcionando apenas quando houver um gatilho válido para você.</div></section>`
          : `<section class="card"><div class="eyebrow">AGUARDANDO O MESTRE</div><h2 style="margin-bottom:6px">Nenhum turno foi iniciado.</h2><div class="notice">Aguarde o Mestre escolher quem vai agir. Reações próprias continuam aparecendo quando forem legalmente utilizáveis.</div></section>`;

  root.innerHTML=`${pageHeader(`Rodada ${active.round}`,'Combate')}
    ${turnBanner}<div style="height:14px"></div>
    ${combatBoardHtml({encounter:active,tokens:targets,esc,editable:false,activeParticipantId:active.active_participant_id})}<div style="height:14px"></div>
    <section class="grid grid-2"><div class="card"><h2>${esc(active.name)}</h2>${mine?participantCard(mine,ctx,false,active.active_participant_id,caMap):'<p class="muted">Seu personagem ainda não foi adicionado.</p>'}${mine?`<h3 style="margin-top:12px">Recursos especiais</h3>${specialResourcesHtml(mine,esc,isMyTurn)}<h3 style="margin-top:12px">Efeitos ativos</h3><div>${combatEffectsHtml(effects,state.character.id,esc,{ownTurn:isMyTurn,prefix:'player'})}</div>`:''}<h3 style="margin-top:14px">Ordem de iniciativa visível</h3>${playerInitiativeHtml(targets,active.active_participant_id,esc)}</div>
    <div class="card"><h2>Golpe corpo a corpo</h2>${mine&&targetOpts&&isMyTurn?`<form id="basic-attack" class="grid"><label>Alvo<select name="target">${targetOpts}</select></label><label style="display:flex;align-items:center;gap:7px"><input name="cursed" type="checkbox" style="width:auto" /> Conduzir +1 EA neste golpe • permite Kokusen em 20 natural</label>${modeFields('')}<div class="notice">1 PA • Força + Lutar • dano 1d6 + Mod. Força</div><button class="btn primary">Atacar</button></form>`:mine&&targetOpts?'<div class="notice">Aguardando o Mestre iniciar seu turno.</div>':'<p class="muted">É preciso estar no combate e possuir um alvo.</p>'}</div></section>
    <div style="height:14px"></div>
    <section class="grid grid-2"><div class="card"><h2>Habilidades</h2><div class="list">${parentAbilityCards.join('')||'<p class="muted">Nenhuma habilidade aprovada.</p>'}</div>${bundle.children.length?`<h3 style="margin-top:14px">Invocações</h3>${bundle.children.map(({child})=>{const activeChild=child.id===activeSummonId;const nm=[child.first_name,child.last_name].filter(Boolean).join(' ');return `<div class="list-item"><div class="btn-row"><div class="title">${esc(nm)}</div><span class="pill ${activeChild?'good':'bad'}">${activeChild?'ATIVA':'INATIVA'}</span>${activeChild&&isMyTurn?`<button class="btn warn" data-dismiss-summon="${child.id}" data-summon-name="${esc(nm)}">Dispensar</button>`:''}</div></div>`}).join('')}<div class="list">${childAbilityCards.join('')}</div>`:''}</div>
    <div class="card"><h2>Equipamentos equipados</h2><div class="list">${attackEquipment.map(i=>{const c=equipmentDefaults(i);const base=weaponDamageProfile(i.weapon_profile||'standard',false);const canTwo=i.weapon_profile==='standard'&&i.equip_slot==='main_hand'&&offHandFree;const temp=i.temporary_encounter_id?`<span class="pill warn">TEMPORÁRIO • ${i.temporary_turns_remaining??'?'} turno(s)</span>`:'';return `<div class="list-item"><div class="btn-row"><div class="title">${esc(i.name)}</div>${temp}</div><div class="meta">${base.paCost} PA • ${base.damageDiceCount}d${base.damageDie}${canTwo?' • 2 mãos: 1d10':''}</div><label style="margin-top:8px">Alvo<select data-equipment-target="${i.id}" ${isMyTurn?'':'disabled'}>${targetOpts}</select></label>${canTwo?`<label style="display:flex;align-items:center;gap:7px;margin-top:8px"><input type="checkbox" data-equipment-two-hands="${i.id}" style="width:auto" ${isMyTurn?'':'disabled'} /> Empunhar com duas mãos neste ataque • dano 1d10</label>`:''}${!c.usesCursedEnergy?`<label style="display:flex;align-items:center;gap:7px;margin-top:8px"><input type="checkbox" data-equipment-reinforce="${i.id}" style="width:auto" ${isMyTurn?'':'disabled'} /> Conduzir +1 EA neste golpe</label>`:''}<button class="btn" data-use-equipment="${i.id}" style="margin-top:8px" ${isMyTurn?'':'disabled'}>Atacar com equipamento</button></div>`}).join('')||'<p class="muted">Nenhuma arma equipada.</p>'}${effectEquipment.map(({item,effect,variant})=>equipmentEffectCardCombat({item,effect,variant,targets,actorId:state.character.id,actorName:myName,esc,enabled:isMyTurn,prefix:'equipment-effect'})).join('')}${passiveEquipment.map(({item,effect})=>`<div class="list-item"><div class="title">${esc(item.name)} • ${esc(effect.name)}</div><span class="pill good">Passivo equipado</span><div class="body" style="margin-top:6px">${esc(effect.mechanics||effect.description||'')}</div></div>`).join('')}</div></div></section>
    <div style="height:14px"></div><section class="card"><h2>Ações e reações</h2><div class="list">${actions.map(a=>actionCard(a,ctx)).join('')||'<p class="muted">Nenhuma ação ainda.</p>'}</div></section>`;

  root.insertAdjacentHTML('beforeend',improvisedEventsHtml(improvisedEvents,esc));
  // Reações e Sobrecargas mudam controles dinamicamente. Sem este bind, por exemplo,
  // a Sobrecarga de A Linha Que Separa não exibiria o campo de segundo alvo.
  bindStructuredAbilityControls(root);

root.querySelector('#basic-attack')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);const mode=fd.get('mode');const count=Number(fd.get('count')||2);
    const choice=await chooseD20Roll({title:'Golpe corpo a corpo',mode,count,label:'Ataque',details:'Role o(s) d20 natural(is). Força + Lutar e bônus do combate são somados automaticamente.'});
    const executed=await runWithRollChoice(choice,()=>withBusy(()=>api.createCombatAttack({encounterId:active.id,attackerCharacterId:state.character.id,targetCharacterId:fd.get('target'),label:'Golpe corpo a corpo',sourceType:'basic',attackAttributeKey:'strength',attackSkillKey:'fight',paCost:1,eaCost:fd.get('cursed')==='on'?1:0,usesCursedEnergy:fd.get('cursed')==='on',damageDiceCount:1,damageDie:6,damageFlatAttributeKey:'strength',rollMode:mode,rollCount:count}),'Ataque realizado.'));
    if(executed.cancelled)return;
    if(choice?.source==='physical')await finishPhysicalAttack(executed.value,'Dano do golpe corpo a corpo');
    renderPlayerCombatPageV2(ctx);
  });

  root.querySelectorAll('[data-ability-use]').forEach(btn=>btn.onclick=async()=>{
    const abilityId=btn.dataset.abilityId; const modeKey=btn.dataset.modeKey||null;
    const a=[...approvedAbilities,...bundle.children.flatMap(x=>x.abilities)].find(x=>x.id===abilityId); if(!a)return;
    const cfg=mergedModeConfig(a,modeKey); const key=`${a.id}:${modeKey||'base'}`;
    const overload=root.querySelector(`[data-overload="${CSS.escape(key)}"]`)?.value||null;
    let effectiveCfg={...cfg};
    if(overload){const selectedOverload=(Array.isArray(cfg.overloads)?cfg.overloads:[]).find(o=>String(o.key)===String(overload));if(selectedOverload?.overrides)effectiveCfg={...effectiveCfg,...selectedOverload.overrides};}
    const special=effectiveCfg.special_action||'';
    const target=(isSelfTarget(effectiveCfg)||['set_combat_mode','boost_recent_attack','place_delayed_bomb'].includes(special))?state.character.id:root.querySelector(`[data-ability-target="${CSS.escape(key)}"]`)?.value;
    const options={};
    if(effectiveCfg.special_action==='create_weapon'){options.weapon_profile=root.querySelector(`[data-weapon-profile="${CSS.escape(key)}"]`)?.value||'standard';options.weapon_attribute=root.querySelector(`[data-weapon-attribute="${CSS.escape(key)}"]`)?.value||'strength';}
    const multi=root.querySelector(`[data-ability-targets="${CSS.escape(key)}"]`);if(multi)options.target_ids=[...multi.selectedOptions].map(o=>o.value);
    const recent=root.querySelector(`[data-recent-action="${CSS.escape(key)}"]`);if(recent?.value)options.action_id=recent.value;
    const secondary=root.querySelector(`[data-secondary-target="${CSS.escape(key)}"]`);if(secondary?.value)options.secondary_target_id=secondary.value;
    const choice=await chooseAbilityRoll({title:a.name,cfg:effectiveCfg,options});
    if(choice===null)return;
    const executed=await runWithRollChoice(choice,()=>withBusy(()=>api.useAbilityInCombat({encounterId:active.id,actorCharacterId:state.character.id,abilityId:a.id,targetCharacterId:target,modeKey,overloadKey:overload,options,label:a.name}),'Habilidade usada.'));
    if(executed.cancelled)return;
    if(choice?.source==='physical'){
      const result=executed.value||{};
      if(result.action_id)await finishPhysicalAttack(result.action_id,`Dano — ${a.name}`);
      if(result.secondary_action_id)await finishPhysicalAttack(result.secondary_action_id,`Dano secundário — ${a.name}`);
    }
    renderPlayerCombatPageV2(ctx);
  });

root.querySelectorAll('[data-resource-recharge]').forEach(btn=>btn.onclick=async()=>{
    const recharge=findRechargeConfig(state.character,btn.dataset.resourceRecharge);
    const choice=await chooseResourceRechargeRoll({title:`Recarregar ${btn.dataset.resourceRecharge}`,recharge});
    const executed=await runWithRollChoice(choice,()=>withBusy(()=>api.useCombatResourceAction(active.id,state.character.id,btn.dataset.resourceRecharge,`Recarregar ${btn.dataset.resourceRecharge}`),'Recurso recarregado.'));
    if(!executed.cancelled)renderPlayerCombatPageV2(ctx);
  });
  root.querySelectorAll('[data-dismiss-summon]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.dismissCombatSummon(active.id,state.character.id,btn.dataset.summonName),'Invocação dispensada.');renderPlayerCombatPageV2(ctx);});
root.querySelectorAll('[data-use-equipment]').forEach(btn=>btn.onclick=async()=>{
    const i=attackEquipment.find(x=>x.id===btn.dataset.useEquipment);
    const target=root.querySelector(`[data-equipment-target="${i.id}"]`)?.value;
    const reinforce=Boolean(root.querySelector(`[data-equipment-reinforce="${i.id}"]`)?.checked);
    const twoHanded=Boolean(root.querySelector(`[data-equipment-two-hands="${i.id}"]`)?.checked);
    const choice=await chooseD20Roll({title:i.name,mode:'normal',count:1,label:'Ataque com arma',details:'Informe o d20 natural. O site escolhe os melhores bônus permitidos pela arma e soma o modificador.'});
    const executed=await runWithRollChoice(choice,()=>withBusy(()=>executeEquipment(i,state.character.id,active.id,target,reinforce,twoHanded),'Ataque realizado.'));
    if(executed.cancelled)return;
    if(choice?.source==='physical')await finishPhysicalAttack(executed.value,`Dano — ${i.name}`);
    renderPlayerCombatPageV2(ctx);
  });
root.querySelectorAll('[data-equipment-effect-use]').forEach(btn=>btn.onclick=async()=>{
    const item=usableEquipment.find(x=>x.id===btn.dataset.itemId);
    const effect=(item?.effects||[]).find(e=>String(e.id)===String(btn.dataset.effectId));if(!item||!effect)return;
    const modeKey=btn.dataset.modeKey||null;
    const cfg=effectVariants(effect).find(v=>(v.modeKey||null)===modeKey)?.config||effect.config||{};
    const key=`${item.id}:${effect.id}:${modeKey||'base'}`;
    const target=isSelfTarget(cfg)?state.character.id:root.querySelector(`[data-equipment-effect-target="${CSS.escape(key)}"]`)?.value;
    const choice=await chooseEquipmentEffectRoll({title:`${item.name}: ${effect.name}`,cfg});
    const executed=await runWithRollChoice(choice,()=>withBusy(()=>api.useEquipmentEffectInCombat({encounterId:active.id,actorCharacterId:state.character.id,itemId:item.id,effectId:effect.id,targetCharacterId:target,modeKey,label:`${item.name}: ${effect.name}`}),'Efeito do equipamento usado.'));
    if(executed.cancelled)return;
    if(choice?.source==='physical'&&executed.value?.action_id)await finishPhysicalAttack(executed.value.action_id,`Dano — ${item.name}`);
    renderPlayerCombatPageV2(ctx);
  });
  root.querySelectorAll('[data-extinguish-effect]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.extinguishCombatEffect(active.id,btn.dataset.extinguishEffect,'Apagar efeito'),'Efeito removido.');renderPlayerCombatPageV2(ctx);});
root.querySelectorAll('[data-detonate-bomb]').forEach(btn=>btn.onclick=async()=>{
    if(!confirm('Detonar a Explosão Artística agora? Use este botão no fim da rodada da mesa.'))return;
    const bomb=effects.find(e=>e.can_detonate||(e.effect_key==='art_bomb'&&String(e.source_character_id)===String(state.character.id)));
    const choice=await chooseBombRoll({title:'Explosão Artística',effect:bomb});
    const executed=await runWithRollChoice(choice,()=>withBusy(()=>api.detonateArtBomb(active.id,state.character.id),'Explosão Artística detonada.'));
    if(!executed.cancelled)renderPlayerCombatPageV2(ctx);
  });
  await bindCommonCombatButtons(root,ctx,active.id,()=>renderPlayerCombatPageV2(ctx));
}
export async function renderMasterCombatPageV2(ctx) {
  const { root, state, pageHeader, esc, getName, withBusy, toast }=ctx;
  const encounters=await api.getEncounters();
  state.activeEncounter=encounters.find(e=>e.status==='active')||null;
  state.masterCharacters=await api.listAllCharacters();
  if(!state.activeEncounter){
    ctx.subscribeCombatRealtime?.(null,()=>{});
    const lastUndo=await api.getLatestCombatUndo(null).catch(()=>null);
    const canReopen=lastUndo?.encounter_status==='ended';
    root.innerHTML=`${pageHeader('Controle secreto','Combate')}
      ${canReopen?`<section class="card"><div class="btn-row"><div><h2 style="margin:0">Último combate encerrado</h2><div class="muted small">${esc(lastUndo.encounter_name)} • última ação: ${esc(lastUndo.label)}</div></div><button class="btn warn" id="undo-ended-combat">Desfazer encerramento</button></div></section><div style="height:14px"></div>`:''}
      <section class="card"><h2>Iniciar combate</h2><form id="encounter-form" class="grid"><label>Nome do combate<input name="name" required placeholder="Ex.: Treino contra a Maldição da Rua Sem Nome" /></label><div><h3>Quem começa no combate?</h3>${combatEntityPickerHtml(state.masterCharacters,new Set(),esc,getName,'start')}</div><button class="btn primary">Iniciar combate com os selecionados</button></form></section>`;
    root.querySelector('#undo-ended-combat')?.addEventListener('click',async()=>{if(!confirm(`Desfazer "${lastUndo.label}" e reabrir ${lastUndo.encounter_name}?`))return;const label=await withBusy(()=>api.undoLastCombatAction(lastUndo.encounter_id),'Combate restaurado.');toast(`Desfeito: ${label}`,'good');renderMasterCombatPageV2(ctx);});
    bindCombatEntityPicker(root,'start');
    root.querySelector('#encounter-form').onsubmit=async e=>{
      e.preventDefault();
      const f=new FormData(e.currentTarget);
      const entries=collectCombatPickerEntries(root,'start');
      if(!entries.length){toast('Selecione pelo menos uma ficha para iniciar o combate.','bad');return;}
      await withBusy(()=>api.createEncounterWithParticipants(f.get('name'),entries),'Combate iniciado.');
      renderMasterCombatPageV2(ctx);
    };
    return;
  }

  const active=state.activeEncounter;
  ctx.subscribeCombatRealtime?.(active.id,()=>renderMasterCombatPageV2(ctx));
  const participants=await api.getCombatParticipants(active.id);
  const [targetsRaw,actions,lastUndo,effects,boostableActions,improvisedEvents]=await Promise.all([
    safeCombatRead('alvos do combate',()=>api.getCombatTargets(active.id),null),
    safeCombatRead('histórico de ações',()=>api.getVisibleCombatActions(active.id),[]),
    safeCombatRead('última ação desfazível',()=>api.getLatestCombatUndo(active.id),null),
    safeCombatRead('efeitos temporários',()=>api.getCombatEffects(active.id),[]),
    safeCombatRead('ataques que podem receber bônus',()=>api.getBoostableCombatActions(active.id),[]),
    api.getImprovisedEvents(active.id),
  ]);
  const sideByCharacter=Object.fromEntries(participants.map(p=>[String(p.character_id),p.side_key||'neutral']));
  const targets=(Array.isArray(targetsRaw)?targetsRaw:fallbackTargetsFromParticipants(participants)).map(t=>({...t,side_key:t.side_key||sideByCharacter[String(t.character_id)]||'neutral',selectable:true}));
  state.encounterParticipants=participants;
  const caMap=Object.fromEntries(targets.map(t=>[t.character_id,t.ca]));
  const inCombat=new Set(participants.map(p=>p.character_id));
  const boardTokens=boardTokensFromMasterParticipants(participants,getName);
  const activeParticipant=participants.find(p=>p.id===active.active_participant_id)||null;
  const actor=activeParticipant?.characters||null;
  const actorName=actor?getName(actor):'';
  state.combatActorId=actor?.id||null;

  const actorBundle=actor?await loadAbilityBundle(actor.id):{parentAbilities:[],children:[]};
  const actorEquipment=actor?await safeCombatRead('equipamentos da entidade ativa',()=>api.getEquipment(actor.id),[]):[];
  const approvedAbilities=actorBundle.parentAbilities.filter(a=>a.status==='approved');
  const activeSummonId=activeParticipant?.active_summon_character_id||null;
  const actorAbilityCards=actor?[
    ...approvedAbilities.flatMap(a=>abilityVariants(a).map(variant=>abilityCardCombat({ability:a,variant,targets,actorId:actor.id,actorName,esc,enabled:true,prefix:'master-ability',activeCombatMode:activeParticipant?.active_combat_mode||null,boostableActions}))),
    ...actorBundle.children.flatMap(({child,abilities})=>abilities.filter(a=>a.status==='approved').flatMap(a=>abilityVariants(a).map(variant=>abilityCardCombat({ability:a,variant,targets,actorId:actor.id,actorName,esc,enabled:true,locked:child.id!==activeSummonId,prefix:'master-ability',summonName:getName(child),activeCombatMode:activeParticipant?.active_combat_mode||null,boostableActions}))))
  ]:[];

  const usableEquipment=actorEquipment.filter(i=>i.status==='approved'&&(i.equipped||i.category==='consumable'));
  const attackEquipment=usableEquipment.filter(i=>i.equipped&&equipmentDefaults(i).enabled);
  const effectEquipment=usableEquipment.flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>['active','reaction','attack'].includes(e.type)).flatMap(effect=>effectVariants(effect).map(variant=>({item:i,effect,variant}))));
  const passiveEquipment=actorEquipment.filter(i=>i.status==='approved'&&i.equipped).flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>e.type==='passive').map(effect=>({item:i,effect})));
  const offHandFree=!actorEquipment.some(i=>i.status==='approved'&&i.equipped&&i.equip_slot==='off_hand');
  const masterAttackTargetOpts=actor?targets.filter(t=>!t.defeated&&String(t.character_id)!==String(actor.id)).map(t=>`<option value="${t.character_id}">${esc(t.display_name)} • CA ${t.ca}</option>`).join(''):'';

  // O Mestre também enxerga habilidades de reação de todos os participantes, não só de quem está no turno.
  const reactionData=await Promise.all(participants.map(async p=>{
    const [bundle,equipment]=await Promise.all([
      loadAbilityBundle(p.character_id),
      safeCombatRead(`equipamentos de reação ${p.character_id}`,()=>api.getEquipment(p.character_id),[]),
    ]);
    const name=getName(p.characters);
    const activeChild=p.active_summon_character_id;
    const abilityEntries=[
      ...bundle.parentAbilities.filter(a=>a.status==='approved').flatMap(a=>abilityVariants(a).filter(v=>isReactionConfig(v.config)).map(variant=>({p,name,a,variant,locked:false}))),
      ...bundle.children.flatMap(({child,abilities})=>abilities.filter(a=>a.status==='approved').flatMap(a=>abilityVariants(a).filter(v=>isReactionConfig(v.config)).map(variant=>({p,name,a,variant,locked:child.id!==activeChild,summonName:getName(child)}))))
    ];
    const equipmentEntries=equipment.filter(i=>i.status==='approved'&&(i.equipped||i.category==='consumable')).flatMap(item=>(Array.isArray(item.effects)?item.effects:[]).filter(e=>e.type==='reaction'||isReactionConfig(e.config||{})).flatMap(effect=>effectVariants(effect).filter(v=>effect.type==='reaction'||isReactionConfig(v.config)).map(variant=>({p,name,item,effect,variant}))));
    return {abilityEntries,equipmentEntries};
  }));
  const reactionAbilities=reactionData.flatMap(x=>x.abilityEntries);
  const reactionEquipment=reactionData.flatMap(x=>x.equipmentEntries);

  const turnStatus=activeParticipant
    ? `<div class="eyebrow">TURNO ATIVO</div><h2 style="margin:0 0 6px">Vez de ${esc(actorName)}</h2><div class="notice">Somente ${esc(actorName)} pode iniciar ações normais. Reações de qualquer participante continuam disponíveis quando suas regras permitirem.</div>`
    : `<div class="eyebrow">AGUARDANDO INÍCIO DE TURNO</div><h2 style="margin:0 0 6px">Escolha quem vai agir</h2><div class="notice">Clique em <strong>Iniciar turno</strong>. Habilidades de reação não dependem de ser a vez do usuário.</div>`;

  root.innerHTML=`${pageHeader(`Rodada ${active.round}`,'Combate do Mestre','<span class="pill bad">Rolagens do Mestre ficam ocultas para jogadores</span>')}
    <section class="card combat-master-controls"><div class="btn-row"><div><strong>${esc(active.name)}</strong><div class="muted small">${activeParticipant?`Turno iniciado para ${esc(actorName)}.`:'Nenhum turno ativo.'}</div>${lastUndo?`<div class="muted small" style="margin-top:4px">Última ação desfazível: <strong>${esc(lastUndo.label)}</strong></div>`:'<div class="muted small" style="margin-top:4px">Ainda não há ação para desfazer.</div>'}</div><div class="btn-row"><button class="btn warn" id="undo-combat" ${lastUndo?'':'disabled'}>Desfazer última ação</button><button class="btn bad" id="end-encounter">Encerrar combate</button></div></div></section>
    <div style="height:14px"></div><section class="card">${turnStatus}</section>
    <div style="height:14px"></div>
    ${combatBoardHtml({encounter:active,tokens:boardTokens,esc,editable:true,activeParticipantId:active.active_participant_id})}
    <div style="height:14px"></div>
    <section class="grid grid-2"><div class="card"><h2>Participantes</h2><div class="list">${participants.map(p=>participantCard(p,ctx,true,active.active_participant_id,caMap)).join('')||'<p class="muted">Vazio.</p>'}</div><div class="combat-add-controls"><button class="btn primary" id="toggle-add-combat">+ Adicionar personagens ao combate</button><div id="add-combat-panel" hidden><h3>Adicionar durante o combate</h3>${combatEntityPickerHtml(state.masterCharacters,inCombat,esc,getName,'add')}<button class="btn good" id="add-selected-combat" style="margin-top:10px">Adicionar selecionados</button></div></div></div>
    <div class="card"><h2>Ações do turno</h2>${actor?`<div class="list-item"><div class="title">${esc(actorName)}</div>${specialResourcesHtml(activeParticipant,esc,true,'master-resource')}<div style="margin-top:8px">${combatEffectsHtml(effects,actor.id,esc,{ownTurn:true,prefix:'master'})}</div></div><form id="master-basic" class="grid" style="margin-top:10px"><h3>Golpe corpo a corpo</h3><label>Alvo<select name="target">${masterAttackTargetOpts}</select></label><label style="display:flex;align-items:center;gap:7px"><input name="cursed" type="checkbox" style="width:auto" /> Conduzir +1 EA</label><button class="btn bad">Atacar em segredo</button></form><hr style="border-color:#333"><form id="master-skill" class="grid"><h3>Teste secreto</h3><label>Perícia<select name="skill">${optionList(SKILLS)}</select></label>${modeFields('')}<button class="btn bad">Rolar em segredo</button></form>`:'<div class="notice">Nenhuma entidade pode realizar ação normal até você iniciar um turno.</div>'}</div></section>
    ${actor?`<div style="height:14px"></div><section class="grid grid-2"><div class="card"><h2>Habilidades de ${esc(actorName)}</h2><div class="list">${actorAbilityCards.join('')||'<p class="muted">Nenhuma habilidade aprovada.</p>'}</div>${actorBundle.children.length?`<div class="list" style="margin-top:10px">${actorBundle.children.map(({child})=>{const on=child.id===activeSummonId;return `<div class="list-item"><div class="btn-row"><div class="title">${esc(getName(child))}</div><span class="pill ${on?'good':'bad'}">${on?'ATIVA':'INATIVA'}</span>${on?`<button class="btn warn" data-master-dismiss-summon="${child.id}" data-summon-name="${esc(getName(child))}">Dispensar</button>`:''}</div></div>`}).join('')}</div>`:''}</div>
    <div class="card"><h2>Equipamentos de ${esc(actorName)}</h2><div class="list">${attackEquipment.map(i=>{const c=equipmentDefaults(i);const base=weaponDamageProfile(i.weapon_profile||'standard',false);const canTwo=i.weapon_profile==='standard'&&i.equip_slot==='main_hand'&&offHandFree;const temp=i.temporary_encounter_id?`<span class="pill warn">TEMPORÁRIO • ${i.temporary_turns_remaining??'?'} turno(s)</span>`:'';return `<div class="list-item"><div class="btn-row"><div class="title">${esc(i.name)}</div>${temp}</div><div class="meta">${base.paCost} PA • ${base.damageDiceCount}d${base.damageDie}</div><label>Alvo<select data-master-equipment-target="${i.id}">${masterAttackTargetOpts}</select></label>${canTwo?`<label><input type="checkbox" data-master-equipment-two-hands="${i.id}" style="width:auto" /> Duas mãos • 1d10</label>`:''}${!c.usesCursedEnergy?`<label><input type="checkbox" data-master-equipment-reinforce="${i.id}" style="width:auto" /> Conduzir +1 EA</label>`:''}<button class="btn bad" data-master-use-equipment="${i.id}">Atacar</button></div>`}).join('')||'<p class="muted">Nenhuma arma equipada.</p>'}${effectEquipment.filter(({effect,variant})=>!(effect.type==='reaction'||isReactionConfig(variant.config))).map(({item,effect,variant})=>equipmentEffectCardCombat({item,effect,variant,targets,actorId:actor.id,actorName,esc,enabled:true,prefix:'master-equipment-effect'})).join('')}${passiveEquipment.map(({item,effect})=>`<div class="list-item"><div class="title">${esc(item.name)} • ${esc(effect.name)}</div><span class="pill good">Passivo equipado</span><div class="body">${esc(effect.mechanics||effect.description||'')}</div></div>`).join('')}</div></div></section>`:''}
    <div style="height:14px"></div><section class="card"><h2>Reações próprias dos participantes</h2><div class="notice">Aqui o Mestre pode acionar habilidades e efeitos de equipamento marcados como reação mesmo que não seja o turno daquele personagem.</div><div class="grid grid-2" style="margin-top:10px">${reactionAbilities.map(({p,name,a,variant,locked,summonName})=>`<div><div class="eyebrow">${esc(name)}</div>${abilityCardCombat({ability:a,variant,targets,actorId:p.character_id,actorName:name,esc,enabled:false,locked,prefix:'master-reaction',summonName,activeCombatMode:p.active_combat_mode||null,boostableActions})}</div>`).join('')}${reactionEquipment.map(({p,name,item,effect,variant})=>`<div><div class="eyebrow">${esc(name)}</div>${equipmentEffectCardCombat({item,effect,variant,targets,actorId:p.character_id,actorName:name,esc,enabled:false,prefix:'master-reaction-equipment'})}</div>`).join('')||(!reactionAbilities.length?'<p class="muted">Nenhuma reação própria cadastrada.</p>':'')}</div></section>
    <div style="height:14px"></div><section class="card"><h2>Ações e reações</h2><div class="list">${actions.map(a=>actionCard(a,ctx)).join('')||'<p class="muted">Nenhuma ação.</p>'}</div></section>`;

  bindStructuredAbilityControls(root);
  bindMasterCombatBoard(root,active,boardTokens,ctx,()=>renderMasterCombatPageV2(ctx));
  root.querySelector('.combat-master-controls').insertAdjacentHTML('afterend',improvisedFormHtml(participants,state.conditions,actor?.id,esc,getName));
  root.insertAdjacentHTML('beforeend',improvisedEventsHtml(improvisedEvents,esc));
  root.insertAdjacentHTML('beforeend',`<section class="card" style="margin-top:14px"><h2>Efeitos dos participantes</h2>${participants.map(p=>`<h3>${esc(getName(p.characters))}</h3>${combatEffectsHtml(effects,p.character_id,esc,{prefix:'master',ownTurn:p.id===active.active_participant_id})}`).join('')}</section>`);
  bindImprovisedForm(root,async action=>{
    await withBusy(()=>api.improviseCombatAction(active.id,action),'Ação registrada.');
    await renderMasterCombatPageV2(ctx);
  });
  for(const [selector,consume] of [['[data-remove-improvised]',false],['[data-consume-improvised]',true]]) {
    root.querySelectorAll(selector).forEach(btn=>btn.onclick=async()=>{
      await withBusy(()=>api.manageImprovisedEffect(btn.dataset.removeImprovised||btn.dataset.consumeImprovised,consume),'Efeito atualizado.');
      await renderMasterCombatPageV2(ctx);
    });
  }

  root.querySelector('#undo-combat')?.addEventListener('click',async()=>{if(!lastUndo)return;if(!confirm(`Desfazer a última ação do combate?\n\n${lastUndo.label}\n\nTudo que essa ação gastou ou causou será restaurado.`))return;const label=await withBusy(()=>api.undoLastCombatAction(active.id),'Ação desfeita.');toast(`Desfeito: ${label}`,'good');renderMasterCombatPageV2(ctx);});
  root.querySelector('#end-encounter')?.addEventListener('click',async()=>{if(!confirm('Encerrar este combate?'))return;await withBusy(()=>api.endEncounter(active.id),'Combate encerrado.');state.activeEncounter=null;state.combatActorId=null;renderMasterCombatPageV2(ctx);});
  const addPanel=root.querySelector('#add-combat-panel');
  root.querySelector('#toggle-add-combat')?.addEventListener('click',()=>{if(!addPanel)return;addPanel.hidden=!addPanel.hidden;if(!addPanel.hidden)root.querySelector('[data-combat-search="add"]')?.focus();});
  bindCombatEntityPicker(root,'add');
  root.querySelector('#add-selected-combat')?.addEventListener('click',async()=>{
    const entries=collectCombatPickerEntries(root,'add');
    if(!entries.length){toast('Selecione pelo menos uma ficha para adicionar.','bad');return;}
    await withBusy(()=>api.addCombatParticipants(active.id,entries),'Participantes adicionados.');
    renderMasterCombatPageV2(ctx);
  });
  root.querySelectorAll('[data-save-combat]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.saveCombat;await withBusy(()=>api.updateCombatParticipant(id,{current_ps:Number(root.querySelector(`[data-cps="${id}"]`).value),current_ea:Number(root.querySelector(`[data-cea="${id}"]`).value),current_pa:Number(root.querySelector(`[data-cpa="${id}"]`).value),side_key:root.querySelector(`[data-cside="${id}"]`)?.value||'neutral'},active.id),'Recursos e lado atualizados.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-cvisible]').forEach(input=>input.addEventListener('change',async()=>{const id=input.dataset.cvisible;await withBusy(()=>api.updateCombatParticipant(id,{visible_to_players:Boolean(input.checked)},active.id),input.checked?'Participante revelado aos players.':'Participante ocultado dos players.');renderMasterCombatPageV2(ctx);}));
  root.querySelectorAll('[data-ctargetable]').forEach(input=>input.addEventListener('change',async()=>{const id=input.dataset.ctargetable;await withBusy(()=>api.updateCombatParticipant(id,{targetable_by_players:Boolean(input.checked)},active.id),input.checked?'Participante liberado como alvo.':'Participante removido dos alvos dos players.');renderMasterCombatPageV2(ctx);}));
  root.querySelector('#master-basic')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.createCombatAttack({encounterId:active.id,attackerCharacterId:actor.id,targetCharacterId:f.get('target'),label:'Golpe corpo a corpo',sourceType:'basic',attackAttributeKey:'strength',attackSkillKey:'fight',paCost:1,eaCost:f.get('cursed')==='on'?1:0,usesCursedEnergy:f.get('cursed')==='on',damageDiceCount:1,damageDie:6,damageFlatAttributeKey:'strength'}),'Ataque secreto realizado.');renderMasterCombatPageV2(ctx);});
  root.querySelector('#master-skill')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const skill=SKILL_BY_KEY[f.get('skill')];const result=await withBusy(()=>api.rollGeneralTest({characterId:actor.id,label:skill.name,attributeKey:skill.attribute,skillKey:skill.key,mode:f.get('mode'),count:Number(f.get('count')||2),visibility:'master',encounterId:active.id}));toast(`Rolagem secreta: ${result.total}`,'good');renderMasterCombatPageV2(ctx);});

  const useMasterAbility=async(btn,entryPrefix,actorId)=>{const abilityId=btn.dataset.abilityId;const modeKey=btn.dataset.modeKey||null;const all=[...actorBundle.parentAbilities,...actorBundle.children.flatMap(x=>x.abilities),...reactionAbilities.map(x=>x.a)];const a=all.find(x=>x.id===abilityId);if(!a)return;const cfg=mergedModeConfig(a,modeKey);const key=`${a.id}:${modeKey||'base'}`;const actorCharacter=participants.find(p=>p.character_id===actorId)?.characters;const name=actorCharacter?getName(actorCharacter):'Entidade';const special=cfg.special_action||'';const target=(isSelfTarget(cfg)||['set_combat_mode','boost_recent_attack','place_delayed_bomb'].includes(special))?actorId:root.querySelector(`[data-${entryPrefix}-target="${CSS.escape(key)}"]`)?.value;const overload=root.querySelector(`[data-overload="${CSS.escape(key)}"]`)?.value||null;const options={};if(cfg.special_action==='create_weapon'){options.weapon_profile=root.querySelector(`[data-weapon-profile="${CSS.escape(key)}"]`)?.value||'standard';options.weapon_attribute=root.querySelector(`[data-weapon-attribute="${CSS.escape(key)}"]`)?.value||'strength';}const multi=root.querySelector(`[data-${entryPrefix}-targets="${CSS.escape(key)}"]`);if(multi)options.target_ids=[...multi.selectedOptions].map(o=>o.value);const recent=root.querySelector(`[data-recent-action="${CSS.escape(key)}"]`);if(recent?.value)options.action_id=recent.value;const secondary=root.querySelector(`[data-secondary-target="${CSS.escape(key)}"]`);if(secondary?.value)options.secondary_target_id=secondary.value;await withBusy(()=>api.useAbilityInCombat({encounterId:active.id,actorCharacterId:actorId,abilityId:a.id,targetCharacterId:target,modeKey,overloadKey:overload,options,label:a.name}),`${name}: habilidade usada.`);renderMasterCombatPageV2(ctx);};
  root.querySelectorAll('[data-master-ability-use]').forEach(btn=>btn.onclick=()=>useMasterAbility(btn,'master-ability',actor.id));
  root.querySelectorAll('[data-master-reaction-use]').forEach(btn=>{const entry=reactionAbilities.find(x=>x.a.id===btn.dataset.abilityId&&(x.variant.modeKey||'')===(btn.dataset.modeKey||''));btn.onclick=()=>useMasterAbility(btn,'master-reaction',entry.p.character_id);});
  root.querySelectorAll('[data-master-resource-recharge]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.useCombatResourceAction(active.id,actor.id,btn.dataset.masterResourceRecharge,`Recarregar ${btn.dataset.masterResourceRecharge}`),'Recurso recarregado.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-master-dismiss-summon]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.dismissCombatSummon(active.id,actor.id,btn.dataset.summonName),'Invocação dispensada.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-master-use-equipment]').forEach(btn=>btn.onclick=async()=>{const i=attackEquipment.find(x=>x.id===btn.dataset.masterUseEquipment);const target=root.querySelector(`[data-master-equipment-target="${i.id}"]`)?.value;const reinforce=Boolean(root.querySelector(`[data-master-equipment-reinforce="${i.id}"]`)?.checked);const twoHanded=Boolean(root.querySelector(`[data-master-equipment-two-hands="${i.id}"]`)?.checked);await withBusy(()=>executeEquipment(i,actor.id,active.id,target,reinforce,twoHanded),'Ataque realizado.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-master-equipment-effect-use]').forEach(btn=>btn.onclick=async()=>{const item=usableEquipment.find(x=>x.id===btn.dataset.itemId);const effect=(item?.effects||[]).find(e=>String(e.id)===String(btn.dataset.effectId));const modeKey=btn.dataset.modeKey||null;const cfg=effectVariants(effect).find(v=>(v.modeKey||null)===modeKey)?.config||{};const key=`${item.id}:${effect.id}:${modeKey||'base'}`;const target=isSelfTarget(cfg)?actor.id:root.querySelector(`[data-master-equipment-effect-target="${CSS.escape(key)}"]`)?.value;await withBusy(()=>api.useEquipmentEffectInCombat({encounterId:active.id,actorCharacterId:actor.id,itemId:item.id,effectId:effect.id,targetCharacterId:target,modeKey,label:`${item.name}: ${effect.name}`}),'Efeito usado.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-master-reaction-equipment-use]').forEach(btn=>btn.onclick=async()=>{const entry=reactionEquipment.find(x=>x.item.id===btn.dataset.itemId&&String(x.effect.id)===String(btn.dataset.effectId)&&(x.variant.modeKey||'')===(btn.dataset.modeKey||''));if(!entry)return;const {p,item,effect,variant}=entry;const key=`${item.id}:${effect.id}:${variant.modeKey||'base'}`;const target=isSelfTarget(variant.config)?p.character_id:root.querySelector(`[data-master-reaction-equipment-target="${CSS.escape(key)}"]`)?.value;await withBusy(()=>api.useEquipmentEffectInCombat({encounterId:active.id,actorCharacterId:p.character_id,itemId:item.id,effectId:effect.id,targetCharacterId:target,modeKey:variant.modeKey,label:`${item.name}: ${effect.name}`}),'Reação usada.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-extinguish-effect]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.extinguishCombatEffect(active.id,btn.dataset.extinguishEffect,'Apagar efeito'),'Efeito removido.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-detonate-bomb]').forEach(btn=>btn.onclick=async()=>{if(!confirm('Detonar a Explosão Artística agora?'))return;await withBusy(()=>api.detonateArtBomb(active.id,btn.dataset.detonateBomb),'Explosão Artística detonada.');renderMasterCombatPageV2(ctx);});
  await bindCommonCombatButtons(root,ctx,active.id,()=>renderMasterCombatPageV2(ctx));
}
export function abilityCombatConfigFields(resources=[]) {
  const resourceOptions=(Array.isArray(resources)?resources:[]).map(r=>`<option value="${r.key}">${r.name||r.key}</option>`).join('');
  return `<div class="combat-config-box"><h3>Execução em combate</h3>
    <div class="field-row"><label style="display:flex;align-items:center;gap:7px"><input name="combatUsable" type="checkbox" checked style="width:auto" /> Pode ser executada pelo painel de combate</label><label style="display:flex;align-items:center;gap:7px"><input name="isReaction" type="checkbox" style="width:auto" /> É uma reação e pode ser usada fora do turno quando o gatilho permitir</label></div>
    <div class="field-row"><label>Relação de alvo<select name="targetRelation"><option value="any">Qualquer participante</option><option value="other">Qualquer outro participante</option><option value="enemy">Inimigo</option><option value="ally">Aliado</option><option value="ally_or_self">Aliado ou próprio</option><option value="self">Somente próprio</option></select></label><label style="display:flex;align-items:center;gap:7px"><input name="requiresAttack" type="checkbox" checked style="width:auto" /> Exige teste de ataque</label></div>
    <div class="field-row"><label>Atributo do ataque<select name="attackAttribute">${optionList(ATTRIBUTES,'cursed_control')}</select></label><label>Perícia do ataque<select name="attackSkill">${optionList(SKILLS,'technique_control')}</select></label></div>
    <div class="field-row"><label>Atributo somado ao dano<select name="damageFlatAttribute"><option value="">Nenhum</option>${optionList(ATTRIBUTES,'cursed_control')}</select></label><label>Dano fixo adicional<input name="damageFlatBonus" type="number" value="0" /></label></div>
    <div class="field-row"><label>Faixa de crítico<input name="criticalThreshold" type="number" min="2" max="20" value="20" /></label><label style="display:flex;align-items:center;gap:7px"><input name="usesCursedEnergy" type="checkbox" checked style="width:auto" /> Conduz EA e pode gerar Kokusen em 20 natural</label></div>
    <label style="display:flex;align-items:center;gap:7px"><input name="forcedCritical" type="checkbox" style="width:auto" /> Crítico forçado</label>

    <details class="advanced-builder"><summary>Teste resistido, cura, custo corporal e limites</summary>
      <div class="field-row" style="margin-top:10px"><label style="display:flex;align-items:center;gap:7px"><input name="usesContest" type="checkbox" style="width:auto" /> Resolver como teste resistido</label><span class="muted small">Use quando a habilidade compara diretamente duas rolagens, em vez de atacar a CA.</span></div>
      <div class="field-row"><label>Atributo da resistência<select name="defenderAttribute">${optionList(ATTRIBUTES,'resistance')}</select></label><label>Perícia da resistência<select name="defenderSkill">${optionList(SKILLS,'steadiness')}</select></label></div>
      <div class="field-row-3"><label>Dados de cura<input name="healingDiceCount" type="number" min="0" max="12" value="0" /></label><label>Dado da cura<select name="healingDie"><option value="0">Sem cura</option>${[4,6,8,10,12,20].map(v=>`<option value="${v}">d${v}</option>`).join('')}</select></label><label>Atributo na cura<select name="healingFlatAttribute"><option value="">Nenhum</option>${optionList(ATTRIBUTES,'cursed_control')}</select></label></div>
      <div class="field-row"><label>Dano próprio ao ativar<div class="field-row"><input name="selfDamageDiceCount" type="number" min="0" max="12" value="0" aria-label="Quantidade" /><select name="selfDamageDie"><option value="0">Sem dano próprio</option>${[4,6,8,10,12,20].map(v=>`<option value="${v}">d${v}</option>`).join('')}</select></div></label><label>Recurso especial<select name="resourceKey"><option value="">Nenhum</option>${resourceOptions}</select><input name="resourceAmount" type="number" min="0" value="0" placeholder="Quantidade" /></label></div>
      <div class="field-row"><label><input name="onceRound" type="checkbox" style="width:auto" /> 1× por rodada</label><label><input name="onceTarget" type="checkbox" style="width:auto" /> 1× por combate por alvo</label></div>
    </details>

    <details class="advanced-builder"><summary>Efeito estruturado / efeito após acertar</summary>
      <div class="field-row" style="margin-top:10px"><label>Quando aplicar<select name="effectTiming"><option value="activation">Ao usar a habilidade</option><option value="on_hit">Somente depois de acertar</option></select></label><label>Tipo de efeito<select name="effectKind"><option value="">Nenhum</option><option value="ca_bonus">Bônus de CA</option><option value="attack_bonus">Bônus no próximo ataque</option><option value="bonus_damage">Dano extra no primeiro acerto</option><option value="damage_reduction">Redução de dano</option><option value="skill_modifier">Bônus/penalidade em perícia</option><option value="pa_penalty">Penalidade de PA no próximo turno</option><option value="block_actions">Bloquear ações/reações</option><option value="immunity">Proteção temporal / imunidade</option><option value="burn">Dano no início do turno / queimadura</option></select></label></div>
      <div class="field-row"><label>Nome do efeito<input name="effectName" placeholder="Ex.: Tarukaja, Queimadura, Desorientado" /></label><label>Perícia modificada<select name="effectSkill"><option value="">Nenhuma</option>${optionList(SKILLS,'fortitude')}</select></label></div>
      <div class="field-row-3"><label>Duração em turnos<input name="effectTurns" type="number" min="0" value="0" /></label><label>Usos do efeito<input name="effectUses" type="number" min="0" value="0" /></label><label>Valor fixo<input name="effectValue" type="number" value="0" /></label></div>
      <div class="field-row"><label>Dados do efeito<div class="field-row"><input name="effectDiceCount" type="number" min="0" max="12" value="0" aria-label="Quantidade" /><select name="effectDie"><option value="0">Sem dado</option>${[4,6,8,10,12,20].map(v=>`<option value="${v}">d${v}</option>`).join('')}</select></div></label><label style="display:flex;align-items:center;gap:7px"><input name="effectRefreshUses" type="checkbox" style="width:auto" /> Restaurar os usos no início de cada turno do alvo</label></div>
      <div class="notice" style="margin-top:10px">Se escolher <strong>depois de acertar</strong>, o efeito só nasce quando o ataque realmente conecta. Isso evita habilidades em que o texto diz “se acertar”, mas a automação aplica o efeito antes do golpe.</div>
      <label style="display:flex;align-items:center;gap:7px;margin-top:10px"><input name="effectResistance" type="checkbox" style="width:auto" /> Depois do acerto, o alvo ainda faz um teste para resistir ao efeito</label>
      <div class="field-row"><label>Resistência: Atributo<select name="effectDefenderAttribute">${optionList(ATTRIBUTES,'resistance')}</select></label><label>Resistência: Perícia<select name="effectDefenderSkill">${optionList(SKILLS,'steadiness')}</select></label></div>
      <div class="field-row"><label>CD usa Atributo<select name="effectDcAttribute">${optionList(ATTRIBUTES,'cursed_control')}</select></label><label>CD usa Perícia<select name="effectDcSkill">${optionList(SKILLS,'technique_control')}</select></label></div>
    </details>

    <details class="advanced-builder"><summary>Sobrecarga opcional</summary>
      <label style="display:flex;align-items:center;gap:7px;margin-top:10px"><input name="hasOverload" type="checkbox" style="width:auto" /> Esta habilidade possui uma execução de Sobrecarga</label>
      <div class="field-row"><label>Nome da Sobrecarga<input name="overloadLabel" placeholder="Sobrecarga" /></label><label>EA adicional<input name="overloadExtraEa" type="number" min="0" value="0" /></label></div>
      <div class="field-row-3"><label>PA adicional<input name="overloadExtraPa" type="number" min="0" value="0" /></label><label>Dados de dano adicionais<input name="overloadExtraDice" type="number" min="0" value="0" /></label><label>Usos adicionais do efeito<input name="overloadExtraUses" type="number" min="0" value="0" /></label></div>
      <div class="field-row-3"><label style="display:flex;align-items:center;gap:7px"><input name="overloadSecondTarget" type="checkbox" style="width:auto" /> Exige um segundo alvo</label><label>Dados no 2º alvo ×<input name="overloadSecondDieFactor" type="number" min="0.1" max="1" step="0.1" value="1" /></label><label>Modificador no 2º alvo ×<input name="overloadSecondFlatFactor" type="number" min="0" max="1" step="0.1" value="1" /></label></div>
    </details>
  </div>`;
}

export function abilityConfigFromForm(form) {
  const f=new FormData(form);
  const cfg={
    pa_cost:Number(f.get('pa')||0), ea_cost:Number(f.get('ea')||0), damage_die:Number(f.get('die')||0), damage_dice_count:Number(f.get('diceCount')||0),
    range:f.get('range'), targets:f.get('targets'), duration:f.get('duration'), condition_severity:f.get('condition'), condition_key:f.get('conditionKey')||null,
    once_per_combat:f.get('onceCombat')==='on', once_per_mission:f.get('onceMission')==='on', once_per_round:f.get('onceRound')==='on', once_per_combat_per_target:f.get('onceTarget')==='on',
    requires_preparation:f.get('preparation')==='on', meaningful_drawback:f.get('drawback')==='on',
    combat_usable:f.get('combatUsable')==='on', requires_attack:f.get('requiresAttack')==='on', is_reaction:f.get('isReaction')==='on',
    attack_attribute_key:f.get('attackAttribute')||'cursed_control', attack_skill_key:f.get('attackSkill')||'technique_control', damage_flat_attribute_key:f.get('damageFlatAttribute')||null,
    damage_flat_bonus:Number(f.get('damageFlatBonus')||0), uses_cursed_energy:f.get('usesCursedEnergy')==='on', forced_critical:f.get('forcedCritical')==='on', critical_threshold:Number(f.get('criticalThreshold')||20),
    target_relation:f.get('targetRelation')||'any',
    healing_dice_count:Number(f.get('healingDiceCount')||0), healing_die:Number(f.get('healingDie')||0), healing_flat_attribute_key:f.get('healingFlatAttribute')||null,
    self_damage_dice_count:Number(f.get('selfDamageDiceCount')||0), self_damage_die:Number(f.get('selfDamageDie')||0),
  };
  if(cfg.target_relation==='self' || cfg.targets==='self' || cfg.range==='self') { cfg.target_mode='self'; cfg.targets='self'; }
  else if(cfg.targets==='few' || cfg.targets==='area') cfg.target_mode='multiple';
  if(f.get('usesContest')==='on') {
    cfg.requires_attack=false;
    cfg.contest={attacker_attribute:cfg.attack_attribute_key,attacker_skill:cfg.attack_skill_key,defender_attribute:f.get('defenderAttribute')||'resistance',defender_skill:f.get('defenderSkill')||'steadiness'};
  }
  const resourceKey=f.get('resourceKey'); const resourceAmount=Number(f.get('resourceAmount')||0);
  if(resourceKey && resourceAmount>0) cfg.resource_cost={key:resourceKey,amount:resourceAmount};
  const effectKind=f.get('effectKind');
  if(effectKind){
    const effectName=String(f.get('effectName')||'Efeito da habilidade').trim()||'Efeito da habilidade';
    const turns=Number(f.get('effectTurns')||0), uses=Number(f.get('effectUses')||0), value=Number(f.get('effectValue')||0), diceCount=Number(f.get('effectDiceCount')||0), die=Number(f.get('effectDie')||0);
    const data={};
    if(effectKind==='ca_bonus') data.ca_bonus=value||1;
    if(effectKind==='attack_bonus'){data.attack_bonus=value||1;data.remove_when_empty=true;}
    if(effectKind==='bonus_damage'){data.bonus_damage_dice_count=diceCount||1;data.bonus_damage_die=die||4;data.remove_when_empty=false;}
    if(effectKind==='damage_reduction'){data.damage_reduction_dice_count=diceCount||1;data.damage_reduction_die=die||6;data.damage_reduction_flat=Math.max(0,value);data.applies_to='any';data.remove_when_empty=uses>0;}
    if(effectKind==='skill_modifier'){const skill=f.get('effectSkill');if(skill)data.skill_modifiers={[skill]:value||1};}
    if(effectKind==='pa_penalty') data.pa_penalty_next_turn=Math.max(1,value||1);
    if(effectKind==='block_actions'){data.blocks_actions=true;data.blocks_reactions=true;}
    if(effectKind==='immunity'){data.immune_to_damage=true;data.immune_to_external_changes=true;}
    if(effectKind==='burn'){data.start_turn_damage_dice_count=diceCount||1;data.start_turn_damage_die=die||4;data.extinguish_pa_cost=Math.max(0,value||1);data.decrement_on='target_start';}
    if(f.get('effectRefreshUses')==='on' && uses>0) data.reset_uses=uses;
    const timing=f.get('effectTiming')||'activation';
    if(timing==='on_hit'){
      if(f.get('effectResistance')==='on'){
        cfg.on_hit_effect={type:'contest_effect',defender_attribute:f.get('effectDefenderAttribute')||'resistance',defender_skill:f.get('effectDefenderSkill')||'steadiness',dc_attribute:f.get('effectDcAttribute')||'cursed_control',dc_skill:f.get('effectDcSkill')||'technique_control',on_fail_key:`custom_${effectKind}`,on_fail_name:effectName,on_fail_data:data};
        if(turns>0) cfg.on_hit_effect.on_fail_remaining_turns=turns;
        if(uses>0) cfg.on_hit_effect.on_fail_uses=uses;
      } else {
        cfg.on_hit_effect={key:`custom_${effectKind}`,name:effectName,data};
        if(effectKind==='burn'){cfg.on_hit_effect.type='burn';cfg.on_hit_effect.start_turn_damage_dice_count=diceCount||1;cfg.on_hit_effect.start_turn_damage_die=die||4;cfg.on_hit_effect.extinguish_pa_cost=Math.max(0,value||1);}
        if(turns>0) cfg.on_hit_effect.remaining_turns=turns;
        if(uses>0) cfg.on_hit_effect.uses=uses;
      }
    } else {
      cfg.combat_effect={key:`custom_${effectKind}`,name:effectName,data};
      if(turns>0) cfg.combat_effect.remaining_turns=turns;
      if(uses>0) cfg.combat_effect.uses=uses;
    }
  }
  if(f.get('hasOverload')==='on'){
    const overrides={};
    const extraDice=Number(f.get('overloadExtraDice')||0); if(extraDice>0) overrides.damage_dice_count=cfg.damage_dice_count+extraDice;
    const extraUses=Number(f.get('overloadExtraUses')||0); if(extraUses>0) overrides.effect_charges=Math.max(1,Number(cfg.combat_effect?.uses||0)+extraUses);
    if(f.get('overloadSecondTarget')==='on'){
      overrides.requires_secondary_target=true;
      overrides.secondary_target_die_factor=Math.max(0.1,Math.min(1,Number(f.get('overloadSecondDieFactor')||1)));
      overrides.secondary_target_flat_factor=Math.max(0,Math.min(1,Number(f.get('overloadSecondFlatFactor')??1)));
      overrides.secondary_target_damage_factor=1;
      overrides.secondary_target_relation=cfg.target_relation;
    }
    cfg.overloads=[{key:'overload',label:String(f.get('overloadLabel')||'Sobrecarga').trim()||'Sobrecarga',extra_pa:Number(f.get('overloadExtraPa')||0),extra_ea:Number(f.get('overloadExtraEa')||0),overrides}];
  }
  cfg.healing=cfg.healing_dice_count>0&&cfg.healing_die>0;
  return cfg;
}

export function equipmentAttackConfigFields() {
  return `<div class="combat-config-box"><h3>Ataque do equipamento</h3><label style="display:flex;align-items:center;gap:7px"><input name="attackEnabled" type="checkbox" style="width:auto" /> Este item pode realizar ataque</label><div class="field-row"><label>Atributo<select name="attackAttribute">${optionList(ATTRIBUTES,'strength')}</select></label><label>Perícia<select name="attackSkill">${optionList(SKILLS,'fight')}</select></label></div><div class="field-row-3"><label>PA<input name="attackPa" type="number" min="0" max="7" value="1" /></label><label>EA<input name="attackEa" type="number" min="0" value="0" /></label><label>Dado<select name="attackDie">${[4,6,8,10,12,20].map(v=>`<option value="${v}" ${v===8?'selected':''}>d${v}</option>`).join('')}</select></label></div><div class="field-row"><label>Qtd. dados<input name="attackDiceCount" type="number" min="0" max="12" value="1" /></label><label>Atributo no dano<select name="damageFlatAttribute"><option value="">Nenhum</option>${optionList(ATTRIBUTES,'strength')}</select></label></div><label style="display:flex;align-items:center;gap:7px"><input name="usesCursedEnergy" type="checkbox" style="width:auto" /> Ataque conduz Energia Amaldiçoada</label></div>`;
}
