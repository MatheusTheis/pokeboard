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
  const store = (url, data) => {
    try {
      if (!watched(url)) return;
      const p = new URL(url, location.href).pathname;
      cache[p] = { data, at: Date.now() };
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
      if (res.ok && isJson && watched(url)) res.clone().json().then(d => store(url, d)).catch(() => {});
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
