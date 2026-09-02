import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { improvisedFormHtml, bindImprovisedForm, improvisedEventsHtml } from '../src/lib/improvised-combat.js';

const window = new Window();
const previousFormData = globalThis.FormData;
globalThis.FormData = window.FormData;
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const root = window.document.body;
const participant = { character_id:'enemy', characters:{first_name:'<img src=x onerror=alert(1)>'} };
try {
  root.innerHTML = improvisedFormHtml([participant],[{key:'stunned',name:'Atordoado'}],'enemy',esc,c=>c.first_name);
  let received;
  bindImprovisedForm(root, async payload=>{received=payload;});
  const form=root.querySelector('form');
  const choose=kind=>{form.elements.kind.value=kind;form.elements.kind.dispatchEvent(new window.Event('change'));};
  const submit=()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(form.elements.amount.value,'');
  assert.equal(form.checkValidity(),false,'Ataque precisa de alvo e dano informado');
  assert.equal(root.querySelectorAll('img,script').length,0,'Nome do alvo é escapado');

  form.elements.target.value='enemy';form.elements.amount.value='17';
  assert.equal(form.checkValidity(),true);submit();assert.equal(received.amount,17);assert.equal(received.kind,'attack');
  assert.equal(received.reveal_details,false);
  choose('damage');form.elements.amount.value='9';form.elements.publicText.value='Um impacto.';submit();
  assert.equal(received.kind,'damage');assert.equal(received.amount,9);
  choose('heal');form.elements.amount.value='4';submit();assert.equal(received.kind,'heal');
  choose('energy');form.elements.amount.value='-3';assert.equal(form.checkValidity(),true);submit();assert.equal(received.amount,-3);

  choose('effect');form.elements.conditionKey.value='stunned';form.elements.turns.value='2';form.elements.blocks_movement.checked=true;
  form.elements.conditionKey.dispatchEvent(new window.Event('change'));
  assert.equal(form.elements.amount.disabled,true,'Número negativo oculto não bloqueia o envio do efeito');
  assert.equal(form.checkValidity(),true);submit();assert.equal(received.condition_key,'stunned');
  assert.equal(received.remaining_turns,2);assert.equal(received.modifiers.blocks_movement,true);assert.equal(received.amount,undefined);
  form.elements.conditionKey.value='';form.elements.effectName.value='Equilíbrio instável';submit();assert.equal(received.name,'Equilíbrio instável');
  choose('narrative');form.elements.target.value='';form.elements.publicText.value='A porta se abre.';
  assert.equal(form.elements.turns.disabled,true);assert.equal(form.checkValidity(),true);submit();
  assert.equal(received.target_id,null);assert.equal(received.public_text,'A porta se abre.');assert.equal(received.amount,undefined);
  assert.equal(received.modifiers,undefined);
  root.insertAdjacentHTML('beforeend',improvisedEventsHtml([{label:'<script>segredo()</script>'}],esc));
  assert.equal(root.querySelectorAll('script').length,0,'Narrativa pública é escapada');
  console.log('OK: seis ferramentas, troca de campos, validação, envio, alvo opcional e escape de texto no DOM.');
} finally {
  globalThis.FormData=previousFormData;
  await window.happyDOM.close();
}
