import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseUploadedPhotoPreview, buildPhotoReadbackRaster, matchUploadedPhotoRaster } from '../src/photo-readback.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

assert.equal(parseUploadedPhotoPreview("see('https://stqifu-prod.oss-cn-qingdao.aliyuncs.com/service/stqf/blessing/a.png')"),
  'https://stqifu-prod.oss-cn-qingdao.aliyuncs.com/service/stqf/blessing/a.png');
for (const onclick of [
  "see('http://stqifu-prod.oss-cn-qingdao.aliyuncs.com/service/stqf/blessing/a.png')",
  "see('https://evil.example/service/stqf/blessing/a.png')",
  "see('https://stqifu-prod.oss-cn-qingdao.aliyuncs.com/other/a.png')",
  "deleteOrder('https://stqifu-prod.oss-cn-qingdao.aliyuncs.com/service/stqf/blessing/a.png')",
]) assert.equal(parseUploadedPhotoPreview(onclick), null);

const makeImage = async (background, foreground) => sharp({ create:{width:1800,height:1350,channels:3,background} })
  .composite([{ input:Buffer.from(`<svg width="1800" height="1350"><rect x="350" y="250" width="800" height="700" fill="${foreground}"/></svg>`),left:0,top:0 }])
  .jpeg({quality:90}).toBuffer();
const localA = await makeImage('#f2e9cf','#48331b');
const localB = await makeImage('#d1e9f2','#1b3348');
const localC = await makeImage('#e9d1f2','#331b48');
const onlineB = await sharp(localB).jpeg({quality:80}).toBuffer();
const candidates = await Promise.all([
  ['a.jpg',localA],['b.jpg',localB],['c.jpg',localC],
].map(async ([name,bytes]) => ({name,raster:await buildPhotoReadbackRaster(bytes)})));
const matched = await matchUploadedPhotoRaster(onlineB,candidates,new Set(['b.jpg']));
assert.equal(matched?.name,'b.jpg');
assert.equal(await matchUploadedPhotoRaster(onlineB,candidates,new Set(['a.jpg'])),null);
assert.equal(await matchUploadedPhotoRaster(onlineB,[candidates[1],{...candidates[1],name:'duplicate.jpg'}],new Set(['b.jpg'])),null);

console.log('Manual photo online-image readback regression PASS');
