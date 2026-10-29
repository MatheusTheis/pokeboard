// Log do Mercado, sempre ligado: cada resposta do Mercado que o jogo carrega (anúncios de cada categoria, páginas de
// Pokémon, espécies, ações e recusas) vira uma linha em debug\mercado\AAAA-MM-DD.jsonl.gz, gravada pelo main. Serve
// para estudar preços, giro (quando um anúncio some: vendeu ou foi retirado) e tempo de venda, e melhorar o
// precificador. Resumido: item ou espécie, preço, moeda, quantidade, vendedores, IV/qualidade/nível dos Pokémon,
// quando foi anunciado e uma marca curta de cada anúncio (hash do id, para acompanhar entre buscas); pedidos de
// compra, seu histórico e seus anúncios. Sem nomes nem IDs de jogadores. A mesma resposta (mesmo conteúdo) em menos
// de 10 min não é gravada de novo. Vai para o preload por postMessage (as listas passam de 1 MB).
(() => {
  if (window.__pbMarketLog) return;
  window.__pbMarketLog = true;

  const API = '/api/game/market';
  const SAME_MS = 10 * 60e3;
  const PRIVATE = /^(id|ids|_id|uuid|listingIds?|charIds?|characterIds?)$|seller|buyer|owner|user|player|account|nick|trainer|email|token|password|session|guild|clan/i;

  // FNV-1a 32 bits em base 36: marca curta e estável para o id do anúncio (e para comparar respostas).
  const h32 = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const cur = c => (c === 'DIAMONDS' ? 'D' : 'G');
  const kind = k => (k === 'pokemon' ? 'p' : k === 'ball' ? 'b' : k === 'diamonds' ? 'd' : 'i');
  function listing(l) {
    const o = { k: kind(l.kind), n: l.name, p: l.price, c: cur(l.currency), q: l.quantity, s: l.sellers, at: l.at, h: h32(String(l.id ?? `${l.name}|${l.price}|${l.at}`)) };
    if (l.refId) o.r = l.refId;
    if (l.category) o.cat = l.category;
    if (l.offerOnly) o.o = 1;
    if (l.belowNpc) o.bn = 1;
    if (l.kind === 'pokemon') { o.sp = l.speciesId; o.iv = l.ivTotal; o.ql = l.quality; o.lv = l.level; if (l.shiny) o.sh = 1; }
    return o;
  }
  // Ações e recusas: o objeto como veio, sem chaves de jogador nem ids (pequeno).
  function clean(v, d = 0) {
    if (Array.isArray(v)) return v.slice(0, 200).map(x => clean(x, d + 1));
    if (v && typeof v === 'object') {
      if (d > 5) return '…';
      const out = {};
      for (const [k, x] of Object.entries(v)) if (k === 'sellers' || !PRIVATE.test(k)) out[k] = clean(x, d + 1);
      return out;
    }
    return typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
  }

  const last = new Map();  // chave -> { sig, at }
  function record(key, hit) {
    const d = hit?.data;
    if (!d || typeof d !== 'object') return;
    const out = { chave: key };
    if (Array.isArray(d.listings)) out.listings = d.listings.filter(Boolean).map(listing);
    if (Array.isArray(d.requests)) out.requests = d.requests.filter(Boolean).map(r => ({ k: kind(r.kind), n: r.name, r: r.refId, p: r.price, a: r.amount, at: r.at }));
    if (Array.isArray(d.history)) out.history = d.history.filter(Boolean).map(h => ({ b: h.bought ? 1 : 0, n: h.name, a: h.amount, p: h.price, c: cur(h.currency), o: h.offer ? 1 : 0, at: h.at }));
    if (Array.isArray(d.mine)) out.mine = d.mine.filter(Boolean).map(listing);
    if (Array.isArray(d.species)) out.species = d.species.filter(Boolean).map(s => ({ n: s.name, sp: s.speciesId ?? s.id, min: s.minGold, t: s.total }));
    if (d.pkWindow) out.pkWindow = { cap: d.pkWindow.cap, more: !!d.pkWindow.more };
    if (d.total != null) out.total = d.total;
    if (d.pages != null) out.pages = d.pages;
    const action = key.includes('/action') || key.endsWith('#erro');
    if (action) out.resp = clean(d);
    if (hit.req !== undefined) out.req = clean(hit.req);
    if (Object.keys(out).length === 1) return;
    const body = JSON.stringify(out), sig = h32(body), prev = last.get(key);
    if (!action && prev && prev.sig === sig && Date.now() - prev.at < SAME_MS) return;
    last.set(key, { sig, at: Date.now() });
    window.postMessage({ __pbMarketLog: body }, location.origin);
  }
  window.addEventListener('pb:data', e => {
    const k = e.detail?.path;
    if (typeof k === 'string' && k.startsWith(API)) record(k, window.__pbCache?.[k]);
  });
})();
