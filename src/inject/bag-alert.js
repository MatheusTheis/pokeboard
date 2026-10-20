// Bolsa cheia: quando o Depósito e a Bolsa enchem, o Auto-Catch do jogo para de capturar. Avisamos com um cartão no
// meio da tela da conta, e o main faz a barra de tarefas do Windows piscar e mostra uma notificação (pb:bag-full).
// Os números (pokeCount/pokeCapacity) vêm da mensagem "autohelper" do WebSocket do jogo, a mesma do aviso dentro do
// Auto-Helper. Ouvimos pelo subscribe do próprio jogo e, a cada 2 min, pedimos a mensagem como o painel do
// Auto-Helper faz quando está aberto (requestAutoHelper: só leitura, nenhuma ação no jogo).
(() => {
  if (window.__pbBagAlert) return;
  window.__pbBagAlert = true;

  const ROOT = '.game-root';  // a conexão do jogo (contexto do React) fica acima dela
  const ASK_MS = 2 * 60e3;    // pedido da mensagem do Auto-Helper
  const CHECK_MS = 3000;      // reconexão / troca de conta: acha a conexão de novo

  const fiberOf = el => { const k = Object.keys(el).find(x => x.startsWith('__reactFiber$')); return k ? el[k] : null; };
  // O valor do contexto do WebSocket do jogo: { send, subscribe, requestAutoHelper, … }.
  function findWs() {
    const el = document.querySelector(ROOT);
    for (let f = el && fiberOf(el), d = 0; f && d < 120; f = f.return, d++) {
      const v = f.memoizedProps?.value;
      if (v && typeof v.subscribe === 'function' && typeof v.requestAutoHelper === 'function') return v;
    }
    return null;
  }

  // ---------- cartão no meio da tela ----------
  // Estilo próprio (com cores de reserva), para aparecer também com o design original do jogo.
  const css = document.createElement('style');
  css.id = 'pb-bag-alert-css';
  css.textContent = `
#pb-bag-alert { position: fixed; left: 50%; top: 50%; z-index: 2147483000; width: min(380px, calc(100vw - 32px));
  transform: translate(-50%, -50%); background: var(--pb-surface, #1C2230); color: var(--pb-ink, #F4F0E2);
  box-shadow: var(--pb-frame-ink, 0 0 0 2px #05070A), 8px 8px 0 0 var(--pb-shadow-ink, #05070A);
  font: 500 14px/19px var(--pb-font-body, "Trebuchet MS", system-ui, sans-serif); animation: pb-bag-in .18s steps(3) both; }
#pb-bag-alert[hidden] { display: none; }
#pb-bag-alert .pbba-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px 12px; background: var(--pb-dex-red, #D62B25);
  box-shadow: inset 0 -4px 0 0 var(--pb-dex-red-deep, #8A1117); color: var(--pb-on-red, #fff); }
#pb-bag-alert .pbba-bar b { font: 400 13px/18px var(--pb-font-pixel, "Courier New", monospace); text-transform: uppercase; }
#pb-bag-alert .pbba-ico { font-size: 20px; line-height: 1; animation: pb-bag-blink 1s steps(2) infinite; }
#pb-bag-alert .pbba-body { padding: 12px 14px 14px; }
#pb-bag-alert .pbba-count { margin: 0 0 6px; font-size: 22px; line-height: 26px; font-weight: 700; color: var(--pb-pika-yellow, #FFCB05); }
#pb-bag-alert p { margin: 0 0 10px; }
#pb-bag-alert button { display: block; margin-left: auto; padding: 6px 16px; border: 0; border-radius: 0; cursor: pointer;
  background: var(--pb-dex-red, #D62B25); color: var(--pb-on-red, #fff); box-shadow: var(--pb-frame-ink, 0 0 0 2px #05070A);
  font: 700 14px/18px var(--pb-font-body, system-ui, sans-serif); }
#pb-bag-alert button:hover { filter: brightness(1.12); }
#pb-bag-alert button:focus-visible { outline: 2px solid var(--pb-focus, #FFCB05); outline-offset: 3px; }
@keyframes pb-bag-in { from { opacity: 0; transform: translate(-50%, -46%); } }
@keyframes pb-bag-blink { 50% { opacity: .25; } }`;
  const card = document.createElement('div');
  card.id = 'pb-bag-alert';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-labelledby', 'pb-bag-alert-t');
  card.hidden = true;
  card.innerHTML = `<div class="pbba-bar"><span class="pbba-ico" aria-hidden="true">⚠</span><b id="pb-bag-alert-t">Bolsa cheia</b></div>
<div class="pbba-body"><p class="pbba-count"></p><p>O Depósito e a Bolsa estão cheios e o Auto-Catch parou de capturar. Venda ou solte Pokémon para voltar a capturar.</p>
<button type="button">Entendi</button></div>`;
  card.querySelector('button').addEventListener('click', () => { card.hidden = true; });
  function show(count, max) {
    if (!css.isConnected) document.head.append(css);
    if (!card.isConnected) document.body.append(card);
    card.querySelector('.pbba-count').textContent = `${count.toLocaleString('pt-BR')} / ${max.toLocaleString('pt-BR')} Pokémon`;
    card.hidden = false;
    card.querySelector('button').focus({ preventScroll: true });
  }

  // ---------- mensagem do Auto-Helper ----------
  let full = false;
  function onAutoHelper(m) {
    const count = Number(m?.pokeCount) || 0, max = Number(m?.pokeCapacity) || 0;
    if (!(max > 0)) return;
    const now = count >= max;
    if (now === full) { if (now && !card.hidden) card.querySelector('.pbba-count').textContent = `${count.toLocaleString('pt-BR')} / ${max.toLocaleString('pt-BR')} Pokémon`; return; }
    full = now;
    // O preload leva para o main: piscar a barra de tarefas e notificar só na hora que enche.
    document.documentElement.dataset.pbBag = JSON.stringify({ count, max });
    window.dispatchEvent(new Event('pb:bag'));
    if (full) show(count, max);
    else card.hidden = true;
  }

  // A conexão é a mesma enquanto a função subscribe for a mesma (o objeto do contexto pode mudar a cada render).
  let ws = null, unsubscribe = null, lastAsk = 0;
  const ask = () => {
    if (!ws || Date.now() - lastAsk < 30e3) return;  // nunca mais que um pedido a cada 30 s
    lastAsk = Date.now();
    try { ws.requestAutoHelper(); } catch {}
  };
  setInterval(() => {
    const now = findWs();
    if (now?.subscribe === ws?.subscribe) { if (now) ws = now; return; }
    try { unsubscribe?.(); } catch {}
    ws = now;
    unsubscribe = null;
    if (!ws) return;
    const off = ws.subscribe('autohelper', onAutoHelper);
    unsubscribe = typeof off === 'function' ? off : null;
    ask();
  }, CHECK_MS);
  setInterval(ask, ASK_MS);
})();
