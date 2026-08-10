import * as api from './api.js';
import { ATTRIBUTES, SKILLS, ATTRIBUTE_BY_KEY, SKILL_BY_KEY, characterDerived, weaponDamageProfile } from './system.js';
import { equipmentEffectCombatDefaults } from './equipment-ui.js';

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
  const names=(keys||[]).map(key=>conditions.find(c=>c.key===key)?.name || key);
  return names.length ? names.map(n=>`<span class="pill warn">${esc(n)}</span>`).join(' ') : '<span class="muted small">Sem condições</span>';
}

function actionCard(action, ctx) {
  const { esc, state } = ctx;
  const incoming = state.profile.role!=='master' && action.target_character_id===state.character?.id;
  const attackText = action.attack_hidden
    ? '<strong>Rolagem do Mestre oculta.</strong> O ataque superou sua defesa passiva.'
    : action.attack_total!=null
      ? `Ataque: <strong>${action.attack_total}</strong>${action.attack_natural!=null?` (natural ${action.attack_natural})`:''}`
      : '';
  const defenseText = action.defense_type
    ? action.defense_hidden
      ? '<br>Defesa do Mestre: <strong>oculta</strong>'
      : `<br>Defesa ${esc(action.defense_type)}: ${action.defense_total??'—'}${action.defense_natural!=null?` (natural ${action.defense_natural})`:''}`
    : '';
  const tags=[action.is_critical?'<span class="pill warn">Crítico</span>':'',action.is_kokusen?'<span class="pill bad">Kokusen</span>':'',action.kokusen_denied?'<span class="pill">Kokusen anulado</span>':''].filter(Boolean).join(' ');
  // O Mestre pode resolver qualquer reação pendente (útil para NPCs e para destravar testes).
  // Jogadores só podem reagir quando são o alvo da ação.
  const pending = action.status==='pending_defense' && (state.profile.role==='master' || incoming);
  const counter = action.counterattack_available && (state.profile.role==='master' || action.target_character_id===state.character?.id);
  return `<div class="list-item combat-action ${pending?'incoming':''}">
    <div class="btn-row"><div class="title">${esc(action.attacker_name)} → ${esc(action.target_name)} • ${esc(action.label)}</div><span class="pill">${esc(action.status)}</span>${tags}</div>
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
    <div class="btn-row"><div class="title">${esc(displayName)}</div><span class="pill">Iniciativa ${p.initiative}</span>${isActive?'<span class="pill good">TURNO ATIVO</span>':''}${p.black_flash_turns>0?`<span class="pill bad">Fluxo Negro ${p.black_flash_turns}</span>`:''}${p.defeated?'<span class="pill bad">Derrotado</span>':''}</div>
    <div class="grid grid-4 compact-stats" style="margin-top:10px"><div><span class="muted small">PS</span><div><strong>${p.current_ps??d.ps}</strong> / ${d.ps}</div></div><div><span class="muted small">EA</span><div><strong>${p.current_ea??d.ea}</strong> / ${d.ea}</div></div><div><span class="muted small">PA</span><div><strong>${p.current_pa??d.pa}</strong> / ${d.pa}</div></div><div><span class="muted small">CA</span><div><strong>${caMap[p.character_id]??d.ca}</strong></div></div></div>
    <div style="margin-top:9px">${conditionNames(conditions,state.conditions,esc)}</div>
    ${editable?`<div class="field-row-3" style="margin-top:10px"><label>PS<input data-cps="${p.id}" type="number" value="${p.current_ps??d.ps}" /></label><label>EA<input data-cea="${p.id}" type="number" value="${p.current_ea??d.ea}" /></label><label>PA<input data-cpa="${p.id}" type="number" value="${p.current_pa??d.pa}" /></label></div>`:''}
    <div class="btn-row" style="margin-top:8px">${editable?`<button class="btn" data-save-combat="${p.id}">Salvar recursos</button>`:''}<button class="btn" data-roll-init="${p.id}">Rolar iniciativa</button>${turnControls}</div>
    ${conditions.length&&(editable||isActive)?`<div class="btn-row" style="margin-top:8px">${conditions.map(k=>`<button class="btn ghost" data-remove-condition="${p.id}" data-condition="${esc(k)}">Remover ${esc(state.conditions.find(c=>c.key===k)?.name||k)}</button>`).join('')}</div>`:''}
  </div>`;
}

async function bindCommonCombatButtons(root, ctx, encounterId, rerender) {
  const { toast, withBusy }=ctx;
  root.querySelectorAll('[data-defense]').forEach(btn=>btn.onclick=async()=>{
    const actionId=btn.dataset.action; const type=btn.dataset.defense;
    await withBusy(()=>api.resolveCombatDefense(actionId,type,'normal',1,encounterId),type==='accept'?'Golpe resolvido.':'Reação resolvida.');
    rerender();
  });
  root.querySelectorAll('[data-counter]').forEach(btn=>btn.onclick=async()=>{
    const id=btn.dataset.counter; const useEA=Boolean(root.querySelector(`[data-counter-ea="${id}"]`)?.checked);
    await withBusy(()=>api.createBasicCounterattack(id,useEA,encounterId),'Contra-ataque realizado.');rerender();
  });
  root.querySelectorAll('[data-roll-init]').forEach(btn=>btn.onclick=async()=>{const total=await withBusy(()=>api.rollCombatInitiative(btn.dataset.rollInit,encounterId));toast(`Iniciativa: ${total}`,'good');rerender();});
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
  root.querySelectorAll('[data-remove-condition]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.removeCombatCondition(btn.dataset.removeCondition,btn.dataset.condition,encounterId),'Condição removida.');rerender();});
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
  if(isSelfTarget(config)) return `<div class="meta" style="margin-top:8px">Alvo: <strong>${esc(actorName)}</strong> (próprio)</div>`;
  const hostile=Boolean(config.requires_attack || config.contest);
  const opts=(hostile?targets.filter(t=>t.character_id!==actorId):targets)
    .filter(t=>!t.defeated)
    .map(t=>`<option value="${t.character_id}">${esc(t.display_name)} • CA ${t.ca}</option>`).join('');
  const selfOpt=!hostile && !targets.some(t=>t.character_id===actorId)?`<option value="${actorId}">${esc(actorName)}</option>`:'';
  return `<label style="margin-top:8px">Alvo<select data-${prefix}-target="${key}" ${disabled?'disabled':''}>${opts}${selfOpt}</select></label>`;
}

function abilityCardCombat({ability,variant,targets,actorId,actorName,esc,enabled,locked=false,prefix='ability',summonName=''}) {
  const cfg=variant.config||{};
  const reaction=isReactionConfig(cfg);
  const canUse=!locked && (enabled || reaction);
  const key=`${ability.id}:${variant.modeKey||'base'}`;
  const special=cfg.special_action||'';
  const resourceText=cfg.resource_cost?.key?` • usa ${Number(cfg.resource_cost.amount||1)} ${esc(cfg.resource_cost.key)}`:'';
  const lockNote=locked?`<div class="notice" style="margin-top:8px">TRAVADO: manifeste ${esc(summonName||'a invocação')} para liberar esta habilidade.</div>`:'';
  const reactionPill=reaction?'<span class="pill good">REAÇÃO</span>':'';
  const bodyPill=ability.cursed_body_technique_id?'<span class="pill bad">TÉCNICA DO CORPO</span>':'';
  const modeTitle=variant.modeKey?`<div class="meta">Modo: ${esc(variant.label)}</div>`:'';
  const overload=overloadSelectHtml(ability,key,esc,!canUse);
  const target=targetControlHtml({config:cfg,key,targets,actorId,actorName,esc,disabled:!canUse,prefix});
  const weaponOptions=special==='create_weapon'?`<div class="field-row" style="margin-top:8px"><label>Perfil da arma<select data-weapon-profile="${key}" ${canUse?'':'disabled'}><option value="light">Leve • 1 PS</option><option value="standard" selected>Padrão • 1d4 PS</option><option value="heavy">Pesada • 1d6 PS</option><option value="very_heavy">Muito pesada • 1d8 PS</option></select></label><label>Atributo da arma<select data-weapon-attribute="${key}" ${canUse?'':'disabled'}><option value="strength">Força</option><option value="dexterity">Destreza</option></select></label></div>`:'';
  return `<div class="list-item ${locked?'locked':''}"><div class="btn-row"><div class="title">${esc(ability.name)}</div>${bodyPill}${reactionPill}${locked?'<span class="pill bad">TRAVADO</span>':''}</div>${modeTitle}<div class="meta">${esc(configCostText(cfg))}${resourceText}</div><div class="body">${esc(ability.mechanics||ability.description||'')}</div>${target}${overload}${weaponOptions}${lockNote}<button class="btn primary" data-${prefix}-use="${key}" data-ability-id="${ability.id}" data-mode-key="${esc(variant.modeKey||'')}" style="margin-top:8px" ${canUse?'':'disabled'}>${special==='activate_summon'?'Manifestar':special==='create_weapon'?'Criar arma':'Usar habilidade'}</button></div>`;
}

function equipmentEffectCardCombat({item,effect,variant,targets,actorId,actorName,esc,enabled,prefix='equipment-effect'}) {
  const cfg=variant.config||{};
  const reaction=effect.type==='reaction' || isReactionConfig(cfg);
  const canUse=enabled || reaction;
  const key=`${item.id}:${effect.id}:${variant.modeKey||'base'}`;
  const target=targetControlHtml({config:cfg,key,targets,actorId,actorName,esc,disabled:!canUse,prefix});
  return `<div class="list-item"><div class="btn-row"><div class="title">${esc(item.name)} • ${esc(effect.name)}</div>${reaction?'<span class="pill good">REAÇÃO</span>':''}</div>${variant.modeKey?`<div class="meta">Modo: ${esc(variant.label)}</div>`:''}<div class="meta">${esc(configCostText(cfg))}</div><div class="body">${esc(effect.mechanics||effect.description||'')}</div>${target}<button class="btn primary" data-${prefix}-use="${key}" data-item-id="${item.id}" data-effect-id="${esc(effect.id)}" data-mode-key="${esc(variant.modeKey||'')}" style="margin-top:8px" ${canUse?'':'disabled'}>Usar efeito</button></div>`;
}

function combatEffectsHtml(effects, characterId, esc) {
  const mine=effects.filter(e=>e.target_character_id===characterId);
  if(!mine.length) return '<span class="muted small">Nenhum efeito temporário ativo.</span>';
  return mine.map(e=>`<span class="pill warn">${esc(e.name)}${e.remaining_turns!=null?` • ${e.remaining_turns} turno(s)`:''}${e.uses_remaining!=null?` • ${e.uses_remaining} uso(s)`:''}</span>`).join(' ');
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

async function loadAbilityBundle(parentCharacterId) {
  const [parentAbilities,children]=await Promise.all([api.getAbilities(parentCharacterId),api.getChildSheets(parentCharacterId)]);
  const childRows=await Promise.all(children.map(async child=>({child,abilities:await api.getAbilities(child.id)})));
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
      <button class="btn primary">Rolar teste</button>
    </form><div class="notice" style="margin-top:10px">Fora de combate, o teste ainda é registrado. Rolagens feitas pelo Mestre permanecem secretas.</div></div>
    <div class="card"><h2>Histórico de testes</h2><div class="list">${logs.map(r=>`<div class="list-item"><div class="title">${esc(r.label)}: ${r.total}</div><div class="meta">${esc(r.expression)} • ${esc(JSON.stringify(r.rolls))} • bônus ${r.bonus>=0?'+':''}${r.bonus}</div></div>`).join('')||'<p class="muted">Nenhuma rolagem.</p>'}</div></div></section>`;
  root.querySelector('#general-test').onsubmit=async e=>{
    e.preventDefault(); const f=new FormData(e.currentTarget); const characterId=state.profile.role==='master'?f.get('character'):state.character.id;
    const skill=SKILL_BY_KEY[f.get('skill')]; const attributeKey=f.get('attribute')||skill.attribute; const mode=f.get('mode'); const count=Number(f.get('count')||2);
    const result=await withBusy(()=>api.rollGeneralTest({characterId,label:skill.name,attributeKey,skillKey:skill.key,mode,count,visibility:state.profile.role==='master'?'master':'public'}));
    toast(`${skill.name}: ${result.total}`,'good'); renderTestsPage(ctx);
  };
}

export async function quickSkillRoll(character, skillKey, ctx) {
  const { toast, withBusy, state }=ctx; const skill=SKILL_BY_KEY[skillKey];
  const result=await withBusy(()=>api.rollGeneralTest({characterId:character.id,label:skill.name,attributeKey:skill.attribute,skillKey:skill.key,mode:'normal',count:1,visibility:state.profile.role==='master'?'master':'public'}));
  toast(`${skill.name}: ${result.total}`,'good'); return result;
}

export async function renderPlayerCombatPageV2(ctx) {
  const { root, state, pageHeader, esc, withBusy, toast }=ctx;
  const encounters=await api.getEncounters();
  const active=encounters.find(e=>e.status==='active');
  if(!active){ctx.subscribeCombatRealtime?.(null,()=>{});root.innerHTML=`${pageHeader('Sala de combate','Combate')}<div class="notice">Nenhum combate ativo.</div>`;return;}
  ctx.subscribeCombatRealtime?.(active.id,()=>renderPlayerCombatPageV2(ctx));

  const [participants,targets,actions,equipment,bundle,effects]=await Promise.all([
    api.getCombatParticipants(active.id),api.getCombatTargets(active.id),api.getVisibleCombatActions(active.id),api.getEquipment(state.character.id),loadAbilityBundle(state.character.id),api.getCombatEffects(active.id)
  ]);
  const mine=participants.find(p=>p.character_id===state.character.id);
  const activeParticipant=participants.find(p=>p.id===active.active_participant_id)||null;
  const isMyTurn=Boolean(mine && activeParticipant?.id===mine.id);
  const myName=[state.character.first_name,state.character.last_name].filter(Boolean).join(' ') || 'Personagem';
  const activeName=activeParticipant?[activeParticipant.characters.first_name,activeParticipant.characters.last_name].filter(Boolean).join(' '):'';
  const caMap=Object.fromEntries(targets.map(t=>[t.character_id,t.ca]));
  const approvedAbilities=bundle.parentAbilities.filter(a=>a.status==='approved');
  const activeSummonId=mine?.active_summon_character_id||null;
  const activeSummon=bundle.children.find(x=>x.child.id===activeSummonId)||null;
  const childAbilityCards=bundle.children.flatMap(({child,abilities})=>abilities.filter(a=>a.status==='approved').flatMap(a=>abilityVariants(a).map(variant=>abilityCardCombat({ability:a,variant,targets,actorId:state.character.id,actorName:myName,esc,enabled:isMyTurn,locked:child.id!==activeSummonId,prefix:'ability',summonName:[child.first_name,child.last_name].filter(Boolean).join(' ')}))));
  const parentAbilityCards=approvedAbilities.flatMap(a=>abilityVariants(a).map(variant=>abilityCardCombat({ability:a,variant,targets,actorId:state.character.id,actorName:myName,esc,enabled:isMyTurn,prefix:'ability'})));

  const usableEquipment=equipment.filter(i=>i.status==='approved'&&(i.equipped||i.category==='consumable'));
  const attackEquipment=usableEquipment.filter(i=>i.equipped&&equipmentDefaults(i).enabled);
  const effectEquipment=usableEquipment.flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>['active','reaction','attack'].includes(e.type)).flatMap(effect=>effectVariants(effect).map(variant=>({item:i,effect,variant}))));
  const passiveEquipment=equipment.filter(i=>i.status==='approved'&&i.equipped).flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>e.type==='passive').map(effect=>({item:i,effect})));
  const offHandFree=!equipment.some(i=>i.status==='approved'&&i.equipped&&i.equip_slot==='off_hand');
  const hostileTargets=targets.filter(t=>t.character_id!==state.character.id&&!t.defeated);
  const targetOpts=hostileTargets.map(t=>`<option value="${t.character_id}">${esc(t.display_name)} • CA ${t.ca}</option>`).join('');

  const turnBanner=!mine
    ? `<section class="card"><div class="notice">Seu personagem ainda não foi adicionado a este combate.</div></section>`
    : isMyTurn
      ? `<section class="card"><div class="eyebrow">TURNO ATIVO</div><h2 style="margin-bottom:6px">Sua vez, ${esc(myName)}!</h2><div class="notice">Suas ações de turno estão liberadas. Habilidades marcadas como <strong>REAÇÃO</strong> também podem ser usadas fora do seu turno quando a situação permitir.</div></section>`
      : activeParticipant
        ? `<section class="card"><div class="eyebrow">AGUARDANDO TURNO</div><h2 style="margin-bottom:6px">Agora é a vez de ${esc(activeName)}.</h2><div class="notice">Ações normais estão bloqueadas. Suas <strong>reações próprias</strong>, além das reações defensivas oferecidas por ataques, continuam disponíveis.</div></section>`
        : `<section class="card"><div class="eyebrow">AGUARDANDO O MESTRE</div><h2 style="margin-bottom:6px">Nenhum turno foi iniciado.</h2><div class="notice">Aguarde o Mestre escolher quem vai agir. Reações próprias continuam aparecendo quando forem legalmente utilizáveis.</div></section>`;

  root.innerHTML=`${pageHeader(`Rodada ${active.round}`,'Combate')}
    ${turnBanner}<div style="height:14px"></div>
    <section class="grid grid-2"><div class="card"><h2>${esc(active.name)}</h2>${mine?participantCard(mine,ctx,false,active.active_participant_id,caMap):'<p class="muted">Seu personagem ainda não foi adicionado.</p>'}${mine?`<h3 style="margin-top:12px">Recursos especiais</h3>${specialResourcesHtml(mine,esc,isMyTurn)}<h3 style="margin-top:12px">Efeitos ativos</h3><div>${combatEffectsHtml(effects,state.character.id,esc)}</div>`:''}</div>
    <div class="card"><h2>Golpe corpo a corpo</h2>${mine&&targetOpts&&isMyTurn?`<form id="basic-attack" class="grid"><label>Alvo<select name="target">${targetOpts}</select></label><label style="display:flex;align-items:center;gap:7px"><input name="cursed" type="checkbox" style="width:auto" /> Conduzir +1 EA neste golpe • permite Kokusen em 20 natural</label>${modeFields('')}<div class="notice">1 PA • Força + Lutar • dano 1d6 + Mod. Força</div><button class="btn primary">Atacar</button></form>`:mine&&targetOpts?'<div class="notice">Aguardando o Mestre iniciar seu turno.</div>':'<p class="muted">É preciso estar no combate e possuir um alvo.</p>'}</div></section>
    <div style="height:14px"></div>
    <section class="grid grid-2"><div class="card"><h2>Habilidades</h2><div class="list">${parentAbilityCards.join('')||'<p class="muted">Nenhuma habilidade aprovada.</p>'}</div>${bundle.children.length?`<h3 style="margin-top:14px">Invocações</h3>${bundle.children.map(({child})=>{const activeChild=child.id===activeSummonId;const nm=[child.first_name,child.last_name].filter(Boolean).join(' ');return `<div class="list-item"><div class="btn-row"><div class="title">${esc(nm)}</div><span class="pill ${activeChild?'good':'bad'}">${activeChild?'ATIVA':'INATIVA'}</span>${activeChild&&isMyTurn?`<button class="btn warn" data-dismiss-summon="${child.id}" data-summon-name="${esc(nm)}">Dispensar</button>`:''}</div></div>`}).join('')}<div class="list">${childAbilityCards.join('')}</div>`:''}</div>
    <div class="card"><h2>Equipamentos equipados</h2><div class="list">${attackEquipment.map(i=>{const c=equipmentDefaults(i);const base=weaponDamageProfile(i.weapon_profile||'standard',false);const canTwo=i.weapon_profile==='standard'&&i.equip_slot==='main_hand'&&offHandFree;const temp=i.temporary_encounter_id?`<span class="pill warn">TEMPORÁRIO • ${i.temporary_turns_remaining??'?'} turno(s)</span>`:'';return `<div class="list-item"><div class="btn-row"><div class="title">${esc(i.name)}</div>${temp}</div><div class="meta">${base.paCost} PA • ${base.damageDiceCount}d${base.damageDie}${canTwo?' • 2 mãos: 1d10':''}</div><label style="margin-top:8px">Alvo<select data-equipment-target="${i.id}" ${isMyTurn?'':'disabled'}>${targetOpts}</select></label>${canTwo?`<label style="display:flex;align-items:center;gap:7px;margin-top:8px"><input type="checkbox" data-equipment-two-hands="${i.id}" style="width:auto" ${isMyTurn?'':'disabled'} /> Empunhar com duas mãos neste ataque • dano 1d10</label>`:''}${!c.usesCursedEnergy?`<label style="display:flex;align-items:center;gap:7px;margin-top:8px"><input type="checkbox" data-equipment-reinforce="${i.id}" style="width:auto" ${isMyTurn?'':'disabled'} /> Conduzir +1 EA neste golpe</label>`:''}<button class="btn" data-use-equipment="${i.id}" style="margin-top:8px" ${isMyTurn?'':'disabled'}>Atacar com equipamento</button></div>`}).join('')||'<p class="muted">Nenhuma arma equipada.</p>'}${effectEquipment.map(({item,effect,variant})=>equipmentEffectCardCombat({item,effect,variant,targets,actorId:state.character.id,actorName:myName,esc,enabled:isMyTurn,prefix:'equipment-effect'})).join('')}${passiveEquipment.map(({item,effect})=>`<div class="list-item"><div class="title">${esc(item.name)} • ${esc(effect.name)}</div><span class="pill good">Passivo equipado</span><div class="body" style="margin-top:6px">${esc(effect.mechanics||effect.description||'')}</div></div>`).join('')}</div></div></section>
    <div style="height:14px"></div><section class="card"><h2>Ações e reações</h2><div class="list">${actions.map(a=>actionCard(a,ctx)).join('')||'<p class="muted">Nenhuma ação ainda.</p>'}</div></section>`;

  root.querySelector('#basic-attack')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);await withBusy(()=>api.createCombatAttack({encounterId:active.id,attackerCharacterId:state.character.id,targetCharacterId:fd.get('target'),label:'Golpe corpo a corpo',sourceType:'basic',attackAttributeKey:'strength',attackSkillKey:'fight',paCost:1,eaCost:fd.get('cursed')==='on'?1:0,usesCursedEnergy:fd.get('cursed')==='on',damageDiceCount:1,damageDie:6,damageFlatAttributeKey:'strength',rollMode:fd.get('mode'),rollCount:Number(fd.get('count')||2)}),'Ataque realizado.');renderPlayerCombatPageV2(ctx);});

  root.querySelectorAll('[data-ability-use]').forEach(btn=>btn.onclick=async()=>{
    const abilityId=btn.dataset.abilityId; const modeKey=btn.dataset.modeKey||null;
    const a=[...approvedAbilities,...bundle.children.flatMap(x=>x.abilities)].find(x=>x.id===abilityId); if(!a)return;
    const cfg=mergedModeConfig(a,modeKey); const key=`${a.id}:${modeKey||'base'}`;
    const target=isSelfTarget(cfg)?state.character.id:root.querySelector(`[data-ability-target="${CSS.escape(key)}"]`)?.value;
    const overload=root.querySelector(`[data-overload="${CSS.escape(key)}"]`)?.value||null;
    const options={};
    if(cfg.special_action==='create_weapon') { options.weapon_profile=root.querySelector(`[data-weapon-profile="${CSS.escape(key)}"]`)?.value||'standard'; options.weapon_attribute=root.querySelector(`[data-weapon-attribute="${CSS.escape(key)}"]`)?.value||'strength'; }
    await withBusy(()=>api.useAbilityInCombat({encounterId:active.id,actorCharacterId:state.character.id,abilityId:a.id,targetCharacterId:target,modeKey,overloadKey:overload,options,label:a.name}),'Habilidade usada.');
    renderPlayerCombatPageV2(ctx);
  });
  root.querySelectorAll('[data-resource-recharge]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.useCombatResourceAction(active.id,state.character.id,btn.dataset.resourceRecharge,`Recarregar ${btn.dataset.resourceRecharge}`),'Recurso recarregado.');renderPlayerCombatPageV2(ctx);});
  root.querySelectorAll('[data-dismiss-summon]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.dismissCombatSummon(active.id,state.character.id,btn.dataset.summonName),'Invocação dispensada.');renderPlayerCombatPageV2(ctx);});
  root.querySelectorAll('[data-use-equipment]').forEach(btn=>btn.onclick=async()=>{const i=attackEquipment.find(x=>x.id===btn.dataset.useEquipment);const target=root.querySelector(`[data-equipment-target="${i.id}"]`)?.value;const reinforce=Boolean(root.querySelector(`[data-equipment-reinforce="${i.id}"]`)?.checked);const twoHanded=Boolean(root.querySelector(`[data-equipment-two-hands="${i.id}"]`)?.checked);await withBusy(()=>executeEquipment(i,state.character.id,active.id,target,reinforce,twoHanded),'Ataque realizado.');renderPlayerCombatPageV2(ctx);});
  root.querySelectorAll('[data-equipment-effect-use]').forEach(btn=>btn.onclick=async()=>{const item=usableEquipment.find(x=>x.id===btn.dataset.itemId);const effect=(item?.effects||[]).find(e=>String(e.id)===String(btn.dataset.effectId));if(!item||!effect)return;const modeKey=btn.dataset.modeKey||null;const cfg=effectVariants(effect).find(v=>(v.modeKey||null)===modeKey)?.config||effect.config||{};const key=`${item.id}:${effect.id}:${modeKey||'base'}`;const target=isSelfTarget(cfg)?state.character.id:root.querySelector(`[data-equipment-effect-target="${CSS.escape(key)}"]`)?.value;await withBusy(()=>api.useEquipmentEffectInCombat({encounterId:active.id,actorCharacterId:state.character.id,itemId:item.id,effectId:effect.id,targetCharacterId:target,modeKey,label:`${item.name}: ${effect.name}`}),'Efeito do equipamento usado.');renderPlayerCombatPageV2(ctx);});
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
      <section class="card"><h2>Novo combate</h2><form id="encounter-form" class="field-row"><label>Nome<input name="name" required /></label><button class="btn primary" style="align-self:end">Criar combate</button></form></section>`;
    root.querySelector('#undo-ended-combat')?.addEventListener('click',async()=>{if(!confirm(`Desfazer "${lastUndo.label}" e reabrir ${lastUndo.encounter_name}?`))return;const label=await withBusy(()=>api.undoLastCombatAction(lastUndo.encounter_id),'Combate restaurado.');toast(`Desfeito: ${label}`,'good');renderMasterCombatPageV2(ctx);});
    root.querySelector('#encounter-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.createEncounter(f.get('name')),'Combate criado.');renderMasterCombatPageV2(ctx);};
    return;
  }

  const active=state.activeEncounter;
  ctx.subscribeCombatRealtime?.(active.id,()=>renderMasterCombatPageV2(ctx));
  const [participants,targets,actions,lastUndo,effects]=await Promise.all([
    api.getCombatParticipants(active.id),api.getCombatTargets(active.id),api.getVisibleCombatActions(active.id),api.getLatestCombatUndo(active.id).catch(()=>null),api.getCombatEffects(active.id)
  ]);
  state.encounterParticipants=participants;
  const caMap=Object.fromEntries(targets.map(t=>[t.character_id,t.ca]));
  const inCombat=new Set(participants.map(p=>p.character_id));
  const activeParticipant=participants.find(p=>p.id===active.active_participant_id)||null;
  const actor=activeParticipant?.characters||null;
  const actorName=actor?getName(actor):'';
  state.combatActorId=actor?.id||null;

  const actorBundle=actor?await loadAbilityBundle(actor.id):{parentAbilities:[],children:[]};
  const actorEquipment=actor?await api.getEquipment(actor.id):[];
  const approvedAbilities=actorBundle.parentAbilities.filter(a=>a.status==='approved');
  const activeSummonId=activeParticipant?.active_summon_character_id||null;
  const actorAbilityCards=actor?[
    ...approvedAbilities.flatMap(a=>abilityVariants(a).map(variant=>abilityCardCombat({ability:a,variant,targets,actorId:actor.id,actorName,esc,enabled:true,prefix:'master-ability'}))),
    ...actorBundle.children.flatMap(({child,abilities})=>abilities.filter(a=>a.status==='approved').flatMap(a=>abilityVariants(a).map(variant=>abilityCardCombat({ability:a,variant,targets,actorId:actor.id,actorName,esc,enabled:true,locked:child.id!==activeSummonId,prefix:'master-ability',summonName:getName(child)}))))
  ]:[];

  const usableEquipment=actorEquipment.filter(i=>i.status==='approved'&&(i.equipped||i.category==='consumable'));
  const attackEquipment=usableEquipment.filter(i=>i.equipped&&equipmentDefaults(i).enabled);
  const effectEquipment=usableEquipment.flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>['active','reaction','attack'].includes(e.type)).flatMap(effect=>effectVariants(effect).map(variant=>({item:i,effect,variant}))));
  const passiveEquipment=actorEquipment.filter(i=>i.status==='approved'&&i.equipped).flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>e.type==='passive').map(effect=>({item:i,effect})));
  const offHandFree=!actorEquipment.some(i=>i.status==='approved'&&i.equipped&&i.equip_slot==='off_hand');
  const hostileTargetOpts=actor?targets.filter(t=>t.character_id!==actor.id&&!t.defeated).map(t=>`<option value="${t.character_id}">${esc(t.display_name)} • CA ${t.ca}</option>`).join(''):'';

  // O Mestre também enxerga habilidades de reação de todos os participantes, não só de quem está no turno.
  const reactionData=await Promise.all(participants.map(async p=>{
    const [bundle,equipment]=await Promise.all([loadAbilityBundle(p.character_id),api.getEquipment(p.character_id)]);
    const name=getName(p.characters);
    const activeChild=p.active_summon_character_id;
    const abilityEntries=[
      ...bundle.parentAbilities.filter(a=>a.status==='approved').flatMap(a=>abilityVariants(a).filter(v=>isReactionConfig(v.config)).map(variant=>({p,name,a,variant,locked:false}))),
      ...bundle.children.flatMap(({child,abilities})=>abilities.filter(a=>a.status==='approved').flatMap(a=>abilityVariants(a).filter(v=>isReactionConfig(v.config)).map(variant=>({p,name,a,variant,locked:child.id!==activeChild,summonName:getName(child)}))))
    ];
    const equipmentEntries=equipment.filter(i=>i.status==='approved'&&(i.equipped||i.category==='consumable')).flatMap(item=>(item.effects||[]).filter(e=>e.type==='reaction'||isReactionConfig(e.config||{})).flatMap(effect=>effectVariants(effect).filter(v=>effect.type==='reaction'||isReactionConfig(v.config)).map(variant=>({p,name,item,effect,variant}))));
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
    <section class="grid grid-2"><div class="card"><h2>Participantes</h2><div class="list">${participants.map(p=>participantCard(p,ctx,true,active.active_participant_id,caMap)).join('')||'<p class="muted">Vazio.</p>'}</div><h3>Adicionar</h3><div class="btn-row">${state.masterCharacters.filter(c=>!inCombat.has(c.id)).map(c=>`<button class="btn" data-add-combat="${c.id}">${esc(getName(c))}</button>`).join('')}</div></div>
    <div class="card"><h2>Ações do turno</h2>${actor?`<div class="list-item"><div class="title">${esc(actorName)}</div>${specialResourcesHtml(activeParticipant,esc,true,'master-resource')}<div style="margin-top:8px">${combatEffectsHtml(effects,actor.id,esc)}</div></div><form id="master-basic" class="grid" style="margin-top:10px"><h3>Golpe corpo a corpo</h3><label>Alvo<select name="target">${hostileTargetOpts}</select></label><label style="display:flex;align-items:center;gap:7px"><input name="cursed" type="checkbox" style="width:auto" /> Conduzir +1 EA</label><button class="btn bad">Atacar em segredo</button></form><hr style="border-color:#333"><form id="master-skill" class="grid"><h3>Teste secreto</h3><label>Perícia<select name="skill">${optionList(SKILLS)}</select></label>${modeFields('')}<button class="btn bad">Rolar em segredo</button></form>`:'<div class="notice">Nenhuma entidade pode realizar ação normal até você iniciar um turno.</div>'}</div></section>
    ${actor?`<div style="height:14px"></div><section class="grid grid-2"><div class="card"><h2>Habilidades de ${esc(actorName)}</h2><div class="list">${actorAbilityCards.join('')||'<p class="muted">Nenhuma habilidade aprovada.</p>'}</div>${actorBundle.children.length?`<div class="list" style="margin-top:10px">${actorBundle.children.map(({child})=>{const on=child.id===activeSummonId;return `<div class="list-item"><div class="btn-row"><div class="title">${esc(getName(child))}</div><span class="pill ${on?'good':'bad'}">${on?'ATIVA':'INATIVA'}</span>${on?`<button class="btn warn" data-master-dismiss-summon="${child.id}" data-summon-name="${esc(getName(child))}">Dispensar</button>`:''}</div></div>`}).join('')}</div>`:''}</div>
    <div class="card"><h2>Equipamentos de ${esc(actorName)}</h2><div class="list">${attackEquipment.map(i=>{const c=equipmentDefaults(i);const base=weaponDamageProfile(i.weapon_profile||'standard',false);const canTwo=i.weapon_profile==='standard'&&i.equip_slot==='main_hand'&&offHandFree;const temp=i.temporary_encounter_id?`<span class="pill warn">TEMPORÁRIO • ${i.temporary_turns_remaining??'?'} turno(s)</span>`:'';return `<div class="list-item"><div class="btn-row"><div class="title">${esc(i.name)}</div>${temp}</div><div class="meta">${base.paCost} PA • ${base.damageDiceCount}d${base.damageDie}</div><label>Alvo<select data-master-equipment-target="${i.id}">${hostileTargetOpts}</select></label>${canTwo?`<label><input type="checkbox" data-master-equipment-two-hands="${i.id}" style="width:auto" /> Duas mãos • 1d10</label>`:''}${!c.usesCursedEnergy?`<label><input type="checkbox" data-master-equipment-reinforce="${i.id}" style="width:auto" /> Conduzir +1 EA</label>`:''}<button class="btn bad" data-master-use-equipment="${i.id}">Atacar</button></div>`}).join('')||'<p class="muted">Nenhuma arma equipada.</p>'}${effectEquipment.filter(({effect,variant})=>!(effect.type==='reaction'||isReactionConfig(variant.config))).map(({item,effect,variant})=>equipmentEffectCardCombat({item,effect,variant,targets,actorId:actor.id,actorName,esc,enabled:true,prefix:'master-equipment-effect'})).join('')}${passiveEquipment.map(({item,effect})=>`<div class="list-item"><div class="title">${esc(item.name)} • ${esc(effect.name)}</div><span class="pill good">Passivo equipado</span><div class="body">${esc(effect.mechanics||effect.description||'')}</div></div>`).join('')}</div></div></section>`:''}
    <div style="height:14px"></div><section class="card"><h2>Reações próprias dos participantes</h2><div class="notice">Aqui o Mestre pode acionar habilidades e efeitos de equipamento marcados como reação mesmo que não seja o turno daquele personagem.</div><div class="grid grid-2" style="margin-top:10px">${reactionAbilities.map(({p,name,a,variant,locked,summonName})=>`<div><div class="eyebrow">${esc(name)}</div>${abilityCardCombat({ability:a,variant,targets,actorId:p.character_id,actorName:name,esc,enabled:false,locked,prefix:'master-reaction',summonName})}</div>`).join('')}${reactionEquipment.map(({p,name,item,effect,variant})=>`<div><div class="eyebrow">${esc(name)}</div>${equipmentEffectCardCombat({item,effect,variant,targets,actorId:p.character_id,actorName:name,esc,enabled:false,prefix:'master-reaction-equipment'})}</div>`).join('')||(!reactionAbilities.length?'<p class="muted">Nenhuma reação própria cadastrada.</p>':'')}</div></section>
    <div style="height:14px"></div><section class="card"><h2>Ações e reações</h2><div class="list">${actions.map(a=>actionCard(a,ctx)).join('')||'<p class="muted">Nenhuma ação.</p>'}</div></section>`;

  root.querySelector('#undo-combat')?.addEventListener('click',async()=>{if(!lastUndo)return;if(!confirm(`Desfazer a última ação do combate?\n\n${lastUndo.label}\n\nTudo que essa ação gastou ou causou será restaurado.`))return;const label=await withBusy(()=>api.undoLastCombatAction(active.id),'Ação desfeita.');toast(`Desfeito: ${label}`,'good');renderMasterCombatPageV2(ctx);});
  root.querySelector('#end-encounter')?.addEventListener('click',async()=>{if(!confirm('Encerrar este combate?'))return;await withBusy(()=>api.endEncounter(active.id),'Combate encerrado.');state.activeEncounter=null;state.combatActorId=null;renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-add-combat]').forEach(btn=>btn.onclick=async()=>{const c=state.masterCharacters.find(x=>x.id===btn.dataset.addCombat);await withBusy(()=>api.addCombatParticipant(active.id,c),'Participante adicionado.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-save-combat]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.saveCombat;await withBusy(()=>api.updateCombatParticipant(id,{current_ps:Number(root.querySelector(`[data-cps="${id}"]`).value),current_ea:Number(root.querySelector(`[data-cea="${id}"]`).value),current_pa:Number(root.querySelector(`[data-cpa="${id}"]`).value)},active.id),'Recursos atualizados.');renderMasterCombatPageV2(ctx);});
  root.querySelector('#master-basic')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.createCombatAttack({encounterId:active.id,attackerCharacterId:actor.id,targetCharacterId:f.get('target'),label:'Golpe corpo a corpo',sourceType:'basic',attackAttributeKey:'strength',attackSkillKey:'fight',paCost:1,eaCost:f.get('cursed')==='on'?1:0,usesCursedEnergy:f.get('cursed')==='on',damageDiceCount:1,damageDie:6,damageFlatAttributeKey:'strength'}),'Ataque secreto realizado.');renderMasterCombatPageV2(ctx);});
  root.querySelector('#master-skill')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const skill=SKILL_BY_KEY[f.get('skill')];const result=await withBusy(()=>api.rollGeneralTest({characterId:actor.id,label:skill.name,attributeKey:skill.attribute,skillKey:skill.key,mode:f.get('mode'),count:Number(f.get('count')||2),visibility:'master',encounterId:active.id}));toast(`Rolagem secreta: ${result.total}`,'good');renderMasterCombatPageV2(ctx);});

  const useMasterAbility=async(btn,entryPrefix,actorId)=>{const abilityId=btn.dataset.abilityId;const modeKey=btn.dataset.modeKey||null;const all=[...actorBundle.parentAbilities,...actorBundle.children.flatMap(x=>x.abilities),...reactionAbilities.map(x=>x.a)];const a=all.find(x=>x.id===abilityId);if(!a)return;const cfg=mergedModeConfig(a,modeKey);const key=`${a.id}:${modeKey||'base'}`;const actorCharacter=participants.find(p=>p.character_id===actorId)?.characters;const name=actorCharacter?getName(actorCharacter):'Entidade';const target=isSelfTarget(cfg)?actorId:root.querySelector(`[data-${entryPrefix}-target="${CSS.escape(key)}"]`)?.value;const overload=root.querySelector(`[data-overload="${CSS.escape(key)}"]`)?.value||null;const options={};if(cfg.special_action==='create_weapon'){options.weapon_profile=root.querySelector(`[data-weapon-profile="${CSS.escape(key)}"]`)?.value||'standard';options.weapon_attribute=root.querySelector(`[data-weapon-attribute="${CSS.escape(key)}"]`)?.value||'strength';}await withBusy(()=>api.useAbilityInCombat({encounterId:active.id,actorCharacterId:actorId,abilityId:a.id,targetCharacterId:target,modeKey,overloadKey:overload,options,label:a.name}),`${name}: habilidade usada.`);renderMasterCombatPageV2(ctx);};
  root.querySelectorAll('[data-master-ability-use]').forEach(btn=>btn.onclick=()=>useMasterAbility(btn,'master-ability',actor.id));
  root.querySelectorAll('[data-master-reaction-use]').forEach(btn=>{const entry=reactionAbilities.find(x=>x.a.id===btn.dataset.abilityId&&(x.variant.modeKey||'')===(btn.dataset.modeKey||''));btn.onclick=()=>useMasterAbility(btn,'master-reaction',entry.p.character_id);});
  root.querySelectorAll('[data-master-resource-recharge]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.useCombatResourceAction(active.id,actor.id,btn.dataset.masterResourceRecharge,`Recarregar ${btn.dataset.masterResourceRecharge}`),'Recurso recarregado.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-master-dismiss-summon]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.dismissCombatSummon(active.id,actor.id,btn.dataset.summonName),'Invocação dispensada.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-master-use-equipment]').forEach(btn=>btn.onclick=async()=>{const i=attackEquipment.find(x=>x.id===btn.dataset.masterUseEquipment);const target=root.querySelector(`[data-master-equipment-target="${i.id}"]`)?.value;const reinforce=Boolean(root.querySelector(`[data-master-equipment-reinforce="${i.id}"]`)?.checked);const twoHanded=Boolean(root.querySelector(`[data-master-equipment-two-hands="${i.id}"]`)?.checked);await withBusy(()=>executeEquipment(i,actor.id,active.id,target,reinforce,twoHanded),'Ataque realizado.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-master-equipment-effect-use]').forEach(btn=>btn.onclick=async()=>{const item=usableEquipment.find(x=>x.id===btn.dataset.itemId);const effect=(item?.effects||[]).find(e=>String(e.id)===String(btn.dataset.effectId));const modeKey=btn.dataset.modeKey||null;const cfg=effectVariants(effect).find(v=>(v.modeKey||null)===modeKey)?.config||{};const key=`${item.id}:${effect.id}:${modeKey||'base'}`;const target=isSelfTarget(cfg)?actor.id:root.querySelector(`[data-master-equipment-effect-target="${CSS.escape(key)}"]`)?.value;await withBusy(()=>api.useEquipmentEffectInCombat({encounterId:active.id,actorCharacterId:actor.id,itemId:item.id,effectId:effect.id,targetCharacterId:target,modeKey,label:`${item.name}: ${effect.name}`}),'Efeito usado.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-master-reaction-equipment-use]').forEach(btn=>btn.onclick=async()=>{const entry=reactionEquipment.find(x=>x.item.id===btn.dataset.itemId&&String(x.effect.id)===String(btn.dataset.effectId)&&(x.variant.modeKey||'')===(btn.dataset.modeKey||''));if(!entry)return;const {p,item,effect,variant}=entry;const key=`${item.id}:${effect.id}:${variant.modeKey||'base'}`;const target=isSelfTarget(variant.config)?p.character_id:root.querySelector(`[data-master-reaction-equipment-target="${CSS.escape(key)}"]`)?.value;await withBusy(()=>api.useEquipmentEffectInCombat({encounterId:active.id,actorCharacterId:p.character_id,itemId:item.id,effectId:effect.id,targetCharacterId:target,modeKey:variant.modeKey,label:`${item.name}: ${effect.name}`}),'Reação usada.');renderMasterCombatPageV2(ctx);});
  await bindCommonCombatButtons(root,ctx,active.id,()=>renderMasterCombatPageV2(ctx));
}
export function abilityCombatConfigFields() {
  return `<div class="combat-config-box"><h3>Execução em combate</h3><div class="field-row"><label style="display:flex;align-items:center;gap:7px"><input name="requiresAttack" type="checkbox" checked style="width:auto" /> Exige teste de ataque</label><label style="display:flex;align-items:center;gap:7px"><input name="isReaction" type="checkbox" style="width:auto" /> É uma reação e pode ser usada fora do turno quando o gatilho permitir</label></div><div class="field-row"><label>Atributo do ataque<select name="attackAttribute">${optionList(ATTRIBUTES,'cursed_control')}</select></label><label>Perícia do ataque<select name="attackSkill">${optionList(SKILLS,'technique_control')}</select></label></div><div class="field-row"><label>Atributo somado ao dano<select name="damageFlatAttribute"><option value="">Nenhum</option>${optionList(ATTRIBUTES,'cursed_control')}</select></label><label>Faixa de crítico<input name="criticalThreshold" type="number" min="2" max="20" value="20" /></label></div><div class="field-row"><label style="display:flex;align-items:center;gap:7px"><input name="usesCursedEnergy" type="checkbox" checked style="width:auto" /> Ataque conduz EA e pode gerar Kokusen em 20 natural</label><label style="display:flex;align-items:center;gap:7px"><input name="forcedCritical" type="checkbox" style="width:auto" /> Crítico forçado</label></div></div>`;
}

export function equipmentAttackConfigFields() {
  return `<div class="combat-config-box"><h3>Ataque do equipamento</h3><label style="display:flex;align-items:center;gap:7px"><input name="attackEnabled" type="checkbox" style="width:auto" /> Este item pode realizar ataque</label><div class="field-row"><label>Atributo<select name="attackAttribute">${optionList(ATTRIBUTES,'strength')}</select></label><label>Perícia<select name="attackSkill">${optionList(SKILLS,'fight')}</select></label></div><div class="field-row-3"><label>PA<input name="attackPa" type="number" min="0" max="7" value="1" /></label><label>EA<input name="attackEa" type="number" min="0" value="0" /></label><label>Dado<select name="attackDie">${[4,6,8,10,12,20].map(v=>`<option value="${v}" ${v===8?'selected':''}>d${v}</option>`).join('')}</select></label></div><div class="field-row"><label>Qtd. dados<input name="attackDiceCount" type="number" min="0" max="12" value="1" /></label><label>Atributo no dano<select name="damageFlatAttribute"><option value="">Nenhum</option>${optionList(ATTRIBUTES,'strength')}</select></label></div><label style="display:flex;align-items:center;gap:7px"><input name="usesCursedEnergy" type="checkbox" style="width:auto" /> Ataque conduz Energia Amaldiçoada</label></div>`;
}
