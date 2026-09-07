import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {requirePrivateAuditRoot} from './audit-paths.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-audit-paths-test-'));
try {
  assert.equal(requirePrivateAuditRoot(dir),fs.realpathSync(dir));
  assert.throws(()=>requirePrivateAuditRoot(os.tmpdir()));
  assert.throws(()=>requirePrivateAuditRoot(path.resolve('.')));
  console.log('Private annual-audit output boundary PASS');
} finally {fs.rmdirSync(dir);}
