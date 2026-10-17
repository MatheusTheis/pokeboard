// Centro de Breeding: lembra a ordem da caixa de Pokémon (IV / Qualidade / Nível). O jogo sempre abre a tela em IV;
// quando a caixa aparece, devolvemos a última escolha pelo onChange do próprio seletor, como se você escolhesse de
// novo. Só muda a ordem da lista (estado da tela, nada vai para o servidor); fica no localStorage do painel, por conta.
(() => {
  if (window.__pbBreeding) return;
  window.__pbBreeding = true;

  const SORT = '.brd-box-sort';  // seletor de ordem da caixa (o jogo usa os valores iv, quality e level)
  const KEY = 'pb:breed-sort';
  const CHECK_MS = 700;          // a janela abre e fecha a qualquer hora

  const propsOf = el => { const k = Object.keys(el).find(x => x.startsWith('__reactProps$')); return k ? el[k] : null; };
  let sel = null;
  setInterval(() => {
    const s = document.querySelector(SORT);
    if (s === sel) return;
    sel = s;
    if (!s) return;
    s.addEventListener('change', () => { try { localStorage.setItem(KEY, s.value); } catch {} });
    let want = '';
    try { want = localStorage.getItem(KEY) || ''; } catch {}
    if (!want || want === s.value || ![...s.options].some(o => o.value === want)) return;
    propsOf(s)?.onChange?.({ target: { value: want }, currentTarget: { value: want } });
  }, CHECK_MS);
})();
