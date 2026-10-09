// Mercado+: filtro de moeda (Dollars / Diamonds) no Mercado Global; no fim, o "Máx" do Comprar da Loja do Mark.
// O filtro só mostra e esconde os anúncios que o jogo já carregou na página aberta: não busca nada, não clica em nada.
// A lista do jogo é paginada no servidor (12 por página) e a API não tem filtro de moeda,
// então o filtro vale para a página atual; o contador avisa quantos sobraram.
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
  const SELL_PICK = ':scope > .mkt-pick:not(.mkt-pick-pk)';  // grade de itens do Anunciar (a de Pokémon é .mkt-pick-pk)
  const num = s => Number(String(s || '').replace(/\D/g, '')) || 0;
  const fmt = n => n.toLocaleString('pt-BR');
  const compact = n => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n)).replace('.', ',');
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
      const v = P.net(m.p);
      return { t, i, name, v, mark, qty, m, gain: (v - mark) * qty };
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

  function apply() {
    pending = 0;
    if (!win?.isConnected) return;
    const slot = FILTER_SLOTS.map(s => win.querySelector(s)).find(Boolean);
    if (slot && control.parentElement !== slot) slot.append(control);
    if (win.dataset.pbCur !== filter) win.dataset.pbCur = filter;  // o CSS (game-skin.css) esconde por aqui
    win.toggleAttribute('data-pb-history', isHistory());           // linhas do Histórico viram clicáveis (CSS)
    mountSellForm();
    const sellForm = win.querySelector(SELLFORM);
    if (sellForm) mountWorth(sellForm);
    control.querySelectorAll('button[data-cur]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cur === filter)));

    // Marca cada anúncio com a moeda (só quando sabemos; os sem moeda nunca somem).
    const items = [...win.querySelectorAll(ITEMS)];
    let shown = 0;
    items.forEach((el, i) => {
      const c = currencyOf(el, i);
      if (c) { if (el.dataset.pbCur !== c) el.dataset.pbCur = c; } else if (el.dataset.pbCur) delete el.dataset.pbCur;
      if (!filter || !c || c === filter) shown++;
    });
    const txt = !filter || !items.length ? ''
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
  window.addEventListener('pb:data', e => { if (e.detail?.path === API) schedule(); });
})();

// Preços para comparar Mercado × Mark: usados no Anunciar (acima) e na Loja do Mark (abaixo).
// Mercado: quando abre, o jogo baixa todos os anúncios de uma vez (preço por unidade). Daqui sai o mais barato em
// dollars de cada item e de cada espécie (Pokémon sem shiny, qualquer nível), fora os seus; fica guardado com a hora
// no localStorage do painel, para valer também depois de fechar o Mercado.
// Mark: o npcPrice do /game/items.json, o que ele paga por unidade de cada item.
// Nada é buscado da API: vale o que o jogo carregou da última vez.
(() => {
  if (window.__pbPrices) return;
  const MARKET_API = '/api/game/market';  // resposta guardada pelo hook.js: listings[] com preço por unidade
  const ITEMS = '/game/items.json';       // arquivo público do jogo; normalmente o hook já guardou
  const KEY = 'pb:market-min';            // localStorage do painel: o mais barato de cada item + a hora
  const FEE = 0.03;                       // taxa do Mercado sobre vendas em dollars

  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const species = name => norm(String(name || '').replace(/\s+lv\.?\s*\d+$/i, ''));  // "Larvitar Lv.1" -> "larvitar"

  let market = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v?.items ? v : null; } catch { return null; } })();
  function learn(hit) {
    const list = hit?.data?.listings;
    if (!Array.isArray(list) || !list.length) return;  // resposta sem anúncios (outra aba): mantém a anterior
    const mine = new Set((hit.data.mine || []).flatMap(l => l.ids || [l.id]));
    const items = {}, pokes = {};
    for (const l of list) {
      if (l.currency !== 'GOLD' || l.offerOnly || !(l.price > 0) || !l.name) continue;
      if ((l.ids || [l.id]).every(id => mine.has(id))) continue;
      if (l.kind === 'pokemon') {
        if (l.shiny) continue;
        const k = species(l.name), cur = pokes[k];
        if (!cur) pokes[k] = { p: l.price, n: 1 };
        else { cur.n++; if (l.price < cur.p) cur.p = l.price; }
        continue;
      }
      const k = norm(l.name), cur = items[k];
      if (!cur || l.price < cur.p) items[k] = { p: l.price, q: l.quantity || 0, s: l.sellers || 1 };
    }
    // O jogo manda só parte dos anúncios de Pokémon (pkWindow.cap); a comparação deles vale para essa parte.
    market = { at: hit.at || Date.now(), items, pokes, pkCap: hit.data.pkWindow?.more ? hit.data.pkWindow.cap || 0 : 0 };
    try { localStorage.setItem(KEY, JSON.stringify(market)); } catch {}
  }
  learn(window.__pbCache?.[MARKET_API]);
  window.addEventListener('pb:data', e => { if (e.detail?.path === MARKET_API) learn(window.__pbCache?.[MARKET_API]); });

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
    FEE, norm, species,
    market: () => market,
    net: p => Math.floor(p * (1 - FEE)),          // o que o vendedor recebe no Mercado
    npc: name => npcMap()?.get(norm(name)),        // o que o Mark paga; undefined = sem dado
  };
})();

// Loja do Mark.
// Comprar: botão "Máx" em cada item, igual ao que o jogo já tem no Vender. A pedido do jogador (clique no Máx), põe
// na quantidade o máximo que o dinheiro paga: dinheiro ÷ preço, dentro do limite do controle deslizante do jogo.
// Só preenche o campo; a compra continua no botão Comprar do jogo.
// Nas três abas (Comprar, Vender, Pokémon): ao lado do preço do Mark, o anúncio mais barato em dollars do mesmo item
// ou espécie no Mercado, já sem a taxa nas vendas (abaixo).
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
    poke: (m, mark) => {
      const v = net(m.p), cmp = v > mark ? 'good' : v < mark ? 'bad' : 'same';
      return [cmp, `${{ good: '▲', bad: '▼', same: '=' }[cmp]} Mercado rende 💲${fmt(v)}`,
        `Mais barato da espécie à venda em dollars (qualquer nível e IV, sem shiny): 💲${fmt(m.p)}, entre ${fmt(m.n)} anúncio(s); `
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
    if (note) put(note, market ? `Preços do Mercado: ${ago(Date.now() - market.at)}` : 'Abra o Mercado uma vez para comparar os preços',
      `Anúncio mais barato em dollars, da última vez que o Mercado foi aberto neste painel. Nas vendas, já sem a taxa de ${fee}.`);
    for (const [row, mode] of rows) {
      const info = row.querySelector('.mks-info');
      const name = row.querySelector('.mks-name')?.textContent;
      if (!info || !name) continue;
      let el = info.querySelector('.pb-mks-mkt');
      if (!el) { el = document.createElement('div'); el.className = 'pb-mks-mkt'; info.append(el); }
      if (!market) { put(el, 'Mercado: abra o Mercado', 'Sem preços do Mercado ainda neste painel.', 'none'); continue; }
      const m = mode === 'poke' ? market.pokes?.[species(name)] : market.items[norm(name)];
      if (!m) { put(el, 'Mercado: sem anúncio em dollars', `Nenhum anúncio de ${name} em dollars no Mercado (${ago(Date.now() - market.at)}).`, 'none'); continue; }
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
