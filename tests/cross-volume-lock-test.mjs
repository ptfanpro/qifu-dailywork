import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { applyPhotoPreparation } from '../src/photo-prepare.mjs';
import {createPhotoInputBinding} from '../src/recognition-provenance.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const [sourceParent,workParent]=process.argv.slice(2);
if(!sourceParent||!workParent)throw Error('Provide two existing test parent directories on different volumes');
assert.notEqual(path.parse(path.resolve(sourceParent)).root.toLowerCase(),path.parse(path.resolve(workParent)).root.toLowerCase());
// Never delete a supplied directory. Only fresh test-owned children are used.
const sourceRoot=fs.mkdtempSync(path.join(path.resolve(sourceParent),'qifu-cross-source-'));
const workRoot=fs.mkdtempSync(path.join(path.resolve(workParent),'qifu-cross-work-'));

const source = path.join(sourceRoot, '微信原图.jpg');
await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#b93344' } })
  .jpeg({ quality: 96 })
  .toFile(source);

const originalUnlinkSync = fs.unlinkSync;
let simulatedLocks = 0;
fs.unlinkSync = (file) => {
  if (path.resolve(file) === source && simulatedLocks < 6) {
    simulatedLocks += 1;
    const error = new Error('simulated NAS synchronization lock');
    error.code = 'EPERM';
    throw error;
  }
  return originalUnlinkSync(file);
};

try {
  const receipt = await applyPhotoPreparation({
    ready: true,
    issues: [],
    businessDate: '2026-08-13',
    photoDir: sourceRoot,
    photoInputBinding:createPhotoInputBinding(sourceRoot,[source]),
    assignments: [{ source, targetName: '284.jpg', kind: 'blessing', evidence: { method: 'cross-volume-lock-test' } }],
  }, workRoot);
  assert.equal(simulatedLocks, 6);
  assert.equal(receipt.processedCount, 1);
  assert.equal(receipt.cleanupPending.length, 0);
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.existsSync(path.join(sourceRoot, '284.jpg')), true);
  assert.equal(fs.existsSync(path.join(workRoot, 'photo-quarantine')), false);
  assert.equal(fs.existsSync(path.join(workRoot, 'photo-staging')), false);
  console.log(JSON.stringify({ passed: true, simulatedLocks, processedCount: receipt.processedCount, cleanupPending: receipt.cleanupPending }));
} finally {
  fs.unlinkSync = originalUnlinkSync;
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.rmSync(workRoot, { recursive: true, force: true });
}
