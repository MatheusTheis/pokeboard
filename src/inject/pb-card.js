// Card de informação do PokeBoard: um modal pequeno com a ficha de um Pokémon (ou de um item).
// Usado pelo Histórico do Mercado (market-plus.js) e pelo "Derrotados" do Hunt Analyzer (game-layout.js) quando a
// Pokédex do jogo não mostra a espécie.
// Só junta dados que o jogo já baixou (creatures.json, /api/game/pokedex) e os sprites colhidos pela Pokédex+.
// Uso: window.__pbCard.open({ id | name, inst?: {...dados do anúncio...}, sale?: {...}, icon?, title? })
(() => {
  if (window.__pbCard) return;

  const CREATURES = '/game/creatures.json';
  const POKEDEX = '/api/game/pokedex';
  const TYPES = { NORMAL: 'Normal', FIRE: 'Fogo', WATER: 'Água', ELECTRIC: 'Elétrico', GRASS: 'Planta', ICE: 'Gelo',
    FIGHTING: 'Lutador', POISON: 'Venenoso', GROUND: 'Terra', FLYING: 'Voador', PSYCHIC: 'Psíquico', BUG: 'Inseto',
    ROCK: 'Pedra', GHOST: 'Fantasma', DRAGON: 'Dragão', DARK: 'Sombrio', STEEL: 'Aço', FAIRY: 'Fada' };
  const LIGHT_INK = new Set(['FIGHTING', 'POISON', 'GHOST', 'DRAGON', 'DARK']);  // chips escuros: texto branco
  const RARITY = { COMMON: 'Comum', UNCOMMON: 'Incomum', RARE: 'Raro', EPIC: 'Épico', LEGENDARY: 'Lendário', MYTHIC: 'Mítico' };
  const STATS = [['baseHp', 'HP'], ['baseAtk', 'Atk'], ['baseDef', 'Def'], ['baseSpAtk', 'SpA'], ['baseSpDef', 'SpD'], ['baseSpeed', 'Vel']];
  const INST_STATS = [['hp', 'HP'], ['atk', 'Atk'], ['def', 'Def'], ['spAtk', 'SpA'], ['spDef', 'SpD'], ['speed', 'Vel']];
  const fmt = n => Number(n || 0).toLocaleString('pt-BR');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // ---------- dados que o jogo já carregou ----------
  const cache = p => window.__pbCache?.[p]?.data;
  function species(q) {
    const list = cache(CREATURES)?.creatures || [];
    if (q.id) return list.find(c => c.pokeId === q.id) || null;
    // "Rhyhorn Lv.1" → "rhyhorn"; nomes de variantes ("Brave Charizard") também existem na lista.
    const n = norm(q.name).replace(/\s+lv\.?\s*\d+$/, '');
    return list.find(c => norm(c.name) === n) || null;
  }
  const dexEntry = id => cache(POKEDEX)?.species?.find(s => s.id === id) || null;
  // Sprite colhido pela Pokédex+ (IndexedDB "pokeboard", store "sprites", chave = pokeId).
  function sprite(id) {
    return new Promise(res => {
      try {
        const r = indexedDB.open('pokeboard', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('sprites');
        r.onerror = () => res(null);
        r.onsuccess = () => {
          try {
            const g = r.result.transaction('sprites').objectStore('sprites').get(id);
            g.onsuccess = () => res(g.result || null);
            g.onerror = () => res(null);
          } catch { res(null); }
        };
      } catch { res(null); }
    });
  }

  // ---------- montagem ----------
  const overlay = document.createElement('div');
  overlay.id = 'pb-card-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `<div id="pb-card" role="dialog" aria-modal="true" aria-labelledby="pb-card-title">
    <div class="pbc-bar"><span class="pbc-lens" aria-hidden="true"></span><h2 id="pb-card-title"></h2>
      <button type="button" class="pbc-x" aria-label="Fechar">×</button></div>
    <div class="pbc-screen"></div></div>`;
  const titleEl = overlay.querySelector('#pb-card-title'), screen = overlay.querySelector('.pbc-screen');
  let lastFocus = null;

  // O que acontece no card é nosso: cliques e teclas não chegam no jogo.
  for (const ev of ['click', 'pointerdown', 'mousedown', 'keydown', 'keyup', 'wheel']) overlay.addEventListener(ev, e => e.stopPropagation());
  overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('.pbc-x')) close(); });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  function close() {
    overlay.hidden = true;
    lastFocus?.focus?.();
  }

  const chip = t => `<span class="pbc-chip" style="background:var(--pb-type-${t.toLowerCase()});color:var(${LIGHT_INK.has(t) ? '--pb-chip-ink-light' : '--pb-chip-ink-dark'})">${TYPES[t] || esc(t)}</span>`;
  const bar = (v, max, full) => `<span class="pbc-bar-track${full ? ' is-full' : ''}"><i style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%"></i></span>`;
  const fact = (k, v) => (v === '' || v == null ? '' : `<div><dt>${k}</dt><dd>${v}</dd></div>`);

  async function open(q) {
    const sp = species(q);
    const id = sp?.pokeId || q.id || null;
    const inst = q.inst || null;
    const types = [sp?.type1 || inst?.type1, sp?.type2 || inst?.type2].filter(Boolean);
    const name = sp?.name || q.name || q.title || 'Item';
    titleEl.textContent = id && id < 1000 ? `#${String(id).padStart(3, '0')} ${name}` : name;

    let html = '';
    // Cabeçalho: sprite na "telinha" com chão na cor do tipo + fichas.
    const t1 = types[0] ? `var(--pb-type-${types[0].toLowerCase()})` : 'var(--pb-border)';
    html += `<div class="pbc-top"><div class="pbc-sprite" style="--pbc-t:${t1}"><span class="pbc-sprite-img">${q.icon ? `<img src="${esc(q.icon)}" alt="">` : '<b aria-hidden="true">?</b>'}</span></div>
      <div class="pbc-id">${types.length ? `<div class="pbc-types">${types.map(chip).join('')}${inst?.shiny ? '<span class="pbc-shiny">✦ Shiny</span>' : ''}</div>` : ''}
      <dl class="pbc-facts">${sp ? fact('Raridade', RARITY[sp.rarity] || esc(sp.rarity)) + fact('Hunt', `Nv ${fmt(sp.huntLevel)}`) + fact('Preço NPC', `$${fmt(sp.priceNpc)}`)
        + fact('Evolui', sp.evolvesToId ? `→ ${esc(species({ id: sp.evolvesToId })?.name || `#${sp.evolvesToId}`)} nv ${fmt(sp.evolveLevel)}` : '') : ''}
        ${q.facts ? q.facts.map(([k, v]) => fact(esc(k), esc(v))).join('') : ''}</dl></div></div>`;

    // Venda (Histórico do Mercado).
    if (q.sale) {
      html += `<section class="pbc-sec"><h3>Venda</h3><dl class="pbc-facts pbc-facts--row">${q.sale.map(([k, v]) => fact(esc(k), esc(v))).join('')}</dl></section>`;
    }
    // Este Pokémon (dados do anúncio: nível, IV, qualidade, poder, atributos).
    if (inst && (inst.ivTotal != null || inst.level != null)) {
      html += `<section class="pbc-sec"><h3>Este Pokémon</h3><dl class="pbc-facts pbc-facts--row">
        ${fact('Nível', inst.level != null ? fmt(inst.level) : '')}${fact('IV', inst.ivTotal != null ? `${fmt(inst.ivTotal)}/192` : '')}
        ${fact('Qualidade', inst.quality != null ? `×${Number(inst.quality).toFixed(2)}` : '')}${fact('Poder', inst.power != null ? fmt(inst.power) : '')}</dl>
        ${inst.ivTotal != null ? bar(inst.ivTotal, 192, inst.ivTotal >= 192) : ''}
        ${inst.stats ? `<div class="pbc-mini">${INST_STATS.map(([k, l]) => `<span>${l} <b>${fmt(inst.stats[k])}</b></span>`).join('')}</div>` : ''}</section>`;
    }
    // Pokédex desta conta: captura, derrotas até desbloquear, bônus de captura.
    const dx = id ? dexEntry(id) : null;
    if (sp && cache(POKEDEX)) {
      const kills = dx?.kills || 0, need = cache(POKEDEX)?.unlockKills || 100;
      html += `<section class="pbc-sec"><h3>Na sua Pokédex</h3><dl class="pbc-facts pbc-facts--row">
        ${fact('Situação', dx?.caught ? '<span class="pbc-ok">✓ Capturado</span>' : 'Não capturado')}
        ${fact('Derrotas', fmt(kills))}${fact('Desbloqueio', dx?.unlocked ? (dx.canClaim ? '<span class="pbc-claim">! Resgatar no jogo</span>' : '✓') : `${fmt(Math.min(kills, need))}/${need}`)}
        ${fact('Bônus de captura', `+${fmt(dx?.captureBonus || 0)}%`)}</dl>
        ${dx?.unlocked ? '' : bar(kills, need, false)}</section>`;
    }
    // Estatísticas base (0–150) e total.
    if (sp) {
      const total = STATS.reduce((s, [k]) => s + (sp[k] || 0), 0);
      html += `<section class="pbc-sec"><h3>Estatísticas base <span class="pbc-total">${fmt(total)}</span></h3><div class="pbc-stats">
        ${STATS.map(([k, l]) => `<span class="pbc-sl">${l}</span><span class="pbc-sv">${fmt(sp[k])}</span>${bar(sp[k] || 0, 150, false)}`).join('')}</div></section>`;
    }
    if (!sp && !inst && !q.sale) html += '<p class="pbc-empty">Sem dados deste item por aqui. Abra a Pokédex do jogo uma vez para o PokeBoard aprender os Pokémon.</p>';
    if (q.note) html += `<p class="pbc-note">${esc(q.note)}</p>`;
    screen.innerHTML = html;

    if (!overlay.isConnected) document.body.append(overlay);
    lastFocus = document.activeElement;
    overlay.hidden = false;
    overlay.querySelector('.pbc-x').focus();

    // Sprite: o ícone do próprio jogo (se veio) ou o colhido pela Pokédex+, em escala inteira.
    if (!q.icon && id) {
      const s = await sprite(id);
      const box = screen.querySelector('.pbc-sprite-img');
      if (s?.url && box) {
        const big = Math.max(s.w, s.h), k = big <= 80 ? Math.max(1, Math.floor(80 / big)) : 80 / big;
        box.innerHTML = `<img src="${s.url}" width="${Math.round(s.w * k)}" height="${Math.round(s.h * k)}" alt="">`;
      }
    }
  }

  window.__pbCard = { open, close, species };
})();
