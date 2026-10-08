// Mapa+: filtros próprios (busca, nível, tipos) e a posição do mapa, salvos ao fechar e reabrir.
// O jogo zera os filtros e a posição sempre que o mapa fecha. Para não digitar nem clicar nos controles dele,
// os filtros do jogo ficam escondidos e os nossos mostram/escondem os marcadores; a posição volta rolando a
// área do mapa (o mesmo que arrastar). Nenhum marcador é clicado: viajar continua sendo clique seu.
(() => {
  if (window.__pbMap) return;
  window.__pbMap = true;

  // Seletores do jogo (tela do mapa). Ajuste aqui quando o jogo atualizar.
  const WIN = '.map-window';
  const TITLE = '.ds-title';          // "Mapa · Kanto": a região atual
  const BODY = '.map-body';           // nossa barra entra logo antes
  const VIEWPORT = '.map-viewport';   // overflow escondido; o jogo arrasta mudando scrollLeft/scrollTop
  const INNER = '.map-inner';
  const MARKER = '.hunt-marker';
  const NAME = '.hunt-name';
  const LVL = '.hunt-lvl';            // "Nv 20" (cidades não têm)
  const CREATURES = '/game/creatures.json';  // tipos de cada espécie (guardado pelo hook.js)
  const CHECK_MS = 700;
  const RESTORE_DELAY_MS = 400;       // depois de o jogo posicionar o mapa ao abrir, a nossa posição vale

  const TYPES = [['NORMAL', 'Normal'], ['FIRE', 'Fogo'], ['WATER', 'Água'], ['ELECTRIC', 'Elétrico'], ['GRASS', 'Planta'],
    ['ICE', 'Gelo'], ['FIGHTING', 'Lutador'], ['POISON', 'Venenoso'], ['GROUND', 'Terra'], ['FLYING', 'Voador'],
    ['PSYCHIC', 'Psíquico'], ['BUG', 'Inseto'], ['ROCK', 'Pedra'], ['GHOST', 'Fantasma'], ['DRAGON', 'Dragão'],
    ['DARK', 'Sombrio'], ['STEEL', 'Aço'], ['FAIRY', 'Fada']];
  const root = document.documentElement;

  // Estado salvo no board.json (preferência "map"), lido do <html> que o preload preenche.
  const saved = () => { try { return JSON.parse(root.dataset.pbPrefs || '{}').map || null; } catch { return null; } };
  const st = { q: '', min: null, max: null, types: [], views: {} };
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      root.dataset.pbPrefSave = JSON.stringify({ key: 'map', value: st });
      window.dispatchEvent(new Event('pb:pref-save'));
    }, 400);
  }

  // ---------- nossa barra de filtros ----------
  const bar = document.createElement('div');
  bar.id = 'pb-map-tools';
  bar.innerHTML = `
    <div class="pb-map-row">
      <input type="search" class="pb-map-q" placeholder="Buscar hunt…" aria-label="Buscar hunt pelo nome">
      <label class="pb-map-lvl">Nv
        <input type="number" min="0" class="pb-map-min" placeholder="de" aria-label="Nível mínimo">–
        <input type="number" min="0" class="pb-map-max" placeholder="até" aria-label="Nível máximo"></label>
      <button type="button" class="pb-map-clear">Limpar</button>
      <span class="pb-map-count" aria-live="polite"></span>
    </div>
    <div class="pb-map-types" role="group" aria-label="Tipos de hunt">${TYPES.map(([k, l]) =>
      `<button type="button" data-type="${k}" aria-pressed="false" style="--pb-chip:var(--pb-type-${k.toLowerCase()})">${l}</button>`).join('')}</div>`;
  const qEl = bar.querySelector('.pb-map-q'), minEl = bar.querySelector('.pb-map-min'), maxEl = bar.querySelector('.pb-map-max');
  const countEl = bar.querySelector('.pb-map-count');

  // Teclas digitadas aqui são nossas: não deixa chegarem nos atalhos do jogo.
  for (const ev of ['keydown', 'keyup', 'keypress', 'pointerdown', 'mousedown', 'click', 'wheel']) bar.addEventListener(ev, e => e.stopPropagation());
  const num = el => (el.value === '' ? null : Math.max(0, Math.floor(Number(el.value)) || 0));
  bar.addEventListener('input', () => { st.q = qEl.value.slice(0, 40); st.min = num(minEl); st.max = num(maxEl); filter(); save(); });
  bar.addEventListener('click', e => {
    const t = e.target.closest('button[data-type]')?.dataset.type;
    if (t) st.types = st.types.includes(t) ? st.types.filter(x => x !== t) : [...st.types, t];
    if (e.target.closest('.pb-map-clear')) { st.q = ''; st.min = st.max = null; st.types = []; }
    if (!t && !e.target.closest('.pb-map-clear')) return;
    syncInputs(); filter(); save();
  });
  function syncInputs() {
    qEl.value = st.q;
    minEl.value = st.min ?? '';
    maxEl.value = st.max ?? '';
    bar.querySelectorAll('button[data-type]').forEach(b => b.setAttribute('aria-pressed', String(st.types.includes(b.dataset.type))));
  }

  // ---------- filtro: esconde marcadores pelo atributo data-pb-hide (CSS em game-skin.css) ----------
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let typeMap = null;
  function typesOf(name) {
    if (!typeMap) {
      const list = window.__pbCache?.[CREATURES]?.data?.creatures;
      if (!list) return null;
      typeMap = new Map(list.map(c => [norm(c.name), [c.type1, c.type2].filter(Boolean)]));
    }
    return typeMap.get(norm(name)) || null;
  }
  function filter() {
    if (!win) return;
    const q = norm(st.q.trim());
    let shown = 0, total = 0;
    win.querySelectorAll(MARKER).forEach(m => {
      const name = (m.querySelector(NAME)?.textContent || '').trim();
      const lvl = Number((m.querySelector(LVL)?.textContent || '').replace(/\D/g, '')) || null;
      const types = typesOf(name);
      // Cidades não têm nível nem tipo: o filtro de nível não as esconde; o de tipo ("só hunts de…") sim.
      const ok = !!((!q || norm(name).includes(q))
        && (lvl === null || ((st.min === null || lvl >= st.min) && (st.max === null || lvl <= st.max)))
        && (!st.types.length || (types && types.some(t => st.types.includes(t)))));
      if (m.hasAttribute('data-pb-hide') === ok) m.toggleAttribute('data-pb-hide', !ok);
      total++; if (ok) shown++;
    });
    const txt = shown === total ? `${total} no mapa` : `${shown} de ${total}`;
    if (countEl.textContent !== txt) countEl.textContent = txt;
  }

  // ---------- posição: centro da vista em proporção, por região ----------
  const areaOf = () => norm((win?.querySelector(TITLE)?.textContent || '').split('·').pop().trim()).replace(/[^\w-]+/g, '-') || 'mapa';
  // Chamado pelo evento de rolagem e também a cada CHECK_MS (o evento depende de a janela estar desenhando).
  let lastView = '';
  function rememberView() {
    const vp = win?.querySelector(VIEWPORT), inner = win?.querySelector(INNER);
    if (!vp || !inner || !inner.offsetWidth || !inner.offsetHeight || restoring) return;
    const key = `${vp.scrollLeft},${vp.scrollTop},${inner.offsetWidth}`;
    if (key === lastView) return;
    lastView = key;
    st.views[areaOf()] = {
      cx: (vp.scrollLeft + vp.clientWidth / 2) / inner.offsetWidth,
      cy: (vp.scrollTop + vp.clientHeight / 2) / inner.offsetHeight,
    };
    save();
  }
  // Enquanto true, nada é salvo: entre abrir o mapa e restaurar, a posição padrão do jogo não pode
  // sobrescrever a sua.
  let restoring = false;
  function restoreView(tries = 10) {
    const vp = win?.querySelector(VIEWPORT), inner = win?.querySelector(INNER), v = st.views[areaOf()];
    if (!vp || !inner || !v) { restoring = false; return; }
    // A imagem do mapa define a altura: enquanto não carregou, espera um pouco e tenta de novo.
    if (!inner.offsetWidth || !inner.offsetHeight) {
      if (tries > 0) setTimeout(() => restoreView(tries - 1), 300); else restoring = false;
      return;
    }
    vp.scrollLeft = v.cx * inner.offsetWidth - vp.clientWidth / 2;
    vp.scrollTop = v.cy * inner.offsetHeight - vp.clientHeight / 2;
    lastView = `${vp.scrollLeft},${vp.scrollTop},${inner.offsetWidth}`;  // a posição restaurada não precisa ser salva de novo
    setTimeout(() => { restoring = false; }, 50);
  }

  // ---------- acompanha a janela do mapa ----------
  let win = null, mo = null, vpEl = null, area = '', pending = 0;
  const onScroll = () => { clearTimeout(onScroll.t); onScroll.t = setTimeout(rememberView, 250); };
  const schedule = () => { if (!pending) pending = setTimeout(() => { pending = 0; mount(); filter(); }, 150); };
  function mount() {
    const body = win?.querySelector(BODY);
    if (body && bar.nextElementSibling !== body) body.before(bar);
    const vp = win?.querySelector(VIEWPORT);
    if (vp !== vpEl) { vpEl?.removeEventListener('scroll', onScroll); vpEl = vp; vp?.addEventListener('scroll', onScroll, { passive: true }); }
    // Trocou de região (Kanto → Outland): volta para onde você estava nela.
    const a = areaOf();
    if (a !== area) { area = a; restoring = true; setTimeout(() => restoreView(), RESTORE_DELAY_MS); }
  }

  setInterval(() => {
    const w = document.querySelector(WIN);
    if (w === win) { if (win && area) rememberView(); return; }
    mo?.disconnect();
    win = w; area = ''; lastView = '';
    if (!win) return;
    Object.assign(st, { q: '', min: null, max: null, types: [], views: {} }, saved() || {});  // reabriu: estado salvo
    syncInputs();
    mo = new MutationObserver(schedule);
    mo.observe(win, { childList: true, subtree: true });
    mount(); filter();
  }, CHECK_MS);
})();
