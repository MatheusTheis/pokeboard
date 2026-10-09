// Pokédex+ — Pokédex com filtros, ordenação e os sprites do próprio jogo.
// Só lê dados e imagens que o jogo já carregou. Não clica em nada nem envia ações.
// No fim do arquivo, os extras dentro da Pokédex do próprio jogo (filtros, ordem por hunt, viajar para a hunt).
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
      if (root.contains(cell) || cell.hasAttribute('data-pb-clone')) return;  // cópias da ordem por hunt (abaixo)
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

// Pokédex do jogo (.dex-window): extras do PokeBoard.
// - "Bloqueados" e "Desbloqueados" na faixa de números filtram a grade, como "Capturados" já faz no jogo.
// - Ordem por nível da hunt, ao lado do filtro de tipo. A espécie com mais de uma hunt (Blastoise Nv 80 em Kanto,
//   Brave Blastoise Nv 150 em Outland) aparece uma vez por hunt; as cópias abrem a mesma ficha, porque abates e
//   capturas de todas as formas contam juntos na espécie.
// - Botão direito num card: escolher uma hunt da espécie e viajar até ela pelo mapa do jogo. A pedido do jogador,
//   aperta os mesmos botões que ele apertaria (Mapa, a área e o "Viajar para" da hunt).
// - Captura com a Pokédex aberta: ela se atualiza sem fechar (abaixo, "captura").
// A grade continua sendo a do jogo: a ordem é só CSS (order) e as cópias são nossas, marcadas com data-pb-clone.
(() => {
  if (window.__pbDexGame) return;
  window.__pbDexGame = true;

  // Seletores do jogo. Ajuste aqui quando o jogo atualizar.
  const WIN = '.dex-window';
  const GRID = '.dex-grid';
  const CELL = '.dex-cell';
  const CONTROLS = '.dex-controls';
  const TYPE_SELECT = '.dex-typef';
  const STAT = '.dex-strip .stk-stat';
  const GAME_FILTER = '.dex-strip .dex-stat-f';  // Capturados / Não Capturados (do jogo)
  const MAP_BTN = '.dock-btn[data-guide="dock-map"]';
  const MAP_WIN = '.map-window';
  const LOCATION = '.game-root .phud-tloc';      // "Nível 290 · Sneasel"
  const CREATURES = '/game/creatures.json';
  const MARKERS = '/api/game/map-markers';       // hunts do mapa: nome, nível e área
  const DEX_API = '/api/game/pokedex';           // o que a Pokédex do jogo busca ao abrir
  const CATCH_FLASH = '.cap-flash';              // aviso da barra de captura: "🎉 Larvitar capturado com Poké Ball!"
  const CATCH_OK = '🎉';                         // só o aviso de captura começa assim (o de fuga não)
  const BASE_MAX_ID = 10000;                     // espécies da Pokédex; as formas (Brave, Mega…) têm id acima
  const NO_HUNT = 1e8;                           // sem hunt conhecida: no fim da grade
  const WAIT_MS = 5000;
  const CHECK_MS = 500;

  const SORTS = [['', 'Ordem: Nº'], ['hunt', 'Ordem: Nível da hunt'], ['hunt-desc', 'Ordem: Nível da hunt ↓']];
  const STAT_FILTERS = [[/^desbloquead/i, 'unlocked', 'Mostrar só os desbloqueados'], [/^bloquead/i, 'locked', 'Mostrar só os bloqueados (menos abates que o necessário)']];
  let sort = '';    // vale enquanto o painel estiver aberto
  let filter = '';  // '', 'locked' ou 'unlocked'; zera a cada abertura, como o filtro do jogo
  let win = null, gridEl = null, mo = null, pending = 0, lastSkin = null;
  const clones = new Map();  // "id:hunt" -> card copiado

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
  const cached = p => window.__pbCache?.[p]?.data;
  // Visual PokeBoard ligado? No "Original" o tokens.css sai, e os extras saem junto.
  const skinOn = () => !!getComputedStyle(document.documentElement).getPropertyValue('--pb-screen').trim();
  const dexNo = cell => parseInt((cell.querySelector('.dex-cell-no')?.textContent || '').replace(/\D/g, ''), 10) || 0;
  async function waitFor(get, ms) {
    for (const end = Date.now() + ms; ;) {
      const v = get();
      if (v || Date.now() > end) return v;
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // ---------- hunts de cada espécie ----------
  let creatures = null, loading = false, index = null, indexKey = '';
  function creatureList() {
    creatures = cached(CREATURES)?.creatures || creatures;
    if (!creatures && !loading) {  // arquivo público do jogo; normalmente o hook já guardou
      loading = true;
      fetch(CREATURES).then(r => (r.ok ? r.json() : null)).then(d => { creatures = d?.creatures || null; index = null; schedule(); }).catch(() => {});
    }
    return creatures;
  }
  // Forma → espécie: mesmo nome ("Blastoise" 10001), nome sem o prefixo ("Brave Blastoise", "Milch-Miltank"),
  // sem o sufixo ("Castform Fire") ou, por último, o mesmo sprite (looktype).
  function huntIndex() {
    const list = creatureList();
    if (!list) return null;
    const markers = cached(MARKERS)?.hunts;
    const key = `${list.length}:${markers?.length || 0}`;
    if (index && key === indexKey) return index;
    const base = list.filter(c => c.pokeId < BASE_MAX_ID);
    const baseByName = new Map(base.map(c => [norm(c.name), c]));
    const baseByLook = new Map();
    for (const c of base) baseByLook.set(c.looktype, baseByLook.has(c.looktype) ? null : c);  // só sprite único
    const allByName = new Map(list.map(c => [norm(c.name), c]));
    const baseOf = c => {
      if (!c) return null;
      if (c.pokeId < BASE_MAX_ID) return c;
      const n = norm(c.name), w = n.split(/[\s-]+/);
      if (baseByName.has(n)) return baseByName.get(n);
      for (let i = 1; i < w.length; i++) { const b = baseByName.get(w.slice(i).join(' ')); if (b) return b; }
      for (let i = w.length - 1; i > 0; i--) { const b = baseByName.get(w.slice(0, i).join(' ')); if (b) return b; }
      return baseByLook.get(c.looktype) || null;
    };
    // As hunts do mapa (com a área); sem elas ainda, o nível de hunt de cada forma no creatures.json.
    const hunts = markers
      ? markers.map(h => ({ name: h.name, level: +h.level || 0, area: h.area || '', c: allByName.get(norm(h.name)) || baseByLook.get(h.looktype) }))
      : list.map(c => ({ name: c.name, level: +c.huntLevel || 0, area: '', c }));
    const out = new Map();
    for (const h of hunts) {
      const b = baseOf(h.c);
      if (!b || !h.level) continue;  // cidades e o que não é Pokémon
      if (!out.has(b.pokeId)) out.set(b.pokeId, []);
      const hs = out.get(b.pokeId), k = `${norm(h.name)}@${h.level}`;
      if (!hs.some(x => x.key === k)) hs.push({ name: h.name, level: h.level, area: h.area, key: k });
    }
    for (const hs of out.values()) hs.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    index = out; indexKey = key;
    return index;
  }
  const huntsOf = id => huntIndex()?.get(id) || [];
  const huntLabel = h => `Nv ${h.level}${h.area ? ` · ${cap(h.area)}` : ''}`;

  // ---------- ordem por nível da hunt ----------
  const isOriginal = n => n.matches?.(CELL) && !n.hasAttribute('data-pb-clone');
  const originalOf = cell => [...(gridEl?.children || [])].find(n => isOriginal(n) && dexNo(n) === dexNo(cell)) || null;
  const orderOf = (h, id) => (sort === 'hunt-desc' ? 99999 - h.level : h.level) * BASE_MAX_ID + id;
  function setOrder(cell, order, label) {
    if (cell.style.order !== String(order)) cell.style.order = String(order);
    if (cell.getAttribute('data-pb-hunt') !== label) cell.setAttribute('data-pb-hunt', label);
  }
  function clearOrder(cell) {
    if (cell.style.order) cell.style.removeProperty('order');
    if (cell.hasAttribute('data-pb-hunt')) cell.removeAttribute('data-pb-hunt');
  }
  // O sprite é um canvas desenhado pelo jogo: a cópia recebe o desenho (cloneNode não copia os pixels).
  function copySprite(c) {
    const a = c._src?.querySelector('canvas'), b = c.querySelector('canvas');
    if (!a || !b || !a.width) return;
    if (b.width !== a.width) b.width = a.width;
    if (b.height !== a.height) b.height = a.height;
    try { const g = b.getContext('2d'); g.clearRect(0, 0, b.width, b.height); g.drawImage(a, 0, 0); } catch {}
  }
  function makeClone(cell, h) {
    const c = cell.cloneNode(true);
    c.setAttribute('data-pb-clone', '');
    c.removeAttribute('id');
    const name = c.querySelector('.dex-cell-name');
    if (name) name.textContent = h.name;
    c.title = `${h.name} (${huntLabel(h)}): abre a ficha de ${cell.title || 'mesma espécie'}`;
    c._from = cell.className;
    return c;
  }
  function apply() {
    pending = 0;
    const grid = gridEl;
    if (!grid || !grid.isConnected) return;
    const on = !!sort && skinOn();
    const want = new Set();
    let fresh = false;
    for (const cell of [...grid.children].filter(isOriginal)) {
      if (!on) { clearOrder(cell); continue; }
      const id = dexNo(cell), hs = huntsOf(id);
      if (!hs.length) { setOrder(cell, NO_HUNT + id, 'sem hunt'); continue; }
      setOrder(cell, orderOf(hs[0], id), huntLabel(hs[0]));
      for (const h of hs.slice(1)) {
        const key = `${id}:${h.key}`;
        want.add(key);
        let c = clones.get(key);
        if (c && c._from !== cell.className) { c.remove(); c = null; }  // capturou, desbloqueou…: copia de novo
        if (!c) { c = makeClone(cell, h); clones.set(key, c); fresh = true; }
        c._src = cell;
        setOrder(c, orderOf(h, id), huntLabel(h));
        if (c.parentNode !== grid) grid.append(c);
        copySprite(c);
      }
    }
    for (const [key, c] of clones) if (!want.has(key)) { c.remove(); clones.delete(key); }
    // O jogo desenha os sprites depois de montar os cards: copia de novo quando já estiverem prontos.
    if (fresh) [700, 2000].forEach(ms => setTimeout(() => clones.forEach(copySprite), ms));
  }
  const schedule = () => { if (!pending) pending = setTimeout(apply, 120); };

  const select = document.createElement('select');
  select.id = 'pb-dex-sort';
  select.setAttribute('aria-label', 'Ordem da Pokédex');
  select.title = 'Ordem dos cards. Por nível da hunt, a espécie com mais de uma hunt aparece uma vez por hunt.';
  select.innerHTML = SORTS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  select.addEventListener('change', () => { sort = select.value; apply(); });

  function mountControls(on) {
    const ctr = win.querySelector(CONTROLS);
    if (!ctr || !on) { select.remove(); return; }
    if (select.parentNode !== ctr) { const t = ctr.querySelector(TYPE_SELECT); t ? t.after(select) : ctr.append(select); }
    if (select.value !== sort) select.value = sort;
  }

  // ---------- Bloqueados / Desbloqueados ----------
  function markStats(on) {
    for (const st of win.querySelectorAll(STAT)) {
      if (st.matches(GAME_FILTER)) continue;
      const f = STAT_FILTERS.find(([re]) => re.test(st.querySelector('.stk-lbl')?.textContent.trim() || ''));
      if (!f) continue;
      if (!on) { ['data-pb-dexf', 'role', 'tabindex', 'aria-pressed', 'title'].forEach(a => st.removeAttribute(a)); continue; }
      if (st.getAttribute('data-pb-dexf') !== f[1]) {
        st.setAttribute('data-pb-dexf', f[1]);
        st.setAttribute('role', 'button');
        st.setAttribute('tabindex', '0');
        st.title = f[2];
      }
      const pressed = String(filter === f[1]);
      if (st.getAttribute('aria-pressed') !== pressed) st.setAttribute('aria-pressed', pressed);
    }
    const v = on ? filter : '';
    if ((win.getAttribute('data-pb-dexf') || '') !== v) v ? win.setAttribute('data-pb-dexf', v) : win.removeAttribute('data-pb-dexf');
  }
  function toggleFilter(f) {
    filter = filter === f ? '' : f;
    if (win) markStats(skinOn());
  }

  // ---------- botão direito: viajar para a hunt ----------
  const menu = document.createElement('div');
  menu.id = 'pb-dex-menu';
  menu.setAttribute('role', 'menu');
  let menuHunts = [];
  const closeMenu = () => menu.remove();
  function openMenu(cell, x, y) {
    const id = dexNo(cell), base = originalOf(cell) || cell;
    const name = base.title || base.querySelector('.dex-cell-name')?.textContent.trim() || `#${id}`;
    const here = norm((document.querySelector(LOCATION)?.textContent || '').split('·').pop());
    menuHunts = huntsOf(id);
    menu.innerHTML = `<div class="pb-dex-menu-h">Viajar para a hunt<small>${esc(name)}</small></div>` + (menuHunts.length
      ? menuHunts.map((h, i) => {
        const isHere = norm(h.name) === here;
        return `<button type="button" role="menuitem" data-i="${i}"${isHere ? ' disabled' : ''}><b>${esc(h.name)}</b><span>${esc(huntLabel(h))}${isHere ? ' · você está aqui' : ''}</span></button>`;
      }).join('')
      : `<p>Nenhuma hunt de ${esc(name)} no mapa.</p>`);
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  menu.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const h = menuHunts[+b.dataset.i];
    closeMenu();
    if (h) travel(h);
  });
  menu.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  });

  const toastEl = document.createElement('div');
  toastEl.id = 'pb-toast';
  toastEl.setAttribute('role', 'status');
  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    document.body.append(toastEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.remove(), 5000);
  }

  // Abre o mapa (se fechado), troca para a área da hunt e aperta o "Viajar para" dela.
  let traveling = false;
  async function travel(h) {
    if (traveling) return;
    traveling = true;
    try {
      const marker = () => [...document.querySelectorAll(`${MAP_WIN} .hunt-marker`)].find(m =>
        norm(m.querySelector('.hunt-name')?.textContent) === norm(h.name) || norm((m.title || '').replace(/^viajar para\s*/i, '')) === norm(h.name));
      if (!document.querySelector(MAP_WIN)) {
        const btn = document.querySelector(MAP_BTN);
        if (!btn) return toast('Não achei o botão do Mapa na barra de telas.');
        btn.click();
        if (!await waitFor(() => document.querySelector(MAP_WIN), WAIT_MS)) return toast('O mapa não abriu.');
      }
      if (!marker() && h.area) {
        const plate = [...document.querySelectorAll(`${MAP_WIN} .map-plate`)].find(p => norm(p.querySelector('img')?.alt) === norm(h.area));
        if (plate?.classList.contains('locked')) return toast(`${cap(h.area)} ainda está bloqueada (${plate.title}).`);
        if (plate && !plate.classList.contains('on')) plate.click();
      }
      const m = await waitFor(marker, WAIT_MS);
      if (!m) return toast(`Não achei ${h.name} no mapa; ele ficou aberto para você procurar.`);
      m.click();
    } finally {
      traveling = false;
    }
  }

  // ---------- eventos ----------
  document.addEventListener('click', e => {
    const st = e.target.closest?.(`${WIN} .stk-stat[data-pb-dexf]`);
    if (st) { toggleFilter(st.getAttribute('data-pb-dexf')); return; }
    if (e.target.closest?.(`${WIN} ${GAME_FILTER}`)) { filter = ''; if (win) markStats(skinOn()); return; }  // filtro do jogo: o nosso sai
    const clone = e.target.closest?.(`${WIN} [data-pb-clone]`);
    if (clone) { e.preventDefault(); e.stopPropagation(); originalOf(clone)?.click(); }  // a cópia abre a ficha da espécie
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu.isConnected) { closeMenu(); e.stopPropagation(); return; }
    const st = (e.key === 'Enter' || e.key === ' ') && e.target.closest?.(`${WIN} .stk-stat[data-pb-dexf]`);
    if (st) { e.preventDefault(); toggleFilter(st.getAttribute('data-pb-dexf')); }
  }, true);
  document.addEventListener('contextmenu', e => {
    const cell = e.target.closest?.(`${WIN} ${CELL}`);
    if (!cell || !skinOn()) return;
    e.preventDefault();
    openMenu(cell, e.clientX, e.clientY);
  });
  document.addEventListener('pointerdown', e => { if (menu.isConnected && !menu.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('pb:data', e => {
    const p = e.detail?.path;
    if (p === CREATURES || p === MARKERS) { index = null; if (gridEl) schedule(); }
    if (p === DEX_API && gridEl) schedule();  // capturou/desbloqueou: as cópias da ordem por hunt copiam de novo
  });

  // ---------- captura: atualiza a Pokédex aberta ----------
  // A Pokédex do jogo só busca os dados ao abrir. Quando a barra de captura avisa uma captura, chamamos de novo a
  // função da própria janela que faz essa busca (o mesmo GET de leitura que roda ao abrir; o jogo usa o login dele,
  // nada passa por nós). A grade e a ficha aberta se atualizam sem fechar, com busca, filtros e rolagem no lugar.
  // A função fica guardada no componente da janela (hook useCallback do React); achamos pela rota que ela busca.
  function dexReload() {
    const el = document.querySelector(WIN);
    const key = el && Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    for (let f = key ? el[key] : null, depth = 0; f && depth < 40; f = f.return, depth++) {
      if (typeof f.type !== 'function') continue;
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = h.memoizedState;
        if (Array.isArray(v) && typeof v[0] === 'function' && String(v[0]).includes(DEX_API) && !String(v[0]).includes(`${DEX_API}/`)) return v[0];
      }
    }
    return null;
  }
  let lastFlash = '', reloadTimer = 0;
  function watchCatch() {
    const t = document.querySelector(CATCH_FLASH)?.textContent.trim() || '';
    if (t === lastFlash) return;
    lastFlash = t;
    if (!t.startsWith(CATCH_OK) || !document.querySelector(WIN)) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { try { dexReload()?.(); } catch {} }, 800);  // dá tempo de o servidor registrar
  }

  // A janela abre e fecha, e a grade some enquanto a ficha de um Pokémon está aberta: acompanha os dois.
  setInterval(() => {
    watchCatch();
    const w = document.querySelector(WIN);
    if (w !== win) { win = w; filter = ''; }
    const g = win?.querySelector(GRID) || null;
    if (g !== gridEl) {
      mo?.disconnect();
      clones.forEach(c => c.remove());
      clones.clear();
      gridEl = g;
      if (g) {
        // Só mudanças do jogo na grade (busca, filtro, troca de lista); as cópias nossas não contam.
        mo = new MutationObserver(recs => {
          if (recs.some(r => [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && !n.hasAttribute('data-pb-clone')))) schedule();
        });
        mo.observe(g, { childList: true });
        schedule();
      }
    }
    if (!win) { closeMenu(); return; }
    const on = skinOn();
    if (on !== lastSkin) { lastSkin = on; schedule(); if (!on) closeMenu(); }
    mountControls(on);
    markStats(on);
  }, CHECK_MS);
})();
