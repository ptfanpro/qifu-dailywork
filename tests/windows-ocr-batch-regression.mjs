import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const sharp=require('sharp');
if(process.platform==='win32') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-ocr-batch-test-'));
  try {
    const valid=path.join(dir,'code.png'),invalid=path.join(dir,'invalid.png'),list=path.join(dir,'list.txt');
    await sharp(Buffer.from('<svg width="600" height="130"><rect width="100%" height="100%" fill="white"/><text x="20" y="80" font-family="Arial" font-size="60">269-1-123</text></svg>')).png().toFile(valid);
    fs.writeFileSync(invalid,'intentionally invalid fixture');
    fs.writeFileSync(list,[valid,invalid,'invalid\u0000path',valid].join('\n'));
    const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('ui/Read-WindowsOcr.ps1'),'-InputListPath',list,'-IncludeRegions'],{encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(result.status,0,'OCR engine must be available to run this integration test');
    const rows=result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
    assert.deepEqual(rows.map(row=>row.status),['ok','error','error','ok']);
    assert.ok(rows[0].lines.length>0&&rows[3].lines.length>0);
    assert.match(rows[0].text,/123/);
    assert.equal(rows[1].reason,'image-ocr-failed');
    console.log('Windows OCR per-file failure isolation PASS');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
