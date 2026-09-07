// A/B corpus diagnostic: the SAME photo readings are compared with text-only
// and text+rendered-PDF evidence. No historical number is given to either OCR.
// Raw customer text stays in memory. No assignments or business writes exist.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {requirePrivateAuditRoot} from '../audit-paths.mjs';
import {createChineseBodyReader} from './chinese-text-reader.mjs';
import {bodyTextGrams, rankBodyTextEvidence} from './body-text-evidence.mjs';
import {buildVisualBodyPages} from './pdf-visual-body-evidence.mjs';
import {summarizeBodyProbeReports} from './body-probe-summary.mjs';
import {compareBodyFieldEvidence} from './body-field-evidence.mjs';

const require = createRequire(import.meta.url), {createCanvas} = require('@napi-rs/canvas');
const [rootArgument, date, ...options] = process.argv.slice(2);
const withFields = options[0] === '--fields';
const selectors = withFields ? options.slice(1) : options;
const root = requirePrivateAuditRoot(rootArgument);
if (!/^2026-\d{2}-\d{2}$/.test(date || '') || selectors.some(s => !/^[a-f0-9]{64}$/.test(s))) {
  throw Error('PRIVATE_ROOT YYYY-MM-DD [--fields] [PHOTO_SHA256 ...]');
}
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'inventory.json')));
const days = inventory.days.filter(day => day.date === date);
if (days.length !== 1 || !days[0].pdfs.length) throw Error('Explicit date requires a unique inventoried PDF set');
const day = days[0], selected = selectors.length ? day.photos.filter(p => selectors.includes(p.sha256)) : day.photos;
if (!selected.length || new Set(selected.map(p => p.sha256)).size !== selected.length
  || (selectors.length && (new Set(selectors).size !== selectors.length || selected.length !== selectors.length))) {
  throw Error('Photo selectors must uniquely belong to the explicit date');
}
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const checked = record => {
  const bytes = fs.readFileSync(record.file);
  if (sha(bytes) !== record.sha256) throw Error('Source changed since inventory');
  return bytes;
};
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceFiles = ['tests/experiments/pdf-visual-body-probe.mjs', 'tests/experiments/pdf-visual-body-evidence.mjs',
  'tests/experiments/body-text-evidence.mjs', 'tests/experiments/body-probe-summary.mjs',
  'tests/experiments/chinese-text-reader.mjs', 'tests/experiments/vertical-body-regions.mjs',
  'tests/experiments/text-regions.mjs', 'tests/experiments/body-field-evidence.mjs', 'src/local-ocr.mjs'];
const fingerprint = () => sha(JSON.stringify(sourceFiles.map(name => [name, sha(fs.readFileSync(path.join(appRoot, name)))])));
const sourceFingerprint = fingerprint();
const output = fs.mkdtempSync(path.join(root, 'pdf-visual-body-probe-'));
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const standardFontDataUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts').replaceAll('\\', '/') + '/';
const reader = await createChineseBodyReader(appRoot, path.join(root, 'models'));
const pages = [], readings = [], pageSummaries = [], reports = {textOnly: [], visual: []};
const fieldReports = [];
const started = Date.now();
try {
  for (const pdf of day.pdfs) {
    const document = await pdfjs.getDocument({data: new Uint8Array(checked(pdf)), disableWorker: true,
      standardFontDataUrl, useSystemFonts: false}).promise;
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const tick = Date.now(), page = await document.getPage(pageNumber), base = page.getViewport({scale: 1});
        const viewport = page.getViewport({scale: 1800 / Math.max(base.width, base.height)});
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
        const image = canvas.toBuffer('image/png');
        fs.writeFileSync(path.join(output, `${pdf.sha256}-${pageNumber}.png`), image);
        const fieldTexts = (await page.getTextContent()).items.map(item => item.str || '');
        const text = fieldTexts.join(' ');
        const views = await reader.read(image, {includeVertical: true});
        pages.push({pdfSha256: pdf.sha256, pageNumber, text, fieldTexts});
        readings.push({pdfSha256: pdf.sha256, pageNumber, views});
        pageSummaries.push({pdfSha256: pdf.sha256, pageNumber, textLayerGrams: bodyTextGrams(text).size,
          seconds: (Date.now() - tick) / 1000, views: views.map(v => ({view: v.view, errors: v.errors,
            truncated: v.truncated, lineCount: v.lineCount, regions: v.regions, grams: bodyTextGrams(v.text).size}))});
        console.log(JSON.stringify({date, renderedPages: pages.length, status: 'diagnostic-only-not-binding'}));
      }
    } finally { await document.destroy(); }
  }
  // Reject a partial corpus before producing any photo comparison.
  const visualPages = buildVisualBodyPages(pages, readings);
  for (const photo of selected) {
    const tick = Date.now(), views = await reader.read(checked(photo), {includeVertical: true});
    checked(photo);
    for (const pdf of day.pdfs) checked(pdf);
    for (const [mode, corpus] of [['textOnly', pages], ['visual', visualPages]]) {
      const report = {schemaVersion: 1, sourceFingerprint, date, photoSha256: photo.sha256,
        expectedLayouts: ['horizontal', 'vertical'], modelSha256: reader.modelSha256,
        status: 'diagnostic-only-not-binding', sourceUnchanged: true,
        results: views.map(v => ({view: v.view, readerAvailable: v.errors === 0, batchErrorCount: v.errors,
          truncated: v.truncated, lineCount: v.lineCount, regions: v.regions, ...rankBodyTextEvidence(v.text, corpus)}))};
      reports[mode].push(report);
    }
    const fieldDiagnostic = withFields ? {date, photoSha256: photo.sha256, sourceFingerprint,
      modelSha256: reader.modelSha256, sourceUnchanged: true, ...compareBodyFieldEvidence(views, visualPages)} : null;
    if (fieldDiagnostic) fieldReports.push(fieldDiagnostic);
    fs.writeFileSync(path.join(output, `${photo.sha256}-report.json`), JSON.stringify({
      seconds: (Date.now() - tick) / 1000, textOnly: reports.textOnly.at(-1), visual: reports.visual.at(-1),
      ...(fieldDiagnostic ? {fieldDiagnostic} : {})}, null, 2));
    console.log(JSON.stringify({date, completedPhotos: reports.visual.length, totalPhotos: selected.length}));
  }
  for (const source of [...selected, ...day.pdfs]) checked(source);
  if (fingerprint() !== sourceFingerprint) throw Error('Frozen diagnostic source changed');
  const summary = {schemaVersion: 1, date, status: 'diagnostic-only-not-binding', sourceFingerprint,
    modelSha256: reader.modelSha256, pdfs: day.pdfs.length, pages: pages.length, photos: selected.length,
    sourceUnchanged: true, seconds: (Date.now() - started) / 1000, pageSummaries,
    textOnly: summarizeBodyProbeReports(reports.textOnly), visual: summarizeBodyProbeReports(reports.visual),
    note: 'All pages rendered/read does not prove complete OCR coverage or order binding. No assignments.'};
  if (withFields) summary.fieldDiagnostic = {status: 'diagnostic-only-not-binding',
    counts: fieldReports.reduce((counts, report) => ({...counts, [report.state]: (counts[report.state] || 0) + 1}), {}),
    outcomes: fieldReports.map(report => ({photoSha256: report.photoSha256, state: report.state})),
    note: 'Extracted fields have no verified semantic role, card multiplicity or geometric alignment. Not order binding.'};
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({privateOutput: output, date, pages: pages.length, photos: selected.length,
    seconds: summary.seconds, textOnly: summary.textOnly.counts, visual: summary.visual.counts,
    ...(withFields ? {fields: summary.fieldDiagnostic.counts} : {}), sourceUnchanged: true}));
} catch (error) {
  fs.writeFileSync(path.join(output, 'failed.json'), JSON.stringify({date, sourceFingerprint,
    status: 'failed-not-acceptance', renderedPages: pages.length, completedPhotos: reports.visual.length,
    errorType: error.name, seconds: (Date.now() - started) / 1000}));
  throw error;
} finally { await reader.release(); }
