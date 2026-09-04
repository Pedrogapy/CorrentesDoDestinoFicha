function statusText(status='') {
  return ({
    pending_defense:'Aguardando reação', miss:'Não acertou', defended:'Defendido',
    resolved:'Resolvido', cancelled:'Cancelado',
  })[status] || 'Em andamento';
}

function rollText(action={}) {
  if (action.attack_total == null) return '';
  const nat=action.attack_natural==null?'—':action.attack_natural;
  const bonus=Number(action.attack_bonus||0);
  return `d20 ${nat} ${bonus>=0?'+':'−'} ${Math.abs(bonus)} = ${action.attack_total}`;
}

function latestActionHtml(action, {master=false,esc=(v)=>String(v)}={}) {
  if(!action) return '<div class="combat-live-empty">Nenhuma ação foi registrada ainda.</div>';
  const status=statusText(action.status);
  const pending=action.status==='pending_defense';
  const ca=master && action.target_ca!=null ? `<span>CA ${esc(action.target_ca)}</span>` : '';
  const damage=action.status==='resolved' && action.damage_total!=null
    ? `<div class="combat-live-result"><strong>Dano:</strong> ${esc(action.damage_total)}</div>` : '';
  const defense=action.defense_type && action.defense_type!=='accept'
    ? `<div class="combat-live-sub">Defesa: ${esc(action.defense_type)}${action.defense_total!=null?` • ${esc(action.defense_total)}`:''}</div>` : '';
  const summary=action.summary?`<div class="combat-live-summary">${esc(action.summary)}</div>`:'';
  return `<div class="combat-live-current ${pending?'is-pending':''}">
    <div class="combat-live-eyebrow">ÚLTIMA AÇÃO</div>
    <div class="combat-live-title">${esc(action.attacker_name||'Entidade')} → ${esc(action.target_name||'Alvo')}</div>
    <div class="combat-live-label">${esc(action.label||'Ação')}</div>
    ${action.attack_total!=null?`<div class="combat-live-roll"><span>${esc(rollText(action))}</span>${ca}</div>`:''}
    <div class="combat-live-status">${esc(status)}</div>${damage}${defense}${summary}
  </div>`;
}

export function combatLivePanelHtml({actions=[],effects=[],activeName='',master=false,esc=(v)=>String(v),reactionsEnabled=true}={}) {
  const ordered=[...(actions||[])].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
  const latest=ordered[0]||null;
  const recent=ordered.slice(1,6);
  const masterEffects=master ? (effects||[]).slice(0,10) : [];
  const open = globalThis?.localStorage?.getItem('correntes-combat-live-open') !== '0';
  return `<button type="button" class="combat-live-fab" data-combat-live-toggle aria-expanded="${open?'true':'false'}">⚔ Agora</button>
  <aside class="combat-live-panel ${open?'is-open':''}" data-combat-live-panel aria-hidden="${open?'false':'true'}">
    <div class="combat-live-head"><div><div class="combat-live-eyebrow">AGORA NO COMBATE</div><strong>${esc(activeName||'Aguardando o Mestre')}</strong></div><button class="btn ghost" type="button" data-combat-live-close>Ocultar</button></div>
    <div class="combat-live-reaction ${reactionsEnabled?'allowed':'blocked'}">Reações: <strong>${reactionsEnabled?'liberadas':'bloqueadas pelo Mestre'}</strong></div>
    <section class="combat-live-available">
      <div class="combat-live-eyebrow">DISPONÍVEL AGORA</div>
      <div class="combat-live-available-title" data-combat-live-action-title>Aguardando contexto...</div>
      <div class="combat-live-actions" data-combat-live-actions><span class="muted small">Carregando opções...</span></div>
    </section>
    ${latestActionHtml(latest,{master,esc})}
    ${master?`<details class="combat-live-effects"><summary>Efeitos ativos do encontro (${effects.length})</summary><div class="combat-live-effect-list">${masterEffects.map(e=>`<div><strong>${esc(e.name||e.effect_key||'Efeito')}</strong>${e.remaining_turns!=null?` • ${esc(e.remaining_turns)} turno(s)`:''}${e.uses_remaining!=null?` • ${esc(e.uses_remaining)} uso(s)`:''}</div>`).join('')||'<span class="muted small">Nenhum.</span>'}</div></details>`:''}
    <div class="combat-live-recent"><div class="combat-live-eyebrow">RECENTES</div>${recent.map(a=>`<div class="combat-live-recent-row"><span>${esc(a.attacker_name||'Entidade')} → ${esc(a.target_name||'Alvo')}</span><strong>${esc(statusText(a.status))}</strong></div>`).join('')||'<span class="muted small">Sem ações anteriores.</span>'}</div>
  </aside>`;
}

function hiddenByStructure(el) {
  if(!el || el.disabled) return true;
  if(el.closest('[hidden]')) return true;
  if(el.closest('.locked')) return true;
  let node=el;
  while(node && node instanceof HTMLElement){
    if(node.style?.display==='none' || node.style?.visibility==='hidden') return true;
    node=node.parentElement;
  }
  return false;
}

function cleanText(value='') {
  return String(value).replace(/\s+/g,' ').trim();
}

function html(value='') {
  return String(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function fieldLabel(control) {
  const label=control.closest('label');
  if(!label) return control.getAttribute('aria-label') || control.name || 'Opção';
  const clone=label.cloneNode(true);
  clone.querySelectorAll('select,input,button,option').forEach(el=>el.remove());
  return cleanText(clone.textContent) || control.getAttribute('aria-label') || control.name || 'Opção';
}

function sourceContainer(source) {
  return source.closest('form') || source.closest('.list-item') || source.closest('.combat-effect-chip') || source.closest('.reaction-panel') || source.parentElement;
}

function configurableControls(source) {
  if(source.matches('[data-defense],[data-master-override],[data-resource-recharge],[data-master-resource-recharge],[data-dismiss-summon],[data-master-dismiss-summon],[data-detonate-bomb],[data-extinguish-effect],[data-end-turn]')) return [];
  const container=sourceContainer(source);
  if(!container) return [];
  return [...container.querySelectorAll('select,input')].filter(control=>{
    if(control.closest('[data-combat-live-panel]')) return false;
    if(hiddenByStructure(control)) return false;
    if(control.type==='hidden' || control.type==='submit' || control.type==='button') return false;
    return true;
  });
}

function actionKey(source,index=0) {
  return [
    source.dataset.combatActionName||'', source.dataset.abilityId||'', source.dataset.modeKey||'',
    source.dataset.itemId||'', source.dataset.effectId||'', source.dataset.action||'',
    source.dataset.combatActor||'', source.id||'', index,
  ].join('|');
}

function actionLabel(source) {
  const explicit=cleanText(source.dataset.combatActionName||'');
  if(explicit) return explicit;
  if(source.matches('[data-defense]')) return cleanText(source.textContent).split('•')[0].trim();
  if(source.matches('[data-master-override]')) return cleanText(source.textContent);
  const title=sourceContainer(source)?.querySelector('.title')?.textContent;
  return cleanText(title||source.textContent||'Ação');
}

function actionGroup(source) {
  if(source.matches('[data-master-override]')) return 'Decisão do Mestre';
  if(source.matches('[data-defense],[data-counter]')) return 'Defesa e reação';
  if(source.dataset.combatReaction==='1' || source.matches('[data-master-reaction-use],[data-master-reaction-equipment-use]')) return 'Reações próprias';
  if(source.matches('[data-end-turn]')) return 'Turno';
  if(source.matches('[data-resource-recharge],[data-master-resource-recharge],[data-dismiss-summon],[data-master-dismiss-summon],[data-detonate-bomb],[data-extinguish-effect]')) return 'Ações rápidas';
  return 'Ações do turno';
}

function actionPriority(source) {
  if(source.matches('[data-defense]')) return 10;
  if(source.matches('[data-master-override]')) return 15;
  if(source.matches('[data-counter]')) return 20;
  if(source.dataset.combatReaction==='1' || source.matches('[data-master-reaction-use],[data-master-reaction-equipment-use]')) return 30;
  if(source.matches('[data-end-turn]')) return 90;
  return 50;
}

function syncQuickControl(quick, original, refresh) {
  const copyToOriginal=()=>{
    if(original instanceof HTMLSelectElement){
      if(original.multiple){
        const values=new Set([...quick.selectedOptions].map(o=>o.value));
        [...original.options].forEach(o=>{o.selected=values.has(o.value);});
      }else original.value=quick.value;
    }else if(original.type==='checkbox' || original.type==='radio') original.checked=quick.checked;
    else original.value=quick.value;
    original.dispatchEvent(new Event('change',{bubbles:true}));
    original.dispatchEvent(new Event('input',{bubbles:true}));
    setTimeout(refresh,0);
  };
  quick.addEventListener('change',copyToOriginal);
  if(quick.tagName==='INPUT' && !['checkbox','radio'].includes(quick.type)) quick.addEventListener('input',copyToOriginal);
}

function quickControlHtml(original,index) {
  const label=html(fieldLabel(original));
  const attr=`data-combat-live-field="${index}"`;
  if(original instanceof HTMLSelectElement){
    const opts=[...original.options].map(o=>`<option value="${String(o.value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')}" ${o.selected?'selected':''} ${o.disabled?'disabled':''}>${String(o.textContent||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</option>`).join('');
    return `<label class="combat-live-field"><span>${label}</span><select ${attr} ${original.multiple?'multiple':''} ${original.multiple?`size="${Math.min(5,Math.max(2,original.options.length))}"`:''}>${opts}</select></label>`;
  }
  if(original.type==='checkbox'){
    return `<label class="combat-live-check"><input ${attr} type="checkbox" ${original.checked?'checked':''} /> <span>${label}</span></label>`;
  }
  if(original.type==='radio'){
    return `<label class="combat-live-check"><input ${attr} type="radio" name="combat-live-radio-${index}" ${original.checked?'checked':''} /> <span>${label}</span></label>`;
  }
  const type=['number','text','search'].includes(original.type)?original.type:'text';
  return `<label class="combat-live-field"><span>${label}</span><input ${attr} type="${type}" value="${String(original.value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')}" ${original.min!==''?`min="${original.min}"`:''} ${original.max!==''?`max="${original.max}"`:''} ${original.step!==''?`step="${original.step}"`:''} /></label>`;
}

function candidateSources(root,{role='player',phase='idle',actorId='',pendingActorId='',pendingActionId=''}={}) {
  const selectors=role==='master'
    ? phase==='reaction'
      ? ['[data-defense]','[data-master-override]','[data-master-reaction-use]','[data-master-reaction-equipment-use]','[data-counter]']
      : phase==='turn'
        ? ['#master-basic button','#master-skill button','[data-master-ability-use]','[data-master-use-equipment]','[data-master-equipment-effect-use]','[data-master-resource-recharge]','[data-master-dismiss-summon]','[data-extinguish-effect]','[data-detonate-bomb]','[data-counter]','[data-end-turn]']
        : []
    : phase==='reaction'
      ? ['[data-defense]','[data-counter]','[data-ability-use][data-combat-reaction="1"]','[data-equipment-effect-use][data-combat-reaction="1"]']
      : phase==='turn'
        ? ['#basic-attack button','[data-ability-use]','[data-use-equipment]','[data-equipment-effect-use]','[data-resource-recharge]','[data-dismiss-summon]','[data-extinguish-effect]','[data-detonate-bomb]','[data-counter]','[data-end-turn]']
        : [];
  const wantedActor=String(phase==='reaction'?(pendingActorId||actorId):actorId||'');
  const seen=new Set();
  const list=[];
  for(const selector of selectors){
    root.querySelectorAll(selector).forEach(source=>{
      if(source.closest('[data-combat-live-panel]')) return;
      if(hiddenByStructure(source)) return;
      const sourceActor=String(source.dataset.combatActor||'');
      if(phase==='reaction' && pendingActionId && source.dataset.action && String(source.dataset.action)!==String(pendingActionId)) return;
      if(wantedActor && sourceActor && sourceActor!==wantedActor){
        // Contra-ataques podem pertencer a outro reagente mesmo durante o turno ativo.
        if(!source.matches('[data-counter]')) return;
      }
      if(role==='master' && phase==='turn' && source.matches('[data-master-reaction-use],[data-master-reaction-equipment-use]')) return;
      if(role==='master' && phase==='reaction' && source.matches('[data-master-reaction-use],[data-master-reaction-equipment-use]') && wantedActor && sourceActor!==wantedActor) return;
      if(role==='player' && phase==='reaction' && source.dataset.combatReaction!=='1' && !source.matches('[data-defense],[data-counter]')) return;
      if(seen.has(source)) return;
      seen.add(source); list.push(source);
    });
  }
  return list.sort((a,b)=>actionPriority(a)-actionPriority(b));
}

function populateCombatLiveActions(root, options, preserveOpenKey='') {
  const panel=root.querySelector('[data-combat-live-panel]');
  const host=panel?.querySelector('[data-combat-live-actions]');
  const title=panel?.querySelector('[data-combat-live-action-title]');
  if(!panel||!host)return;
  const {phase='idle',actorName='',pendingActorName=''}=options||{};
  if(title){
    title.textContent=phase==='reaction'
      ? `Reação de ${pendingActorName||actorName||'participante'}`
      : phase==='turn'
        ? `Ações de ${actorName||'participante'}`
        : 'Nenhuma ação liberada agora';
  }
  const sources=candidateSources(root,options);
  if(!sources.length){
    host.innerHTML='<div class="combat-live-no-actions">Nenhuma ação ou reação está liberada neste momento.</div>';
    return;
  }
  const openKey=preserveOpenKey||panel.dataset.combatLiveOpenAction||'';
  let currentGroup='';
  host.innerHTML='';
  sources.forEach((source,index)=>{
    const group=actionGroup(source);
    if(group!==currentGroup){
      currentGroup=group;
      const heading=document.createElement('div');
      heading.className='combat-live-action-group';
      heading.textContent=group;
      host.appendChild(heading);
    }
    const key=actionKey(source,index);
    const controls=configurableControls(source);
    const row=document.createElement('div');
    row.className='combat-live-action-row';
    row.dataset.combatLiveActionKey=key;
    const primary=document.createElement('button');
    primary.type='button';
    primary.className='combat-live-action-button';
    primary.textContent=actionLabel(source);
    row.appendChild(primary);
    if(controls.length){
      const body=document.createElement('div');
      body.className='combat-live-action-config';
      body.hidden=key!==openKey;
      body.innerHTML=`<div class="combat-live-action-fields">${controls.map((control,i)=>quickControlHtml(control,i)).join('')}</div><button type="button" class="btn primary combat-live-execute">Executar</button>`;
      row.appendChild(body);
      primary.addEventListener('click',()=>{
        const next=body.hidden?key:'';
        panel.dataset.combatLiveOpenAction=next;
        populateCombatLiveActions(root,options,next);
      });
      body.querySelectorAll('[data-combat-live-field]').forEach(quick=>{
        const i=Number(quick.dataset.combatLiveField||0);
        const original=controls[i];
        if(original) syncQuickControl(quick,original,()=>populateCombatLiveActions(root,options,key));
      });
      body.querySelector('.combat-live-execute')?.addEventListener('click',()=>source.click());
    }else{
      primary.addEventListener('click',()=>source.click());
    }
    host.appendChild(row);
  });
}

export function bindCombatLivePanel(root=document, options={}) {
  const panel=root.querySelector('[data-combat-live-panel]');
  const toggle=root.querySelector('[data-combat-live-toggle]');
  const close=root.querySelector('[data-combat-live-close]');
  if(!panel||!toggle)return;
  const setOpen=open=>{
    panel.classList.toggle('is-open',open);
    panel.setAttribute('aria-hidden',open?'false':'true');
    toggle.setAttribute('aria-expanded',open?'true':'false');
    try{localStorage.setItem('correntes-combat-live-open',open?'1':'0');}catch(_){/* sem storage */}
  };
  toggle.onclick=()=>setOpen(!panel.classList.contains('is-open'));
  close?.addEventListener('click',()=>setOpen(false));
  if(options.role==='master'){
    const relevantActor=String(options.phase==='reaction'?(options.pendingActorId||''):(options.actorId||''));
    const reactionInput=[...root.querySelectorAll('[data-creactions][data-combat-actor]')]
      .find(input=>String(input.dataset.combatActor||'')===relevantActor);
    const reactionBox=panel.querySelector('.combat-live-reaction');
    if(reactionInput && reactionBox){
      const control=document.createElement('button');
      control.type='button';
      control.className='combat-live-reaction-control';
      control.textContent=reactionInput.checked?'Bloquear':'Liberar';
      control.title='Alterar a janela de reação desta ficha';
      control.addEventListener('click',()=>{
        reactionInput.checked=!reactionInput.checked;
        reactionInput.dispatchEvent(new Event('change',{bubbles:true}));
      });
      reactionBox.appendChild(control);
    }
  }
  populateCombatLiveActions(root,options,panel.dataset.combatLiveOpenAction||'');
}
