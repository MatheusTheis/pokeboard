// Interface do board: contas e ações na barra do topo, cabeçalho fino em cada painel.
const COLORS = ['var(--c0)', 'var(--c1)', 'var(--c2)', 'var(--c3)'];
const $ = s => document.querySelector(s);
let current = null;

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderAccounts(state) {
  const nav = $('#accounts');
  nav.innerHTML = '';
  state.accounts.slice(0, state.accountCount).forEach((a, i) => {
    const b = document.createElement('button');
    b.className = 'acc';
    b.title = `${a.name}: ampliar (Ctrl+${i + 1}) · duplo clique renomeia`;
    b.setAttribute('aria-current', String(state.layout === 'focus' && state.focus === i));
    b.innerHTML = `<span class="dot" style="background:${COLORS[i]}"></span><span class="name">${esc(a.name)}</span><span class="key">${i + 1}</span>`;
    b.onclick = () => board.focus(i);
    b.ondblclick = e => { e.preventDefault(); startRename(b, i, a.name); };
    nav.append(b);
  });
  document.querySelectorAll('[data-layout]').forEach(btn =>
    btn.setAttribute('aria-pressed', String(btn.dataset.layout === state.layout)));
  // "Original" pressionado = design original do jogo (visual PokeBoard desligado).
  $('#btnSkin').setAttribute('aria-pressed', String(state.skin === false));
  const fps = state.prefs?.fps || 0;
  $('#btnFps').textContent = fps ? `${fps} fps` : '60 fps';
  $('#btnFps').setAttribute('aria-pressed', String(!!fps));
}

function startRename(btn, i, name) {
  const span = btn.querySelector('.name');
  const input = document.createElement('input');
  input.className = 'pr-input';
  input.value = name; input.maxLength = 24;
  input.setAttribute('aria-label', 'Nome da conta');
  span.replaceWith(input); input.focus(); input.select();
  let finished = false;
  const done = ok => { if (finished) return; finished = true; if (ok) board.rename(i, input.value); else renderAccounts(current); };
  input.onkeydown = e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); };
  input.onblur = () => done(true);
  input.onclick = e => e.stopPropagation();
}

// Ícones simples (docs/design-system.md: glifos, sem emoji): ⤢ ampliar, ▦ grade, ↻ recarregar, ⌕ inspecionar.
function renderCells({ cells, state }) {
  const box = $('#cells');
  box.innerHTML = '';
  cells.forEach((c, i) => {
    if (!c.visible) return;
    const h = document.createElement('div');
    h.className = 'cell-head';
    Object.assign(h.style, { left: c.x + 'px', top: c.y + 'px', width: c.w + 'px' });
    const pct = `${Math.round(c.zoom * 100)}%`;
    const zoomTip = c.autoZoom ? `Zoom automático (${pct}), ajustado ao tamanho do painel` : `Zoom ${pct} ajustado à mão. Clique para voltar ao automático`;
    const layoutBtn = state.layout === 'grid'
      ? `<button class="ico" data-a="focus" title="Ampliar esta conta (Ctrl+${i + 1})" aria-label="Ampliar esta conta">⤢</button>`
      : `<button class="ico" data-a="grid" title="Voltar à tela dividida (Ctrl+0)" aria-label="Voltar à tela dividida">▦</button>`;
    h.innerHTML = `<span class="dot" style="background:${COLORS[i]}"></span><span class="name">${esc(state.accounts[i].name)}</span>
      <span class="zoom" role="group" aria-label="Zoom do painel">
        <button class="ico" data-a="zoom-out" aria-label="Diminuir zoom" title="Diminuir zoom (Ctrl+-)">−</button>
        <button class="ico zoom-val${c.autoZoom ? ' is-auto' : ''}" data-a="zoom-auto" aria-label="${zoomTip}" title="${zoomTip}">${pct}</button>
        <button class="ico" data-a="zoom-in" aria-label="Aumentar zoom" title="Aumentar zoom (Ctrl+=)">+</button>
      </span>
      <span class="ram" data-ram="${i}"></span>
      ${layoutBtn}
      <button class="ico" data-a="reload" title="Recarregar este painel" aria-label="Recarregar este painel">↻</button>
      <button class="ico" data-a="devtools" title="Inspecionar elementos (DevTools)" aria-label="Inspecionar elementos">⌕</button>`;
    h.onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'focus') board.focus(i);
      if (a === 'grid') board.setLayout('grid');
      if (a === 'reload') board.reload(i);
      if (a === 'devtools') board.devtools(i);
      if (a === 'zoom-in') board.zoom(i, 'in');
      if (a === 'zoom-out') board.zoom(i, 'out');
      if (a === 'zoom-auto') board.zoom(i, 'auto');
    };
    box.append(h);
  });
  showMetrics();
}

// Medidor de memória: GPU e total na barra vermelha, cada conta no cabeçalho dela. Amarelo quando passa do limite.
const RAM_WARN = { panel: 1500, gpu: 2000 };
let metrics = null;
const gb = mb => (mb >= 1000 ? `${(mb / 1024).toFixed(1).replace('.', ',')} GB` : `${mb} MB`);
function showMetrics() {
  if (!metrics) return;
  const top = $('#ram');
  top.textContent = `GPU ${gb(metrics.gpu.mb)} · Total ${gb(metrics.total)}`;
  top.classList.toggle('is-high', metrics.gpu.mb > RAM_WARN.gpu);
  document.querySelectorAll('[data-ram]').forEach(el => {
    const p = metrics.panels[+el.dataset.ram];
    if (!p) return;
    el.textContent = gb(p.mb);
    el.title = `Memória desta conta: ${p.mb} MB em uso${p.priv ? ` (${p.priv} MB reservados)` : ''}`;
    el.classList.toggle('is-high', p.mb > RAM_WARN.panel);
  });
}
board.onMetrics(m => { metrics = m; showMetrics(); });

board.onLayout(data => { current = data.state; renderAccounts(data.state); renderCells(data); });
board.getState().then(s => { current = s; renderAccounts(s); });
document.querySelectorAll('[data-layout]').forEach(b => b.onclick = () => board.setLayout(b.dataset.layout));
$('#btnReloadAll').onclick = () => board.reloadAll();
$('#btnSkin').onclick = () => board.setSkin(current?.skin === false);
// Economia: sem limite → 30 → 20 → sem limite.
const FPS_STEPS = [0, 30, 20];
$('#btnFps').onclick = () => board.setFps(FPS_STEPS[(FPS_STEPS.indexOf(current?.prefs?.fps || 0) + 1) % FPS_STEPS.length]);
$('#btnTheme').onclick = () => board.openTheme();
