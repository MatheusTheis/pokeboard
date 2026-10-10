// Mercado+: filtro de moeda (Dollars / Diamonds) no Mercado Global; no fim, o "Máx" do Comprar da Loja do Mark.
// O filtro vale para a lista inteira: a tela do Mercado guarda a resposta da busca (todos os anúncios) e faz busca,
// ordem e páginas de 12 no navegador. Com Dollars ou Diamonds, ela recebe uma cópia só com essa moeda, e as páginas
// passam a ser dessa moeda. Na aba Pokémon com uma espécie escolhida, as páginas vêm do servidor (sem filtro de
// moeda): ali o filtro esconde os anúncios da outra moeda na página aberta. Não busca nada nem clica em nada.
(() => {
  if (window.__pbMarket) return;
  window.__pbMarket = true;

  // Seletores do jogo (Mercado Global). Ajuste aqui quando o jogo atualizar.
  const WIN = '.mkt2-window';
  const FILTER_SLOTS = ['.mkt2-filters', '.mkt2-toolbar-row'];  // onde o controle entra (o primeiro que existir)
  const ITEMS = '.mkt2-grid > .mkt2-card, .mkt2-rows .mkt2-row, .mkt2-rows .mkt2-trow:not(.mkt2-trow--head)';
  const PRICE = '.mkt2-card-foot, .mkt2-price, .mkt2-tc--price';
  const API = '/api/game/market';  // resposta guardada pelo hook.js: listings[i].currency
  const CHECK_MS = 1000;

  const CURS = [['', 'Todas'], ['DOLLARS', 'Dollars'], ['DIAMONDS', 'Diamonds']];
  let filter = '';  // vale enquanto o painel estiver aberto
  let win = null, mo = null, pending = 0;

  // Moeda de um anúncio: primeiro pelo que aparece no preço; sem pista, pela ordem da resposta da API.
  function currencyOf(el, i) {
    const scope = el.querySelector(PRICE) || el;
    const srcs = [...scope.querySelectorAll('img')].map(im => im.getAttribute('src') || '').join(' ');
    const hint = `${srcs} ${scope.textContent}`.toLowerCase();
    if (hint.includes('diamond')) return 'DIAMONDS';
    if (hint.includes('dollar') || hint.includes('$')) return 'DOLLARS';
    // A API chama dollars de "GOLD".
    const c = window.__pbCache?.[API]?.data?.listings?.[i]?.currency;
    return c === 'DIAMONDS' ? 'DIAMONDS' : c === 'GOLD' || c === 'DOLLARS' ? 'DOLLARS' : '';
  }

  // ---------- Histórico: clicar numa venda abre um card com o que foi vendido (pb-card.js) ----------
  // Os dados vêm da última resposta do /api/game/market que o jogo carregou (a do Histórico, com ele aberto).
  // A forma exata dela pode mudar: procura a lista de objetos com "name" que bate com as linhas da tela.
  const TAB_LABEL = '.mkt2-tab.on .mkt2-tab-label';
  const HIST_ROWS = '.mkt2-row, .mkt2-trow:not(.mkt2-trow--head), .mkt2-grid > .mkt2-card';
  const isHistory = () => /hist/i.test(win?.querySelector(TAB_LABEL)?.textContent || '');
  function historyEntries() {
    const data = window.__pbCache?.[API]?.data;
    const lists = [];
    const scan = (v, depth) => {
      if (!v || typeof v !== 'object' || depth > 2) return;
      if (Array.isArray(v)) { if (v.length && typeof v[0] === 'object' && v[0] && 'name' in v[0]) lists.push(v); return; }
      Object.values(v).forEach(x => scan(x, depth + 1));
    };
    scan(data, 0);
    return lists;
  }
  function entryFor(row, i) {
    const text = row.textContent || '';
    for (const list of historyEntries()) {
      if (list[i] && text.includes(list[i].name)) return list[i];
      const hit = list.find(e => e.name && text.includes(e.name));
      if (hit) return hit;
    }
    return null;
  }
  // ---------- Anunciar: itens e Pokémon numa tela só ----------
  // O jogo empilha dois formulários (itens e Pokémon), irmãos dentro de .mkt-sellform. Uma alternância nossa
  // mostra um de cada vez e o CSS (game-windows.css) arruma numa grade única: busca, grade grande e uma faixa
  // com preço, moeda, total e o botão Anunciar. Os campos e botões continuam sendo os do jogo.
  const SELLFORM = '.mkt-sellform';
  let sellKind = 'item';
  const kindBar = document.createElement('div');
  kindBar.id = 'pb-sell-kind';
  kindBar.setAttribute('role', 'group');
  kindBar.setAttribute('aria-label', 'O que anunciar');
  kindBar.innerHTML = `<button type="button" data-kind="item" aria-pressed="true">Itens · Pokébolas · Diamonds</button>
    <button type="button" data-kind="pokemon" aria-pressed="false">Pokémon</button>`;
  kindBar.addEventListener('click', e => {
    e.stopPropagation();
    const k = e.target.closest('button[data-kind]')?.dataset.kind;
    if (k) { sellKind = k; apply(); }
  });
  function mountSellForm() {
    const form = win?.querySelector(SELLFORM);
    if (!form) return;
    if (kindBar.nextElementSibling !== form) form.before(kindBar);
    if (form.dataset.pbKind !== sellKind) form.dataset.pbKind = sellKind;
    kindBar.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === sellKind)));
  }

  // ---------- Anunciar › "Vale vender": primeiro os itens que rendem mais no Mercado do que no Mark ----------
  // Para cada item da grade: o anúncio mais barato em dollars do Mercado menos a taxa, contra o que o Mark paga
  // (window.__pbPrices, mais abaixo). Ligado, os que rendem mais no Mercado vão para o começo, do maior ganho total
  // (ganho por unidade × quantidade) para o menor, com o ganho no canto; os outros ficam apagados no fim.
  // Só ordem (CSS order) e atributos nos cards do jogo; escolher e anunciar continua nos botões do jogo.
  // Ligado, clicar num item também preenche o formulário do jogo: moeda dollars, quantidade = tudo que você tem e
  // preço = o anúncio mais barato (nunca abaixo do que o Mark paga, que o jogo não aceita). Quem anuncia é o botão
  // Anunciar do jogo, com a confirmação dele.
  const SELL_PICK = ':scope > .mkt-pick:not(.mkt-pick-pk)';  // grade de itens do Anunciar (a de Pokémon é .mkt-pick-pk)
  const num = s => Number(String(s || '').replace(/\D/g, '')) || 0;
  const fmt = n => n.toLocaleString('pt-BR');
  const compact = n => (n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n));  // 1.2k, 120k, 2.5M
  let worthOn = false;  // vale enquanto o painel estiver aberto
  const worthBtn = document.createElement('button');
  worthBtn.type = 'button';
  worthBtn.id = 'pb-sell-worth';
  worthBtn.title = 'Mostrar primeiro os itens que rendem mais vendendo no Mercado (já sem a taxa) do que para o Mark';
  worthBtn.addEventListener('click', e => { e.stopPropagation(); worthOn = !worthOn; apply(); });
  const setAttr = (el, k, v) => { if (v == null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  function mountWorth(form) {
    const P = window.__pbPrices;
    const pick = form.querySelector(SELL_PICK);
    const fbar = pick?.previousElementSibling?.matches('.mk-fbar') ? pick.previousElementSibling : null;
    if (!P || !fbar) { worthBtn.remove(); return; }
    if (worthBtn.parentElement !== fbar) fbar.append(worthBtn);
    const market = P.market(), fee = `${Math.round(P.FEE * 100)}%`;
    const rows = [...pick.querySelectorAll('.mkt-tile')].map((t, i) => {
      const name = t.querySelector('img')?.alt || '';
      const m = market?.items[P.norm(name)], mark = P.npc(name), qty = num(t.querySelector('.mkt-tile-qty')?.textContent) || 1;
      if (!m || mark === undefined) return { t, i, name, gain: null, why: !m ? 'sem anúncio em dollars no Mercado' : 'sem o preço do Mark' };
      const v = P.net(m.p), total = m.p * qty;
      return { t, i, name, v, mark, qty, m, gain: total - P.fee(total) - mark * qty };
    });
    const good = rows.filter(r => r.gain > 0).sort((a, b) => b.gain - a.gain);
    good.forEach((r, k) => { r.order = k; });
    for (const r of rows) {
      if (!worthOn) {
        if (r.t.hasAttribute('data-pb-worth')) { r.t.style.removeProperty('order'); ['data-pb-worth', 'data-pb-gain', 'title'].forEach(k => r.t.removeAttribute(k)); }
        continue;
      }
      const yes = r.gain > 0;
      const order = String(yes ? r.order : 10000 + r.i);
      if (r.t.style.order !== order) r.t.style.order = order;
      setAttr(r.t, 'data-pb-worth', yes ? 'yes' : 'no');
      setAttr(r.t, 'data-pb-gain', yes ? `+${compact(r.gain)}` : null);
      setAttr(r.t, 'title', r.gain === null ? `${r.name}: ${r.why}.`
        : `${r.name}: no Mercado rende 💲${fmt(r.v)}/un (anúncio mais barato 💲${fmt(r.m.p)}, menos ${fee}); o Mark paga 💲${fmt(r.mark)}.`
          + (yes ? ` Com ${fmt(r.qty)} un: +💲${fmt(r.gain)} vendendo no Mercado.` : ' Vender para o Mark rende igual ou mais.'));
    }
    const label = worthOn ? `💲 Vale vender: ${good.length}` : '💲 Vale vender';
    if (worthBtn.textContent !== label) worthBtn.textContent = label;  // só se mudou: o texto também é mudança no DOM observado
    setAttr(worthBtn, 'aria-pressed', String(worthOn));
  }

  // Preenche o formulário do jogo depois do clique num item (o jogo seleciona e zera a quantidade antes).
  // Campos controlados pelo React: valor pelo setter nativo + o evento que o React escuta.
  const setNative = (el, v, ev) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, String(v));
    el.dispatchEvent(new Event(ev, { bubbles: true }));
  };
  // Os dois formulários (itens e Pokémon) são irmãos: vale o primeiro campo antes da grade de Pokémon.
  const itemField = (form, sel) => {
    const pk = form.querySelector(':scope > .mkt-pick-pk');
    return [...form.querySelectorAll(sel)].find(el => !pk || el.compareDocumentPosition(pk) & Node.DOCUMENT_POSITION_FOLLOWING) || null;
  };
  function fillSale(tile) {
    const form = tile.closest(SELLFORM), P = window.__pbPrices;
    if (!form || !P || !tile.classList.contains('on')) return;  // clique que desmarcou o item
    const name = tile.querySelector('img')?.alt || '';
    const m = P.market()?.items[P.norm(name)];
    const cur = itemField(form, 'select.mkt-sel');
    if (cur && !cur.disabled && cur.value !== 'GOLD') setNative(cur, 'GOLD', 'change');
    const qty = itemField(form, 'input.mkt-qslider-range');  // só existe com mais de 1 unidade
    if (qty && qty.value !== qty.max) setNative(qty, qty.max, 'input');
    const price = itemField(form, 'input.mkt-num');
    if (price && m) setNative(price, Math.max(m.p, P.npc(name) || 0), 'input');
  }
  document.addEventListener('click', e => {
    if (!worthOn) return;
    const tile = e.target.closest?.(`${SELLFORM} > .mkt-pick:not(.mkt-pick-pk) .mkt-tile`);
    if (tile) setTimeout(() => fillSale(tile), 60);
  });

  // ---------- Anunciar › Pokémon: valor de mercado em cada card ----------
  // Ao lado do nível, o anúncio mais barato em dollars de um Pokémon parecido (mesma espécie e raridade, IV ±10;
  // window.__pbPrices), abreviado (45k, 1.2M). Sem parecido conhecido: "~" + o mais barato da espécie (qualquer
  // raridade e IV); sem nenhum anúncio da espécie: "–". Shiny fica sem valor.
  // A lista dos seus Pokémon chega pelo WebSocket do jogo e fica no estado do componente do Mercado: lemos dali
  // (React), e cada card é achado pela chave dele, que é o id do Pokémon. Só leitura; nada é clicado.
  // A lista de espécies à venda (com o mais barato de cada, no Mercado inteiro) é a busca da aba Pokémon do Mercado.
  // Com os cards à vista, pedimos à própria tela do Mercado que faça essa busca (a função dela, de leitura, com o
  // login do jogo), no máximo a cada SPECIES_EVERY_MS.
  const SPECIES_EVERY_MS = 5 * 60e3;
  let speciesAsked = 0;
  function askSpecies(el) {
    const P = window.__pbPrices;
    if (Date.now() - speciesAsked < SPECIES_EVERY_MS || P.speciesAge() < SPECIES_EVERY_MS) return;
    for (let f = fiberOf(el), d = 0; f && d < 80; f = f.return, d++) {
      if (typeof f.type !== 'function') continue;
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = h.memoizedState;
        if (Array.isArray(v) && typeof v[0] === 'function' && String(v[0]).includes('browse=species')) {
          speciesAsked = Date.now();
          try { v[0](); } catch {}
          return;
        }
      }
    }
  }
  const fiberOf = el => { const k = Object.keys(el).find(x => x.startsWith('__reactFiber$')); return k ? el[k] : null; };
  function myPokes(el) {
    for (let f = fiberOf(el), d = 0; f && d < 80; f = f.return, d++) {
      if (typeof f.type !== 'function') continue;
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = h.memoizedState;
        if (Array.isArray(v) && v[0] && typeof v[0] === 'object' && 'speciesId' in v[0] && 'ivTotal' in v[0]) return v;
      }
    }
    return null;
  }
  function mountPokeValues(form) {
    const P = window.__pbPrices, pick = form.querySelector(':scope > .mkt-pick-pk');
    if (!P || !pick) return;
    const list = myPokes(pick);
    const byId = new Map((list || []).map(p => [String(p.id), p]));
    let tiles = 0;
    for (const t of pick.querySelectorAll('.mkt-ptile')) {
      tiles++;
      const p = byId.get(String(fiberOf(t)?.key));
      let val = null, kind = null;
      if (p && !p.shiny && p.name) {
        const m = P.similar(p.name, p.ivTotal ?? 0, P.grade(p.quality ?? 1));
        if (m) val = compact(m.p);
        else if (m === null) {
          const sp = P.speciesMin(p.name);
          if (sp) { val = `~${compact(sp.p)}`; kind = 'approx'; } else { val = '–'; kind = 'none'; }
        }
      }
      setAttr(t, 'data-pb-val', val);
      setAttr(t, 'data-pb-val-kind', kind);
    }
    if (tiles && form.dataset.pbKind === 'pokemon') askSpecies(pick);
  }

  const money = (n, cur) => `${Number(n || 0).toLocaleString('pt-BR')} ${cur === 'DIAMONDS' ? 'diamonds' : 'dollars'}`;
  function openSale(row, i) {
    const e = entryFor(row, i);
    const lines = [...row.querySelectorAll('*')].filter(n => !n.children.length).map(n => n.textContent.trim()).filter(Boolean);
    const icon = row.querySelector('img')?.src || '';
    if (!window.__pbCard) return;
    if (!e) {
      // Sem dados da API: mostra o que está na linha.
      window.__pbCard.open({ title: lines[0] || 'Venda', icon, sale: lines.slice(1).map((l, n) => [n ? '' : 'Detalhes', l]) });
      return;
    }
    const isPoke = e.kind === 'pokemon' || /pokemon/i.test(e.category || '');
    const sale = [
      ['Quantidade', e.quantity != null ? `${e.quantity}×` : ''],
      ['Preço', e.price != null ? `${money(e.price, e.currency)}${e.quantity > 1 ? ' /un' : ''}` : ''],
      ['Quando', e.at ? new Date(e.at).toLocaleString('pt-BR') : ''],
    ].filter(([, v]) => v);
    window.__pbCard.open(isPoke
      ? { id: e.speciesId, name: e.name, icon, sale, inst: e }
      : { title: e.name, icon, sale, facts: [['Categoria', e.category || ''], ['Descrição', e.desc || '']].filter(([, v]) => v) });
  }

  const control = document.createElement('div');
  control.id = 'pb-mkt-cur';
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', 'Filtrar anúncios por moeda');
  control.innerHTML = `<span class="pb-mkt-cur-lbl">Moeda</span>${CURS.map(([v, l]) =>
    `<button type="button" data-cur="${v}" aria-pressed="${v === filter}">${l}</button>`).join('')}<span class="pb-mkt-cur-count" aria-live="polite"></span>`;
  control.addEventListener('click', e => {
    e.stopPropagation();  // o clique é nosso: não deixa chegar nos handlers do jogo
    const b = e.target.closest('button[data-cur]');
    if (!b) return;
    filter = b.dataset.cur;
    apply();
  });
  const countEl = control.querySelector('.pb-mkt-cur-count');

  // ---------- filtro de moeda na lista inteira ----------
  // A resposta da busca fica num useState da tela do Mercado (objeto com listings e catalog/mine). Lemos o estado
  // pela fila do hook (queue.lastRenderedState, sempre a atual) e trocamos pelo dispatch dela, como a própria tela
  // faz quando a busca termina. Quando o jogo busca de novo (abrir, trocar de categoria, comprar, cancelar), a lista
  // nova vira a original e é filtrada outra vez; "Todas" devolve a original.
  const isMarketData = v => v && typeof v === 'object' && Array.isArray(v.listings) && ('catalog' in v || 'mine' in v);
  const curOf = l => (l.currency === 'DIAMONDS' ? 'DIAMONDS' : 'DOLLARS');
  let origData = null, ourData = null, ourFor = '';
  function dataHook() {
    const starts = [win.querySelector('.mkt2-body'), win.querySelector('.mkt2-tabs'), win].filter(Boolean);
    for (const el of starts) {
      for (let f = fiberOf(el), d = 0; f && d < 80; f = f.return, d++) {
        if (typeof f.type !== 'function') continue;
        for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
          if (h.queue?.dispatch && isMarketData(h.queue.lastRenderedState)) return h.queue;
        }
      }
    }
    return null;
  }
  function filterWhole() {
    const q = dataHook();
    if (!q) return null;
    const cur = q.lastRenderedState;
    if (cur === ourData && ourFor === filter) return ourData;  // já é a nossa cópia desta moeda
    if (cur !== ourData) origData = cur;                       // lista nova do jogo
    if (!filter) {
      ourData = null; ourFor = '';
      if (cur !== origData) q.dispatch(origData);
      return null;
    }
    ourData = { ...origData, listings: origData.listings.filter(l => curOf(l) === filter) };
    ourFor = filter;
    q.dispatch(ourData);
    return ourData;
  }

  function apply() {
    pending = 0;
    if (!win?.isConnected) return;
    const whole = filterWhole();
    const slot = FILTER_SLOTS.map(s => win.querySelector(s)).find(Boolean);
    if (slot && control.parentElement !== slot) slot.append(control);
    if (win.dataset.pbCur !== filter) win.dataset.pbCur = filter;  // o CSS (game-skin.css) esconde por aqui
    win.toggleAttribute('data-pb-history', isHistory());           // linhas do Histórico viram clicáveis (CSS)
    mountSellForm();
    const sellForm = win.querySelector(SELLFORM);
    if (sellForm) { mountWorth(sellForm); mountPokeValues(sellForm); }
    control.querySelectorAll('button[data-cur]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cur === filter)));

    // Marca cada anúncio com a moeda (só quando sabemos; os sem moeda nunca somem).
    const items = [...win.querySelectorAll(ITEMS)];
    let shown = 0;
    items.forEach((el, i) => {
      const c = currencyOf(el, i);
      if (c) { if (el.dataset.pbCur !== c) el.dataset.pbCur = c; } else if (el.dataset.pbCur) delete el.dataset.pbCur;
      if (!filter || !c || c === filter) shown++;
    });
    const label = CURS.find(([v]) => v === filter)?.[1] || '';
    const txt = !filter ? ''
      : whole ? `${whole.listings.length.toLocaleString('pt-BR')} em ${label} (de ${origData.listings.length.toLocaleString('pt-BR')})`
      : !items.length ? ''
      : shown ? `${shown} de ${items.length} nesta página`
      : 'Nenhum nesta página: veja a próxima';
    // Só troca se mudou: trocar o texto também é uma mudança no DOM observado e reagendaria o apply.
    if (countEl.textContent !== txt) countEl.textContent = txt;
  }
  const schedule = () => { if (!pending) pending = setTimeout(apply, 120); };

  // O jogo abre e fecha a janela do mercado e troca a lista a cada página: acompanha só esse pedaço do DOM.
  setInterval(() => {
    const w = document.querySelector(WIN);
    if (w === win) return;
    mo?.disconnect();
    win = w;
    if (!win) return;
    mo = new MutationObserver(schedule);
    mo.observe(win, { childList: true, subtree: true });
    win.addEventListener('click', e => {
      if (!isHistory()) return;
      const row = e.target.closest(HIST_ROWS);
      if (!row || e.target.closest('button, a, input, select')) return;  // botões da linha continuam sendo do jogo
      openSale(row, [...win.querySelectorAll(HIST_ROWS)].indexOf(row));
    });
    apply();
  }, CHECK_MS);
  window.addEventListener('pb:data', e => { if (e.detail?.path === API || e.detail?.path?.startsWith(`${API}?`)) schedule(); });
})();

// Preços para comparar Mercado × Mark: usados no Anunciar (acima) e na Loja do Mark (abaixo).
// Nada é buscado da API por nós: vale o que o jogo carregou. Fica guardado com a hora no localStorage do painel,
// para valer também depois de fechar o Mercado.
// Mercado, três fontes, todas respostas que o próprio jogo pediu:
//   - lista principal (/api/game/market): itens (o mais barato em dollars de cada) e os 600 Pokémon mais recentes;
//   - páginas da aba Pokémon (?browse=pokemon, e ?category=…): cada anúncio de Pokémon visto ali vale por 1 h;
//   - espécies à venda (?browse=species): o mais barato em dollars de cada espécie, no Mercado inteiro.
// Pokémon sempre sem shiny e sem os seus anúncios. Mark: o npcPrice do /game/items.json.
(() => {
  if (window.__pbPrices) return;
  const MARKET_API = '/api/game/market';                      // chaves do hook.js
  const BROWSE_SPECIES = `${MARKET_API}?browse=species`;
  const ITEMS = '/game/items.json';       // arquivo público do jogo; normalmente o hook já guardou
  const KEY = 'pb:market-min';            // localStorage do painel
  const VERSION = 3;                      // formato do que fica guardado; outro número = dados antigos, descartados
  const SEEN_MS = 60 * 60e3;              // anúncio visto numa página da aba Pokémon vale por 1 h
  const SEEN_MAX = 3000;                  // e guardamos no máximo estes (os mais novos)
  const FEE = 0.03;                       // taxa do Mercado sobre vendas em dollars (2% para VIP, no código do jogo)
  const FEE_CAP = 1e6;                    // a taxa de um anúncio não passa disso
  const IV_MARGIN = 10;                   // Pokémon "parecido": mesma raridade e IV até 10 de diferença
  // Raridade do Pokémon pelo multiplicador de qualidade, nas mesmas faixas do jogo (qualityInfo).
  const GRADES = [[4, 'Divina'], [3, 'Anciã'], [2, 'Mítica'], [1.7, 'Lendária'], [1.5, 'Épica'], [1.3, 'Rara'], [1.1, 'Incomum'], [1, 'Comum'], [-Infinity, 'Fraca']];
  const grade = q => GRADES.find(([min]) => q >= min)[1];

  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const species = name => norm(String(name || '').replace(/\s+lv\.?\s*\d+$/i, ''));  // "Larvitar Lv.1" -> "larvitar"
  const okPoke = l => l?.kind === 'pokemon' && l.currency === 'GOLD' && !l.offerOnly && !l.shiny && l.price > 0 && l.name;

  // market = { v, at, items: {item: {p, q, s}}, pokes: {espécie: [[preço, IV, qualidade, id], …]} (lista principal),
  //   seen: {espécie: {id: [preço, IV, qualidade, quando]}} (páginas da aba Pokémon), spMin: {espécie: {p, n}}, spAt, pkCap }
  let market = (() => {
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v?.v === VERSION ? v : null; } catch { return null; }
  })();
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(market)); } catch {} };
  const base = () => (market = market || { v: VERSION, at: 0, items: {}, pokes: {}, seen: {}, spMin: {}, spAt: 0, pkCap: 0 });

  // Lista principal: refaz itens e os Pokémon dela.
  function learn(hit) {
    const list = hit?.data?.listings;
    if (!Array.isArray(list) || !list.length) return;  // resposta sem anúncios: mantém a anterior
    const mine = new Set((hit.data.mine || []).flatMap(l => l.ids || [l.id]));
    const items = {}, pokes = {};
    for (const l of list) {
      if ((l.ids || [l.id]).every(id => mine.has(id))) continue;
      if (okPoke(l)) { (pokes[species(l.name)] = pokes[species(l.name)] || []).push([l.price, l.ivTotal ?? -1, l.quality ?? 1, String(l.id)]); continue; }
      if (l.kind === 'pokemon' || l.currency !== 'GOLD' || l.offerOnly || !(l.price > 0) || !l.name) continue;
      const k = norm(l.name), cur = items[k];
      if (!cur || l.price < cur.p) items[k] = { p: l.price, q: l.quantity || 0, s: l.sellers || 1 };
    }
    Object.assign(base(), { at: hit.at || Date.now(), items, pokes, pkCap: hit.data.pkWindow?.more ? hit.data.pkWindow.cap || 0 : 0 });
    keep();
  }
  // Páginas da aba Pokémon e categorias: junta os anúncios vistos (sem repetir), e esquece os velhos.
  function learnSeen(hit) {
    const list = hit?.data?.listings;
    if (!Array.isArray(list)) return;
    const m = base(), now = hit.at || Date.now();
    for (const l of list) {
      if (!okPoke(l)) continue;
      (m.seen[species(l.name)] = m.seen[species(l.name)] || {})[String(l.id)] = [l.price, l.ivTotal ?? -1, l.quality ?? 1, now];
    }
    const all = [];
    for (const [k, byId] of Object.entries(m.seen)) for (const [id, r] of Object.entries(byId)) all.push([r[3], k, id]);
    all.sort((a, b) => b[0] - a[0]);
    all.forEach(([at, k, id], n) => { if (n >= SEEN_MAX || now - at > SEEN_MS) delete m.seen[k][id]; });
    for (const k of Object.keys(m.seen)) if (!Object.keys(m.seen[k]).length) delete m.seen[k];
    keep();
  }
  // Espécies à venda: o mais barato em dollars de cada uma, no Mercado inteiro.
  function learnSpecies(hit) {
    const list = hit?.data?.species;
    if (!Array.isArray(list)) return;
    const spMin = {};
    for (const e of list) if (e?.name && e.minGold > 0) spMin[species(e.name)] = { p: e.minGold, n: e.total || 0 };
    Object.assign(base(), { spMin, spAt: hit.at || Date.now() });
    keep();
  }
  const cache = k => window.__pbCache?.[k];
  learn(cache(MARKET_API));
  learnSpecies(cache(BROWSE_SPECIES));
  for (const k of Object.keys(window.__pbCache || {})) if (k.startsWith(`${MARKET_API}?`) && k !== BROWSE_SPECIES) learnSeen(cache(k));
  window.addEventListener('pb:data', e => {
    const k = e.detail?.path;
    if (k === MARKET_API) learn(cache(k));
    else if (k === BROWSE_SPECIES) learnSpecies(cache(k));
    else if (k?.startsWith(`${MARKET_API}?`)) learnSeen(cache(k));
  });

  // Anúncios conhecidos de uma espécie: os da lista principal + os vistos na aba Pokémon há menos de 1 h.
  function pool(name) {
    const k = species(name), out = new Map(), now = Date.now();
    for (const r of market?.pokes?.[k] || []) out.set(r[3], r);
    for (const [id, r] of Object.entries(market?.seen?.[k] || {})) if (now - r[3] <= SEEN_MS) out.set(id, [r[0], r[1], r[2], id]);
    return [...out.values()];
  }

  let npc = null, npcFrom = null, loading = false;
  const toMap = list => new Map(list.map(i => [norm(i.name), Number(i.npcPrice) || 0]));
  function npcMap() {
    const list = window.__pbCache?.[ITEMS]?.data?.items;
    if (list && list !== npcFrom) { npc = toMap(list); npcFrom = list; }
    if (!npc && !loading) {
      loading = true;
      fetch(ITEMS).then(r => (r.ok ? r.json() : null)).then(d => { if (d?.items && !npc) npc = toMap(d.items); }).catch(() => {});
    }
    return npc;
  }

  window.__pbPrices = {
    FEE, norm, species, SPECIES_KEY: BROWSE_SPECIES,
    market: () => market,
    net: p => Math.floor(p * (1 - FEE)),          // o que o vendedor recebe no Mercado, por unidade
    fee: total => Math.min(FEE_CAP, Math.floor(total * FEE)),  // taxa de um anúncio, como o jogo calcula
    IV_MARGIN, grade, GRADE_NAMES: GRADES.map(([, g]) => g),
    // Anúncio mais barato da espécie com a mesma raridade (qualquer multiplicador dela) e IV a até IV_MARGIN.
    // null: nenhum parecido conhecido; undefined: ainda sem dados do Mercado neste painel.
    similar(name, iv, label) {
      if (!market) return undefined;
      const list = pool(name);
      const hits = list.filter(([, i, q]) => i >= 0 && Math.abs(i - iv) <= IV_MARGIN && norm(grade(q)) === norm(label));
      if (!hits.length) return null;
      const [p, i, q] = hits.reduce((a, b) => (b[0] < a[0] ? b : a));
      return { p, iv: i, q, n: hits.length, all: list.length };
    },
    // Sem parecido: o mais barato da espécie (qualquer raridade e IV), pela lista de espécies à venda, que cobre o
    // Mercado inteiro; sem ela, pelo que conhecemos. null: nenhum anúncio da espécie.
    speciesMin(name) {
      const sp = market?.spMin?.[species(name)];
      if (sp) return { p: sp.p, n: sp.n, whole: true };
      const list = pool(name);
      return list.length ? { p: Math.min(...list.map(r => r[0])), n: list.length, whole: false } : null;
    },
    speciesAge: () => (market?.spAt ? Date.now() - market.spAt : Infinity),
    npc: name => npcMap()?.get(norm(name)),        // o que o Mark paga; undefined = sem dado
  };
})();

// Loja do Mark.
// Comprar: botão "Máx" em cada item, igual ao que o jogo já tem no Vender. A pedido do jogador (clique no Máx), põe
// na quantidade o máximo que o dinheiro paga: dinheiro ÷ preço, dentro do limite do controle deslizante do jogo.
// Só preenche o campo; a compra continua no botão Comprar do jogo.
// Nas três abas (Comprar, Vender, Pokémon): ao lado do preço do Mark, o anúncio mais barato em dollars do mesmo item
// no Mercado (no Pokémon, do parecido: mesma espécie e raridade, IV ±10), já sem a taxa nas vendas (abaixo).
(() => {
  if (window.__pbMark) return;
  window.__pbMark = true;

  // Seletores do jogo (Loja do Mark). Ajuste aqui quando o jogo atualizar.
  const WIN = '.mks-window';
  const BUY_ROW = '.mks-row:has(.mks-buy)';  // só as linhas do Comprar têm o botão Comprar
  const QTY_BAR = '.mks-qtybar';
  const MONEY = '.nsh-gold';                  // "💲 1.320.196"
  const PRICE = '.mks-price';                 // "💲5" (no Vender, o que o Mark paga por unidade)
  const SELL_ROW = '.mks-srow';               // linhas de item do Vender
  const POKE_ROW = '.mks-row.mks-srow-head';  // linhas da aba Pokémon (no Vender, o cabeçalho fica dentro da linha)
  const STRIP = '.mks-strip';                 // faixa do dinheiro, no topo
  const CHECK_MS = 500;

  const digits = s => { const d = String(s || '').replace(/\D/g, ''); return d ? Number(d) : NaN; };
  const symbol = s => (String(s || '').match(/[^\d\s.,]+/) || [''])[0];  // 💲, 💎…
  const fmt = n => n.toLocaleString('pt-BR');
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  // Visual PokeBoard ligado? No "Original" o tokens.css sai, e os extras saem junto.
  const skinOn = () => !!getComputedStyle(document.documentElement).getPropertyValue('--pb-screen').trim();
  function maxFor(row) {
    const moneyText = row.closest(WIN)?.querySelector(MONEY)?.textContent;
    const priceText = row.querySelector(PRICE)?.textContent;
    const money = digits(moneyText), price = digits(priceText);
    if (!(money >= 0) || !(price > 0)) return 0;
    if (symbol(priceText) && symbol(moneyText) && symbol(priceText) !== symbol(moneyText)) return 0;  // outra moeda
    let n = Math.floor(money / price);
    for (const el of row.querySelectorAll(`${QTY_BAR} input`)) {
      const cap = el.getAttribute('max');
      if (cap !== null && cap !== '' && Number.isFinite(+cap)) n = Math.min(n, +cap);
    }
    return Math.max(0, n);
  }
  // Campo controlado pelo React: troca o valor pelo setter nativo e avisa com um "input", como se fosse digitado.
  function setValue(input, v) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function mount(win) {
    for (const row of win.querySelectorAll(BUY_ROW)) {
      const num = row.querySelector(`${QTY_BAR} input[type="number"]`);
      if (!num) continue;
      let b = row.querySelector('.pb-mks-max');
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'mks-qtymax nsh-chip pb-mks-max';  // classes do Máx do jogo: no design original fica igual a ele
        b.textContent = 'Máx';
        num.after(b);
      }
      const n = maxFor(row);
      const tip = n ? `Pôr ${fmt(n)} na quantidade (o máximo que o dinheiro paga)` : 'O dinheiro não paga nenhum';
      if (b.title !== tip) b.title = tip;
      if (b.disabled !== !n) b.disabled = !n;
    }
  }

  document.addEventListener('click', e => {
    const b = e.target.closest?.('.pb-mks-max');
    const row = b?.closest(BUY_ROW);
    if (!row) return;
    const n = maxFor(row);
    const num = row.querySelector(`${QTY_BAR} input[type="number"]`);
    if (!n || !num) return;
    setValue(num, n);
    // O controle deslizante acompanha o número; se o jogo não o atualizar sozinho, ajusta ele também
    // (só se ele comporta o valor: sem "max" o navegador cortaria em 100 e o jogo leria 100).
    const range = row.querySelector(`${QTY_BAR} input[type="range"]`);
    if (range && Number(range.value) !== n && Number(range.max) >= n) setValue(range, n);
  });

  // ---------- preço do Mercado nas três abas ----------
  // Preços de window.__pbPrices (acima): o anúncio mais barato em dollars de cada item e espécie, da última vez que o
  // jogo carregou o Mercado neste painel.
  const P = window.__pbPrices;
  const species = P.species;
  let market = null;  // P.market() a cada passada

  const ago = ms => {
    const m = Math.round(ms / 60000);
    return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
  };
  const put = (el, text, title, cmp) => {
    if (el.textContent !== text) el.textContent = text;
    if (el.title !== title) el.title = title;
    if (cmp !== undefined && el.dataset.cmp !== cmp) el.dataset.cmp = cmp;
  };
  const net = P.net;
  const fee = `${Math.round(P.FEE * 100)}%`;
  const sellers = n => `${n} ${n > 1 ? 'vendedores' : 'vendedor'}`;
  // data-cmp="good": o Mercado é o melhor negócio (compra mais barata ou venda que rende mais).
  const TEXT = {
    // Comprar: o Mark cobra; no Mercado o comprador paga o anúncio, sem taxa.
    buy: (m, mark) => {
      const cmp = m.p < mark ? 'good' : m.p > mark ? 'bad' : 'same';
      return [cmp, `${{ good: '▼', bad: '▲', same: '=' }[cmp]} Mercado 💲${fmt(m.p)}/un`,
        `Anúncio mais barato em dollars: 💲${fmt(m.p)} por unidade (${fmt(m.q)} un, ${sellers(m.s)}). O Mark cobra 💲${fmt(mark)}. `
        + (cmp === 'good' ? 'No Mercado sai mais barato.' : cmp === 'bad' ? 'Com o Mark sai mais barato.' : 'Mesmo preço.')];
    },
    // Vender: o Mark paga; no Mercado o vendedor recebe o anúncio menos a taxa.
    sell: (m, mark, stock) => {
      const v = net(m.p), cmp = v > mark ? 'good' : v < mark ? 'bad' : 'same';
      const total = stock ? ` Com ${fmt(stock)} un: Mercado até 💲${fmt(stock * v)}, Mark 💲${fmt(stock * mark)}.` : '';
      return [cmp, `${{ good: '▲', bad: '▼', same: '=' }[cmp]} Mercado rende 💲${fmt(v)}/un`,
        `Anúncio mais barato em dollars: 💲${fmt(m.p)} por unidade (${fmt(m.q)} un, ${sellers(m.s)}); menos ${fee} de taxa, rende 💲${fmt(v)}. `
        + `O Mark paga 💲${fmt(mark)}.${total}`];
    },
    // Pokémon: o mais barato parecido (mesma espécie e raridade, IV ±10); m.want = { iv, label } da linha.
    poke: (m, mark) => {
      const v = net(m.p), cmp = v > mark ? 'good' : v < mark ? 'bad' : 'same';
      return [cmp, `${{ good: '▲', bad: '▼', same: '=' }[cmp]} Parecido rende 💲${fmt(v)}`,
        `Mais barato parecido à venda em dollars: mesma espécie, ${m.want.label} (qualquer multiplicador) e IV de ${m.want.iv - P.IV_MARGIN} a ${m.want.iv + P.IV_MARGIN}, sem shiny. `
        + `💲${fmt(m.p)} (IV ${m.iv}, ×${m.q.toFixed(2)}), entre ${fmt(m.n)} parecido(s) de ${fmt(m.all)} anúncio(s) conhecidos da espécie; `
        + `menos ${fee} de taxa, rende 💲${fmt(v)}. O Mark paga 💲${fmt(mark)}.`
        + (market.pkCap ? ` O jogo só manda ${fmt(market.pkCap)} anúncios de Pokémon; pode haver mais barato.` : '')];
    },
  };
  function rowsOf(win) {
    const out = [];
    for (const row of win.querySelectorAll(BUY_ROW)) out.push([row, 'buy']);
    for (const row of win.querySelectorAll(SELL_ROW)) out.push([row, 'sell']);
    for (const row of win.querySelectorAll(POKE_ROW)) if (!row.closest(SELL_ROW)) out.push([row, 'poke']);
    return out;
  }
  function mountCompare(win, on) {
    market = P.market();
    const rows = on ? rowsOf(win) : [];
    let note = win.querySelector('.pb-mks-mkt-age');
    if (!rows.length) {
      note?.remove();
      win.querySelectorAll('.pb-mks-mkt').forEach(el => el.remove());
      return;
    }
    const strip = win.querySelector(STRIP);
    if (!note && strip) { note = document.createElement('span'); note.className = 'pb-mks-mkt-age'; strip.prepend(note); }
    const when = Math.max(market?.at || 0, market?.spAt || 0);  // lista principal ou, sem ela, a de espécies
    if (note) put(note, when ? `Preços do Mercado: ${ago(Date.now() - when)}` : 'Abra o Mercado uma vez para comparar os preços',
      `Anúncio mais barato em dollars, da última vez que o Mercado foi aberto neste painel. Nas vendas, já sem a taxa de ${fee}.`);
    for (const [row, mode] of rows) {
      const info = row.querySelector('.mks-info');
      const name = row.querySelector('.mks-name')?.textContent;
      if (!info || !name) continue;
      let el = info.querySelector('.pb-mks-mkt');
      if (!el) { el = document.createElement('div'); el.className = 'pb-mks-mkt'; info.append(el); }
      if (!market) { put(el, 'Mercado: abra o Mercado', 'Sem preços do Mercado ainda neste painel.', 'none'); continue; }
      let m;
      if (mode === 'poke') {
        // "Nv 1 · · IV 100 Incomum": IV e raridade do Pokémon da linha.
        const meta = row.querySelector('.mks-meta')?.textContent || '';
        const iv = Number((meta.match(/IV\s*(\d+)/i) || [])[1]);
        const label = P.GRADE_NAMES.find(g => norm(meta).includes(norm(g)));
        if (!Number.isFinite(iv) || !label) { put(el, 'Mercado: sem IV ou raridade', `Não achei o IV e a raridade de ${name} nesta linha.`, 'none'); continue; }
        m = P.similar(name, iv, label);
        if (m === undefined) { put(el, 'Mercado: abra o Mercado', 'Sem preços do Mercado ainda neste painel.', 'none'); continue; }
        if (!m) {
          const sp = P.speciesMin(name), none = `Nenhum ${name} ${label} com IV de ${iv - P.IV_MARGIN} a ${iv + P.IV_MARGIN} conhecido à venda em dollars.`;
          if (sp) put(el, `~ Espécie a partir de 💲${fmt(sp.p)}`, `${none} O mais barato da espécie (qualquer raridade e IV) é 💲${fmt(sp.p)}, entre ${fmt(sp.n)} anúncio(s)${sp.whole ? ' no Mercado inteiro' : ' conhecidos'}.`, 'none');
          else put(el, 'Mercado: nenhum parecido', `${none} Nenhum anúncio da espécie.`, 'none');
          continue;
        }
        m.want = { iv, label };
      } else m = market.items[norm(name)];
      if (!m) { put(el, 'Mercado: sem anúncio em dollars', `Nenhum anúncio de ${name} em dollars no Mercado (${ago(Date.now() - (market.at || market.spAt))}).`, 'none'); continue; }
      const mark = digits(row.querySelector(PRICE)?.textContent) || 0;
      const stock = mode === 'sell' ? digits((row.querySelector('.mks-meta')?.textContent || '').split('×')[0]) || 0 : 0;
      const [cmp, text, title] = TEXT[mode](m, mark, stock);
      put(el, text, title, cmp);
    }
  }

  setInterval(() => {
    const win = document.querySelector(WIN);
    if (!win) return;
    mount(win);
    mountCompare(win, skinOn());
  }, CHECK_MS);
})();
