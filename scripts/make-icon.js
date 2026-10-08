// Gera o ícone do PokeBoard (pixel art própria, sem arte do jogo) em assets/:
//   icon.png (256px) e icon.ico (16, 24, 32, 48, 64, 128, 256) para a janela, a barra de tarefas e um futuro .exe.
// Desenho numa grade de 32×32: Pokédex de bolso vermelha, lente azul, três LEDs e uma telinha com dois painéis
// (as várias contas). Uso: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Roda na página: desenha a grade 32×32 e devolve um PNG por tamanho (vizinho mais próximo, pixels nítidos).
function draw(sizes) {
  const G = 32;
  const C = {
    ink: '#05070A', red: '#D62B25', redDeep: '#8A1117', redLight: '#F0504A', white: '#FFFFFF',
    blue: '#7FA6F5', blueDark: '#3F6FD0', blueLight: '#CFE0FF', screen: '#12161E', border: '#66769A',
    panel: '#283044', panelLight: '#3A4560', ledR: '#FF5A4E', ledY: '#FFCB05', ledG: '#62C96F',
  };
  const px = [];  // [x, y, cor]
  const set = (x, y, c) => px.push([x, y, c]);
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
  const inBody = (x, y) => {
    if (x < 2 || x > 29 || y < 2 || y > 29) return false;
    const cx = Math.min(x - 2, 29 - x), cy = Math.min(y - 2, 29 - y);
    return cx + cy >= 2;  // cantos chanfrados de 2px
  };
  // Corpo vermelho com contorno escuro e faixa inferior mais escura.
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    if (!inBody(x, y)) {
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inBody(x + dx, y + dy));
      if (near) set(x, y, C.ink);
      continue;
    }
    set(x, y, y >= 27 ? C.redDeep : C.red);
  }
  // Brilho de pixel no alto do corpo.
  rect(5, 3, 26, 3, C.redLight);
  // Lente: anel branco, borda escura, azul com sombra e brilho.
  const lens = (cx, cy, r) => {
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r + 1) set(x, y, C.ink);
      if (d <= r) set(x, y, C.white);
      if (d <= r - 1.6) set(x, y, C.blueDark);
      if (d <= r - 2.4) set(x, y, C.blue);
    }
  };
  lens(10.5, 10.5, 6.2);
  rect(7, 7, 8, 8, C.blueLight);
  rect(9, 7, 9, 7, C.blueLight);
  // Três LEDs.
  [[19, C.ledR], [22, C.ledY], [25, C.ledG]].forEach(([x, c]) => { rect(x - 1, 5, x + 2, 8, C.ink); rect(x, 6, x + 1, 7, c); });
  // Telinha com dois painéis (as contas).
  rect(5, 17, 26, 26, C.ink);
  rect(6, 18, 25, 25, C.screen);
  rect(7, 19, 14, 24, C.panel);
  rect(17, 19, 24, 24, C.panel);
  rect(7, 19, 14, 19, C.panelLight);
  rect(17, 19, 24, 19, C.panelLight);
  rect(19, 12, 26, 13, C.redDeep);  // fenda do alto-falante
  rect(19, 15, 26, 15, C.redDeep);

  const base = document.createElement('canvas');
  base.width = base.height = G;
  const b = base.getContext('2d');
  for (const [x, y, c] of px) { b.fillStyle = c; b.fillRect(x, y, 1, 1); }
  return sizes.map(s => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = s < G;  // reduzir suaviza um pouco; ampliar fica nítido
    ctx.drawImage(base, 0, 0, s, s);
    return cv.toDataURL('image/png').split(',')[1];
  });
}

// ICO com PNG dentro (aceito pelo Windows Vista em diante).
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = pngs.map(({ size, buf }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...pngs.map(p => p.buf)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<meta charset="utf-8"><body></body>');
  const data = await win.webContents.executeJavaScript(`(${draw})(${JSON.stringify(SIZES)})`);
  const pngs = data.map((b64, i) => ({ size: SIZES[i], buf: Buffer.from(b64, 'base64') }));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'icon.png'), pngs.find(p => p.size === 256).buf);
  fs.writeFileSync(path.join(OUT, 'icon.ico'), buildIco(pngs));
  console.log(`ícone gerado em ${OUT} (${SIZES.join(', ')} px)`);
  app.quit();
});
