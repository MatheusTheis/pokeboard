// Centro de Breeding.
// 1. Lembra a ordem da caixa de Pokémon (IV / Qualidade / Nível). O jogo sempre abre a tela em IV; quando a caixa
//    aparece, devolvemos a última escolha pelo onChange do próprio seletor, como se você escolhesse de novo. Só muda a
//    ordem da lista (estado da tela, nada vai para o servidor); fica no localStorage do painel, por conta.
// 2. Aba "Todos": o jogo passou a listar no Centro só os Pokémon da Breeding Box (filtro breedingBox na mensagem
//    "pokes" do WebSocket). Na aba Todos, a lista da tela (o useState da caixa) recebe todos os que podem ir para a
//    Breeding Box; busca, ordem, regras do par e cotação continuam sendo do jogo. Clicar num que está fora manda ele
//    para a Breeding Box com a mesma mensagem do Depósito (breedbox-move) e, movido, já o coloca no par pelo onPick da
//    própria caixa. Pedido do Matheus; está nas exceções das regras do README. Não cria o ovo.
(() => {
  if (window.__pbBreeding) return;
  window.__pbBreeding = true;

  const SORT = '.brd-box-sort';  // seletor de ordem da caixa (o jogo usa os valores iv, quality e level)
  const BAR = '.brd-box-bar';    // título + busca + ordem
  const GRID = '.brd-box';
  const POKE = '.brd-box-poke';
  const ROOT = '.game-root';     // a conexão do jogo (contexto do React) fica acima dela
  const KEY = 'pb:breed-sort';
  const TAB_KEY = 'pb:breed-tab';
  const CHECK_MS = 700;          // a janela abre e fecha a qualquer hora
  const MOVE_MS = 4000;          // sem resposta do jogo nesse tempo, desiste (o Depósito do jogo usa o mesmo prazo)
  const MSG_MS = 3500;

  const propsOf = el => { const k = Object.keys(el).find(x => x.startsWith('__reactProps$')); return k ? el[k] : null; };
  const fiberOf = el => { const k = Object.keys(el).find(x => x.startsWith('__reactFiber$')); return k ? el[k] : null; };
  // Visual PokeBoard ligado? No "Original" o tokens.css sai, e a aba sai junto (a caixa volta a ser a do jogo).
  const skinOn = () => !!getComputedStyle(document.documentElement).getPropertyValue('--pb-screen').trim();

  function restoreSort(s) {
    s.addEventListener('change', () => { try { localStorage.setItem(KEY, s.value); } catch {} });
    let want = '';
    try { want = localStorage.getItem(KEY) || ''; } catch {}
    if (!want || want === s.value || ![...s.options].some(o => o.value === want)) return;
    propsOf(s)?.onChange?.({ target: { value: want }, currentTarget: { value: want } });
  }

  // ---------- aba Todos ----------
  let tab = (() => { try { return localStorage.getItem(TAB_KEY) === 'all' ? 'all' : 'box'; } catch { return 'box'; } })();
  const moved = new Set();  // movidos daqui, até a lista do jogo confirmar
  const inBox = e => (e.breedingBox || moved.has(e.id)) && !e.team && !e.starter;  // o filtro do jogo
  // Quem o Depósito aceita na Breeding Box: fora do time, sem o inicial, sem Ditto e sem anúncio no Mercado.
  const movable = e => !e.team && !e.starter && !e.listed && !e.isDitto && e.speciesId !== 132 && !String(e.id).startsWith('team-');

  let ws = null, offs = [], queue = null, obs = null, tabsEl = null, msgTimer = 0;
  let byId = new Map(), all = [], box = [], got = false;
  let pending = null;  // { id, pick, at }
  const showAll = () => tab === 'all' && got && skinOn();

  // O valor do contexto do WebSocket do jogo ({ subscribe, send, requestPokes, … }).
  function findWs() {
    const el = document.querySelector(ROOT);
    for (let f = el && fiberOf(el), d = 0; f && d < 120; f = f.return, d++) {
      const v = f.memoizedProps?.value;
      if (v && typeof v.subscribe === 'function' && typeof v.send === 'function') return v;
    }
    return null;
  }
  // A fila do useState da caixa: no componente do Centro (o que guarda a ordem escolhida no seletor), o estado que é
  // uma lista de Pokémon. A fila é a mesma entre renders; o valor atual fica em lastRenderedState.
  function findQueue(sel) {
    for (let f = fiberOf(sel), d = 0; f && d < 40; f = f.return, d++) {
      if (typeof f.type !== 'function') continue;
      let list = null, sort = false;
      for (let h = f.memoizedState; h; h = h.next) {
        const v = h.memoizedState;
        if (!h.queue?.dispatch) continue;
        if (v === sel.value) sort = true;
        else if (!list && Array.isArray(v) && v.every(p => p && typeof p === 'object' && 'speciesId' in p)) list = h.queue;
      }
      if (list && sort) return list;
    }
    return null;
  }
  // Pokémon de um card: a chave do card é o id; onPick (estável) é a escolha da própria caixa.
  function cardOf(btn) {
    for (let f = fiberOf(btn), d = 0; f && d < 4; f = f.return, d++) {
      const p = f.memoizedProps;
      if (p?.p && typeof p.onPick === 'function') return { id: f.key ?? p.p.id, pick: p.onPick };
    }
    return null;
  }

  function apply() {
    if (queue && showAll() && queue.lastRenderedState !== all) queue.dispatch(all);
  }
  function onPokes(m) {
    const list = m?.list ?? [];
    got = true;
    byId = new Map(list.map(e => [String(e.id), e]));
    for (const id of moved) if (byId.get(String(id))?.breedingBox) moved.delete(id);
    all = list.filter(movable);
    box = list.filter(inBox);
    // Depois dos outros ouvintes (o do Centro troca a lista pela da Breeding Box), no mesmo render.
    queueMicrotask(() => { apply(); paint(); });
  }
  function setTab(t) {
    if (t === tab) return;
    tab = t;
    try { localStorage.setItem(TAB_KEY, t); } catch {}
    if (t === 'all') apply();
    else if (queue && got) queue.dispatch(box);
    paint();
  }

  function say(text) {
    const el = tabsEl?.querySelector('.pb-brd-msg');
    if (!el) return;
    el.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { el.textContent = ''; }, MSG_MS);
  }
  function move(id, pick) {
    if (pending) return;
    if (!ws) return say('Sem conexão com o jogo.');
    const at = Date.now();
    pending = { id, pick, at };
    ws.send({ type: 'breedbox-move', dir: 'in', pokeIds: [id] });
    paint();
    setTimeout(() => {
      if (pending?.at !== at) return;
      pending = null;
      paint();
      say('O jogo não respondeu. Tente de novo.');
    }, MOVE_MS);
  }
  function onMoved(m) {
    if (!pending) return;
    const { id, pick } = pending;
    pending = null;
    if (!((m?.moved ?? 0) > 0)) { paint(); return say('Este Pokémon não pôde ir para a Breeding Box.'); }
    moved.add(id);
    box = [...byId.values()].filter(inBox);
    ws.requestPokes?.();
    pick(byId.get(String(id)) ?? { id });
    paint();
  }
  function onError(m) {
    if (!pending || Date.now() - pending.at > MOVE_MS) return;
    pending = null;
    paint();
    say(`❌ ${m?.message ?? ''}`);
  }

  // Capturado antes do React: o clique num Pokémon de fora vira o pedido de mover; os da Breeding Box seguem para o jogo.
  document.addEventListener('click', e => {
    if (!showAll() || !queue) return;
    const btn = e.target.closest?.(POKE);
    if (!btn || btn.disabled || !btn.closest('.brd-window')) return;
    const c = cardOf(btn);
    const p = c && byId.get(String(c.id));
    if (!p || inBox(p)) return;
    e.stopPropagation();
    e.preventDefault();
    move(p.id, c.pick);
  }, true);

  function paint() {
    if (!tabsEl) return;
    const on = showAll();
    for (const b of tabsEl.querySelectorAll('button[data-tab]')) b.setAttribute('aria-pressed', String(b.dataset.tab === (on ? 'all' : 'box')));
    tabsEl.querySelector('[data-tab="box"] b').textContent = box.length;
    tabsEl.querySelector('[data-tab="all"] b').textContent = all.length;
    for (const btn of document.querySelectorAll(`.brd-window ${POKE}`)) {
      const c = on && cardOf(btn);
      const p = c && byId.get(String(c.id));
      btn.toggleAttribute('data-pb-out', !!p && !inBox(p));
      btn.toggleAttribute('data-pb-moving', !!c && String(pending?.id) === String(c.id));
    }
  }
  function mountTabs(bar) {
    if (tabsEl?.isConnected && tabsEl.parentNode === bar) return;
    tabsEl = document.createElement('div');
    tabsEl.id = 'pb-brd-tabs';
    tabsEl.innerHTML = '<button type="button" data-tab="box">Breeding Box <b></b></button>'
      + '<button type="button" data-tab="all" title="Todos os Pokémon que podem ir para a Breeding Box. Clicar num que está fora (📦) leva ele para lá e já o coloca no par.">Todos <b></b></button>'
      + '<span class="pb-brd-msg" role="status"></span>';
    tabsEl.addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
    const title = bar.querySelector('.brd-box-title');
    if (title) title.after(tabsEl); else bar.prepend(tabsEl);
    paint();
  }

  function open(s) {
    restoreSort(s);
    queue = findQueue(s);
    ws = findWs();
    if (ws) {
      offs = [ws.subscribe('pokes', onPokes), ws.subscribe('breedbox-moved', onMoved), ws.subscribe('error', onError)];
      ws.requestPokes?.();
    }
    const grid = s.closest('.brd-window')?.querySelector(GRID);
    let raf = 0;
    obs = grid && new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); });
    obs?.observe(grid, { childList: true });
  }
  function close() {
    for (const off of offs) try { off(); } catch {}
    offs = [];
    obs?.disconnect();
    obs = null; ws = null; queue = null; tabsEl = null; pending = null; got = false;
  }

  let sel = null, wasAll = false;
  setInterval(() => {
    const s = document.querySelector(SORT);
    if (s !== sel) {
      if (sel) close();
      sel = s;
      if (s) open(s);
    }
    if (!sel) return;
    const on = skinOn();
    const bar = sel.closest(BAR);
    if (on && bar && queue && ws) mountTabs(bar);
    else if (tabsEl) { tabsEl.remove(); tabsEl = null; }
    const nowAll = showAll();
    if (wasAll && !nowAll && queue && got) queue.dispatch(box);  // saiu para o "Original": a caixa volta a ser a do jogo
    wasAll = nowAll;
    apply();
  }, CHECK_MS);
})();
