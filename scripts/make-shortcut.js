// Cria atalhos do PokeBoard (Menu Iniciar e Área de Trabalho) com o ícone do app, rodando o projeto desta pasta.
// O atalho leva o mesmo AppUserModelId da janela (src/main.js), então fixar na barra de tarefas agrupa certo.
// Uso: npm run shortcut   (ou: npx electron scripts/make-shortcut.js)
// Opcional: --record cria o atalho já com o gravador ligado (--pb-record).
const { app, shell } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AUMID = 'com.matheustheis.pokeboard';  // igual ao app.setAppUserModelId do main.js

app.whenReady().then(() => {
  if (process.platform !== 'win32') { console.log('Atalhos só no Windows.'); return app.quit(); }
  const record = process.argv.includes('--record');
  const link = {
    target: process.execPath,                  // electron.exe de node_modules
    args: `"${ROOT}"${record ? ' --pb-record' : ''}`,
    cwd: ROOT,
    icon: path.join(ROOT, 'assets', 'icon.ico'),
    iconIndex: 0,
    appUserModelId: AUMID,
    description: 'PokeBoard: várias contas de Poke Idle World numa janela só',
  };
  const places = [
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'PokeBoard.lnk'),
    path.join(app.getPath('desktop'), 'PokeBoard.lnk'),
  ];
  for (const p of places) console.log(`${shell.writeShortcutLink(p, 'create', link) ? 'criado' : 'FALHOU'}  ${p}`);
  app.quit();
});
