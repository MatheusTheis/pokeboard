// Treinador de Prestígio: escolhe somente a próxima hunt. Captura e combate seguem com o jogo.
(() => {
  if (window.__pbPrestigeAuto) return;
  window.__pbPrestigeAuto = true;

  const PROF = '/api/game/professions', DEX = '/api/game/pokedex';
  const CREATURES = '/game/creatures.json', MARKERS = '/api/game/map-markers';
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const data = p => window.__pbCache?.[p]?.data;
  const currentHunt = () => norm((document.querySelector('.phud-tloc')?.textContent || '').split('·').pop());
  const trainerLevel = () => +(document.querySelector('.phud-tloc')?.textContent || '').match(/\d+/)?.[0] || 0;
  const title = () => document.querySelector('.prof-window .prof-hname')?.textContent || '';
  const rank = () => data(PROF)?.nextStep;
  let running = false, busy = false, target = null, lastFlash = '', lastKills = null;
  let speciesStart = 0, extraKills = Object.create(null), caughtThisRun = new Set();
  let lastLoad = 0, creatureLoading = false;
  const areaLevel = { kanto: 0, outland: 150, orre: 500, nightmare: 2000 };

  const button = document.createElement('button');
  button.id = 'pb-prestige-auto';
  button.type = 'button';
  button.title = 'Seleciona hunts para completar espécies e tipagens do próximo rank. Captura e combate continuam no jogo.';
  const status = document.createElement('div');
  status.id = 'pb-prestige-status';
  status.setAttribute('role', 'status');
  const say = s => { status.textContent = s; };
  function stop(message = 'Parado.') {
    running = false; busy = false; target = null; lastKills = null;
    button.textContent = '▶ Automatizar hunts';
    button.setAttribute('aria-pressed', 'false');
    say(message);
  }
  function start() {
    running = true;
    target = null; extraKills = Object.create(null); caughtThisRun.clear();
    lastFlash = document.querySelector('.cap-flash')?.textContent.trim() || '';
    speciesStart = +rank()?.species?.have || 0;
    button.textContent = '■ Parar automação';
    button.setAttribute('aria-pressed', 'true');
    say('Lendo requisitos e Pokédex…');
    advance();
  }
  button.addEventListener('click', () => running ? stop() : start());

  // O jogo traz esses JSON ao abrir as telas. Quando ainda não vieram, o jogador vê o que falta.
  function ready() {
    const missing = [];
    if (!rank()) missing.push('Profissões');
    if (!data(DEX)) missing.push('Pokédex');
    if (!data(CREATURES)?.creatures) missing.push('criaturas');
    if (!data(MARKERS)?.hunts) missing.push('mapa');
    if (missing.length) {
      if (!data(CREATURES)?.creatures && !creatureLoading) {
        creatureLoading = true;
        fetch(CREATURES).finally(() => { creatureLoading = false; }).catch(() => {});
      }
      if (Date.now() - lastLoad > 5000) {
        const guide = !data(DEX) ? 'dock-pokedex' : !data(MARKERS)?.hunts ? 'dock-map' : '';
        if (guide) { document.querySelector(`.dock-btn[data-guide="${guide}"]`)?.click(); lastLoad = Date.now(); }
      }
      say(`Aguardando dados: ${missing.join(', ')}.`);
      return false;
    }
    return true;
  }
  function speciesQueue() {
    const seen = new Map((data(DEX)?.species || []).map(s => [s.id, s]));
    const list = data(CREATURES).creatures.filter(c => c.pokeId < 10000);
    return list.filter(c => {
      const p = seen.get(c.pokeId);
      return !p?.unlocked && !p?.caught && !caughtThisRun.has(c.pokeId);
    }).flatMap(c => {
      const h = window.__pbDexHunts?.of(c.pokeId)?.find(x => (areaLevel[norm(x.area)] ?? Infinity) <= trainerLevel());
      return h ? [{ kind: 'catch', id: c.pokeId, h }] : [];
    }).sort((a, b) => a.h.level - b.h.level || a.id - b.id);
  }
  function typeQueue() {
    const forms = new Map(data(CREATURES).creatures.map(c => [norm(c.name), c]));
    const level = trainerLevel();
    const hunts = data(MARKERS).hunts.filter(h => h.level > 0 && (areaLevel[norm(h.area)] ?? Infinity) <= level);
    for (const req of rank()?.kills || []) {
      const have = +req.have + (extraKills[req.type] || 0);
      if (have >= +req.need) continue;
      const options = hunts.filter(h => {
        const c = forms.get(norm(h.name));
        return c && (c.type1 === req.type || c.type2 === req.type);
      }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
      if (options[0]) return { kind: 'kills', type: req.type, have, need: +req.need,
        h: { name: options[0].name, level: options[0].level, area: options[0].area } };
    }
    return null;
  }
  function pick() {
    const r = rank();
    if (Math.max(+r.species?.have || 0, speciesStart + caughtThisRun.size) < +r.species?.need) return speciesQueue()[0] || null;
    return typeQueue();
  }
  const same = (a, b) => a && b && a.kind === b.kind && a.h.name === b.h.name && a.type === b.type;
  async function advance() {
    if (!running || busy || !ready()) return;
    const next = pick();
    if (!next) { stop('Fila concluída ou sem hunt acessível. Rare Pokémon Picture fica manual.'); return; }
    if (same(next, target)) return;
    busy = true;
    try {
      const label = next.kind === 'catch' ? 'Capturar' : `Derrotar ${next.type} (${next.have}/${next.need})`;
      say(`${label}: ${next.h.name} · Nv ${next.h.level}`);
      if (next.kind === 'kills' && analyzerKills() == null) document.querySelector('.dock-btn[data-guide="dock-analyzer"]')?.click();
      if (currentHunt() !== norm(next.h.name)) {
        const ok = await window.__pbDexHunts?.travel(next.h);
        if (!ok) { stop(`Não consegui viajar para ${next.h.name}. Abra o mapa e tente de novo.`); return; }
      }
      if (!running) return;
      target = next;
      lastKills = analyzerKills();
    } catch (e) { stop(`Viagem interrompida: ${e.message}`); }
    finally { busy = false; }
  }
  function analyzerKills() {
    const card = [...document.querySelectorAll('.ha-card')].find(c => /derrotad/i.test(c.querySelector('small')?.textContent || ''));
    const n = +(card?.querySelector('b')?.textContent || '').replace(/\D/g, '');
    return Number.isFinite(n) ? n : null;
  }
  function capture() {
    const flash = document.querySelector('.cap-flash')?.textContent.trim() || '';
    if (flash === lastFlash) return;
    lastFlash = flash;
    if (!running || target?.kind !== 'catch' || !/^🎉/.test(flash) || !/capturad/i.test(flash)) return;
    const form = norm(target.h.name), base = norm(data(CREATURES)?.creatures.find(c => c.pokeId === target.id)?.name);
    const msg = norm(flash);
    if (!msg.includes(form) && !msg.includes(base)) return;
    caughtThisRun.add(target.id);
    target = null;
    setTimeout(advance, 1000);
  }
  function countKills() {
    if (!running || target?.kind !== 'kills' || currentHunt() !== norm(target.h.name)) return;
    const n = analyzerKills();
    if (n == null) { say(`Abra o Hunt Analyzer para acompanhar ${target.type}.`); return; }
    if (lastKills != null && n > lastKills) {
      const delta = n - lastKills;
      const form = data(CREATURES)?.creatures.find(c => norm(c.name) === norm(target.h.name));
      for (const type of new Set([form?.type1, form?.type2].filter(Boolean))) extraKills[type] = (extraKills[type] || 0) + delta;
      const next = pick();
      if (!same(next, target)) { target = null; setTimeout(advance, 300); }
      else say(`Derrotar ${target.type}: ${target.h.name} · ${next.have}/${next.need}`);
    }
    lastKills = n;
  }
  window.addEventListener('pb:data', e => {
    if (!running) return;
    if (e.detail?.path === PROF) { extraKills = Object.create(null); target = null; advance(); }
    if (e.detail?.path === DEX) { target = null; advance(); }
    if ([CREATURES, MARKERS].includes(e.detail?.path)) advance();
  });
  setInterval(() => {
    const task = document.querySelector('.prof-window .prof-task');
    if (task && /treinador de prest[ií]gio/i.test(title())) {
      const head = task.querySelector('.prof-task-h');
      if (head && button.parentNode !== task) head.after(button, status);
    } else { button.remove(); status.remove(); }
    if (!running) return;
    capture();
    countKills();
    if (!target && !busy) advance();
  }, 500);
})();
