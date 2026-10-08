// HUD minimalista: botão ▴/▾ no cartão do jogador recolhe o time, deixando só o cabeçalho e o Pokémon ativo.
// Só visual (o CSS esconde os outros com animação); a escolha vai para o board.json e vale para todas as contas.
(() => {
  if (window.__pbHud) return;
  window.__pbHud = true;

  const HEAD = '.game-root .phud .phud-head';  // cabeçalho do cartão do jogador (ver game-skin.css)
  const ATTR = 'data-pb-hud-min';               // no <html>; aplicado pelo preload a partir do board.json
  const CHECK_MS = 1500;
  const root = document.documentElement;

  const btn = document.createElement('button');
  btn.id = 'pb-hud-toggle';
  btn.type = 'button';
  function update() {
    const min = root.hasAttribute(ATTR);
    btn.textContent = min ? '▾' : '▴';
    const label = min ? 'Mostrar o time todo' : 'Mostrar só o Pokémon ativo';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-expanded', String(!min));
  }
  btn.addEventListener('click', e => {
    e.stopPropagation();  // o clique é nosso: não deixa chegar nos handlers do cartão do jogo
    const min = !root.hasAttribute(ATTR);
    root.toggleAttribute(ATTR, min);  // muda já; o main salva e avisa as outras contas
    root.dataset.pbPrefSave = JSON.stringify({ key: 'hudMin', value: min });
    window.dispatchEvent(new Event('pb:pref-save'));
    update();
  });
  // Outra conta mudou a preferência: o preload troca o atributo e o botão acompanha.
  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: [ATTR] });
  update();

  // O jogo recria o cartão ao trocar de tela: recoloca o botão.
  setInterval(() => {
    const head = document.querySelector(HEAD);
    if (head && btn.parentElement !== head) head.append(btn);
  }, CHECK_MS);
})();
