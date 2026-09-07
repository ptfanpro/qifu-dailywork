import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeImageFile} from '../src/ocr-image.mjs';
const sharp=createRequire(import.meta.url)('sharp');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-long-image-path-'));
try {
  const dir=path.join(root,'a'.repeat(100),'b'.repeat(100),'c'.repeat(60));
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'synthetic.png');
  assert.ok(file.length>300);
  const make=()=>sharp({create:{width:20,height:10,channels:3,background:'#e09070'}}).png();
  const expected=await make().toBuffer();
  const info=await writeImageFile(make(),file);
  assert.deepEqual(fs.readFileSync(file),expected,'long-path output must preserve the exact encoder bytes');
  assert.equal(info.width,20);assert.equal(info.height,10);
  await assert.rejects(writeImageFile(make(),path.join(dir,'nonexistent','x.png')));
  const jpeg=path.join(dir,'synthetic.jpg');
  const jpegInfo=await writeImageFile(make().jpeg({quality:90}),jpeg);
  assert.equal(jpegInfo.format,'jpeg');
  assert.equal((await sharp(fs.readFileSync(jpeg)).metadata()).width,20);
  console.log('Long Windows image-output path regression PASS');
} finally {fs.rmSync(root,{recursive:true,force:true});}
