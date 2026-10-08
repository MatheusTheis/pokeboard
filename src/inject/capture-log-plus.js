// Log de capturas+: troca as abas do jogo (Todos / ✨ Shiny / Normais) por três botões curtos:
//   ✨ Shiny  liga/desliga "só shiny"      IV↓  ordena pelo IV        Rar↓  ordena pela qualidade (Fraca → Divina)
// Tudo na tela, sobre as linhas que o jogo já carregou: não busca nada e não clica em nada do jogo.
(() => {
  if (window.__pbClog) return;
  window.__pbClog = true;

  // Seletores do jogo (log de capturas). Ajuste aqui quando o jogo atualizar.
  const WIN = '.clog-window';
  const HEAD = '.clog-head';
  const LIST = '.clog-list';
  const ROW = '.clog-row';      // .shiny quando é shiny
  const META = '.clog-meta';    // "<b>Incomum</b> · IV 82/192"
  const CHECK_MS = 1000;
  // Ordem das qualidades, da pior para a melhor (a mesma dos filtros do Mercado).
  const TIERS = ['fraca', 'comum', 'incomum', 'rara', 'épica', 'lendária', 'mítica', 'anciã', 'divina'];

  const ui = { shiny: false, sort: '' };  // sort: '' | 'iv' | 'rar'
  let win = null, mo = null, pending = 0;

  const bar = document.createElement('div');
  bar.id = 'pb-clog-tools';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Filtrar e ordenar o log');
  bar.innerHTML = `
    <button type="button" data-a="shiny" title="Mostrar só os shiny (clique de novo para ver todos)">✨ Shiny</button>
    <button type="button" data-a="iv" title="Ordenar pelo IV, maior primeiro (clique de novo para a ordem do jogo)">IV↓</button>
    <button type="button" data-a="rar" title="Ordenar pela qualidade, de Divina a Fraca (clique de novo para a ordem do jogo)">Rar↓</button>`;
  bar.addEventListener('click', e => {
    e.stopPropagation();  // o clique é nosso: não deixa chegar nos handlers do jogo
    const a = e.target.closest('button[data-a]')?.dataset.a;
    if (a === 'shiny') ui.shiny = !ui.shiny;
    if (a === 'iv' || a === 'rar') ui.sort = ui.sort === a ? '' : a;
    apply();
  });

  function readRow(row) {
    const meta = row.querySelector(META)?.textContent || '';
    const iv = Number(meta.match(/IV\s*(\d+)/i)?.[1] ?? -1);
    const tier = TIERS.indexOf((row.querySelector(`${META} b`)?.textContent || '').trim().toLowerCase());
    return { iv, tier };
  }

  function apply() {
    pending = 0;
    if (!win?.isConnected) return;
    const head = win.querySelector(HEAD), list = win.querySelector(LIST);
    if (head && bar.parentElement !== head) head.append(bar);
    // O CSS (game-skin.css) lê estes atributos: esconde não-shiny e usa --pb-ord como ordem.
    if (list) {
      list.toggleAttribute('data-pb-shiny', ui.shiny);
      if (ui.sort) list.dataset.pbSort = ui.sort; else delete list.dataset.pbSort;
      if (ui.sort) {
        const rows = [...list.querySelectorAll(ROW)].map((el, i) => ({ el, i, ...readRow(el) }));
        const key = ui.sort === 'iv' ? r => r.iv : r => r.tier * 1000 + r.iv;  // empate na qualidade: maior IV
        rows.sort((a, b) => key(b) - key(a) || a.i - b.i)
          .forEach((r, n) => { if (r.el.style.getPropertyValue('--pb-ord') !== String(n)) r.el.style.setProperty('--pb-ord', String(n)); });
      }
    }
    bar.querySelector('[data-a=shiny]').setAttribute('aria-pressed', String(ui.shiny));
    bar.querySelector('[data-a=iv]').setAttribute('aria-pressed', String(ui.sort === 'iv'));
    bar.querySelector('[data-a=rar]').setAttribute('aria-pressed', String(ui.sort === 'rar'));
  }
  const schedule = () => { if (!pending) pending = setTimeout(apply, 120); };

  // Acompanha só a janela do log: linhas novas (mais capturas, outra página) reaplicam a ordem.
  setInterval(() => {
    const w = document.querySelector(WIN);
    if (w === win) return;
    mo?.disconnect();
    win = w;
    if (!win) return;
    mo = new MutationObserver(schedule);
    mo.observe(win, { childList: true, subtree: true });
    apply();
  }, CHECK_MS);
})();
