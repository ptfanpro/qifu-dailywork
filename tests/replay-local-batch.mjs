// Existing algorithm, original local files, no renaming/upload/status actions.
// Keep detailed evidence exclusively in a temporary machine-local directory.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {planPhotoPreparation} from '../src/photo-prepare.mjs';
const [folder,photoDir,date]=process.argv.slice(2);
if(!folder||!photoDir||!/^\d{4}-\d\d-\d\d$/.test(date||'')) throw new Error('folder photoDir YYYY-MM-DD required');
const workDir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-readonly-replay-'));
const files=fs.readdirSync(photoDir).filter(n=>/\.jpe?g$/i.test(n)).map(n=>path.join(photoDir,n));
const digest=()=>crypto.createHash('sha256').update(files.map(f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')).sort().join('\n')).digest('hex');
const before=digest(), started=Date.now();
let steps=0;
const [year,month]=date.split('-').map(Number);
const plan=await planPhotoPreparation({appRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),folder,photoDir,date,expectedPrefix:`${String(year).slice(-2)}${month}`,workDir,onProgress:()=>{if(++steps%5===0) console.log(JSON.stringify({stage:'offline-recognition',steps,elapsedSeconds:Math.round((Date.now()-started)/1000)}));}});
const summary={businessDate:date,ready:plan.ready,photos:files.length,pdfPages:plan.pdfPages.length,blessing:plan.assignments.filter(x=>x.kind==='blessing').length,lampScenes:plan.assignments.filter(x=>x.kind==='scene-lamp').length,waterScenes:plan.assignments.filter(x=>x.kind==='scene-water').length,duplicates:plan.duplicateSources.length,missing:plan.missingExpected.length,issues:plan.issues.length,sourceUnchanged:before===digest(),seconds:Math.round((Date.now()-started)/1000)};
fs.writeFileSync(path.join(workDir,'plan.json'),JSON.stringify(plan));
fs.writeFileSync(path.join(workDir,'summary.json'),JSON.stringify(summary));
console.log(JSON.stringify(summary));
console.log(`Private evidence: ${workDir}`);
if(!summary.ready || !summary.sourceUnchanged) process.exitCode=1;
