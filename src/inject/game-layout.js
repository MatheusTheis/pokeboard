// Ajustes de layout que o CSS sozinho não resolve. Só lê o DOM e define variáveis CSS nossas (--pb-*):
// não clica, não envia nada e não mexe em funções do jogo.
(() => {
  if (window.__pbLayout) return;
  window.__pbLayout = true;

  const DOCK = '.game-root .game-dock';  // barra de telas (ver game-skin.css)
  const PARTY = '.game-root .game-hud-tl';  // cartão do jogador + time
  const CHAT = '.game-root .chat-box';
  const LEFT_COL_W = 420;                // largura das janelas que abrem na coluna da esquerda (Hunt Analyzer)
  const CHECK_MS = 1500;                 // o jogo pode recriar a barra (troca de tela, reconexão)
  const root = document.documentElement;
  const setVar = (name, v) => { if (root.style.getPropertyValue(name) !== v) root.style.setProperty(name, v); };

  // A barra quebra em 2 linhas quando o painel é estreito: o resto do topo (cartão do jogador,
  // cronômetro, Auto-Helper) usa --pb-dock-h para descer junto. Fica no <html>, fora do que o jogo controla.
  let current = null;
  const ro = new ResizeObserver(() => {
    if (current) setVar('--pb-dock-h', `${Math.ceil(current.getBoundingClientRect().height)}px`);
  });
  // Vão livre da coluna da esquerda: de baixo do cartão do jogador até em cima do chat.
  // O Hunt Analyzer abre ali para não cobrir nada (game-skin.css usa --pb-left-top e --pb-left-h).
  // O chat pode ser arrastado: só conta como limite se estiver na mesma coluna.
  function measureLeftColumn() {
    const party = document.querySelector(PARTY)?.getBoundingClientRect();
    const chat = document.querySelector(CHAT)?.getBoundingClientRect();
    const dockH = current ? current.getBoundingClientRect().height : 52;
    const top = Math.ceil((party && party.height ? party.bottom : dockH) + 12);
    const chatInColumn = chat && chat.height && chat.left < 16 + LEFT_COL_W && chat.right > 16 && chat.top > top;
    const bottom = chatInColumn ? chat.top - 12 : innerHeight - 14;
    setVar('--pb-left-top', `${top}px`);
    // Altura exata do vão: nada de mínimo grande, senão a janela passaria por cima do chat.
    setVar('--pb-left-h', `${Math.max(80, Math.floor(bottom - top))}px`);
  }

  // Hunt Analyzer: o botão "Ver Log de Capturas" do jogo vai para cima do card "Capturados" (invisível,
  // game-skin.css). O clique continua caindo no botão do próprio jogo: nada é clicado por nós.
  // Os dois ficam dentro de .ha-body (que rola); medimos o card relativo a ele.
  const HA_BODY = '.game-root .ha-window .ha-body';
  const HA_CATCH = '.ha-card.ha-catch';
  const HA_CLOG = '.ha-clog-btn';
  let catchCard = null;
  const catchRo = new ResizeObserver(() => placeCaptureLogButton());
  function placeCaptureLogButton() {
    const body = document.querySelector(HA_BODY);
    const card = body?.querySelector(HA_CATCH);
    if (card !== catchCard) {
      if (catchCard) catchRo.unobserve(catchCard);
      catchCard = card || null;
      if (card) catchRo.observe(card);
    }
    if (!card || !body.querySelector(HA_CLOG) || card.offsetParent !== body) {
      if (root.hasAttribute('data-pb-clog')) root.removeAttribute('data-pb-clog');  // botão volta ao lugar do jogo
      return;
    }
    setVar('--pb-clog-x', `${card.offsetLeft}px`);
    setVar('--pb-clog-y', `${card.offsetTop}px`);
    setVar('--pb-clog-w', `${card.offsetWidth}px`);
    setVar('--pb-clog-h', `${card.offsetHeight}px`);
    if (!root.hasAttribute('data-pb-clog')) root.setAttribute('data-pb-clog', '');
  }

  // Hunt Analyzer: o card "Derrotados" abre a ficha do Pokémon da hunt atual (card do PokeBoard, pb-card.js).
  // A hunt é o nome que o cartão do jogador mostra ("Nível 290 · Sneasel"). O card do jogo não tem ação;
  // o clique é tratado só por nós.
  const KILLS_LABEL = /derrotad/i;
  const huntName = () => (document.querySelector(LOCATION)?.textContent || '').split('·').pop().trim();
  function markKillsCard() {
    for (const c of document.querySelectorAll(`${HA_BODY} .ha-card`)) {
      const is = KILLS_LABEL.test(c.querySelector('small')?.textContent || '');
      if (is !== c.hasAttribute('data-pb-link')) c.toggleAttribute('data-pb-link', is);
    }
  }
  document.addEventListener('click', e => {
    const c = e.target.closest?.(`${HA_BODY} .ha-card[data-pb-link]`);
    if (!c || !window.__pbCard) return;
    const name = huntName();
    const sp = window.__pbCard.species({ name });
    window.__pbCard.open({
      name,
      facts: [['Derrotados nesta sessão', (c.querySelector('b')?.textContent || '').trim()]],
      note: sp ? '' : `"${name}" não é uma hunt de Pokémon (cidade ou área). Vá para uma hunt para ver a ficha.`,
    });
  });

  // Barra de telas no modo dividido: uma fileira de ícones grandes com rolagem (game-windows.css).
  // A roda do mouse rola para o lado; Ctrl + roda continua sendo o zoom do painel.
  let wheelEl = null;
  function onDockWheel(e) {
    const el = e.currentTarget;
    if (e.ctrlKey || el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }
  function hookDockWheel() {
    const sc = current?.querySelector('.dock-scroll') || null;
    if (sc === wheelEl) return;
    wheelEl?.removeEventListener('wheel', onDockWheel);
    wheelEl = sc;
    sc?.addEventListener('wheel', onDockWheel, { passive: false });
  }

  // Atalho "Mercado · Mark": botão nosso na barra de telas abre um card com dois botões.
  // EXCEÇÃO à regra "nada de automação" (README › Regras), autorizada pelo autor só para este atalho: ao escolher,
  // o PokeBoard aperta os botões do próprio jogo na ordem até abrir (de onde você estiver):
  //   hunt → "Voltar para Cerulean" → "Ir ao Mercado" (teleporta ao Shopping) → "Abrir Market" ou o "Conversar" do Mark.
  // Nada além disso: não compra, não vende, não escolhe nada dentro das janelas.
  // No Shopping, as placas dos NPCs ficam no DOM mesmo fora da tela. O nome dos NPCs é desenhado em canvas:
  // o Mark é o "Conversar" de nome mais curto (~33px; os outros "Conversar" do Shopping têm 100px ou mais).
  const PLATE_BTN = '.game-root .field-plate .npc-plate-btn';
  const CTA = '.game-root .market-cta';                                       // "Ir ao Mercado" (só em cidade)
  const HOME = '.game-root .game-dock .dock-btn[data-guide="dock-home"]';     // "Voltar para Cerulean"
  const MARK_MAX_NAME_W = 50;
  const STEP_TIMEOUT_MS = 20000;   // cada viagem; passou disso (confirmação do jogo, erro), para e avisa
  const ARRIVE_PAUSE_MS = 500;     // depois de chegar, um respiro antes do próximo botão

  const quickBtn = document.createElement('button');
  quickBtn.id = 'pb-quick-btn';
  quickBtn.type = 'button';
  quickBtn.textContent = 'Mercado · Mark';
  quickBtn.title = 'Abrir o Mercado ou o Mark de onde você estiver';
  quickBtn.setAttribute('aria-expanded', 'false');
  const quickCard = document.createElement('div');
  quickCard.id = 'pb-quick-card';
  quickCard.hidden = true;
  quickCard.setAttribute('role', 'dialog');
  quickCard.setAttribute('aria-label', 'Mercado ou Mark');
  quickCard.innerHTML = `
    <div class="pbq-bar"><span class="pbq-lens" aria-hidden="true"></span><h2>Mercado · Mark</h2>
      <button type="button" class="pbq-x" aria-label="Fechar">×</button></div>
    <div class="pbq-screen">
      <div class="pbq-opts">
        <button type="button" class="pbq-opt" data-go="market"><b>Mercado</b><small class="pbq-sub"></small></button>
        <button type="button" class="pbq-opt" data-go="mark"><b>Mark</b><small class="pbq-sub"></small></button>
      </div>
      <p class="pbq-status" aria-live="polite"></p>
      <button type="button" class="pbq-cancel" hidden>Cancelar</button>
    </div>`;
  const statusEl = quickCard.querySelector('.pbq-status'), cancelEl = quickCard.querySelector('.pbq-cancel');

  function findPlates() {
    let market = null, mark = null, markW = Infinity;
    for (const b of document.querySelectorAll(PLATE_BTN)) {
      const t = b.textContent.trim().toLowerCase();
      if (t.includes('abrir market')) market = b;
      else if (t.includes('conversar')) {
        // Mede o canvas do nome (o span em volta pode não ter a largura dele). Duas buscas: com a lista
        // '.field-name canvas, .field-name' o querySelector devolveria o span, que vem antes na página.
        const plate = b.closest('.field-plate');
        const name = plate?.querySelector('.field-name canvas') || plate?.querySelector('.field-name');
        const w = name?.getBoundingClientRect().width || Infinity;
        if (w < MARK_MAX_NAME_W && w < markW) { mark = b; markW = w; }
      }
    }
    return { market, mark };
  }
  // Onde estou: "shopping" (placas à vista), "city" (tem "Ir ao Mercado") ou "hunt".
  const whereAmI = () => { const p = findPlates(); return p.market || p.mark ? 'shopping' : document.querySelector(CTA) ? 'city' : 'hunt'; };
  const SUBS = { shopping: 'Abre na hora', city: 'Vai ao Shopping e abre', hunt: 'Volta à cidade, vai ao Shopping e abre' };

  function updateQuick() {
    const dock = current, gameRoot = document.querySelector('.game-root');
    if (dock && quickBtn.parentElement !== dock) dock.insertBefore(quickBtn, dock.querySelector('#pb-dock-edit'));
    if (gameRoot && quickCard.parentElement !== gameRoot) gameRoot.append(quickCard);
    if (quickCard.hidden || run) return;
    const sub = SUBS[whereAmI()];
    quickCard.querySelectorAll('.pbq-sub').forEach(s => { if (s.textContent !== sub) s.textContent = sub; });
  }

  // ---------- o caminho até a janela ----------
  let run = null;  // viagem em andamento: { cancelled }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function setStatus(msg, busy) {
    statusEl.textContent = msg;
    cancelEl.hidden = !busy;
    quickCard.querySelectorAll('.pbq-opt').forEach(b => { b.disabled = !!busy; });
  }
  async function go(target) {
    const token = run = { cancelled: false };
    const until = async (fn, what) => {
      for (const t0 = Date.now(); Date.now() - t0 < STEP_TIMEOUT_MS; await sleep(300)) {
        if (token.cancelled) throw new Error('cancelado');
        const v = fn();
        if (v) return v;
      }
      throw new Error(`${what} demorou demais`);
    };
    const btn = () => findPlates()[target];
    try {
      if (!btn()) {
        if (!document.querySelector(CTA)) {
          const home = document.querySelector(HOME);
          if (!home) throw new Error('não achei o botão "Voltar para Cerulean" na barra');
          setStatus('Voltando para Cerulean…', true);
          home.click();
          await until(() => document.querySelector(CTA), 'Voltar para Cerulean');
          await sleep(ARRIVE_PAUSE_MS);
        }
        setStatus('Indo para o Shopping…', true);
        document.querySelector(CTA).click();
        await until(btn, target === 'market' ? 'Achar o Mercado' : 'Achar o Mark');
        await sleep(ARRIVE_PAUSE_MS);
      }
      if (token.cancelled) throw new Error('cancelado');
      setStatus(target === 'market' ? 'Abrindo o Mercado…' : 'Abrindo o Mark…', true);
      btn().click();
      setStatus('', false);
      setQuick(false);
    } catch (e) {
      setStatus(e.message === 'cancelado' ? 'Cancelado.' : `Parei: ${e.message}. O resto é com você.`, false);
    } finally {
      if (run === token) run = null;
    }
  }

  function setQuick(open) {
    if (!open && run) run.cancelled = true;
    quickCard.hidden = !open;
    quickBtn.setAttribute('aria-expanded', String(open));
    if (open) { setStatus('', false); updateQuick(); quickCard.querySelector('.pbq-opt').focus(); }
  }
  quickBtn.addEventListener('click', e => { e.stopPropagation(); setQuick(quickCard.hidden); });
  for (const ev of ['pointerdown', 'mousedown', 'wheel', 'keyup']) quickCard.addEventListener(ev, e => e.stopPropagation());
  quickCard.addEventListener('click', e => {
    e.stopPropagation();
    if (e.target.closest('.pbq-x')) return setQuick(false);
    if (e.target.closest('.pbq-cancel')) { if (run) run.cancelled = true; return; }
    const t = e.target.closest('.pbq-opt[data-go]')?.dataset.go;
    if (t && !run) go(t);
  });
  quickCard.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { setQuick(false); quickBtn.focus(); } });
  // Clique de verdade fora do card fecha (os cliques que o próprio atalho dá nos botões do jogo não contam).
  document.addEventListener('click', e => {
    if (quickCard.hidden || !e.isTrusted) return;
    if (!e.target.closest?.('#pb-quick-card, #pb-quick-btn')) setQuick(false);
  }, true);

  // Mapa atual (o cartão do jogador mostra "Nível 290 · Shopping"): vira html[data-pb-map="shopping"],
  // para o CSS ligar coisas só num mapa, como o céu com nuvens no Shopping.
  const LOCATION = '.game-root .phud-tloc';
  function markMap() {
    const txt = document.querySelector(LOCATION)?.textContent || '';
    const map = (txt.split('·').pop() || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-');
    if ((root.dataset.pbMap || '') !== map) { if (map) root.dataset.pbMap = map; else delete root.dataset.pbMap; }
  }

  // Céu do Shopping: o "vazio" em volta do prédio é desenhado pelo jogo no canvas em cinza-claro
  // (#e8–#ef com textura). Este filtro deixa transparente só o cinza neutro entre #d7 e #f4 (chão e paredes
  // do prédio ficam abaixo de #c8; branco de roupas e brilhos fica acima de #f5), e o céu do CSS aparece atrás.
  // Faixa por canal: tabela "discrete" de 51 degraus, 1 entre os índices 43 (#d7) e 48 (#f4).
  const band = Array.from({ length: 51 }, (_, k) => (k >= 43 && k <= 48 ? 1 : 0)).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'pb-filters';
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  svg.innerHTML = `<filter id="pb-key-void" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feComponentTransfer in="SourceGraphic" result="band">
      <feFuncR type="discrete" tableValues="${band}"/><feFuncG type="discrete" tableValues="${band}"/>
      <feFuncB type="discrete" tableValues="${band}"/><feFuncA type="identity"/>
    </feComponentTransfer>
    <feColorMatrix in="band" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="r"/>
    <feColorMatrix in="band" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 1 0 0 0" result="g"/>
    <feColorMatrix in="band" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="b"/>
    <feComposite in="r" in2="g" operator="arithmetic" k1="1" result="rg"/>
    <feComposite in="rg" in2="b" operator="arithmetic" k1="1" result="mask"/>
    <!-- Abertura (encolhe e reexpande 3px): o piso das salas tem detalhes finos no mesmo cinza do vazio;
         eles somem da máscara e só as áreas grandes de vazio viram céu. -->
    <feMorphology in="mask" operator="erode" radius="3" result="eroded"/>
    <feMorphology in="eroded" operator="dilate" radius="3" result="opened"/>
    <feComposite in="SourceGraphic" in2="opened" operator="out"/>
  </filter>`;

  setInterval(() => {
    // Primeiro localiza a barra: o resto (roda do mouse, atalho Mercado · Mark) depende dela.
    const dock = document.querySelector(DOCK);
    if (dock !== current) {
      if (current) ro.unobserve(current);
      current = dock;
      if (dock) ro.observe(dock);
    }
    if (document.body && !svg.isConnected) document.body.append(svg);
    markMap();
    placeCaptureLogButton();
    markKillsCard();
    hookDockWheel();
    updateQuick();
    measureLeftColumn();
  }, CHECK_MS);
  addEventListener('resize', measureLeftColumn);
})();
