// Auto-Catch normal: ao esgotar a bola escolhida, seleciona a próxima bola comum disponível.
(() => {
  if (window.__pbAutoBall) return;
  window.__pbAutoBall = true;

  const ORDER = ['Ultra Ball', 'Super Ball', 'Poké Ball'];
  const MODAL = '.ah-modal', HEAD = '.ah-panel .ah-head';
  const STOCK = '.cap-panel .cap-balls .cap-chip';
  const count = text => Number(String(text || '0').replace(/\D/g, '')) || 0;
  const name = button => button?.getAttribute('title') || '';
  let known = null, shinyKnown = null, busy = false, checked = '', pendingPick = '';
  const indicator = document.createElement('div');
  indicator.id = 'pb-cap-ball-status';
  indicator.setAttribute('role', 'status');

  function stock() {
    const buttons = [...document.querySelectorAll(STOCK)];
    if (!buttons.length) return null;
    return Object.fromEntries(buttons.map(b => [name(b), count(b.querySelector('.cap-chip-n')?.textContent)]));
  }

  function catchRow(modal, label) {
    return [...modal.querySelectorAll('.ah-row')].find(row =>
      row.querySelector('.ah-label')?.textContent.trim().toLowerCase() === label);
  }

  function render() {
    const panel = document.querySelector('.cap-panel');
    if (!panel) return;
    const head = panel.querySelector('.cap-head');
    if (head && indicator.parentNode !== panel) head.after(indicator);
    const active = !!known?.active;
    const manual = [...panel.querySelectorAll('.cap-balls .cap-chip')].find(b => b.classList.contains('on'));
    const current = active ? known.selected : name(manual);
    const primary = active ? `AUTO NORMAL · ${current}` : `MANUAL · ${current || '—'}`;
    const shiny = shinyKnown?.active ? ` · SHINY ${shinyKnown.selected}` : '';
    if (indicator.textContent !== primary + shiny) indicator.textContent = primary + shiny;
    panel.toggleAttribute('data-pb-auto-catch', active);
    for (const chip of panel.querySelectorAll('.cap-balls .cap-chip')) {
      chip.toggleAttribute('data-pb-auto-current', active && name(chip) === known.selected);
    }
  }

  function inspect(modal) {
    const row = catchRow(modal, 'auto-catch');
    const shinyRow = catchRow(modal, 'auto-catch shiny');
    const shinySelected = [...(shinyRow?.nextElementSibling?.querySelectorAll('.ah-balls .cap-chip') || [])].find(b => b.classList.contains('on'));
    if (shinyRow && shinySelected) shinyKnown = { active: !!shinyRow.querySelector('input[type="checkbox"]')?.checked, selected: name(shinySelected) };
    const balls = [...(row?.nextElementSibling?.querySelectorAll('.ah-balls .cap-chip') || [])];
    let selected = balls.find(b => b.classList.contains('on'));
    if (!row?.querySelector('input[type="checkbox"]') || !selected) return;
    if (pendingPick) {
      const wanted = balls.find(b => name(b) === pendingPick && !b.disabled && count(b.querySelector('.cap-chip-n')?.textContent) > 0);
      pendingPick = '';
      if (wanted && wanted !== selected) { wanted.click(); selected = wanted; }
    }
    known = { active: row.querySelector('input[type="checkbox"]').checked, selected: name(selected) };
    render();
    if (!known.active || !ORDER.includes(known.selected)) return;
    if (count(selected.querySelector('.cap-chip-n')?.textContent) > 0) return;
    const lower = ORDER.slice(ORDER.indexOf(known.selected) + 1);
    const next = lower.map(n => balls.find(b => name(b) === n && !b.disabled && count(b.querySelector('.cap-chip-n')?.textContent) > 0)).find(Boolean);
    if (!next) return;
    next.click(); // botão nativo do Auto-Helper; o jogo salva a escolha
    known.selected = name(next);
    checked = '';
    render();
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
    render();
    if (busy) return;
    const modal = document.querySelector(MODAL);
    if (modal) { inspect(modal); return; }
    const counts = stock();
    if (!counts) return;
    if (pendingPick) { readClosed(); return; }
    if (!known) { readClosed(); return; }
    if (!known.active || !ORDER.includes(known.selected) || (counts[known.selected] || 0) > 0) return;
    const key = `${known.selected}:${ORDER.map(n => counts[n] || 0).join(',')}`;
    if (key === checked) return;
    checked = key;
    readClosed();
  }

  // Atualiza o estado também quando o jogador muda o Auto-Catch e fecha o modal rapidamente.
  document.addEventListener('click', e => {
    const barChip = e.target.closest?.('.cap-panel .cap-balls .cap-chip');
    if (barChip) {
      pendingPick = name(barChip);
      setTimeout(tick, 0); // primeiro deixa o jogo atualizar a escolha manual
    } else if (e.target.closest?.(`${MODAL} .ah-modal-close`)) {
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
