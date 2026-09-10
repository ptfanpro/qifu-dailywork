// Full-corpus content-only code audit. No production writes, filenames as
// input evidence, network OCR, expected-number filtering or sequence inference.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createOcrWorker} from '../../src/photo-prepare.mjs';
import {createTextDetector,readDetectedCodes} from './text-regions.mjs';
import {requirePrivateAuditRoot} from '../audit-paths.mjs';
import {sealDetectionRow,canReuseDetectionRow,detectionErrorCount} from './detection-cache.mjs';
const [root,modelFile,partText='0',partsText='1',...dates]=process.argv.slice(2);
const part=Number(partText),parts=Number(partsText),appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(!root||!modelFile||!Number.isInteger(part)||!Number.isInteger(parts)||part<0||part>=parts) throw Error('PRIVATE_AUDIT_ROOT MODEL PART PARTS [DATES]');
requirePrivateAuditRoot(root);
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const inputs=['tests/experiments/annual-detection-replay.mjs','tests/experiments/text-regions.mjs','tests/experiments/detection-cache.mjs',
  'src/photo-prepare.mjs','src/local-ocr.mjs','src/body-text-detector.mjs','src/vertical-body-regions.mjs',
  'src/detected-code-reader.mjs','src/printed-code-parser.mjs',
  'models/paddleocr-en-v5/inference.onnx','models/paddleocr-en-v5/ppocrv5_en_dict.txt','ocr-data/eng.traineddata.gz']
  .map(file=>[file,sha(fs.readFileSync(path.join(appRoot,file)))]);
const modelSha256=sha(fs.readFileSync(modelFile));
const version=sha(JSON.stringify({inputs,modelSha256})),dir=path.join(root,`detection-${version.slice(0,12)}`);
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,`version-${part}.json`),JSON.stringify({version,inputs,modelSha256,mode:'two-engines-content-only'}));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'inventory.json')));
const detector=await createTextDetector(appRoot,modelFile),worker=await createOcrWorker(appRoot);
try {
  for(const [index,day] of inventory.days.entries()) {
    if(index%parts!==part||(dates.length&&!dates.includes(day.date)))continue;
    const dayDir=path.join(dir,day.date);fs.mkdirSync(dayDir,{recursive:true});
    const rows=[];
    for(const photo of day.photos) {
      const report=path.join(dayDir,`${photo.sha256}.json`);
      const bytes=fs.readFileSync(photo.file);
      const currentSourceSha256=sha(bytes);
      if(currentSourceSha256!==photo.sha256)throw Error('source changed since inventory');
      const identity={sourceVersion:version,modelSha256,date:day.date,sha256:photo.sha256};
      if(fs.existsSync(report)){
        let previous;
        try {previous=JSON.parse(fs.readFileSync(report));}catch { /* preserve malformed prior evidence below */ }
        if(canReuseDetectionRow(previous,identity,currentSourceSha256)){rows.push(previous);continue;}
        // Keep rejected/failed observations before replacing this tool's own
        // current pointer. Never modify the source image or prior snapshots.
        fs.copyFileSync(report,path.join(dayDir,`${photo.sha256}.prior-${crypto.randomUUID()}.json`));
      }
      let result;
      try {result=await readDetectedCodes(detector,appRoot,bytes,`26${Number(day.date.slice(5,7))}`,{worker});}
      catch {result={confirmed:null,error:'detector-or-recognizer-failed'};}
      if(sha(fs.readFileSync(photo.file))!==photo.sha256)throw Error('source changed during detection');
      const row=sealDetectionRow({sha256:photo.sha256,referenceLabel:photo.referenceLabel,referenceNumber:photo.referenceNumber,...result,
        sourceUnchanged:true},identity);
      const tmp=report+'.tmp';fs.writeFileSync(tmp,JSON.stringify(row));fs.renameSync(tmp,report);rows.push(row);
    }
    const summary={date:day.date,photos:rows.length,confirmed:rows.filter(r=>r.confirmed!==null).length,
      paperUnresolved:rows.filter(r=>r.referenceLabel==='blessing'&&r.confirmed===null).length,
      referenceDisagreements:rows.filter(r=>r.confirmed!==null&&r.referenceLabel!=='unlabelled'&&(r.referenceLabel!=='blessing'||r.confirmed!==r.referenceNumber)).length,
      sourceUnchanged:rows.every(r=>r.sourceUnchanged===true),
      errors:detectionErrorCount(rows),seconds:Math.round(rows.reduce((n,r)=>n+(r.seconds||0),0))};
    fs.writeFileSync(path.join(dayDir,'summary.json'),JSON.stringify(summary));console.log(JSON.stringify(summary));
  }
} finally {await worker.terminate();await detector.release();}
