// Explicit actual-model parity test; fails when model/runtime is unavailable.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createDbMapReader} from './db-map-reader.mjs';
import {createTextDetector} from '../../src/body-text-detector.mjs';
const sharp=createRequire(import.meta.url)('sharp');
const root=path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'../..'));
const model=path.join(root,'models/paddleocr-zh-v4/ch_PP-OCRv4_det_mobile.onnx');
await assert.rejects(createDbMapReader(root,path.join(root,'package.json')),/Untrusted detector model/);
const reader=await createDbMapReader(root,model),product=await createTextDetector(root,model);
try {
  const image=await sharp({create:{width:360,height:100,channels:3,background:'#fff7c4'}})
    .composite([{input:Buffer.from('<svg width="360" height="100"><text x="30" y="65" font-size="36">261-1-93</text></svg>')}]).png().toBuffer();
  const variants=[image,await sharp(image).ensureAlpha(.4).png().toBuffer(),
    await sharp(image).greyscale().png().toBuffer(),await sharp(image).rotate(90).png().toBuffer()];
  for(const bytes of variants) {
    const a=await reader.read(bytes),b=await product.detect(bytes);
    assert.deepEqual(a.regions,b.regions);
    assert.equal(a.probabilities.length,a.width*a.height);
    assert.equal(a.status,'diagnostic-only-not-binding');
  }
  await assert.rejects(reader.read(image,{maxSide:0}),/Invalid detector budget/);
  await assert.rejects(reader.read(Buffer.from('not an image')));
}finally{await reader.release();await product.release();}
console.log('DB map/product preprocessing parity PASS (4 synthetic image variants; not photo acceptance)');
