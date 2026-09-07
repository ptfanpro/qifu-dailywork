// Targeted read-only evidence check. The SHA selectors choose inputs, never
// expected answers. Reports/crops stay in the private TEMP audit directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {auditExistingNumericPhotoCode} from '../src/photo-prepare.mjs';
import {recognitionSourceFingerprint} from '../src/recognition-provenance.mjs';
import {requirePrivateAuditRoot} from './audit-paths.mjs';
const [root,...selectors]=process.argv.slice(2);
requirePrivateAuditRoot(root);
if(!selectors.length||selectors.some(s=>! /^[a-f\d]{64}$/.test(s)))throw Error('PRIVATE_ROOT PHOTO_SHA256 [...]');
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fingerprint=recognitionSourceFingerprint(appRoot);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const inventory=JSON.parse(fs.readFileSync(path.join(root,'inventory.json')));
const inputs=inventory.days.flatMap(day=>day.photos.filter(p=>selectors.includes(p.sha256)).map(photo=>({date:day.date,photo})));
if(new Set(inputs.map(i=>i.photo.sha256)).size!==new Set(selectors).size)throw Error('Requested photo is absent from inventory');
const output=path.join(root,`windows-evidence-${fingerprint.slice(0,12)}-${crypto.randomUUID()}`);
fs.mkdirSync(output);
const rows=[];
for(const {date,photo} of inputs) {
  if(hash(fs.readFileSync(photo.file))!==photo.sha256)throw Error('Source changed since inventory');
  const started=Date.now(),cropDir=path.join(output,photo.sha256);
  const result=await auditExistingNumericPhotoCode({appRoot,file:photo.file,expectedPrefix:`26${Number(date.slice(5,7))}`,cropDir});
  if(recognitionSourceFingerprint(appRoot)!==fingerprint)throw Error('Recognition source changed during replay');
  const row={sha256:photo.sha256,date,referenceNumber:photo.referenceNumber,number:result.number,reliable:result.reliable,
    observations:result.observations,candidates:result.candidates,ocrDiagnostics:result.ocrDiagnostics,seconds:(Date.now()-started)/1000,
    sourceUnchanged:hash(fs.readFileSync(photo.file))===photo.sha256};
  rows.push(row);
  fs.writeFileSync(path.join(output,'private-results.json'),JSON.stringify({fingerprint,rows},null,2));
  console.log(JSON.stringify({checked:rows.length,reliable:row.reliable,observationCount:row.observations.length,ocrDiagnostics:row.ocrDiagnostics,sourceUnchanged:row.sourceUnchanged,seconds:row.seconds}));
  if(!row.sourceUnchanged)throw Error('Source changed during replay');
}
console.log(JSON.stringify({status:'DIAGNOSTIC_ONLY_NOT_ACCEPTANCE',checked:rows.length,confirmed:rows.filter(r=>r.reliable).length,
  unresolved:rows.filter(r=>!r.reliable).length,sourceUnchanged:rows.every(r=>r.sourceUnchanged),fingerprint}));
