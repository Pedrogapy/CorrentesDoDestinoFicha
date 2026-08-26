import * as api from './api.js';

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizedD20Count(mode='normal', count=1) {
  if (mode === 'normal') return 1;
  return Math.max(2, Math.min(10, Number(count) || 2));
}

function d20Formula(mode='normal', count=1) {
  const n=normalizedD20Count(mode,count);
  if(mode==='advantage') return `${n}d20, use o MAIOR`;
  if(mode==='disadvantage') return `${n}d20, use o MENOR`;
  return '1d20';
}

function modal({title,body,ready}) {
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='overlay manual-dice-overlay';
    overlay.innerHTML=`<div class="modal manual-dice-modal">
      <div class="btn-row" style="justify-content:space-between">
        <h2 style="margin:0">${esc(title)}</h2>
        <button class="btn" type="button" data-md-cancel>Cancelar</button>
      </div>
      ${body}
    </div>`;
    document.body.appendChild(overlay);
    let finished=false;
    const finish=value=>{if(finished)return;finished=true;overlay.remove();resolve(value);};
    overlay.querySelector('[data-md-cancel]').onclick=()=>finish(null);
    overlay.onclick=e=>{if(e.target===overlay)finish(null);};
    ready?.(overlay,finish);
  });
}

function choiceBody(formula,details='') {
  return `<div class="notice" style="margin:12px 0">
    <strong>Role:</strong> ${esc(formula)}
    ${details?`<br><span class="muted small">${esc(details)}</span>`:''}
  </div>
  <div class="btn-row">
    <button class="btn primary" type="button" data-md-digital>Rolar no site</button>
    <button class="btn good" type="button" data-md-physical>Usar meus dados físicos</button>
  </div>
  <div data-md-area style="display:none;margin-top:14px"></div>`;
}

function d20Fields(specs) {
  return specs.map((spec,si)=>{
    const n=normalizedD20Count(spec.mode,spec.count);
    const inputs=Array.from({length:n},(_,i)=>`<label>d20 ${n>1?`#${i+1}`:''}<input type="number" min="1" max="20" step="1" required data-md-d20-spec="${si}" data-md-d20-index="${i}" /></label>`).join('');
    return `<div class="list-item">
      <div class="title">${esc(spec.label||'d20')}</div>
      <div class="meta">${esc(d20Formula(spec.mode,spec.count))}. Informe o valor NATURAL, sem bônus.</div>
      <div class="field-row-3" style="margin-top:8px">${inputs}</div>
    </div>`;
  }).join('');
}

function diceGroupFields(groups) {
  return groups.map((group,gi)=>{
    const count=Math.max(1,Number(group.count)||1);
    const sides=Math.max(2,Number(group.sides)||6);
    const each=Array.from({length:count},(_,i)=>`<label>d${sides} ${count>1?`#${i+1}`:''}<input type="number" min="1" max="${sides}" step="1" data-md-die-group="${gi}" data-md-die-index="${i}" /></label>`).join('');
    return `<div class="list-item" data-md-group="${gi}">
      <div class="title">${esc(group.label||'Rolagem')} • ${count}d${sides}</div>
      <div class="meta">Não some modificadores da ficha. O site fará isso depois.</div>
      <label style="margin-top:8px">Entrada
        <select data-md-group-mode="${gi}">
          <option value="each">Valor de cada dado</option>
          <option value="sum">Somente a soma dos dados</option>
        </select>
      </label>
      <div class="field-row-3" data-md-group-each="${gi}" style="margin-top:8px">${each}</div>
      <label data-md-group-sum-wrap="${gi}" style="display:none;margin-top:8px">Soma dos ${count}d${sides}
        <input type="number" min="${count}" max="${count*sides}" step="1" data-md-group-sum="${gi}" />
      </label>
    </div>`;
  }).join('');
}

function bindGroupModes(overlay,groups) {
  groups.forEach((_,gi)=>{
    const select=overlay.querySelector(`[data-md-group-mode="${gi}"]`);
    const each=overlay.querySelector(`[data-md-group-each="${gi}"]`);
    const sumWrap=overlay.querySelector(`[data-md-group-sum-wrap="${gi}"]`);
    const sync=()=>{const sum=select.value==='sum';each.style.display=sum?'none':'';sumWrap.style.display=sum?'':'none';};
    select.addEventListener('change',sync);sync();
  });
}

function collectD20(overlay,specs) {
  const tokens=[];
  for(let si=0;si<specs.length;si++){
    const n=normalizedD20Count(specs[si].mode,specs[si].count);
    for(let i=0;i<n;i++){
      const value=Number(overlay.querySelector(`[data-md-d20-spec="${si}"][data-md-d20-index="${i}"]`)?.value);
      if(!Number.isInteger(value)||value<1||value>20) throw new Error('Cada d20 precisa ter um resultado entre 1 e 20.');
      tokens.push({kind:'die',sides:20,value});
    }
  }
  return tokens;
}

function collectGroups(overlay,groups) {
  const tokens=[];
  groups.forEach((group,gi)=>{
    const count=Math.max(1,Number(group.count)||1);
    const sides=Math.max(2,Number(group.sides)||6);
    const mode=overlay.querySelector(`[data-md-group-mode="${gi}"]`)?.value||'each';
    if(mode==='sum'){
      const total=Number(overlay.querySelector(`[data-md-group-sum="${gi}"]`)?.value);
      if(!Number.isInteger(total)||total<count||total>count*sides) throw new Error(`A soma de ${count}d${sides} precisa ficar entre ${count} e ${count*sides}.`);
      tokens.push({kind:'sum',count,sides,total});
      return;
    }
    for(let i=0;i<count;i++){
      const value=Number(overlay.querySelector(`[data-md-die-group="${gi}"][data-md-die-index="${i}"]`)?.value);
      if(!Number.isInteger(value)||value<1||value>sides) throw new Error(`Cada d${sides} precisa ficar entre 1 e ${sides}.`);
      tokens.push({kind:'die',sides,value});
    }
  });
  return tokens;
}

export async function chooseD20RollSet({title='Rolagem',specs=[],details=''}) {
  const clean=(specs||[]).map(spec=>({
    label:spec.label||'Teste',
    mode:spec.mode||'normal',
    count:Number(spec.count)||1,
  })).filter(Boolean);
  if(!clean.length)return {source:'none',tokens:[]};
  const formula=clean.map(spec=>`${d20Formula(spec.mode,spec.count)} (${spec.label})`).join(' + ');
  return modal({title,body:choiceBody(formula,details),ready:(overlay,finish)=>{
    overlay.querySelector('[data-md-digital]').onclick=()=>finish({source:'digital',tokens:[]});
    overlay.querySelector('[data-md-physical]').onclick=()=>{
      const area=overlay.querySelector('[data-md-area]');
      area.style.display='';
      area.innerHTML=`<form data-md-form><div class="list">${d20Fields(clean)}</div><button class="btn good" style="margin-top:10px">Confirmar dados físicos</button></form>`;
      area.querySelector('[data-md-form]').onsubmit=e=>{e.preventDefault();try{finish({source:'physical',tokens:collectD20(overlay,clean)});}catch(err){alert(err.message);}};
    };
  }});
}

export async function chooseD20Roll({title='Rolagem',mode='normal',count=1,label='Teste',details=''}) {
  return chooseD20RollSet({title,specs:[{label,mode,count}],details});
}

export async function chooseDiceRoll({title='Rolagem',groups=[],details=''}) {
  const clean=(groups||[]).filter(g=>Number(g.count)>0&&Number(g.sides)>1);
  if(!clean.length) return {source:'none',tokens:[]};
  const formula=clean.map(g=>`${g.count}d${g.sides} (${g.label||'rolagem'})`).join(' + ');
  return modal({title,body:choiceBody(formula,details),ready:(overlay,finish)=>{
    overlay.querySelector('[data-md-digital]').onclick=()=>finish({source:'digital',tokens:[]});
    overlay.querySelector('[data-md-physical]').onclick=()=>{
      const area=overlay.querySelector('[data-md-area]');
      area.style.display='';
      area.innerHTML=`<form data-md-form><div class="list">${diceGroupFields(clean)}</div><button class="btn good" style="margin-top:10px">Confirmar dados físicos</button></form>`;
      bindGroupModes(overlay,clean);
      area.querySelector('[data-md-form]').onsubmit=e=>{e.preventDefault();try{finish({source:'physical',tokens:collectGroups(overlay,clean)});}catch(err){alert(err.message);}};
    };
  }});
}

export async function enterPhysicalDiceGroups({title='Dados físicos',groups=[]}) {
  const clean=(groups||[]).filter(g=>Number(g.count)>0&&Number(g.sides)>1);
  if(!clean.length) return [];
  return modal({title,body:`<div class="notice" style="margin:12px 0">Role ${clean.map(g=>`${g.count}d${g.sides}`).join(' + ')}. Informe somente os dados; os modificadores continuam automáticos.</div><form data-md-form><div class="list">${diceGroupFields(clean)}</div><button class="btn good" style="margin-top:10px">Registrar dados físicos</button></form>`,ready:(overlay,finish)=>{
    bindGroupModes(overlay,clean);
    overlay.querySelector('[data-md-form]').onsubmit=e=>{e.preventDefault();try{finish(collectGroups(overlay,clean));}catch(err){alert(err.message);}};
  }});
}

export async function runWithRollChoice(choice,operation) {
  if(!choice) return {cancelled:true,value:null,source:null};
  if(choice.source!=='physical') return {cancelled:false,value:await operation(),source:choice.source};
  await api.setManualDiceQueue(choice.tokens);
  try{return {cancelled:false,value:await operation(),source:'physical'};}
  finally{await api.clearManualDiceQueue().catch(()=>{});}
}

export async function finishPhysicalAttack(actionId,title='Dano do ataque') {
  if(!actionId)return;
  await api.markPhysicalAttack(actionId);
  const prompt=await api.getPhysicalAttackPrompt(actionId);
  if(!prompt?.needs_damage)return;
  const tokens=await enterPhysicalDiceGroups({title,groups:Array.isArray(prompt.groups)?prompt.groups:[]});
  if(tokens===null){await api.useDigitalAttackDamage(actionId);return;}
  await api.setPhysicalAttackDamage(actionId,tokens);
}

export function mergedPhysicalConfig(base={},overloadKey=null) {
  let cfg=structuredClone(base||{});
  if(overloadKey){const o=(Array.isArray(cfg.overloads)?cfg.overloads:[]).find(x=>String(x.key)===String(overloadKey));if(o?.overrides)cfg={...cfg,...o.overrides};}
  return cfg;
}

export async function chooseAbilityRoll({title,cfg={},options={}}) {
  const special=String(cfg.special_action||'');

  // Armamento de Sangue: o custo em sangue (quando rolado) acontece antes da duração.
  // A fila precisa seguir exatamente essa ordem para os RPCs atuais consumirem os dados corretos.
  if(special==='create_weapon'){
    const profile=String(options.weapon_profile||'standard');
    const groups=[];
    if(profile==='standard')groups.push({label:'Custo de sangue',count:1,sides:4});
    else if(profile==='heavy')groups.push({label:'Custo de sangue',count:1,sides:6});
    else if(profile==='very_heavy')groups.push({label:'Custo de sangue',count:1,sides:8});
    groups.push({label:'Duração da arma',count:1,sides:4});
    return chooseDiceRoll({title,groups,details:profile==='light'?'A arma leve tem custo de sangue fixo; role apenas a duração. O site soma +2 turnos automaticamente.':'Role o custo de sangue e depois a duração. O site soma +2 turnos à duração automaticamente.'});
  }

  if(cfg.requires_attack){
    const specs=[{label:'Ataque principal',mode:'normal',count:1}];
    if(cfg.requires_secondary_target)specs.push({label:'Ataque no segundo alvo',mode:'normal',count:1});
    return chooseD20RollSet({
      title,
      specs,
      details:cfg.requires_secondary_target
        ? 'Informe os dois d20 naturais na ordem mostrada. Se acertarem, cada dano físico será solicitado separadamente em seguida.'
        : 'Informe o d20 natural. Se acertar, o dano físico será solicitado em seguida.',
    });
  }

  if(cfg.contest&&typeof cfg.contest==='object') return chooseD20Roll({title,mode:'normal',count:1,label:'Seu teste resistido',details:'Você pode rolar seu próprio d20. O d20 do oponente continua automático porque o teste resistido é resolvido dentro do mesmo RPC.'});
  const groups=[];
  if(Number(cfg.self_damage_dice_count||0)>0&&Number(cfg.self_damage_die||0)>1) groups.push({label:'Dano próprio',count:Number(cfg.self_damage_dice_count),sides:Number(cfg.self_damage_die)});
  if(Number(cfg.healing_dice_count||0)>0&&Number(cfg.healing_die||0)>1) groups.push({label:'Cura',count:Number(cfg.healing_dice_count),sides:Number(cfg.healing_die)});
  return chooseDiceRoll({title,groups,details:'O site continua aplicando custos, modificadores e efeitos.'});
}

export async function chooseEquipmentEffectRoll({title,cfg={}}) {
  if(cfg.requires_attack) return chooseD20Roll({title,mode:'normal',count:1,label:'Teste de ataque',details:'Informe o d20 natural. O dano físico será solicitado em seguida se acertar.'});
  const groups=[];
  if(Number(cfg.healing_dice_count||0)>0&&Number(cfg.healing_die||0)>1) groups.push({label:'Cura',count:Number(cfg.healing_dice_count),sides:Number(cfg.healing_die)});
  return chooseDiceRoll({title,groups,details:'Cargas, custos e modificadores continuam automáticos.'});
}

export function findRechargeConfig(character,resourceKey) {
  const defs=Array.isArray(character?.special_resources)?character.special_resources:[];
  return defs.find(r=>String(r.key)===String(resourceKey))?.recharge||null;
}

export async function chooseResourceRechargeRoll({title,recharge}) {
  const groups=[];
  if(Number(recharge?.self_damage_dice_count||0)>0&&Number(recharge?.self_damage_die||0)>1) groups.push({label:'Dano próprio da recarga',count:Number(recharge.self_damage_dice_count),sides:Number(recharge.self_damage_die)});
  return chooseDiceRoll({title,groups,details:'O ganho do recurso e os custos continuam automáticos.'});
}

export async function chooseBombRoll({title,effect}) {
  const data=effect?.data||{};
  const ids=Array.isArray(data.target_ids)?data.target_ids:[];
  const count=Number(data.damage_dice_count||0),sides=Number(data.damage_die||0);
  if(count<=0||sides<=1)return {source:'none',tokens:[]};
  const groups=(ids.length?ids:[null]).map((_,i)=>({label:ids.length>1?`Explosão — alvo ${i+1}`:'Explosão',count,sides}));
  return chooseDiceRoll({title,groups,details:'Uma rolagem por alvo, na mesma ordem dos alvos da bomba.'});
}
