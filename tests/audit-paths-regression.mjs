import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {requirePrivateAuditRoot} from './audit-paths.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-audit-paths-test-'));
const app=path.join(dir,'application'),scripts=path.join(app,'tests'),privateOutput=path.join(dir,'evidence');
try {
  assert.equal(requirePrivateAuditRoot(dir),fs.realpathSync(dir));
  assert.throws(()=>requirePrivateAuditRoot(os.tmpdir()));
  const source=fileURLToPath(new URL('..',import.meta.url));
  assert.throws(()=>requirePrivateAuditRoot(source));
  assert.throws(()=>requirePrivateAuditRoot(path.join(source,'tests')));
  fs.mkdirSync(app);fs.mkdirSync(scripts);fs.mkdirSync(privateOutput);
  const copied=path.join(scripts,'audit-paths.mjs');
  fs.copyFileSync(fileURLToPath(new URL('./audit-paths.mjs',import.meta.url)),copied);
  const relocated=await import(pathToFileURL(copied));
  assert.throws(()=>relocated.requirePrivateAuditRoot(app),'TEMP application itself is not private evidence storage');
  assert.throws(()=>relocated.requirePrivateAuditRoot(scripts),'application subdirectory is not evidence storage');
  assert.equal(relocated.requirePrivateAuditRoot(privateOutput),fs.realpathSync(privateOutput));
  console.log('Private annual-audit output boundary PASS');
} finally {
  const copied=path.join(scripts,'audit-paths.mjs');if(fs.existsSync(copied))fs.unlinkSync(copied);
  for(const folder of [privateOutput,scripts,app,dir])if(fs.existsSync(folder))fs.rmdirSync(folder);
}
