// Pokédex+ — Pokédex com filtros, ordenação e os sprites do próprio jogo.
// Só lê dados e imagens que o jogo já carregou. Não clica em nada nem envia ações.
(() => {
  if (window.__pbxLoaded) return;
  window.__pbxLoaded = true;

  // Seletor da janela original da Pokédex. Se preenchido, ela fica escondida e a Pokédex+ abre no lugar.
  // Deixe vazio até confirmar que os sprites continuam sendo desenhados com a original escondida.
  const REPLACE_SELECTOR = '';

  const TYPES = { NORMAL:['Normal','#9A9A72'], FIRE:['Fogo','#E2742A'], WATER:['Água','#4E7FE6'], ELECTRIC:['Elétrico','#C9A40E'], GRASS:['Planta','#5FAE36'], ICE:['Gelo','#4FB3AF'], FIGHTING:['Lutador','#B32B25'], POISON:['Venenoso','#93379A'], GROUND:['Terra','#B89235'], FLYING:['Voador','#8A6FE0'], PSYCHIC:['Psíquico','#E8436F'], BUG:['Inseto','#8A9C16'], ROCK:['Pedra','#9C8A2E'], GHOST:['Fantasma','#644C85'], DRAGON:['Dragão','#5A2BE0'], DARK:['Sombrio','#5E4A3C'], STEEL:['Aço','#7F8BA0'], FAIRY:['Fada','#C46A9C'] };
  const RARITY = ['COMMON','UNCOMMON','RARE','EPIC','LEGENDARY','MYTHIC'];
  const RARITY_PT = ['Comum','Incomum','Raro','Épico','Lendário','Mítico'];
  const RARITY_PENALTY = [0, 25, 60, 150, 300, 400];  // peso na ordem "mais fáceis" (estimativa; ajuste à vontade)
  const SPRITE_BOX = 64;                              // área do sprite no card, em px

  const ui = { open: false, status: 'missing', q: '', type: '', rarity: '', sort: 'ease', maxLvl: 600, reveal: false };
  let species = null, byId = new Map(), dex = null, err = '';

  // ---------- sprites: colhidos da Pokédex original e guardados no IndexedDB do painel ----------
  const sprites = new Map(); // pokeId -> { url, w, h, shiny }
  const idb = (() => {
    let p;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('pokeboard', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('sprites');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    return {
      async loadAll() {
        const db = await open();
        return new Promise((res, rej) => {
          const out = new Map(), req = db.transaction('sprites').objectStore('sprites').openCursor();
          req.onsuccess = () => { const c = req.result; if (c) { out.set(c.key, c.value); c.continue(); } else res(out); };
          req.onerror = () => rej(req.error);
        });
      },
      async putMany(entries) {
        const db = await open();
        return new Promise((res, rej) => {
          const tx = db.transaction('sprites', 'readwrite'), st = tx.objectStore('sprites');
          for (const [k, v] of entries) st.put(v, k);
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
      },
    };
  })();
  idb.loadAll().then(m => { m.forEach((v, k) => { if (!sprites.has(k)) sprites.set(k, v); }); if (ui.open) refresh(); }).catch(() => {});

  const isBlank = c => {
    try {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 16) if (d[i] > 0) return false;
      return true;
    } catch { return true; }
  };
  let harvestTimer = 0, harvestTries = 0;
  function scheduleHarvest(delay = 250) { clearTimeout(harvestTimer); harvestTimer = setTimeout(harvest, delay); }
  function harvest() {
    const cells = document.querySelectorAll('.dex-cell');
    if (!cells.length) return;
    const fresh = []; let pending = 0;
    cells.forEach(cell => {
      if (root.contains(cell)) return;
      const id = parseInt((cell.querySelector('.dex-cell-no')?.textContent || '').replace(/\D/g, ''), 10);
      const cv = cell.querySelector('.dex-sprite canvas') || cell.querySelector('canvas');
      if (!id || !cv || !cv.width) return;
      if (isBlank(cv)) { pending++; return; }      // o jogo ainda não terminou de desenhar
      let url; try { url = cv.toDataURL('image/png'); } catch { return; }
      const shiny = !!cell.querySelector('.dex-shiny-mark');
      const old = sprites.get(id);
      if (old && old.url === url && old.shiny === shiny) return;
      const v = { url, w: cv.width, h: cv.height, shiny, at: Date.now() };
      sprites.set(id, v); fresh.push([id, v]);
    });
    if (fresh.length) { idb.putMany(fresh).catch(() => {}); if (ui.open) refresh(); }
    if (pending && harvestTries++ < 20) scheduleHarvest(600); else harvestTries = 0;
  }

  // ---------- dados ----------
  const cache = () => window.__pbCache || {};
  // Primeiro o que o hook já viu o jogo carregar (evita baixar de novo).
  // /api/game/* exige o token Bearer que só o jogo envia: um GET nosso daria 401 no console, então só cache.
  async function getJson(path, opts) {
    const hit = cache()[path]?.data;
    if (hit || path.startsWith('/api/')) return hit || null;
    try { const r = await fetch(path, opts); if (r.ok) return await r.json(); } catch {}
    return null;
  }
  async function loadData() {
    err = '';
    if (!species) {
      const c = await getJson('/game/creatures.json');
      if (c?.creatures) {
        species = c.creatures.filter(x => x.pokeId < 1000).sort((a, b) => a.pokeId - b.pokeId).map(x => ({
          id: x.pokeId, name: x.name, t1: x.type1, t2: x.type2 || '', rar: Math.max(0, RARITY.indexOf(x.rarity)),
          hunt: x.huntLevel, evoTo: x.evolvesToId || 0, evoLvl: x.evolveLevel || 0,
        }));
        byId = new Map(species.map(s => [s.id, s]));
      }
    }
    const d = await getJson('/api/game/pokedex', { headers: { Accept: 'application/json' } });
    if (d?.species) dex = d;
    if (!species) err = 'Não consegui carregar a lista de pokémons (creatures.json). Recarregue o painel.';
    else if (!dex) err = 'Ainda não tenho os dados da sua Pokédex. Abra a Pokédex do jogo uma vez e volte aqui.';
  }
  window.addEventListener('pb:data', e => {
    const hit = cache()[e.detail.path];
    if (e.detail.path.includes('/api/game/pokedex') && hit?.data?.species) {
      dex = hit.data;
      if (ui.open) { if (species) err = ''; body.querySelector('.grid') ? refresh() : render(); }
    }
  });

  // ---------- estilo (escopado em #pbx) ----------
  const css = `
  #pbx-fab{position:fixed;right:14px;bottom:14px;z-index:2147483000;background:#0F1E28;color:#D4AE5A;border:1px solid #8C7135;border-radius:4px;padding:7px 12px;font:600 13px "Segoe UI",system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.5)}
  #pbx-fab:hover{background:#152733}
  #pbx{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;background:rgba(3,8,12,.62);font:500 14px/1.4 "Segoe UI",system-ui,sans-serif;color:#E6DFC8}
  #pbx.open{display:flex}
  #pbx *{box-sizing:border-box}
  #pbx button,#pbx input,#pbx select{font:inherit;color:inherit}
  #pbx :focus-visible{outline:2px solid #D4AE5A;outline-offset:2px}
  #pbx .win{width:min(1120px,96vw);height:min(92vh,920px);display:flex;flex-direction:column;background:#0F1E28;border:1px solid #8C7135;border-radius:4px;position:relative}
  #pbx .win::before,#pbx .win::after{content:"";position:absolute;top:-5px;width:9px;height:9px;background:#D4AE5A;transform:rotate(45deg)}
  #pbx .win::before{left:-5px}#pbx .win::after{right:-5px}
  #pbx header{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid #2A3F4B}
  #pbx h2{margin:0;font:700 21px Georgia,serif;color:#D4AE5A}
  #pbx .sprinfo{flex:1;color:#8C9CA2;font-size:12.5px}
  #pbx .sprinfo.warn{color:#F0B54B}
  #pbx .x{background:none;border:none;font-size:22px;cursor:pointer;color:#8C9CA2;line-height:1;padding:2px 8px}
  #pbx .x:hover{color:#D4AE5A}
  #pbx .body{padding:12px 16px;overflow:auto;flex:1}
  #pbx .tally{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:10px}
  #pbx .tally button{background:#0B1820;border:1px solid #2A3F4B;border-radius:3px;padding:8px 6px;cursor:pointer;text-align:center}
  #pbx .tally button[aria-pressed="true"]{border-color:#D4AE5A;box-shadow:inset 0 0 0 1px #D4AE5A}
  #pbx .tally b{display:block;font:700 20px Georgia,serif}
  #pbx .tally span{color:#8C9CA2;font-size:12px}
  #pbx .tally .claim b{color:#F0B54B}
  #pbx .controls{display:grid;grid-template-columns:2fr 1.3fr 1fr 1fr 1.4fr;gap:8px;margin-bottom:8px}
  #pbx label{display:flex;flex-direction:column;gap:2px;font-size:11.5px;color:#8C9CA2}
  #pbx input[type=search],#pbx select{background:#0B1820;border:1px solid #2A3F4B;border-radius:3px;padding:7px 9px;min-width:0}
  #pbx .row2{display:flex;gap:18px;align-items:flex-end;margin-bottom:4px}
  #pbx .row2 > label:first-child{flex:1}
  #pbx .range{display:flex;align-items:center;gap:8px}
  #pbx input[type=range]{flex:1;accent-color:#D4AE5A}
  #pbx output{min-width:34px;text-align:right;color:#E6DFC8;font-weight:700}
  #pbx label.check{flex-direction:row;align-items:center;gap:6px;font-size:12.5px;color:#E6DFC8;cursor:pointer;padding-bottom:3px;white-space:nowrap}
  #pbx label.check input{accent-color:#D4AE5A;margin:0}
  #pbx .note{color:#8C9CA2;font-size:12.5px;margin:6px 0 10px}
  #pbx .note b{color:#E6DFC8}
  #pbx .err{color:#F0B54B;padding:20px 0;text-align:center}

  #pbx .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
  #pbx .card{background:#0B1820;border:1px solid #2A3F4B;border-radius:4px;overflow:hidden;display:flex;flex-direction:column}
  #pbx .card.caught{border-color:color-mix(in srgb,var(--t1) 55%,#2A3F4B)}
  #pbx .spr{position:relative;height:${SPRITE_BOX + 18}px;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(circle at 50% 62%,color-mix(in srgb,var(--t1) 34%,transparent),transparent 68%),#09141B}
  #pbx .spr img{image-rendering:pixelated;display:block}
  #pbx .card.missing .spr img{filter:brightness(0) opacity(.42)}
  #pbx.reveal .card.missing .spr img{filter:saturate(.75) opacity(.85)}
  #pbx .spr .none{color:#2F4552;font:700 26px Georgia,serif}
  #pbx .num{position:absolute;left:7px;top:5px;color:#8C9CA2;font-size:11.5px;font-weight:600}
  #pbx .flags{position:absolute;right:6px;top:5px;display:flex;gap:3px}
  #pbx .flag{font-size:11px;font-weight:700;line-height:1;padding:3px 5px;border-radius:2px}
  #pbx .flag.ok{background:#1E5E3A;color:#BFF0CF}
  #pbx .flag.claim{background:#F0B54B;color:#2A1B00}
  #pbx .flag.shiny{color:#F0D27A;padding:3px 2px}
  #pbx .info{padding:7px 9px 9px;display:flex;flex-direction:column;gap:5px;border-top:2px solid var(--t1)}
  #pbx .name{font-weight:700;font-size:15px;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #pbx .types{display:flex;gap:4px;flex-wrap:wrap}
  #pbx .type{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:2px;color:#fff;text-shadow:0 1px 0 rgba(0,0,0,.35)}
  #pbx .meta{display:flex;justify-content:space-between;font-size:12px;color:#8C9CA2}
  #pbx .meta b{color:#E6DFC8}
  #pbx .bar{height:5px;background:#2A3F4B;border-radius:3px;overflow:hidden}
  #pbx .bar i{display:block;height:100%;background:#D4AE5A}
  #pbx .bar.full i{background:#4CC27A}
  #pbx .kills{font-size:11.5px;color:#8C9CA2;margin-top:-2px}
  #pbx .evo{font-size:11.5px;color:#8C9CA2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @media (max-width:760px){#pbx .controls{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}#pbx .controls .search{grid-column:1/-1}#pbx .tally{grid-template-columns:repeat(3,minmax(0,1fr))}#pbx .row2{flex-wrap:wrap}}
  `;

  // ---------- montagem ----------
  const style = document.createElement('style'); style.id = 'pbx-style'; style.textContent = css;
  const fab = document.createElement('button'); fab.id = 'pbx-fab'; fab.type = 'button'; fab.textContent = 'Pokédex+'; fab.title = 'Abrir Pokédex+ (Alt+P)';
  const root = document.createElement('div'); root.id = 'pbx'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Pokédex+');
  root.innerHTML = `<div class="win"><header><h2>Pokédex+</h2><span class="sprinfo"></span><button class="x" type="button" aria-label="Fechar">×</button></header><div class="body"></div></div>`;
  const body = root.querySelector('.body'), sprInfo = root.querySelector('.sprinfo');

  function mount() {
    if (!document.body) return;
    if (!style.isConnected) document.head.append(style);
    if (!fab.isConnected) document.body.append(fab);
    if (!root.isConnected) document.body.append(root);
  }
  mount();
  new MutationObserver(muts => {
    mount();
    // Colhe sprites quando os cards da Pokédex original aparecem.
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && !root.contains(n) && (n.matches?.('.dex-cell') || n.querySelector?.('.dex-cell'))) { scheduleHarvest(); break; }
    }
    if (REPLACE_SELECTOR) {
      const orig = document.querySelector(REPLACE_SELECTOR);
      if (orig && orig.style.visibility !== 'hidden') { orig.style.visibility = 'hidden'; open(); }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  async function open() {
    ui.open = true; root.classList.add('open');
    harvest();
    body.innerHTML = '<p class="note">Carregando…</p>';
    await loadData(); render();
  }
  function close() {
    ui.open = false; root.classList.remove('open');
    if (REPLACE_SELECTOR) { const orig = document.querySelector(REPLACE_SELECTOR); if (orig) orig.style.visibility = ''; }
  }
  fab.addEventListener('click', () => (ui.open ? close() : open()));
  root.querySelector('.x').addEventListener('click', close);
  root.addEventListener('click', e => { if (e.target === root) close(); });
  window.addEventListener('keydown', e => {
    if (e.altKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); ui.open ? close() : open(); }
    else if (e.key === 'Escape' && ui.open) close();
  }, true);

  // ---------- render ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const STATUS = [['missing','Não capturados'],['caught','Capturados'],['claim','Recompensa para resgatar'],['near','Quase desbloqueando (50%+)'],['unlocked','Desbloqueados'],['unseen','Nunca encontrados'],['all','Todos']];
  const SORTS = [['ease','Mais fáceis primeiro (estimado)'],['hunt','Hunt level (menor primeiro)'],['progress','Mais perto de desbloquear'],['num','Número da Pokédex']];

  // render(): monta a estrutura uma vez por abertura. refresh(): atualiza números e cards sem perder o foco.
  function render() {
    if (err) { body.innerHTML = `<p class="err">${esc(err)}</p>`; return; }
    const opt = (arr, val) => arr.map(([v, l]) => `<option value="${v}"${String(v) === String(val) ? ' selected' : ''}>${l}</option>`).join('');
    const typeOpts = [['', 'Todos os tipos'], ...Object.entries(TYPES).map(([k, [l]]) => [k, l]).sort((a, b) => a[1].localeCompare(b[1]))];
    const rarOpts = [['', 'Todas'], ...RARITY_PT.map((l, i) => [i, l])];
    body.innerHTML = `
      <div class="tally"></div>
      <div class="controls">
        <label class="search">Buscar por nome ou nº<input type="search" data-k="q" value="${esc(ui.q)}" placeholder="Ex.: Pikachu ou 25"></label>
        <label>Situação<select data-k="status">${opt(STATUS, ui.status)}</select></label>
        <label>Tipo<select data-k="type">${opt(typeOpts, ui.type)}</select></label>
        <label>Raridade<select data-k="rarity">${opt(rarOpts, ui.rarity)}</select></label>
        <label>Ordenar por<select data-k="sort">${opt(SORTS, ui.sort)}</select></label>
      </div>
      <div class="row2">
        <label>Hunt level máximo<span class="range"><input type="range" data-k="maxLvl" min="1" max="600" value="${ui.maxLvl}"><output>${ui.maxLvl}</output></span></label>
        <label class="check"><input type="checkbox" data-k="reveal"${ui.reveal ? ' checked' : ''}>Mostrar cores dos não capturados</label>
      </div>
      <p class="note"></p>
      <div class="grid"></div>`;
    body.querySelectorAll('[data-k]').forEach(el => el.addEventListener('input', () => {
      const k = el.dataset.k;
      ui[k] = k === 'maxLvl' ? +el.value : k === 'reveal' ? el.checked : el.value;
      if (k === 'maxLvl') el.nextElementSibling.textContent = el.value;
      refresh();
    }));
    body.querySelector('.tally').addEventListener('click', e => {
      const b = e.target.closest('[data-status]'); if (!b) return;
      ui.status = b.dataset.status; body.querySelector('[data-k="status"]').value = ui.status; refresh();
    });
    refresh();
  }

  function refresh() {
    root.classList.toggle('reveal', ui.reveal);
    if (species) {
      const have = species.filter(s => sprites.has(s.id)).length;
      sprInfo.textContent = have >= species.length ? '' : `Imagens: ${have} de ${species.length}. Abra a Pokédex do jogo uma vez para carregar as que faltam.`;
      sprInfo.classList.toggle('warn', have < species.length);
    }
    if (err || !dex || !species) return;
    const unlockKills = dex.unlockKills || 100;
    const m = new Map(dex.species.map(s => [s.id, s]));
    const P = s => m.get(s.id) || { kills: 0, caught: false, unlocked: false, canClaim: false };

    let caught = 0, unl = 0, claim = 0, near = 0;
    for (const s of species) { const p = P(s); if (p.caught) caught++; if (p.unlocked) unl++; if (p.canClaim) claim++; if (!p.unlocked && p.kills >= unlockKills / 2) near++; }

    const q = ui.q.trim().toLowerCase();
    const list = species.filter(s => {
      const p = P(s);
      if (q && !(s.name.toLowerCase().includes(q) || String(s.id) === q.replace(/^#?0*/, ''))) return false;
      if (ui.type && s.t1 !== ui.type && s.t2 !== ui.type) return false;
      if (ui.rarity !== '' && s.rar !== +ui.rarity) return false;
      if (s.hunt > ui.maxLvl) return false;
      switch (ui.status) {
        case 'missing': return !p.caught;
        case 'caught': return p.caught;
        case 'claim': return p.canClaim;
        case 'near': return !p.unlocked && p.kills >= unlockKills / 2;
        case 'unlocked': return p.unlocked;
        case 'unseen': return !p.kills;
      }
      return true;
    });
    const ease = s => s.hunt + RARITY_PENALTY[s.rar];
    const sorters = {
      ease: (a, b) => ease(a) - ease(b) || P(b).kills - P(a).kills || a.id - b.id,
      hunt: (a, b) => a.hunt - b.hunt || a.rar - b.rar || a.id - b.id,
      progress: (a, b) => P(b).kills - P(a).kills || a.id - b.id,
      num: (a, b) => a.id - b.id,
    };
    list.sort(sorters[ui.sort]);

    const tally = [['caught', `${caught}/${species.length}`, 'Capturados'], ['missing', species.length - caught, 'Não capturados'], ['claim', claim, 'Para resgatar', 'claim'], ['near', near, 'Quase desbloqueando'], ['unlocked', unl, 'Desbloqueados']];
    body.querySelector('.tally').innerHTML = tally.map(([v, n, l, c]) => `<button type="button" data-status="${v}" class="${c || ''}" aria-pressed="${ui.status === v}"><b>${n}</b><span>${l}</span></button>`).join('');
    body.querySelector('.note').innerHTML = `Mostrando <b>${list.length}</b> de ${species.length}. “Mais fáceis” soma o hunt level com um peso pela raridade: é uma estimativa.`;
    body.querySelector('.grid').innerHTML = list.length ? list.map(s => card(s, P(s), unlockKills)).join('') : '<p class="note">Nada com esses filtros. Aumente o hunt level máximo ou troque a situação.</p>';
  }

  // Escala inteira quando o sprite cabe (pixel art nítido); se for maior que a caixa, encaixa.
  function spriteImg(sp, name) {
    const big = Math.max(sp.w, sp.h);
    const k = big <= SPRITE_BOX ? Math.max(1, Math.floor(SPRITE_BOX / big)) : SPRITE_BOX / big;
    return `<img src="${sp.url}" width="${Math.round(sp.w * k)}" height="${Math.round(sp.h * k)}" alt="${esc(name)}" loading="lazy" decoding="async">`;
  }

  function card(s, p, unlockKills) {
    const t1 = TYPES[s.t1] || [s.t1, '#888'], t2 = s.t2 ? (TYPES[s.t2] || [s.t2, '#888']) : null;
    const pct = Math.min(100, Math.round((p.kills / unlockKills) * 100));
    const sp = sprites.get(s.id);
    const evo = s.evoTo && byId.get(s.evoTo) ? `→ ${esc(byId.get(s.evoTo).name)} nv ${s.evoLvl}` : '';
    const flags = [
      sp?.shiny ? '<span class="flag shiny" title="Tem versão shiny">✦</span>' : '',
      p.canClaim ? '<span class="flag claim" title="Recompensa pronta para resgatar">Resgatar</span>' : '',
      p.caught ? '<span class="flag ok" title="Capturado">✓</span>' : '',
    ].join('');
    return `<article class="card ${p.caught ? 'caught' : 'missing'}" style="--t1:${t1[1]}">
      <div class="spr">${sp ? spriteImg(sp, s.name) : '<span class="none" aria-hidden="true">?</span>'}
        <span class="num">#${String(s.id).padStart(3, '0')}</span><span class="flags">${flags}</span></div>
      <div class="info">
        <span class="name" title="${esc(s.name)}">${esc(s.name)}</span>
        <div class="types"><span class="type" style="background:${t1[1]}">${t1[0]}</span>${t2 ? `<span class="type" style="background:${t2[1]}">${t2[0]}</span>` : ''}</div>
        <div class="meta"><span>Hunt <b>${s.hunt}</b></span><span>${RARITY_PT[s.rar]}</span></div>
        <div class="bar${pct >= 100 ? ' full' : ''}" role="img" aria-label="${p.kills} de ${unlockKills} derrotados"><i style="width:${pct}%"></i></div>
        <div class="kills">${p.kills >= unlockKills ? `${p.kills} derrotados` : `${p.kills}/${unlockKills} derrotados`}</div>
        ${evo ? `<div class="evo" title="${evo}">${evo}</div>` : ''}
      </div>
    </article>`;
  }
})();
