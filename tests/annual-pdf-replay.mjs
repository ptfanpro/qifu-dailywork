// PDF index only; no photo writes, browser or production state changes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createOcrWorker,indexPdfCodes} from '../src/photo-prepare.mjs';
import {recognitionSourceFingerprint} from '../src/recognition-provenance.mjs';
import {requirePrivateAuditRoot} from './audit-paths.mjs';
const [root,partText='0',partsText='1',...dates]=process.argv.slice(2);
const part=Number(partText),parts=Number(partsText),appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!root||!Number.isInteger(part)||!Number.isInteger(parts)||part<0||part>=parts)throw Error('PRIVATE_AUDIT_ROOT PART PARTS [DATES]');
requirePrivateAuditRoot(root);
const inventory=JSON.parse(fs.readFileSync(path.join(root,'inventory.json'))),fingerprint=recognitionSourceFingerprint(appRoot);
const output=path.join(root,`pdf-index-${fingerprint.slice(0,12)}`);fs.mkdirSync(output,{recursive:true});
const worker=await createOcrWorker(appRoot);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
try {
  for(const [index,day] of inventory.days.entries()) {
    if(index%parts!==part||(dates.length&&!dates.includes(day.date)))continue;
    if(recognitionSourceFingerprint(appRoot)!==fingerprint)throw Error('Recognition snapshot changed; resume from a frozen snapshot');
    const dir=path.join(output,day.date);fs.mkdirSync(dir,{recursive:true});
    const report=path.join(dir,'summary.json');if(fs.existsSync(report)&&!JSON.parse(fs.readFileSync(report)).error)continue;
    const started=Date.now();
    if(!day.pdfs.every(f=>hash(f.file)===f.sha256))throw Error('PDF changed since inventory');
    let summary;
    try {
      const pages=await indexPdfCodes(worker,day.pdfs.map(f=>f.file),`26${Number(day.date.slice(5,7))}`,dir,appRoot);
      if(recognitionSourceFingerprint(appRoot)!==fingerprint)throw Error('Recognition snapshot changed during PDF indexing');
      for(const page of pages)delete page._localShapeFingerprint;
      fs.writeFileSync(path.join(dir,'private-pages.json'),JSON.stringify(pages));
      const numbers=pages.map(p=>p.number).filter(Number.isInteger);
      const reference=day.photos.filter(p=>p.referenceLabel==='blessing').map(p=>p.referenceNumber);
      summary={date:day.date,pdfs:day.pdfs.length,pages:pages.length,unread:pages.length-numbers.length,
        duplicates:numbers.length-new Set(numbers).size,referenceNumbersAbsent:reference.filter(n=>!numbers.includes(n)).length,
        fullCodeAnchors:pages.filter(p=>p.codeEvidence==='pdf-full-code-multi-view').length,
        seconds:Math.round((Date.now()-started)/1000),sourceUnchanged:day.pdfs.every(f=>hash(f.file)===f.sha256)};
    } catch(error) {
      fs.writeFileSync(path.join(dir,'private-error.json'),JSON.stringify({name:error.name,code:error.code||null,message:error.message,stack:error.stack}));
      summary={date:day.date,error:'pdf-index-failed',errorType:error.name,errorCode:error.code||null,seconds:Math.round((Date.now()-started)/1000)};
    }
    fs.writeFileSync(report,JSON.stringify(summary));console.log(JSON.stringify(summary));
  }
} finally {await worker.terminate();}
