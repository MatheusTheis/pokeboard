// Última hunt: ao sair de uma hunt (para outra hunt, cidade, Centro Pokémon, Mercado…), aparece à esquerda do Hunt
// Analyzer um botão com o ícone do Pokémon dela; clicar volta para lá pelo mapa do jogo. A pedido do jogador, é a
// mesma viagem do menu da Pokédex (window.__pbDexHunts): aperta Mapa, a área e o "Viajar para" da hunt.
// Indo de uma hunt para outra, o botão alterna entre as duas. Uma por conta, no localStorage do painel.
// Ícone: o Pokémon selvagem como o jogo desenha no modo carta (guardado enquanto você está na hunt); sem ele, o sprite
// colhido da Pokédex; sem os dois, as iniciais.
(() => {
  if (window.__pbLastHunt) return;
  window.__pbLastHunt = true;

  // Seletores e dados do jogo. Ajuste aqui quando o jogo atualizar.
  const LOCATION = '.game-root .phud-tloc';   // "Nível 391 · Oddish": depois do "·" é onde você está
  const ANALYZER = '.game-root .game-dock .dock-btn[data-guide="dock-analyzer"]';  // fixado no topo (game-windows.css)
  const MOB_SPRITE = '.cbt-card.cbt-mob .cbt-sprite';  // Pokémon selvagem no modo carta
  const CREATURES = '/game/creatures.json';
  const MARKERS = '/api/game/map-markers';
  const BASE_MAX_ID = 10000;                  // espécies da Pokédex; as formas (Brave, Mega…) têm id acima
  const KEY = 'pb:last-hunt:v1';
  const ICONS_KEY = 'pb:hunt-icons:v1';       // ícone guardado de cada hunt (nome → imagem)
  const ICONS_MAX = 60;
  const ICON_PX = 56;
  const CHECK_MS = 1000;

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const cached = p => window.__pbCache?.[p]?.data;
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // Hunt com esse nome: do mapa (com a área), ou o nível de hunt do creatures.json. Cidades não têm.
  function huntNamed(name) {
    const n = norm(name);
    const m = cached(MARKERS)?.hunts?.find(h => norm(h.name) === n && +h.level > 0);
    if (m) return { name: m.name, level: +m.level, area: m.area || '' };
    const c = (cached(CREATURES)?.creatures || []).find(x => norm(x.name) === n && +x.huntLevel > 0);
    return c ? { name: c.name, level: +c.huntLevel, area: '' } : null;
  }
  const hereName = () => {
    const t = document.querySelector(LOCATION)?.textContent || '';
    return t.includes('·') ? t.split('·').pop().trim() : '';
  };

  // ---------- ícone ----------
  let icons = read(ICONS_KEY, {});
  const takenNow = new Set();  // hunts com ícone tirado nesta página (uma vez cada)
  // Recorte do que está visível do sprite (o jogo usa folhas de sprite com deslocamento) num PNG pequeno.
  function snapshot(box) {
    const src = box.querySelector('canvas, img');
    if (!src || (src.tagName === 'IMG' && !(src.complete && src.naturalWidth))) return '';
    let clip = src.parentElement;
    while (clip && clip !== box && getComputedStyle(clip).overflow === 'visible') clip = clip.parentElement;
    const c = (clip || box).getBoundingClientRect(), r = src.getBoundingClientRect();
    const x0 = Math.max(c.left, r.left), y0 = Math.max(c.top, r.top), x1 = Math.min(c.right, r.right), y1 = Math.min(c.bottom, r.bottom);
    if (x1 <= x0 || y1 <= y0) return '';
    const kx = (src.naturalWidth || src.width) / r.width, ky = (src.naturalHeight || src.height) / r.height;
    const w = x1 - x0, h = y1 - y0, k = Math.min(ICON_PX / w, ICON_PX / h);
    const out = document.createElement('canvas');
    out.width = out.height = ICON_PX;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = false;
    try {
      g.drawImage(src, (x0 - r.left) * kx, (y0 - r.top) * ky, w * kx, h * ky, (ICON_PX - w * k) / 2, (ICON_PX - h * k) / 2, w * k, h * k);
      return out.toDataURL('image/png');
    } catch { return ''; }  // imagem de outra origem: sem ícone
  }
  function takeIcon(hunt) {
    const key = norm(hunt.name);
    if (takenNow.has(key)) return;
    const box = document.querySelector(MOB_SPRITE);
    const url = box && snapshot(box);
    if (!url) return;
    takenNow.add(key);
    delete icons[key];
    icons[key] = url;
    const keys = Object.keys(icons);
    for (const k of keys.slice(0, Math.max(0, keys.length - ICONS_MAX))) delete icons[k];
    write(ICONS_KEY, icons);
  }
  // Sprite colhido da Pokédex (IndexedDB "pokeboard", store "sprites", chave = pokeId da espécie base).
  function dexSprite(name) {
    const list = cached(CREATURES)?.creatures || [], n = norm(name);
    const c = list.find(x => norm(x.name) === n);
    if (!c) return Promise.resolve('');
    const id = c.pokeId < BASE_MAX_ID ? c.pokeId : (list.find(x => x.pokeId < BASE_MAX_ID && x.looktype === c.looktype)?.pokeId ?? c.pokeId);
    return new Promise(res => {
      try {
        const r = indexedDB.open('pokeboard', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('sprites');
        r.onerror = () => res('');
        r.onsuccess = () => {
          try {
            const g = r.result.transaction('sprites').objectStore('sprites').get(id);
            g.onsuccess = () => res(g.result?.url || '');
            g.onerror = () => res('');
          } catch { res(''); }
        };
      } catch { res(''); }
    });
  }

  // ---------- botão ----------
  const btn = document.createElement('button');
  btn.id = 'pb-last-hunt';
  btn.type = 'button';
  btn.hidden = true;
  btn.innerHTML = '<img alt="" hidden><span class="pblh-txt"></span>';
  const img = btn.querySelector('img'), txt = btn.querySelector('.pblh-txt');
  let shownFor = '';
  async function paint(hunt) {
    const key = norm(hunt.name);
    shownFor = key;
    const url = icons[key] || await dexSprite(hunt.name);
    if (shownFor !== key) return;
    if (url) { if (img.src !== url) img.src = url; img.hidden = false; txt.textContent = ''; }
    else { img.hidden = true; img.removeAttribute('src'); txt.textContent = hunt.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
    const where = `Nv ${hunt.level}${hunt.area ? ` · ${hunt.area.replace(/^./, c => c.toUpperCase())}` : ''}`;
    btn.title = `Voltar para a hunt ${hunt.name} (${where})`;
    btn.setAttribute('aria-label', btn.title);
  }
  let traveling = false;
  btn.addEventListener('click', async () => {
    if (traveling || !last || !window.__pbDexHunts) return;
    traveling = true;
    btn.disabled = true;
    try { await window.__pbDexHunts.travel(last); } finally { traveling = false; btn.disabled = false; }
  });

  // ---------- onde você está ----------
  let here = '';                  // lugar atual (texto do cartão do jogador)
  let last = read(KEY, null);     // última hunt de onde você saiu: { name, level, area, at }
  if (!last?.name) last = null;
  setInterval(() => {
    const at = hereName();
    if (at && at !== here) {
      const left = here && huntNamed(here);  // saiu de uma hunt: ela vira a "última"
      if (left) { last = { ...left, at: Date.now() }; write(KEY, last); }
      here = at;
    }
    const huntHere = here && huntNamed(here);
    if (huntHere) takeIcon(huntHere);

    const ha = document.querySelector(ANALYZER), r = ha?.getBoundingClientRect();
    const show = !!last && !!here && norm(last.name) !== norm(here) && !!window.__pbDexHunts && !!r && r.width > 0;
    if (!show) { if (!btn.hidden) btn.hidden = true; return; }
    const root = ha.closest('.game-root');
    if (btn.parentElement !== root) root.append(btn);  // dentro da .game-root: herda --pb-top, como o Hunt Analyzer
    if (shownFor !== norm(last.name) || (img.hidden && icons[norm(last.name)])) paint(last);
    btn.hidden = false;
    const w = `${Math.round(r.width)}px`;
    if (btn.style.getPropertyValue('--pb-ha-w') !== w) btn.style.setProperty('--pb-ha-w', w);
  }, CHECK_MS);
})();
