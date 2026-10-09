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

// Loja do Mark.
// Comprar: botão "Máx" em cada item, igual ao que o jogo já tem no Vender. A pedido do jogador (clique no Máx), põe
// na quantidade o máximo que o dinheiro paga: dinheiro ÷ preço, dentro do limite do controle deslizante do jogo.
// Só preenche o campo; a compra continua no botão Comprar do jogo.
// Vender: ao lado do que o Mark paga, o anúncio mais barato em dollars do mesmo item no Mercado (abaixo).
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
  const STRIP = '.mks-strip';                 // faixa do dinheiro, no topo
  const MARKET_API = '/api/game/market';      // resposta guardada pelo hook.js: listings[] com preço por unidade
  const MARKET_KEY = 'pb:market-min';         // localStorage do painel: o mais barato de cada item + a hora
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

  // ---------- Vender: preço do Mercado ----------
  // Quando o Mercado abre, o jogo baixa todos os anúncios de uma vez (preço por unidade). Daqui sai o mais barato em
  // dollars de cada item, fora os seus; fica guardado com a hora para valer também depois de fechar o Mercado.
  // Nada é buscado por nós: vale o que o jogo carregou da última vez.
  let market = (() => { try { const v = JSON.parse(localStorage.getItem(MARKET_KEY) || 'null'); return v?.items ? v : null; } catch { return null; } })();
  function learn(hit) {
    const list = hit?.data?.listings;
    if (!Array.isArray(list) || !list.length) return;  // resposta sem anúncios (outra aba): mantém a anterior
    const mine = new Set((hit.data.mine || []).flatMap(l => l.ids || [l.id]));
    const items = {};
    for (const l of list) {
      if (l.currency !== 'GOLD' || l.offerOnly || l.kind === 'pokemon' || !(l.price > 0) || !l.name) continue;
      if ((l.ids || [l.id]).every(id => mine.has(id))) continue;
      const k = norm(l.name), cur = items[k];
      if (!cur || l.price < cur.p) items[k] = { p: l.price, q: l.quantity || 0, s: l.sellers || 1 };
    }
    market = { at: hit.at || Date.now(), items };
    try { localStorage.setItem(MARKET_KEY, JSON.stringify(market)); } catch {}
  }
  learn(window.__pbCache?.[MARKET_API]);
  window.addEventListener('pb:data', e => { if (e.detail?.path === MARKET_API) learn(window.__pbCache?.[MARKET_API]); });

  const ago = ms => {
    const m = Math.round(ms / 60000);
    return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
  };
  const put = (el, text, title, cmp) => {
    if (el.textContent !== text) el.textContent = text;
    if (el.title !== title) el.title = title;
    if (cmp !== undefined && el.dataset.cmp !== cmp) el.dataset.cmp = cmp;
  };
  function mountSell(win, on) {
    const rows = win.querySelectorAll(SELL_ROW);
    let note = win.querySelector('.pb-mks-mkt-age');
    if (!on || !rows.length) {
      note?.remove();
      win.querySelectorAll('.pb-mks-mkt').forEach(el => el.remove());
      return;
    }
    const strip = win.querySelector(STRIP);
    if (!note && strip) { note = document.createElement('span'); note.className = 'pb-mks-mkt-age'; strip.prepend(note); }
    if (note) put(note, market ? `Preços do Mercado: ${ago(Date.now() - market.at)}` : 'Abra o Mercado uma vez para comparar os preços',
      'Anúncio mais barato em dollars de cada item, da última vez que o Mercado foi aberto neste painel.');
    for (const row of rows) {
      const info = row.querySelector('.mks-info');
      const name = row.querySelector('.mks-name')?.textContent;
      if (!info || !name) continue;
      let el = info.querySelector('.pb-mks-mkt');
      if (!el) { el = document.createElement('div'); el.className = 'pb-mks-mkt'; info.append(el); }
      const mark = digits(row.querySelector(PRICE)?.textContent) || 0;
      const stock = digits((row.querySelector('.mks-meta')?.textContent || '').split('×')[0]) || 0;
      const m = market?.items[norm(name)];
      if (!market) { put(el, 'Mercado: abra o Mercado', 'Sem preços do Mercado ainda neste painel.', 'none'); continue; }
      if (!m) { put(el, 'Mercado: sem anúncio em dollars', `Nenhum anúncio de ${name} em dollars no Mercado (${ago(Date.now() - market.at)}).`, 'none'); continue; }
      const cmp = m.p > mark ? 'up' : m.p < mark ? 'down' : 'same';
      const total = stock ? ` Com ${fmt(stock)} un: Mercado até 💲${fmt(stock * m.p)}, Mark 💲${fmt(stock * mark)}.` : '';
      put(el, `${{ up: '▲', down: '▼', same: '=' }[cmp]} Mercado 💲${fmt(m.p)}/un`,
        `Anúncio mais barato em dollars: 💲${fmt(m.p)} por unidade (${fmt(m.q)} un, ${m.s} ${m.s > 1 ? 'vendedores' : 'vendedor'}). `
        + `O Mark paga 💲${fmt(mark)}.${total} Sem descontar taxa do Mercado, se houver.`, cmp);
    }
  }

  setInterval(() => {
    const win = document.querySelector(WIN);
    if (!win) return;
    mount(win);
    mountSell(win, skinOn());
  }, CHECK_MS);
})();
