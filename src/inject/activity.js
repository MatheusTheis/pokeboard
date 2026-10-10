// Última atividade visível de cada conta. localStorage já é separado pelo partition da conta.
(() => {
  if (window.__pbActivity) return;
  window.__pbActivity = true;
  const KEY = 'pb:last-activity:v1';
  let last = '';
  function remember() {
    const hud = document.querySelector('.game-root .phud-tloc');
    const mon = document.querySelector('.game-root .phud-mon.active');
    const hunt = (hud?.textContent || '').split('·').pop().trim();
    const pokemon = mon?.querySelector('.phud-name')?.textContent.trim() || '';
    const level = +(mon?.querySelector('.phud-lv')?.textContent || '').match(/\d+/)?.[0] || 0;
    if (!hunt || !pokemon || !level) return;
    const signature = `${hunt}|${pokemon}|${level}`;
    if (signature === last) return;
    last = signature;
    try { localStorage.setItem(KEY, JSON.stringify({ hunt, pokemon, level, at: Date.now() })); } catch {}
  }
  remember();
  setInterval(remember, 5000);
  window.addEventListener('pagehide', remember);
})();
