// Roda em cada painel do jogo antes dos scripts da página.
// Injeta no contexto da página: (1) o hook que observa os dados que o próprio jogo já carrega
// e (2) a Pokédex+. Nenhum dos dois clica em nada nem envia ações ao jogo.
const { ipcRenderer, webFrame } = require('electron');

// Origem do jogo (o main informa; com PB_GAME_URL é a do jogo falso dos testes). Main antigo, sem o canal: o jogo.
const GAME_ORIGIN = (() => { try { return ipcRenderer.sendSync('pb:game-origin') || 'https://poke.idleworld.online'; } catch { return 'https://poke.idleworld.online'; } })();
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
  let restoredNow = false;  // esta página começou com a sessão salva (ver a recuperação mais abaixo)
  try {
    trace('início');
    if (!sessionStorage.length) {  // aba nova: nada do jogo ainda nesta sessão
      const saved = ipcRenderer.sendSync('pb:login-get');
      if (saved) {
        for (const [k, v] of Object.entries(JSON.parse(saved))) sessionStorage.setItem(k, v);
        restoredNow = true;
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

  // Sessão vencida ou que o jogo não aceita mais. Dois casos, nos primeiros minutos da página e fora do jogo (sem a
  // barra de telas):
  //   - o servidor diz "Sessão inválida ou expirada" e o jogo fica parado nessa tela, sem o login;
  //   - a página começou com a sessão salva e ficou em branco (ou com o "Application error" do Next.js) por 30 s:
  //     uma cópia antiga, de antes de o jogo mudar o login, que o jogo novo não consegue abrir.
  // Nos dois, o main apaga a cópia salva desta conta (pb:login-expired) e aqui limpamos a sessão da aba e
  // recarregamos: o jogo abre o login.
  const EXPIRED = /sess[aã]o inv[aá]lida ou expirada|invalid or expired session|sesi[oó]n inv[aá]lida o expirada/i;
  const CRASHED = /application error|client-side exception/i;
  const BLANK_CHECKS = 15;  // 15 × 2 s: folga para um jogo lento abrir
  let expiredChecks = 0;
  const expiredTimer = setInterval(() => {
    if (++expiredChecks > 90 || document.querySelector('.game-dock')) { clearInterval(expiredTimer); return; }  // 3 min, ou já no jogo
    // Só o que é do jogo: os elementos nossos na página (id/classe "pb…", como o botão da Pokédex+) não contam.
    const game = [...(document.body?.children || [])].filter(el => !/^pb/i.test(el.id || '') && !/(^|\s)pb/i.test(el.className || '') && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName));
    const text = game.map(el => el.innerText || '').join(' ');
    const blank = !text.trim() && !game.some(el => el.matches('input, canvas, iframe, img, video') || el.querySelector('input, canvas, iframe, img, video'));
    const broken = restoredNow && expiredChecks >= BLANK_CHECKS && (CRASHED.test(text) || blank);
    if (!EXPIRED.test(text) && !broken) return;
    clearInterval(expiredTimer);
    trace(broken ? 'sessão restaurada deixou o jogo em branco' : 'sessão expirada na tela');
    if (!ipcRenderer.sendSync('pb:login-expired')) return;
    try { sessionStorage.clear(); } catch {}
    last = snapshot();
    location.reload();
  }, 2000);

  // Login salvo (opcional, ver main.js): na tela de login do jogo, se esta conta tem login salvo no PokeBoard,
  // preenche usuário e senha e deixa o botão Entrar em foco; quem clica é você (a verificação da Cloudflare fica com
  // o jogo). Ao entrar digitando, o main pergunta, depois que o login der certo, se quer salvar.
  const LOGIN_FORM = 'form.auth-card';
  const USER_INPUT = 'input[autocomplete="username"]';
  const PASS_INPUT = 'input[autocomplete="current-password"]';  // não o "new-password" do cadastro
  const setNative = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  let credTried = false;  // uma vez por passagem pela tela de login (se você apagar, não preenche de novo)
  setInterval(() => {
    const form = document.querySelector(LOGIN_FORM), user = form?.querySelector(USER_INPUT), pass = form?.querySelector(PASS_INPUT);
    if (!user || !pass) { credTried = false; return; }
    if (credTried || user.value || pass.value) return;
    credTried = true;
    const cred = ipcRenderer.sendSync('pb:cred-get');
    if (!cred) return;
    setNative(user, cred.user);
    setNative(pass, cred.pass);
    form.querySelector('button[type="submit"]')?.focus();
  }, 1000);
  document.addEventListener('submit', e => {
    const form = e.target?.matches?.(LOGIN_FORM) ? e.target : null;
    const user = form?.querySelector(USER_INPUT)?.value || '', pass = form?.querySelector(PASS_INPUT)?.value || '';
    if (user && pass) ipcRenderer.send('pb:cred-offer', { user, pass });
  }, true);
  document.addEventListener('visibilitychange', sync);

  // Tela "Ops, algo travou a tela" (ErrorBoundary do React do jogo): o jogo para ali até alguém clicar em Recarregar,
  // e o farm para junto. O main guarda o erro em debug/travou.log (pb:game-crashed) e aqui recarregamos a conta
  // sozinhos em 5 s, no máximo 3 vezes a cada 15 min; se travar mais que isso, a tela fica para você ver.
  const CRASH_TEXT = /algo travou a tela/i;
  const CRASH_KEY = 'pb:crash-reloads';
  const CRASH_MAX = 3, CRASH_WINDOW_MS = 15 * 60e3, CRASH_WAIT_MS = 5000;
  let crashSeen = false;
  setInterval(() => {
    if (crashSeen) return;
    const alert = [...document.querySelectorAll('body [role="alert"]')].find(el => CRASH_TEXT.test(el.textContent || ''));
    if (!alert) return;
    crashSeen = true;
    let recent = [];
    try { recent = JSON.parse(sessionStorage.getItem(CRASH_KEY) || '[]').filter(t => Date.now() - t < CRASH_WINDOW_MS); } catch {}
    const reload = recent.length < CRASH_MAX;
    ipcRenderer.send('pb:game-crashed', { reload, count: recent.length + 1 });
    const note = document.createElement('div');
    note.id = 'pb-crash-note';
    Object.assign(note.style, { position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: '100000',
      maxWidth: '90vw', padding: '8px 14px', background: '#1C2230', color: '#F4F0E2', boxShadow: '0 0 0 2px #05070A, 4px 4px 0 0 #05070A',
      font: '600 14px/18px system-ui, sans-serif', textAlign: 'center' });
    note.textContent = reload
      ? `PokeBoard: recarregando esta conta em ${CRASH_WAIT_MS / 1000} s (o erro ficou guardado em debug\\travou.log).`
      : `PokeBoard: travou ${recent.length + 1} vezes em 15 min, não vou recarregar sozinho. O erro ficou guardado em debug\\travou.log.`;
    document.body.append(note);
    if (!reload) return;
    try { sessionStorage.setItem(CRASH_KEY, JSON.stringify([...recent, Date.now()])); } catch {}
    setTimeout(() => location.reload(), CRASH_WAIT_MS);
  }, 2000);
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

// Bolsa cheia (bag-alert.js): o cartão no meio da tela é da página; daqui vai para o main piscar a barra de tarefas
// e mostrar a notificação do Windows.
window.addEventListener('pb:bag', () => {
  try { ipcRenderer.send('pb:bag-full', JSON.parse(document.documentElement.dataset.pbBag || '{}')); } catch {}
});

// Histórico de preços do Mercado (market-history.js, no mundo da página): as observações vão para o main, que guarda
// um histórico só para todas as contas; ele volta inteiro para a página, numa chamada à função dela.
window.addEventListener('pb:mkt-obs', () => {
  try { ipcRenderer.send('pb:market-obs', JSON.parse(document.documentElement.dataset.pbMktObs || '[]')); } catch {}
});
window.addEventListener('pb:mkt-hist-want', () => ipcRenderer.send('pb:market-history-want'));
ipcRenderer.on('pb:market-history', (_, h) => {
  webFrame.executeJavaScript(`window.__pbMarketHistory?.(${JSON.stringify(h)})`).catch(() => {});
});

// Antes dos scripts do jogo: o hook (observa os dados) e o limitador de quadros da Economia.
for (const name of ['hook', 'fps']) {
  const src = ipcRenderer.sendSync('pb:inject-source', name);
  if (src) webFrame.executeJavaScript(src).catch(e => console.error(`[PokeBoard] ${name}`, e));
}

window.addEventListener('DOMContentLoaded', () => {
  for (const name of ['card', 'layout', 'market', 'dock', 'hud', 'clog', 'map', 'pokedex', 'route', 'prestige', 'chat', 'activity', 'autoBall', 'breeding', 'marketHist', 'dailyKill', 'battleView', 'bagAlert', 'lastHunt']) {
    const src = ipcRenderer.sendSync('pb:inject-source', name);
    if (src) webFrame.executeJavaScript(src).catch(e => console.error(`[PokeBoard] ${name}`, e));
  }
});
