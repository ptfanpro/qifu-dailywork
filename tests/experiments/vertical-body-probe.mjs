// Private, read-only orientation experiment. No production imports, automatic
// assignments, target numbers, historical labels or raw text in its reports.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {requirePrivateAuditRoot} from '../audit-paths.mjs';
import {createTextDetector} from './text-regions.mjs';
import {createChineseBodyReader} from './chinese-text-reader.mjs';
import {rankBodyTextEvidence} from './body-text-evidence.mjs';

const require = createRequire(import.meta.url), sharp = require('sharp');
const [root, ...selectors] = process.argv.slice(2);
requirePrivateAuditRoot(root);
if (!selectors.length || selectors.some(s => !/^[a-f0-9]{64}$/.test(s))) throw Error('PRIVATE_ROOT PHOTO_SHA256 [...]');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const checked = file => {
  const bytes = fs.readFileSync(file.file);
  if (sha(bytes) !== file.sha256) throw Error('Source changed since inventory');
  return bytes;
};
const fingerprint = sha(JSON.stringify(['tests/experiments/vertical-body-probe.mjs',
  'tests/experiments/text-regions.mjs', 'tests/experiments/chinese-text-reader.mjs',
  'tests/experiments/body-text-evidence.mjs', 'src/local-ocr.mjs']
  .map(name => [name, sha(fs.readFileSync(path.join(appRoot, name)))])));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'inventory.json')));
const output = fs.mkdtempSync(path.join(root, 'vertical-body-probe-'));
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const fontPath = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts').replaceAll('\\', '/') + '/';
const cache = new Map(), reports = [];
const detector = await createTextDetector(appRoot, path.join(root, 'models/ch_PP-OCRv4_det_mobile.onnx'));
let reader;
try {
  reader = await createChineseBodyReader(appRoot, path.join(root, 'models'));
  for (const selector of [...new Set(selectors)]) {
    const days = inventory.days.filter(day => day.photos.some(p => p.sha256 === selector));
    if (days.length !== 1) throw Error('Photo/date identity absent or ambiguous');
    const day = days[0], photo = day.photos.find(p => p.sha256 === selector), started = Date.now();
    const bytes = checked(photo);
    if (!cache.has(day.date)) {
      const pages = [];
      for (const pdf of day.pdfs) {
        const document = await pdfjs.getDocument({data: new Uint8Array(checked(pdf)),
          standardFontDataUrl: fontPath, useSystemFonts: false, disableWorker: true}).promise;
        try {
          for (let i = 1; i <= document.numPages; i++) {
            const content = await (await document.getPage(i)).getTextContent();
            const fieldTexts = content.items.map(item => item.str || '');
            pages.push({pdfSha256: pdf.sha256, pageNumber: i, fieldTexts, text: fieldTexts.join('。')});
          }
        } finally { await document.destroy(); }
      }
      cache.set(day.date, pages);
    }
    const {regions, original} = await detector.detect(bytes);
    // Ratios and margins are in pixels, not width/height-normalized units.
    const vertical = regions.filter(r => r.height * original.info.height >= r.width * original.info.width * 2.5);
    const results = [];
    for (const angle of [90, 270]) {
      const lines = []; let errors = 0;
      for (const r of vertical.slice(0, 80)) {
        const pad = r.width * original.info.width * .5;
        const left = Math.max(0, Math.floor(r.left * original.info.width - pad));
        const top = Math.max(0, Math.floor(r.top * original.info.height - pad));
        const right = Math.min(original.info.width, Math.ceil((r.left + r.width) * original.info.width + pad));
        const bottom = Math.min(original.info.height, Math.ceil((r.top + r.height) * original.info.height + pad));
        const crop = await sharp(original.data, {raw: original.info}).extract({left, top, width: right - left, height: bottom - top})
          .rotate(angle).png().toBuffer();
        try {
          const reading = await reader.readLine(crop);
          if (reading.confidence >= .65) lines.push(reading.text);
        } catch { errors++; }
      }
      results.push({view: `vertical-rotate-${angle}`, regions: vertical.length, errors,
        truncated: vertical.length > 80, lines: lines.length, ...rankBodyTextEvidence(lines.join('。'), cache.get(day.date))});
    }
    checked(photo); for (const pdf of day.pdfs) checked(pdf);
    const report = {schemaVersion: 1, sourceFingerprint: fingerprint, modelSha256: reader.modelSha256,
      status: 'diagnostic-only-not-binding', date: day.date, photoSha256: selector, sourceUnchanged: true,
      seconds: (Date.now() - started) / 1000, results};
    fs.writeFileSync(path.join(output, selector + '.json'), JSON.stringify(report, null, 2));
    reports.push(report);
    console.log(JSON.stringify({date: day.date, photoSha256: selector, seconds: report.seconds,
      results: results.map(r => ({view: r.view, regions: r.regions, lines: r.lines, errors: r.errors,
        observedGrams: r.observedGrams, top: r.ranked.slice(0, 2)}))}));
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({status: 'diagnostic-only-not-binding',
    sourceFingerprint: fingerprint, photos: reports.length, sourceUnchanged: reports.every(r => r.sourceUnchanged)}, null, 2));
  console.log(JSON.stringify({privateOutput: output}));
} finally { try { await reader?.release(); } finally { await detector.release(); } }
