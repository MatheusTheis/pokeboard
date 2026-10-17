// Histórico de preços do Mercado: cada vez que o jogo carrega a lista do Mercado (ao abrir, trocar de categoria,
// depois de comprar), guardamos o anúncio mais barato de cada item, por moeda. Ao lado do preço de cada anúncio, uma
// seta diz se ele está em baixa ou em alta comparado com as outras vezes que você abriu o Mercado; passando o mouse,
// um card mostra a última vez, o preço típico, a faixa e o gráfico. Pensado nas pedras de evolução do Breeding
// (Water Stone, Fire Stone…), vale para qualquer item; Pokémon ficam de fora (cada um é diferente).
// Só lê as respostas que o próprio jogo pediu. O histórico fica no main (historico-mercado.json), um só para todas as
// contas: daqui vão as observações (pb:mkt-obs, pelo preload) e de lá volta o histórico (window.__pbMarketHistory).
(() => {
  if (window.__pbMarketHist) return;
  window.__pbMarketHist = true;

  // Seletores do jogo (Mercado Global; os mesmos do market-plus.js). Ajuste aqui quando o jogo atualizar.
  const API = '/api/game/market';  // categoria All; as outras são ?category=…
  const WIN = '.mkt2-window';
  const ITEMS = '.mkt2-grid > .mkt2-card, .mkt2-rows .mkt2-row, .mkt2-rows .mkt2-trow:not(.mkt2-trow--head)';
  const PRICE = '.mkt2-price';
  const TAB_LABEL = '.mkt2-tab.on .mkt2-tab-label';  // no Histórico de vendas não comparamos nada
  const SESSION_MS = 20 * 60e3;  // observações mais novas que isso são desta visita: não contam como "antes"
  const TYPICAL_DAYS = 14;       // preço típico: mediana dos menores preços de cada dia
  const RANGE_DAYS = 30;         // faixa e gráfico
  const LOW = 0.93, HIGH = 1.07; // abaixo/acima disso do típico: em baixa / em alta
  const CHECK_MS = 1000;
  const DAY = 864e5;
  const CURS = { GOLD: 'Dollars', DIAMONDS: 'Diamonds' };

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.round(n).toLocaleString('pt-BR');
  const keyOf = l => `${norm(l.name)}|${l.currency === 'DIAMONDS' ? 'DIAMONDS' : 'GOLD'}`;
  const tracked = l => l && l.kind !== 'pokemon' && !l.offerOnly && l.price > 0 && l.name && (l.currency === 'GOLD' || l.currency === 'DIAMONDS');
  const setAttr = (el, k, v) => { if (v == null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== v) el.setAttribute(k, v); };

  // ---------- observações: o mais barato de cada item nesta resposta ----------
  const nowBest = new Map();  // chave -> menor preço na última resposta que trouxe o item
  function observe(hit) {
    const list = hit?.data?.listings;
    if (!Array.isArray(list)) return;
    const mine = new Set((hit.data.mine || window.__pbCache?.[API]?.data?.mine || []).flatMap(l => l.ids || [l.id]));
    const best = new Map();
    for (const l of list) {
      if (!tracked(l) || (l.ids || [l.id]).every(id => mine.has(id))) continue;  // os seus anúncios não contam
      const k = keyOf(l), b = best.get(k);
      if (!b || l.price < b[3]) best.set(k, [k, String(l.name).slice(0, 80), String(l.category || '').slice(0, 80), l.price, Number(l.quantity) || 0]);
    }
    if (!best.size) return;
    for (const [k, r] of best) nowBest.set(k, r[3]);
    const root = document.documentElement;
    root.dataset.pbMktObs = JSON.stringify([...best.values()]);
    window.dispatchEvent(new Event('pb:mkt-obs'));  // o preload lê na hora (o evento é síncrono)
    delete root.dataset.pbMktObs;
  }
  window.addEventListener('pb:data', e => {
    const k = e.detail?.path;
    if (k === API || k?.startsWith(`${API}?category=`)) observe(window.__pbCache?.[k]);
  });

  // ---------- histórico (do main) e as contas em cima dele ----------
  let hist = null;  // { v, items: { chave: { n, c, o: [[minuto, preço, quantidade], …] } } }
  let statsCache = new Map();
  window.__pbMarketHistory = h => {
    if (!h || typeof h !== 'object' || !h.items) return;
    hist = h;
    statsCache = new Map();
    schedule();
  };
  window.dispatchEvent(new Event('pb:mkt-hist-want'));

  const dayOf = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  let statsAt = 0;
  function stats(key, now) {
    if (now - statsAt > 60e3) { statsCache = new Map(); statsAt = now; }  // "desta visita" anda com o relógio
    if (statsCache.has(key)) return statsCache.get(key);
    const o = hist?.items?.[key]?.o;
    let s = null;
    if (Array.isArray(o) && o.length) {
      const prior = o.filter(r => r[0] * 60e3 < now - SESSION_MS);
      const latest = o[o.length - 1];
      s = { first: o[0][0] * 60e3, n: o.length, prior: prior.length, cheapest: latest[0] * 60e3 >= now - SESSION_MS ? latest[1] : null };
      if (prior.length) {
        const days = new Map();
        for (const [t, p] of prior) {
          const d = dayOf(t * 60e3);
          if (now - d <= RANGE_DAYS * DAY) days.set(d, Math.min(days.get(d) ?? Infinity, p));
        }
        const daily = [...days].sort((a, b) => a[0] - b[0]);
        const recent = daily.filter(([d]) => now - d <= TYPICAL_DAYS * DAY).map(([, p]) => p);
        const last = prior[prior.length - 1], ps = daily.map(([, p]) => p);
        Object.assign(s, {
          last: { t: last[0] * 60e3, p: last[1] },
          daily,
          typical: recent.length >= 2 ? median(recent) : null,
          base: recent.length >= 2 ? median(recent) : last[1],  // pouco histórico: compara com a última vez
          baseKind: recent.length >= 2 ? 'typical' : 'last',
          min: ps.length ? Math.min(...ps) : null,
          max: ps.length ? Math.max(...ps) : null,
        });
      }
    }
    statsCache.set(key, s);
    return s;
  }
  function trend(price, s) {
    if (!s?.prior || !(s.base > 0)) return null;
    const r = price / s.base, pct = Math.round((r - 1) * 100);
    const kind = r <= LOW ? 'low' : r >= HIGH ? 'high' : 'flat';
    return { kind, pct, txt: kind === 'flat' ? '≈' : `${pct < 0 ? '▼' : '▲'} ${Math.abs(pct)}%` };
  }

  // ---------- anúncios na tela ----------
  const fiberOf = el => { const k = Object.keys(el).find(x => x.startsWith('__reactFiber$')); return k ? el[k] : null; };
  // Os cards e linhas do Mercado recebem o anúncio na prop "l".
  function listingOf(el) {
    for (let f = fiberOf(el), d = 0; f && d < 8; f = f.return, d++) {
      const l = f.memoizedProps?.l;
      if (l && typeof l === 'object' && 'price' in l && 'name' in l) return l;
    }
    return null;
  }
  let win = null, mo = null, pending = 0;
  const isHistory = () => /hist/i.test(win?.querySelector(TAB_LABEL)?.textContent || '');
  function apply() {
    pending = 0;
    if (!win?.isConnected) return;
    const now = Date.now(), off = isHistory();
    for (const el of win.querySelectorAll(ITEMS)) {
      const price = el.querySelector(PRICE), l = off ? null : listingOf(el);
      const t = price && tracked(l) ? trend(l.price, stats(keyOf(l), now)) : null;
      if (price) { setAttr(price, 'data-pb-trend', t?.kind ?? null); setAttr(price, 'data-pb-trend-txt', t?.txt ?? null); }
    }
    if (hoverEl && !hoverEl.isConnected) hide();
  }
  const schedule = () => { if (!pending) pending = setTimeout(apply, 150); };

  // ---------- card ao passar o mouse ----------
  const card = document.createElement('div');
  card.id = 'pb-mh';
  card.hidden = true;
  card.setAttribute('role', 'tooltip');
  let hoverEl = null;
  const when = t => {
    const d = new Date(t), hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const days = Math.round((dayOf(Date.now()) - dayOf(t)) / DAY);
    return days === 0 ? `hoje ${hm}` : days === 1 ? `ontem ${hm}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hm}`;
  };
  const pctTxt = (a, b) => { const p = Math.round((a / b - 1) * 100); return p === 0 ? '=' : `${p < 0 ? '▼' : '▲'} ${Math.abs(p)}%`; };
  // Gráfico dos menores preços de cada dia (30 dias) e o ponto de agora; linha tracejada no preço de comparação.
  function spark(s, nowPrice, kind) {
    const W = 264, H = 52, P = 5;
    const now = Date.now(), pts = s.daily.map(([d, p]) => [d + DAY / 2, p]).concat([[now, nowPrice]]);
    const t0 = Math.min(pts[0][0], now - DAY), vals = pts.map(([, p]) => p).concat(s.base);
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const x = t => P + (W - 2 * P) * ((t - t0) / (now - t0 || 1));
    const y = p => (hi === lo ? H / 2 : H - P - (H - 2 * P) * ((p - lo) / span));
    const line = pts.map(([t, p]) => `${x(t).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
    const dots = pts.slice(0, -1).map(([t, p]) => `<rect x="${(x(t) - 2).toFixed(1)}" y="${(y(p) - 2).toFixed(1)}" width="4" height="4"/>`).join('');
    const [ct, cp] = pts[pts.length - 1];
    return `<svg class="pbmh-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">`
      + `<line class="pbmh-base" x1="${P}" x2="${W - P}" y1="${y(s.base).toFixed(1)}" y2="${y(s.base).toFixed(1)}"/>`
      + `<polyline points="${line}"/><g class="pbmh-dots">${dots}</g>`
      + `<rect class="pbmh-now ${kind}" x="${(x(ct) - 3).toFixed(1)}" y="${(y(cp) - 3).toFixed(1)}" width="6" height="6"/></svg>`;
  }
  function render(l) {
    const s = stats(keyOf(l), Date.now()), t = trend(l.price, s), cur = CURS[l.currency] || '';
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    let body = row('Este anúncio', fmt(l.price));
    let verdict;
    if (!s?.prior || !t) {
      verdict = `<p class="pbmh-verdict">Primeira vez que guardamos este item: o histórico começa agora.</p>`;
    } else {
      const label = { low: 'Em baixa', high: 'Em alta', flat: 'Preço normal' }[t.kind];
      const ref = s.baseKind === 'typical' ? 'do típico' : 'da última vez';
      verdict = `<p class="pbmh-verdict ${t.kind}">${label}${t.kind === 'flat' ? '' : ` · ${Math.abs(t.pct)}% ${t.pct < 0 ? 'abaixo' : 'acima'} ${ref}`}</p>`;
      if (s.cheapest && s.cheapest < l.price) body += row('Mais barato agora', fmt(s.cheapest));
      body += row(`Última vez · ${when(s.last.t)}`, `${fmt(s.last.p)} <small>${pctTxt(l.price, s.last.p)}</small>`);
      if (s.typical != null) body += row(`Típico ${TYPICAL_DAYS} dias`, fmt(s.typical));
      if (s.min != null) body += row(`Mínimas ${RANGE_DAYS} dias`, s.min === s.max ? fmt(s.min) : `${fmt(s.min)} – ${fmt(s.max)}`);
    }
    const graph = s?.prior ? spark(s, s.cheapest ?? l.price, t.kind) : '';
    const since = s ? `Registrado desde ${new Date(s.first).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${s.n} ${s.n === 1 ? 'vez' : 'vezes'}` : '';
    card.innerHTML = `<div class="pbmh-head"><b>${esc(l.name)}</b><span>${esc(cur)}</span></div>${verdict}${graph}<dl>${body}</dl>`
      + (since ? `<p class="pbmh-foot">${since}</p>` : '');
  }
  function place(el) {
    const r = el.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight, gap = 8;
    let left = r.right + gap;
    if (left + cw > innerWidth - 4) left = r.left - gap - cw;
    left = Math.max(4, Math.min(left, innerWidth - cw - 4));
    const top = Math.max(4, Math.min(r.top, innerHeight - ch - 4));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }
  function show(el) {
    const l = listingOf(el);
    if (!tracked(l) || isHistory()) return hide();
    hoverEl = el;
    if (!card.isConnected) document.body.append(card);
    render(l);
    card.hidden = false;
    place(el);
  }
  function hide() { hoverEl = null; card.hidden = true; }

  // ---------- acompanhar a janela do Mercado ----------
  setInterval(() => {
    const w = document.querySelector(WIN);
    if (w === win) return;
    mo?.disconnect();
    hide();
    win = w;
    if (!win) return;
    mo = new MutationObserver(schedule);
    mo.observe(win, { childList: true, subtree: true });
    win.addEventListener('pointerover', e => {
      const el = e.target.closest?.(ITEMS);
      if (el && el !== hoverEl && win.contains(el)) show(el);
      else if (!el && hoverEl) hide();
    });
    win.addEventListener('pointerleave', hide);
    win.addEventListener('scroll', hide, true);
    apply();
  }, CHECK_MS);
})();
