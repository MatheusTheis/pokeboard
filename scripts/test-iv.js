// OCR sugere apenas IVs válidos (0–32); stats reais acima disso não entram no cálculo.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');
const els = new Map();
const document = {
  querySelector(q) {
    if (!els.has(q)) els.set(q, { value: '', textContent: '', innerHTML: '', style: {}, addEventListener() {} });
    return els.get(q);
  },
  addEventListener() {},
};
const ctx = vm.createContext({ document });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'iv', 'iv.js'), 'utf8'), ctx);
const result = vm.runInContext('parseOcr("HP 12\\nATK 20\\nDEF 18\\nSP ATK 31\\nSP DEF 22\\nSPEED 29")', ctx);
assert.deepEqual({ ...result.found }, { hp: 12, atk: 20, def: 18, spa: 31, spd: 22, spe: 29 });
assert.equal(Object.values(result.found).reduce((a, b) => a + b, 0), 132);
const bad = vm.runInContext('parseOcr("HP 153\\nATK 50\\nIV 120/192")', ctx);
assert.equal(Object.keys(bad.found).length, 0);
assert.equal(bad.total, 120);
console.log('ok leitura dos seis IVs e rejeição de stats reais');
