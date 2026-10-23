// Vendas no Mercado: o que você vende de verdade, por quanto e em quanto tempo, a partir do seu histórico do Mercado e
// dos seus anúncios (as duas listas vêm em toda resposta do Mercado: history e mine).
// - Nos cards dos seus anúncios (aba Meus anúncios e onde mais aparecerem): há quanto tempo está à venda, quanto já
//   vendeu e, com 4 dias ou mais sem nenhuma venda, um aviso para retirar. Passando o mouse: o anúncio, as vendas dele,
//   como está o Mercado (mais barato dos outros, unidades na sua frente, maior pedido de compra) e o seu histórico do
//   item (vendas em 30 dias, preço mediano, tempo típico até a 1ª venda).
// - A lista geral do Mercado não traz todos os anúncios: com o Mercado aberto fora da aba Comprar, carregamos as
//   categorias Items, Stones, Poke Balls e Diamonds pela própria tela (o estado da categoria, como um clique), no
//   máximo a cada 10 min, e a categoria volta a ser a que estava.
// Itens: as vendas do histórico com o mesmo nome e preço depois da criação do anúncio são dele (e vemos a pilha
// diminuir). Pokémon (1 por anúncio): se o anúncio ainda está lá, não vendeu.
// Tudo por conta (localStorage do painel). Só lê; não anuncia nem retira nada. window.__pbSales serve o Anunciar.
(() => {
  if (window.__pbSales) return;

  // Seletores e dados do jogo. Ajuste aqui quando o jogo atualizar.
  const API = '/api/game/market';                // categoria All; as outras são ?category=…
  const WIN = '.mkt2-window';
  const ITEMS = '.mkt2-grid > .mkt2-card, .mkt2-rows .mkt2-row, .mkt2-rows .mkt2-trow:not(.mkt2-trow--head)';
  const INFO = ':scope :is(.mkt2-card-info, .mkt2-row-info, .mkt2-tc--name)';  // onde entra a etiqueta
  const TABS = '.mkt2-tabs';
  const BUY_TAB = '.mkt2-tabs .mkt2-tab:first-child';                        // Comprar é a primeira aba
  const CATS = ['Items', 'Stones', 'Poke Balls', 'Diamonds'];
  const CAT_STATES = new Set(['All', ...CATS, 'Pokemon']);
  const KEY = 'pb:sales:v1';
  const DAY = 864e5;
  const STALE_MS = 4 * DAY;                      // sem nenhuma venda há isso: sugerir retirar
  const SCAN_EVERY_MS = 10 * 60e3, SCAN_GAP_MS = 1500, SCAN_WAIT_MS = 8000;
  const KEEP_SALES_MS = 120 * DAY, KEEP_GONE_MS = 60 * DAY;
  const CHECK_MS = 1000;

  const fmt = n => Math.round(n).toLocaleString('pt-BR');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const span = ms => {
    const h = ms / 36e5;
    return h < 1 ? `${Math.max(1, Math.round(ms / 6e4))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`;
  };
  const when = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const idOf = l => `${l.kind}|${l.capturedId || l.refId || l.name}|${l.price}|${l.at}`;
  const itemKey = l => `${l.kind}|${l.kind === 'pokemon' ? l.name : l.refId || l.name}`;

  // ---------- dados guardados: seus anúncios vistos e suas vendas ----------
  // own[id] = { n, k, p, cur, at (criado), q0 (quantidade quando vimos a 1ª vez), q, seen, last, gone }
  // sales[chave] = { n, a (unidades), p (preço unitário), cur, at, offer }
  let db = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v?.v === 1 ? v : null; } catch { return null; } })()
    || { v: 1, own: {}, sales: {} };
  let saveTimer = 0;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} }, 2000); };
  let mineIds = new Set();                       // anúncios seus na última resposta
  function learn(data) {
    if (!data || typeof data !== 'object') return;
    const now = Date.now();
    let changed = false;
    if (Array.isArray(data.history)) {
      for (const h of data.history) {
        if (!h || h.bought || !h.name) continue;
        const k = `${h.name}|${h.amount}|${h.price}|${h.currency}|${h.at}`;
        if (db.sales[k]) continue;
        db.sales[k] = { n: h.name, a: +h.amount || 0, p: +h.price || 0, cur: h.currency, at: Date.parse(h.at) || now, offer: !!h.offer };
        changed = true;
      }
    }
    if (Array.isArray(data.mine)) {
      const ids = new Set();
      for (const m of data.mine) {
        if (!m?.name) continue;
        const id = idOf(m);
        ids.add(id);
        const r = db.own[id] ||= { n: m.name, k: m.kind, p: m.price, cur: m.currency, at: Date.parse(m.at) || now, q0: m.quantity || 1, seen: now };
        Object.assign(r, { q: m.quantity || 0, last: now, gone: 0 });
      }
      for (const [id, r] of Object.entries(db.own)) if (!ids.has(id) && !r.gone) r.gone = now;
      mineIds = ids;
      changed = true;
    }
    if (!changed) return;
    for (const [k, s] of Object.entries(db.sales)) if (now - s.at > KEEP_SALES_MS) delete db.sales[k];
    for (const [k, r] of Object.entries(db.own)) if (r.gone && now - r.gone > KEEP_GONE_MS) delete db.own[k];
    save();
  }
  const isMarketKey = k => k === API || k?.startsWith(`${API}?category=`);
  for (const k of Object.keys(window.__pbCache || {})) if (isMarketKey(k)) learn(window.__pbCache[k]?.data);
  window.addEventListener('pb:data', e => {
    const k = e.detail?.path;
    if (!isMarketKey(k)) return;
    learn(window.__pbCache?.[k]?.data);
    schedule();
  });

  // ---------- contas ----------
  const salesOf = (name, price, cur, from) => Object.values(db.sales).filter(s => s.n === name && (price == null || s.p === price) && (!cur || s.cur === cur) && s.at >= from);
  // Um anúncio seu: idade, unidades vendidas desde que foi criado, 1ª e última venda.
  function statusOf(l, now = Date.now()) {
    const created = Date.parse(l.at) || now, age = now - created, rec = db.own[idOf(l)];
    let units = 0, first = 0, last = 0;
    if (l.kind !== 'pokemon') {
      for (const s of salesOf(l.name, l.price, l.currency, created)) {
        units += s.a;
        first = first ? Math.min(first, s.at) : s.at;
        last = Math.max(last, s.at);
      }
      if (rec && rec.q0 - (l.quantity ?? rec.q) > units) units = rec.q0 - (l.quantity ?? rec.q);  // vimos a pilha diminuir
    }
    return { created, age, units, first, last, q0: rec?.q0, kind: units > 0 ? 'selling' : age >= STALE_MS ? 'stale' : 'fresh' };
  }
  // Seu histórico de um item: vendas em 30 dias e tempo típico até a 1ª venda (dos anúncios que vimos).
  function itemStats(name, now = Date.now()) {
    const recent = salesOf(name, null, 'GOLD', now - 30 * DAY);
    const units = recent.reduce((t, s) => t + s.a, 0);
    const delays = [];
    for (const r of Object.values(db.own)) {
      if (r.n !== name) continue;
      const after = salesOf(name, r.p, r.cur, r.at).filter(s => !r.gone || s.at <= r.gone + 60e3);
      if (after.length) delays.push(Math.min(...after.map(s => s.at)) - r.at);
    }
    const lastSale = recent.reduce((m, s) => (s.at > (m?.at || 0) ? s : m), null);
    return { units, count: recent.length, median: median(recent.map(s => s.p)), last: lastSale, tts: median(delays), ttsN: delays.length };
  }
  // O Mercado para um item: anúncios dos outros (todas as categorias carregadas) e pedidos de compra.
  function marketFor(l) {
    const seen = new Set(), k = itemKey(l);
    let cheapest = null, ahead = 0, sellersAhead = 0, bestReq = null, reqUnits = 0;
    for (const [key, hit] of Object.entries(window.__pbCache || {})) {
      if (!isMarketKey(key)) continue;
      for (const x of hit?.data?.listings || []) {
        if (!x || x.currency !== (l.currency || 'GOLD') || x.offerOnly || itemKey(x) !== k || mineIds.has(idOf(x))) continue;
        const id = idOf(x);
        if (seen.has(id)) continue;
        seen.add(id);
        if (!cheapest || x.price < cheapest.price) cheapest = x;
        if (l.price != null && x.price < l.price) { ahead += x.quantity || 1; sellersAhead += x.sellers || 1; }
      }
      for (const r of hit?.data?.requests || []) {
        if (!r || itemKey(r) !== k) continue;
        if (bestReq == null || r.price > bestReq) { bestReq = r.price; reqUnits = r.amount || 0; }
      }
    }
    return { cheapest: cheapest?.price ?? null, cheapestQty: cheapest?.quantity || 0, ahead, sellersAhead, bestReq, reqUnits, offers: seen.size };
  }
  window.__pbSales = { statusOf, itemStats, marketFor, isMine: l => mineIds.has(idOf(l)), STALE_MS };

  // ---------- etiquetas nos seus anúncios ----------
  const fiberOf = el => { const k = Object.keys(el).find(x => x.startsWith('__reactFiber$')); return k ? el[k] : null; };
  function listingOf(el) {
    for (let f = fiberOf(el), d = 0; f && d < 8; f = f.return, d++) {
      const l = f.memoizedProps?.l;
      if (l && typeof l === 'object' && 'price' in l && 'name' in l) return l;
    }
    return null;
  }
  const tagText = st => (st.kind === 'stale' ? `⚠ ${span(st.age)} sem venda · retirar`
    : st.kind === 'selling' ? `vendeu ${fmt(st.units)}${st.last ? ` · há ${span(Date.now() - st.last)}` : ''}`
      : `à venda há ${span(st.age)}`);
  let win = null, mo = null, pending = 0;
  function apply() {
    pending = 0;
    if (!win?.isConnected) return;
    const now = Date.now();
    for (const el of win.querySelectorAll(ITEMS)) {
      const l = listingOf(el), mine = !!l && mineIds.has(idOf(l));
      let tag = el.querySelector(':scope .pb-sale-tag');
      if (!mine) {
        if (tag) tag.remove();
        if (el.hasAttribute('data-pb-sale')) el.removeAttribute('data-pb-sale');
        continue;
      }
      const st = statusOf(l, now), text = tagText(st);
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'pb-sale-tag';
        (el.querySelector(INFO) || el).append(tag);
      }
      if (tag.textContent !== text) tag.textContent = text;
      if (tag.dataset.kind !== st.kind) tag.dataset.kind = st.kind;
      if (el.getAttribute('data-pb-sale') !== st.kind) el.setAttribute('data-pb-sale', st.kind);
    }
  }
  const schedule = () => { if (!pending) pending = setTimeout(apply, 200); };

  // ---------- cartão ao passar o mouse ----------
  const card = document.createElement('div');
  card.id = 'pb-sale-card';
  card.hidden = true;
  card.setAttribute('role', 'tooltip');
  let hoverEl = null;
  function render(l) {
    const now = Date.now(), st = statusOf(l, now), it = itemStats(l.name, now), mk = marketFor(l);
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const verdict = st.kind === 'stale'
      ? `<p class="pbsc-verdict stale">${span(st.age)} sem nenhuma venda: vale retirar${mk.cheapest != null && mk.cheapest < l.price ? ` e anunciar perto de ${fmt(mk.cheapest)}` : ''}.</p>`
      : st.kind === 'selling' ? `<p class="pbsc-verdict selling">Vendendo: ${fmt(st.units)} desde que anunciou.</p>`
        : `<p class="pbsc-verdict">À venda há ${span(st.age)}; o aviso de retirar aparece com 4 dias sem venda.</p>`;
    let body = row('Anunciado', `${when(st.created)} <small>(há ${span(st.age)})</small>`);
    body += row('Preço', `${fmt(l.price)}${l.quantity > 1 ? ` <small>× ${fmt(l.quantity)}${st.q0 > l.quantity ? ` de ${fmt(st.q0)}` : ''}</small>` : ''}`);
    if (st.first) body += row('1ª venda', `após ${span(st.first - st.created)}${st.last !== st.first ? ` <small>· última há ${span(now - st.last)}</small>` : ''}`);
    if (mk.cheapest != null) body += row('Mais barato dos outros', `${fmt(mk.cheapest)}${mk.ahead ? ` <small>· ${fmt(mk.ahead)} un na sua frente</small>` : ' <small>· você é o mais barato</small>'}`);
    else if (l.kind !== 'pokemon') body += row('Outros vendendo', 'ninguém');
    if (mk.bestReq != null) body += row('Maior pedido de compra', `${fmt(mk.bestReq)} <small>× ${fmt(mk.reqUnits)}</small>`);
    body += row('Suas vendas em 30 d', it.count ? `${fmt(it.units)} un <small>em ${it.count} venda${it.count > 1 ? 's' : ''} · mediana ${fmt(it.median)}</small>` : 'nenhuma');
    if (it.tts != null) body += row('Tempo até vender', `~${span(it.tts)} <small>(${it.ttsN} anúncio${it.ttsN > 1 ? 's' : ''})</small>`);
    card.innerHTML = `<div class="pbsc-head"><b>${esc(l.name)}</b><span>seu anúncio</span></div>${verdict}<dl>${body}</dl>`;
  }
  function place(el) {
    const r = el.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight, gap = 8;
    let left = r.right + gap;
    if (left + cw > innerWidth - 4) left = r.left - gap - cw;
    card.style.left = `${Math.max(4, Math.min(left, innerWidth - cw - 4))}px`;
    card.style.top = `${Math.max(4, Math.min(r.top, innerHeight - ch - 4))}px`;
  }
  function show(el) {
    const l = listingOf(el);
    if (!l || !mineIds.has(idOf(l))) return hide();
    hoverEl = el;
    if (!card.isConnected) document.body.append(card);
    render(l);
    card.hidden = false;
    place(el);
  }
  function hide() { hoverEl = null; card.hidden = true; }

  // ---------- categorias completas ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Fila do useState da categoria na tela do Mercado: o único estado com um nome de categoria.
  function categoryQueue() {
    const el = win?.querySelector(TABS) || win;
    for (let f = el && fiberOf(el), d = 0; f && d < 60; f = f.return, d++) {
      if (typeof f.type !== 'function') continue;
      const hits = [];
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) if (h.queue?.dispatch && CAT_STATES.has(h.queue.lastRenderedState)) hits.push(h.queue);
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) return null;  // ambíguo: não mexe
    }
    return null;
  }
  const onBuyTab = () => !!win?.querySelector(BUY_TAB)?.classList.contains('on');
  let lastScan = 0, scanning = false;
  async function scanCategories() {
    if (scanning || Date.now() - lastScan < SCAN_EVERY_MS || !win?.isConnected || onBuyTab()) return;
    const q = categoryQueue();
    if (!q) return;
    scanning = true;
    lastScan = Date.now();
    const original = q.lastRenderedState;
    try {
      for (const c of CATS) {
        if (!win?.isConnected || onBuyTab()) break;
        const key = `${API}?category=${c}`, since = Date.now();
        q.dispatch(c);
        for (const end = Date.now() + SCAN_WAIT_MS; Date.now() < end && !((window.__pbCache?.[key]?.at || 0) >= since);) await sleep(200);
        await sleep(SCAN_GAP_MS);
      }
    } finally {
      if (q.lastRenderedState !== original) q.dispatch(original);
      scanning = false;
    }
  }

  // ---------- acompanhar a janela do Mercado ----------
  setInterval(() => {
    const w = document.querySelector(WIN);
    if (w !== win) {
      mo?.disconnect();
      hide();
      win = w;
      if (win) {
        mo = new MutationObserver(schedule);
        mo.observe(win, { childList: true, subtree: true });
        win.addEventListener('pointerover', e => {
          const el = e.target.closest?.(ITEMS);
          if (el && el !== hoverEl && win.contains(el) && el.hasAttribute('data-pb-sale')) show(el);
          else if (!el?.hasAttribute('data-pb-sale') && hoverEl) hide();
        });
        win.addEventListener('pointerleave', hide);
        win.addEventListener('scroll', hide, true);
        schedule();
      }
    }
    if (win) scanCategories();
  }, CHECK_MS);
})();
