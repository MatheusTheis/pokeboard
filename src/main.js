// Processo principal: janela do board + 4 painéis do jogo, cada um com sessão própria.
const { app, BrowserWindow, WebContentsView, Menu, Tray, Notification, dialog, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createRecorder } = require('./recorder');

// Pasta de dados fixa em %APPDATA%\poke-board (logins, board.json, sessões salvas). Sem isto, o Electron usaria
// o productName ("PokeBoard") e os logins sumiriam ao trocar de nome ou rodar empacotado. --user-data-dir
// (testes com PB_GAME_URL) continua valendo.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'poke-board'));

// PB_GAME_URL: só para testar o board com uma página falsa local (ex.: http://127.0.0.1:5173/play).
// Use junto com --user-data-dir para não mexer nas sessões e no board.json de verdade.
const GAME_URL = process.env.PB_GAME_URL || 'https://poke.idleworld.online/play';
const GAME_ORIGIN = new URL(GAME_URL).origin;
// Moldura do board: o mínimo possível, o resto é jogo. Precisam bater com as variáveis de shell.css.
const SIDEBAR_W = 0;       // sem barra lateral (contas e ações ficam na barra do topo)
const TOPBAR_H = 44;       // --topbar-h
const CELL_HEADER_H = 24;  // --cell-header-h
const GAP = 4;             // --gap

// Zoom automático: o jogo foi feito para tela cheia. Abaixo deste tamanho (px CSS) o painel reduz o zoom
// para o jogo "enxergar" pelo menos isso. O ajuste manual de cada conta multiplica esse valor.
const GAME_MIN_W = 1200;
const GAME_MIN_H = 650;
const ZOOM_STEP = 0.05;
const ZOOM_MIN = 0.3, ZOOM_MAX = 2;

const THEME_PATH = path.join(__dirname, '..', 'theme', 'theme.css');
// CSS aplicado nos painéis, nesta ordem: tokens do design system, nosso visual do jogo e, por último,
// o tema do usuário (para poder sobrescrever tudo). Salvar qualquer um reaplica na hora.
// Com o visual PokeBoard desligado (botão "Original" no topo), os três primeiros não entram e os controles
// nossos dentro do jogo ficam escondidos (sem o CSS deles, apareceriam sem estilo).
const SKIN_CSS = new Set([
  path.join(__dirname, 'ui', 'tokens.css'),
  path.join(__dirname, 'inject', 'game-skin.css'),
  path.join(__dirname, 'inject', 'game-windows.css'),
]);
const SKIN_OFF_CSS = `/* Design original do jogo (botão "Original" do PokeBoard) */
#pb-dock-edit, #pb-dock-editor, #pb-quick-btn, #pb-quick-card, #pb-hud-toggle, #pb-clog-tools,
#pb-map-tools, #pb-mkt-cur, #pb-sell-kind, #pb-card-overlay, .pb-mks-max, .pb-mks-mkt, .pb-mks-mkt-age, #pb-sell-worth, #pb-pk-sort,
#pb-dex-sort, #pb-dex-menu, #pb-toast, #pb-route-overlay, #pb-prestige-auto, #pb-prestige-status,
#pb-prestige-panel, #pb-chat-open, #pb-chat-hide, #pb-cap-ball-status, #pb-mh, .pb-dk-go, #pb-dk-menu, #pb-last-hunt, .pb-sale-tag, #pb-sale-card, .pb-evo, #pb-price-status { display: none !important; }`;
const PANEL_CSS = [
  ...SKIN_CSS,
  () => (state.skin ? '' : SKIN_OFF_CSS),
  () => dockOrderCss(),  // gerado do board.json (ordem da barra de telas)
  THEME_PATH,
];
const INJECT = {
  hook: path.join(__dirname, 'inject', 'hook.js'),
  fps: path.join(__dirname, 'inject', 'fps.js'),
  pokedex: path.join(__dirname, 'inject', 'pokedex-plus.js'),
  layout: path.join(__dirname, 'inject', 'game-layout.js'),
  market: path.join(__dirname, 'inject', 'market-plus.js'),
  dock: path.join(__dirname, 'inject', 'dock-editor.js'),
  hud: path.join(__dirname, 'inject', 'hud-plus.js'),
  clog: path.join(__dirname, 'inject', 'capture-log-plus.js'),
  map: path.join(__dirname, 'inject', 'map-plus.js'),
  card: path.join(__dirname, 'inject', 'pb-card.js'),
  route: path.join(__dirname, 'inject', 'route.js'),
  prestige: path.join(__dirname, 'inject', 'prestige-auto.js'),
  chat: path.join(__dirname, 'inject', 'chat-plus.js'),
  activity: path.join(__dirname, 'inject', 'activity.js'),
  autoBall: path.join(__dirname, 'inject', 'auto-ball.js'),
  breeding: path.join(__dirname, 'inject', 'breeding-plus.js'),
  marketHist: path.join(__dirname, 'inject', 'market-history.js'),
  dailyKill: path.join(__dirname, 'inject', 'daily-kill-plus.js'),
  battleView: path.join(__dirname, 'inject', 'battle-view.js'),
  bagAlert: path.join(__dirname, 'inject', 'bag-alert.js'),
  lastHunt: path.join(__dirname, 'inject', 'last-hunt.js'),
  marketSales: path.join(__dirname, 'inject', 'market-sales.js'),
  teamEvo: path.join(__dirname, 'inject', 'team-evo.js'),
  dailyPulse: path.join(__dirname, 'inject', 'daily-pulse.js'),
};
const STATE_PATH = () => path.join(app.getPath('userData'), 'board.json');

// ---------- motor: economia de memória ----------
// O Chromium só lê estas opções ao abrir o app. Ficam em board.json → "engine" (0 = padrão do Chromium):
//   gpuMemMB    teto de memória da GPU para desenhar as páginas (force-gpu-mem-available-mb)
//   gpuCacheMB  teto do cache de imagens já preparadas na GPU (force-gpu-mem-discardable-limit-mb)
//   v8Small     JavaScript das contas no modo que economiza memória (--optimize-for-size), um pouco mais lento
const ENGINE_DEF = { gpuMemMB: 1024, gpuCacheMB: 256, v8Small: true };
function cleanEngine(e) {
  const mb = (v, d) => (Number.isFinite(v) && v >= 0 && v <= 16384 ? Math.floor(v) : d);
  return { gpuMemMB: mb(e?.gpuMemMB, ENGINE_DEF.gpuMemMB), gpuCacheMB: mb(e?.gpuCacheMB, ENGINE_DEF.gpuCacheMB), v8Small: e?.v8Small !== false };
}
const engine = (() => { try { return cleanEngine(JSON.parse(fs.readFileSync(STATE_PATH(), 'utf8'))?.engine); } catch { return cleanEngine(null); } })();
if (engine.gpuMemMB) app.commandLine.appendSwitch('force-gpu-mem-available-mb', String(engine.gpuMemMB));
if (engine.gpuCacheMB) app.commandLine.appendSwitch('force-gpu-mem-discardable-limit-mb', String(engine.gpuCacheMB));
if (engine.v8Small) app.commandLine.appendSwitch('js-flags', '--optimize-for-size');
// Ícone da janela e da barra de tarefas (gerado por scripts/make-icon.js). No Windows o .ico tem todos os tamanhos.
const ICON_PATH = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// O aviso "Insecure Content-Security-Policy" do Electron fala do CSP do site do jogo, que não controlamos.
// O shell tem CSP próprio; o aviso só poluía o console dos painéis.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let win;
let ivWin = null;
let recorder = null;   // gravador do PB_RECORD (recorder.js)
const views = [];      // um WebContentsView por conta
const afkSessions = new Map(); // uma rota e um relógio independentes por conta
const themeKeys = [];  // chaves dos CSS inseridos em cada painel, para trocar sem recarregar
const MAX_ACCOUNTS = 4;
let state = {
  accountCount: 2,     // quantas contas abrir (1 a 4). Mude aqui ou em board.json.
  accountSlots: [0, 1], // IDs fixos das sessões abertas, na ordem visual
  accounts: [1, 2, 3, 4].map(n => ({ name: `Conta ${n}` })),
  layout: 'grid',      // 'grid' (tela dividida) | 'focus' (1 painel grande, os outros em segundo plano)
  focus: 0,
  zoomAdjust: [1, 1, 1, 1],  // ajuste manual de zoom por conta, sobre o automático (1 = automático)
  dockOrder: [],             // ordem dos ícones da barra de telas (data-guide do jogo); vazio = ordem do jogo
  prefs: {},                 // preferências dos botões nossos dentro do jogo (ver PREFS), iguais para todas as contas
  skin: true,                // visual PokeBoard no jogo; false = design original do jogo
  engine,                    // opções do motor (acima); só valem ao abrir o app
  closeToTray: true,         // fechar a janela deixa o PokeBoard rodando na bandeja (ver "bandeja")
};
// Preferências que os scripts injetados podem salvar. Cada uma tem um validador: devolve o valor limpo,
// ou undefined para recusar (o que vem do jogo nunca entra no board.json sem passar por aqui).
const FPS_STEPS = [0, 30, 20];  // ordem do botão: sem limite → 30 → 20 → sem limite
const GAME_TYPES = ['NORMAL', 'FIRE', 'WATER', 'ELECTRIC', 'GRASS', 'ICE', 'FIGHTING', 'POISON', 'GROUND',
  'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY'];
const PREFS = {
  // cartão do jogador recolhido: só o Pokémon ativo
  hudMin: { def: false, clean: v => (typeof v === 'boolean' ? v : undefined) },
  // mapa (map-plus.js): filtros e centro da vista por região, para voltar igual ao reabrir
  map: { def: null, clean: cleanMapPref },
  // Economia (botão na barra vermelha, fps.js): quadros por segundo de cada conta; 0 = sem limite
  fps: { def: 0, clean: v => (FPS_STEPS.includes(v) ? v : undefined) },
};
function cleanMapPref(v) {
  if (!v || typeof v !== 'object') return undefined;
  const lvl = x => (Number.isFinite(x) && x >= 0 && x <= 99999 ? Math.floor(x) : null);
  const frac = x => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5);
  const views = {};
  for (const [area, c] of Object.entries(v.views || {}).slice(0, 10)) {
    if (/^[\w-]{1,30}$/.test(area) && c && typeof c === 'object') views[area] = { cx: frac(c.cx), cy: frac(c.cy) };
  }
  return {
    q: typeof v.q === 'string' ? v.q.slice(0, 40) : '',
    min: lvl(v.min),
    max: lvl(v.max),
    types: Array.isArray(v.types) ? [...new Set(v.types.filter(t => GAME_TYPES.includes(t)))] : [],
    views,
  };
}

function loadState() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(STATE_PATH(), 'utf8')) || {}; } catch { /* primeira execução */ }
  // board.json pode ter sido editado à mão: valida cada campo em vez de confiar no arquivo.
  const names = Array.isArray(saved.accounts) ? saved.accounts : [];
  const legacyCount = Math.min(MAX_ACCOUNTS, Math.max(1, Math.floor(Number(saved.accountCount)) || 2));
  const slots = Array.isArray(saved.accountSlots)
    ? [...new Set(saved.accountSlots.filter(n => Number.isInteger(n) && n >= 0 && n < MAX_ACCOUNTS))].slice(0, MAX_ACCOUNTS) : [];
  state = {
    accountCount: slots.length || legacyCount,
    accountSlots: slots.length ? slots : Array.from({ length: legacyCount }, (_, i) => i),
    accounts: [0, 1, 2, 3].map(i => ({ name: String(names[i]?.name || '').trim().slice(0, 24) || `Conta ${i + 1}` })),
    layout: saved.layout === 'focus' ? 'focus' : 'grid',
    focus: Math.max(0, Math.floor(Number(saved.focus)) || 0),
    zoomAdjust: [0, 1, 2, 3].map(i => clampAdjust(Number(saved.zoomAdjust?.[i]) || 1)),
    dockOrder: cleanDockOrder(saved.dockOrder),
    prefs: Object.fromEntries(Object.entries(PREFS).map(([k, p]) => [k, p.clean(saved.prefs?.[k]) ?? p.def])),
    skin: saved.skin !== false,
    engine,
    closeToTray: saved.closeToTray !== false,
  };
}
const slotAt = i => state.accountSlots[i];
const indexOfSlot = slot => state.accountSlots.indexOf(slot);
const clampAdjust = a => Math.min(5, Math.max(0.2, a));
// Só nomes simples (vão para dentro de um seletor CSS), sem repetição.
const cleanDockOrder = a => Array.isArray(a)
  ? [...new Set(a.filter(k => typeof k === 'string' && /^[\w-]{1,40}$/.test(k)))].slice(0, 100) : [];

// Ordem da barra de telas via CSS order: os botões continuam sendo os do jogo, o DOM dele não muda.
// O que não estiver na lista (ícone novo depois de uma atualização) vai para o fim.
function dockOrderCss() {
  if (!state.dockOrder.length) return '';
  const item = k => `.game-root .dock-scroll > [data-guide="${k}"], .game-root .dock-scroll > :has(> [data-guide="${k}"])`;
  return [`.game-root .dock-scroll > * { order: 1000; }`,
    ...state.dockOrder.map((k, n) => `${item(k)} { order: ${n + 1} !important; }`)].join('\n');
}
function saveState() {
  try { fs.writeFileSync(STATE_PATH(), JSON.stringify(state, null, 2)); } catch (e) { console.error('Falha ao salvar estado', e); }
}

// ---------- CSS dos painéis (tokens, visual do jogo, tema), reaplicado sozinho ao salvar ----------
const themeQueue = [];  // uma fila por painel: dom-ready e o watcher podem disparar juntos e duplicar o CSS
function applyTheme(i) {
  const view = views[i], slot = view?.slot;
  if (slot === undefined) return Promise.resolve();
  themeQueue[slot] = (themeQueue[slot] || Promise.resolve()).then(() => applyThemeNow(view)).catch(e => console.error('[PokeBoard] tema', e));
  return themeQueue[slot];
}
async function applyThemeNow(view) {
  const wc = view.webContents, slot = view.slot;
  if (!views.includes(view) || wc.isDestroyed()) return;
  for (const key of themeKeys[slot] || []) { try { await wc.removeInsertedCSS(key); } catch {} }
  themeKeys[slot] = [];
  for (const src of PANEL_CSS) {
    if (!views.includes(view) || wc.isDestroyed()) return;
    if (!state.skin && SKIN_CSS.has(src)) continue;
    let css;
    try { css = typeof src === 'function' ? src() : fs.readFileSync(src, 'utf8'); } catch { continue; }
    if (css) themeKeys[slot].push(await wc.insertCSS(css, { cssOrigin: 'author' }));
  }
}
function watchTheme() {
  let t;
  const files = PANEL_CSS.filter(f => typeof f === 'string');
  const names = new Set(files.map(f => path.basename(f)));
  for (const dir of new Set(files.map(f => path.dirname(f)))) {
    fs.watch(dir, (_, file) => {
      if (file && !names.has(file)) return;
      clearTimeout(t);
      t = setTimeout(() => views.forEach((_, i) => applyTheme(i)), 150);
    });
  }
}

// ---------- layout ----------
function computeCells() {
  const [w, h] = win.getContentSize();
  const area = { x: SIDEBAR_W + GAP, y: TOPBAR_H + GAP, w: w - SIDEBAR_W - GAP * 2, h: h - TOPBAR_H - GAP * 2 };
  if (state.layout === 'focus') {
    // Painéis escondidos viram "segundo plano" no Chromium: animações e timers desaceleram,
    // o que economiza CPU. O progresso idle continua no servidor do jogo.
    return views.map((_, i) => ({ ...area, visible: i === state.focus }));
  }
  // 1 conta: tela cheia. 2 contas: lado a lado. 3 ou 4: grade 2x2.
  const n = views.length;
  const cols = n === 1 ? 1 : 2, rows = n <= 2 ? 1 : 2;
  const cw = Math.floor((area.w - GAP * (cols - 1)) / cols), ch = Math.floor((area.h - GAP * (rows - 1)) / rows);
  return views.map((_, i) => ({
    x: area.x + (i % cols) * (cw + GAP),
    y: area.y + Math.floor(i / cols) * (ch + GAP),
    w: cw, h: ch, visible: true,
  }));
}
// Zoom final do painel i numa célula: automático (pelo tamanho) × ajuste da conta, em passos de 5%.
const autoZoom = c => Math.min(1, c.w / GAME_MIN_W, (c.h - CELL_HEADER_H) / GAME_MIN_H);
const zoomFor = (i, c) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(autoZoom(c) * state.zoomAdjust[slotAt(i)] / ZOOM_STEP) * ZOOM_STEP));
const lastCells = [];

function applyZoom(i) {
  const wc = views[i]?.webContents, c = lastCells[i];
  if (!wc || wc.isDestroyed() || !c) return;
  if (Math.abs(wc.getZoomFactor() - c.zoom) > 0.001) wc.setZoomFactor(c.zoom);
}

function layout() {
  if (!win) return;
  const cells = computeCells();
  cells.forEach((c, i) => {
    c.slot = slotAt(i);
    c.afkSlot = c.visible && afkSessions.has(c.slot);
    if (c.afkSlot) c.visible = false; // somente esta conta deixa de desenhar
    // Painel escondido mantém o zoom que tinha: recalcular ali só faria o jogo redesenhar à toa.
    c.zoom = c.visible ? zoomFor(i, c) : (lastCells[i]?.zoom ?? 1);
    c.autoZoom = state.zoomAdjust[c.slot] === 1;
    lastCells[i] = c;
    views[i].setVisible(c.visible);
    if (c.visible) { views[i].setBounds({ x: c.x, y: c.y + CELL_HEADER_H, width: c.w, height: Math.max(0, c.h - CELL_HEADER_H) }); applyZoom(i); }
  });
  win.webContents.send('pb:layout', { cells, state: { ...state, accountCount: views.length } });
  // Os painéis sabem se estão em grade ou foco (html[data-pb-layout]): no modo dividido a barra de telas
  // do jogo vira uma fileira de ícones grandes com rolagem (game-windows.css).
  if (state.layout !== sentLayout) { sentLayout = state.layout; views.forEach(v => v.webContents.send('pb:layout-mode', state.layout)); }
}
let sentLayout = '';
function setLayout(l) { state.layout = l; saveState(); layout(); }
function setFocus(i) { if (!views[i]) return; state.focus = i; state.layout = 'focus'; saveState(); layout(); views[i].webContents.focus(); }

// dir: +1 aumenta, -1 diminui (5% por vez), 0 volta ao automático.
function stepZoom(i, dir) {
  const c = lastCells[i];
  if (!views[i] || !c) return;
  const slot = slotAt(i);
  if (!dir) state.zoomAdjust[slot] = 1;
  else {
    const target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((c.zoom + dir * ZOOM_STEP) / ZOOM_STEP) * ZOOM_STEP));
    const adj = target / autoZoom(c);
    // Perto de 1 vira automático de novo, para não ficar preso num ajuste de 0,99.
    state.zoomAdjust[slot] = Math.abs(adj - 1) < 0.01 ? 1 : clampAdjust(adj);
  }
  saveState(); layout();
}

// Atalhos: Ctrl+1..N foca uma conta, Ctrl+0 volta para a grade, Ctrl+= / Ctrl+- mudam o zoom do painel.
// Vale no shell e em cada painel; no shell, o zoom age sobre a conta em foco.
// Alt fica de fora porque AltGr chega como Ctrl+Alt no Windows.
function handleShortcut(e, input, i = state.layout === 'focus' ? state.focus : -1, fromGame = false) {
  if (fromGame && afkSessions.has(slotAt(i))) { e.preventDefault(); return; }
  if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
  if (/^[1-9]$/.test(input.key) && indexOfSlot(+input.key - 1) >= 0) { setFocus(indexOfSlot(+input.key - 1)); e.preventDefault(); }
  else if (input.key === '0') { setLayout('grid'); e.preventDefault(); }
  else if (i >= 0 && (input.key === '=' || input.key === '+')) { stepZoom(i, 1); e.preventDefault(); }
  else if (i >= 0 && input.key === '-') { stepZoom(i, -1); e.preventDefault(); }
}

const isGameUrl = url => { try { return new URL(url).origin === GAME_ORIGIN; } catch { return false; } };

// PB_DEBUG: chamadas à API fora da leitura normal do jogo (login, erros), para depurar.
// Só observa: método, caminho, status e nomes de cookies (nunca valores).
function debugRequest(i, d) {
  if (!process.env.PB_DEBUG || !isGameUrl(d.url)) return;
  const p = new URL(d.url).pathname;
  if (!p.startsWith('/api/') || (p.startsWith('/api/game/') && d.statusCode < 400)) return;
  const sc = Object.entries(d.responseHeaders || {}).find(([k]) => k.toLowerCase() === 'set-cookie')?.[1] || [];
  const names = sc.map(c => c.split('=')[0] + (/expires=|max-age=/i.test(c) ? '' : ' (sessão)'));
  console.log(`[conta${i + 1}] ${d.method} ${p} → ${d.statusCode || d.error}${names.length ? ` · cookies: ${names.join(', ')}` : ''}`);
}

// ---------- painéis ----------
function createView(slot) {
  const view = new WebContentsView({
    webPreferences: {
      partition: `persist:conta${slot + 1}`,   // cookies e login separados por conta, salvos entre execuções
      preload: path.join(__dirname, 'preload-game.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: true,
      spellcheck: false,  // sem corretor: não carrega dicionário em cada conta
    },
  });
  view.slot = slot;
  const wc = view.webContents;

  // Links externos (Discord, Instagram) abrem no navegador, não dentro do painel.
  // Só http(s): openExternal com outros protocolos pode executar programas do sistema.
  wc.setWindowOpenHandler(({ url }) => {
    if (isGameUrl(url)) return { action: 'allow' };
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('dom-ready', () => { const i = indexOfSlot(slot); if (i >= 0) applyTheme(i); });
  wc.on('before-input-event', (e, input) => handleShortcut(e, input, indexOfSlot(slot), true));
  wc.on('focus', () => { const i = indexOfSlot(slot); if (i >= 0) lastFocused = i; });  // conta da Rota de treino na grade
  // Ctrl + roda do mouse: o Electron só avisa, quem aplica o zoom somos nós.
  wc.on('zoom-changed', (_, dir) => stepZoom(indexOfSlot(slot), dir === 'in' ? 1 : -1));
  // A página nova pode voltar ao zoom padrão: reaplica o do painel.
  wc.on('did-navigate', () => applyZoom(indexOfSlot(slot)));
  wc.on('dom-ready', () => applyZoom(indexOfSlot(slot)));
  // Só uma página nova no frame principal (recarga, troca de endereço) conta como recarga. O mesmo evento também vem
  // quando o jogo troca a URL sem recarregar (pushState, #) e quando um iframe navega (chat, vídeos, Cloudflare):
  // nesses casos o painel continua o mesmo e o AFK segue.
  wc.on('did-start-navigation', e => {
    if (!e.isMainFrame || e.isSameDocument) return;
    if (afkSessions.has(slot)) stopAfk(slot, 'Painel recarregado; modo AFK encerrado.');
  });
  wc.on('render-process-gone', () => { if (afkSessions.has(slot)) stopAfk(slot, 'Painel interrompido; modo AFK encerrado.'); });

  // Últimos erros do console de cada conta (só do jogo), para o registro da tela "algo travou" (pb:game-crashed).
  wc.on('console-message', e => {
    if (e.level !== 'error' || (/^https?:/.test(e.sourceId) && !isGameUrl(e.sourceId))) return;
    const list = consoleErrors.get(slot) || [];
    list.push(`${new Date().toISOString()} ${e.message} (${e.sourceId}:${e.lineNumber})`);
    consoleErrors.set(slot, list.slice(-40));
  });
  // PB_DEBUG=1 repete no terminal os avisos e erros do console do painel (para testar a Fase 0).
  // Ignora iframes de terceiros (ex.: o captcha da Cloudflare no login), que só fazem barulho.
  if (process.env.PB_DEBUG) wc.on('console-message', e => {
    if (e.level !== 'warning' && e.level !== 'error') return;
    if (/^https?:/.test(e.sourceId) && !isGameUrl(e.sourceId)) return;
    console.log(`[conta${slot + 1}] ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  if (process.env.PB_DEBUG) wc.on('did-navigate', (_, url, code) => console.log(`[conta${slot + 1}] navegou: ${url} (${code})`));
  // Só um listener por evento em cada sessão: o log do PB_DEBUG e o gravador dividem o mesmo.
  if (process.env.PB_DEBUG || process.env.PB_RECORD) {
    const done = d => { debugRequest(slot, d); const i = indexOfSlot(slot); if (i >= 0) recorder?.onRequest(i, d); };
    wc.session.webRequest.onCompleted(done);
    wc.session.webRequest.onErrorOccurred(done);
  }

  win.contentView.addChildView(view);
  wc.loadURL(GAME_URL);
  return view;
}

// ---------- IPC ----------
// Os scripts injetados ficam em arquivos; o preload roda em sandbox e pede o texto por aqui.
ipcMain.on('pb:inject-source', (e, name) => {
  try { e.returnValue = fs.readFileSync(INJECT[name], 'utf8'); } catch { e.returnValue = ''; }
});
ipcMain.handle('pb:get-state', () => ({ ...state, accountCount: views.length }));
ipcMain.on('pb:add-account', e => {
  if (e.sender !== win?.webContents || views.length >= MAX_ACCOUNTS) return;
  const slot = [0, 1, 2, 3].find(n => !state.accountSlots.includes(n));
  const pos = state.accountSlots.findIndex(n => n > slot);
  const i = pos < 0 ? views.length : pos;
  state.accountSlots.splice(i, 0, slot);
  views.splice(i, 0, createView(slot));
  if (state.focus >= i) state.focus++;
  if (lastFocused >= i) lastFocused++;
  state.accountCount = views.length;
  state.layout = 'grid';
  saveState();
  layout();
});
// Fechar uma aba preserva o ID da sessão. Fechar a Conta 2 nunca transforma a Conta 3 em Conta 2.
function closeAccount(slot) {
  const i = indexOfSlot(slot);
  if (i < 0 || views.length <= 1) return;
  stopAfk(slot, '', true);
  const [view] = views.splice(i, 1);
  state.accountSlots.splice(i, 1);
  state.accountCount = views.length;
  if (state.focus >= i) state.focus = Math.max(0, state.focus - (state.focus > i ? 1 : 0));
  if (state.focus >= views.length) state.focus = views.length - 1;
  if (lastFocused >= i) lastFocused = Math.max(0, lastFocused - (lastFocused > i ? 1 : 0));
  if (lastFocused >= views.length) lastFocused = views.length - 1;
  win.contentView.removeChildView(view);
  view.webContents.close();
  themeKeys[slot] = [];
  loginRestored.delete(slot);
  saveState();
  layout();
}
ipcMain.on('pb:account-menu', (e, slot) => {
  if (e.sender !== win?.webContents || !Number.isInteger(slot) || indexOfSlot(slot) < 0) return;
  Menu.buildFromTemplate([{ label: 'Sair desta conta…', click: async () => {
    const name = state.accounts[slot].name;
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', title: 'Sair desta conta', message: `Sair da conta ${name}?`,
      detail: 'A sessão desta aba e o login salvo dela são apagados e o jogo volta para a tela de login, para você entrar de novo.',
      buttons: ['Cancelar', 'Sair da conta'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (response === 1) forgetLogin(slot);
  } }, { label: 'Esquecer login salvo', enabled: fs.existsSync(CRED_PATH(slot)), click: () => {
    fs.rmSync(CRED_PATH(slot), { force: true });
  } }, { label: 'Fechar aba', enabled: views.length > 1, click: async () => {
    const name = state.accounts[slot].name;
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', title: 'Fechar aba', message: `Fechar a aba ${name}?`,
      detail: 'O login salvo desta conta será mantido para quando você a abrir novamente.',
      buttons: ['Cancelar', 'Fechar aba'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (response === 1) closeAccount(slot);
  } }]).popup({ window: win });
});

// Sessão salva por conta (ver preload-game.js). Criptografada com o usuário do Windows (DPAPI);
// sem criptografia disponível, não salva nada em texto puro.
const LOGIN_PATH = i => path.join(app.getPath('userData'), `sessao-conta${i + 1}.bin`);
const viewIndex = e => views.findIndex(v => v.webContents.id === e.sender.id);
const viewSlot = e => slotAt(viewIndex(e));
// Registro do login (restaurar sessão, sessão vencida, login salvo) em debug/login.log, sempre ligado: só eventos e nomes
// de chaves, nunca valores (tokens, usuário, senha). Com PB_DEBUG=1 também sai no terminal. Fica no máximo ~512 KB.
function loginLog(i, msg) {
  const line = `${new Date().toISOString()} [conta${i + 1}] ${msg}`;
  if (process.env.PB_DEBUG) console.log(`[conta${i + 1}] login: ${msg}`);
  try {
    const dir = path.join(app.getPath('userData'), 'debug'), file = path.join(dir, 'login.log');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 524288) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(-262144));
    fs.appendFileSync(file, line + '\n');
  } catch {}
}
const loginRestored = new Set();  // restaura uma vez por execução: se o jogo recusar a sessão, não insiste
// Sessão vencida: o servidor responde "Sessão inválida ou expirada" e o jogo para nessa tela, sem o login. O
// preload avisa; aqui apagamos a cópia salva desta conta e autorizamos limpar a sessão da aba e recarregar, o que
// leva ao login do jogo. Uma vez por conta até um login novo (pb:login-save com login), para não entrar em laço.
const expiredHandled = new Set();
ipcMain.on('pb:login-expired', e => {
  const slot = viewSlot(e);
  if (!Number.isInteger(slot) || slot < 0 || expiredHandled.has(slot)) { e.returnValue = false; return; }
  expiredHandled.add(slot);
  fs.rmSync(LOGIN_PATH(slot), { force: true });
  loginLog(slot, 'sessão expirada: cópia apagada, voltando para o login');
  e.returnValue = true;
});
// "Sair desta conta" (menu da aba): apaga a sessão da aba e a cópia salva e recarrega no login do jogo.
async function forgetLogin(slot) {
  fs.rmSync(LOGIN_PATH(slot), { force: true });
  const wc = views[indexOfSlot(slot)]?.webContents;
  if (!wc || wc.isDestroyed()) return;
  try { await wc.executeJavaScript('sessionStorage.clear()'); } catch {}
  wc.reload();
}
// ---------- login salvo (opcional) ----------
// Usuário e senha de cada conta, só se você aceitar depois de entrar no jogo pelo PokeBoard. Ficam neste computador,
// criptografados com o usuário do Windows (DPAPI, safeStorage), e só voltam para preencher a tela de login do
// próprio jogo nesta conta; quem clica em Entrar é você. Nunca vão para o log nem para outro lugar.
const CRED_PATH = slot => path.join(app.getPath('userData'), `credenciais-conta${slot + 1}.bin`);
const CRED_OFFER_MS = 2 * 60e3;  // o login precisa dar certo neste tempo para a pergunta aparecer
const credOffers = new Map();    // slot -> { user, pass, at }: digitado, esperando o login dar certo
function readCred(slot, why = '') {
  try {
    if (!safeStorage.isEncryptionAvailable()) { if (why) loginLog(slot, `login salvo: criptografia indisponível (${why})`); return null; }
    if (!fs.existsSync(CRED_PATH(slot))) { if (why) loginLog(slot, `login salvo: nenhum (${why})`); return null; }
    const c = JSON.parse(safeStorage.decryptString(fs.readFileSync(CRED_PATH(slot))));
    const ok = typeof c?.user === 'string' && typeof c?.pass === 'string';
    if (why) loginLog(slot, `login salvo: ${ok ? 'lido' : 'formato inválido'} (${why})`);
    return ok ? c : null;
  } catch (err) { if (why) loginLog(slot, `login salvo: falha ao ler (${err.message}) (${why})`); return null; }
}
ipcMain.on('pb:cred-get', e => {
  const slot = viewSlot(e);
  if (!Number.isInteger(slot) || slot < 0) { e.returnValue = null; return; }
  e.returnValue = readCred(slot, 'tela de login');
});
ipcMain.on('pb:cred-offer', (e, c) => {
  const slot = viewSlot(e);
  if (!Number.isInteger(slot) || slot < 0 || typeof c?.user !== 'string' || typeof c?.pass !== 'string') return;
  const user = c.user.slice(0, 200), pass = c.pass.slice(0, 200);
  const saved = readCred(slot);
  if (!user || !pass || (saved && saved.user === user && saved.pass === pass)) return;
  credOffers.set(slot, { user, pass, at: Date.now() });
});
// Chamado quando o login desta conta deu certo (pb:login-save com login).
async function askSaveCred(slot) {
  const offer = credOffers.get(slot);
  credOffers.delete(slot);
  if (!offer || Date.now() - offer.at > CRED_OFFER_MS || !safeStorage.isEncryptionAvailable() || !win) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', title: 'Salvar login', message: `Salvar o login da ${state.accounts[slot]?.name || `Conta ${slot + 1}`} no PokeBoard?`,
    detail: 'Fica só neste computador, criptografado com o seu usuário do Windows. Quando a sessão expirar, o PokeBoard '
      + 'preenche usuário e senha na tela de login do jogo e você só clica em Entrar. Para apagar: botão direito na aba '
      + 'da conta → Esquecer login salvo.',
    buttons: ['Agora não', 'Salvar'], defaultId: 1, cancelId: 0, noLink: true,
  });
  if (response === 1) fs.writeFileSync(CRED_PATH(slot), safeStorage.encryptString(JSON.stringify({ user: offer.user, pass: offer.pass })));
}
// Origem do jogo, para o preload saber onde cuidar do login (com PB_GAME_URL, a do jogo falso dos testes).
ipcMain.on('pb:game-origin', e => { try { e.returnValue = new URL(GAME_URL).origin; } catch { e.returnValue = ''; } });
ipcMain.on('pb:login-trace', (e, msg) => { const slot = viewSlot(e); if (slot !== undefined) loginLog(slot, String(msg).slice(0, 2000)); });
// Não dá para conferir a URL do painel aqui: o preload roda antes de o main registrar a navegação,
// e na troca de página o frame antigo some antes da mensagem chegar. Quem confere a origem do jogo é o preload.
// Atenção: a primeira atribuição a e.returnValue já envia a resposta; as seguintes são ignoradas.
ipcMain.on('pb:login-get', e => { e.returnValue = readSavedSession(viewSlot(e)); });
function readSavedSession(i) {
  if (!Number.isInteger(i) || i < 0) return null;
  if (loginRestored.has(i)) { loginLog(i, 'já restaurado nesta execução, não repete'); return null; }
  loginRestored.add(i);
  if (!safeStorage.isEncryptionAvailable()) { loginLog(i, 'criptografia indisponível'); return null; }
  if (!fs.existsSync(LOGIN_PATH(i))) { loginLog(i, 'nenhum salvo'); return null; }
  try { return safeStorage.decryptString(fs.readFileSync(LOGIN_PATH(i))); }
  catch (err) { loginLog(i, `falha ao ler (${err.message})`); return null; }
}
ipcMain.on('pb:login-save', (e, value, hasLogin) => {
  const i = viewSlot(e);
  if (i === undefined) return;
  try {
    if (typeof value !== 'string' || value === '{}') { fs.rmSync(LOGIN_PATH(i), { force: true }); loginLog(i, 'sessão vazia, cópia apagada'); }
    else if (value.length < 1048576 && safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(LOGIN_PATH(i), safeStorage.encryptString(value));
      loginLog(i, `salvo (${hasLogin ? 'com login' : 'sem login'})`);
      if (hasLogin) expiredHandled.delete(i);  // login novo: se vencer de novo, recupera de novo
      if (hasLogin && credOffers.has(i)) askSaveCred(i);  // entrou digitando: pergunta se salva o login
    }
  } catch (err) { console.error('[PokeBoard] login', err); }
});
ipcMain.on('pb:set-layout', (_, l) => setLayout(l === 'focus' ? 'focus' : 'grid'));
ipcMain.on('pb:focus', (_, i) => views[i] && setFocus(i));
ipcMain.on('pb:zoom', (_, i, dir) => stepZoom(i, dir === 'in' ? 1 : dir === 'out' ? -1 : 0));
// Preferências dos botões nossos no jogo: o preload lê ao carregar a página e recebe as mudanças.
ipcMain.on('pb:get-prefs', e => { e.returnValue = state.prefs; });
ipcMain.on('pb:get-layout-mode', e => { e.returnValue = state.layout; });
ipcMain.on('pb:set-pref', (e, key, value) => {
  if (!views.some(v => v.webContents.id === e.sender.id)) return;
  const clean = Object.hasOwn(PREFS, key) ? PREFS[key].clean(value) : undefined;
  if (clean === undefined) return;
  state.prefs[key] = clean;
  saveState();
  views.forEach(v => v.webContents.send('pb:prefs', state.prefs));  // as outras contas mudam junto
});
// Ordem da barra de telas, salva pelo editor (✎ na barra) de qualquer painel; vale para todas as contas.
ipcMain.on('pb:set-dock-order', (e, order) => {
  if (!views.some(v => v.webContents.id === e.sender.id)) return;
  state.dockOrder = cleanDockOrder(order);
  saveState();
  views.forEach((_, i) => applyTheme(i));
});
// ---------- histórico de preços do Mercado (market-history.js) ----------
// O mais barato de cada item (por moeda) cada vez que o jogo carrega a lista do Mercado, em qualquer conta. Um arquivo
// só para todas as contas, com a hora deste processo. Só preços públicos do Mercado, nada da conta.
const MKT_PATH = () => path.join(app.getPath('userData'), 'historico-mercado.json');
const MKT_SESSION_MIN = 20;  // dentro disso a observação substitui a anterior (mesma visita ao Mercado)
const MKT_RAW_DAYS = 3;      // depois disso fica um ponto por dia (o menor preço)
const MKT_KEEP_DAYS = 120;
const MKT_MAX_OBS = 400;     // por item
const MKT_MAX_ITEMS = 3000;
let mktHist = null, mktSaveTimer = null, mktSendTimer = null;
function marketHistory() {
  if (mktHist) return mktHist;
  try {
    const v = JSON.parse(fs.readFileSync(MKT_PATH(), 'utf8'));
    if (v?.v === 1 && v.items && typeof v.items === 'object') mktHist = v;
  } catch {}
  return (mktHist ||= { v: 1, items: {} });
}
const mktDay = min => new Date(min * 60e3).toDateString();
function compactMarketObs(o, nowMin) {
  const rawFrom = nowMin - MKT_RAW_DAYS * 1440, keepFrom = nowMin - MKT_KEEP_DAYS * 1440;
  const recent = [], byDay = new Map();
  for (const r of o) {
    if (r[0] < keepFrom) continue;
    if (r[0] >= rawFrom) { recent.push(r); continue; }
    const d = mktDay(r[0]), cur = byDay.get(d);
    if (!cur || r[1] < cur[1]) byDay.set(d, r);
  }
  return [...byDay.values(), ...recent].sort((a, b) => a[0] - b[0]).slice(-MKT_MAX_OBS);
}
function saveMarketNow() {
  clearTimeout(mktSaveTimer);
  mktSaveTimer = null;
  if (!mktHist) return;
  try {
    const tmp = `${MKT_PATH()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(mktHist));
    fs.renameSync(tmp, MKT_PATH());
  } catch (err) { console.error('[PokeBoard] histórico do mercado', err); }
}
app.on('will-quit', () => { if (mktSaveTimer) saveMarketNow(); });
const sendMarketHistory = wc => { if (!wc.isDestroyed()) wc.send('pb:market-history', marketHistory()); };
// rows: [[chave "nome|GOLD" ou "nome|DIAMONDS", nome, categoria, preço, quantidade], …]
ipcMain.on('pb:market-obs', (e, rows) => {
  if (!Number.isInteger(viewSlot(e)) || !Array.isArray(rows) || rows.length > 2000) return;
  const h = marketHistory(), nowMin = Math.floor(Date.now() / 60e3);
  let count = Object.keys(h.items).length, changed = false;
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const [key, name, cat, price, qty] = r;
    if (typeof key !== 'string' || key.length > 100 || !/.\|(GOLD|DIAMONDS)$/.test(key)) continue;
    if (typeof name !== 'string' || !name || name.length > 80 || typeof cat !== 'string' || cat.length > 80) continue;
    if (!Number.isFinite(price) || price <= 0 || price > 1e12) continue;
    let it = h.items[key];
    if (!it) {
      if (count >= MKT_MAX_ITEMS) continue;
      it = h.items[key] = { n: name, c: cat, o: [] };
      count++;
    }
    Object.assign(it, { n: name, c: cat || it.c });
    const ob = [nowMin, price, Number.isFinite(qty) && qty > 0 ? Math.min(Math.floor(qty), 1e9) : 0];
    const last = it.o[it.o.length - 1];
    if (last && nowMin - last[0] < MKT_SESSION_MIN) it.o[it.o.length - 1] = ob;
    else { it.o.push(ob); it.o = compactMarketObs(it.o, nowMin); }
    changed = true;
  }
  if (!changed) return;
  clearTimeout(mktSaveTimer);
  mktSaveTimer = setTimeout(saveMarketNow, 3000);
  if (!mktSendTimer) mktSendTimer = setTimeout(() => { mktSendTimer = null; views.forEach(v => sendMarketHistory(v.webContents)); }, 1000);
});
ipcMain.on('pb:market-history-want', e => { if (Number.isInteger(viewSlot(e))) sendMarketHistory(e.sender); });

// ---------- tela "algo travou" do jogo ----------
// O preload avisa quando o jogo cai na tela de erro dele (e se vai recarregar a conta); guardamos em debug/travou.log
// os últimos erros do console daquela conta, para achar a causa. O arquivo não passa de ~1 MB (fica o fim).
const consoleErrors = new Map();  // slot -> últimas linhas de erro do console
ipcMain.on('pb:game-crashed', (e, info) => {
  const slot = viewSlot(e);
  if (!Number.isInteger(slot) || slot < 0) return;
  const name = state.accounts[slot]?.name || `Conta ${slot + 1}`;
  const lines = [
    `===== ${new Date().toISOString()} · ${name} (conta${slot + 1}) · ${e.sender.getURL()}`,
    `travou ${Number(info?.count) || 1}x nos últimos 15 min · ${info?.reload ? 'recarregando sozinho' : 'sem recarregar (limite)'}`,
    ...(consoleErrors.get(slot) || ['(nenhum erro no console)']),
    '',
  ];
  try {
    const dir = path.join(app.getPath('userData'), 'debug'), file = path.join(dir, 'travou.log');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 1048576) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(-524288));
    fs.appendFileSync(file, lines.join('\n') + '\n');
  } catch (err) { console.error('[PokeBoard] travou.log', err); }
  consoleErrors.delete(slot);
});

// ---------- bolsa cheia (bag-alert.js) ----------
// Quando o Depósito e a Bolsa de uma conta enchem (o Auto-Catch do jogo para): a barra de tarefas pisca até você
// voltar à janela e sai uma notificação do Windows; clicar nela abre o PokeBoard. O cartão no meio da tela é do painel.
const bagFull = new Set();         // contas com a bolsa cheia agora: avisa de novo só depois de ela esvaziar
const bagNotices = new Set();      // notificações abertas (sem referência, o clique pode se perder)
ipcMain.on('pb:bag-full', (e, info) => {
  const slot = viewSlot(e);
  if (!Number.isInteger(slot) || slot < 0) return;
  const count = Number(info?.count), max = Number(info?.max);
  if (!Number.isFinite(count) || !Number.isFinite(max) || max <= 0) return;
  if (count < max) { bagFull.delete(slot); return; }
  if (bagFull.has(slot)) return;
  bagFull.add(slot);
  const name = state.accounts[slot]?.name || `Conta ${slot + 1}`;
  if (win && !win.isDestroyed() && !win.isFocused()) {
    win.flashFrame(true);
    win.once('focus', () => { if (!win.isDestroyed()) win.flashFrame(false); });
  }
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: `Bolsa cheia · ${name}`,
    body: `${count.toLocaleString('pt-BR')}/${max.toLocaleString('pt-BR')} Pokémon no Depósito e na Bolsa. O Auto-Catch parou: venda ou solte Pokémon.`,
    icon: ICON_PATH,
  });
  bagNotices.add(n);
  n.on('click', () => { showWindow(); views[indexOfSlot(slot)]?.webContents.focus(); });
  n.on('close', () => bagNotices.delete(n));
  n.show();
});
ipcMain.on('pb:reload', (_, i) => views[i]?.webContents.reload());
ipcMain.on('pb:reload-all', () => views.forEach(v => v.webContents.reload()));
// Visual PokeBoard ↔ design original do jogo: troca o CSS dos painéis na hora, sem recarregar o jogo.
ipcMain.on('pb:set-skin', (_, on) => {
  state.skin = !!on;
  saveState();
  views.forEach((_, i) => applyTheme(i));
  layout();  // o shell recebe o estado novo e atualiza o botão
});
// Economia: limite de quadros por segundo, igual para todas as contas (o fps.js de cada painel aplica).
ipcMain.on('pb:set-fps', (_, fps) => {
  const clean = PREFS.fps.clean(fps);
  if (clean === undefined) return;
  state.prefs.fps = clean;
  saveState();
  views.forEach(v => v.webContents.send('pb:prefs', state.prefs));
  layout();  // o shell recebe o estado novo e atualiza o botão
});
ipcMain.on('pb:devtools', (_, i) => views[i]?.webContents.openDevTools({ mode: 'detach' }));

// ---------- Rota de treino (PIW Tools) ----------
// O Hunt Planner do PIW Tools (piwtools.com.br, de Rakupo / bar) calcula a rota de treino mais eficiente. O botão
// Rota na barra vermelha abre a ferramenta deles já no Pokémon escolhido, pelo link direto que o próprio site usa
// (/hunt?pokemon=…&level=…&tab=route&routeTarget=…), numa janela do PokeBoard com sessão própria. Nada do cálculo
// vem para cá. Links para fora do site abrem no navegador.
const ROUTE_ORIGIN = 'https://piwtools.com.br';
let routeWin = null;
// Conta de onde vem o Pokémon: a do modo Foco ou, na grade, a última que teve o foco (clicar na barra tira o foco
// do painel, por isso guardamos a última).
let lastFocused = 0;
function routeAccount() {
  const i = state.layout === 'focus' ? state.focus : lastFocused;
  return views[i] ? i : 0;
}
const cleanRoute = q => {
  const pokemon = String(q?.pokemon || '').trim().slice(0, 40);
  const level = Math.max(1, Math.min(9999, Math.floor(Number(q?.level)) || 1));
  const target = Math.max(level + 1, Math.min(9999, Math.floor(Number(q?.target)) || level + 1));
  return pokemon ? { pokemon, level, target } : null;
};
// Abre a janela "Rota de treino" (route.js) no painel da conta.
ipcMain.on('pb:route-show', (_, q) => {
  const clean = cleanRoute(q), wc = views[routeAccount()]?.webContents;
  if (clean && wc && !wc.isDestroyed()) { wc.send('pb:route-open', clean); wc.focus(); }
});
// Time da conta (HUD do jogo, só leitura) e a lista de Pokémon do jogo (creatures.json já carregado no painel).
ipcMain.handle('pb:route-info', async () => {
  const i = routeAccount(), wc = views[i]?.webContents, empty = { account: i, party: [], names: [], evo: {}, from: {} };
  if (!wc || wc.isDestroyed()) return empty;
  try {
    const info = await wc.executeJavaScript(`(() => {
      const party = [...document.querySelectorAll('.phud-party .phud-mon')].map(b => ({
        name: b.querySelector('.phud-name')?.textContent.trim() || '',
        level: parseInt((b.querySelector('.phud-lv')?.textContent || '').replace(/\\D/g, ''), 10) || 1,
        active: b.classList.contains('active'),
      })).filter(p => p.name);
      const list = window.__pbCache?.['/game/creatures.json']?.data?.creatures || [];
      // evo: nível da próxima evolução; from: as formas anteriores (Charmeleon -> [Charmander]).
      const evo = {}, from = {}, before = new Map(list.filter(c => c.evolvesToId).map(c => [c.evolvesToId, c]));
      for (const c of list) {
        if (!party.some(p => p.name === c.name)) continue;
        evo[c.name] = c.evolveLevel || 0;
        const line = [];
        for (let b = before.get(c.pokeId), guard = 0; b && guard < 5; b = before.get(b.pokeId), guard++) line.push(b.name);
        from[c.name] = line;
      }
      return { party, names: [...new Set(list.map(c => c.name))].sort(), evo, from };
    })()`, true);
    return { account: i, ...empty, ...info };
  } catch { return empty; }
});
ipcMain.on('pb:open-route', (_, q) => {
  const clean = cleanRoute(q);
  if (!clean) return;
  const url = `${ROUTE_ORIGIN}/hunt?${new URLSearchParams({ pokemon: clean.pokemon.toLowerCase(), level: String(clean.level), tab: 'route', routeTarget: String(clean.target) })}`;
  if (!routeWin || routeWin.isDestroyed()) {
    routeWin = new BrowserWindow({
      width: 1280, height: 900, title: 'Rota de treino · PIW Tools', icon: ICON_PATH, autoHideMenuBar: true,
      webPreferences: { partition: 'persist:piwtools', contextIsolation: true, sandbox: true, spellcheck: false },
    });
    const wc = routeWin.webContents;
    const external = u => { if (/^https?:\/\//i.test(u)) shell.openExternal(u); };
    wc.setWindowOpenHandler(({ url: u }) => { external(u); return { action: 'deny' }; });
    wc.on('will-navigate', (e, u) => { if (!u.startsWith(`${ROUTE_ORIGIN}/`) && u !== ROUTE_ORIGIN) { e.preventDefault(); external(u); } });
  }
  routeWin.loadURL(url);
  routeWin.show();
  routeWin.focus();
});

// ---------- medidor de memória (barra vermelha e cabeçalho de cada conta) ----------
// Memória em uso (working set) de cada conta, da GPU e do total, a cada 3 s. Em KB no Electron; mandamos em MB.
const METRICS_MS = 3000;
function sendMetrics() {
  if (!win || win.isDestroyed()) return;
  const all = app.getAppMetrics();
  const byPid = new Map(all.map(p => [p.pid, p]));
  const mb = p => (p ? Math.round(p.memory.workingSetSize / 1024) : 0);
  const priv = p => (p?.memory.privateBytes ? Math.round(p.memory.privateBytes / 1024) : 0);
  const pidOf = v => { try { return v.webContents.isDestroyed() ? 0 : v.webContents.getOSProcessId(); } catch { return 0; } };
  const gpu = all.find(p => p.type === 'GPU');
  win.webContents.send('pb:metrics', {
    panels: views.map(v => { const p = byPid.get(pidOf(v)); return { mb: mb(p), priv: priv(p) }; }),
    gpu: { mb: mb(gpu), priv: priv(gpu) },
    total: all.reduce((s, p) => s + mb(p), 0),
  });
}
ipcMain.on('pb:open-theme', () => shell.openPath(THEME_PATH));
ipcMain.on('pb:open-iv', e => {
  if (e.sender !== win?.webContents) return;
  if (ivWin && !ivWin.isDestroyed()) { ivWin.focus(); return; }
  ivWin = new BrowserWindow({
    parent: win, width: 520, height: 690, minWidth: 430, minHeight: 570,
    title: 'Calculadora de IV · PokeBoard', backgroundColor: '#12161E', icon: ICON_PATH,
    webPreferences: { preload: path.join(__dirname, 'preload-iv.js'), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  ivWin.setMenu(null);
  ivWin.on('closed', () => { ivWin = null; });
  ivWin.loadFile(path.join(__dirname, 'iv', 'index.html'));
});
ipcMain.on('pb:afk-start', (e, request) => {
  const slot = viewSlot(e), clean = cleanRoute(request?.route);
  if (slot === undefined || afkSessions.has(slot) || !clean) return;
  const mode = request?.mode === 'dmg' ? 'dmg' : 'safe';
  const session = { route: clean, mode, poll: null };
  afkSessions.set(slot, session);
  views[indexOfSlot(slot)].webContents.send('pb:afk-render', true);
  layout();
  win.webContents.send('pb:afk', { active: true, account: slot, message: 'Preparando a rota…' });
  views[indexOfSlot(slot)].webContents.send('pb:afk-on', { ...clean, mode });
  session.poll = setInterval(() => {
    const wc = views[indexOfSlot(slot)]?.webContents;
    if (afkSessions.get(slot) !== session || !wc || wc.isDestroyed()) return;
    wc.executeJavaScript('window.__pbRouteAfkTick?.()').catch(() => stopAfk(slot, 'Não consegui acompanhar o nível da conta.'));
  }, 5000);
});
function stopAfk(slot, message = '', preserve = false) {
  const session = afkSessions.get(slot);
  if (!session) return;
  clearInterval(session.poll);
  afkSessions.delete(slot);
  const wc = views[indexOfSlot(slot)]?.webContents;
  wc?.send(preserve ? 'pb:afk-pause' : 'pb:afk-off');
  wc?.send('pb:afk-render', false);
  layout();
  win.webContents.send('pb:afk', { active: false, account: slot, message });
}
ipcMain.on('pb:afk-stop', (e, slot) => { if (e.sender === win?.webContents && Number.isInteger(slot)) stopAfk(slot); });
ipcMain.on('pb:afk-status', (e, message) => {
  const slot = viewSlot(e);
  if (afkSessions.has(slot)) win.webContents.send('pb:afk', {
    active: true, account: slot, message: String(message).slice(0, 180),
  });
});
ipcMain.on('pb:afk-done', (e, message) => { const slot = viewSlot(e); if (afkSessions.has(slot)) stopAfk(slot, String(message).slice(0, 180)); });
ipcMain.handle('pb:iv-ocr', async (e, dataUrl) => {
  if (e.sender !== ivWin?.webContents || typeof dataUrl !== 'string' || dataUrl.length > 16_000_000) throw Error('Print inválido ou grande demais (máximo 12 MB).');
  const match = dataUrl.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Error('Use uma imagem PNG, JPG ou WebP.');
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('eng', 1, { langPath: require('@tesseract.js-data/eng').langPath, cacheMethod: 'none' });
  try { return (await worker.recognize(Buffer.from(match[1], 'base64'))).data.text.slice(0, 20000); }
  finally { await worker.terminate(); }
});
ipcMain.on('pb:rename', (_, i, name) => {
  const slot = slotAt(i);
  if (slot === undefined) return;
  state.accounts[slot].name = String(name).trim().slice(0, 24) || `Conta ${slot + 1}`;
  saveState(); layout();
});

// ---------- app ----------
// Duas instâncias abertas disputariam as mesmas pastas de sessão (persist:contaN) e quebrariam os logins.
// Atalhos não passam variáveis de ambiente: --pb-record e --pb-debug valem como PB_RECORD=1 e PB_DEBUG=1.
for (const [flag, env] of [['pb-record', 'PB_RECORD'], ['pb-debug', 'PB_DEBUG']]) if (app.commandLine.hasSwitch(flag)) process.env[env] = '1';

// Sem um ID próprio, o Windows agrupa a janela com o ícone padrão do Electron na barra de tarefas.
if (process.platform === 'win32') app.setAppUserModelId('com.matheustheis.pokeboard');

// Jogo falso + pasta temporária: permite testar outra instância sem tocar no PokeBoard que está farmando.
const isolatedMock = !!process.env.PB_GAME_URL && app.commandLine.hasSwitch('user-data-dir');
const firstInstance = isolatedMock || app.requestSingleInstanceLock();
if (!firstInstance) app.quit();
app.on('second-instance', showWindow);

// ---------- bandeja ----------
// Fechar a janela (X) esconde o PokeBoard em vez de sair: as contas continuam no jogo, como no modo AFK (sem
// desenhar). O ícone perto do relógio abre a janela de novo; "Sair" no menu dele fecha de verdade. Dá para
// desligar no mesmo menu (board.json → closeToTray). A validade da sessão é do servidor do jogo: ficar aberto
// não impede que ela expire.
let tray = null, quitting = false, trayHintShown = false;
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Abrir PokeBoard', click: showWindow },
    { label: 'Fechar a janela deixa rodando aqui', type: 'checkbox', checked: state.closeToTray,
      click: item => { state.closeToTray = item.checked; saveState(); } },
    { type: 'separator' },
    { label: 'Sair do PokeBoard', click: () => { quitting = true; app.quit(); } },
  ]);
}
function createTray() {
  tray = new Tray(ICON_PATH);
  tray.setToolTip('PokeBoard');
  tray.setContextMenu(trayMenu());
  tray.on('click', showWindow);
  tray.on('right-click', () => tray.setContextMenu(trayMenu()));  // marca a opção como está agora
}
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
  if (!firstInstance) return;
  // Formato antigo (só o token): não serve mais, a cópia agora é da sessão inteira.
  for (let n = 1; n <= MAX_ACCOUNTS; n++) fs.rmSync(path.join(app.getPath('userData'), `login-conta${n}.bin`), { force: true });
  // Sem menu: com autoHideMenuBar o Alt mostrava a barra e empurrava os painéis,
  // e atalhos como Ctrl+R agiam sobre o shell em vez do painel com foco.
  Menu.setApplicationMenu(null);
  loadState();
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 900, minHeight: 600,
    backgroundColor: '#12161E',  // --pb-screen
    title: 'PokeBoard',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-shell.js'), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.loadFile(path.join(__dirname, 'shell', 'index.html'));
  createTray();
  win.on('close', e => {
    if (quitting || !state.closeToTray) return;
    e.preventDefault();
    win.hide();
    if (!trayHintShown && process.platform === 'win32') {
      trayHintShown = true;
      tray.displayBalloon({ iconType: 'info', title: 'O PokeBoard continua rodando',
        content: 'As contas seguem no jogo. Para sair, clique com o botão direito no ícone e escolha Sair.' });
    }
  });
  if (state.focus >= state.accountCount) state.focus = 0;
  for (const slot of state.accountSlots) views.push(createView(slot));
  // 'resize' nem sempre dispara ao maximizar ou entrar em tela cheia.
  for (const ev of ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) win.on(ev, layout);
  win.webContents.on('did-finish-load', layout);
  win.webContents.on('before-input-event', handleShortcut);
  layout();
  watchTheme();
  setInterval(sendMetrics, METRICS_MS);
  if (process.env.PB_RECORD) recorder = createRecorder({ views, isGameUrl, log: m => console.log(m) });
});
app.on('window-all-closed', () => app.quit());
