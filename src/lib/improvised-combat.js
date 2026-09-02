// Ferramentas administrativas: os números são escolhidos a cada uso pelo Mestre.
export const GENERIC_ENEMY_ID = 'cdd00000-0000-4000-8000-000000000001';

export const IMPROVISED_ACTIONS = Object.freeze({
  attack: 'Ataque Improvisado',
  effect: 'Efeito Improvisado',
  narrative: 'Ação Narrativa',
  damage: 'Aplicar Dano',
  heal: 'Curar/Restaurar',
  energy: 'Alterar EA',
});

export function improvisedPayload(form) {
  const kind = form.get('kind');
  if (!Object.hasOwn(IMPROVISED_ACTIONS, kind)) throw new Error('Escolha uma ação.');
  const integer = (key, min, max, optional = false) => {
    const raw = form.get(key);
    if (optional && (raw == null || raw === '')) return null;
    const value = Number(raw);
    if (raw == null || raw === '' || !Number.isInteger(value) || value < min || value > max) {
      throw new Error('Preencha os valores inteiros dentro dos limites indicados.');
    }
    return value;
  };
  const text = key => String(form.get(key) || '').trim();
  const payload = {
    kind, target_id: text('target') || null, actor_id: text('actor') || null,
    public_text: text('publicText'), reveal_details: form.get('revealDetails') === 'on',
  };
  if (payload.public_text.length > 2000) throw new Error('Use até 2000 caracteres no texto público.');
  if (kind !== 'narrative' && !payload.target_id) throw new Error('Escolha um alvo.');
  if (kind === 'narrative' && !payload.public_text) throw new Error('Escreva a ação narrativa pública.');
  if (['attack', 'damage', 'heal', 'energy'].includes(kind)) {
    payload.amount = integer('amount', kind === 'energy' ? -100000 : 0, 100000);
    payload.damage_type = ['attack', 'damage'].includes(kind) ? text('damageType') : '';
  }
  if (kind === 'effect') {
    payload.condition_key = text('conditionKey') || null;
    payload.name = text('effectName');
    payload.description = text('effectDescription');
    payload.visible = form.get('visible') === 'on';
    payload.remaining_turns = integer('turns', 1, 1000, true);
    payload.uses = integer('uses', 1, 1000, true);
    payload.modifiers = {};
    for (const key of ['ca_bonus', 'conditional_attack_bonus', 'damage_reduction_flat', 'pa_penalty_next_turn']) {
      payload.modifiers[key] = integer(key, key.endsWith('bonus') ? -100 : 0, 100, true) ?? 0;
    }
    for (const key of ['blocks_actions', 'blocks_reactions', 'blocks_movement', 'blocks_cursed_abilities']) {
      payload.modifiers[key] = form.get(key) === 'on';
    }
    if (!payload.condition_key && !payload.name) throw new Error('Escolha uma condição ou dê um nome ao efeito temporário.');
  }
  return payload;
}

export function improvisedFormHtml(participants, conditions, activeActorId, esc, getName) {
  const targets = participants.map(p => `<option value="${p.character_id}">${esc(getName(p.characters))}</option>`).join('');
  return `<section class="card" style="margin-top:14px"><h2>Improvisação do Mestre</h2>
    <p class="muted">Ataques usam o turno atual, custam 1 PA e permitem defesa. As outras ferramentas são ajustes do Mestre, disponíveis a qualquer momento. Todos entram em Desfazer.</p>
    <form id="master-improvised" class="grid">
      <input type="hidden" name="actor" value="${activeActorId || ''}" />
      <div class="field-row"><label>Ferramenta<select name="kind">${Object.entries(IMPROVISED_ACTIONS).map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></label>
      <label>Alvo<select name="target"><option value="">Sem alvo (ação narrativa)</option>${targets}</select></label></div>
      <div data-improv-kinds="attack damage heal energy" class="field-row"><label>Valor<input name="amount" type="number" step="1" min="0" max="100000" placeholder="Informe a cada uso" /></label>
      <label data-improv-kinds="attack damage">Tipo de dano (opcional)<input name="damageType" maxlength="80" /></label></div>
      <div data-improv-kinds="effect" class="grid" hidden>
        <label>Condição<select name="conditionKey"><option value="">Efeito personalizado temporário</option>${conditions.map(c => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('')}</select></label>
        <label>Nome perceptível do efeito<input name="effectName" maxlength="120" placeholder="Obrigatório para efeito personalizado" /></label>
        <label>Descrição pública do estado<textarea name="effectDescription" maxlength="2000"></textarea></label>
        <label><input type="checkbox" name="visible" checked style="width:auto" /> Mostrar o estado aplicado ao jogador</label>
        <div class="field-row"><label>Turnos do alvo<input name="turns" type="number" min="1" max="1000" placeholder="Até remover" /></label><label>Usos<input name="uses" type="number" min="1" max="1000" placeholder="Sem limite" /></label></div>
        <p class="muted small">Turnos terminam ao encerrar o turno do alvo. Bônus de ataque e redução de dano consomem usos automaticamente; outros usos podem ser consumidos pelo Mestre.</p>
        <div class="field-row"><label>Bônus de CA<input name="ca_bonus" type="number" min="-100" max="100" value="0" /></label><label>Bônus de ataque<input name="conditional_attack_bonus" type="number" min="-100" max="100" value="0" /></label></div>
        <div class="field-row"><label>Redução de dano<input name="damage_reduction_flat" type="number" min="0" max="100" value="0" /></label><label>Redução de PA ao iniciar turno<input name="pa_penalty_next_turn" type="number" min="0" max="100" value="0" /></label></div>
        ${[['blocks_actions', 'Impedir ações'], ['blocks_reactions', 'Impedir reações'], ['blocks_movement', 'Impedir movimento'], ['blocks_cursed_abilities', 'Suprimir capacidades amaldiçoadas']].map(([key, label]) => `<label><input name="${key}" type="checkbox" style="width:auto" /> ${label}</label>`).join('')}
      </div>
      <label>Texto público<textarea name="publicText" maxlength="2000" placeholder="Somente o que os jogadores devem saber"></textarea></label>
      <label><input name="revealDetails" type="checkbox" style="width:auto" /> Publicar também alvo, valor e tipo informados</label>
      <div class="notice small">O texto público é publicado como escrito. Nomes de fontes, configurações e notas internas não são acrescentados. Sem texto ou detalhes marcados, ajustes ficam apenas no controle do Mestre.</div>
      <button class="btn primary">Executar</button>
    </form>
  </section>`;
}

export function bindImprovisedForm(root, submit) {
  const form = root.querySelector('#master-improvised');
  if (!form) return;
  const sync = () => {
    const kind = form.elements.kind.value;
    form.querySelectorAll('[data-improv-kinds]').forEach(el => { el.hidden = !el.dataset.improvKinds.split(' ').includes(kind); });
    form.elements.amount.min = kind === 'energy' ? '-100000' : '0';
    form.elements.amount.required = ['attack', 'damage', 'heal', 'energy'].includes(kind);
    form.elements.target.required = kind !== 'narrative';
    form.elements.publicText.required = kind === 'narrative';
    form.elements.effectName.required = kind === 'effect' && !form.elements.conditionKey.value;
    form.querySelectorAll('[data-improv-kinds] input, [data-improv-kinds] select, [data-improv-kinds] textarea').forEach(input => {
      input.disabled = Boolean(input.closest('[hidden]'));
    });
  };
  form.elements.kind.addEventListener('change', sync);
  form.elements.conditionKey.addEventListener('change', sync);
  sync();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    await submit(improvisedPayload(new FormData(form)));
  });
}

export function improvisedEventsHtml(events, esc) {
  return events.length ? `<section class="card" style="margin-top:14px"><h2>Registro público do Mestre</h2><div class="list">${events.map(event => `<div class="list-item"><div class="body">${esc(event.label)}</div></div>`).join('')}</div></section>` : '';
}
