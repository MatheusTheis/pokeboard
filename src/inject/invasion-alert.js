// Invasão Rocket: quando a Equipe Rocket invade Cerulean (a cada 2 h; a entrada fica aberta nos 10 primeiros minutos),
// o main faz a barra de tarefas do Windows piscar e mostra uma notificação (pb:invasion). Uma vez por invasão, por conta.
// O sinal vem das mensagens que o servidor já manda para o jogo pelo WebSocket: "invasion-state" (janela da invasão:
// entryOpen, entryUntil, endsAt), "invasion-energy" (a Energia Vermelha, com a mesma janela) e "invasion-announce" (o
// chamado da Oficial, que todo mundo vê). Só ouvimos pelo subscribe do próprio jogo; nada é pedido nem enviado.
// Reserva, se a conexão não for achada: o chamado da Oficial na tela (.invasion-jane).
(() => {
  if (window.__pbInvasionAlert) return;
  window.__pbInvasionAlert = true;

  // Seletores e regras do jogo. Ajuste aqui quando o jogo atualizar.
  const ROOT = '.game-root';            // a conexão do jogo (contexto do React) fica acima dela
  const CALL = '.invasion-jane';        // chamado da Oficial, enquanto dura o anúncio
  const EVERY_MS = 2 * 36e5;            // uma invasão a cada 2 h
  const ENTRY_MS = 10 * 60e3;           // a entrada fica aberta nos 10 primeiros minutos
  const RAID_MS = 30 * 60e3;            // a invasão dura 30 min: avisos mais próximos que isso são da mesma
  const KEY = 'pb:invasion:v1';         // início da última invasão avisada (localStorage do painel = por conta)
  const WAIT_MS = 4000;                 // junta os sinais (o jogo pede a energia até 3 s depois do início)
  const CHECK_MS = 3000;                // reconexão / troca de conta: acha a conexão de novo

  const fiberOf = el => { const k = Object.keys(el).find(x => x.startsWith('__reactFiber$')); return k ? el[k] : null; };
  // O valor do contexto do WebSocket do jogo: { send, subscribe, … }.
  function findWs() {
    const el = document.querySelector(ROOT);
    for (let f = el && fiberOf(el), d = 0; f && d < 120; f = f.return, d++) {
      const v = f.memoizedProps?.value;
      if (v && typeof v.subscribe === 'function' && typeof v.send === 'function') return v;
    }
    return null;
  }
  const near = (a, b) => Math.abs(a - b) < RAID_MS;
  const sane = t => Number.isFinite(t) && Math.abs(t - Date.now()) < EVERY_MS;

  let last = (() => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } })();
  let energy = null, pending = null;

  // Um sinal de invasão aberta. entryUntil: fim da entrada, quando a mensagem traz; sem ele (chamado da Oficial), a
  // invasão começou agora.
  function signal(entryUntil) {
    const now = Date.now();
    const until = sane(entryUntil) ? entryUntil : null;
    if (until != null && until <= now) return;  // entrada já fechou
    const start = until != null ? until - ENTRY_MS : now;
    if (last && near(start, last)) return;
    if (pending) { if (until != null) pending = { start, until }; return; }
    pending = { start, until };
    setTimeout(fire, WAIT_MS);
  }
  function fire() {
    const p = pending;
    pending = null;
    if (!p || (p.until != null && p.until <= Date.now()) || (last && near(p.start, last))) return;
    last = p.start;
    try { localStorage.setItem(KEY, String(last)); } catch {}
    // O preload leva para o main: piscar a barra de tarefas e notificar.
    document.documentElement.dataset.pbInvasion = JSON.stringify({ start: p.start, entryUntil: p.until, energy });
    window.dispatchEvent(new Event('pb:invasion'));
  }

  function onWindow(m) {
    if (m?.energy != null && Number.isFinite(Number(m.energy))) energy = Number(m.energy);
    if (m?.entryOpen) signal(Number(m.entryUntil));
  }
  function onAnnounce(m) {
    if (m?.text && !(Number(m.until) <= Date.now())) signal(null);
  }

  // A conexão é a mesma enquanto a função subscribe for a mesma (o objeto do contexto pode mudar a cada render).
  let ws = null, offs = [];
  setInterval(() => {
    if (document.querySelector(CALL)) signal(null);
    const now = findWs();
    if (now?.subscribe === ws?.subscribe) { if (now) ws = now; return; }
    for (const off of offs) try { off(); } catch {}
    ws = now;
    offs = [];
    if (!ws) return;
    for (const [type, fn] of [['invasion-state', onWindow], ['invasion-energy', onWindow], ['invasion-announce', onAnnounce]]) {
      const off = ws.subscribe(type, fn);
      if (typeof off === 'function') offs.push(off);
    }
  }, CHECK_MS);
})();
