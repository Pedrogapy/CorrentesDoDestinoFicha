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

function participantCard(p, ctx, editable=false) {
  const { esc, state } = ctx;
  const c=p.characters; const d=characterDerived(c);
  const conditions=Array.isArray(p.conditions)?p.conditions:[];
  return `<div class="list-item combat-participant" data-participant="${p.id}">
    <div class="btn-row"><div class="title">${esc([c.first_name,c.last_name].filter(Boolean).join(' '))}</div><span class="pill">Iniciativa ${p.initiative}</span>${p.black_flash_turns>0?`<span class="pill bad">Fluxo Negro ${p.black_flash_turns}</span>`:''}${p.defeated?'<span class="pill bad">Derrotado</span>':''}</div>
    <div class="grid grid-4 compact-stats" style="margin-top:10px"><div><span class="muted small">PS</span><div><strong>${p.current_ps??d.ps}</strong> / ${d.ps}</div></div><div><span class="muted small">EA</span><div><strong>${p.current_ea??d.ea}</strong> / ${d.ea}</div></div><div><span class="muted small">PA</span><div><strong>${p.current_pa??d.pa}</strong> / ${d.pa}</div></div><div><span class="muted small">CA</span><div><strong>${d.ca}</strong></div></div></div>
    <div style="margin-top:9px">${conditionNames(conditions,state.conditions,esc)}</div>
    ${editable?`<div class="field-row-3" style="margin-top:10px"><label>PS<input data-cps="${p.id}" type="number" value="${p.current_ps??d.ps}" /></label><label>EA<input data-cea="${p.id}" type="number" value="${p.current_ea??d.ea}" /></label><label>PA<input data-cpa="${p.id}" type="number" value="${p.current_pa??d.pa}" /></label></div><div class="btn-row" style="margin-top:8px"><button class="btn" data-save-combat="${p.id}">Salvar recursos</button><button class="btn" data-roll-init="${p.id}">Rolar iniciativa</button><button class="btn good" data-start-turn="${p.id}">Iniciar turno</button><button class="btn warn" data-end-turn="${p.id}">Encerrar turno</button></div>`:`<div class="btn-row" style="margin-top:8px"><button class="btn" data-roll-init="${p.id}">Rolar iniciativa</button><button class="btn good" data-start-turn="${p.id}">Iniciar meu turno</button><button class="btn warn" data-end-turn="${p.id}">Encerrar meu turno</button></div>`}
    ${conditions.length?`<div class="btn-row" style="margin-top:8px">${conditions.map(k=>`<button class="btn ghost" data-remove-condition="${p.id}" data-condition="${esc(k)}">Remover ${esc(state.conditions.find(c=>c.key===k)?.name||k)}</button>`).join('')}</div>`:''}
  </div>`;
}

async function bindCommonCombatButtons(root, ctx, rerender) {
  const { toast, withBusy }=ctx;
  root.querySelectorAll('[data-defense]').forEach(btn=>btn.onclick=async()=>{
    const actionId=btn.dataset.action; const type=btn.dataset.defense;
    await withBusy(()=>api.resolveCombatDefense(actionId,type,'normal',1),type==='accept'?'Golpe resolvido.':'Reação resolvida.');
    rerender();
  });
  root.querySelectorAll('[data-counter]').forEach(btn=>btn.onclick=async()=>{
    const id=btn.dataset.counter; const useEA=Boolean(root.querySelector(`[data-counter-ea="${id}"]`)?.checked);
    await withBusy(()=>api.createBasicCounterattack(id,useEA),'Contra-ataque realizado.');rerender();
  });
  root.querySelectorAll('[data-roll-init]').forEach(btn=>btn.onclick=async()=>{const total=await withBusy(()=>api.rollCombatInitiative(btn.dataset.rollInit));toast(`Iniciativa: ${total}`,'good');rerender();});
  root.querySelectorAll('[data-start-turn]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.startCombatTurn(btn.dataset.startTurn),'Turno iniciado.');rerender();});
  root.querySelectorAll('[data-end-turn]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.endCombatTurn(btn.dataset.endTurn),'Turno encerrado.');rerender();});
  root.querySelectorAll('[data-remove-condition]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.removeCombatCondition(btn.dataset.removeCondition,btn.dataset.condition),'Condição removida.');rerender();});
}

async function executeAbility(ability, actorId, encounterId, targetId, ctx) {
  const c=sourceDefaults(ability);
  if (!targetId) throw new Error('Escolha um alvo.');
  if (c.requiresAttack) {
    return api.createCombatAttack({
      encounterId, attackerCharacterId:actorId, targetCharacterId:targetId, label:ability.name,
      sourceType:'ability', sourceId:ability.id, attackAttributeKey:c.attackAttributeKey, attackSkillKey:c.attackSkillKey,
      paCost:c.paCost, eaCost:c.eaCost, usesCursedEnergy:c.usesCursedEnergy, forcedCritical:c.forcedCritical,
      criticalThreshold:c.criticalThreshold, damageDiceCount:c.damageDiceCount, damageDie:c.damageDie,
      damageFlatAttributeKey:c.damageFlatAttributeKey, conditionKey:c.conditionKey,
    });
  }
  return api.useCombatEffect({
    encounterId, characterId:actorId, targetCharacterId:targetId, label:ability.name, sourceId:ability.id,
    paCost:c.paCost, eaCost:c.eaCost, damageDiceCount:c.damageDiceCount, damageDie:c.damageDie,
    damageFlatAttributeKey:c.damageFlatAttributeKey, conditionKey:c.conditionKey,
  });
}

async function executeEquipment(item, actorId, encounterId, targetId, reinforce=false, twoHanded=false) {
  const c=equipmentDefaults(item);
  if (!item?.equipped || item?.status!=='approved') throw new Error('O equipamento precisa estar aprovado e equipado.');
  if (!c.enabled) throw new Error('Este equipamento não possui ataque configurado.');
  if (twoHanded && (item.weapon_profile!=='standard' || item.equip_slot!=='main_hand')) throw new Error('Somente uma arma Padrão na Mão principal pode usar a empunhadura de duas mãos.');
  if (twoHanded) {
    const equipped=await api.getEquipment(actorId);
    if (equipped.some(other=>other.id!==item.id && other.status==='approved' && other.equipped && other.equip_slot==='off_hand')) {
      throw new Error('A Mão secundária precisa estar livre para empunhar esta arma com duas mãos.');
    }
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

async function executeEquipmentEffect(item, effect, actorId, encounterId, targetId) {
  if (item?.status!=='approved' || (!item?.equipped && item?.category!=='consumable')) throw new Error('O equipamento precisa estar aprovado e equipado. Consumíveis aprovados podem ser usados diretamente do inventário.');
  const c=equipmentEffectCombatDefaults(effect);
  const chargesCost=Math.max(0,Number(c.chargesCost||0));
  if (chargesCost>0 && item.charges_max!=null && Number(item.charges_current||0)<chargesCost) throw new Error('Cargas insuficientes.');
  let result;
  if (c.requiresAttack) {
    result=await api.createCombatAttack({
      encounterId, attackerCharacterId:actorId, targetCharacterId:targetId, label:`${item.name}: ${effect.name}`,
      sourceType:'equipment', sourceId:item.id, attackAttributeKey:c.attackAttributeKey, attackSkillKey:c.attackSkillKey,
      paCost:c.paCost, eaCost:c.eaCost, usesCursedEnergy:c.usesCursedEnergy, forcedCritical:false,
      criticalThreshold:20, damageDiceCount:c.damageDiceCount, damageDie:c.damageDie,
      damageFlatAttributeKey:c.damageFlatAttributeKey, conditionKey:c.conditionKey,
    });
  } else {
    result=await api.useCombatEffect({
      encounterId, characterId:actorId, targetCharacterId:targetId, label:`${item.name}: ${effect.name}`, sourceId:item.id,
      paCost:c.paCost, eaCost:c.eaCost, damageDiceCount:c.damageDiceCount, damageDie:c.damageDie,
      damageFlatAttributeKey:c.damageFlatAttributeKey, conditionKey:c.conditionKey,
    });
  }
  if (chargesCost>0) await api.spendEquipmentCharges(item.id,chargesCost);
  return result;
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
  const encounters=await api.getEncounters(); const active=encounters.find(e=>e.status==='active');
  if(!active){root.innerHTML=`${pageHeader('Sala de combate','Combate')}<div class="notice">Nenhum combate ativo.</div>`;return;}
  const [participants,targets,actions,abilities,equipment]=await Promise.all([
    api.getCombatParticipants(active.id),api.getCombatTargets(active.id),api.getVisibleCombatActions(active.id),api.getAbilities(state.character.id),api.getEquipment(state.character.id)
  ]);
  const mine=participants.find(p=>p.character_id===state.character.id);
  const targetOpts=targetOptions(targets,state.character.id);
  const approvedAbilities=abilities.filter(a=>a.status==='approved');
  const usableEquipment=equipment.filter(i=>i.status==='approved'&&(i.equipped||i.category==='consumable'));
  const attackEquipment=usableEquipment.filter(i=>i.equipped&&equipmentDefaults(i).enabled);
  const effectEquipment=usableEquipment.flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>['active','reaction','attack'].includes(e.type)).map(effect=>({item:i,effect})));
  const passiveEquipment=equipment.filter(i=>i.status==='approved'&&i.equipped).flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>e.type==='passive').map(effect=>({item:i,effect})));
  const offHandFree=!equipment.some(i=>i.status==='approved'&&i.equipped&&i.equip_slot==='off_hand');
  root.innerHTML=`${pageHeader(`Rodada ${active.round}`,'Combate')}
    <section class="grid grid-2"><div class="card"><h2>${esc(active.name)}</h2>${mine?participantCard(mine,ctx,false):'<p class="muted">Seu personagem ainda não foi adicionado.</p>'}</div>
    <div class="card"><h2>Golpe corpo a corpo</h2>${mine&&targetOpts?`<form id="basic-attack" class="grid"><label>Alvo<select name="target">${targetOpts}</select></label><label style="display:flex;align-items:center;gap:7px"><input name="cursed" type="checkbox" style="width:auto" /> Reforçar o golpe com Energia Amaldiçoada • +1 EA • permite Kokusen em 20 natural</label>${modeFields('')}<div class="notice">1 PA • Força + Lutar • dano 1d6 + Mod. Força</div><button class="btn primary">Atacar</button></form>`:'<p class="muted">É preciso estar no combate e possuir um alvo.</p>'}</div></section>
    <div style="height:14px"></div>
    <section class="grid grid-2"><div class="card"><h2>Habilidades aprovadas</h2><div class="list">${approvedAbilities.map(a=>{const c=sourceDefaults(a);return `<div class="list-item"><div class="title">${esc(a.name)}</div><div class="meta">${c.paCost} PA • ${c.eaCost} EA • ${c.requiresAttack?`${esc(ATTRIBUTE_BY_KEY[c.attackAttributeKey]?.name||c.attackAttributeKey)} + ${esc(SKILL_BY_KEY[c.attackSkillKey]?.name||c.attackSkillKey)}`:'efeito direto'}</div><div class="body">${esc(a.mechanics||a.description||'')}</div><label style="margin-top:8px">Alvo<select data-ability-target="${a.id}">${targetOpts}<option value="${state.character.id}">Eu mesmo</option></select></label><button class="btn primary" data-use-ability="${a.id}" style="margin-top:8px">Usar habilidade</button></div>`}).join('')||'<p class="muted">Nenhuma habilidade aprovada.</p>'}</div></div>
    <div class="card"><h2>Equipamentos equipados</h2><div class="list">${attackEquipment.map(i=>{const c=equipmentDefaults(i);const base=weaponDamageProfile(i.weapon_profile||'standard',false);const canTwo=i.weapon_profile==='standard'&&i.equip_slot==='main_hand'&&offHandFree;return `<div class="list-item"><div class="title">${esc(i.name)}</div><div class="meta">${base.paCost} PA • ${base.damageDiceCount}d${base.damageDie}${canTwo?' • 2 mãos: 1d10':''}</div><label style="margin-top:8px">Alvo<select data-equipment-target="${i.id}">${targetOpts}</select></label>${canTwo?`<label style="display:flex;align-items:center;gap:7px;margin-top:8px"><input type="checkbox" data-equipment-two-hands="${i.id}" style="width:auto" /> Empunhar com duas mãos neste ataque • dano 1d10</label>`:''}${!c.usesCursedEnergy?`<label style="display:flex;align-items:center;gap:7px;margin-top:8px"><input type="checkbox" data-equipment-reinforce="${i.id}" style="width:auto" /> Conduzir +1 EA neste golpe • permite Kokusen em 20 natural</label>`:''}<button class="btn" data-use-equipment="${i.id}" style="margin-top:8px">Atacar com equipamento</button></div>`}).join('')||'<p class="muted">Nenhuma arma equipada.</p>'}${effectEquipment.map(({item,effect})=>{const c=equipmentEffectCombatDefaults(effect);return `<div class="list-item"><div class="title">${esc(item.name)} • ${esc(effect.name)}</div><div class="meta">${c.paCost} PA • ${c.eaCost} EA${c.chargesCost?` • ${c.chargesCost} carga(s)`:''}</div><div class="body">${esc(effect.mechanics||effect.description||'')}</div><label style="margin-top:8px">Alvo<select data-equipment-effect-target="${esc(effect.id)}" data-item-id="${item.id}">${targetOpts}<option value="${state.character.id}">Eu mesmo</option></select></label><button class="btn primary" data-use-equipment-effect="${esc(effect.id)}" data-item-id="${item.id}" style="margin-top:8px">Usar efeito</button></div>`}).join('')}${passiveEquipment.map(({item,effect})=>`<div class="list-item"><div class="title">${esc(item.name)} • ${esc(effect.name)}</div><span class="pill good">Passivo equipado</span><div class="body" style="margin-top:6px">${esc(effect.mechanics||effect.description||'')}</div></div>`).join('')}</div></div></section>
    <div style="height:14px"></div><section class="card"><h2>Ações e reações</h2><div class="list">${actions.map(a=>actionCard(a,ctx)).join('')||'<p class="muted">Nenhuma ação ainda.</p>'}</div></section>`;
  if(mine) {
    const f=root.querySelector('#basic-attack'); if(f) f.onsubmit=async e=>{e.preventDefault();const fd=new FormData(f);await withBusy(()=>api.createCombatAttack({encounterId:active.id,attackerCharacterId:state.character.id,targetCharacterId:fd.get('target'),label:'Golpe corpo a corpo',sourceType:'basic',attackAttributeKey:'strength',attackSkillKey:'fight',paCost:1,eaCost:fd.get('cursed')==='on'?1:0,usesCursedEnergy:fd.get('cursed')==='on',damageDiceCount:1,damageDie:6,damageFlatAttributeKey:'strength',rollMode:fd.get('mode'),rollCount:Number(fd.get('count')||2)}),'Ataque realizado.');renderPlayerCombatPageV2(ctx);};
    root.querySelectorAll('[data-use-ability]').forEach(btn=>btn.onclick=async()=>{const a=approvedAbilities.find(x=>x.id===btn.dataset.useAbility);const target=root.querySelector(`[data-ability-target="${a.id}"]`).value;await withBusy(()=>executeAbility(a,state.character.id,active.id,target,ctx),'Habilidade usada.');renderPlayerCombatPageV2(ctx);});
    root.querySelectorAll('[data-use-equipment]').forEach(btn=>btn.onclick=async()=>{const i=attackEquipment.find(x=>x.id===btn.dataset.useEquipment);const target=root.querySelector(`[data-equipment-target="${i.id}"]`).value;const reinforce=Boolean(root.querySelector(`[data-equipment-reinforce="${i.id}"]`)?.checked);const twoHanded=Boolean(root.querySelector(`[data-equipment-two-hands="${i.id}"]`)?.checked);await withBusy(()=>executeEquipment(i,state.character.id,active.id,target,reinforce,twoHanded),'Ataque realizado.');renderPlayerCombatPageV2(ctx);});
    root.querySelectorAll('[data-use-equipment-effect]').forEach(btn=>btn.onclick=async()=>{const item=usableEquipment.find(x=>x.id===btn.dataset.itemId);const effect=(item.effects||[]).find(e=>String(e.id)===String(btn.dataset.useEquipmentEffect));const target=root.querySelector(`[data-equipment-effect-target="${btn.dataset.useEquipmentEffect}"][data-item-id="${item.id}"]`).value;await withBusy(()=>executeEquipmentEffect(item,effect,state.character.id,active.id,target),'Efeito do equipamento usado.');renderPlayerCombatPageV2(ctx);});
  }
  await bindCommonCombatButtons(root,ctx,()=>renderPlayerCombatPageV2(ctx));
}

export async function renderMasterCombatPageV2(ctx) {
  const { root, state, pageHeader, esc, getName, withBusy, toast }=ctx;
  const encounters=await api.getEncounters(); state.activeEncounter=encounters.find(e=>e.status==='active')||null; state.masterCharacters=await api.listAllCharacters();
  if(!state.activeEncounter){root.innerHTML=`${pageHeader('Controle secreto','Combate')}<section class="card"><h2>Novo combate</h2><form id="encounter-form" class="field-row"><label>Nome<input name="name" required /></label><button class="btn primary" style="align-self:end">Criar combate</button></form></section>`;root.querySelector('#encounter-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.createEncounter(f.get('name')),'Combate criado.');renderMasterCombatPageV2(ctx);};return;}
  const active=state.activeEncounter;
  const [participants,targets,actions]=await Promise.all([api.getCombatParticipants(active.id),api.getCombatTargets(active.id),api.getVisibleCombatActions(active.id)]);
  state.encounterParticipants=participants;
  const inCombat=new Set(participants.map(p=>p.character_id));
  state.combatActorId = participants.some(p=>p.character_id===state.combatActorId)?state.combatActorId:participants[0]?.character_id;
  const actorP=participants.find(p=>p.character_id===state.combatActorId); const actor=actorP?.characters;
  const [abilities,equipment]=actor?await Promise.all([api.getAbilities(actor.id),api.getEquipment(actor.id)]):[[],[]];
  const approvedAbilities=abilities.filter(a=>a.status==='approved'); const usableEquipment=equipment.filter(i=>i.status==='approved'&&(i.equipped||i.category==='consumable')); const attackEquipment=usableEquipment.filter(i=>i.equipped&&equipmentDefaults(i).enabled); const effectEquipment=usableEquipment.flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>['active','reaction','attack'].includes(e.type)).map(effect=>({item:i,effect}))); const passiveEquipment=equipment.filter(i=>i.status==='approved'&&i.equipped).flatMap(i=>(Array.isArray(i.effects)?i.effects:[]).filter(e=>e.type==='passive').map(effect=>({item:i,effect}))); const offHandFree=!equipment.some(i=>i.status==='approved'&&i.equipped&&i.equip_slot==='off_hand');
  const targetOpts=actor?targetOptions(targets,actor.id):'';
  root.innerHTML=`${pageHeader(`Rodada ${active.round}`,'Combate do Mestre','<span class="pill bad">Rolagens do Mestre ficam ocultas para jogadores</span>')}
    <section class="card combat-master-controls"><div class="btn-row"><div><strong>${esc(active.name)}</strong><div class="muted small">Combate ativo. Você pode encerrá-lo mesmo com uma reação pendente.</div></div><button class="btn bad" id="end-encounter">Encerrar combate</button></div></section>
    <div style="height:14px"></div>
    <section class="grid grid-2"><div class="card"><h2>Participantes</h2><div class="list">${participants.map(p=>participantCard(p,ctx,true)).join('')||'<p class="muted">Vazio.</p>'}</div><h3>Adicionar</h3><div class="btn-row">${state.masterCharacters.filter(c=>!inCombat.has(c.id)).map(c=>`<button class="btn" data-add-combat="${c.id}">${esc(getName(c))}</button>`).join('')}</div></div>
    <div class="card"><h2>Ações do Mestre</h2>${actor?`<label>Entidade ativa<select id="master-actor">${participants.map(p=>`<option value="${p.character_id}" ${p.character_id===actor.id?'selected':''}>${esc(getName(p.characters))}</option>`).join('')}</select></label><form id="master-basic" class="grid" style="margin-top:10px"><h3>Golpe corpo a corpo</h3><label>Alvo<select name="target">${targetOpts}</select></label><label style="display:flex;align-items:center;gap:7px"><input name="cursed" type="checkbox" style="width:auto" /> Reforçar com 1 EA</label><button class="btn bad">Atacar em segredo</button></form><hr style="border-color:#333"><form id="master-skill" class="grid"><h3>Teste secreto</h3><label>Perícia<select name="skill">${optionList(SKILLS)}</select></label>${modeFields('')}<button class="btn bad">Rolar em segredo</button></form>`:'<p class="muted">Adicione participantes.</p>'}</div></section>
    ${actor?`<div style="height:14px"></div><section class="grid grid-2"><div class="card"><h2>Habilidades de ${esc(getName(actor))}</h2><div class="list">${approvedAbilities.map(a=>{const c=sourceDefaults(a);return `<div class="list-item"><div class="title">${esc(a.name)}</div><div class="meta">${c.paCost} PA • ${c.eaCost} EA</div><label>Alvo<select data-master-ability-target="${a.id}">${targetOpts}<option value="${actor.id}">${esc(getName(actor))}</option></select></label><button class="btn bad" data-master-use-ability="${a.id}" style="margin-top:8px">Usar</button></div>`}).join('')||'<p class="muted">Nenhuma habilidade aprovada.</p>'}</div></div><div class="card"><h2>Equipamentos equipados</h2><div class="list">${attackEquipment.map(i=>{const c=equipmentDefaults(i);const base=weaponDamageProfile(i.weapon_profile||'standard',false);const canTwo=i.weapon_profile==='standard'&&i.equip_slot==='main_hand'&&offHandFree;return `<div class="list-item"><div class="title">${esc(i.name)}</div><div class="meta">${base.paCost} PA • ${base.damageDiceCount}d${base.damageDie}${canTwo?' • 2 mãos: 1d10':''}</div><label>Alvo<select data-master-equipment-target="${i.id}">${targetOpts}</select></label>${canTwo?`<label style="display:flex;align-items:center;gap:7px;margin-top:8px"><input type="checkbox" data-master-equipment-two-hands="${i.id}" style="width:auto" /> Empunhar com duas mãos neste ataque</label>`:''}${!c.usesCursedEnergy?`<label style="display:flex;align-items:center;gap:7px;margin-top:8px"><input type="checkbox" data-master-equipment-reinforce="${i.id}" style="width:auto" /> Conduzir +1 EA</label>`:''}<button class="btn bad" data-master-use-equipment="${i.id}" style="margin-top:8px">Atacar</button></div>`}).join('')||'<p class="muted">Nenhuma arma equipada.</p>'}${effectEquipment.map(({item,effect})=>{const c=equipmentEffectCombatDefaults(effect);return `<div class="list-item"><div class="title">${esc(item.name)} • ${esc(effect.name)}</div><div class="meta">${c.paCost} PA • ${c.eaCost} EA${c.chargesCost?` • ${c.chargesCost} carga(s)`:''}</div><label>Alvo<select data-master-equipment-effect-target="${esc(effect.id)}" data-item-id="${item.id}">${targetOpts}<option value="${actor.id}">${esc(getName(actor))}</option></select></label><button class="btn bad" data-master-use-equipment-effect="${esc(effect.id)}" data-item-id="${item.id}" style="margin-top:8px">Usar efeito</button></div>`}).join('')}${passiveEquipment.map(({item,effect})=>`<div class="list-item"><div class="title">${esc(item.name)} • ${esc(effect.name)}</div><span class="pill good">Passivo equipado</span><div class="body" style="margin-top:6px">${esc(effect.mechanics||effect.description||'')}</div></div>`).join('')}</div></div></section>`:''}
    <div style="height:14px"></div><section class="card"><h2>Ações e reações</h2><div class="list">${actions.map(a=>actionCard(a,ctx)).join('')||'<p class="muted">Nenhuma ação.</p>'}</div></section>`;
  root.querySelector('#end-encounter')?.addEventListener('click',async()=>{
    if(!confirm('Encerrar este combate? As fichas permanecem salvas e o histórico não será apagado.')) return;
    await withBusy(()=>api.endEncounter(active.id),'Combate encerrado.');
    state.activeEncounter=null;
    state.combatActorId=null;
    renderMasterCombatPageV2(ctx);
  });
  root.querySelectorAll('[data-add-combat]').forEach(btn=>btn.onclick=async()=>{const c=state.masterCharacters.find(x=>x.id===btn.dataset.addCombat);await withBusy(()=>api.addCombatParticipant(active.id,c),'Participante adicionado.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-save-combat]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.saveCombat;await withBusy(()=>api.updateCombatParticipant(id,{current_ps:Number(root.querySelector(`[data-cps="${id}"]`).value),current_ea:Number(root.querySelector(`[data-cea="${id}"]`).value),current_pa:Number(root.querySelector(`[data-cpa="${id}"]`).value)}),'Recursos atualizados.');renderMasterCombatPageV2(ctx);});
  root.querySelector('#master-actor')?.addEventListener('change',e=>{state.combatActorId=e.target.value;renderMasterCombatPageV2(ctx);});
  root.querySelector('#master-basic')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await withBusy(()=>api.createCombatAttack({encounterId:active.id,attackerCharacterId:actor.id,targetCharacterId:f.get('target'),label:'Golpe corpo a corpo',sourceType:'basic',attackAttributeKey:'strength',attackSkillKey:'fight',paCost:1,eaCost:f.get('cursed')==='on'?1:0,usesCursedEnergy:f.get('cursed')==='on',damageDiceCount:1,damageDie:6,damageFlatAttributeKey:'strength'}),'Ataque secreto realizado.');renderMasterCombatPageV2(ctx);});
  root.querySelector('#master-skill')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const skill=SKILL_BY_KEY[f.get('skill')];const result=await withBusy(()=>api.rollGeneralTest({characterId:actor.id,label:skill.name,attributeKey:skill.attribute,skillKey:skill.key,mode:f.get('mode'),count:Number(f.get('count')||2),visibility:'master',encounterId:active.id}));toast(`Rolagem secreta: ${result.total}`,'good');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-master-use-ability]').forEach(btn=>btn.onclick=async()=>{const a=approvedAbilities.find(x=>x.id===btn.dataset.masterUseAbility);const target=root.querySelector(`[data-master-ability-target="${a.id}"]`).value;await withBusy(()=>executeAbility(a,actor.id,active.id,target,ctx),'Habilidade usada.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-master-use-equipment]').forEach(btn=>btn.onclick=async()=>{const i=attackEquipment.find(x=>x.id===btn.dataset.masterUseEquipment);const target=root.querySelector(`[data-master-equipment-target="${i.id}"]`).value;const reinforce=Boolean(root.querySelector(`[data-master-equipment-reinforce="${i.id}"]`)?.checked);const twoHanded=Boolean(root.querySelector(`[data-master-equipment-two-hands="${i.id}"]`)?.checked);await withBusy(()=>executeEquipment(i,actor.id,active.id,target,reinforce,twoHanded),'Ataque realizado.');renderMasterCombatPageV2(ctx);});
  root.querySelectorAll('[data-master-use-equipment-effect]').forEach(btn=>btn.onclick=async()=>{const item=usableEquipment.find(x=>x.id===btn.dataset.itemId);const effect=(item.effects||[]).find(e=>String(e.id)===String(btn.dataset.masterUseEquipmentEffect));const target=root.querySelector(`[data-master-equipment-effect-target="${btn.dataset.masterUseEquipmentEffect}"][data-item-id="${item.id}"]`).value;await withBusy(()=>executeEquipmentEffect(item,effect,actor.id,active.id,target),'Efeito do equipamento usado.');renderMasterCombatPageV2(ctx);});
  await bindCommonCombatButtons(root,ctx,()=>renderMasterCombatPageV2(ctx));
}

export function abilityCombatConfigFields() {
  return `<div class="combat-config-box"><h3>Execução em combate</h3><label style="display:flex;align-items:center;gap:7px"><input name="requiresAttack" type="checkbox" checked style="width:auto" /> Exige teste de ataque</label><div class="field-row"><label>Atributo do ataque<select name="attackAttribute">${optionList(ATTRIBUTES,'cursed_control')}</select></label><label>Perícia do ataque<select name="attackSkill">${optionList(SKILLS,'technique_control')}</select></label></div><div class="field-row"><label>Atributo somado ao dano<select name="damageFlatAttribute"><option value="">Nenhum</option>${optionList(ATTRIBUTES,'cursed_control')}</select></label><label>Faixa de crítico<input name="criticalThreshold" type="number" min="2" max="20" value="20" /></label></div><div class="field-row"><label style="display:flex;align-items:center;gap:7px"><input name="usesCursedEnergy" type="checkbox" checked style="width:auto" /> Ataque conduz EA e pode gerar Kokusen em 20 natural</label><label style="display:flex;align-items:center;gap:7px"><input name="forcedCritical" type="checkbox" style="width:auto" /> Crítico forçado</label></div></div>`;
}

export function equipmentAttackConfigFields() {
  return `<div class="combat-config-box"><h3>Ataque do equipamento</h3><label style="display:flex;align-items:center;gap:7px"><input name="attackEnabled" type="checkbox" style="width:auto" /> Este item pode realizar ataque</label><div class="field-row"><label>Atributo<select name="attackAttribute">${optionList(ATTRIBUTES,'strength')}</select></label><label>Perícia<select name="attackSkill">${optionList(SKILLS,'fight')}</select></label></div><div class="field-row-3"><label>PA<input name="attackPa" type="number" min="0" max="7" value="1" /></label><label>EA<input name="attackEa" type="number" min="0" value="0" /></label><label>Dado<select name="attackDie">${[4,6,8,10,12,20].map(v=>`<option value="${v}" ${v===8?'selected':''}>d${v}</option>`).join('')}</select></label></div><div class="field-row"><label>Qtd. dados<input name="attackDiceCount" type="number" min="0" max="12" value="1" /></label><label>Atributo no dano<select name="damageFlatAttribute"><option value="">Nenhum</option>${optionList(ATTRIBUTES,'strength')}</select></label></div><label style="display:flex;align-items:center;gap:7px"><input name="usesCursedEnergy" type="checkbox" style="width:auto" /> Ataque conduz Energia Amaldiçoada</label></div>`;
}
