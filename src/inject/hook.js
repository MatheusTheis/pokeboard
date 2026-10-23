// Observa (só leitura) as respostas JSON que o jogo já busca, para a Pokédex+ e o gravador reaproveitarem.
// Necessário porque a API exige um token que o jogo envia no cabeçalho: assim não precisamos dele.
(() => {
  if (window.__pbHook) return;
  window.__pbHook = true;
  const cache = (window.__pbCache = window.__pbCache || {});
  // Qualquer JSON do próprio site do jogo, menos /api/auth (as respostas trazem os tokens de login).
  const watched = url => {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin && !u.pathname.startsWith('/api/auth/');
    } catch { return false; }
  };
  // Mesma rota, conteúdos diferentes: no Mercado, as buscas da aba Pokémon (?browse=species|pokemon) e as categorias
  // (?category=…, menos All) ganham chave própria, para não apagarem a lista principal (/api/game/market).
  const keyOf = u => {
    const b = u.searchParams.get('browse'), c = u.searchParams.get('category');
    return b ? `${u.pathname}?browse=${b}` : c && c !== 'All' ? `${u.pathname}?category=${c}` : u.pathname;
  };
  // Ações do Mercado (anunciar, comprar, cancelar): guardamos também o que o jogo enviou (req), para o gravador
  // (PB_RECORD) entender preço, quantidade e taxa; e, se o servidor recusar, a resposta de erro numa chave à parte
  // ("…#erro", que nenhum extra lê). Só do Mercado; os outros pedidos continuam só com a resposta.
  const reqOf = (url, init) => {
    try {
      if (!/^\/api\/game\/market/.test(new URL(url, location.href).pathname) || typeof init?.body !== 'string') return undefined;
      return JSON.parse(init.body);
    } catch { return undefined; }
  };
  const store = (url, data, req, suffix = '') => {
    try {
      if (!watched(url)) return;
      const p = keyOf(new URL(url, location.href)) + suffix;
      cache[p] = req === undefined ? { data, at: Date.now() } : { data, req, at: Date.now() };
      window.dispatchEvent(new CustomEvent('pb:data', { detail: { path: p } }));
    } catch {}
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = res.url || (args[0] && args[0].url) || String(args[0]);
      // Só JSON: clonar um stream (SSE etc.) guardaria tudo em memória para sempre.
      const isJson = /json/i.test(res.headers.get('content-type') || '');
      const req = reqOf(url, args[1]);
      if (res.ok && isJson && watched(url)) res.clone().json().then(d => store(url, d, req)).catch(() => {});
      else if (!res.ok && isJson && req !== undefined) res.clone().json().then(d => store(url, { status: res.status, ...d }, req, '#erro')).catch(() => {});
    } catch {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__pbUrl = url;
    if (watched(String(url))) {
      this.addEventListener('load', () => {
        if (this.status < 200 || this.status >= 300) return;
        if (!/json/i.test(this.getResponseHeader('content-type') || '')) return;  // sprites e outros binários
        try {
          const d = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          store(this.responseURL || this.__pbUrl, d);
        } catch {}
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };
})();
