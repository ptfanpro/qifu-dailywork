import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {scanPhotoWorkday} from '../src/photos.mjs';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const {PDFDocument} = require('pdf-lib');

test('an unclassified photo is not reported as a physically missing photo; closure still stays blocked', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qifu-availability-test-'));
  try {
    const day = path.join(root, '9月3日'), photos = path.join(day, '1');
    fs.mkdirSync(photos, {recursive: true});
    const pdf = await PDFDocument.create();
    pdf.addPage(); pdf.addPage();
    fs.writeFileSync(path.join(day, '供水.pdf'), await pdf.save());
    const image = await sharp({create: {width: 1600, height: 1200, channels: 3, background: '#fff'}}).jpeg().toBuffer();
    fs.writeFileSync(path.join(photos, '1.jpg'), image);
    fs.writeFileSync(path.join(photos, 'unclassified.jpg'), image);
    const manifest = await scanPhotoWorkday(root, '2026-09-03', root, {runOcr: false});
    assert.equal(manifest.counts.missingBlessing, 1, 'legacy checkpoint count remains compatible');
    assert.equal(manifest.counts.unmatchedBlessing, 1);
    assert.equal(manifest.counts.unexpected, 1);
    assert.match(manifest.photoAvailability.summary, /1 个 PDF 页面尚未匹配/);
    assert.match(manifest.photoAvailability.summary, /1 张待识别或确认/);
    assert.match(manifest.photoAvailability.summary, /不能直接判定缺图/);
    assert.doesNotMatch(manifest.warnings.join(' '), /仍缺少.*张福单图/);
    assert.equal(manifest.batchCompleteReady, false);
    fs.unlinkSync(path.join(photos, 'unclassified.jpg'));
    const withoutRaw = await scanPhotoWorkday(root, '2026-09-03', root, {runOcr: false});
    assert.match(withoutRaw.photoAvailability.summary, /1 个 PDF 页面尚未匹配/);
    assert.doesNotMatch(withoutRaw.photoAvailability.summary, /待识别或确认|不能直接判定缺图/);
    assert.match(withoutRaw.photoAvailability.summary, /核对/);
    assert.equal(withoutRaw.batchCompleteReady, false);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
