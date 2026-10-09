// Economia (botão de quadros na barra vermelha): limita quantos quadros por segundo o jogo desenha neste painel.
// O jogo desenha com requestAnimationFrame, 60 vezes por segundo, mesmo no Modo Carta. Com um limite, os pedidos
// de quadro esperam a vez e são atendidos juntos no próximo quadro liberado. A hunt roda no servidor: só a
// animação fica menos lisa. O limite vem das preferências do board (data-pb-prefs no <html>, escrito pelo preload).
// Entra antes dos scripts do jogo (como o hook.js), para valer também para quem guarda a função ao carregar.
(() => {
  if (window.__pbFps) return;
  window.__pbFps = true;

  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  const OWN_ID = 1e9;  // ids nossos ficam acima dos do navegador, para o cancelamento saber de quem é
  let interval = 0;    // ms entre quadros; 0 = sem limite
  let nextId = OWN_ID, armed = false, last = 0;
  const queue = new Map();  // id -> callback esperando o próximo quadro liberado

  function run(t) {
    armed = false;
    if (interval && t - last < interval - 2) { arm(); return; }  // ainda não é a vez
    last = t;
    const cbs = [...queue.values()];
    queue.clear();
    for (const cb of cbs) { try { cb(t); } catch (e) { setTimeout(() => { throw e; }); } }
  }
  // Espera com setTimeout até perto da vez (sem acordar a cada quadro) e alinha com o quadro do navegador.
  function arm() {
    if (armed) return;
    armed = true;
    const wait = interval - (performance.now() - last);
    if (wait > 20) setTimeout(() => raf(run), wait - 16); else raf(run);
  }
  window.requestAnimationFrame = function requestAnimationFrame(cb) {
    if (!interval) return raf(cb);
    const id = nextId++;
    queue.set(id, cb);
    arm();
    return id;
  };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    if (!queue.delete(id)) caf(id);
  };

  function readFps() {
    let fps = 0;
    try { fps = Number(JSON.parse(document.documentElement?.dataset.pbPrefs || '{}').fps) || 0; } catch {}
    interval = fps > 0 ? 1000 / fps : 0;
    if (!interval && queue.size) arm();  // limite desligado: entrega o que estava esperando
  }
  // No começo da página o <html> pode ainda não existir: espera ele aparecer.
  const watch = () => {
    const r = document.documentElement;
    if (!r) return false;
    new MutationObserver(readFps).observe(r, { attributes: true, attributeFilter: ['data-pb-prefs'] });
    readFps();
    return true;
  };
  if (!watch()) {
    const mo = new MutationObserver(() => { if (watch()) mo.disconnect(); });
    mo.observe(document, { childList: true });
  }
})();
