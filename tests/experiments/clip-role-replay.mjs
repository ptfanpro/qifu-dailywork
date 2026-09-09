// Explicit offline role experiment. Entire selected dates, no code assignment,
// no browser, no model downloads, no filenames provided to the model.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {requirePrivateAuditRoot} from '../audit-paths.mjs';
import {createClipRoleReader,clipExperimentFingerprint} from './clip-role-reader.mjs';
const [rootArg,modelDir,appRoot,...dates]=process.argv.slice(2);
if(!rootArg||!modelDir||!appRoot||!dates.length||new Set(dates).size!==dates.length
  ||dates.some(d=>!/^2026-\d\d-\d\d$/.test(d)))throw Error('PRIVATE_ROOT MODEL_DIR FROZEN_APP_ROOT YYYY-MM-DD [...]');
const root=requirePrivateAuditRoot(rootArg),inventory=JSON.parse(fs.readFileSync(path.join(root,'inventory.json')));
const selected=dates.map(date=>{
  const rows=inventory.days.filter(d=>d.date===date);
  if(rows.length!==1||!rows[0].photos.length)throw Error('Missing explicit date source');
  return rows[0];
});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const sourceFiles=['clip-role-reader.mjs','clip-role-replay.mjs'].map(f=>[f,sha(fs.readFileSync(path.join(scriptDir,f)))]);
const start=performance.now(),reader=await createClipRoleReader(appRoot,modelDir);
const dir=fs.mkdtempSync(path.join(root,'clip-role-replay-'));
const identity={schemaVersion:1,reader:reader.identity,sourceFiles,
  runtimeSha256:sha(fs.readFileSync(path.join(appRoot,'vendor/onnxruntime-node/package.json'))),
  dates,startedAt:new Date().toISOString(),mode:'diagnostic-only-not-numbering-or-order-binding'};
const fingerprint=clipExperimentFingerprint(identity);
fs.writeFileSync(path.join(dir,'version.json'),JSON.stringify({...identity,fingerprint},null,2));
const rows=[];
try {
  for(const day of selected){
    for(const photo of day.photos){
      // Inventory supplies the file to read, not an inference label. Physical
      // sources are direct date-folder children; refuse links or changed data.
      const inputPath=fs.realpathSync(photo.file);
      if(path.dirname(inputPath).toLowerCase()!==fs.realpathSync(path.dirname(photo.file)).toLowerCase())throw Error('Source link outside date directory');
      const bytes=fs.readFileSync(inputPath);
      if(sha(bytes)!==photo.sha256)throw Error('Source changed before role experiment');
      const t=performance.now();
      const evidence=await reader.read(bytes);
      if(sha(fs.readFileSync(inputPath))!==photo.sha256)throw Error('Source changed during role experiment');
      const row={date:day.date,sha256:photo.sha256,sourceUnchanged:true,
        referenceLabel:photo.referenceLabel,seconds:(performance.now()-t)/1000,...evidence};
      rows.push(row);
      fs.writeFileSync(path.join(dir,day.date+'-'+photo.sha256+'.json'),JSON.stringify(row));
      fs.writeFileSync(path.join(dir,'progress.json'),JSON.stringify({date:day.date,photos:rows.length,
        total:selected.reduce((n,d)=>n+d.photos.length,0),updatedAt:new Date().toISOString()}));
    }
  }
  for(const [file,hash] of sourceFiles)if(sha(fs.readFileSync(path.join(scriptDir,file)))!==hash)throw Error('Experiment source changed');
  const summary={schemaVersion:1,fingerprint,completedAt:new Date().toISOString(),photos:rows.length,
    dates,sourceUnchanged:rows.every(r=>r.sourceUnchanged),seconds:(performance.now()-start)/1000,
    candidates:Object.fromEntries(['paper','lamp','water','other',null].map(role=>[role??'view-disagreement',rows.filter(r=>r.candidate===role).length])),
    referenceMatrix:rows.reduce((m,r)=>{const key=r.referenceLabel+' -> '+(r.candidate??'view-disagreement');m[key]=(m[key]||0)+1;return m;},{}),
    semanticVerified:false,bindingVerified:false,automaticAssignments:0,productionWrites:0,
    note:'Same-top across two views is diagnostic, not calibrated correctness. Historical labels are not independent ground truth. Fixed prompts; no training, filename evidence or answer-dependent tuning.'};
  fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({directory:path.basename(dir),...summary}));
} finally {await reader.release();}
