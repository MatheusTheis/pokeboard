// Daily Kill completa: o ícone dos dailys na barra de telas pulsa quando você já derrotou todos da missão do dia e
// ainda não resgatou a recompensa. A missão (alvo, quantos tem / quantos precisa, se resgatou e quando o dia vira) vem
// das respostas que o próprio jogo carrega (janela da Daily Kill: /api/game/daily-kill; painel dos dailys:
// /api/game/dailys-summary). Com as janelas fechadas o jogo não atualiza o progresso, então contamos cada derrota do
// alvo pela mensagem "field-kill" do WebSocket do jogo (só ouvindo); quando o jogo manda o progresso dele, vale o dele.
// Guardado por conta (localStorage do painel). Só aparência: resgatar continua no botão do jogo.
(() => {
  if (window.__pbDailyPulse) return;
  window.__pbDailyPulse = true;

  // Seletores e dados do jogo. Ajuste aqui quando o jogo atualizar.
  const DOCK_BTN = '.game-root .game-dock .dock-btn[data-guide="dock-daily"]';  // abre o painel dos dailys
  const ROOT = '.game-root';                     // a conexão do jogo (contexto do React) fica acima dela
  const DK = '/api/game/daily-kill';
  const SUMMARY = '/api/game/dailys-summary';
  const KEY = 'pb:dk:v1';
  const DAY_MS = 20 * 36e5;                      // sem a hora da virada (só o resumo): vale por até 20 h
  const CHECK_MS = 2000;

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+lv\.?\s*\d+$/, '').trim();
  const fiberOf = el => { const k = Object.keys(el).find(x => x.startsWith('__reactFiber$')); return k ? el[k] : null; };

  // st = { picked, claimed, name, sp (speciesId), have, qty, done, resetAt, at }
  let st = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

  function fromDk(d) {
    if (!d || !Array.isArray(d.options)) return;
    const o = d.pickedIdx >= 0 ? d.options[d.pickedIdx] : null;
    st = { picked: !!o, claimed: !!d.claimed, name: o?.name || '', sp: o?.speciesId ?? null, have: +o?.have || 0, qty: +o?.qty || 0,
      done: !!o?.done, resetAt: +d.resetAt || 0, at: Date.now() };
    save();
  }
  function fromSummary(d) {
    const k = d?.kill;
    if (!k || typeof k !== 'object') return;
    const t = k.target, prev = st || {};
    st = { picked: !!k.picked, claimed: !!k.claimed, name: typeof t === 'string' ? t : t?.name || prev.name || '',
      sp: typeof t === 'number' ? t : t?.speciesId ?? prev.sp ?? null, have: +k.have || 0, qty: +k.qty || 0, done: !!k.done,
      resetAt: prev.resetAt > Date.now() ? prev.resetAt : 0, at: Date.now() };
    save();
  }
  const cache = k => window.__pbCache?.[k]?.data;
  fromDk(cache(DK));
  fromSummary(cache(SUMMARY));
  window.addEventListener('pb:data', e => {
    const k = e.detail?.path;
    if (k === DK) fromDk(cache(k));
    else if (k === SUMMARY) fromSummary(cache(k));
    else return;
    render();
  });

  // ---------- derrotas com as janelas fechadas ----------
  const live = () => !!st && (st.resetAt ? Date.now() < st.resetAt : Date.now() - st.at < DAY_MS);
  function onKill(e) {
    if (!live() || !st.picked || st.claimed || !st.qty || st.have >= st.qty) return;
    const same = (st.name && norm(e?.speciesName) === norm(st.name)) || (st.sp != null && e?.speciesId === st.sp);
    if (!same) return;
    st.have += 1;
    save();
    render();
  }
  // O valor do contexto do WebSocket do jogo ({ subscribe, … }); a função subscribe não muda entre renders.
  function findWs() {
    const el = document.querySelector(ROOT);
    for (let f = el && fiberOf(el), d = 0; f && d < 120; f = f.return, d++) {
      const v = f.memoizedProps?.value;
      if (v && typeof v.subscribe === 'function' && typeof v.send === 'function') return v;
    }
    return null;
  }
  let sub = null, unsubscribe = null;

  // ---------- o ícone ----------
  const ready = () => live() && st.picked && !st.claimed && st.qty > 0 && (st.done || st.have >= st.qty);
  function render() {
    const btn = document.querySelector(DOCK_BTN);
    if (!btn) return;
    const on = ready();
    if (btn.hasAttribute('data-pb-pulse') !== on) btn.toggleAttribute('data-pb-pulse', on);
    const tip = on ? `Daily Kill completa (${st.have}/${st.qty} ${st.name}): resgate a recompensa` : null;
    // A dica do jogo ("Dailys") volta quando para de pulsar.
    if (on && btn.getAttribute('data-pb-tip') !== tip) {
      if (!btn.hasAttribute('data-pb-tip')) btn.setAttribute('data-pb-title', btn.title || '');
      btn.setAttribute('data-pb-tip', tip);
      btn.title = tip;
    } else if (!on && btn.hasAttribute('data-pb-tip')) {
      btn.title = btn.getAttribute('data-pb-title') || '';
      btn.removeAttribute('data-pb-tip');
      btn.removeAttribute('data-pb-title');
    }
  }
  setInterval(() => {
    const ws = findWs();
    if (ws?.subscribe !== sub?.subscribe) {
      try { unsubscribe?.(); } catch {}
      sub = ws;
      unsubscribe = null;
      if (ws) { const off = ws.subscribe('field-kill', onKill); unsubscribe = typeof off === 'function' ? off : null; }
    }
    render();
  }, CHECK_MS);
})();
