// Run from a separately frozen source tree. Private reviewed labels only;
// entire held-out dates, without historical filename/number/role lookup.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {requirePrivateAuditRoot} from '../audit-paths.mjs';
import {createReferenceImageEncoder,createReferenceRoleClassifier,referenceExperimentFingerprint} from './reference-role-reader.mjs';
import {createBalancedReferenceRoleClassifier} from './balanced-reference-role-reader.mjs';
const args=process.argv.slice(2),balanced=args.at(-1)==='--balanced-dates';
if(balanced)args.pop();
const [rootArg,modelDir,appRoot,labelsFile,...dates]=args;
if(!rootArg||!modelDir||!appRoot||!labelsFile||!dates.length||new Set(dates).size!==dates.length)
  throw Error('PRIVATE_ROOT MODEL_DIR FROZEN_APP_ROOT PRIVATE_CALIBRATION_JSON EVALUATION_DATE [...] [--balanced-dates]');
const root=requirePrivateAuditRoot(rootArg),labelsPath=fs.realpathSync(labelsFile);
const relative=path.relative(root,labelsPath);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Labels must remain private');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),labelsBytes=fs.readFileSync(labelsPath);
const labels=JSON.parse(labelsBytes),inventory=JSON.parse(fs.readFileSync(path.join(root,'inventory.json')));
if(labels.schemaVersion!==1||labels.manualWholeImagesReviewed!==true||!Array.isArray(labels.rows))throw Error('Manual review required');
const selected=dates.map(date=>{const rows=inventory.days.filter(d=>d.date===date);if(rows.length!==1||!rows[0].photos.length)throw Error('Missing evaluation day');return rows[0];});
const calibrationDates=[...new Set(labels.rows.map(r=>r.date))];
if(dates.some(d=>calibrationDates.includes(d)))throw Error('Date leakage');
for(const date of calibrationDates){
 const day=inventory.days.find(d=>d.date===date),a=labels.rows.filter(r=>r.date===date);
 if(!day||JSON.stringify(a.map(r=>r.sha256).sort())!==JSON.stringify(day.photos.map(p=>p.sha256).sort()))throw Error('Incomplete calibration day');
}
const trainingHashes=new Set(labels.rows.map(r=>r.sha256));
if(selected.some(d=>d.photos.some(p=>trainingHashes.has(p.sha256))))throw Error('Exact image leakage');
const here=path.dirname(fileURLToPath(import.meta.url));
const sourceFiles=['reference-role-replay.mjs','reference-role-reader.mjs','balanced-reference-role-reader.mjs','clip-role-reader.mjs','../audit-paths.mjs']
 .map(f=>[f,sha(fs.readFileSync(path.join(here,f)))]);
const dir=fs.mkdtempSync(path.join(root,'reference-role-replay-')),start=performance.now();
const encoder=await createReferenceImageEncoder(appRoot,modelDir),allSources=[],calibration=[],evaluated=[];
const readImage=async(date,p)=>{
 const real=fs.realpathSync(p.file);
 if(path.dirname(real).toLowerCase()!==fs.realpathSync(path.dirname(p.file)).toLowerCase())throw Error('Linked source');
 const bytes=fs.readFileSync(real);if(sha(bytes)!==p.sha256)throw Error('Source changed');
 const t=performance.now(),views=await encoder.read(bytes);
 if(sha(fs.readFileSync(real))!==p.sha256)throw Error('Source changed during reading');
 allSources.push(p);return {date,sha256:p.sha256,sourceUnchanged:true,seconds:(performance.now()-t)/1000,views};
};
try {
 for(const row of labels.rows){
  const p=inventory.days.find(d=>d.date===row.date)?.photos.find(p=>p.sha256===row.sha256);
  if(!p)throw Error('Unknown calibration source');
  calibration.push({...await readImage(row.date,p),role:row.role,reviewed:row.reviewed===true});
 }
 const model=(balanced?createBalancedReferenceRoleClassifier:createReferenceRoleClassifier)(calibration,encoder.identity);
 const version={schemaVersion:1,startedAt:new Date().toISOString(),sourceFiles,calibrationLabelSha256:sha(labelsBytes),
  model:model.identity,calibrationDates,evaluationDates:dates,mode:balanced?'offline-balanced-date-role-diagnostic':'offline-reference-role-diagnostic'};
 version.fingerprint=referenceExperimentFingerprint(version);
 fs.writeFileSync(path.join(dir,'version.json'),JSON.stringify(version,null,2));
 fs.writeFileSync(path.join(dir,'calibration.json'),JSON.stringify(calibration));
 for(const day of selected)for(const p of day.photos){
  const feature=await readImage(day.date,p),prediction=model.predict(feature);
  const row={...feature,prediction};evaluated.push(row);
  fs.writeFileSync(path.join(dir,`${day.date}-${p.sha256}.json`),JSON.stringify(row));
  fs.writeFileSync(path.join(dir,'progress.json'),JSON.stringify({date:day.date,photos:evaluated.length,
   total:selected.reduce((n,d)=>n+d.photos.length,0),updatedAt:new Date().toISOString()}));
 }
 for(const p of allSources)if(sha(fs.readFileSync(p.file))!==p.sha256)throw Error('Original changed by completion');
 for(const [f,h] of sourceFiles)if(sha(fs.readFileSync(path.join(here,f)))!==h)throw Error('Frozen source changed');
 if(sha(fs.readFileSync(labelsPath))!==sha(labelsBytes))throw Error('Calibration labels changed');
 const summary={schemaVersion:1,fingerprint:version.fingerprint,modelFingerprint:model.identity.fingerprint,
  completedAt:new Date().toISOString(),calibrationPhotos:calibration.length,evaluationPhotos:evaluated.length,
  candidates:Object.fromEntries(['paper','lamp','water',null].map(c=>[c??'unresolved',evaluated.filter(r=>r.prediction.candidate===c).length])),
  seconds:(performance.now()-start)/1000,errors:0,sourceUnchanged:true,automaticAssignments:0,productionWrites:0,
  semanticVerified:false,bindingVerified:false,note:'References manually reviewed; held-out labels not provided to model. Candidate counts are not accuracy or release acceptance.'};
 fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({directory:path.basename(dir),...summary}));
} finally {await encoder.release();}
