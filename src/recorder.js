// Gravador (PB_RECORD=1): enquanto você joga, guarda em %APPDATA%\poke-board\debug\ material para
// reestilizar e entender o jogo: endpoints chamados, exemplos das respostas JSON, mapa do DOM de cada
// tela nova e um print dela. Só leitura: não clica nem envia nada ao jogo. Nada de /api/auth (tokens).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCAN_MS = 15000;       // de quanto em quanto tempo procura telas novas em cada painel
const PULL_MS = 10000;       // de quanto em quanto tempo copia as respostas JSON que o hook viu
const TRIGGER_MS = 2000;     // de quanto em quanto tempo olha se pediram uma captura manual
const MAX_SCREENS = 300;     // limite de telas guardadas (as mais antigas saem)
const WORLD = 1234;          // mundo isolado só para ler o DOM, separado do jogo e do preload (999)
const SECRET = /token|password|senha|secret|email|cookie|session|auth/i;

// ---------- roda dentro do painel (mundo isolado): mapa do DOM visível ----------
// Linha por elemento: tag#id.classes [x,y LxA] posição atributos "texto". Os textos são cortados.
function outlinePage() {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);
  const ATTRS = ['title', 'aria-label', 'role', 'type', 'placeholder', 'alt', 'href', 'style'];  // style: posições que o JS do jogo define
  const lines = [], classes = {}, sig = new Set();
  const own = el => {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    t = t.replace(/\s+/g, ' ').trim();
    return t.length > 40 ? t.slice(0, 40) + '…' : t;
  };
  const walk = (el, depth) => {
    if (lines.length > 5000 || SKIP.has(el.tagName) || el.id === 'pbx' || el.id === 'pbx-fab') return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    for (const c of cls) { classes[c] = (classes[c] || 0) + 1; if (r.width >= 24 && r.height >= 12) sig.add(c); }
    const attrs = ATTRS.filter(a => el.hasAttribute(a)).map(a => `${a}="${String(el.getAttribute(a)).slice(0, a === 'style' ? 90 : 40)}"`);
    const data = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `${a.name}="${a.value.slice(0, 20)}"`);
    const pos = cs.position === 'fixed' || cs.position === 'absolute' || cs.position === 'sticky' ? ` ${cs.position}` : '';
    const hidden = cs.visibility === 'hidden' || +cs.opacity === 0 ? ' (invisível)' : '';
    const t = own(el);
    lines.push(`${'  '.repeat(depth)}${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls.map(c => '.' + c).join('')}`
      + ` [${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}]${pos}${hidden}`
      + `${attrs.length ? ' ' + attrs.join(' ') : ''}${data.length ? ' ' + data.join(' ') : ''}${t ? ` "${t}"` : ''}`);
    if (/^(svg|canvas|select)$/i.test(el.tagName)) return;
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(document.body, 0);
  // Variáveis CSS do jogo (cores, tamanhos): trocar essas é o jeito mais limpo de reestilizar.
  const vars = {};
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules) {
      if (!r.style || !/(^|,)\s*(:root|html|body)\b/.test(r.selectorText || '')) continue;
      for (const p of r.style) if (p.startsWith('--')) vars[p] = r.style.getPropertyValue(p).trim();
    }
  }
  return { sig: [...sig].sort().join(' '), lines, classes, vars, w: innerWidth, h: innerHeight, url: location.pathname };
}

// ---------- roda no mundo da página: respostas JSON que o hook.js guardou desde a última leitura ----------
function takeCache(since) {
  const c = window.__pbCache || {}, out = {};
  for (const k in c) if (c[k].at > since) out[k] = c[k];
  return out;
}

// ---------- utilidades ----------
// /api/game/creature/123 → /api/game/creature/:n (agrupa endpoints que só mudam o id)
const normalize = p => p.split('/').map(s =>
  /^\d+$/.test(s) ? ':n' : /^[0-9a-f-]{16,}$/i.test(s) ? ':id' : s.length > 40 ? ':x' : s).join('/');
const slug = s => s.replace(/^\/+/, '').replace(/[^\w.-]+/g, '_').slice(0, 120) || 'raiz';
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

// Esconde valores de chaves sensíveis e corta o que for grande demais para ler.
function redact(v, depth = 0) {
  if (Array.isArray(v)) {
    const head = v.slice(0, 20).map(x => redact(x, depth + 1));
    return v.length > 20 ? [...head, `… mais ${v.length - 20} itens`] : head;
  }
  if (v && typeof v === 'object') {
    if (depth > 12) return '…';
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) ? '[oculto]' : redact(x, depth + 1)]));
  }
  if (typeof v === 'string' && v.length > 300) return v.slice(0, 300) + '…';
  return v;
}

// Formato dos dados (chaves e tipos), juntando as chaves dos itens de uma lista.
function shape(v, ind = '') {
  if (Array.isArray(v)) {
    if (!v.length) return 'lista vazia';
    const objs = v.slice(0, 200).filter(x => x && typeof x === 'object' && !Array.isArray(x));
    const sample = objs.length ? Object.assign({}, ...objs.slice().reverse()) : v[0];
    return `lista(${v.length}) de ${shape(sample, ind)}`;
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    return '{\n' + keys.map(k => `${ind}  ${k}: ${SECRET.test(k) ? '[oculto]' : shape(v[k], ind + '  ')}`).join('\n') + `\n${ind}}`;
  }
  if (typeof v === 'string') return `texto ${JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v)}`;
  return `${v === null ? 'null' : typeof v} ${v}`;
}

function createRecorder({ views, isGameUrl, log }) {
  const dir = path.join(app.getPath('userData'), 'debug');
  const sub = d => { const p = path.join(dir, d); fs.mkdirSync(p, { recursive: true }); return p; };
  const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return def; } };
  const writeJson = (f, v) => fs.writeFileSync(path.join(dir, f), JSON.stringify(v, null, 1));
  sub('.');

  const endpoints = readJson('endpoints.json', {});
  const classes = readJson('classes.json', {});
  const cssVars = readJson('css-vars.json', {});
  const seen = new Set(readJson('telas-vistas.json', []));
  const since = [];
  let dirty = false;

  // ---------- requests: o que o jogo chama, quantas vezes e com que resultado ----------
  function onRequest(i, d) {
    let u; try { u = new URL(d.url); } catch { return; }
    if (!/^(https?|wss?):$/.test(u.protocol)) return;
    // Query só com os nomes dos parâmetros: os valores podem ter tokens.
    const key = `${d.method} ${isGameUrl(d.url) ? '' : u.origin}${normalize(u.pathname)}`;
    const now = new Date().toISOString();
    const e = endpoints[key] ||= { tipo: d.resourceType, vezes: 0, status: {}, contas: [], primeira: now };
    e.vezes++;
    e.ultima = now;
    const st = d.statusCode || d.error;  // o Electron põe error = 'net::OK' até nos sucessos
    e.status[st] = (e.status[st] || 0) + 1;
    if (!e.contas.includes(i + 1)) e.contas.push(i + 1);
    const q = [...u.searchParams.keys()];
    if (q.length) e.query = [...new Set([...(e.query || []), ...q])];
    dirty = true;
  }

  // ---------- respostas JSON: um exemplo e o formato de cada endpoint ----------
  async function pull(i) {
    const wc = views[i]?.webContents;
    if (!wc || wc.isDestroyed() || !isGameUrl(wc.getURL())) return;
    let got;
    try { got = await wc.executeJavaScript(`(${takeCache})(${since[i] || 0})`); } catch { return; }
    for (const [p, v] of Object.entries(got || {})) {
      since[i] = Math.max(since[i] || 0, v.at);
      // Tokens nunca; pacotes de sprites são centenas de arquivos que não ajudam a reestilizar.
      if (p.startsWith('/api/auth/') || p.startsWith('/game/asset-packs/')) continue;
      const name = slug(normalize(p));
      try {
        fs.writeFileSync(path.join(sub('api'), `${name}.json`), JSON.stringify(redact(v.data), null, 1));
        fs.writeFileSync(path.join(sub('api'), `${name}.formato.txt`), `${p}\n(conta${i + 1}, ${new Date(v.at).toLocaleString('pt-BR')})\n\n${shape(v.data)}\n`);
      } catch (err) { log(`[gravador] falha ao salvar ${p}: ${err.message}`); }
    }
  }

  // ---------- telas: mapa do DOM + print sempre que aparece um conjunto novo de classes ----------
  async function scan(i, manual = false) {
    const view = views[i], wc = view?.webContents;
    if (!wc || wc.isDestroyed() || !view.getVisible() || !isGameUrl(wc.getURL())) return;
    let r;
    try { r = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${outlinePage})()` }]); } catch (err) { return log(`[gravador] conta${i + 1}: ${err.message}`); }
    if (!r) return;
    for (const [c, n] of Object.entries(r.classes)) {
      const k = classes[c] ||= { max: 0, contas: [] };
      k.max = Math.max(k.max, n);
      if (!k.contas.includes(i + 1)) k.contas.push(i + 1);
    }
    Object.assign(cssVars, r.vars);
    dirty = true;
    const hash = crypto.createHash('md5').update(r.url + '|' + r.sig).digest('hex').slice(0, 12);
    if (!manual && seen.has(hash)) return;
    seen.add(hash);
    const base = path.join(sub('telas'), `${stamp()}-conta${i + 1}${manual ? '-manual' : ''}`);
    const head = `${r.url} · janela ${r.w}x${r.h} · zoom ${wc.getZoomFactor()} · ${r.lines.length} elementos\n\n`;
    fs.writeFileSync(`${base}.txt`, head + r.lines.join('\n'));
    try {
      const img = await wc.capturePage();
      if (img.isEmpty()) log(`[gravador] conta${i + 1}: print vazio (janela minimizada?)`);
      else fs.writeFileSync(`${base}.png`, img.toPNG());
    } catch (err) { log(`[gravador] conta${i + 1}: print falhou (${err.message})`); }
    log(`[gravador] conta${i + 1}: tela ${manual ? 'capturada' : 'nova'} (${r.lines.length} elementos) → ${path.basename(base)}`);
    prune();
  }

  function prune() {
    const d = sub('telas');
    const txts = fs.readdirSync(d).filter(f => f.endsWith('.txt')).sort();
    for (const f of txts.slice(0, Math.max(0, txts.length - MAX_SCREENS))) {
      fs.rmSync(path.join(d, f), { force: true });
      fs.rmSync(path.join(d, f.replace(/\.txt$/, '.png')), { force: true });
    }
  }

  function flush() {
    if (!dirty) return;
    dirty = false;
    try {
      writeJson('endpoints.json', Object.fromEntries(Object.entries(endpoints).sort(([a], [b]) => a.localeCompare(b))));
      writeJson('classes.json', Object.fromEntries(Object.entries(classes).sort(([a], [b]) => a.localeCompare(b))));
      writeJson('css-vars.json', cssVars);
      writeJson('telas-vistas.json', [...seen]);
    } catch (err) { log(`[gravador] falha ao salvar resumo: ${err.message}`); }
  }

  // Captura manual: criar o arquivo debug\capturar tira print e mapa de todos os painéis visíveis.
  const trigger = path.join(dir, 'capturar');
  setInterval(() => {
    if (!fs.existsSync(trigger)) return;
    fs.rmSync(trigger, { force: true });
    views.forEach((_, i) => scan(i, true));
  }, TRIGGER_MS);
  setInterval(() => { views.forEach((_, i) => pull(i)); flush(); }, PULL_MS);
  setInterval(() => views.forEach((_, i) => scan(i)), SCAN_MS);
  app.on('before-quit', flush);
  log(`[gravador] ligado, salvando em ${dir}`);

  return { onRequest };
}

module.exports = { createRecorder };
