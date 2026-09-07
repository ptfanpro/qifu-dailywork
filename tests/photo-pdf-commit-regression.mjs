import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {applyPhotoPreparation} from '../src/photo-prepare.mjs';
import {createPhotoInputBinding, createPdfIndexBinding} from '../src/recognition-provenance.mjs';
const require = createRequire(import.meta.url), sharp = require('sharp');

// Generated TEMP fixtures only. Simulate the external PDF sync during real
// JPEG staging/commit, not during OCR; no business files or online calls.
export async function runPhotoPdfCommitRegression() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qifu-pdf-commit-test-'));
  const image = await sharp({create: {width: 400, height: 300, channels: 3, background: '#d03344'}}).jpeg().toBuffer();
  const originalPdf = Buffer.from('%PDF-1.4\noriginal synthetic revision\n%%EOF');
  const changedPdf = Buffer.from(originalPdf); changedPdf[12] ^= 1;
  const copy = fs.copyFileSync;
  try {
    for (const stage of ['unchanged', 'before-backup', 'after-backup', 'after-target', 'added-pdf', 'removed-pdf']) {
      const folder = path.join(root, stage), photos = path.join(folder, '1'), work = path.join(folder, 'work');
      fs.mkdirSync(photos, {recursive: true});
      const source = path.join(photos, 'a.jpg'), duplicate = path.join(photos, 'b.jpg');
      const pdf = path.join(folder, 'source.pdf'), target = path.join(photos, '1.jpg');
      fs.writeFileSync(source, image); fs.writeFileSync(duplicate, image); fs.writeFileSync(pdf, originalPdf);
      const plan = {businessDate: '2026-09-07', folder, photoDir: photos, ready: true, issues: [],
        photoInputBinding: createPhotoInputBinding(photos, [source, duplicate]),
        pdfIndexBinding: createPdfIndexBinding('2026-09-07', [pdf], 'synthetic-recognizer'),
        assignments: [{source, targetName: '1.jpg', kind: 'blessing'}],
        duplicateSources: [{source: duplicate, duplicateOfNumber: 1}]};
      if (stage === 'before-backup') fs.writeFileSync(pdf, changedPdf);
      let injected = false;
      fs.copyFileSync = (from, to, ...args) => {
        const result = copy(from, to, ...args);
        if (!injected && ((from === source && to.includes('photo-backups')
          && ['after-backup', 'added-pdf', 'removed-pdf'].includes(stage)) || (to === target && stage === 'after-target'))) {
          injected = true;
          if (stage === 'added-pdf') fs.writeFileSync(path.join(folder, 'supplement.pdf'), originalPdf);
          else if (stage === 'removed-pdf') fs.unlinkSync(pdf);
          else fs.writeFileSync(pdf, changedPdf);
        }
        return result;
      };
      try {
        if (stage === 'unchanged') {
          const receipt = await applyPhotoPreparation(plan, work);
          assert.equal(receipt.processedCount, 1); assert.equal(receipt.duplicateRemovedCount, 1);
          assert.ok(fs.existsSync(target));
        } else {
          await assert.rejects(applyPhotoPreparation(plan, work), /PDF.*变化/, stage);
          assert.deepEqual(fs.readFileSync(source), image, `${stage}: original must survive or roll back`);
          assert.deepEqual(fs.readFileSync(duplicate), image, `${stage}: duplicate must not be lost`);
          assert.equal(fs.existsSync(target), false, `${stage}: stale target must not remain`);
          if (stage === 'before-backup') assert.equal(fs.existsSync(work), false);
          if (['before-backup', 'after-backup', 'after-target'].includes(stage)) assert.deepEqual(fs.readFileSync(pdf), changedPdf);
          if (stage !== 'before-backup') assert.equal(injected, true);
        }
      } finally { fs.copyFileSync = copy; }
    }
    console.log('PDF revision changes during photo commit regression PASS');
  } finally { fs.copyFileSync = copy; fs.rmSync(root, {recursive: true, force: true}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runPhotoPdfCommitRegression();
