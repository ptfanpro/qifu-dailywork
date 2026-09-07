// Offline probe, not an uploader or production recognizer. Raw text is used in
// memory only. Output carries counts/hashes/page identities, never customer text.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {requirePrivateAuditRoot} from '../audit-paths.mjs';
import {readWindowsOcrTails} from '../../src/photo-prepare.mjs';
import {writeImageFile} from '../../src/ocr-image.mjs';
import {rankBodyTextEvidence} from './body-text-evidence.mjs';
import {createChineseBodyReader} from './chinese-text-reader.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const [root, ...argumentsAfterRoot] = process.argv.slice(2);
const useChinese = argumentsAfterRoot.includes('--chinese');
const includeVertical = argumentsAfterRoot.includes('--vertical');
if (includeVertical && !useChinese) throw Error('--vertical requires --chinese');
const selectors = argumentsAfterRoot.filter(value => value !== '--chinese' && value !== '--vertical');
requirePrivateAuditRoot(root);
if (!selectors.length || selectors.some(value => !/^[a-f0-9]{64}$/.test(value))) throw Error('PRIVATE_ROOT PHOTO_SHA256 [...]');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const checked = source => {
  const bytes = fs.readFileSync(source.file);
  if (sha(bytes) !== source.sha256) throw Error('Source changed since inventory');
  return bytes;
};
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'inventory.json')));
const output = fs.mkdtempSync(path.join(root, 'body-text-probe-'));
const sourceFingerprint = sha(JSON.stringify(['tests/experiments/body-text-probe.mjs',
  'tests/experiments/body-text-evidence.mjs', 'tests/experiments/chinese-text-reader.mjs', 'tests/experiments/vertical-body-regions.mjs',
  'tests/experiments/text-regions.mjs', 'src/local-ocr.mjs', 'src/photo-prepare.mjs', 'src/ocr-image.mjs',
  'ui/Read-WindowsOcr.ps1'].map(name => [name, sha(fs.readFileSync(path.join(appRoot, name)))])));
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const standardFontDataUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts').replaceAll('\\', '/') + '/';
const pageCache = new Map();
const summaries = [];
const chinese = useChinese ? await createChineseBodyReader(appRoot, path.join(root, 'models')) : null;
try {
for (const selector of [...new Set(selectors)]) {
  const day = inventory.days.find(value => value.photos.some(photo => photo.sha256 === selector));
  const photo = day?.photos.find(value => value.sha256 === selector);
  if (!photo) throw Error('Photo absent from inventory');
  const started = Date.now();
  const bytes = checked(photo);
  if (!pageCache.has(day.date)) {
    const pages = [];
    for (const pdf of day.pdfs) {
      const document = await pdfjs.getDocument({data: new Uint8Array(checked(pdf)), disableWorker: true,
        standardFontDataUrl, useSystemFonts: false}).promise;
      try {
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          pages.push({pdfSha256: pdf.sha256, pageNumber, text: content.items.map(item => item.str || '').join(' ')});
        }
      } finally { await document.destroy(); }
    }
    pageCache.set(day.date, pages);
  }
  const imageDir = path.join(output, selector.slice(0, 12));
  fs.mkdirSync(imageDir);
  // Broad views deliberately do not use OCR-proposed code/target or reference
  // filenames. Crops are evidence collection, not artificial data enrichment.
  const decoded = await sharp(bytes).rotate().removeAlpha().raw().toBuffer({resolveWithObject: true});
  const {width, height} = decoded.info;
  const variants = [{name: 'full', left: 0, top: 0, width: 1, height: 1},
    {name: 'lower', left: .08, top: .28, width: .84, height: .7},
    {name: 'center', left: .20, top: .18, width: .65, height: .68}];
  const files = [];
  for (const view of variants) {
    const extract = {left: Math.floor(view.left * width), top: Math.floor(view.top * height),
      width: Math.floor(view.width * width), height: Math.floor(view.height * height)};
    const file = path.join(imageDir, view.name + '.png');
    await writeImageFile(sharp(decoded.data, {raw: decoded.info}).extract(extract)
      .resize({width: 2400, height: 2400, fit: 'inside'}).png(), file);
    files.push(file);
  }
  const readings = readWindowsOcrTails(appRoot, files, imageDir);
  const results = files.map((file, index) => {
    const reading = readings.get(path.resolve(file));
    return {view: variants[index].name, readerAvailable: readings.ocrDiagnostics.status === 'completed',
      batchErrorCount: readings.ocrDiagnostics.errorCount, textReturned: Boolean(reading?.text),
      ...rankBodyTextEvidence(reading?.text || '', pageCache.get(day.date))};
  });
  if (chinese) for (const view of await chinese.read(bytes, {includeVertical})) {
    results.push({view: view.view, readerAvailable: view.errors === 0, batchErrorCount: view.errors,
      textReturned: Boolean(view.text), lineCount: view.lineCount, regions: view.regions, truncated: view.truncated,
      ...rankBodyTextEvidence(view.text, pageCache.get(day.date))});
  }
  checked(photo);
  for (const pdf of day.pdfs) checked(pdf);
  const report = {schemaVersion: 1, sourceFingerprint, date: day.date, photoSha256: selector,
    expectedLayouts: includeVertical ? ['horizontal', 'vertical'] : ['horizontal'],
    modelSha256: chinese?.modelSha256 || null, dictionaryLength: chinese?.dictionaryLength || null,
    status: 'diagnostic-only-not-binding', sourceUnchanged: true, seconds: (Date.now() - started) / 1000, results};
  fs.writeFileSync(path.join(imageDir, 'report.json'), JSON.stringify(report, null, 2));
  const summary = {date: day.date, photoSha256: selector, seconds: report.seconds,
    sourceUnchanged: true, results: results.map(result => ({view: result.view, readerAvailable: result.readerAvailable,
      batchErrorCount: result.batchErrorCount, textReturned: result.textReturned, lineCount: result.lineCount,
      observedGrams: result.observedGrams, textBearingPages: result.textBearingPages,
      totalPages: result.totalPages, topUniqueTieCount: result.topUniqueTieCount, top: result.ranked.slice(0, 2)}))};
  summaries.push(summary);
  console.log(JSON.stringify(summary));
}
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({sourceFingerprint, summaries}, null, 2));
console.log(JSON.stringify({privateOutput: output, status: 'diagnostic-only-not-binding'}));
} finally { await chinese?.release(); }
