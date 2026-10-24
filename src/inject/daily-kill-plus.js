// Daily Kill: botão "Ir à hunt" em cada Pokémon do dia, que viaja até uma hunt dele pelo mapa do jogo. A pedido do
// jogador, é a mesma viagem do menu da Pokédex (window.__pbDexHunts, em pokedex-game.js): aperta os botões que ele
// apertaria (Mapa, a área e o "Viajar para" da hunt). Cada carta é de uma forma (Pinsir e Ancient Pinsir são cartas
// e contagens diferentes), então vale só a hunt com o mesmo nome da carta e o botão vai direto para ela. Só se o mapa
// não tiver hunt com esse nome, ficam as da espécie, com um menu para escolher. Áreas que o nível de treinador ainda
// não abriu aparecem bloqueadas.
(() => {
  if (window.__pbDailyKill) return;
  window.__pbDailyKill = true;

  // Seletores do jogo (janela Daily Kill). Ajuste aqui quando o jogo atualizar.
  const WIN = '.dk-window';
  const CARD = '.dk-grid > .dk-card';
  const NUMBER = '.dk-card-no';                // "#025": número da espécie
  const NAME = '.dk-card-name';
  const LOCATION = '.game-root .phud-tloc';    // "Nível 290 · Sneasel": nível de treinador e hunt atual
  const AREA_LEVEL = { kanto: 0, outland: 150, orre: 500, nightmare: 2000 };  // nível de treinador que abre cada área
  const CHECK_MS = 800;

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = s => String(s || '').replace(/^./, c => c.toUpperCase());
  const trainerLevel = () => +(document.querySelector(LOCATION)?.textContent || '').match(/\d+/)?.[0] || 0;
  const hereName = () => norm((document.querySelector(LOCATION)?.textContent || '').split('·').pop());
  const speciesOf = card => parseInt((card.querySelector(NUMBER)?.textContent || '').replace(/\D/g, ''), 10) || 0;

  // Hunt da carta (mesmo nome); a forma com número próprio é procurada pelo nome no mapa. Sem nenhuma com esse nome,
  // as hunts da espécie. Marca as de área ainda fechada e a hunt onde você está.
  const MARKERS = '/api/game/map-markers';
  function huntsOf(card) {
    const lv = trainerLevel(), here = hereName(), name = norm(card.querySelector(NAME)?.textContent);
    const all = window.__pbDexHunts?.of(speciesOf(card)) || [];
    let list = all.filter(h => norm(h.name) === name);
    if (!list.length) {
      const byName = (window.__pbCache?.[MARKERS]?.data?.hunts || []).filter(h => norm(h.name) === name && +h.level > 0);
      list = byName.length ? byName.map(h => ({ name: h.name, level: +h.level, area: h.area || '' })) : all;
    }
    return list.map(h => ({
      h,
      locked: !!h.area && (AREA_LEVEL[norm(h.area)] ?? Infinity) > lv,
      here: norm(h.name) === here,
    }));
  }
  const label = h => `Nv ${h.level}${h.area ? ` · ${cap(h.area)}` : ''}`;

  // ---------- menu de hunts ----------
  const menu = document.createElement('div');
  menu.id = 'pb-dk-menu';
  menu.setAttribute('role', 'menu');
  let menuHunts = [], menuFor = null;
  const closeMenu = () => menu.remove();
  function openMenu(btn, name, hunts) {
    menuHunts = hunts;
    menuFor = btn;
    menu.innerHTML = `<div class="pb-dk-menu-h">Viajar para a hunt<small>${esc(name)}</small></div>` + (hunts.length
      ? hunts.map((x, i) => {
        const why = x.here ? ' · você está aqui' : x.locked ? ` · área bloqueada (Nv ${AREA_LEVEL[norm(x.h.area)]})` : '';
        return `<button type="button" role="menuitem" data-i="${i}"${x.here || x.locked ? ' disabled' : ''}><b>${esc(x.h.name)}</b><span>${esc(label(x.h) + why)}</span></button>`;
      }).join('')
      : `<p>Nenhuma hunt de ${esc(name)} no mapa.</p>`);
    document.body.append(menu);
    const r = btn.getBoundingClientRect(), m = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(r.left, innerWidth - m.width - 4))}px`;
    menu.style.top = `${r.bottom + 4 + m.height > innerHeight - 4 ? Math.max(4, r.top - 4 - m.height) : r.bottom + 4}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  menu.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const x = menuHunts[+b.dataset.i];
    closeMenu();
    if (x) travel(x.h);
  });
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenu(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  });
  document.addEventListener('pointerdown', e => { if (menu.isConnected && !menu.contains(e.target) && !e.target.closest?.('.pb-dk-go')) closeMenu(); }, true);

  let traveling = false;
  async function travel(h) {
    if (traveling || !window.__pbDexHunts) return;
    traveling = true;
    try { await window.__pbDexHunts.travel(h); } finally { traveling = false; }
  }

  // ---------- botão em cada card ----------
  function go(card, btn) {
    const name = card.querySelector(NAME)?.textContent.trim() || `#${speciesOf(card)}`;
    const hunts = huntsOf(card), open = hunts.filter(x => !x.locked && !x.here);
    if (open.length === 1 && hunts.length === 1) travel(open[0].h);
    else openMenu(btn, name, hunts);
  }
  function apply(win) {
    for (const card of win.querySelectorAll(CARD)) {
      let btn = card.querySelector(':scope > .pb-dk-go');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pb-dk-go';
        btn.addEventListener('click', e => {
          e.stopPropagation();
          if (menu.isConnected && menuFor === btn) closeMenu(); else go(card, btn);
        });
        card.append(btn);
      }
      const name = card.querySelector(NAME)?.textContent.trim() || '';
      const hunts = huntsOf(card), open = hunts.filter(x => !x.locked);
      const text = !hunts.length ? 'Sem hunt no mapa'
        : hunts.length === 1 ? (open.length ? (open[0].here ? 'Você está na hunt' : `Ir à hunt · Nv ${open[0].h.level}`) : 'Hunt bloqueada')
        : `Ir à hunt (${hunts.length}) ▾`;
      if (btn.textContent !== text) btn.textContent = text;
      const title = `Viajar para a hunt de ${name} pelo mapa do jogo`;
      if (btn.title !== title) btn.title = title;
      const off = !hunts.length || traveling || (hunts.length === 1 && (!open.length || open[0].here));
      if (btn.disabled !== off) btn.disabled = off;
    }
  }
  setInterval(() => {
    const win = document.querySelector(WIN);
    if (win) apply(win);
    else if (menu.isConnected) closeMenu();
  }, CHECK_MS);
})();
