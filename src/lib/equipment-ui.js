import * as api from './api.js';
import {
  ATTRIBUTES,
  SKILLS,
  GRADE_OPTIONS,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_SLOTS,
  EQUIPMENT_WEAR_LOCATIONS,
  WEAPON_PROFILES,
  VP_OPTIONS,
  equipmentVpBudget,
  equipmentEffectsVp,
  equipmentCategoryName,
  equipmentSlotName,
  equipmentWearLocationName,
  equipmentAttunementCapacity,
  equipmentAttunementUsed,
  weaponAttackConfig,
  weaponDamageProfile,
  estimateAbilityVP,
} from './system.js';

function optionList(items, selected='') {
  return items.map(item => `<option value="${item.key}" ${item.key===selected?'selected':''}>${item.name}</option>`).join('');
}

function gradeOptions(selected='Sem Grau') {
  return GRADE_OPTIONS.map(g=>`<option ${g===selected?'selected':''}>${g}</option>`).join('');
}

function profileOptions(selected='standard') {
  return Object.entries(WEAPON_PROFILES).map(([key,p])=>`<option value="${key}" ${key===selected?'selected':''}>${p.name} • ${p.description}</option>`).join('');
}

function wearLocationOptions(selected='none') {
  return EQUIPMENT_WEAR_LOCATIONS.map(item=>`<option value="${item.key}" ${item.key===selected?'selected':''}>${item.name}</option>`).join('');
}

function effectTypeName(type) {
  return ({ passive:'Passivo', active:'Ativo', reaction:'Reação', attack:'Ataque especial' })[type] || type;
}

function statusPill(status) {
  const cls=status==='approved'?'good':status==='rejected'?'bad':'warn';
  const name=({approved:'Aprovado',rejected:'Rejeitado',pending:'Pendente'})[status]||status;
  return `<span class="pill ${cls}">${name}</span>`;
}

function wearSlotsFromLocation(location) {
  if (!location || location==='none') return [];
  if (location==='accessory') return EQUIPMENT_SLOTS.filter(s=>s.key==='accessory_1'||s.key==='accessory_2');
  return EQUIPMENT_SLOTS.filter(s=>s.key===location);
}

/**
 * Um acessório não precisa ocupar uma mão para funcionar: normalmente ele ocupa seu
 * slot corporal. Se a ficha do item permitir ser segurado, também pode ocupar uma das mãos.
 */
function allowedSlots(item) {
  if (item.category==='weapon') {
    if (['heavy','very_heavy'].includes(item.weapon_profile)) return EQUIPMENT_SLOTS.filter(s=>s.key==='main_hand');
    return EQUIPMENT_SLOTS.filter(s=>s.key==='main_hand'||s.key==='off_hand');
  }
  if (item.category==='consumable') return [];
  const slots=wearSlotsFromLocation(item.wear_slot);
  if (item.can_hold) slots.push(...EQUIPMENT_SLOTS.filter(s=>s.key==='main_hand'||s.key==='off_hand'));
  return Array.from(new Map(slots.map(s=>[s.key,s])).values());
}

function weaponSummary(item) {
  if (item.category!=='weapon') return '';
  const c=item.attack_config||{};
  const attr=ATTRIBUTES.find(a=>a.key===(c.attack_attribute_key||'strength'))?.name || c.attack_attribute_key;
  const skill=SKILLS.find(s=>s.key===(c.attack_skill_key||'fight'))?.name || c.attack_skill_key;
  const damageAttr=ATTRIBUTES.find(a=>a.key===(c.damage_flat_attribute_key||'strength'))?.name || c.damage_flat_attribute_key;
  const base=weaponDamageProfile(item.weapon_profile||'standard',false);
  const versatile=item.weapon_profile==='standard' ? ' • com 2 mãos: 1d10' : '';
  const handText=['heavy','very_heavy'].includes(item.weapon_profile)?'2 mãos':'1 mão';
  return `${base.damageDiceCount}d${base.damageDie} + Mod. ${damageAttr}${versatile} • ${base.paCost} PA • ${attr} + ${skill} • ${handText}`;
}

function effectSummary(effect, esc) {
  const c=effect.config||{};
  const parts=[];
  if (Number(c.pa_cost||0)>0) parts.push(`${c.pa_cost} PA`);
  if (Number(c.ea_cost||0)>0) parts.push(`${c.ea_cost} EA`);
  if (Number(c.damage_dice_count||0)>0 && Number(c.damage_die||0)>0) parts.push(`${c.damage_dice_count}d${c.damage_die}`);
  if (Number(c.charges_cost||0)>0) parts.push(`${c.charges_cost} carga(s)`);
  if (c.duration==='while_equipped') parts.push('enquanto equipado');
  return `<div class="list-item equipment-effect"><div class="btn-row"><div class="title">${esc(effect.name)}</div><span class="pill">${effectTypeName(effect.type)}</span><span class="pill">VP ${Number(effect.vp||0)}</span></div><div class="meta">${parts.join(' • ')||'Sem custo estruturado'}</div><div class="body">${esc(effect.description||'')}${effect.mechanics?`\n\n${esc(effect.mechanics)}`:''}</div></div>`;
}

function createFormHtml(master=false) {
  return `<form class="grid equipment-create-form">
    <div class="field-row"><label>Nome<input name="name" required /></label><label>Categoria<select name="category">${optionList(EQUIPMENT_CATEGORIES,'weapon')}</select></label></div>
    <div class="field-row"><label>Subtipo<input name="subtype" placeholder="Ex.: Katana, colar, uniforme" /></label><label style="display:flex;align-items:center;gap:7px"><input name="isCursed" type="checkbox" style="width:auto" /> Item amaldiçoado</label></div>
    <div class="field-row"><label>Grau<select name="grade">${gradeOptions('Grau 3')}</select></label><label>Imagem por URL<input name="imageUrl" placeholder="https://..." /></label></div>
    <label>Descrição<textarea name="description"></textarea></label>
    <label>Mecânica / observações<textarea name="mechanics" placeholder="Regras que ainda não possuem automação própria."></textarea></label>
    <div class="field-row"><label>Cargas máximas<input name="chargesMax" type="number" min="0" placeholder="Sem cargas" /></label>${master?'<label style="display:flex;align-items:center;gap:7px"><input name="override" type="checkbox" style="width:auto" /> Permitir ultrapassar VP do grau</label>':'<div></div>'}</div>

    <div class="combat-config-box equipment-wear-fields"><h3>Como o item fica ativo</h3>
      <div class="field-row"><label>Local corporal<select name="wearSlot">${wearLocationOptions('neck')}</select></label><label style="display:flex;align-items:center;gap:7px"><input name="canHold" type="checkbox" checked style="width:auto" /> Também pode funcionar sendo segurado em uma mão</label></div>
      <div class="notice">Um item vestível usa seu local corporal. Se puder ser segurado, ele também pode ocupar Mão principal ou Mão secundária. Itens amaldiçoados ativos consomem 1 Sintonia.</div>
    </div>

    <div class="combat-config-box equipment-weapon-fields"><h3>Perfil de arma</h3>
      <label>Perfil<select name="weaponProfile">${profileOptions('standard')}</select></label>
      <label>Alcance<select name="weaponRange"><option value="melee">Corpo a corpo</option><option value="ranged">À distância</option></select></label>
      <div class="field-row"><label>Atributo do ataque<select name="attackAttribute">${optionList(ATTRIBUTES,'strength')}</select></label><label>Perícia do ataque<select name="attackSkill">${optionList(SKILLS,'fight')}</select></label></div>
      <label>Atributo somado ao dano<select name="damageAttribute"><option value="">Nenhum</option>${optionList(ATTRIBUTES,'strength')}</select></label>
      <div class="notice equipment-profile-preview"></div>
    </div>
    <div class="notice">O ataque básico de uma arma não consome VP. Em armas amaldiçoadas, o VP do grau é reservado aos efeitos sobrenaturais.</div>
    <button class="btn primary">${master?'Criar equipamento aprovado':'Adicionar ao inventário'}</button>
  </form>`;
}

function effectFormHtml(item, master=false, conditions=[], esc=(v)=>String(v??'')) {
  if (!item.is_cursed) return '<div class="notice">Itens comuns não possuem efeitos sobrenaturais. Para adicionar poderes, o item precisa ser amaldiçoado.</div>';
  const durationOptions=`<option value="while_equipped">Enquanto equipado</option>${Object.entries(VP_OPTIONS.duration).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}`;
  return `<form class="grid equipment-effect-form" data-item-id="${item.id}">
    <div class="field-row"><label>Nome do efeito<input name="name" required /></label><label>Tipo<select name="effectType"><option value="passive">Passivo</option><option value="active">Ativo</option><option value="reaction">Reação</option><option value="attack">Ataque especial</option></select></label></div>
    <label>Descrição<textarea name="description"></textarea></label>
    <label>Mecânica<textarea name="mechanics"></textarea></label>
    <div class="field-row-3"><label>PA<input name="pa" type="number" min="0" max="7" value="0" /></label><label>EA<input name="ea" type="number" min="0" value="0" /></label><label>Cargas por uso<input name="chargesCost" type="number" min="0" value="0" /></label></div>
    <div class="field-row-3"><label>Dado de dano<select name="die"><option value="0">Sem dano</option>${[4,6,8,10,12,20].map(v=>`<option value="${v}">d${v}</option>`).join('')}</select></label><label>Quantidade<input name="diceCount" type="number" min="0" max="12" value="0" /></label><label>Condição<select name="conditionKey"><option value="">Nenhuma</option>${conditions.map(c=>`<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('')}</select></label></div>
    <div class="field-row-3"><label>Alcance<select name="range">${Object.entries(VP_OPTIONS.range).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label><label>Alvos<select name="targets">${Object.entries(VP_OPTIONS.targets).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label><label>Duração<select name="duration">${durationOptions}</select></label></div>
    <label>Severidade da condição<select name="conditionSeverity">${Object.entries(VP_OPTIONS.conditionSeverity).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label>
    <div class="combat-config-box"><h3>Execução do efeito</h3><label style="display:flex;align-items:center;gap:7px"><input name="requiresAttack" type="checkbox" style="width:auto" /> Exige teste de ataque</label><div class="field-row"><label>Atributo<select name="attackAttribute">${optionList(ATTRIBUTES,'cursed_control')}</select></label><label>Perícia<select name="attackSkill">${optionList(SKILLS,'technique_control')}</select></label></div><label>Atributo no dano<select name="damageAttribute"><option value="">Nenhum</option>${optionList(ATTRIBUTES,'cursed_control')}</select></label><label style="display:flex;align-items:center;gap:7px"><input name="usesCursedEnergy" type="checkbox" style="width:auto" /> Conduz Energia Amaldiçoada</label></div>
    <div class="field-row"><label><input name="onceCombat" type="checkbox" style="width:auto" /> 1 vez por combate</label><label><input name="onceMission" type="checkbox" style="width:auto" /> 1 vez por missão</label></div>
    <div class="field-row"><label><input name="preparation" type="checkbox" style="width:auto" /> Exige preparação</label><label><input name="drawback" type="checkbox" style="width:auto" /> Desvantagem relevante</label></div>
    <div class="field-row"><div class="notice equipment-effect-vp">VP estimado: 1</div>${master?'<label>VP final<input name="vpFinal" type="number" min="0" value="1" /></label>':'<div></div>'}</div>
    <button class="btn">Adicionar efeito</button>
  </form>`;
}

function readEffectConfig(form) {
  const f=new FormData(form);
  return {
    pa_cost:Number(f.get('pa')||0),
    ea_cost:Number(f.get('ea')||0),
    damage_die:Number(f.get('die')||0),
    damage_dice_count:Number(f.get('diceCount')||0),
    range:f.get('range'),
    targets:f.get('targets'),
    duration:f.get('duration'),
    condition_severity:f.get('conditionSeverity'),
    condition_key:f.get('conditionKey')||null,
    requires_attack:f.get('requiresAttack')==='on',
    attack_attribute_key:f.get('attackAttribute'),
    attack_skill_key:f.get('attackSkill'),
    damage_flat_attribute_key:f.get('damageAttribute')||null,
    uses_cursed_energy:f.get('usesCursedEnergy')==='on',
    forced_critical:false,
    critical_threshold:20,
    once_per_combat:f.get('onceCombat')==='on',
    once_per_mission:f.get('onceMission')==='on',
    requires_preparation:f.get('preparation')==='on',
    meaningful_drawback:f.get('drawback')==='on',
    charges_cost:Number(f.get('chargesCost')||0),
  };
}

function itemCardHtml(item, master, esc, conditions=[], characterLevel=1) {
  const effects=Array.isArray(item.effects)?item.effects:[];
  const used=equipmentEffectsVp(effects);
  const budget=equipmentVpBudget(item.grade,item.is_cursed);
  const slots=allowedSlots(item);
  const canEquip=item.status==='approved' && slots.length>0;
  const image=item.image_url?`<img class="equipment-thumb" src="${esc(item.image_url)}" alt="${esc(item.name)}" />`:'';
  const attunement=item.equipped&&item.is_cursed&&item.category!=='consumable'?'<span class="pill warn">Sintonia 1</span>':'';
  const temporary=item.temporary_encounter_id?`<span class="pill warn">TEMPORÁRIO • ${item.temporary_turns_remaining??'?'} turno(s)</span>`:'';
  return `<div class="list-item equipment-card" data-equipment-card="${item.id}">
    <div class="equipment-card-head">${image}<div><div class="btn-row"><div class="title">${esc(item.name)}</div>${statusPill(item.status)}${item.is_cursed?`<span class="pill bad">${esc(item.grade)}</span>`:'<span class="pill">Comum</span>'}${item.equipped?`<span class="pill good">${esc(equipmentSlotName(item.equip_slot))}</span>`:''}${attunement}${temporary}</div><div class="meta">${esc(equipmentCategoryName(item.category))}${item.subtype?` • ${esc(item.subtype)}`:''}${item.is_cursed?` • VP ${used}/${budget}${item.vp_limit_override?' + exceção do Mestre':''}`:''}${item.wear_slot&&item.wear_slot!=='none'?` • veste: ${esc(equipmentWearLocationName(item.wear_slot))}`:''}${item.can_hold?' • pode ser segurado':''}</div></div></div>
    ${item.category==='weapon'?`<div class="notice" style="margin-top:8px"><strong>Ataque básico:</strong> ${esc(weaponSummary(item))}. Armas Padrão em Mão principal podem usar duas mãos no ataque se a Mão secundária estiver livre.</div>`:''}
    <div class="body" style="margin-top:8px">${esc(item.description||'')}${item.mechanics?`\n\n${esc(item.mechanics)}`:''}</div>
    ${item.charges_max!=null?`<div class="meta" style="margin-top:8px">Cargas: <strong>${item.charges_current ?? item.charges_max}/${item.charges_max}</strong></div>`:''}
    ${item.master_response?`<div class="notice ${item.status==='rejected'?'bad':''}" style="margin-top:8px">Mestre: ${esc(item.master_response)}</div>`:''}
    <div class="btn-row" style="margin-top:10px">${item.equipped?`<button class="btn warn" data-unequip="${item.id}">Desequipar</button>`:canEquip?slots.map(s=>`<button class="btn" data-equip="${item.id}" data-slot="${s.key}">Equipar: ${s.name}</button>`).join(''):''}${master&&item.charges_max!=null?`<button class="btn" data-refill="${item.id}">Restaurar cargas</button>`:''}<button class="btn bad" data-delete-equipment="${item.id}">Excluir equipamento</button></div>
    <details class="equipment-details" style="margin-top:10px"><summary>Efeitos e edição</summary><div class="list" style="margin-top:8px">${effects.length?effects.map(e=>`${effectSummary(e,esc)}<button class="btn bad small" data-remove-effect="${item.id}" data-effect-id="${esc(e.id)}">Remover efeito</button>`).join(''):'<p class="muted">Nenhum efeito sobrenatural.</p>'}</div>${effectFormHtml(item,master,conditions,esc)}</details>
  </div>`;
}

function bindCreateForm(root, character, master, ctx, rerender) {
  const { withBusy, toast }=ctx;
  const form=root.querySelector('.equipment-create-form');
  if(!form) return;
  const category=form.elements.category;
  const cursed=form.elements.isCursed;
  const grade=form.elements.grade;
  const weaponBox=form.querySelector('.equipment-weapon-fields');
  const wearBox=form.querySelector('.equipment-wear-fields');
  const preview=form.querySelector('.equipment-profile-preview');
  let previousCategory=category.value;
  const applyCategoryDefaults=()=>{
    const cat=category.value;
    if(cat===previousCategory) return;
    previousCategory=cat;
    if(cat==='accessory') { form.elements.wearSlot.value='neck'; form.elements.canHold.checked=true; }
    else if(cat==='armor') { form.elements.wearSlot.value='body'; form.elements.canHold.checked=false; }
    else if(cat==='other') { form.elements.wearSlot.value='accessory'; form.elements.canHold.checked=false; }
  };
  const refresh=()=>{
    applyCategoryDefaults();
    const cat=category.value;
    weaponBox.style.display=cat==='weapon'?'grid':'none';
    wearBox.style.display=['accessory','armor','other'].includes(cat)?'grid':'none';
    grade.disabled=!cursed.checked;
    if(!cursed.checked) grade.value='Sem Grau';
    else if(grade.value==='Sem Grau') grade.value='Grau 3';
    const p=WEAPON_PROFILES[form.elements.weaponProfile.value]||WEAPON_PROFILES.standard;
    preview.textContent=`${p.name}: ${p.description} O perfil físico define o dano e não consome VP.`;
    if(form.elements.weaponRange.value==='ranged' && form.elements.attackSkill.value==='fight') form.elements.attackSkill.value='aim';
  };
  form.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',refresh));
  refresh();
  form.onsubmit=async e=>{
    e.preventDefault(); const f=new FormData(form);
    const isCursed=f.get('isCursed')==='on'; const cat=f.get('category');
    const profile=f.get('weaponProfile')||'standard';
    const chargesMax=f.get('chargesMax')===''?null:Number(f.get('chargesMax'));
    const attackConfig=cat==='weapon'?weaponAttackConfig({profile,attackAttributeKey:f.get('attackAttribute'),attackSkillKey:f.get('attackSkill'),damageAttributeKey:f.get('damageAttribute')||null,range:f.get('weaponRange')}):{enabled:false};
    const wearSlot=['accessory','armor','other'].includes(cat)?String(f.get('wearSlot')||'none'):'none';
    const canHold=['accessory','armor','other'].includes(cat) && f.get('canHold')==='on';
    const hands=profile==='heavy'||profile==='very_heavy'?2:(cat==='weapon'?1:0);
    const payload={
      character_id:character.id,
      name:String(f.get('name')).trim(),
      equipment_type:equipmentCategoryName(cat),
      category:cat,
      subtype:String(f.get('subtype')||'').trim(),
      is_cursed:isCursed,
      grade:isCursed?f.get('grade'):'Sem Grau',
      description:f.get('description')||'',
      mechanics:f.get('mechanics')||'',
      image_url:f.get('imageUrl')||'',
      charges_max:chargesMax,
      charges_current:chargesMax,
      hands,
      wear_slot:wearSlot,
      can_hold:canHold,
      weapon_profile:cat==='weapon'?profile:null,
      weapon_range:cat==='weapon'?f.get('weaponRange'):'melee',
      attack_config:attackConfig,
      effects:[],
      vp_limit_override:master && f.get('override')==='on',
      status:master?'approved':(isCursed?'pending':'approved'),
    };
    await withBusy(()=>api.addEquipment(payload),master?'Equipamento criado.':(isCursed?'Ferramenta enviada para aprovação.':'Item adicionado.'));
    toast(isCursed&&!master?'O item amaldiçoado só poderá ser equipado depois da aprovação do Mestre.':'Equipamento salvo.','good');
    await rerender();
  };
}

function bindItemActions(root, items, master, ctx, rerender) {
  const { withBusy, toast }=ctx;
  root.querySelectorAll('[data-equip]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.equipEquipment(btn.dataset.equip,btn.dataset.slot),'Equipamento equipado.');await rerender();});
  root.querySelectorAll('[data-unequip]').forEach(btn=>btn.onclick=async()=>{await withBusy(()=>api.unequipEquipment(btn.dataset.unequip),'Equipamento desequipado.');await rerender();});
  root.querySelectorAll('[data-refill]').forEach(btn=>btn.onclick=async()=>{const item=items.find(i=>i.id===btn.dataset.refill);if(!item)return;await withBusy(()=>api.updateEquipment(item.id,{charges_current:item.charges_max}),'Cargas restauradas.');await rerender();});
  root.querySelectorAll('[data-delete-equipment]').forEach(btn=>btn.onclick=async()=>{
    const item=items.find(i=>i.id===btn.dataset.deleteEquipment); if(!item)return;
    if(!confirm(`Excluir permanentemente "${item.name}"? Esta ação remove o item da ficha e não pode ser desfeita pela interface.`)) return;
    await withBusy(()=>api.deleteEquipment(item.id),'Equipamento excluído.');
    await rerender();
  });

  root.querySelectorAll('.equipment-effect-form').forEach(form=>{
    const item=items.find(i=>i.id===form.dataset.itemId); if(!item)return;
    const vpBox=form.querySelector('.equipment-effect-vp'); const vpFinal=form.elements.vpFinal;
    const refreshVp=()=>{const vp=estimateAbilityVP(readEffectConfig(form));vpBox.textContent=`VP estimado: ${vp}`;if(vpFinal&&!vpFinal.dataset.touched)vpFinal.value=vp;};
    const applyTypeDefaults=()=>{
      const type=form.elements.effectType.value;
      if(type==='passive'){
        form.elements.pa.value=0;
        form.elements.ea.value=0;
        form.elements.requiresAttack.checked=false;
        form.elements.usesCursedEnergy.checked=false;
        form.elements.duration.value='while_equipped';
        form.elements.range.value='self';
        form.elements.targets.value='self';
      } else if(type==='attack') {
        if(Number(form.elements.pa.value||0)===0) form.elements.pa.value=1;
        form.elements.requiresAttack.checked=true;
        if(form.elements.duration.value==='while_equipped') form.elements.duration.value='instant';
      } else if(form.elements.duration.value==='while_equipped') {
        form.elements.duration.value='instant';
      }
      refreshVp();
    };
    form.elements.effectType.addEventListener('change',applyTypeDefaults);
    form.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',()=>{if(el.name==='vpFinal')el.dataset.touched='1';refreshVp();})); applyTypeDefaults();
    form.onsubmit=async e=>{
      e.preventDefault(); const f=new FormData(form); const config=readEffectConfig(form); const estimated=estimateAbilityVP(config); const vp=master?Math.max(0,Number(f.get('vpFinal')??estimated)):estimated;
      const effect={id:crypto.randomUUID(),name:String(f.get('name')).trim(),type:f.get('effectType'),description:f.get('description')||'',mechanics:f.get('mechanics')||'',vp,config};
      const effects=[...(Array.isArray(item.effects)?item.effects:[]),effect]; const used=equipmentEffectsVp(effects); const budget=equipmentVpBudget(item.grade,item.is_cursed);
      if(used>budget && !(master&&item.vp_limit_override)) { toast(`O item ultrapassaria o orçamento: ${used}/${budget} VP.`,'bad'); return; }
      await withBusy(()=>api.updateEquipment(item.id,{effects,status:master?'approved':'pending'}),'Efeito adicionado.');
      await rerender();
    };
  });
  root.querySelectorAll('[data-remove-effect]').forEach(btn=>btn.onclick=async()=>{
    const item=items.find(i=>i.id===btn.dataset.removeEffect); if(!item)return;
    const effects=(Array.isArray(item.effects)?item.effects:[]).filter(e=>String(e.id)!==String(btn.dataset.effectId));
    await withBusy(()=>api.updateEquipment(item.id,{effects,status:master?'approved':'pending'}),'Efeito removido.'); await rerender();
  });
}

function rulesHtml(character, items) {
  const cap=equipmentAttunementCapacity(character.level);
  const used=equipmentAttunementUsed(items);
  return `<h3>Sintonia ${used}/${cap}</h3>
    <p><strong>Mãos:</strong> Mão principal e Mão secundária são slots físicos, não dão bônus ou penalidade.</p>
    <p><strong>Arma Padrão:</strong> 1d8 com uma mão. Se estiver na Mão principal e a secundária estiver livre, pode usar duas mãos naquele ataque para causar 1d10.</p>
    <p><strong>Itens de corpo:</strong> Cabeça, Pescoço, Corpo, Braços/Pulsos, Cintura, Pés e dois slots genéricos de Acessório.</p>
    <p><strong>Amuletos:</strong> não precisam ficar na mão. Se forem vestíveis, funcionam no slot corporal. Se o item permitir ser segurado, também pode ocupar uma mão e funcionar normalmente.</p>
    <p><strong>Sintonia:</strong> cada item amaldiçoado aprovado e equipado consome 1 Sintonia. Itens comuns e consumíveis não consomem Sintonia.</p>`;
}

export async function renderPlayerEquipmentPage(ctx) {
  const { root, state, pageHeader, esc }=ctx;
  const items=await api.getEquipment(state.character.id);
  root.innerHTML=`${pageHeader('Armas, amuletos e ferramentas','Inventário')}
    <div class="notice">Ferramentas amaldiçoadas criadas pelo jogador ficam pendentes até o Mestre aprovar seus efeitos e grau. Equipar define quais itens estão realmente ativos.</div>
    <div style="height:14px"></div><section class="grid grid-2"><div class="card"><h2>Novo equipamento</h2>${createFormHtml(false)}</div><div class="card"><h2>Regras rápidas</h2>${rulesHtml(state.character,items)}</div></section>
    <div style="height:14px"></div><section class="card"><h2>Meus equipamentos</h2><div class="list">${items.length?items.map(i=>itemCardHtml(i,false,esc,state.conditions,state.character.level)).join(''):'<p class="muted">Nenhum equipamento.</p>'}</div></section>`;
  const rerender=()=>renderPlayerEquipmentPage(ctx);
  bindCreateForm(root,state.character,false,ctx,rerender); bindItemActions(root,items,false,ctx,rerender);
}

export async function renderMasterEquipmentManager(root, character, ctx, rerender) {
  const { esc, state }=ctx; const items=await api.getEquipment(character.id);
  root.innerHTML=`<div class="master-zone"><h2>Equipamentos da entidade</h2><div class="grid grid-2"><div class="card"><h3>Novo equipamento</h3>${createFormHtml(true)}</div><div class="card"><h3>Regras</h3>${rulesHtml(character,items)}<p class="muted">Equipamentos criados pelo Mestre já nascem aprovados. Efeitos sobrenaturais continuam limitados pelo VP do grau.</p></div></div><div style="height:10px"></div><div class="list">${items.length?items.map(i=>itemCardHtml(i,true,esc,state.conditions,character.level)).join(''):'<p class="muted">Nenhum equipamento.</p>'}</div></div>`;
  bindCreateForm(root,character,true,ctx,rerender); bindItemActions(root,items,true,ctx,rerender);
}

export function pendingEquipmentQueueHtml(items, esc, getName) {
  if(!items.length) return '<p class="muted">Nada pendente.</p>';
  return items.map(item=>{
    const used=equipmentEffectsVp(item.effects); const budget=equipmentVpBudget(item.grade,item.is_cursed);
    return `<div class="list-item"><div class="btn-row"><div class="title">${esc(item.name)}</div><span class="pill warn">Pendente</span><span class="pill">VP ${used}/${budget}</span></div><div class="meta">${esc(getName(item.characters))} • ${esc(equipmentCategoryName(item.category))} • ${esc(item.grade)}</div><div class="body">${esc(item.description||'')}${item.mechanics?`\n\n${esc(item.mechanics)}`:''}</div><label style="margin-top:8px">Resposta<input data-equipment-response="${item.id}" /></label><div class="btn-row" style="margin-top:8px"><button class="btn good" data-approve-equipment="${item.id}">Aprovar</button><button class="btn bad" data-reject-equipment="${item.id}">Rejeitar</button></div></div>`;
  }).join('');
}

export function bindPendingEquipmentQueue(root, items, ctx, rerender) {
  const { withBusy }=ctx;
  root.querySelectorAll('[data-approve-equipment]').forEach(btn=>btn.onclick=async()=>{const response=root.querySelector(`[data-equipment-response="${btn.dataset.approveEquipment}"]`)?.value||'';await withBusy(()=>api.setEquipmentStatus(btn.dataset.approveEquipment,'approved',response),'Equipamento aprovado.');await rerender();});
  root.querySelectorAll('[data-reject-equipment]').forEach(btn=>btn.onclick=async()=>{const response=root.querySelector(`[data-equipment-response="${btn.dataset.rejectEquipment}"]`)?.value||'';await withBusy(()=>api.setEquipmentStatus(btn.dataset.rejectEquipment,'rejected',response),'Equipamento rejeitado.');await rerender();});
}

export function equipmentEffectCombatDefaults(effect) {
  const c=effect?.config||{};
  return {
    requiresAttack: Boolean(c.requires_attack),
    attackAttributeKey:c.attack_attribute_key||'cursed_control',
    attackSkillKey:c.attack_skill_key||'technique_control',
    paCost:Number(c.pa_cost||0), eaCost:Number(c.ea_cost||0),
    usesCursedEnergy:Boolean(c.uses_cursed_energy),
    damageDiceCount:Number(c.damage_dice_count||0), damageDie:Number(c.damage_die||0),
    damageFlatAttributeKey:c.damage_flat_attribute_key||null,
    conditionKey:c.condition_key||null,
    chargesCost:Number(c.charges_cost||0),
  };
}
