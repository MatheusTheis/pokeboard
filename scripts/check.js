// Confere o projeto sem abrir o app nem o jogo: sintaxe de todos os .js e chaves balanceadas nos .css.
// Usado no `npm run check` e no CI do GitHub (não precisa do Electron instalado).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const DIRS = ['src', 'scripts', 'theme'];
const files = [];
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|css)$/.test(e.name)) files.push(p);
  }
};
DIRS.map(d => path.join(root, d)).filter(fs.existsSync).forEach(walk);

let failed = 0;
for (const f of files) {
  const rel = path.relative(root, f);
  try {
    if (f.endsWith('.js')) execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    else {
      // Chaves fora de comentários e strings precisam fechar.
      const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
      let depth = 0;
      for (const ch of css) { if (ch === '{') depth++; if (ch === '}' && --depth < 0) break; }
      if (depth !== 0) throw new Error('chaves { } desbalanceadas');
    }
    console.log(`ok    ${rel}`);
  } catch (e) {
    failed++;
    console.error(`ERRO  ${rel}\n${String(e.stderr || e.message).trim()}`);
  }
}
console.log(`\n${files.length - failed}/${files.length} arquivos ok`);
process.exit(failed ? 1 : 0);
