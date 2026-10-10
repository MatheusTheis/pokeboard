// Chat compacto por conta: a janela do jogo permanece intacta e volta pelo ícone no canto.
(() => {
  if (window.__pbChatPlus) return;
  window.__pbChatPlus = true;
  const KEY = 'pb:chat:hidden';
  const root = document.documentElement;
  let hidden = false;
  try { hidden = localStorage.getItem(KEY) === '1'; } catch {}
  const open = document.createElement('button');
  open.id = 'pb-chat-open';
  open.type = 'button';
  open.setAttribute('aria-label', 'Abrir chat');
  open.title = 'Abrir chat';
  open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v13H9l-5 4v-4H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 9h10M7 13h7" stroke="currentColor" stroke-width="2"/></svg>';
  const hide = document.createElement('button');
  hide.id = 'pb-chat-hide';
  hide.type = 'button';
  hide.textContent = '▾';
  hide.setAttribute('aria-label', 'Esconder chat');
  hide.title = 'Esconder chat';
  function setHidden(on) {
    hidden = on;
    root.toggleAttribute('data-pb-chat-hidden', on);
    open.hidden = !on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {}
  }
  open.addEventListener('click', () => setHidden(false));
  hide.addEventListener('click', () => setHidden(true));
  setHidden(hidden);
  function mount() {
    const game = document.querySelector('.game-root');
    if (game && open.parentNode !== game) game.append(open);
    const head = game?.querySelector('.chat-box .chat-head');
    if (head && hide.parentNode !== head) head.append(hide);
  }
  mount();
  setInterval(mount, 1500);
})();
