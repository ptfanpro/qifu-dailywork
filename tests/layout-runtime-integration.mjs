// Explicit actual asset test. Uses only generated pictures in a private TEMP
// snapshot. Passing is not another-PC or business photo acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {stageLayoutRuntime} from '../tools/stage-layout-runtime.mjs';
import {smokeLayoutRuntime,matchPrintedLayouts,isFreshLayoutObservation} from '../src/layout-runtime.mjs';
import {verifyRuntimeTree} from '../src/layout-runtime-assets.mjs';
import {LAYOUT_RUNTIME_MANIFEST_SHA256} from '../src/layout-runtime-lock.mjs';
import {collectPositionedLayouts,positionedLayoutEvidence} from '../src/positioned-layout-collector.mjs';
import {visualBodyViewNames} from '../src/pdf-visual-body-evidence.mjs';
import crypto from 'node:crypto';
const sharp=createRequire(import.meta.url)('sharp');
const source=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const bundle=process.argv[2];if(!bundle||!path.isAbsolute(bundle))throw Error('Explicit reviewed runtime bundle required');
const run=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-layout-portability-'));
let app=path.join(run,'application');fs.mkdirSync(app);fs.mkdirSync(path.join(app,'src'));
fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'prayer-local-runner-v9',version:'9.6.8-rc.2'}));
for(const file of ['layout_runtime_worker.py','printed_layout_geometry.py','layout-runtime-lock.mjs','layout-runtime.mjs','layout-runtime-assets.mjs'])
 fs.copyFileSync(path.join(source,'src',file),path.join(app,'src',file));
const started=performance.now(),counts={smoke:0,geometry:0,positionedGeometry:0,rejected:0};
console.log('Staging pinned layout runtime into a temporary app snapshot');
const staged=stageLayoutRuntime(bundle,app);assert.equal(staged.created,true);
assert.equal(stageLayoutRuntime(bundle,app).created,false);
const first=await smokeLayoutRuntime(app);assert.equal(first.geometryComputed,true);counts.smoke++;
assert.equal(isFreshLayoutObservation(first),true);assert.equal(isFreshLayoutObservation(structuredClone(first)),false);
first.geometryComputed=false;assert.equal(isFreshLayoutObservation(first),false);
const moved=path.join(run,'relocated with spaces 和中文');
assert.equal(path.dirname(path.resolve(app)),path.resolve(run));assert.equal(path.dirname(path.resolve(moved)),path.resolve(run));
fs.renameSync(app,moved);app=moved;
const poison=path.join(run,'external-python');fs.mkdirSync(poison);
for(const name of ['sitecustomize.py','cv2.py','numpy.py'])fs.writeFileSync(path.join(poison,name),"raise RuntimeError('external import must not execute')\n");
const previous={PYTHONPATH:process.env.PYTHONPATH,PYTHONHOME:process.env.PYTHONHOME};
try{
 process.env.PYTHONPATH=poison;process.env.PYTHONHOME=poison;
 const second=await smokeLayoutRuntime(app);assert.equal(second.runtime.localImports,true);counts.smoke++;
}finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
console.log('Relocated runtime passed actual computation with poisoned host Python settings');
const width=600,height=400,pixels=Buffer.alloc(width*height,240);let seed=713;
const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
for(let i=0;i<350;i++){
 const x=12+rand(576),y=12+rand(376),r=2+rand(5);
 for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(dx*dx+dy*dy<=r*r)pixels[(y+dy)*width+x+dx]=20;
}
const page=await sharp(pixels,{raw:{width,height,channels:1}}).png().toBuffer();
const photoPixels=Buffer.alloc(800*600,240);
for(let y=0;y<height;y++)pixels.copy(photoPixels,(y+100)*800+100,y*width,(y+1)*width);
const photo=await sharp(photoPixels,{raw:{width:800,height:600,channels:1}}).png().toBuffer();
const result=await matchPrintedLayouts(app,{pages:[{id:'a'.repeat(64)+':1',bytes:page}],photos:[{id:'b'.repeat(64),bytes:photo}]});
assert.equal(result.results[0].pages[0].evidence.candidate,true);assert.equal(isFreshLayoutObservation(result),true);counts.geometry++;
assert.equal(result.mayAssignNumber,false);assert.equal(result.results[0].pages[0].evidence.bindingVerified,false);
const blankViews=(width,height)=>visualBodyViewNames.map(view=>({view,text:'',errors:0,truncated:false,lineCount:0,regions:0,
 positioned:{schemaVersion:1,dimensions:{width,height},fields:[]}}));
const photoHash=crypto.createHash('sha256').update(photo).digest('hex');
const positioned=await collectPositionedLayouts({appRoot:app,pages:[{id:'a'.repeat(64)+':1',source:page,views:blankViews(600,400)}],
 photos:[{id:photoHash,source:photo,views:blankViews(800,600)}]});
assert.equal(positioned.comparisons,1);assert.equal(positioned.geometryCandidates,1);assert.equal(positioned.mayAssignNumber,false);
assert.equal(positionedLayoutEvidence(positioned).results[0].pages.length,1);
positionedLayoutEvidence(positioned).results.length=0;
assert.equal(positionedLayoutEvidence(positioned).results.length,1,'returned evidence does not mutate retained observation');
assert.equal(positionedLayoutEvidence(structuredClone(positioned)),null,'JSON/clone is not live evidence');
positioned.photos[0].sourceSha256='f'.repeat(64);
assert.equal(positionedLayoutEvidence(positioned),null,'changed report revokes retained observation');counts.positionedGeometry++;
for(const relative of ['runtime/layout-python-v1/python312._pth','runtime/layout-python-v1/python.exe','src/layout_runtime_worker.py']){
 const file=path.join(app,relative),bytes=fs.readFileSync(file);
 try{fs.appendFileSync(file,'changed');await assert.rejects(smokeLayoutRuntime(app),/integrity|size/i);counts.rejected++;}
 finally{fs.writeFileSync(file,bytes);}
}
const extra=path.join(app,'runtime/layout-python-v1/sitecustomize.py');fs.writeFileSync(extra,'unexpected');
try{await assert.rejects(smokeLayoutRuntime(app),/contents/i);counts.rejected++;}finally{fs.unlinkSync(extra);}
await assert.rejects(smokeLayoutRuntime(app,{timeoutMs:1}),/timed out|failed/i);counts.rejected++;
const corrupt=Buffer.from(page);corrupt.fill(0,40);
await assert.rejects(matchPrintedLayouts(app,{pages:[{id:'a'.repeat(64)+':1',bytes:corrupt}],photos:[{id:'b'.repeat(64),bytes:photo}]}),/failed/i);counts.rejected++;
verifyRuntimeTree(path.join(app,'runtime/layout-python-v1'),LAYOUT_RUNTIME_MANIFEST_SHA256);
const report={passed:true,counts,fileCount:staged.fileCount,sizeBytes:staged.sizeBytes,seconds:(performance.now()-started)/1000,
 otherComputerVerified:false,businessAcceptance:false,app,run};
fs.writeFileSync(path.join(run,'results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
