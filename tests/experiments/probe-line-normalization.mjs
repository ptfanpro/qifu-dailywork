import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {recognizeLocalTextLine} from '../../src/local-ocr.mjs';
import {parseLocalOcrCodeCandidates,createOcrWorker} from '../../src/photo-prepare.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
const [prefix,...files]=process.argv.slice(2),appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const worker=await createOcrWorker(appRoot);
try {
  for(const [index,file] of files.entries())for(const mode of ['original','trimmed']) {
    const crop=mode==='original'?await sharp(file).png().toBuffer():await sharp(file).trim({threshold:15}).extend({top:12,bottom:12,left:12,right:12,background:'#fff'}).png().toBuffer();
    const paddle=await recognizeLocalTextLine(appRoot,crop),tess=(await worker.recognize(crop)).data;
    console.log(JSON.stringify({index,mode,paddle:{digits:paddle.text.replace(/[^0-9-]/g,''),confidence:paddle.confidence,candidates:parseLocalOcrCodeCandidates(paddle.text,prefix)},
      tesseract:{digits:tess.text.replace(/[^0-9-]/g,''),confidence:tess.confidence,candidates:parseLocalOcrCodeCandidates(tess.text,prefix)}}));
  }
} finally {await worker.terminate();}
