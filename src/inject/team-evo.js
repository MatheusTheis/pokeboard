// Equipe.
// 1. Botão de evoluir: o jogo só mostra o nível da evolução em Cerulean (fora dela, só "só em Cerulean 🔒").
//    Aqui o botão mostra sempre o destino, o nível necessário (✓ quando já chegou, senão quantos faltam e uma barra) e,
//    fora de Cerulean, a etiqueta da cidade. Só muda o que aparece: o clique e as regras continuam do jogo.
//    Nível: o mesmo cálculo do jogo — Pokémon shiny usa o evolveNeedLevel dele; os outros, o evolveLevel da espécie
//    (sem ele, o nível de hunt da evolução), do creatures.json que o jogo já carregou.
// 2. IV: a ficha mostra a qualidade, mas não o IV. Ao lado do selo da qualidade entra um selo igual com o IV total do
//    Pokémon escolhido (de 192), na cor que o jogo usa nas barras de atributo.
(() => {
  if (window.__pbTeamEvo) return;
  window.__pbTeamEvo = true;

  // Seletores do jogo (janela Equipe). Ajuste aqui quando o jogo atualizar.
  const BTN = '.team-window .team-evo-btn';
  const NAME = '.team-window .team-detail .team-name';
  const LEVEL = '.team-window .team-detail .team-lvl';   // "Nível 39 · ⚡ 544 Poder"
  const CREATURES = '/game/creatures.json';
  const CITY = /cerulean/i;                              // o sufixo "só em Cerulean" só aparece fora da cidade
  const CHECK_MS = 500;

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fiberOf = el => { const k = Object.keys(el).find(x => x.startsWith('__reactFiber$')); return k ? el[k] : null; };

  // O Pokémon selecionado, como o jogo guarda (para o shiny e o evolveNeedLevel): procura, subindo pela árvore do
  // React, uma lista de Pokémon com um que tenha o nome e o nível da ficha.
  function selectedPoke(btn, name, level) {
    const n = norm(name);
    const match = p => p && typeof p === 'object' && 'speciesId' in p && +p.level === level && [p.name, p.formName].some(x => norm(x) === n);
    for (let f = fiberOf(btn), d = 0; f && d < 40; f = f.return, d++) {
      for (const v of Object.values(f.memoizedProps || {})) if (match(v)) return v;
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = h.memoizedState;
        if (match(v)) return v;
        if (Array.isArray(v) && v.length && typeof v[0] === 'object') { const p = v.find(match); if (p) return p; }
      }
    }
    return null;
  }
  function needLevel(name, poke) {
    if (poke?.shiny) return Number(poke.evolveNeedLevel) > 0 ? Number(poke.evolveNeedLevel) : null;
    const list = window.__pbCache?.[CREATURES]?.data?.creatures || [];
    const c = (poke && list.find(x => x.pokeId === poke.speciesId)) || list.find(x => norm(x.name) === norm(name));
    if (!c?.evolvesToId) return null;
    if (Number(c.evolveLevel) > 0) return Number(c.evolveLevel);
    const to = list.find(x => x.pokeId === c.evolvesToId);
    return Math.max(1, Number(to?.huntLevel) || 1);
  }

  function apply() {
    const btn = document.querySelector(BTN);
    if (!btn) return;
    // Texto do jogo, sem o que é nosso: "⬆ Evoluir p/ Gyarados · só em Cerulean 🔒".
    let gameText = '';
    for (const n of btn.childNodes) if (n.nodeType === 3) gameText += n.textContent;
    const name = document.querySelector(NAME)?.textContent.trim() || '';
    const level = parseInt((document.querySelector(LEVEL)?.textContent || '').replace(/\D+/g, ' ').trim().split(' ')[0], 10) || 0;
    const dest = (gameText.split('·')[0] || '').replace(/^[^\p{L}]+/u, '').replace(/^\S+\s+(p\/|para|to|a)\s+/i, '').trim();
    const poke = selectedPoke(btn, name, level);
    const need = needLevel(name, poke);
    const outside = CITY.test(gameText);
    const key = `${dest}|${level}|${need}|${outside}|${btn.disabled}`;
    if (btn.dataset.pbEvo === key && btn.querySelector(':scope > .pb-evo')) return;
    let box = btn.querySelector(':scope > .pb-evo');
    if (!box) { box = document.createElement('span'); box.className = 'pb-evo'; btn.append(box); }
    const lvChip = need == null ? ''
      : level >= need ? `<span class="pb-evo-chip ok">Nv ${need} ✓</span>`
        : `<span class="pb-evo-chip">Nv ${need} · faltam ${need - level}</span>`;
    const cityChip = outside ? '<span class="pb-evo-chip lock">🔒 só em Cerulean</span>' : '';
    const bar = need != null && level < need ? `<span class="pb-evo-bar"><i style="width:${Math.max(2, Math.min(100, (level / need) * 100)).toFixed(1)}%"></i></span>` : '';
    box.innerHTML = `<span class="pb-evo-main">⬆ Evoluir para <b>${esc(dest || '?')}</b></span><span class="pb-evo-chips">${lvChip}${cityChip}</span>${bar}`;
    btn.dataset.pbEvo = key;
  }

  // ---------- IV ----------
  const TYPES = '.team-window .team-detail .dex-types';  // tipos + selo da qualidade
  const SLOT_ON = '.team-window .team-slot.on';          // o escolhido; a chave do botão é o id do Pokémon
  const IV_MAX = 192;
  // As cores das barras de atributo da ficha (dex-stat-bar), pela fração do máximo.
  const ivColor = r => (r < 0.2 ? '#f34444' : r < 0.4 ? '#ff7f0f' : r < 0.6 ? '#ffdd57' : r < 0.8 ? '#a0e515' : r < 0.95 ? '#23cd5e' : '#00c2b8');
  // O Pokémon pelo id, na lista de Pokémon que a janela guarda (a da mensagem "pokes"). A fibra do elemento pode ser a
  // do render anterior; a fila do useState é a mesma nas duas e guarda o valor atual.
  function pokeById(el, id) {
    for (let f = fiberOf(el), d = 0; f && d < 40; f = f.return, d++) {
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = h.queue ? h.queue.lastRenderedState : h.memoizedState;
        if (!Array.isArray(v) || !v.length || typeof v[0] !== 'object') continue;
        const p = v.find(x => x && typeof x === 'object' && String(x.id) === id && 'speciesId' in x);
        if (p) return p;
      }
    }
    return null;
  }
  function applyIv() {
    const types = document.querySelector(TYPES), slot = document.querySelector(SLOT_ON);
    let chip = types?.querySelector(':scope > .pb-iv');
    const id = slot && fiberOf(slot)?.key;
    const iv = id != null ? pokeById(slot, String(id))?.ivTotal : null;
    if (!types || iv == null) { chip?.remove(); return; }
    // O React põe os tipos do próximo Pokémon com append: o selo volta para o fim.
    if (chip && chip !== types.lastElementChild) types.append(chip);
    if (chip?.dataset.iv === String(iv)) return;
    if (!chip) { chip = document.createElement('span'); chip.className = 'dex-type pb-iv'; types.append(chip); }
    chip.dataset.iv = String(iv);
    chip.textContent = `IV ${iv}/${IV_MAX}`;
    chip.title = `IV total ${iv} de ${IV_MAX}`;
    chip.style.background = ivColor(iv / IV_MAX);
    chip.style.color = '#0b1420';
  }
  // Trocar de Pokémon é clique num slot: o React já desenhou quando o clique chega aqui.
  document.addEventListener('click', e => { if (e.target.closest?.('.team-window')) requestAnimationFrame(applyIv); });
  setInterval(() => { apply(); applyIv(); }, CHECK_MS);
})();
