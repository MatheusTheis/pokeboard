// Quando o jogo ordena Pokémon por qualidade, desempata os multiplicadores iguais pelo maior IV.
// Só muda a ordem visual dos cards já carregados; seleção, filtros e ações continuam com o jogo.
(() => {
  if (window.__pbQualityIv) return;
  window.__pbQualityIv = true;

  const fiberOf = el => {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    return key ? el[key] : null;
  };
  const qualitySort = root => !![...root.querySelectorAll('select')]
    .find(s => s.value === 'quality-desc' && [...s.options].some(o => o.value === 'quality-desc'));
  const number = s => Number(String(s).replace(',', '.'));
  const idOf = key => String(key).replace(/^(?:pk|box|store|withdraw)-/, '');

  // As linhas de trocas guardam o Pokémon nos useMemo da tela, e não nas props da linha.
  function pokesIn(list, nodes) {
    const keys = nodes.map(el => idOf(fiberOf(el)?.key ?? ''));
    let best = null, hits = 0;
    for (let f = fiberOf(list), d = 0; f && d < 50; f = f.return, d++) {
      if (typeof f.type !== 'function') continue;
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = h.memoizedState;
        const rows = Array.isArray(v?.[0]) ? v[0] : Array.isArray(v) ? v : null;
        if (!rows?.length || !rows[0] || !('id' in rows[0]) || !('quality' in rows[0])) continue;
        const ids = new Set(rows.map(p => String(p.id)));
        const matches = keys.filter(k => k && ids.has(k)).length;
        if (matches > hits) { hits = matches; best = rows; }
      }
    }
    return new Map((best || []).map(p => [String(p.id), p]));
  }
  function values(el, byId) {
    const f = fiberOf(el);
    let p = null;
    for (let n = f, d = 0; n && d < 4 && !p; n = n.return, d++) {
      const props = n.memoizedProps;
      p = props?.l?.quality != null ? props.l : props?.p?.quality != null ? props.p : null;
    }
    const key = idOf(f?.key ?? '');
    if (!p) p = byId.get(key);
    const content = `${el.title || ''} ${el.textContent || ''}`;
    const q = p?.quality ?? number(content.match(/(?:\bQ\b|\bQualidade\b)\s*[×x]?\s*(\d+[.,]\d+)/i)?.[1]);
    const iv = p?.ivTotal ?? number(content.match(/\bIV\s*(\d+)/i)?.[1]);
    return { q, iv };
  }
  function clear(list) {
    if (!list.hasAttribute('data-pb-quality-iv')) return;
    list.removeAttribute('data-pb-quality-iv');
    for (const el of list.children) if (el.hasAttribute('data-pb-quality-order')) {
      el.style.removeProperty('order');
      el.removeAttribute('data-pb-quality-order');
    }
  }
  function order(list, selector) {
    const nodes = [...list.children].filter(el => el.matches(selector));
    if (nodes.length < 2) return clear(list);
    const byId = pokesIn(list, nodes);
    const rows = nodes.map((el, i) => ({ el, i, ...values(el, byId) }));
    // O jogo já colocou a qualidade em ordem. Só trocamos os empates, inclusive quando as linhas são recriadas.
    const sorted = [...rows];
    for (let start = 0; start < rows.length;) {
      let end = start + 1;
      while (end < rows.length && Number.isFinite(rows[start].q) && rows[end].q === rows[start].q) end++;
      if (end - start > 1) sorted.splice(start, end - start, ...rows.slice(start, end).sort((a, b) =>
        (Number.isFinite(b.iv) ? b.iv : -1) - (Number.isFinite(a.iv) ? a.iv : -1) || a.i - b.i));
      start = end;
    }
    if (sorted.every((r, i) => r.i === i)) return clear(list);
    if (!list.hasAttribute('data-pb-quality-iv')) list.setAttribute('data-pb-quality-iv', '');
    sorted.forEach((r, i) => {
      const value = String(i + 1); // o cabeçalho do modo linhas do Mercado fica na posição 0
      if (r.el.style.order !== value) r.el.style.order = value;
      if (!r.el.hasAttribute('data-pb-quality-order')) r.el.setAttribute('data-pb-quality-order', '');
    });
  }
  function apply() {
    // No visual Original, os controles do jogo conservam sua ordem.
    const on = !!getComputedStyle(document.documentElement).getPropertyValue('--pb-screen').trim();
    for (const win of document.querySelectorAll('.brd-window, .dpt-window, .fam-pane, .trd-win, .mkt2-window')) {
      const pairs = [];
      if (win.matches('.brd-window')) {
        const list = win.querySelector('.brd-box');
        if (list) pairs.push([list, '.brd-box-poke', on && win.querySelector('.brd-box-sort')?.value === 'quality']);
      } else if (win.matches('.mkt2-window')) {
        if (/comprar/i.test(win.querySelector('.mkt2-tab.on .mkt2-tab-label')?.textContent || '')) {
          const selected = on && qualitySort(win.querySelector('.mkt2-toolbar-row') || win);
          for (const list of win.querySelectorAll('.mkt2-grid, .mkt2-table')) pairs.push([list, '.mkt2-card, .mkt2-trow:not(.mkt2-trow--head)', selected]);
        }
      } else {
        const bar = win.querySelector('.dpt-fbar, .trd-filters');
        const selected = on && !!bar && qualitySort(bar);
        const selector = win.matches('.fam-pane') ? '.fam-line' : win.matches('.trd-win') ? '.trd-pick' : '.dpt-poke-row';
        for (const list of win.querySelectorAll('.fam-list, .trd-picker-list, .dpt-col')) pairs.push([list, selector, selected]);
      }
      for (const [list, selector, selected] of pairs) selected ? order(list, selector) : clear(list);
    }
  }
  setInterval(apply, 700);
})();
