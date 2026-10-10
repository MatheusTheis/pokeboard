// Roda em cada painel do jogo antes dos scripts da página.
// Injeta no contexto da página: (1) o hook que observa os dados que o próprio jogo já carrega
// e (2) a Pokédex+. Nenhum dos dois clica em nada nem envia ações ao jogo.
const { ipcRenderer, webFrame } = require('electron');

const GAME_ORIGIN = 'https://poke.idleworld.online';
const TOKEN_KEY = 'pokeweb:tokens';  // onde o jogo guarda o login (sessionStorage); só para o log

// Login salvo: o jogo guarda a sessão só no sessionStorage, que some ao fechar o app.
// Como o "restaurar abas" do Chrome, o main guarda uma cópia criptografada do sessionStorage
// inteiro de cada conta, e ela volta antes do jogo iniciar. Os valores são copiados como estão.
if (location.origin === GAME_ORIGIN) {
  const keys = st => { const out = []; for (let k = 0; k < st.length; k++) out.push(st.key(k)); return out.sort(); };
  const snapshot = () => JSON.stringify(Object.fromEntries(keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)])));
  // Diagnóstico (só aparece com PB_DEBUG): nomes das chaves, nunca os valores.
  const trace = when => ipcRenderer.send('pb:login-trace', `${when} ${location.pathname} · session=[${keys(sessionStorage)}] local=[${keys(localStorage)}]`);
  let last = '';
  try {
    trace('início');
    if (!sessionStorage.length) {  // aba nova: nada do jogo ainda nesta sessão
      const saved = ipcRenderer.sendSync('pb:login-get');
      if (saved) {
        for (const [k, v] of Object.entries(JSON.parse(saved))) sessionStorage.setItem(k, v);
        trace('restaurado');
      }
    }
    last = snapshot();
  } catch (e) { ipcRenderer.send('pb:login-trace', `erro ao restaurar: ${e.message}`); }
  // Espelha qualquer mudança (login, renovação do token, logout).
  const sync = () => {
    try {
      const v = snapshot();
      if (v !== last) { last = v; ipcRenderer.send('pb:login-save', v, !!sessionStorage.getItem(TOKEN_KEY)); }
    } catch {}
  };
  setInterval(sync, 3000);
  window.addEventListener('pagehide', () => { sync(); trace('saindo'); });
  document.addEventListener('visibilitychange', sync);
}

// Preferências dos botões nossos no jogo (ex.: HUD minimalista) viram atributos no <html>, que o CSS lê.
// O <html> pode ainda não existir quando o preload roda: aplica de novo quando a página começar.
let prefs = {};
// Também deixa todas no <html> em JSON (data-pb-prefs), para os scripts do mundo da página lerem.
// Layout do board (grid | focus) também: data-pb-layout no <html>.
let layoutMode = 'grid';
const applyPrefs = () => {
  const r = document.documentElement;
  if (!r) return;
  r.toggleAttribute('data-pb-hud-min', !!prefs.hudMin);
  r.dataset.pbPrefs = JSON.stringify(prefs);
  r.dataset.pbLayout = layoutMode;
};
try { prefs = ipcRenderer.sendSync('pb:get-prefs') || {}; layoutMode = ipcRenderer.sendSync('pb:get-layout-mode') || 'grid'; } catch {}
applyPrefs();
document.addEventListener('readystatechange', applyPrefs);
ipcRenderer.on('pb:prefs', (_, p) => { prefs = p || {}; applyPrefs(); });
ipcRenderer.on('pb:layout-mode', (_, m) => { layoutMode = m === 'focus' ? 'focus' : 'grid'; applyPrefs(); });
// Um botão nosso (mundo da página) salva assim: {key, value} no <html> + evento.
window.addEventListener('pb:pref-save', () => {
  try {
    const { key, value } = JSON.parse(document.documentElement.dataset.pbPrefSave || '{}');
    ipcRenderer.send('pb:set-pref', key, value);
  } catch {}
});

// Rota de treino: o board pede a janela (route.js, no mundo da página) pelo <html> + evento; o botão do PIW Tools
// dela volta por aqui para o main, que abre o site.
ipcRenderer.on('pb:route-open', (_, q) => {
  document.documentElement.dataset.pbRoute = JSON.stringify(q || {});
  window.dispatchEvent(new Event('pb:route-open'));
});
ipcRenderer.on('pb:afk-render', (_, on) => {
  document.documentElement.toggleAttribute('data-pb-afk', !!on);
  window.dispatchEvent(new Event(on ? 'pb:afk-lock' : 'pb:afk-unlock'));
});
ipcRenderer.on('pb:afk-on', (_, q) => {
  document.documentElement.dataset.pbAfkRoute = JSON.stringify(q || {});
  window.dispatchEvent(new Event('pb:afk-on'));
});
ipcRenderer.on('pb:afk-off', () => window.dispatchEvent(new Event('pb:afk-off')));
ipcRenderer.on('pb:afk-pause', () => window.dispatchEvent(new Event('pb:afk-pause')));
window.addEventListener('pb:afk-start', () => {
  try { ipcRenderer.send('pb:afk-start', JSON.parse(document.documentElement.dataset.pbAfkStart || '{}')); } catch {}
});
window.addEventListener('pb:afk-status', () => ipcRenderer.send('pb:afk-status', document.documentElement.dataset.pbAfkStatus || ''));
window.addEventListener('pb:afk-done', () => ipcRenderer.send('pb:afk-done', document.documentElement.dataset.pbAfkDone || ''));
window.addEventListener('pb:route-piw', () => {
  try { ipcRenderer.send('pb:open-route', JSON.parse(document.documentElement.dataset.pbRoutePiw || '{}')); } catch {}
});

// Ordem da barra de telas: o editor (dock-editor.js, no mundo da página) deixa a lista no <html>
// e dispara o evento; daqui ela vai para o main, que salva no board.json e aplica em todas as contas.
window.addEventListener('pb:dock-order-save', () => {
  try { ipcRenderer.send('pb:set-dock-order', JSON.parse(document.documentElement.dataset.pbDockOrder || '[]')); } catch {}
});

// Antes dos scripts do jogo: o hook (observa os dados) e o limitador de quadros da Economia.
for (const name of ['hook', 'fps']) {
  const src = ipcRenderer.sendSync('pb:inject-source', name);
  if (src) webFrame.executeJavaScript(src).catch(e => console.error(`[PokeBoard] ${name}`, e));
}

window.addEventListener('DOMContentLoaded', () => {
  for (const name of ['card', 'layout', 'market', 'dock', 'hud', 'clog', 'map', 'pokedex', 'route', 'prestige', 'chat', 'activity']) {
    const src = ipcRenderer.sendSync('pb:inject-source', name);
    if (src) webFrame.executeJavaScript(src).catch(e => console.error(`[PokeBoard] ${name}`, e));
  }
});
