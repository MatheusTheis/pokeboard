const STATS = [['hp', 'HP'], ['atk', 'Ataque'], ['def', 'Defesa'], ['spa', 'At. Esp.'], ['spd', 'Def. Esp.'], ['spe', 'Velocidade']];
const $ = s => document.querySelector(s);
$('#stats').innerHTML = STATS.map(([id, label]) => `<label>${label}<input id="${id}" type="number" min="0" max="32" inputmode="numeric" placeholder="0–32"></label>`).join('');
let totalFromPrint = null, previewUrl = null;
function update() {
  const values = STATS.map(([id]) => Number($('#' + id).value));
  const complete = STATS.every(([id]) => $('#' + id).value !== '' && Number.isInteger(Number($('#' + id).value)) && Number($('#' + id).value) >= 0 && Number($('#' + id).value) <= 32);
  const total = complete ? values.reduce((a, b) => a + b, 0) : totalFromPrint;
  $('#total').textContent = total == null ? '—/192' : `${total}/192`;
  $('#percent').textContent = total == null ? 'Preencha os seis valores' : `${(total / 192 * 100).toFixed(1).replace('.', ',')}%${complete ? '' : ' · total lido do print'}`;
  $('#fill').style.width = `${total == null ? 0 : total / 192 * 100}%`;
}
$('#stats').addEventListener('input', () => { totalFromPrint = null; update(); });

// OCR é sugestão: nomes e números são conferidos antes de calcular; stats reais (>32) não viram IV por engano.
function parseOcr(text) {
  const aliases = [
    ['spa', /(?:sp\.?\s*(?:atk|attack|ataque)|at\.?\s*esp)/i],
    ['spd', /(?:sp\.?\s*(?:def|defense|defesa)|def\.?\s*esp)/i],
    ['spe', /(?:speed|velocidade|vel\.?)/i],
    ['hp', /\bhp\b|vida/i], ['atk', /\batk\b|ataque/i], ['def', /\bdef\b|defesa/i],
  ];
  const found = {};
  for (const line of text.split(/\r?\n/)) {
    for (const [id, label] of aliases) {
      const m = line.match(label);
      if (!m) continue;
      const n = line.slice(m.index + m[0].length).match(/[:.\s-]*(\d{1,3})(?:\s*\/\s*32)?/);
      if (n && +n[1] <= 32) found[id] = +n[1];
      break;
    }
  }
  const total = +(text.match(/\bIV\s*[:.]?\s*(\d{1,3})\s*\/\s*192/i)?.[1] ?? -1);
  return { found, total: total >= 0 && total <= 192 ? total : null };
}
async function readImage(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return $('#ocrStatus').textContent = 'Use PNG, JPG ou WebP.';
  if (file.size > 12_000_000) return $('#ocrStatus').textContent = 'O print deve ter no máximo 12 MB.';
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  for (const [id] of STATS) $('#' + id).value = '';
  totalFromPrint = null;
  update();
  previewUrl = URL.createObjectURL(file);
  const img = document.createElement('img'); img.src = previewUrl; img.alt = 'Print selecionado';
  $('#preview').replaceChildren(img);
  $('#ocrStatus').textContent = 'Lendo o print…';
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
    });
    const text = await ivBoard.ocr(dataUrl);
    $('#ocrText').textContent = text || '(nenhum texto reconhecido)';
    const { found, total } = parseOcr(text);
    for (const [id, value] of Object.entries(found)) $('#' + id).value = value;
    totalFromPrint = total;
    update();
    $('#ocrStatus').textContent = Object.keys(found).length === 6 ? 'Seis IVs encontrados. Confira os números.'
      : total != null ? 'Total de IV encontrado. Confira o print.'
        : 'Leitura parcial. Complete ou corrija os campos manualmente.';
  } catch (e) { $('#ocrStatus').textContent = `Não consegui ler o print: ${e.message || e}`; }
}
$('#image').addEventListener('change', e => readImage(e.target.files[0]));
document.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); readImage(f); } });
$('#preview').addEventListener('dragover', e => { e.preventDefault(); e.currentTarget.classList.add('drag'); });
$('#preview').addEventListener('dragleave', e => e.currentTarget.classList.remove('drag'));
$('#preview').addEventListener('drop', e => { e.preventDefault(); e.currentTarget.classList.remove('drag'); readImage([...e.dataTransfer.files][0]); });
