// Modo carta ⇄ modo 3D com um clique na etiqueta do topo da hunt. No modo carta, a etiqueta "Modo carta" do próprio
// jogo vira botão; no 3D, uma etiqueta igual nossa, "Modo 3D", no mesmo lugar. Trocar faz o mesmo que o jogo faz em
// Configurações › Modo de batalha (setBattleView): muda o estado da tela principal e guarda em "ui:battleView".
// Em cidades e ginásios o jogo fica sempre no 3D: ali a etiqueta nossa não aparece.
(() => {
  if (window.__pbBattleView) return;
  window.__pbBattleView = true;

  // Seletores do jogo. Ajuste aqui quando o jogo atualizar.
  const ROOT = '.game-root';
  const DOCK = '.game-root .game-dock';    // só com o jogo aberto (fora do login)
  const STAGE = '.cbt-stage';             // tela do modo carta
  const TAG = '.cbt-stage > .cbt-tag';    // etiqueta "Modo carta" do jogo
  // Mapas em que o jogo fica sempre no 3D (o nome do mapa é um estado da mesma tela; ginásios são gym_*).
  const CITY_MAPS = new Set(['cerulean', 'pewter', 'viridian', 'cassino', 'arena_pvp', 'goldenrod', 'shopping']);
  const STORE = 'ui:battleView';          // onde o jogo guarda a escolha: "cards" ou "3d"
  const VIEWS = new Set(['cards', '3d']);
  const CHECK_MS = 500;

  const fiberOf = el => { const k = Object.keys(el).find(x => x.startsWith('__reactFiber$')); return k ? el[k] : null; };
  const stored = () => { try { return localStorage.getItem(STORE) === 'cards' ? 'cards' : '3d'; } catch { return '3d'; } };

  // Tela principal e a fila do useState da escolha: subindo pela árvore do React, o primeiro componente com um estado
  // "cards"/"3d"; precisa ser um só e bater com o guardado (o jogo começa com ele e guarda a cada troca).
  function findMain() {
    const want = stored();
    for (const sel of [STAGE, '.game-root .game-hud-tl', DOCK]) {
      const el = document.querySelector(sel);
      for (let f = el && fiberOf(el), d = 0; f && d < 60; f = f.return, d++) {
        if (typeof f.type !== 'function') continue;
        const hits = [];
        for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
          if (h.queue?.dispatch && VIEWS.has(h.queue.lastRenderedState)) hits.push(h.queue);
        }
        if (!hits.length) continue;
        const same = hits.filter(q => q.lastRenderedState === want);
        if (same.length === 1) return { fiber: f, queue: same[0] };
        break;  // ambíguo: não mexe
      }
    }
    return null;
  }
  // Na cidade (ou ginásio): algum estado da tela principal é o nome de um desses mapas.
  function inCity(fiber) {
    for (let h = fiber.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
      const v = h.queue?.lastRenderedState;
      if (typeof v === 'string' && (CITY_MAPS.has(v) || v.startsWith('gym_'))) return true;
    }
    return false;
  }
  function setView(v) {
    const q = findMain()?.queue;
    if (!q) { console.warn('[PokeBoard] modo carta/3D: não achei a escolha do jogo'); return; }
    q.dispatch(v);
    try { localStorage.setItem(STORE, v); } catch {}
  }

  // Etiqueta nossa do 3D: mesma classe da do jogo (mesmo visual e lugar); o resto vai inline para valer também com
  // o design original do jogo.
  const tag3d = document.createElement('div');
  tag3d.id = 'pb-view-3d';
  tag3d.className = 'cbt-tag';
  tag3d.textContent = '🧊 Modo 3D';
  const asButton = (el, title) => {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.title = title;
    Object.assign(el.style, { pointerEvents: 'auto', cursor: 'pointer' });
  };
  asButton(tag3d, 'Trocar para o modo carta');
  tag3d.style.zIndex = '8';

  setInterval(() => {
    const root = document.querySelector(ROOT), stage = document.querySelector(STAGE), gameTag = document.querySelector(TAG);
    // No modo carta escolhido por você (não o automático de aba em segundo plano), a etiqueta do jogo troca para o 3D.
    if (gameTag && stored() === 'cards' && !gameTag.hasAttribute('data-pb-view')) {
      gameTag.setAttribute('data-pb-view', 'cards');
      asButton(gameTag, 'Trocar para o modo 3D');
    }
    let show = !!root && !!document.querySelector(DOCK) && !stage && stored() === '3d';
    if (show) { const main = findMain(); show = !!main && !inCity(main.fiber); }
    if (show && tag3d.parentElement !== root) root.append(tag3d);
    else if (!show && tag3d.isConnected) tag3d.remove();
  }, CHECK_MS);

  const toggle = e => {
    const t = e.target.closest?.('#pb-view-3d, .cbt-tag[data-pb-view]');
    if (!t) return false;
    e.preventDefault();
    e.stopPropagation();
    setView(t.id === 'pb-view-3d' ? 'cards' : '3d');
    return true;
  };
  document.addEventListener('click', toggle, true);
  document.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggle(e); }, true);
})();
