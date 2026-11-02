// Centro de Breeding.
// 1. Lembra a ordem da caixa de Pokémon (IV / Qualidade / Nível). O jogo sempre abre a tela em IV; quando a caixa
//    aparece, devolvemos a última escolha pelo onChange do próprio seletor, como se você escolhesse de novo. Só muda a
//    ordem da lista (estado da tela, nada vai para o servidor); fica no localStorage do painel, por conta.
// 2. Aba "Todos": o jogo passou a listar no Centro só os Pokémon da Breeding Box (filtro breedingBox na mensagem
//    "pokes" do WebSocket). Na aba Todos, a lista da tela (o useState da caixa) recebe todos os que podem ir para a
//    Breeding Box; busca, ordem, regras do par e cotação continuam sendo do jogo. Clicar num que está fora manda ele
//    para a Breeding Box com a mesma mensagem do Depósito (breedbox-move) e, movido, já o coloca no par pelo onPick da
//    própria caixa. Pedido do Matheus; está nas exceções das regras do README. Não cria o ovo.
// 3. Estado ao fechar: o jogo esquece tudo quando a janela fecha (par escolhido, caminho Feromônio/Grátis, pedras em
//    dobro, busca e a rolagem da caixa). Guardamos por conta e, ao reabrir, devolvemos pelos useState do próprio Centro;
//    a cotação e as regras do par continuam do jogo. Pai que saiu da Breeding Box (usado num ovo, movido, no time) fica
//    de fora. Também só estado da tela.
// 4. Escolhido junto da caixa: com um pai escolhido, a caixa fica lá embaixo e o par sai da tela ao rolar. Uma faixa
//    presa no topo da caixa mostra quem está escolhido e a qualidade que o par precisa ter.
// 5. Desempate pelo IV: a caixa é virtual (o jogo só desenha as linhas na tela), então a ordem vai na própria lista do
//    useState. O jogo ordena por qualidade, nível ou IV com um sort estável; com a lista já em IV decrescente, quem
//    empata fica com o maior IV primeiro, na lista inteira. No visual Original fica a ordem do jogo.
// 6. Só compatíveis: com um pai escolhido, o jogo só apaga quem não serve (a mesma regra do card apagado: espécie,
//    diferença de qualidade, mínimo do parceiro de shiny). Nas duas abas (Breeding Box e Todos) a lista do useState
//    fica só com os pais e quem pode ser par. No visual Original fica a caixa do jogo, com os apagados e o motivo.
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
  const STATE_KEY = 'pb:breed-state';
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
  const ivOf = e => e.ivTotal ?? -1;
  const byIv = (a, b) => ivOf(b) - ivOf(a);

  let ws = null, offs = [], queue = null, hooks = null, obs = null, tabsEl = null, msgTimer = 0;
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
  // As filas dos useState do Centro (o componente que guarda a ordem escolhida no seletor), achadas pela forma e não
  // pela posição: a caixa é o estado que é uma lista de Pokémon; logo depois vêm os dois pais (Pokémon ou null) e os
  // dois booleanos (caminho Grátis, pedras em dobro); a busca é o texto logo antes da ordem. Antes da caixa vêm os
  // dados do Centro (com shinyPartner). A fila é a mesma entre renders; o valor atual fica em lastRenderedState. Peça
  // que não bater com a forma fica null (não é salva nem usada).
  const isPoke = v => !!v && typeof v === 'object' && 'speciesId' in v;
  function findHooks(sel) {
    for (let f = fiberOf(sel), d = 0; f && d < 40; f = f.return, d++) {
      if (typeof f.type !== 'function') continue;
      const st = [];
      for (let h = f.memoizedState; h; h = h.next) if (h.queue?.dispatch) st.push(h.queue);
      const li = st.findIndex(q => Array.isArray(q.lastRenderedState) && q.lastRenderedState.every(isPoke));
      const si = st.findLastIndex(q => q.lastRenderedState === sel.value);
      if (li < 0 || si < 0) continue;
      const at = (i, ok) => (st[i] && ok(st[i].lastRenderedState) ? st[i] : null);
      const slot = v => v === null || isPoke(v), bool = v => typeof v === 'boolean';
      return {
        list: st[li], p1: at(li + 1, slot), p2: at(li + 2, slot), free: at(li + 3, bool), dbl: at(li + 4, bool),
        search: si - 1 > li + 4 ? at(si - 1, v => typeof v === 'string') : null,
        center: st.slice(0, li).findLast(q => !!q.lastRenderedState && typeof q.lastRenderedState === 'object' && 'shinyPartner' in q.lastRenderedState) ?? null,
      };
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

  // A lista da aba (Breeding Box ou Todos) e, com pai escolhido, só os compatíveis. Ao filtrar a caixa volta ao topo
  // (os melhores pela ordem); ao tirar o pai, volta à rolagem de antes.
  let lastRef = null, fullTop = 0, pendPair = null;  // pendPair: pais devolvidos que o React ainda não desenhou
  function apply() {
    if (!queue || !got || !skinOn()) { lastRef = null; return; }
    let a = val(hooks.p1) ?? null, b = val(hooks.p2) ?? null;
    if (pendPair) { if (a || b) pendPair = null; else ({ a, b } = pendPair); }
    const ref = (a ?? b)?.id ?? null;
    const want = shown(showAll() ? all : box, a, b);
    if (queue.lastRenderedState !== want) queue.dispatch(want);
    if (ref === lastRef) return;
    const g = gridEl();
    if (g && lastRef == null) { fullTop = g.scrollTop; g.scrollTop = 0; lastTop = 0; }
    else if (g && ref == null && fullTop > 0) scrollBack(fullTop, 10);
    lastRef = ref;
  }
  function onPokes(m) {
    const list = m?.list ?? [];
    got = true;
    byId = new Map(list.map(e => [String(e.id), e]));
    for (const id of moved) if (byId.get(String(id))?.breedingBox) moved.delete(id);
    all = list.filter(movable).sort(byIv);
    box = list.filter(inBox).sort(byIv);
    // Depois dos outros ouvintes (o do Centro troca a lista pela da Breeding Box, na ordem do servidor), no mesmo render.
    queueMicrotask(() => {
      apply();
      paint();
      restoreState();
    });
  }
  function ivOrder() {
    const cur = queue?.lastRenderedState;
    if (!skinOn() || !Array.isArray(cur) || cur.every((e, i) => !i || ivOf(cur[i - 1]) >= ivOf(e))) return;
    queue.dispatch([...cur].sort(byIv));
  }
  function setTab(t) {
    if (t === tab) return;
    tab = t;
    try { localStorage.setItem(TAB_KEY, t); } catch {}
    fullTop = 0;  // a rolagem guardada era da outra lista
    apply();
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
    box = [...byId.values()].filter(inBox).sort(byIv);
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

  // ---------- escolhido junto da caixa ----------
  // Par normal: o jogo aceita diferença de qualidade até 0.15, arredondada em 3 casas (reasonQdiff). Com shiny não há
  // diferença máxima, e sim um mínimo que o jogo calcula por tier: fazemos a mesma conta (dados do Centro + tier da
  // espécie); sem eles, vem do texto que o jogo põe nos cards apagados.
  const QDIFF = 0.15;
  const SHINY_MIN = 1.6;  // o mínimo do jogo sem os dados do Centro ou sem tier; com eles, nunca abaixo de shinyPartner.min
  let pickEl = null, pickSig = '';
  const fmtQ = q => (q ?? 0).toFixed(3);
  const qOk = (a, b) => a == null || b == null || Math.round(1e3 * Math.abs(a - b)) / 1e3 <= QDIFF;

  // Tier shiny de cada espécie: tabela fixa do jogo (SHINY_BY_DEX) que não fica exposta. Lida uma vez dos arquivos do
  // próprio jogo (os já carregados vêm do cache; ela chega junto do Centro). Sem ela, vale o menor mínimo possível.
  let tiers = null, tiersAsked = false;
  async function loadTiers() {
    if (tiersAsked) return;
    tiersAsked = true;
    const todo = [], seen = new Set();
    const add = s => { for (const [, f] of String(s).matchAll(/static\/chunks\/([\w-]+\.js)/g)) if (!seen.has(f)) { seen.add(f); todo.push(f); } };
    for (const el of document.querySelectorAll('script[src], link[href]')) add(el.src || el.href);
    for (const r of performance.getEntriesByType('resource')) add(r.name);
    for (let i = 0; i < todo.length && i < 80; i++) {
      let txt = '';
      try { txt = await (await fetch(`/_next/static/chunks/${todo[i]}`, { cache: 'force-cache' })).text(); } catch { continue; }
      const at = txt.indexOf('"SHINY_BY_DEX"');
      if (at < 0) { add(txt); continue; }
      const end = txt.lastIndexOf('}', at), m = new Map();
      for (const [, id, t] of txt.slice(txt.lastIndexOf('={', end), end + 1).matchAll(/(\d+):\{[^{}]*?\btier:"(\w+)"/g)) m.set(+id, t);
      if (m.size) { tiers = m; sync(); }
      return;
    }
  }
  // O mínimo que o jogo pede do parceiro de um shiny (reasonShinyPartner), pela qualidade t do shiny mais forte.
  // null = ainda não dá para saber (sem os dados do Centro ou sem a tabela de tiers).
  function shinyNeed(speciesId, t) {
    const c = val(hooks?.center), n = c?.shinyPartner;
    if (!c) return null;
    if (!n) return SHINY_MIN;
    if (!tiers) { loadTiers(); return null; }
    const g = n.grades?.[tiers.get(speciesId)];
    if (!g) return SHINY_MIN;
    const s = Math.max(0, Math.min(1, (t - g.floor) / Math.max(1e-6, g.breedMax - g.floor)));
    return Math.min(n.hardCap, Math.round((n.min + (g.breedMax - n.min) * s) * 100) / 100);
  }
  // A regra do card apagado do jogo, para quem não está escolhido. Sem saber o mínimo do shiny, usa o menor possível:
  // pode sobrar um apagado (o jogo apaga), mas nenhum par bom some.
  function pairOk(ee, e) {
    if (e.starter || e.isDitto) return false;
    if (e.id === ee.id) return true;
    if (e.speciesId !== ee.speciesId) return false;
    if (!e.shiny && !ee.shiny) return qOk(ee.quality, e.quality);
    const s = ee.shiny && (!e.shiny || (ee.quality ?? 0) >= (e.quality ?? 0));
    const min = shinyNeed(ee.speciesId, (s ? ee.quality : e.quality) ?? 0)
      ?? Math.min(SHINY_MIN, val(hooks?.center)?.shinyPartner?.min ?? SHINY_MIN);
    return ((s ? e.quality : ee.quality) ?? 0) >= min;
  }
  let shownFor = null, shownKey = '', shownList = null;
  function shown(src, a, b) {
    const ee = a ?? b;
    if (!ee) return src;
    const n = val(hooks?.center)?.shinyPartner;
    const key = [a?.id, b?.id, !!tiers, n ? JSON.stringify(n) : ''].join('|');
    if (shownFor !== src || shownKey !== key) {
      shownFor = src; shownKey = key;
      shownList = src.filter(p => p.id === a?.id || p.id === b?.id || pairOk(ee, p));
    }
    return shownList;
  }
  const sync = () => { apply(); paintPick(); };

  function shinyMin() {
    for (const b of document.querySelectorAll(`.brd-window ${POKE}.dim`)) {
      const m = /≥\s*(\d+(?:[.,]\d+)?)/.exec(b.title || '');
      if (m) return parseFloat(m[1].replace(',', '.'));
    }
    return null;
  }
  const span = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };
  function who(p, slot) {
    const el = span('pb-pk', '');
    const color = document.querySelectorAll('.brd-window .brd-parent')[slot]?.querySelector('.brd-chip.q')?.style.color;
    const q = span('pb-pk-q', `Q ${fmtQ(p.quality)}`);
    if (color) q.style.color = color;
    el.append(span('pb-pk-tag', slot ? '♀' : '♂'), span('pb-pk-name', `${p.shiny ? '✨ ' : ''}${p.name}`),
      span('pb-pk-meta', `Lv. ${p.level} · IV ${p.ivTotal ?? '?'}`), q);
    return el;
  }
  function paintPick() {
    const bar = sel?.closest(BAR);
    const a = val(hooks?.p1) ?? null, b = val(hooks?.p2) ?? null, ee = a ?? b;
    if (!ee || !bar || !skinOn()) { pickEl?.remove(); pickEl = null; pickSig = ''; return; }
    const list = val(hooks.list) ?? [];
    const min = ee.shiny && !(a && b) ? shinyNeed(ee.speciesId, ee.quality ?? 0) ?? shinyMin() : null;
    const sig = JSON.stringify([a?.id, b?.id, a?.level, b?.level, list.length, min, tab]);
    if (pickEl?.isConnected && pickEl.previousElementSibling === bar && sig === pickSig) return;
    pickSig = sig;
    if (!pickEl) { pickEl = document.createElement('div'); pickEl.id = 'pb-brd-pick'; pickEl.setAttribute('role', 'status'); }
    if (pickEl.previousElementSibling !== bar) bar.after(pickEl);
    pickEl.replaceChildren();
    if (a) pickEl.append(who(a, 0));
    if (b) pickEl.append(who(b, 1));
    if (a && b) {
      pickEl.append(span('pb-pk-range', `diferença ${fmtQ(Math.abs((a.quality ?? 0) - (b.quality ?? 0)))}`));
      return;
    }
    // A faixa vale para parceiro normal (shiny do outro lado tem mínimo próprio); a contagem é quem da lista na tela
    // (Breeding Box ou Todos) serve de par, pela regra do jogo.
    const range = !ee.shiny ? `par: Q ${fmtQ(Math.max(0, (ee.quality ?? 0) - QDIFF))} a ${fmtQ((ee.quality ?? 0) + QDIFF)}`
      : min != null ? `par: Q ≥ ${min.toFixed(2)}` : 'par: sem diferença máxima (shiny)';
    const n = list.filter(p => p.id !== ee.id && pairOk(ee, p)).length;
    pickEl.append(span('pb-pk-range', range), span('pb-pk-count', `${n} na ${showAll() ? 'lista' : 'caixa'}`));
  }
  // Escolher ou tirar um pai é clique: o React já desenhou quando o clique chega aqui.
  document.addEventListener('click', e => {
    if (sel && e.target.closest?.('.brd-window')) requestAnimationFrame(sync);
  });
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

  // ---------- estado ao fechar ----------
  // Salvo a cada passada e no fechamento (as filas guardam o último valor mesmo com a janela desmontada). Até a
  // devolução terminar nada é salvo, para o Centro recém-aberto (vazio) não apagar o que estava guardado.
  let saved = null, restored = true, savedJson = '', lastTop = 0, scrollGoal = -1;
  const gridEl = () => sel?.closest('.brd-window')?.querySelector(GRID) ?? null;
  const val = q => q?.lastRenderedState;
  function loadState() {
    try {
      savedJson = localStorage.getItem(STATE_KEY) || '';
      const s = JSON.parse(savedJson || 'null');
      return s && typeof s === 'object' ? s : null;
    } catch { return null; }
  }
  function saveState() {
    if (!hooks || !restored) return;
    const j = JSON.stringify({
      p1: val(hooks.p1)?.id ?? null, p2: val(hooks.p2)?.id ?? null, free: !!val(hooks.free), dbl: !!val(hooks.dbl),
      search: val(hooks.search) ?? '', top: Math.round(scrollGoal >= 0 ? scrollGoal : lastTop),
    });
    if (j === savedJson) return;
    savedJson = j;
    try { localStorage.setItem(STATE_KEY, j); } catch {}
  }
  // Depois da primeira lista do jogo: só volta o pai que ainda está na Breeding Box, e só no que você ainda não mexeu.
  function restoreState() {
    if (restored || !got || !hooks) return;
    restored = true;
    const s = saved;
    const ok = id => { const p = id != null && byId.get(String(id)); return p && inBox(p) && movable(p) ? p : null; };
    let a = null, b = null;
    if (hooks.p1 && hooks.p2 && val(hooks.p1) == null && val(hooks.p2) == null) {
      a = ok(s.p1); b = ok(s.p2);
      if (b === a) b = null;
      if (a) hooks.p1.dispatch(a);
      if (b) hooks.p2.dispatch(b);
    }
    // A lista já vai filtrada no mesmo render dos pais; a rolagem guardada é a dessa lista.
    if ((a || b) && queue && got && skinOn()) {
      pendPair = { a, b };
      queue.dispatch(shown(showAll() ? all : box, a, b));
      lastRef = (a ?? b).id; fullTop = 0;
    }
    if (s.free === true && hooks.free) hooks.free.dispatch(true);
    if (s.dbl === true && hooks.dbl) hooks.dbl.dispatch(true);
    if (typeof s.search === 'string' && s.search && hooks.search && !val(hooks.search)) hooks.search.dispatch(s.search);
    if (s.top > 0) scrollBack(+s.top, 30);
  }
  // A caixa cresce aos poucos (ordem e busca devolvidas, grade virtual medindo): tenta até chegar ou você rolar.
  function scrollBack(top, tries) {
    scrollGoal = top;
    const step = () => {
      if (scrollGoal !== top) return;
      const g = gridEl();
      if (g) g.scrollTop = top;
      if (!g || Math.abs(g.scrollTop - top) <= 1 || --tries <= 0) {
        scrollGoal = -1;
        if (g) lastTop = g.scrollTop;
        return;
      }
      setTimeout(step, 100);
    };
    requestAnimationFrame(step);
  }
  addEventListener('pagehide', saveState);

  function open(s) {
    restoreSort(s);
    hooks = findHooks(s);
    queue = hooks?.list ?? null;
    saved = hooks && loadState();
    restored = !saved;
    lastTop = 0; scrollGoal = -1;
    ws = findWs();
    if (ws) {
      offs = [ws.subscribe('pokes', onPokes), ws.subscribe('breedbox-moved', onMoved), ws.subscribe('error', onError)];
      ws.requestPokes?.();
    }
    const grid = s.closest('.brd-window')?.querySelector(GRID);
    let raf = 0;
    obs = grid && new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); });
    obs?.observe(grid, { childList: true });
    if (grid) {
      // Fechada a janela, o Chrome ainda manda um scroll com 0 da caixa já desmontada: esse não conta.
      grid.addEventListener('scroll', () => { if (scrollGoal < 0 && grid.isConnected) lastTop = grid.scrollTop; }, { passive: true });
      for (const t of ['wheel', 'pointerdown', 'keydown']) grid.addEventListener(t, () => { scrollGoal = -1; }, { passive: true });
    }
  }
  function close() {
    saveState();
    for (const off of offs) try { off(); } catch {}
    offs = [];
    obs?.disconnect();
    obs = null; ws = null; queue = null; hooks = null; tabsEl = null; pending = null; got = false; pickEl = null; pickSig = '';
    lastRef = null; fullTop = 0; shownFor = null; pendPair = null;
  }

  let sel = null, wasOn = false;
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
    if (wasOn && !on && queue && got) queue.dispatch(box);  // saiu para o "Original": a caixa volta a ser a do jogo, sem filtro
    wasOn = on;
    apply();
    ivOrder();
    if (restored) saveState(); else restoreState();
    paintPick();
  }, CHECK_MS);
})();
