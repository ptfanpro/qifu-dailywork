// Explicit local diagnostic only. All images in explicit dates and ALL region
// proposals. No answer labels reach geometry, crop selection or the role model.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {requirePrivateAuditRoot} from '../audit-paths.mjs';
import {createClipRoleReader} from './clip-role-reader.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
const [rootArg,python,cvDependencies,modelDir,appRoot,...dates]=process.argv.slice(2);
if(!rootArg||!python||!cvDependencies||!modelDir||!appRoot||!dates.length
  ||new Set(dates).size!==dates.length||dates.some(d=>!/^2026-\d\d-\d\d$/.test(d)))
  throw Error('PRIVATE_ROOT PYTHON ISOLATED_CV_DIR MODEL_DIR FROZEN_RUNTIME YYYY-MM-DD [...]');
const root=requirePrivateAuditRoot(rootArg),scriptDir=path.dirname(fileURLToPath(import.meta.url));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const inventory=JSON.parse(fs.readFileSync(path.join(root,'inventory.json')));
const days=dates.map(date=>{
  const selected=inventory.days.filter(d=>d.date===date);
  if(selected.length!==1||!selected[0].photos.length)throw Error('Missing explicit source date');
  return selected[0];
});
const sourceFiles=['paper-region-replay.mjs','paper-region-worker.py','paper-region-geometry.py','clip-role-reader.mjs']
  .map(f=>[f,sha(fs.readFileSync(path.join(scriptDir,f)))]);
const cvPackage=path.join(cvDependencies,'cv2'),cvBinary=fs.readdirSync(cvPackage).filter(f=>/^cv2.*\.pyd$/.test(f));
if(cvBinary.length!==1)throw Error('Missing explicit isolated OpenCV runtime');
const runtimeFiles=[path.join(cvPackage,cvBinary[0]),path.join(appRoot,'vendor/onnxruntime-node/package.json')]
  .map(f=>[path.basename(f),sha(fs.readFileSync(f))]);
const dir=fs.mkdtempSync(path.join(root,'paper-region-replay-'));
const started=performance.now(),reader=await createClipRoleReader(appRoot,modelDir),rows=[];
const fingerprint=sha(JSON.stringify({sourceFiles,runtimeFiles,role:reader.identity,cropMaxSide:512}));
fs.writeFileSync(path.join(dir,'version.json'),JSON.stringify({schemaVersion:1,fingerprint,sourceFiles,runtimeFiles,
  role:reader.identity,dates,cropMaxSide:512,startedAt:new Date().toISOString(),frozenBeforeFirstRealPhoto:true},null,2));
const worker=spawn(python,['-B',path.join(scriptDir,'paper-region-worker.py')],{
  windowsHide:true,env:{...process.env,PYTHONPATH:cvDependencies},stdio:['pipe','pipe','pipe'],
});
let pending=null,exitCode=null,workerError=false;
worker.stderr.on('data',()=>{workerError=true;});
worker.on('error',()=>{pending?.reject(Error('Geometry worker failed'));pending=null;});
worker.on('exit',code=>{exitCode=code;pending?.reject(Error('Geometry worker exited'));pending=null;});
const lines=readline.createInterface({input:worker.stdout});
lines.on('line',line=>{
  if(!pending)return;
  const request=pending;pending=null;
  try {const row=JSON.parse(line);if(row.id!==request.id)throw Error('Worker identity mismatch');request.resolve(row);}
  catch {request.reject(Error('Invalid geometry response'));}
});
const measure=(id,bytes)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{if(pending?.id===id){pending=null;worker.kill();reject(Error('Geometry worker timed out'));}},60000);
  pending={id,resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}};
  worker.stdin.write(JSON.stringify({id,pngBase64:bytes.toString('base64')})+'\n');
});
try {
  for(const day of days)for(const photo of day.photos){
    const real=fs.realpathSync(photo.file);
    if(path.dirname(real).toLowerCase()!==fs.realpathSync(path.dirname(photo.file)).toLowerCase())throw Error('Source outside date folder');
    const bytes=fs.readFileSync(real);
    if(sha(bytes)!==photo.sha256)throw Error('Source changed before region diagnostic');
    const normalized=await sharp(bytes).rotate().flatten({background:'white'}).toColourspace('srgb').removeAlpha().png().toBuffer();
    const t=performance.now(),geometry=await measure(rows.length,normalized);
    if(workerError)throw Error('Geometry worker stderr requires inspection');
    const candidates=[];
    for(const [i,proposal] of (geometry.candidates??[]).entries()){
      const {pngBase64,...region}=proposal,crop=Buffer.from(pngBase64,'base64');
      const evidence=await reader.read(crop);
      candidates.push({...region,index:i,cropSha256:sha(crop),role:evidence});
      fs.writeFileSync(path.join(dir,`${day.date}-${photo.sha256}-region-${i}.png`),crop);
    }
    delete geometry.candidates;delete geometry.id;
    if(sha(fs.readFileSync(real))!==photo.sha256)throw Error('Source changed during region diagnostic');
    const row={date:day.date,sha256:photo.sha256,referenceLabel:photo.referenceLabel,sourceUnchanged:true,
      seconds:(performance.now()-t)/1000,geometry,candidates,
      paperCandidateCount:candidates.filter(r=>r.role.candidate==='paper').length,
      paperVerified:false,foregroundVerified:false,bindingVerified:false,mayClearCodeConflict:false,
      mayAssignNumber:false,mayUploadScene:false};
    rows.push(row);
    fs.writeFileSync(path.join(dir,`${day.date}-${photo.sha256}.json`),JSON.stringify(row));
    fs.writeFileSync(path.join(dir,'progress.json'),JSON.stringify({photos:rows.length,date:day.date,
      total:days.reduce((n,d)=>n+d.photos.length,0),regions:rows.reduce((n,r)=>n+r.candidates.length,0),updatedAt:new Date().toISOString()}));
  }
  for(const [f,h] of sourceFiles)if(sha(fs.readFileSync(path.join(scriptDir,f)))!==h)throw Error('Experiment source changed');
  const summary={schemaVersion:1,fingerprint,dates,photos:rows.length,sourceUnchanged:rows.every(r=>r.sourceUnchanged),
    errors:rows.filter(r=>r.geometry.errorCode).length,regions:rows.reduce((n,r)=>n+r.candidates.length,0),
    photosWithRegions:rows.filter(r=>r.candidates.length).length,photosWithPaperCandidates:rows.filter(r=>r.paperCandidateCount).length,
    referenceMatrix:rows.reduce((m,r)=>{const k=r.referenceLabel+' -> '+(r.geometry.errorCode?'error':r.paperCandidateCount?'paper-candidate':r.candidates.length?'no-paper-candidate':'no-region');m[k]=(m[k]||0)+1;return m;},{}),
    seconds:(performance.now()-started)/1000,automaticAssignments:0,productionWrites:0,completedAt:new Date().toISOString(),
    note:'Whole geometric regions are proposals, not foreground or paper proof. Same-top CLIP views are not calibrated truth. Historical labels do not enter inference. No OCR or order binding.'};
  fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({directory:path.basename(dir),...summary}));
  if(summary.errors)process.exitCode=1;
} catch(error) {
  fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify({schemaVersion:1,fingerprint,
    completedPhotos:rows.length,plannedPhotos:days.reduce((n,d)=>n+d.photos.length,0),
    failedAt:new Date().toISOString(),errorCode:'REGION_REPLAY_FAILED',
    measuredRowSeconds:rows.reduce((n,r)=>n+r.seconds,0),
    note:'Partial evidence retained; not completed date coverage or acceptance.'},null,2));
  throw error;
} finally {worker.stdin.end();lines.close();if(exitCode===null)worker.kill();await reader.release();}
