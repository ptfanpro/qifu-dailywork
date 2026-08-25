import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planPhotoPreparation } from '../src/photo-prepare.mjs';

const [businessRoot, businessDate, workDir] = process.argv.slice(2);
if (!businessRoot || !businessDate || !workDir) {
  throw new Error('usage: node verify-live-photo-plan.mjs <business-root> <yyyy-mm-dd> <work-dir>');
}

const [year, month, day] = businessDate.split('-').map(Number);
const folder = path.join(businessRoot, `${month}月${day}日`);
const photoDir = path.join(folder, '1');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(workDir, { recursive: true });
const plan = await planPhotoPreparation({
  appRoot,
  folder,
  photoDir,
  date: businessDate,
  expectedPrefix: `${String(year).slice(-2)}${month}`,
  workDir,
  onProgress: (message) => console.log(message),
});

fs.writeFileSync(path.join(workDir, 'last-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ready: plan.ready,
  pdfPages: plan.pdfPages.length,
  pdfDetails: plan.pdfPages.map((page) => ({
    pdf: page.pdfName,
    page: page.pageNumber,
    portrait: page.portrait,
    rawNumber: page.rawNumber,
    number: page.number,
    layout: page.ocrLayout,
    text: page.ocrText,
    observations: page.ocrObservations,
  })),
  blessing: plan.assignments.filter((item) => item.kind === 'blessing').length,
  lampScenes: plan.assignments.filter((item) => item.kind === 'scene-lamp').length,
  waterScenes: plan.assignments.filter((item) => item.kind === 'scene-water').length,
  duplicates: plan.duplicateSources.length,
  missingExpected: plan.missingExpected,
  issues: plan.issues,
}, null, 2));
