// Organizar a barra de telas: botão ✎ no fim da barra abre um painel para reordenar os ícones.
// Os botões da barra continuam sendo os do jogo; a ordem é aplicada por CSS (order) pelo main.
// Aqui só lemos a barra (ícones e nomes) e mostramos cópias deles no nosso painel.
(() => {
  if (window.__pbDockEditor) return;
  window.__pbDockEditor = true;

  // Seletores do jogo (ver game-skin.css).
  const DOCK = '.game-root .game-dock';
  const SCROLL = '.dock-scroll';
  const KEY = 'data-guide';  // nome estável de cada botão (dock-pokedex, dock-inventory…)
  const CHECK_MS = 1500;

  const editBtn = document.createElement('button');
  editBtn.id = 'pb-dock-edit';
  editBtn.type = 'button';
  editBtn.textContent = '✎';
  editBtn.title = 'Organizar a barra de telas';
  editBtn.setAttribute('aria-label', 'Organizar a barra de telas');
  editBtn.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('div');
  panel.id = 'pb-dock-editor';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Organizar a barra de telas');
  panel.innerHTML = `
    <div class="pb-de-bar"><span class="pb-de-lens" aria-hidden="true"></span><h2>Organizar barra</h2>
      <button type="button" class="pb-de-x" data-a="cancel" aria-label="Fechar">×</button></div>
    <div class="pb-de-screen">
      <p class="pb-de-hint">Arraste os ícones para mudar a ordem, ou clique num ícone e use ◀ ▶. Vale para todas as contas.</p>
      <ol class="pb-de-list"></ol>
      <div class="pb-de-actions">
        <span class="pb-de-move">
          <button type="button" data-a="left" aria-label="Mover o ícone selecionado para a esquerda">◀</button>
          <button type="button" data-a="right" aria-label="Mover o ícone selecionado para a direita">▶</button>
          <span class="pb-de-sel" aria-live="polite"></span>
        </span>
        <button type="button" class="pb-de-btn pb-de-btn--ghost" data-a="reset">Restaurar ordem do jogo</button>
        <button type="button" class="pb-de-btn pb-de-btn--secondary" data-a="cancel">Cancelar</button>
        <button type="button" class="pb-de-btn" data-a="save">Salvar</button>
      </div>
    </div>`;
  const list = panel.querySelector('.pb-de-list');
  const selInfo = panel.querySelector('.pb-de-sel');
  let selected = null, dragging = null;

  // Ícones na ordem em que aparecem agora (CSS order já aplicado, depois a ordem do DOM).
  function readDock() {
    const scroll = document.querySelector(DOCK)?.querySelector(SCROLL);
    if (!scroll) return [];
    return [...scroll.children].map((el, i) => {
      const btn = el.matches(`[${KEY}]`) ? el : el.querySelector(`[${KEY}]`);
      if (!btn) return null;
      return { key: btn.getAttribute(KEY), title: btn.title || btn.getAttribute('aria-label') || btn.getAttribute(KEY),
        src: btn.querySelector('img')?.src || '', order: Number(getComputedStyle(el).order) || 0, i };
    }).filter(Boolean).sort((a, b) => a.order - b.order || a.i - b.i);
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function render(items) {
    // draggable no próprio botão: no Chromium, arrastar a partir de um botão dentro de um <li> arrastável falha.
    list.innerHTML = items.map(it => `<li class="pb-de-item" data-key="${esc(it.key)}">
      <button type="button" draggable="true" title="${esc(it.title)}" aria-label="${esc(it.title)}">${it.src ? `<img src="${esc(it.src)}" alt="" draggable="false">` : esc(it.title.slice(0, 2))}</button></li>`).join('');
    select(null);
  }
  function select(li) {
    selected?.classList.remove('is-sel');
    selected = li;
    li?.classList.add('is-sel');
    selInfo.textContent = li ? li.querySelector('button').title : '';
  }

  function open() {
    render(readDock());
    panel.hidden = false;
    editBtn.setAttribute('aria-expanded', 'true');
    list.querySelector('button')?.focus();
  }
  function close() {
    panel.hidden = true;
    editBtn.setAttribute('aria-expanded', 'false');
    editBtn.focus();
  }
  // O main recebe a lista pelo preload (evento + atributo no <html>, que os dois mundos enxergam).
  function save(order) {
    document.documentElement.dataset.pbDockOrder = JSON.stringify(order);
    window.dispatchEvent(new Event('pb:dock-order-save'));
    close();
  }

  editBtn.addEventListener('click', e => { e.stopPropagation(); panel.hidden ? open() : close(); });

  // Cliques e teclas no painel são nossos: não deixa chegar nos handlers do jogo.
  for (const ev of ['click', 'pointerdown', 'mousedown', 'keydown', 'wheel']) panel.addEventListener(ev, e => e.stopPropagation());
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  panel.addEventListener('click', e => {
    const item = e.target.closest('.pb-de-item');
    if (item) return select(item === selected ? null : item);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') close();
    if (a === 'reset') save([]);
    if (a === 'save') save([...list.querySelectorAll('.pb-de-item')].map(li => li.dataset.key));
    if ((a === 'left' || a === 'right') && selected) {
      const sib = a === 'left' ? selected.previousElementSibling : selected.nextElementSibling;
      if (sib) list.insertBefore(selected, a === 'left' ? sib : sib.nextElementSibling);
    }
  });

  // Arrastar: move o próprio item na lista enquanto passa por cima dos outros.
  list.addEventListener('dragstart', e => {
    dragging = e.target.closest('.pb-de-item');
    if (!dragging) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragging.dataset.key);
    dragging.classList.add('is-drag');
  });
  list.addEventListener('dragover', e => {
    if (!dragging) return;
    e.preventDefault();
    const over = e.target.closest('.pb-de-item');
    if (!over || over === dragging) return;
    const r = over.getBoundingClientRect();
    list.insertBefore(dragging, e.clientX > r.left + r.width / 2 ? over.nextElementSibling : over);
  });
  list.addEventListener('drop', e => e.preventDefault());
  list.addEventListener('dragend', () => { dragging?.classList.remove('is-drag'); dragging = null; });

  // O jogo pode recriar a barra: recoloca o ✎ no fim dela e o painel no <body>.
  setInterval(() => {
    const dock = document.querySelector(DOCK);
    if (dock && editBtn.parentElement !== dock) dock.append(editBtn);
    if (document.body && !panel.isConnected) document.body.append(panel);
  }, CHECK_MS);
})();
