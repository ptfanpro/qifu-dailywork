import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readWindowsOcrTails,summarizeWindowsCodeObservations} from '../src/photo-prepare.mjs';
import {writeImageFile} from '../src/ocr-image.mjs';
const sharp=createRequire(import.meta.url)('sharp');
if(process.platform==='win32') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-winrt-long-test-'));
  try {
    const dir=path.join(root,'a'.repeat(100),'b'.repeat(100),'c'.repeat(60));fs.mkdirSync(dir,{recursive:true});
    const image=Buffer.from('<svg width="600" height="130"><rect width="100%" height="100%" fill="white"/><text x="20" y="80" font-family="Arial" font-size="60">269-1-123</text></svg>');
    const files=[path.join(dir,'a.png'),path.join(dir,'b.png')];
    for(const file of files)await writeImageFile(sharp(image).png(),file);
    const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    const results=readWindowsOcrTails(appRoot,files,dir);
    assert.equal(results.size,2,'long paths must not silently become empty OCR');
    assert.deepEqual([...results.keys()],files,'temporary aliases must map back to original evidence identity');
    const reading=summarizeWindowsCodeObservations([...results].map(([crop,value])=>({crop,text:value.text})),'269');
    assert.equal(reading.number,123,JSON.stringify([...results.values()]));assert.equal(reading.reliable,true);
    assert.ok(files.every(file=>fs.existsSync(file)),'caller-owned crops must not be removed');
    const missing=path.join(dir,'missing.png');
    const mixed=readWindowsOcrTails(appRoot,[files[0],missing,files[1]],dir);
    assert.deepEqual([...mixed.keys()],files,'a failed long-path alias must not discard other files');
    assert.equal(mixed.ocrDiagnostics.inputCount,3);
    assert.equal(mixed.ocrDiagnostics.errorCount,1);
    assert.equal(mixed.ocrDiagnostics.status,'completed');
    console.log('Windows OCR >300-character path integration PASS');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
} else console.log('Windows OCR long-path integration SKIPPED: requires Windows');
