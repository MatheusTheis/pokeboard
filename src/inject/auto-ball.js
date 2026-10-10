// Auto-Catch normal: ao esgotar a bola escolhida, seleciona a próxima bola comum disponível.
(() => {
  if (window.__pbAutoBall) return;
  window.__pbAutoBall = true;

  const ORDER = ['Ultra Ball', 'Super Ball', 'Poké Ball'];
  const MODAL = '.ah-modal', HEAD = '.ah-panel .ah-head';
  const STOCK = '.cap-panel .cap-balls .cap-chip';
  const count = text => Number(String(text || '0').replace(/\D/g, '')) || 0;
  const name = button => button?.getAttribute('title') || '';
  let known = null, busy = false, checked = '';

  function stock() {
    const buttons = [...document.querySelectorAll(STOCK)];
    if (!buttons.length) return null;
    return Object.fromEntries(buttons.map(b => [name(b), count(b.querySelector('.cap-chip-n')?.textContent)]));
  }

  function normalRow(modal) {
    return [...modal.querySelectorAll('.ah-row')].find(row =>
      /^auto-catch$/i.test(row.querySelector('.ah-label')?.textContent.trim() || ''));
  }

  function inspect(modal) {
    const row = normalRow(modal);
    const balls = [...(row?.nextElementSibling?.querySelectorAll('.ah-balls .cap-chip') || [])];
    const selected = balls.find(b => b.classList.contains('on'));
    if (!row?.querySelector('input[type="checkbox"]') || !selected) return;
    known = { active: row.querySelector('input[type="checkbox"]').checked, selected: name(selected) };
    if (!known.active || !ORDER.includes(known.selected)) return;
    if (count(selected.querySelector('.cap-chip-n')?.textContent) > 0) return;
    const lower = ORDER.slice(ORDER.indexOf(known.selected) + 1);
    const next = lower.map(n => balls.find(b => name(b) === n && !b.disabled && count(b.querySelector('.cap-chip-n')?.textContent) > 0)).find(Boolean);
    if (!next) return;
    next.click(); // botão nativo do Auto-Helper; o jogo salva a escolha
    known.selected = name(next);
    checked = '';
  }

  async function readClosed() {
    if (busy) return;
    const head = document.querySelector(HEAD);
    if (!head || document.querySelector(MODAL)) return;
    busy = true;
    try {
      head.click();
      let modal = document.querySelector(MODAL);
      for (let i = 0; !modal && i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        modal = document.querySelector(MODAL);
      }
      if (!modal) return;
      inspect(modal);
      // Fecha apenas a janela que a leitura abriu; se o jogador a substituiu, deixa aberta.
      if (document.querySelector(MODAL) === modal) modal.querySelector('.ah-modal-close')?.click();
    } finally { busy = false; }
  }

  function tick() {
    if (busy) return;
    const modal = document.querySelector(MODAL);
    if (modal) { inspect(modal); return; }
    const counts = stock();
    if (!counts) return;
    if (!known) { readClosed(); return; }
    if (!known.active || !ORDER.includes(known.selected) || (counts[known.selected] || 0) > 0) return;
    const key = `${known.selected}:${ORDER.map(n => counts[n] || 0).join(',')}`;
    if (key === checked) return;
    checked = key;
    readClosed();
  }

  // Atualiza o estado também quando o jogador muda o Auto-Catch e fecha o modal rapidamente.
  document.addEventListener('click', e => {
    if (e.target.closest?.(`${MODAL} .ah-modal-close`)) {
      const modal = document.querySelector(MODAL);
      if (modal) inspect(modal);
    } else if (e.target.closest?.(`${MODAL} .ah-balls .cap-chip`)) {
      setTimeout(() => { const modal = document.querySelector(MODAL); if (modal) inspect(modal); }, 0);
    }
  }, true);
  document.addEventListener('change', e => {
    if (e.target.closest?.(`${MODAL} .ah-row`)) {
      setTimeout(() => { const modal = document.querySelector(MODAL); if (modal) inspect(modal); }, 0);
    }
  }, true);
  setInterval(tick, 1000);
})();
