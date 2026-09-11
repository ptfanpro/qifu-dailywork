// Experimental page-location proposals only. Entire explicit dates/all PDF
// pages. Historical reference labels never reach the matching worker.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {requirePrivateAuditRoot} from '../audit-paths.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp'),{createCanvas}=require('@napi-rs/canvas');
const [rootArg,python,cvDependencies,...tail]=process.argv.slice(2);
const coordinateFrame=tail[0]==='--printed-ink'?'printed-ink':'canvas';
const dates=coordinateFrame==='printed-ink'?tail.slice(1):tail;
if(!rootArg||!python||!cvDependencies||!dates.length||new Set(dates).size!==dates.length||dates.some(d=>!/^2026-\d\d-\d\d$/.test(d)))
  throw Error('PRIVATE_ROOT PYTHON ISOLATED_CV_DIR YYYY-MM-DD [...]');
const root=requirePrivateAuditRoot(rootArg),scriptDir=path.dirname(fileURLToPath(import.meta.url));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const inventory=JSON.parse(fs.readFileSync(path.join(root,'inventory.json')));
const days=dates.map(date=>{
  const found=inventory.days.filter(d=>d.date===date);
  if(found.length!==1||!found[0].photos.length||!found[0].pdfs.length)throw Error('Missing explicit source date');
  return found[0];
});
const files=['printed-layout-replay.mjs','printed-layout-worker.py','printed-layout-regions.py'];
// Freeze the actual implementation, not the compatibility import which would
// resolve outside the snapshot and omit future geometry changes from its hash.
const sourceFile=f=>f==='printed-layout-regions.py'
  ?path.resolve(scriptDir,'../../src/printed_layout_geometry.py'):path.join(scriptDir,f);
const sourceFiles=files.map(f=>[f,sha(fs.readFileSync(sourceFile(f)))]);
const cvPackage=path.join(cvDependencies,'cv2'),cvBinary=fs.readdirSync(cvPackage).filter(f=>/^cv2.*\.pyd$/.test(f));
if(cvBinary.length!==1)throw Error('Isolated OpenCV binary required');
const runtimeFiles=[path.join(cvPackage,cvBinary[0]),require.resolve('sharp'),require.resolve('pdfjs-dist/package.json')]
  .map(f=>[path.basename(f),sha(fs.readFileSync(f))]);
const fingerprint=sha(JSON.stringify({sourceFiles,runtimeFiles,sharpVersions:sharp.versions,coordinateFrame}));
const out=fs.mkdtempSync(path.join(root,'printed-layout-replay-')),scripts=path.join(out,'scripts');
fs.mkdirSync(scripts);
for(const f of files)fs.copyFileSync(sourceFile(f),path.join(scripts,f));
fs.writeFileSync(path.join(out,'version.json'),JSON.stringify({fingerprint,sourceFiles,runtimeFiles,sharpVersions:sharp.versions,dates,coordinateFrame,
  startedAt:new Date().toISOString(),frozenBeforeFirstRealPhoto:true},null,2));
const checked=record=>{
  const real=fs.realpathSync(record.file);
  if(path.dirname(real).toLowerCase()!==fs.realpathSync(path.dirname(record.file)).toLowerCase())throw Error('Source outside date folder');
  const bytes=fs.readFileSync(real);if(sha(bytes)!==record.sha256)throw Error('Inventoried source changed');return bytes;
};
const manifest={days:[]},rows=[],started=performance.now();
try {
  const pdfjs=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const standardFontDataUrl=path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts').replaceAll('\\','/')+'/';
  for(const day of days){
    const derived={date:day.date,pages:[],photos:[]};
    for(const pdf of day.pdfs){
      const document=await pdfjs.getDocument({data:new Uint8Array(checked(pdf)),disableWorker:true,standardFontDataUrl,useSystemFonts:false}).promise;
      try {for(let number=1;number<=document.numPages;number++){
        const page=await document.getPage(number),base=page.getViewport({scale:1});
        const viewport=page.getViewport({scale:1800/Math.max(base.width,base.height)});
        const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        const bytes=canvas.toBuffer('image/png'),png=`${pdf.sha256}-${number}.png`;
        fs.writeFileSync(path.join(out,png),bytes);
        derived.pages.push({pdfSha256:pdf.sha256,pageNumber:number,png,pngSha256:sha(bytes)});
      }} finally {await document.destroy();}
      checked(pdf);
    }
    for(const photo of day.photos){
      const bytes=await sharp(checked(photo)).rotate().flatten({background:'white'}).greyscale()
        .resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).png().toBuffer();
      const png=`${day.date}-${photo.sha256}.png`;fs.writeFileSync(path.join(out,png),bytes);
      derived.photos.push({sha256:photo.sha256,png,pngSha256:sha(bytes)});checked(photo);
    }
    manifest.days.push(derived);
  }
  fs.writeFileSync(path.join(out,'input.json'),JSON.stringify(manifest));
  const worker=spawn(python,['-B',path.join(scripts,'printed-layout-worker.py'),out,coordinateFrame],
    {windowsHide:true,env:{...process.env,PYTHONPATH:cvDependencies},stdio:['ignore','pipe','pipe']});
  let stderr=false,completed=null,protocolError=false;
  worker.stderr.on('data',()=>{stderr=true;});
  const exited=new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('close',resolve);});
  const reader=readline.createInterface({input:worker.stdout});
  try {for await(const line of reader){
    const row=JSON.parse(line);
    if(!row.complete)throw Error('Layout worker returned failure');
    if(row.kind==='worker-complete'){if(completed)throw Error('Duplicate completion');completed=row;continue;}
    const inputDay=manifest.days.find(d=>d.date===row.date),day=days.find(d=>d.date===row.date);
    const photo=day?.photos.find(p=>p.sha256===row.photoSha256);
    const expected=inputDay?.pages.map(p=>`${p.pdfSha256}:${p.pageNumber}`).sort();
    if(!photo||JSON.stringify(expected)!==JSON.stringify(row.pages.map(p=>`${p.pdfSha256}:${p.pageNumber}`).sort())
       ||rows.some(r=>r.date===row.date&&r.photoSha256===row.photoSha256)||row.mayAssignNumber||row.bindingVerified
       ||row.mayClearCodeConflict||row.mayUploadScene
       ||row.pages.some(p=>p.coordinateFrame!==coordinateFrame||p.paperVerified||p.foregroundVerified
         ||p.physicalCodeExtentVerified||p.bindingVerified||p.mayAssignNumber||p.mayClearCodeConflict||p.mayUploadScene
         ||p.localSupport?.completePageVerified||p.localSupport?.physicalCodeExtentVerified))throw Error('Invalid worker identities or authority');
    checked(photo);row.sourceUnchanged=true;row.referenceLabel=photo.referenceLabel;
    rows.push(row);fs.writeFileSync(path.join(out,`${row.date}-${row.photoSha256}.json`),JSON.stringify(row));
    const progress={photos:rows.length,total:days.reduce((n,d)=>n+d.photos.length,0),date:row.date,
      candidates:rows.reduce((n,r)=>n+r.candidates,0),updatedAt:new Date().toISOString()};
    fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify(progress));
    console.log(JSON.stringify(progress));
  }} catch(error){protocolError=true;worker.kill();throw error;}
  finally {reader.close();if(protocolError)await exited;}
  const exitCode=await exited;
  if(exitCode!==0||stderr||!completed||completed.coordinateFrame!==coordinateFrame
    ||rows.length!==days.reduce((n,d)=>n+d.photos.length,0))throw Error('Incomplete layout diagnostic');
  for(const day of days)for(const item of [...day.photos,...day.pdfs])checked(item);
  for(const [file,hash] of sourceFiles)if(sha(fs.readFileSync(path.join(scripts,file)))!==hash)throw Error('Frozen script changed');
  const summary={fingerprint,coordinateFrame,dates,photos:rows.length,pages:manifest.days.reduce((n,d)=>n+d.pages.length,0),
    candidates:rows.reduce((n,r)=>n+r.candidates,0),photosWithCandidates:rows.filter(r=>r.candidates).length,
    sourceUnchanged:true,errors:0,seconds:(performance.now()-started)/1000,worker:completed,
    referenceMatrix:rows.reduce((m,r)=>{const key=r.referenceLabel+' -> '+(r.candidates?'layout-candidate':'none');m[key]=(m[key]||0)+1;return m;},{}),
    automaticAssignments:0,productionWrites:0,completedAt:new Date().toISOString(),
    note:'All pages compared for geometry only. Shared decoration is NOT page/order identity, physical code extent or foreground proof.'};
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({directory:path.basename(out),...summary}));
} catch(error){
  fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({fingerprint,completedPhotos:rows.length,errorType:error.name,
    errorCode:'LAYOUT_REPLAY_FAILED',seconds:(performance.now()-started)/1000,failedAt:new Date().toISOString()}));
  throw error;
}
