// Rota de treino (botão Rota na barra vermelha): janela com, para cada faixa de nível do Pokémon até o nível alvo,
// a hunt de maior dano e a mais segura. Cálculo nosso, só com o que o jogo já carregou (creatures.json: tipos,
// golpes e evolução; /api/game/map-markers: hunts, nível e área) e a tabela de tipos do jogo:
//   Dá   = melhor efetividade dos golpes de dano que o Pokémon já tem no começo da faixa contra os tipos da hunt;
//   Toma = melhor efetividade dos golpes de dano do Pokémon da hunt (no nível dela) contra os tipos do seu.
// Hunts consideradas: nível até o nível do Pokémon, nas áreas que o seu nível de treinador já abriu. A faixa troca
// quando aparece uma hunt nova ou quando o Pokémon evolui. A rota otimizada completa (XP/h, risco) é a do PIW Tools,
// pelo botão do rodapé. "Ir" e o modo AFK usam a viagem do Mapa do próprio jogo; o AFK para ao atingir o alvo.
(() => {
  if (window.__pbRoute) return;
  window.__pbRoute = true;

  const CREATURES = '/game/creatures.json';
  const MARKERS = '/api/game/map-markers';
  const LOCATION = '.game-root .phud-tloc';    // "Nível 291 · War Heracross"
  const AFK_SAVE = 'pb:route:afk:v1';
  const BASE_MAX_ID = 10000;                     // espécies da Pokédex; formas (Brave, Mega…) acima
  // Nível de treinador que libera cada área (placas do mapa: "Desbloqueia no nível …").
  const AREA_LEVEL = { kanto: 0, outland: 150, orre: 500, nightmare: 2000 };
  // Tabela de tipos do jogo (atacante → defensor; o que não está aqui é 1×).
  const CHART = {
    NORMAL: { ROCK: 0.5, GHOST: 0, STEEL: 0.5 },
    FIRE: { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 2, BUG: 2, ROCK: 0.5, DRAGON: 0.5, STEEL: 2 },
    WATER: { FIRE: 2, WATER: 0.5, GRASS: 0.5, GROUND: 2, ROCK: 2, DRAGON: 0.5 },
    ELECTRIC: { WATER: 2, ELECTRIC: 0.5, GRASS: 0.5, GROUND: 0, FLYING: 2, DRAGON: 0.5 },
    GRASS: { FIRE: 0.5, WATER: 2, GRASS: 0.5, POISON: 0.5, GROUND: 2, FLYING: 0.5, BUG: 0.5, ROCK: 2, DRAGON: 0.5, STEEL: 0.5 },
    ICE: { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 0.5, GROUND: 2, FLYING: 2, DRAGON: 2, STEEL: 0.5 },
    FIGHTING: { NORMAL: 2, ICE: 2, POISON: 0.5, FLYING: 0.5, PSYCHIC: 0.5, BUG: 0.5, ROCK: 2, GHOST: 0, DARK: 2, STEEL: 2, FAIRY: 0.5 },
    POISON: { GRASS: 2, POISON: 0.5, GROUND: 0.5, ROCK: 0.5, GHOST: 0.5, STEEL: 0, FAIRY: 2 },
    GROUND: { FIRE: 2, ELECTRIC: 2, GRASS: 0.5, POISON: 2, FLYING: 0, BUG: 0.5, ROCK: 2, STEEL: 2 },
    FLYING: { ELECTRIC: 0.5, GRASS: 2, FIGHTING: 2, BUG: 2, ROCK: 0.5, STEEL: 0.5 },
    PSYCHIC: { FIGHTING: 2, POISON: 2, PSYCHIC: 0.5, DARK: 0, STEEL: 0.5 },
    BUG: { FIRE: 0.5, GRASS: 2, FIGHTING: 0.5, POISON: 0.5, FLYING: 0.5, PSYCHIC: 2, GHOST: 0.5, DARK: 2, STEEL: 0.5, FAIRY: 0.5 },
    ROCK: { FIRE: 2, ICE: 2, FIGHTING: 0.5, GROUND: 0.5, FLYING: 2, BUG: 2, STEEL: 0.5 },
    GHOST: { NORMAL: 0, PSYCHIC: 2, GHOST: 2, DARK: 0.5 },
    DRAGON: { DRAGON: 2, STEEL: 0.5, FAIRY: 0 },
    DARK: { FIGHTING: 0.5, PSYCHIC: 2, GHOST: 2, DARK: 0.5, FAIRY: 0.5 },
    STEEL: { FIRE: 0.5, WATER: 0.5, ELECTRIC: 0.5, ICE: 2, ROCK: 2, STEEL: 0.5, FAIRY: 2 },
    FAIRY: { FIRE: 0.5, FIGHTING: 2, POISON: 0.5, DRAGON: 2, DARK: 2, STEEL: 0.5 },
  };

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
  const mult = x => `${String(x).replace('.', ',')}×`;
  const cached = p => window.__pbCache?.[p]?.data;
  const types = c => [c.type1, c.type2].filter(Boolean);
  const eff = (atk, defTypes) => defTypes.reduce((m, d) => m * (CHART[atk]?.[d] ?? 1), 1);
  // Melhor efetividade dos golpes de dano que `c` já aprendeu no nível `lvl` contra os tipos `def`.
  // Sem lista de golpes, usa os tipos do próprio Pokémon (golpe do mesmo tipo).
  function bestHit(c, lvl, def) {
    const moves = (c.attacks || []).filter(a => a.category !== 'STATUS' && (a.power || 0) > 0 && (a.learnLevel || 0) <= lvl).map(a => a.type);
    const atk = moves.length ? [...new Set(moves)] : types(c);
    return atk.length ? Math.max(...atk.map(t => eff(t, def))) : 1;
  }

  // ---------- cálculo ----------
  function compute({ pokemon, level, target }) {
    const list = cached(CREATURES)?.creatures;
    if (!list) return { error: 'A lista de Pokémon do jogo ainda não carregou. Espere o jogo abrir e tente de novo.' };
    const byName = new Map(), byId = new Map(list.map(c => [c.pokeId, c]));
    for (const c of list) if (!byName.has(norm(c.name)) || c.pokeId < BASE_MAX_ID) byName.set(norm(c.name), c);
    const start = byName.get(norm(pokemon));
    if (!start) return { error: `Não achei "${pokemon}" na lista de Pokémon do jogo.` };
    const L = Math.max(1, Math.floor(level) || 1), T = Math.max(L + 1, Math.floor(target) || L + 1);
    const trainer = parseInt((document.querySelector(LOCATION)?.textContent || '').replace(/\D+/g, ' ').trim().split(' ')[0], 10) || 0;

    // Evoluções no caminho: o Pokémon muda de forma (tipos e golpes) no nível de evolução.
    const chain = [{ c: start, from: L }];
    for (let c = start, guard = 0; c.evolvesToId && c.evolveLevel && guard < 5; guard++) {
      const next = byId.get(c.evolvesToId);
      if (!next || c.evolveLevel >= T) break;
      chain.push({ c: next, from: Math.max(L, c.evolveLevel) });
      c = next;
    }
    const formAt = lvl => chain.filter(x => x.from <= lvl).pop().c;

    // Hunts: as do mapa (com área); sem elas, o nível de hunt de cada Pokémon.
    const markers = cached(MARKERS)?.hunts;
    const hunts = (markers
      ? markers.map(h => ({ name: h.name, level: +h.level || 0, area: h.area || '', c: byName.get(norm(h.name)) }))
      : list.map(c => ({ name: c.name, level: +c.huntLevel || 0, area: '', c })))
      .filter(h => h.c && h.level > 0 && (!h.area || trainer >= (AREA_LEVEL[norm(h.area)] ?? Infinity)));
    if (!hunts.length) return { error: 'Não achei hunts liberadas para o seu nível de treinador.' };

    // Faixas: começam no nível atual, numa hunt nova (nível dela) ou numa evolução, e vão até o alvo.
    const cuts = new Set([L, T, ...chain.map(x => x.from), ...hunts.map(h => h.level).filter(l => l > L && l < T)]);
    const bounds = [...cuts].filter(x => x >= L && x <= T).sort((a, b) => a - b);
    const ranges = [];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const a = bounds[k], b = bounds[k + 1], me = formAt(a);
      const options = hunts.filter(h => h.level <= a).map(h => ({
        ...h,
        give: bestHit(me, a, types(h.c)),
        take: bestHit(h.c, h.level, types(me)),
      }));
      if (!options.length) { ranges.push({ a, b, me, none: true }); continue; }
      // Maior dano: dano × nível da hunt (mais dano em hunt mais alta rende mais); empate: toma menos.
      const dmg = [...options].sort((x, y) => y.give * y.level - x.give * x.level || x.take - y.take || y.level - x.level)[0];
      // Mais segura: toma menos; empate: maior dano × nível.
      const safe = [...options].sort((x, y) => x.take - y.take || y.give * y.level - x.give * x.level || y.level - x.level)[0];
      ranges.push({ a, b, me, dmg, safe });
    }
    // Faixas seguidas com as mesmas escolhas viram uma só.
    const merged = [];
    for (const r of ranges) {
      const prev = merged[merged.length - 1];
      if (prev && !r.none && !prev.none && prev.me === r.me && prev.dmg.name === r.dmg.name && prev.safe.name === r.safe.name) prev.b = r.b;
      else merged.push({ ...r });
    }
    return { start, L, T, trainer, ranges: merged, fromMap: !!markers };
  }

  // ---------- sprites colhidos pela Pokédex+ (IndexedDB "pokeboard", store "sprites", chave = pokeId da espécie) ----------
  let spriteDb = null;
  function sprites() {
    return spriteDb || (spriteDb = new Promise(res => {
      try {
        const r = indexedDB.open('pokeboard', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('sprites');
        r.onsuccess = () => {
          const out = new Map(), req = r.result.transaction('sprites').objectStore('sprites').openCursor();
          req.onsuccess = () => { const cur = req.result; if (cur) { out.set(cur.key, cur.value?.url); cur.continue(); } else res(out); };
          req.onerror = () => res(out);
        };
        r.onerror = () => res(new Map());
      } catch { res(new Map()); }
    }));
  }
  // Formas (Brave, Mega…) usam o sprite da espécie base: mesmo looktype.
  function baseIdOf(c) {
    if (c.pokeId < BASE_MAX_ID) return c.pokeId;
    const base = (cached(CREATURES)?.creatures || []).find(x => x.pokeId < BASE_MAX_ID && x.looktype === c.looktype);
    return base?.pokeId ?? c.pokeId;
  }

  // ---------- janela ----------
  const overlay = document.createElement('div');
  overlay.id = 'pb-route-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `<section id="pb-route" role="dialog" aria-modal="true" aria-labelledby="pb-route-title">
    <header class="pb-route-head"><div><h2 id="pb-route-title">Rota de treino</h2><p class="pb-route-sub"></p></div>
      <button type="button" class="pb-route-x" aria-label="Fechar">×</button></header>
    <div class="pb-route-body"></div>
    <footer class="pb-route-foot">
      <p>Estimativa do PokeBoard pelos tipos dos golpes. A rota otimizada (XP por hora, risco e evolução) é a do PIW Tools.</p>
      <div class="pb-route-actions"><label>Prioridade <select class="pb-route-mode"><option value="dmg">Maior dano</option><option value="safe">Mais segura</option></select></label>
        <button type="button" class="pb-route-afk">Iniciar AFK nesta rota</button>
        <button type="button" class="pb-route-piw">PIW Tools</button></div>
    </footer></section>`;
  // Cliques e teclas aqui são nossos: não chegam nos atalhos do jogo.
  for (const ev of ['keydown', 'keyup', 'keypress', 'pointerdown', 'mousedown', 'click', 'wheel']) overlay.addEventListener(ev, e => e.stopPropagation());
  let last = null, lastResult = null, afkPlan = null, afkTimer = 0, lastAfkStatus = '';
  let savedAfk = null, resuming = false, lastHunt = '';
  try { savedAfk = JSON.parse(localStorage.getItem(AFK_SAVE) || 'null'); } catch {}
  const forgetAfk = () => { savedAfk = null; try { localStorage.removeItem(AFK_SAVE); } catch {} };
  const close = () => { overlay.hidden = true; };
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('.pb-route-x')) close();
    if (e.target.closest('.pb-route-piw') && last) {
      document.documentElement.dataset.pbRoutePiw = JSON.stringify(last);
      window.dispatchEvent(new Event('pb:route-piw'));  // o preload leva ao main, que abre o PIW Tools
    }
    if (e.target.closest('.pb-route-afk') && last && lastResult && !lastResult.error) {
      document.documentElement.dataset.pbAfkStart = JSON.stringify({ route: last, mode: overlay.querySelector('.pb-route-mode').value });
      window.dispatchEvent(new Event('pb:afk-start'));
      close();
    }
    const go = e.target.closest('[data-route-go]');
    if (go && lastResult && !lastResult.error) {
      const [row, kind] = go.dataset.routeGo.split(':');
      const h = lastResult.ranges[+row]?.[kind];
      if (h) { close(); window.__pbDexHunts?.travel(h); }
    }
  });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  overlay.addEventListener('change', e => { if (e.target.matches('.pb-route-mode')) overlay.dataset.mode = e.target.value; });

  const chip = (kind, x) => {
    const tone = kind === 'give' ? (x > 1 ? 'good' : x < 1 ? 'bad' : 'even') : (x < 1 ? 'good' : x > 1 ? 'bad' : 'even');
    return `<span class="pb-route-chip" data-tone="${tone}">${kind === 'give' ? 'Dá' : 'Toma'} ${mult(x)}</span>`;
  };
  const hunt = (labels, h, spr, kind, row) => `<div class="pb-route-hunt" data-kind="${kind}">
      <span class="pb-route-spr">${spr ? `<img src="${spr}" alt="">` : ''}</span>
      <div><div class="pb-route-kind">${labels}</div>
        <div class="pb-route-line"><b>${esc(h.name)}</b>${chip('give', h.give)}${chip('take', h.take)}</div>
        <div class="pb-route-where">Hunt nível ${h.level}${h.area ? ` · ${esc(cap(h.area))}` : ''}</div></div>
      <button type="button" class="pb-route-go" data-route-go="${row}:${kind === 'both' ? 'safe' : kind}" title="Viajar para esta hunt pelo mapa">Ir</button></div>`;

  async function open(q) {
    last = q;
    const r = compute(q);
    lastResult = r;
    overlay.dataset.mode = overlay.querySelector('.pb-route-mode').value;
    const body = overlay.querySelector('.pb-route-body'), sub = overlay.querySelector('.pb-route-sub');
    if (!overlay.isConnected) document.body.append(overlay);
    overlay.hidden = false;
    overlay.querySelector('.pb-route-x').focus();
    if (r.error) { sub.textContent = q.pokemon || ''; body.innerHTML = `<p class="pb-route-msg">${esc(r.error)}</p>`; return; }
    sub.textContent = `${r.start.name} · Nv ${r.L} → ${r.T}${r.trainer ? ` · Treinador Nv ${r.trainer}` : ''}`;
    const spr = await sprites();
    const img = c => spr.get(baseIdOf(c)) || '';
    body.innerHTML = r.ranges.map((x, i) => `<div class="pb-route-row">
        <div class="pb-route-range"><span>${x.a} → ${x.b}</span>${x.me !== r.start ? `<small>${esc(x.me.name)}</small>` : ''}</div>
        <div class="pb-route-hunts">${x.none ? '<p class="pb-route-msg">Nenhuma hunt liberada até este nível.</p>'
          : x.dmg.name === x.safe.name ? hunt('Maior dano · Mais segura', x.dmg, img(x.dmg.c), 'both', i)
            : hunt('Maior dano', x.dmg, img(x.dmg.c), 'dmg', i) + hunt('Mais segura', x.safe, img(x.safe.c), 'safe', i)}</div></div>`).join('')
      + (r.fromMap ? '' : '<p class="pb-route-msg">Sem a lista de hunts do mapa ainda: usei o nível de hunt de cada Pokémon, sem área.</p>');
  }
  window.addEventListener('pb:route-open', () => {
    try { open(JSON.parse(document.documentElement.dataset.pbRoute || '{}')); } catch {}
  });
  const current = () => {
    const mon = document.querySelector('.phud-mon.active');
    return { name: norm(mon?.querySelector('.phud-name')?.textContent),
      level: +(mon?.querySelector('.phud-lv')?.textContent || '').match(/\d+/)?.[0] || 0,
      location: norm((document.querySelector(LOCATION)?.textContent || '').split('·').pop()) };
  };
  function status(message) {
    if (message === lastAfkStatus) return;
    lastAfkStatus = message;
    document.documentElement.dataset.pbAfkStatus = message;
    window.dispatchEvent(new Event('pb:afk-status'));
  }
  function finish(message) {
    clearInterval(afkTimer); afkTimer = 0; afkPlan = null;
    forgetAfk(); lastHunt = '';
    document.documentElement.dataset.pbAfkDone = message;
    window.dispatchEvent(new Event('pb:afk-done'));
  }
  let moving = false, expected = '', moveAt = 0, missingSince = 0;
  async function afkTick() {
    const plan = afkPlan;
    if (!plan || moving) return;
    const now = current();
    if (!now.level) {
      missingSince ||= Date.now();
      if (Date.now() - missingSince > 30000) return finish('Não encontrei o Pokémon ativo por 30 segundos.');
      return status('Aguardando o nível do Pokémon ativo…');
    }
    missingSince = 0;
    const names = new Set([norm(plan.r.start.name), ...plan.r.ranges.map(x => norm(x.me.name))]);
    if (!names.has(now.name)) return finish('O Pokémon ativo mudou. Modo AFK encerrado.');
    if (lastHunt && now.location && now.location !== norm(lastHunt) && now.location !== norm(expected))
      return finish(`Você saiu da hunt ${lastHunt}. Modo AFK encerrado.`);
    if (now.level >= plan.r.T) return finish(`Alvo Nv ${plan.r.T} alcançado.`);
    const step = plan.r.ranges.find(x => x.a <= now.level && now.level < x.b);
    if (!step || step.none) return finish(`Sem hunt para o Nv ${now.level}.`);
    const hunt = step[plan.mode];
    if (expected && now.location !== norm(expected)) {
      if (Date.now() - moveAt > 20000) return finish(`Não confirmei a viagem para ${expected}.`);
      return status(`Viajando para ${expected}…`);
    }
    expected = '';
    if (now.location === norm(hunt.name)) {
      lastHunt = hunt.name;
      try { localStorage.setItem(AFK_SAVE, JSON.stringify({ route: plan.q, mode: plan.mode, hunt: hunt.name, name: now.name })); } catch {}
      return status(`${now.name || plan.r.start.name} · Nv ${now.level}/${plan.r.T} · ${hunt.name} (próxima troca no Nv ${step.b})`);
    }
    moving = true;
    status(`Nv ${now.level}: viajando para ${hunt.name}…`);
    try {
      const ok = await window.__pbDexHunts?.travel(hunt);
      if (!afkPlan) return;
      if (!ok) return finish(`Não consegui viajar para ${hunt.name}.`);
      expected = hunt.name; moveAt = Date.now();
    } catch (e) { finish(`Viagem interrompida: ${e.message}`); }
    finally { moving = false; }
  }
  window.addEventListener('pb:afk-on', () => {
    try {
      const q = JSON.parse(document.documentElement.dataset.pbAfkRoute || '{}');
      const r = compute(q);
      if (r.error) return finish(r.error);
      afkPlan = { r, q: { pokemon: q.pokemon, level: q.level, target: q.target }, mode: q.mode === 'dmg' ? 'dmg' : 'safe' };
      savedAfk = null; resuming = false;
      expected = ''; moving = false; missingSince = 0; lastAfkStatus = ''; lastHunt = '';
      clearInterval(afkTimer);
      afkTimer = setInterval(afkTick, 15000); // reserva para quando a janela do jogo voltar ao primeiro plano
      afkTick();
    } catch (e) { finish(`Não consegui iniciar a rota: ${e.message}`); }
  });
  window.addEventListener('pb:afk-off', () => { clearInterval(afkTimer); afkTimer = 0; afkPlan = null; expected = ''; forgetAfk(); });
  window.addEventListener('pb:afk-pause', () => { clearInterval(afkTimer); afkTimer = 0; afkPlan = null; expected = ''; });
  setInterval(() => {
    if (!savedAfk?.hunt || afkPlan || resuming) return;
    const now = current();
    if (!now.level || !now.location) return;
    if (now.location !== norm(savedAfk.hunt) || now.name !== savedAfk.name) { forgetAfk(); return; }
    if (!cached(CREATURES)?.creatures || !cached(MARKERS)?.hunts) return;
    resuming = true;
    document.documentElement.dataset.pbAfkStart = JSON.stringify({ route: savedAfk.route, mode: savedAfk.mode });
    window.dispatchEvent(new Event('pb:afk-start'));
  }, 2000);
  window.__pbRouteAfkTick = afkTick; // o processo principal consulta a cada 5 s mesmo com o painel oculto
  window.__pbRouteCompute = compute;  // para testes
})();
