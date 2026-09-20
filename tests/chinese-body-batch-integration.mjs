import assert from 'node:assert/strict';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createChineseBodyReader} from '../src/chinese-body-reader.mjs';

const sharp=createRequire(import.meta.url)('sharp');
const appRoot=fileURLToPath(new URL('..',import.meta.url));
const modelRoot=path.join(appRoot,'models','paddleocr-zh-v4');
const line=async(width,height,label)=>sharp(Buffer.from(
 `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><text x="12" y="${Math.round(height*.72)}" font-family="Arial" font-size="${Math.round(height*.62)}" fill="black">${label}</text></svg>`,
)).png().toBuffer();
const sources=[];
for(let index=0;index<8;index++)sources.push(await line(480,72,`268-1-${630+index}`));
sources.push(await line(600,72,'268-1-638'));
sources.push(await line(600,72,'268-1-639'));

const reader=await createChineseBodyReader(appRoot,modelRoot);
try{
 await reader.readLine(sources[0]);
 const serialStarted=performance.now(),serial=[];
 for(const source of sources)serial.push(await reader.readLine(source));
 const serialMs=performance.now()-serialStarted;
 const batchStarted=performance.now(),batched=await reader.readLines(sources);
 const batchMs=performance.now()-batchStarted;
 assert.equal(batched.length,serial.length);
 for(let index=0;index<serial.length;index++){
  assert.equal(batched[index].error,undefined);
  assert.equal(batched[index].text,serial[index].text);
  assert.ok(Math.abs(batched[index].confidence-serial[index].confidence)<=1e-5);
 }
 const isolated=await reader.readLines([Buffer.from('not-an-image'),sources[0]]);
 assert.ok(isolated[0].error instanceof Error);
 assert.equal(isolated[1].text,serial[0].text);
 console.log(`Chinese body batch integration passed: exact output parity; serial=${serialMs.toFixed(1)}ms batch=${batchMs.toFixed(1)}ms`);
}finally{await reader.release();}
