// Mercado+: filtro de moeda (Dollars / Diamonds) no Mercado Global.
// Só mostra e esconde os anúncios que o jogo já carregou na página aberta: não busca nada, não clica em nada.
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
