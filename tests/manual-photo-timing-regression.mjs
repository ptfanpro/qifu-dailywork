import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Timing} from '../src/timing.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-manual-photo-timing-'));
try {
  const timing=new Timing(root,'photo-only','2026-09-25');
  assert.doesNotThrow(()=>timing.start('photo-manual-prepare'),
    'the visible manual photo action must be a valid timing phase');
  timing.end();
  assert.doesNotThrow(()=>timing.start('photo-manual-scan'),
    'the scan immediately following manual normalization must be a valid timing phase');
  timing.end();
  timing.finish();
  const saved=JSON.parse(fs.readFileSync(path.join(root,'timing.json'),'utf8'));
  assert.deepEqual(saved.phases.map(({phase})=>phase),['photo-manual-prepare','photo-manual-scan']);
  console.log('Manual photo timing phase regression PASS');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
