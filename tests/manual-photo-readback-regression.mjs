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

// Same camera/background, small different paper detail. The former whole-image
// separation of 5 rejected real JPEG re-encodings of both otherwise unique photos.
const similar = async (x) => sharp({create:{width:1800,height:1350,channels:3,background:'#ead5bb'}})
  .composite([{input:Buffer.from(`<svg width="1800" height="1350"><rect x="${x}" y="650" width="120" height="180" fill="#342019"/></svg>`),left:0,top:0}])
  .jpeg({quality:90}).toBuffer();
const similarA=await similar(600),similarB=await similar(780);
const similarCandidates=await Promise.all([['same-a.jpg',similarA],['same-b.jpg',similarB]]
  .map(async([name,bytes])=>({name,raster:await buildPhotoReadbackRaster(bytes)})));
for(const [name,bytes] of [['same-a.jpg',similarA],['same-b.jpg',similarB]]) {
  assert.equal((await matchUploadedPhotoRaster(await sharp(bytes).jpeg({quality:80}).toBuffer(),similarCandidates,new Set([name])))?.name,name);
}
// A differently encoded copy of the same paper is not a distinct candidate.
const alias=await sharp(similarA).jpeg({quality:89}).toBuffer();
assert.equal(await matchUploadedPhotoRaster(await sharp(similarA).jpeg({quality:80}).toBuffer(),[
  similarCandidates[0],{name:'alias.jpg',raster:await buildPhotoReadbackRaster(alias)},
],new Set(['same-a.jpg'])),null);
// A different paper and a partly mixed pair must not pass on shared background.
const unknown=await similar(1050);
assert.equal(await matchUploadedPhotoRaster(unknown,similarCandidates,new Set(['same-a.jpg','same-b.jpg'])),null);
const rawA=await sharp(similarA).raw().toBuffer(),rawB=await sharp(similarB).raw().toBuffer();
const mixture=Buffer.from(rawA.map((value,index)=>Math.round((value+rawB[index])/2)));
const mixed=await sharp(mixture,{raw:{width:1800,height:1350,channels:3}}).jpeg().toBuffer();
assert.equal(await matchUploadedPhotoRaster(mixed,similarCandidates,new Set(['same-a.jpg','same-b.jpg'])),null);

console.log('Manual photo online-image readback regression PASS');
