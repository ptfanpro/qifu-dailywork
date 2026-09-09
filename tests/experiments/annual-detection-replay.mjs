// Full-corpus content-only code audit. No production writes, filenames as
// input evidence, network OCR, expected-number filtering or sequence inference.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createOcrWorker} from '../../src/photo-prepare.mjs';
import {createTextDetector,readDetectedCodes} from './text-regions.mjs';
import {requirePrivateAuditRoot} from '../audit-paths.mjs';
const [root,modelFile,partText='0',partsText='1',...dates]=process.argv.slice(2);
const part=Number(partText),parts=Number(partsText),appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(!root||!modelFile||!Number.isInteger(part)||!Number.isInteger(parts)||part<0||part>=parts) throw Error('PRIVATE_AUDIT_ROOT MODEL PART PARTS [DATES]');
requirePrivateAuditRoot(root);
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const inputs=['tests/experiments/text-regions.mjs','src/photo-prepare.mjs','src/local-ocr.mjs','src/body-text-detector.mjs','src/vertical-body-regions.mjs'].map(file=>[file,sha(fs.readFileSync(path.join(appRoot,file)))]);
const version=sha(JSON.stringify(inputs)),dir=path.join(root,`detection-${version.slice(0,12)}`);
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,`version-${part}.json`),JSON.stringify({version,inputs,modelSha256:sha(fs.readFileSync(modelFile)),mode:'two-engines-content-only'}));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'inventory.json')));
const detector=await createTextDetector(appRoot,modelFile),worker=await createOcrWorker(appRoot);
try {
  for(const [index,day] of inventory.days.entries()) {
    if(index%parts!==part||(dates.length&&!dates.includes(day.date)))continue;
    const dayDir=path.join(dir,day.date);fs.mkdirSync(dayDir,{recursive:true});
    const rows=[];
    for(const photo of day.photos) {
      const report=path.join(dayDir,`${photo.sha256}.json`);
      if(fs.existsSync(report)){const previous=JSON.parse(fs.readFileSync(report));if(!previous.error){rows.push(previous);continue;}}
      const bytes=fs.readFileSync(photo.file);
      if(sha(bytes)!==photo.sha256)throw Error('source changed since inventory');
      let result;
      try {result=await readDetectedCodes(detector,appRoot,bytes,`26${Number(day.date.slice(5,7))}`,{worker});}
      catch {result={confirmed:null,error:'detector-or-recognizer-failed'};}
      const row={sha256:photo.sha256,referenceLabel:photo.referenceLabel,referenceNumber:photo.referenceNumber,...result,
        sourceUnchanged:sha(fs.readFileSync(photo.file))===photo.sha256};
      const tmp=report+'.tmp';fs.writeFileSync(tmp,JSON.stringify(row));fs.renameSync(tmp,report);rows.push(row);
    }
    const summary={date:day.date,photos:rows.length,confirmed:rows.filter(r=>r.confirmed!==null).length,
      paperUnresolved:rows.filter(r=>r.referenceLabel==='blessing'&&r.confirmed===null).length,
      referenceDisagreements:rows.filter(r=>r.confirmed!==null&&r.referenceLabel!=='unlabelled'&&(r.referenceLabel!=='blessing'||r.confirmed!==r.referenceNumber)).length,
      sourceUnchanged:rows.every(r=>r.sourceUnchanged===true),
      errors:rows.filter(r=>r.error).length,seconds:Math.round(rows.reduce((n,r)=>n+(r.seconds||0),0))};
    fs.writeFileSync(path.join(dayDir,'summary.json'),JSON.stringify(summary));console.log(JSON.stringify(summary));
  }
} finally {await worker.terminate();await detector.release();}
