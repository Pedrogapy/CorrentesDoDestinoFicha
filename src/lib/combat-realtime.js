// Uma assinatura por contexto; atualizações em rajada viram uma leitura sequencial.
export function createCombatRealtime(client, { canRefresh = () => true, onError = () => {}, delay = 180 } = {}) {
  let channel, key, render, timer, pending = false, running = false, generation = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };
  async function flush() {
    if (!pending || running || !channel) return;
    if (!canRefresh()) { schedule(); return; }
    pending = false;
    running = true;
    try { await render(); } catch (error) { onError(error); }
    finally {
      running = false;
      if (channel && pending) schedule();
    }
  }
  function stop() {
    generation++;
    clearTimeout(timer);
    pending = false;
    if (channel) client.removeChannel(channel);
    channel = null;
    key = null;
  }
  function subscribe(encounterId, role, rerender) {
    const nextKey = `${encounterId || 'waiting'}:${role}`;
    render = rerender;
    if (key === nextKey && channel) return channel;
    stop();
    key = nextKey;
    const current = generation;
    const refresh = () => {
      if (current !== generation) return;
      pending = true;
      schedule();
    };
    channel = client.channel(`combat-${nextKey}`)
      // INSERT/UPDATE também acordam a sala sem encontro e o Undo de encerramento.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'combat_encounters' }, refresh);
    if (encounterId) {
      for (const table of ['roll_logs', 'combat_participants']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `encounter_id=eq.${encounterId}` }, refresh);
      }
    }
    channel.subscribe();
    return channel;
  }
  return { subscribe, stop };
}
