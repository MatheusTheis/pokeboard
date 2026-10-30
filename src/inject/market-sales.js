// Vendas no Mercado: o que você vende de verdade, por quanto e em quanto tempo, a partir do seu histórico do Mercado e
// dos seus anúncios (as duas listas vêm em toda resposta do Mercado: history e mine).
// - Nos cards dos seus anúncios (aba Meus anúncios e onde mais aparecerem): há quanto tempo está à venda, quanto já
//   vendeu e, com 4 dias ou mais sem nenhuma venda, um aviso para retirar. Passando o mouse: o anúncio, as vendas dele,
//   como está o Mercado (mais barato dos outros, unidades na sua frente, maior pedido de compra) e o seu histórico do
//   item (vendas em 30 dias, preço mediano, tempo típico até a 1ª venda).
// - A lista geral do Mercado não traz todos os anúncios, e o jogo só busca por categoria (o "mais barato" ordena na
//   tela). Ao abrir o Mercado, em qualquer aba, lemos os itens que você pode anunciar (a lista da própria tela do
//   Anunciar) e carregamos só as categorias deles pela própria tela (o estado da categoria, como um clique); de novo
//   ao reabrir depois de 2 min e a cada 10 min com o Mercado aberto. A categoria volta a ser a que estava; se você
//   trocar de categoria no meio, paramos e fica a sua escolha.
// - Botão "Atualizar preços" na barra de abas: a pedido, busca de novo as categorias dos seus itens, com a tela travada
//   e uma barra de progresso, e diz item por item se compensa anunciar ou vender para o Mark.
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
  const CATS = ['Items', 'Stones', 'Poke Balls', 'Diamonds'];
  const CAT_STATES = new Set(['All', ...CATS, 'Pokemon']);
  const KEY = 'pb:sales:v1';
  const DAY = 864e5;
  const STALE_MS = 4 * DAY;                      // sem nenhuma venda há isso: sugerir retirar
  const SCAN_EVERY_MS = 10 * 60e3, SCAN_REOPEN_MS = 2 * 60e3, SCAN_GAP_MS = 300, SCAN_WAIT_MS = 8000;
  // Categoria do Mercado de cada tipo de item do jogo (items.json); o resto fica em Items.
  const MARKET_CAT = { stone: 'Stones', ball: 'Poke Balls', diamonds: 'Diamonds' };
  const KEEP_SALES_MS = 120 * DAY, KEEP_GONE_MS = 60 * DAY;
  const CHECK_MS = 1000;

  // Diagnóstico em debug/diag.log (pelo preload): o que a busca de preços fez, para conferir no jogo de verdade.
  const diag = msg => { document.documentElement.dataset.pbDiag = `mercado: ${msg}`; window.dispatchEvent(new Event('pb:diag')); };
  const fmt = n => Math.round(n).toLocaleString('pt-BR');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const span = ms => {
    const h = ms / 36e5;
    return ms < 6e4 ? 'menos de 1 min' : h < 1 ? `${Math.round(ms / 6e4)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`;
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
        dirtyMine();
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
      if (ids.size !== mineIds.size || [...ids].some(id => !mineIds.has(id))) { mineIds = ids; dirtyMarket(); }
      dirtyMine();
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
    if (k === '/game/items.json') { memo.clear(); return; }  // tipos e preços do Mark: as contas mudam
    if (!isMarketKey(k)) return;
    dirtyMarket();
    learn(window.__pbCache?.[k]?.data);
    schedule();
  });

  // ---------- índices ----------
  // Montados uma vez por resposta do Mercado (ou do seu histórico) e consultados por card: antes cada card varria todos
  // os anúncios carregados (milhares) a cada mudança na tela, e a tela do Mercado travava.
  let idx = null, salesIdx = null, ownIdx = null, memoAt = 0;
  const memo = new Map();                        // sugestões por "nome|quantidade" até os dados mudarem
  function dirtyMarket() { idx = null; memo.clear(); }
  function dirtyMine() { salesIdx = null; ownIdx = null; memo.clear(); }
  const group = x => (x.kind === 'pokemon' ? 'pokemon' : 'item');
  const keysOf = x => (x.refId && group(x) === 'item' ? [`item|r:${x.refId}`, `item|n:${x.name}`] : [`${group(x)}|n:${x.name}`]);
  function marketIndex() {
    if (idx) return idx;
    const offers = new Map(), reqs = new Map(), seen = new Set();
    const catAt = Object.fromEntries(CATS.map(c => [c, window.__pbCache?.[`${API}?category=${c}`]?.at || 0]));
    let at = 0;
    for (const [key, hit] of Object.entries(window.__pbCache || {})) {
      if (!isMarketKey(key)) continue;
      at = Math.max(at, hit?.at || 0);
      for (const x of hit?.data?.listings || []) {
        if (!x?.name || x.currency !== 'GOLD' || x.offerOnly) continue;
        // Lista geral mais velha que a da categoria do anúncio: vale a da categoria (o da geral pode já ter vendido).
        if (key === API && catAt[x.category] > (hit.at || 0)) continue;
        // O mesmo anúncio vem na lista geral e na da categoria: tira o repetido pelo id dele (preço e hora podem repetir).
        const uid = x.id != null ? `id:${x.id}` : idOf(x);
        if (seen.has(uid) || mineIds.has(idOf(x))) continue;
        seen.add(uid);
        for (const k of keysOf(x)) { let a = offers.get(k); if (!a) offers.set(k, a = []); a.push(x); }
      }
      for (const r of hit?.data?.requests || []) {
        if (!r?.name) continue;
        for (const k of keysOf(r)) { const b = reqs.get(k); if (!b || r.price > b.price) reqs.set(k, r); }
      }
    }
    for (const a of offers.values()) a.sort((p, q) => p.price - q.price);
    return (idx = { offers, reqs, at });
  }
  const byName = (map, list) => { const m = new Map(); for (const x of list) { let a = m.get(x.n); if (!a) m.set(x.n, a = []); a.push(x); } return m; };
  const salesBy = () => salesIdx || (salesIdx = byName(null, Object.values(db.sales)));
  const ownBy = () => ownIdx || (ownIdx = byName(null, Object.values(db.own)));

  // ---------- contas ----------
  const salesOf = (name, price, cur, from) => (salesBy().get(name) || []).filter(s => (price == null || s.p === price) && (!cur || s.cur === cur) && s.at >= from);
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
    for (const r of ownBy().get(name) || []) {
      const after = salesOf(name, r.p, r.cur, r.at).filter(s => !r.gone || s.at <= r.gone + 60e3);
      if (after.length) delays.push(Math.min(...after.map(s => s.at)) - r.at);
    }
    const lastSale = recent.reduce((m, s) => (s.at > (m?.at || 0) ? s : m), null);
    return { units, count: recent.length, median: median(recent.map(s => s.p)), last: lastSale, tts: median(delays), ttsN: delays.length };
  }
  // O Mercado para um item: anúncios dos outros em dollars (todas as listas carregadas, já em ordem de preço) e o maior
  // pedido de compra; pelo refId e, sem ele, pelo nome.
  const NO_MARKET = { cheapest: null, cheapestQty: 0, ahead: 0, sellersAhead: 0, bestReq: null, reqUnits: 0, offers: 0, top: [], at: 0 };
  function marketFor(l) {
    if ((l.currency || 'GOLD') !== 'GOLD') return NO_MARKET;
    const I = marketIndex(), ks = keysOf(l);
    let list = null, req = null;
    for (const k of ks) if (!list) list = I.offers.get(k);
    for (const k of ks) if (!req) req = I.reqs.get(k);
    list ||= [];
    let ahead = 0, sellersAhead = 0;
    if (l.price != null) for (const x of list) { if (x.price >= l.price) break; ahead += x.quantity || 1; sellersAhead += x.sellers || 1; }
    return { cheapest: list[0]?.price ?? null, cheapestQty: list[0]?.quantity || 0, ahead, sellersAhead, bestReq: req?.price ?? null,
      reqUnits: req?.amount || 0, offers: list.length, top: list.slice(0, 4).map(x => ({ p: x.price, q: x.quantity || 1, s: x.sellers || 1 })), at: I.at };
  }
  // Seus anúncios deste item que ficaram parados (4 dias ou mais, ou retirados, sem nenhuma venda).
  function staleOf(name, now = Date.now()) {
    let n = 0;
    for (const r of ownBy().get(name) || []) {
      const end = r.gone || now, sold = salesOf(name, r.p, r.cur, r.at).some(x => x.at <= end + 60e3);
      if (!sold && end - r.at >= STALE_MS) n++;
    }
    return n;
  }
  // O Mercado de um item pelo nome (grade do Anunciar).
  const marketByName = name => marketFor({ kind: 'item', name, refId: 0, price: null, currency: 'GOLD' });

  // ---------- Mercado ou Mark: uma regra só ----------
  // A mesma conta nos cards do Anunciar (etiqueta e Vale vender), no Atualizar preços e no Vender da Loja do Mark: o
  // Mercado só vale se o menor preço em dollars dos outros, já sem a taxa, render pelo menos MIN_PROFIT a mais que o
  // Mark; se ninguém vende o item em dollars ou se os seus anúncios dele ficaram parados, Mark.
  const MIN_PROFIT = 0.3;
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const pct = v => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;
  // { dest: 'market' | 'mark' | 'none', total (vendendo todas no destino), p, net (por unidade), netTotal, markTotal,
  //   gain (Mercado − Mark), ratio (líquido ÷ Mark − 1), why }
  function decide({ qty, npc, cheapest, sells }) {
    const P = window.__pbPrices;
    const feeOf = total => (P ? P.fee(total) : Math.min(1e6, Math.floor(total * 0.03)));
    npc = npc > 0 ? npc : 0;
    const out = { qty, npc, p: cheapest ?? null, net: null, netTotal: null, markTotal: npc * qty, ratio: null, gain: 0 };
    if (cheapest == null) return { ...out, dest: npc ? 'mark' : 'none', total: out.markTotal, why: 'ninguém vendendo em dollars' };
    const gross = cheapest * qty, netTotal = gross - feeOf(gross);
    Object.assign(out, { net: netTotal / qty, netTotal, ratio: npc ? netTotal / qty / npc - 1 : null });
    if (npc && out.net < npc * (1 + MIN_PROFIT)) return { ...out, dest: 'mark', total: out.markTotal, why: `Mercado ${pct(out.ratio)} (precisa ${pct(MIN_PROFIT)})` };
    if (npc && sells === 'parado') return { ...out, dest: 'mark', total: out.markTotal, why: 'seus anúncios dele ficaram parados' };
    return { ...out, dest: 'market', total: netTotal, gain: netTotal - out.markTotal };
  }
  // Categoria do Mercado de um item pelo tipo dele no /game/items.json (o jogo já carregou; o hook guardou).
  let typeOf = null, typeFrom = null;
  function catOfName(name) {
    const list = window.__pbCache?.['/game/items.json']?.data?.items;
    if (Array.isArray(list) && list !== typeFrom) { typeFrom = list; typeOf = new Map(list.map(i => [norm(i.name), i.category])); }
    const k = norm(name);
    return typeOf?.has(k) ? MARKET_CAT[typeOf.get(k)] || 'Items' : null;
  }
  // "Ninguém vende" só vale com a categoria do item carregada nesta sessão (a lista geral não traz todos os anúncios).
  const catLoaded = name => {
    const c = catOfName(name);
    return (c ? [c] : ['Items', 'Stones']).every(k => window.__pbCache?.[`${API}?category=${k}`]);
  };
  // Para vender `qty` de um item: o que rende mais por unidade (já sem a taxa) entre o Mark, anunciar 1 abaixo do mais
  // barato dos outros (nunca abaixo do Mark, que o jogo não aceita) e o maior pedido de compra; e se o item vende.
  // verdict: a regra acima. Sem anúncio nas respostas desta sessão, usa o último menor preço guardado (__pbPrices);
  // sem nada e sem a categoria carregada, dest 'unknown'.
  function suggest(name, qty = 1, now = Date.now()) {
    if (now - memoAt > 60e3) { memo.clear(); memoAt = now; }  // idade e "parado" andam com o relógio
    const mkey = `${name}|${qty}`;
    if (memo.has(mkey)) return memo.get(mkey);
    const P = window.__pbPrices, mark = P?.npc(name);
    const feeOf = total => (P ? P.fee(total) : Math.min(1e6, Math.floor(total * 0.03)));
    const netUnit = (p, q) => (p * q - feeOf(p * q)) / q;
    const mk = marketByName(name), st = itemStats(name, now), stale = staleOf(name, now);
    const opts = [];
    if (mark > 0) opts.push({ action: 'mark', price: mark, unit: mark, units: qty });
    let list = mk.cheapest != null ? mk.cheapest - 1 : st.median != null ? Math.round(st.median) : null;
    if (list != null) { list = Math.max(list, mark || 0, 1); opts.push({ action: 'list', price: list, unit: netUnit(list, qty), units: qty }); }
    if (mk.bestReq != null) { const u = Math.max(1, Math.min(qty, mk.reqUnits || qty)); opts.push({ action: 'request', price: mk.bestReq, unit: netUnit(mk.bestReq, u), units: u }); }
    // Item que não vende (seus anúncios ficaram parados e nada vendeu em 30 dias): anunciar perde a vez para o Mark.
    const sells = st.count > 0 ? 'vende' : stale ? 'parado' : 'novo';
    const rank = o => o.unit * (o.action === 'list' && sells === 'parado' && mark > 0 ? 0 : 1);
    const best = opts.reduce((m, o) => (!m || rank(o) > rank(m) || (rank(o) === rank(m) && o.action === 'request') ? o : m), null);
    const itemCat = catOfName(name);  // também carrega o mapa de tipos (typeOf)
    let cheapest = mk.cheapest, from = mk.cheapest != null ? 'now' : null, oldAt = 0;
    const loaded = cheapest != null || catLoaded(name);
    if (!loaded) {
      const old = P?.market()?.items?.[norm(name)];
      if (old?.p > 0) { cheapest = old.p; from = 'old'; oldAt = old.at || P.market().at || 0; }
    }
    const blank = why => ({ dest: 'unknown', qty, npc: mark > 0 ? mark : 0, markTotal: (mark > 0 ? mark : 0) * qty, total: 0, gain: 0, why });
    // Só itens da mochila (os do items.json): Pokébolas e Diamonds ficam fora, como no Atualizar preços.
    const verdict = !typeOf ? blank('lista de itens do jogo ainda não carregou')
      : itemCat === null ? { ...blank('Pokébolas e Diamonds ficam fora da comparação'), dest: 'none' }
        : !loaded && cheapest == null ? blank('sem preço do Mercado ainda: use ⟳ Atualizar preços')
          : { ...decide({ qty, npc: mark, cheapest, sells }), from, oldAt };
    const out = { name, qty, mark, mk, st, stale, sells, opts, best, verdict };
    memo.set(mkey, out);
    return out;
  }
  window.__pbSales = { statusOf, itemStats, marketFor, suggest, verdict: (name, qty) => suggest(name, qty).verdict, MIN_PROFIT, isMine: l => mineIds.has(idOf(l)), STALE_MS };

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
    applyTiles();
    mountStatus();
    mountRefresh();
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

  // ---------- Anunciar › itens: destino e quanto rende vendendo tudo, em cada card ----------
  // Etiqueta no canto: no Mercado (a regra dos 30%), o total líquido de anunciar todas; senão "NPC" e o total do Mark.
  const SELL_TILES = '.mkt-sellform > .mkt-pick:not(.mkt-pick-pk) .mkt-tile';
  const compact = n => (n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
  const tileInfo = t => ({ name: t.querySelector('img')?.alt || '', qty: Number(String(t.querySelector('.mkt-tile-qty')?.textContent || '').replace(/\D/g, '')) || 1 });
  function applyTiles() {
    const now = Date.now();
    for (const t of win.querySelectorAll(SELL_TILES)) {
      const { name, qty } = tileInfo(t);
      const v = name ? suggest(name, qty, now).verdict : null;
      if (!v || (v.dest !== 'market' && v.dest !== 'mark')) { ['data-pb-sug', 'data-pb-sug-kind'].forEach(k => t.removeAttribute(k)); continue; }
      const text = v.dest === 'market' ? `💲${compact(v.total)}` : `NPC ${compact(v.total)}${/parados/.test(v.why) ? ' ⚠' : ''}`;
      if (t.getAttribute('data-pb-sug') !== text) t.setAttribute('data-pb-sug', text);
      if (t.getAttribute('data-pb-sug-kind') !== v.dest) t.setAttribute('data-pb-sug-kind', v.dest);
    }
  }
  function renderTile(t) {
    const { name, qty } = tileInfo(t), s = suggest(name, qty), v = s.verdict;
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const total = o => fmt(o.unit * o.units);
    const verdict = v.dest === 'market'
      ? `<p class="pbsc-verdict selling">Vale anunciar: menor preço ${fmt(v.p)} rende ${v.ratio != null ? `${pct(v.ratio)} sobre o Mark` : 'e o Mark não compra'}.</p>`
      : v.dest === 'mark' ? `<p class="pbsc-verdict${/parados/.test(v.why) ? ' stale' : ''}">Melhor vender para o Mark: ${esc(v.why)}.</p>`
        : `<p class="pbsc-verdict">${v.dest === 'unknown' ? 'Sem preço do Mercado ainda: use ⟳ Atualizar preços.' : 'Ninguém vende em dollars e o Mark não compra.'}</p>`;
    let body = row('Você tem', `${fmt(qty)} un`);
    if (v.dest === 'market' || v.dest === 'mark') body += row('Vendendo tudo', `💲${fmt(v.total)} <small>${v.dest === 'market' ? 'líquido' : 'no Mark'}</small>`);
    if (s.mark > 0) body += row('Mark (NPC)', `${fmt(s.mark)}/un <small>· ${fmt(s.mark * qty)}</small>`);
    const list = s.opts.find(o => o.action === 'list');
    if (s.mk.cheapest != null) {
      body += row('Mais baratos dos outros', s.mk.top.map(o => `${fmt(o.p)} <small>× ${fmt(o.q)}</small>`).join('<br>'));
      if (s.mk.offers > s.mk.top.length) body += row('', `<small>${fmt(s.mk.offers)} anúncios ao todo</small>`);
    } else body += row('Outros vendendo', 'ninguém');
    if (list) body += row(`Anunciar a ${fmt(list.price)}`, `${fmt(Math.floor(list.unit))}/un líquido <small>· ${total(list)}</small>`);
    const req = s.opts.find(o => o.action === 'request');
    if (req) body += row('Maior pedido de compra', `${fmt(req.price)} <small>× ${fmt(s.mk.reqUnits)} · ${fmt(Math.floor(req.unit))}/un líquido</small>`);
    body += row('Suas vendas em 30 d', s.st.count ? `${fmt(s.st.units)} un <small>em ${s.st.count} venda${s.st.count > 1 ? 's' : ''} · mediana ${fmt(s.st.median)}</small>` : 'nenhuma');
    if (s.st.tts != null) body += row('Tempo até vender', `~${span(s.st.tts)} <small>(${s.st.ttsN} anúncio${s.st.ttsN > 1 ? 's' : ''})</small>`);
    if (s.stale) body += row('Anúncios parados', `${s.stale} <small>(4 dias ou mais sem venda)</small>`);
    const note = s.sells === 'parado' ? '<p class="pbsc-note">Seus anúncios deste item não venderam: o Mark ganha a preferência.</p>'
      : s.sells === 'novo' ? '<p class="pbsc-note">Ainda sem venda sua deste item: o tempo para vender é estimativa.</p>' : '';
    const age = v.from === 'old' ? `<p class="pbsc-note">Menor preço guardado${v.oldAt ? ` de há ${span(Date.now() - v.oldAt)}` : ''}: use ⟳ Atualizar preços para conferir.</p>`
      : s.mk.at ? `<p class="pbsc-note">Preços do Mercado de há ${span(Date.now() - s.mk.at)}.</p>` : '';
    card.innerHTML = `<div class="pbsc-head"><b>${esc(name)}</b><span>para vender</span></div>${verdict}<dl>${body}</dl>${note}${age}`;
  }

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
    const tile = el.matches(SELL_TILES), l = tile ? null : listingOf(el);
    if (!tile && (!l || !mineIds.has(idOf(l)))) return hide();
    hoverEl = el;
    if (!card.isConnected) document.body.append(card);
    if (tile) renderTile(el); else render(l);
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
  // Itens que você pode anunciar: a lista que a tela do Mercado monta para o Anunciar (useMemo, existe em qualquer
  // aba): { key: "item:12" | "ball:3" | "diamonds:0", label, max (quantidade), cat (tipo do items.json), npc }.
  function sellables() {
    const el = win?.querySelector(TABS) || win;
    let best = null;
    for (let f = el && fiberOf(el), d = 0; f && d < 60; f = f.return, d++) {
      if (typeof f.type !== 'function') continue;
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = Array.isArray(h.memoizedState) && h.memoizedState.length === 2 ? h.memoizedState[0] : null;
        if (Array.isArray(v) && v.length && /^(item|ball|diamonds):/.test(v[0]?.key || '') && 'max' in v[0] && (!best || v.length > best.length)) best = v;
      }
      if (best) return best;
    }
    return null;
  }
  const marketCat = x => MARKET_CAT[x.key.split(':')[0]] || MARKET_CAT[x.cat] || 'Items';
  const neededCats = () => {
    const list = sellables();
    if (!list) return [...CATS];
    return CATS.filter(c => list.some(x => marketCat(x) === c));
  };
  const status = document.createElement('span');
  status.id = 'pb-price-status';
  const say = t => { if (status.textContent !== t) status.textContent = t; };
  let lastScan = 0, scanning = false, openedAt = 0;
  // A busca por categoria da própria tela (o useCallback do jogo que chama /api/game/market?category=…) e a categoria
  // que a tela usa agora (o useEffect que chama essa busca quando a categoria muda guarda as duas nas deps).
  function categoryFetcher() {
    const el = win?.querySelector(TABS) || win;
    for (let f = el && fiberOf(el), d = 0; f && d < 60; f = f.return, d++) {
      if (typeof f.type !== 'function') continue;
      let fn = null, cat;
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const m = h.memoizedState;
        if (!fn && Array.isArray(m) && typeof m[0] === 'function' && /market\?category=/.test(String(m[0]))) fn = m[0];
      }
      if (!fn) continue;
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const e = h.memoizedState;
        if (e && typeof e === 'object' && Array.isArray(e.deps) && e.deps.length === 2 && e.deps[0] === fn) { cat = e.deps[1]; break; }
      }
      return { fn, cat };
    }
    return null;
  }
  let lastWhy = '';
  const why = m => { if (m !== lastWhy) { lastWhy = m; diag(m); } };
  // reason 'open' | 'tick' (automática, com intervalo) ou 'manual' (Atualizar preços: na hora, com as categorias dadas,
  // o progresso em step e um pedido de parar em cancelled). Devolve { cats, fresh: {categoria: resposta nova}, aborted
  // (você trocou de categoria), stopped (cancelado), closed (o Mercado fechou) } ou null se nem começou.
  async function scanCategories(reason, { cats = neededCats(), step = () => {}, cancelled = () => false } = {}) {
    const wait = reason === 'open' ? SCAN_REOPEN_MS : SCAN_EVERY_MS;
    if (scanning || (reason !== 'manual' && Date.now() - lastScan < wait) || !win?.isConnected) return null;
    if (!cats.length) return null;
    const fx = categoryFetcher(), q = fx ? null : categoryQueue();
    if (!fx && !q) { why('não achei a busca por categoria da tela'); return null; }
    scanning = true;
    lastScan = Date.now();
    const original = fx ? fx.cat : q.lastRenderedState;
    const t0 = Date.now(), done = [], fresh = {};
    let aborted = false, stopped = false, mine = original, restoring = null;
    diag(`buscando ${cats.join(', ')} (${reason === 'manual' ? 'Atualizar preços, ' : ''}${fx ? 'função da tela' : 'estado da categoria'}, categoria atual: ${original ?? 'All'})`);
    try {
      for (const [n, c] of cats.entries()) {
        if (!win?.isConnected) break;
        if (cancelled()) { stopped = true; break; }
        const now = fx ? categoryFetcher()?.cat : q.lastRenderedState;
        if (now !== (fx ? original : mine)) { aborted = true; break; }  // você trocou de categoria: fica a sua escolha
        say(`Preços: buscando ${c} (${n + 1}/${cats.length})…`);
        step(n, cats.length, c);
        const key = `${API}?category=${c}`, since = Date.now(), end = since + SCAN_WAIT_MS;
        const isFresh = () => (window.__pbCache?.[key]?.at || 0) >= since;
        let pending = null;
        if (fx) pending = Promise.resolve().then(() => fx.fn(c)).catch(() => {});
        else { q.dispatch(c); mine = c; }
        while (Date.now() < end && !isFresh() && !cancelled()) await sleep(150);
        // A próxima busca só depois desta terminar: a tela fica com a lista da última que respondeu.
        if (pending) await Promise.race([pending, sleep(Math.max(0, end - Date.now()))]);
        if (isFresh()) fresh[c] = window.__pbCache[key];
        done.push(`${c} ${fresh[c] ? `ok (${fresh[c].data?.listings?.length ?? '?'} anúncios)` : 'sem resposta'}`);
        await sleep(SCAN_GAP_MS);
      }
    } finally {
      if (!aborted && win?.isConnected) {
        if (fx) restoring = Promise.resolve().then(() => fx.fn(original)).catch(() => {});  // a tela volta à lista da categoria dela
        else if (q.lastRenderedState === mine && mine !== original) q.dispatch(original);
      }
      scanning = false;
      lastScan = Date.now();
      say('');
      dirtyMarket();
      schedule();
      diag(`${aborted ? 'parado (você trocou de categoria)' : stopped ? 'cancelado' : 'pronto'} em ${((Date.now() - t0) / 1000).toFixed(1)} s: ${done.join(' · ') || 'nada'}`);
    }
    // A pedido, a tela só destrava com a lista da categoria dela de volta.
    if (reason === 'manual' && restoring) await Promise.race([restoring, sleep(SCAN_WAIT_MS)]);
    return { cats, fresh, aborted, stopped, closed: !win?.isConnected };
  }
  // Status no Anunciar, ao lado dos filtros: buscando, ou de quando são os preços.
  function mountStatus() {
    const fbar = win.querySelector('.mkt-sellform .mk-fbar');
    if (!fbar) { if (status.isConnected) status.remove(); return; }
    if (status.parentElement !== fbar) fbar.append(status);
    if (scanning) return;
    const ats = neededCats().map(c => window.__pbCache?.[`${API}?category=${c}`]?.at || 0);
    const oldest = ats.length && ats.every(Boolean) ? Math.min(...ats) : 0;
    const t = oldest ? `Preços de há ${span(Date.now() - oldest)}` : 'Preços: aguardando o Mercado';
    if (status.textContent !== t) status.textContent = t;
  }

  // ---------- Atualizar preços: Mercado ou Mark, item por item ----------
  // A pedido (botão no fim da barra de abas): busca de novo, pela própria tela, as categorias dos itens da mochila que
  // você pode anunciar (Pokémon, Pokébolas e Diamonds ficam de fora: o Mark não paga por eles), pega o menor preço em
  // dollars dos outros em cada item e compara com o que o Mark paga (npcPrice). O Mercado só ganha se render, já sem a
  // taxa, pelo menos MIN_PROFIT a mais que o Mark. Enquanto busca, uma camada por cima trava a tela (cliques e teclas)
  // e mostra o progresso; no fim, o resultado por item. Só consulta: não anuncia nem vende nada.
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.id = 'pb-price-refresh';
  refreshBtn.textContent = '⟳ Atualizar preços';
  refreshBtn.title = `Buscar agora o menor preço em dollars de cada item seu no Mercado e ver se compensa anunciar `
    + `(${pct(MIN_PROFIT)} ou mais sobre o Mark, já sem a taxa) ou vender para o Mark. Só consulta.`;
  refreshBtn.addEventListener('click', e => { e.stopPropagation(); refreshPrices(); });
  function mountRefresh() {
    const tabs = win.querySelector(TABS);
    if (!tabs) { if (refreshBtn.isConnected) refreshBtn.remove(); return; }
    if (tabs.lastElementChild !== refreshBtn) tabs.append(refreshBtn);
  }

  const lock = document.createElement('div');
  lock.id = 'pb-price-lock';
  lock.hidden = true;
  lock.setAttribute('role', 'dialog');
  lock.setAttribute('aria-modal', 'true');
  lock.setAttribute('aria-labelledby', 'pb-pl-title');
  lock.innerHTML = `<div class="pbpl-box"><div class="pbpl-head"><h2 id="pb-pl-title">Atualizar preços</h2>
    <button type="button" class="pbpl-x" data-act="close" aria-label="Fechar">×</button></div>
    <div class="pbpl-body"></div><div class="pbpl-foot"></div></div>`;
  const lockBody = lock.querySelector('.pbpl-body'), lockFoot = lock.querySelector('.pbpl-foot');
  let phase = '', cancelAsk = false, running = false, focusBack = null;
  // Nada passa da camada para o jogo: cliques e teclas param aqui (o jogo ouve no document).
  for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
    lock.addEventListener(ev, e => {
      e.stopPropagation();
      if (ev !== 'click') return;
      const act = e.target.closest?.('[data-act]')?.dataset.act;
      if (act === 'cancel' && phase === 'busy' && !cancelAsk) { cancelAsk = true; lockFoot.querySelector('button').textContent = 'Cancelando…'; }
      else if (act === 'close' && phase !== 'busy') closeLock();
      else if (act === 'again' && phase !== 'busy') refreshPrices();
    });
  }
  for (const ev of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(ev, e => {
      if (lock.hidden) return;
      e.stopImmediatePropagation();
      if (e.key === 'Escape') { e.preventDefault(); if (ev === 'keydown' && phase !== 'busy') closeLock(); return; }
      if (lock.contains(e.target)) return;                // dentro da camada, Tab, Enter e rolagem continuam
      e.preventDefault();
      if (ev === 'keydown' && e.key === 'Tab') lockFoot.querySelector('button')?.focus();  // o foco volta para a camada
    }, true);
  }
  function openLock() {
    hide();
    if (lock.hidden) focusBack = document.activeElement;
    if (lock.parentElement !== document.body) document.body.append(lock);
    lock.hidden = false;
  }
  function closeLock() {
    lock.hidden = true;
    phase = '';
    lockBody.innerHTML = lockFoot.innerHTML = '';
    (focusBack?.isConnected ? focusBack : refreshBtn.isConnected ? refreshBtn : null)?.focus?.();
  }
  function progress(n, total, msg) {
    const v = Math.round((n / total) * 100);
    if (phase !== 'busy') {
      phase = 'busy';
      lock.dataset.phase = 'busy';
      lockBody.innerHTML = `<p class="pbpl-msg" aria-live="polite"></p>
        <div class="pbpl-bar" role="progressbar" aria-label="Progresso da busca" aria-valuemin="0" aria-valuemax="100"><i></i></div>
        <p class="pbpl-note">A tela fica travada até terminar. Só consulta: nada é anunciado nem vendido.</p>`;
      lockFoot.innerHTML = '<button type="button" data-act="cancel">Cancelar</button>';
      lockFoot.querySelector('button').focus();
    }
    lockBody.querySelector('.pbpl-msg').textContent = msg;
    const bar = lockBody.querySelector('.pbpl-bar');
    bar.setAttribute('aria-valuenow', String(v));
    bar.firstElementChild.style.width = `${v}%`;
  }
  function finish(kind, html, foot) {
    phase = kind;
    lock.dataset.phase = kind;
    lockBody.innerHTML = html;
    lockFoot.innerHTML = foot;
    lockFoot.querySelector('button:last-child')?.focus();
  }
  const FOOT = '<button type="button" data-act="again">⟳ Buscar de novo</button><button type="button" class="pbpl-main" data-act="close">Fechar</button>';
  const fail = msg => finish('error', `<p class="pbpl-msg">${esc(msg)}</p>`, FOOT);

  // Menor preço em dollars dos outros, por item, só nas respostas novas desta busca (a lista geral pode ser mais velha
  // e trazer anúncio que já vendeu): pelo nome e, sem ele, pelo refId, dentro da categoria do item.
  function cheapestIn(fresh) {
    const best = new Map();
    const put = (k, x) => { const b = best.get(k); if (!b || x.price < b.price) best.set(k, x); };
    for (const [cat, hit] of Object.entries(fresh)) {
      const own = new Set((hit.data?.mine || []).flatMap(l => l.ids || [l.id]).filter(id => id != null));
      for (const x of hit.data?.listings || []) {
        if (!x?.name || x.kind === 'pokemon' || x.currency !== 'GOLD' || x.offerOnly || !(x.price > 0)) continue;
        const ids = (x.ids || [x.id]).filter(id => id != null);
        if ((ids.length && ids.every(id => own.has(id))) || mineIds.has(idOf(x))) continue;
        put(`${cat}|n:${norm(x.name)}`, x);
        if (x.refId != null) put(`${cat}|r:${x.refId}`, x);
      }
    }
    return best;
  }
  function compare(items, fresh) {
    const best = cheapestIn(fresh), P = window.__pbPrices;
    const rows = items.map(x => {
      const cat = marketCat(x), name = x.label, qty = Math.max(1, Number(x.max) || 1);
      const npc = Number(x.npc ?? P?.npc(name)) || 0;
      const icon = typeof x.icon === 'string' && /^(\/|https?:|data:image\/)/.test(x.icon) ? x.icon : '';
      if (!fresh[cat]) return { name, qty, npc, icon, markTotal: npc * qty, p: null, gain: 0, dest: npc > 0 ? 'mark' : 'none', why: `${cat} não respondeu` };
      const l = best.get(`${cat}|n:${norm(name)}`) || best.get(`${cat}|r:${x.key.split(':')[1]}`);
      return { name, icon, ...decide({ qty, npc, cheapest: l ? l.price : null, sells: suggest(name, qty).sells }) };
    });
    const order = { market: 0, mark: 1, none: 2 };
    return rows.sort((a, b) => order[a.dest] - order[b.dest] || b.gain - a.gain || b.markTotal - a.markTotal || a.name.localeCompare(b.name));
  }
  function report(rows, r, ms) {
    const mkt = rows.filter(x => x.dest === 'market'), mark = rows.filter(x => x.dest === 'mark');
    const gain = mkt.reduce((t, x) => t + x.gain, 0), markSum = mark.reduce((t, x) => t + x.markTotal, 0);
    const fee = `${Math.round((window.__pbPrices?.FEE ?? 0.03) * 100)}%`, missed = r.cats.filter(c => !r.fresh[c]);
    const dest = { market: 'Mercado', mark: 'Mark', none: '—' };
    const row = x => `<tr data-dest="${x.dest}">
      <th scope="row">${x.icon ? `<img src="${esc(x.icon)}" alt="">` : ''}${esc(x.name)}</th>
      <td>${fmt(x.qty)}</td>
      <td>${x.npc > 0 ? `💲${fmt(x.npc)}` : '<small>não compra</small>'}</td>
      <td>${x.p != null ? `💲${fmt(x.p)}<small>líquido 💲${fmt(Math.floor(x.net))}</small>` : '—'}</td>
      <td><span class="pbpl-dest">${dest[x.dest]}</span></td>
      <td>${x.dest === 'market' ? `💲${fmt(x.netTotal)}` : x.dest === 'mark' ? `💲${fmt(x.markTotal)}` : '—'}</td>
      <td>${x.dest === 'market' ? `<b>+💲${fmt(x.gain)}</b><small>${x.ratio != null ? `${pct(x.ratio)} sobre o Mark` : 'o Mark não compra'}</small>` : `<small>${esc(x.why)}</small>`}</td>
    </tr>`;
    const sum = (mkt.length
      ? `<b>${mkt.length}</b> de ${rows.length} itens rendem ${pct(MIN_PROFIT)} ou mais no Mercado: <b class="good">+💲${fmt(gain)}</b> sobre vender para o Mark.`
      : `Nenhum dos ${rows.length} itens rende ${pct(MIN_PROFIT)} ou mais no Mercado.`)
      + (mark.length ? ` ${mark.length} para o Mark (💲${fmt(markSum)}).` : '');
    finish('done', `<p class="pbpl-sum">${sum}</p>
      <div class="pbpl-table" tabindex="0"><table>
        <thead><tr><th scope="col">Item</th><th scope="col">Qtd</th><th scope="col">Mark/un</th><th scope="col">Mercado/un</th>
          <th scope="col">Vender no</th><th scope="col">Recebe</th><th scope="col">vs Mark</th></tr></thead>
        <tbody>${rows.map(row).join('')}</tbody></table></div>
      <p class="pbpl-note">Menor preço em dollars dos outros jogadores agora (${esc(r.cats.join(', '))}, em ${(ms / 1000).toFixed(1)} s); líquido = menos a taxa de ${fee} do Mercado.
        O Mercado só vale com ${pct(MIN_PROFIT)} ou mais sobre o Mark.${missed.length ? ` <b>Sem resposta: ${esc(missed.join(', '))}.</b>` : ''} Só consulta: nada foi anunciado nem vendido.</p>`, FOOT);
  }
  async function refreshPrices() {
    if (running || !win?.isConnected) return;
    running = true;
    cancelAsk = false;
    phase = '';
    openLock();
    try {
      const all = sellables(), items = (all || []).filter(x => /^item:/.test(x.key || ''));
      if (!items.length) return fail(all ? 'Você não tem itens da mochila para anunciar.' : 'Não achei a lista dos seus itens na tela do Mercado. Abra o Anunciar uma vez e tente de novo.');
      const cats = CATS.filter(c => items.some(x => marketCat(x) === c)), total = cats.length + 1, t0 = Date.now();
      progress(0, total, 'Começando…');
      for (const end = Date.now() + 4 * SCAN_WAIT_MS; scanning && Date.now() < end && !cancelAsk;) {
        progress(0, total, 'Esperando a busca automática terminar…');
        await sleep(200);
      }
      if (cancelAsk) return closeLock();
      const r = await scanCategories('manual', { cats, step: (n, m, c) => progress(n + 0.5, total, `Buscando ${c} no Mercado (${n + 1}/${m})…`), cancelled: () => cancelAsk });
      if (!r) return fail(scanning ? 'Outra busca de preços ainda está rodando. Tente de novo em instantes.' : 'Não achei a busca por categoria da tela do Mercado.');
      if (r.stopped) return closeLock();
      if (r.closed) return fail('O Mercado fechou no meio da busca.');
      if (r.aborted) return fail('A categoria do Mercado mudou no meio da busca. Tente de novo.');
      if (!Object.keys(r.fresh).length) return fail(`O Mercado não respondeu (${cats.join(', ')}). Tente de novo.`);
      progress(total - 0.5, total, 'Comparando com o Mark…');
      const rows = compare(items, r.fresh);
      diag(`Atualizar preços: ${rows.length} itens, ${rows.filter(x => x.dest === 'market').length} no Mercado, ${rows.filter(x => x.dest === 'mark').length} no Mark`);
      report(rows, r, Date.now() - t0);
    } catch (err) {
      fail(`Algo deu errado na busca: ${err?.message || err}`);
    } finally {
      running = false;
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
          const el = e.target.closest?.(`${ITEMS}, ${SELL_TILES}`);
          const ok = el && win.contains(el) && (el.hasAttribute('data-pb-sale') || el.hasAttribute('data-pb-sug'));
          if (ok && el !== hoverEl) show(el);
          else if (!ok && hoverEl) hide();
        });
        win.addEventListener('pointerleave', hide);
        win.addEventListener('scroll', hide, true);
        schedule();
        openedAt = Date.now();
      }
    }
    // Ao abrir: assim que a tela tiver a lista dos seus itens (até ~5 s); depois, a cada 10 min.
    if (win) scanCategories(Date.now() - openedAt < 5000 ? 'open' : 'tick');
  }, CHECK_MS);
})();
