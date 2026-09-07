import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {decodeOcrSource,extractOcrCrop} from '../src/ocr-image.mjs';
const sharp=createRequire(import.meta.url)('sharp');
for(const orientation of [1,6,8]) {
  const source=await sharp({create:{width:800,height:600,channels:3,background:'#a04521'}}).composite([{input:Buffer.from('<svg width="400" height="200"><text x="0" y="100" font-size="60">269-1-41</text></svg>'),left:250,top:250}]).jpeg().withMetadata({orientation}).toBuffer();
  const decoded=await decodeOcrSource(source);
  const extract={left:150,top:200,width:300,height:120};
  for(const normalized of [false,true]) {
    let old=sharp(source).rotate().extract(extract);
    if(normalized) old=old.greyscale().normalize().sharpen({sigma:1});
    const actual=await extractOcrCrop(decoded,extract,{normalized});
    const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash(await sharp(actual).raw().toBuffer()),hash(await sharp(await old.png().toBuffer()).raw().toBuffer()),`orientation=${orientation}, normalized=${normalized}`);
  }
}
console.log('In-memory OCR crops match previous pixels (6 cases)');
