// Real CLI resume tests. Only tiny synthetic byte files, never business data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {recognitionSourceFingerprint} from '../src/recognition-provenance.mjs';
import {assertReusableAuditReport,sealAuditReport} from './audit-replay-cache.mjs';
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

function withFixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-replay-resume-test-'));
  try {
    const folder=path.join(root,'business','1月2日'),photoDir=path.join(folder,'1'),audit=path.join(root,'audit');
    fs.mkdirSync(photoDir,{recursive:true});fs.mkdirSync(audit);
    const photo=path.join(photoDir,'sample.jpg'),pdf=path.join(folder,'sample.pdf');
    fs.writeFileSync(photo,'synthetic-photo');fs.writeFileSync(pdf,'synthetic-pdf');
    const describe=file=>({file,size:fs.statSync(file).size,sha256:hash(fs.readFileSync(file))});
    const day={date:'2026-01-02',folder,photoDir,pdfs:[describe(pdf)],photos:[{...describe(photo),referenceLabel:'unlabelled',referenceNumber:null}]};
    fs.writeFileSync(path.join(audit,'inventory.json'),JSON.stringify({days:[day]}));
    const sourceHash=recognitionSourceFingerprint(appRoot),dir=path.join(audit,'replay-'+sourceHash.slice(0,12),day.date);
    fs.mkdirSync(dir,{recursive:true});
    const reportFile=path.join(dir,'report.json');
    fs.writeFileSync(reportFile,JSON.stringify({sourceHash,date:day.date,photos:1,assignments:1,unresolved:0,sourceUnchanged:true}));
    const originalReport=fs.readFileSync(reportFile);
    const execute=()=>spawnSync(process.execPath,[path.join(appRoot,'tests/annual-replay.mjs'),'replay',path.dirname(folder),audit,day.date],
      {windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
    run({root,photo,pdf,day,audit,dir,reportFile,originalReport,execute});
  } finally {
    assert.equal(path.dirname(fs.realpathSync(root)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(root).startsWith('qifu-replay-resume-test-'));fs.rmSync(root,{recursive:true,force:true});
  }
}

for(const kind of ['photo','pdf'])test(`annual replay cannot reuse a green report after the original ${kind} changes`,()=>withFixture(f=>{
  fs.writeFileSync(f[kind],'changed-synthetic-bytes');
  const result=f.execute();assert.equal(result.error,undefined);assert.notEqual(result.status,0,'old cached report must not hide changed inputs');
  assert.match(result.stderr,/Source changed since inventory/);
  assert.deepEqual(fs.readFileSync(f.reportFile),f.originalReport,'old report is evidence and must not be overwritten');
  assert.equal(fs.existsSync(path.join(f.dir,'input')),false,'stop before copying or OCR');
}));

test('annual replay rejects an old report without verified plan and inventory binding',()=>withFixture(f=>{
  const result=f.execute();assert.equal(result.error,undefined);assert.notEqual(result.status,0,'sourceHash alone does not prove reusable evidence');
  assert.match(result.stderr,/Cached audit report/);
  assert.deepEqual(fs.readFileSync(f.reportFile),f.originalReport);
  assert.equal(fs.existsSync(path.join(f.dir,'input')),false);
}));

test('annual replay does not silently succeed for an explicit date absent from its inventory',()=>withFixture(f=>{
  fs.writeFileSync(path.join(f.audit,'inventory.json'),JSON.stringify({days:[]}));
  const result=f.execute();assert.equal(result.error,undefined);assert.notEqual(result.status,0);
  assert.match(result.stderr,/Requested audit date is absent/);
}));

function sealFixture(f) {
  const input=path.join(f.dir,'input'),copies=path.join(input,'1');fs.mkdirSync(copies,{recursive:true});
  const photo=f.day.photos[0],blindName=`audit_${photo.sha256}_0.jpg`;
  fs.copyFileSync(f.photo,path.join(copies,blindName));fs.copyFileSync(f.pdf,path.join(input,path.basename(f.pdf)));
  fs.writeFileSync(path.join(f.dir,'private-plan.json'),JSON.stringify({ready:false,assignments:[]}));
  fs.writeFileSync(path.join(f.dir,'private-source-map.json'),JSON.stringify([{...photo,blindName}]));
  const report={sourceHash:recognitionSourceFingerprint(appRoot),date:f.day.date,photos:1,assignments:0,unresolved:1,ready:false,sourceUnchanged:true};
  fs.writeFileSync(f.reportFile,JSON.stringify(sealAuditReport(report,{day:f.day,action:'replay',appRoot,dir:f.dir})));
}

function createExternalBlindInput(f) {
  const round=path.join(f.root,'replay-old-frozen'),inputDir=path.join(round,f.day.date,'input'),photos=path.join(inputDir,'1');
  fs.mkdirSync(photos,{recursive:true});
  const photo=f.day.photos[0],blindName=`audit_${photo.sha256}_0.jpg`;
  fs.copyFileSync(f.photo,path.join(photos,blindName));
  fs.copyFileSync(f.pdf,path.join(inputDir,path.basename(f.pdf)));
  return {round,inputDir,blindName};
}

test('annual replay reuses intact evidence without rerunning OCR or rewriting a report, preserving unresolved status',()=>withFixture(f=>{
  sealFixture(f);const before=fs.readFileSync(f.reportFile),modified=fs.statSync(f.reportFile,{bigint:true}).mtimeNs;
  const result=f.execute();assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/verified-cache-reuse/);assert.deepEqual(fs.readFileSync(f.reportFile),before);
  assert.equal(fs.statSync(f.reportFile,{bigint:true}).mtimeNs,modified);
  assert.equal(JSON.parse(before).unresolved,1);assert.equal(JSON.parse(before).ready,false);
}));

for(const kind of ['plan','mapping','photo-copy','pdf-copy','summary','inventory-reference'])test(`annual replay rejects changed cached ${kind}`,()=>withFixture(f=>{
  sealFixture(f);
  if(kind==='plan'||kind==='mapping')fs.writeFileSync(path.join(f.dir,kind==='plan'?'private-plan.json':'private-source-map.json'),'{}');
  if(kind==='photo-copy')fs.writeFileSync(path.join(f.dir,'input/1',fs.readdirSync(path.join(f.dir,'input/1'))[0]),'changed');
  if(kind==='pdf-copy')fs.writeFileSync(path.join(f.dir,'input',path.basename(f.pdf)),'changed');
  if(kind==='summary'){const report=JSON.parse(fs.readFileSync(f.reportFile));report.unresolved=0;fs.writeFileSync(f.reportFile,JSON.stringify(report));}
  if(kind==='inventory-reference'){f.day.photos[0].referenceLabel='scene-lamp';fs.writeFileSync(path.join(f.audit,'inventory.json'),JSON.stringify({days:[f.day]}));}
  const before=fs.readFileSync(f.reportFile),result=f.execute();assert.equal(result.error,undefined);assert.notEqual(result.status,0);
  assert.match(result.stderr,/Cached audit report/);assert.deepEqual(fs.readFileSync(f.reportFile),before);
}));

test('missing source material returns failure rather than a successful empty replay',()=>withFixture(f=>{
  fs.unlinkSync(f.reportFile);f.day.pdfs=[];fs.writeFileSync(path.join(f.audit,'inventory.json'),JSON.stringify({days:[f.day]}));
  const result=f.execute();assert.equal(result.error,undefined);assert.notEqual(result.status,0);
  const report=JSON.parse(fs.readFileSync(f.reportFile));assert.equal(report.status,'missing-source-material');assert.equal(report.cacheBinding,undefined);
}));

test('a planner exception returns a failing CLI exit code, never cached completion',()=>withFixture(f=>{
  fs.unlinkSync(f.reportFile);
  // Explicit test guard prevents starting Windows OCR or any external process.
  const guard=path.join(f.root,'deny-child.mjs');
  fs.writeFileSync(guard,"import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';for(const n of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[n]=()=>{throw Error('synthetic-no-child-test');};syncBuiltinESMExports();");
  const result=spawnSync(process.execPath,['--import',pathToFileURL(guard).href,path.join(appRoot,'tests/annual-replay.mjs'),'replay',path.dirname(f.day.folder),f.audit,f.day.date],
    {windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
  assert.equal(result.error,undefined);assert.notEqual(result.status,0);
  assert(fs.existsSync(f.reportFile),result.stderr);
  const report=JSON.parse(fs.readFileSync(f.reportFile));assert.equal(report.error,'photo-plan-failed');assert.equal(report.cacheBinding,undefined);
}));

test('annual replay can read an exact prior blind input without copying it into the new round',()=>withFixture(f=>{
  fs.unlinkSync(f.reportFile);const reused=createExternalBlindInput(f);
  const beforePhoto=fs.readFileSync(path.join(reused.inputDir,'1',reused.blindName));
  const beforePdf=fs.readFileSync(path.join(reused.inputDir,path.basename(f.pdf)));
  const guard=path.join(f.root,'deny-reused-child.mjs');
  fs.writeFileSync(guard,"import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';for(const n of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[n]=()=>{throw Error('synthetic-no-child-test');};syncBuiltinESMExports();");
  const result=spawnSync(process.execPath,['--import',pathToFileURL(guard).href,path.join(appRoot,'tests/annual-replay.mjs'),'replay',path.dirname(f.day.folder),f.audit,
    '--reuse-blind-input',reused.round,f.day.date],{windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
  assert.equal(result.error,undefined);assert.notEqual(result.status,0);
  assert.match(result.stdout,/photo-plan-failed/);assert.equal(fs.existsSync(path.join(f.dir,'input')),false);
  assert.deepEqual(fs.readFileSync(path.join(reused.inputDir,'1',reused.blindName)),beforePhoto);
  assert.deepEqual(fs.readFileSync(path.join(reused.inputDir,path.basename(f.pdf))),beforePdf);
}));

test('external blind input remains part of the sealed cache identity and is rechecked',()=>withFixture(f=>{
  const reused=createExternalBlindInput(f),photo=f.day.photos[0];
  fs.writeFileSync(path.join(f.dir,'private-plan.json'),JSON.stringify({ready:false,assignments:[]}));
  fs.writeFileSync(path.join(f.dir,'private-source-map.json'),JSON.stringify([{...photo,blindName:reused.blindName}]));
  const sourceHash=recognitionSourceFingerprint(appRoot);
  const report={sourceHash,date:f.day.date,photos:1,assignments:0,unresolved:1,ready:false,sourceUnchanged:true};
  const sealed=sealAuditReport(report,{day:f.day,action:'replay',appRoot,dir:f.dir,inputDir:reused.inputDir});
  assert.equal(sealed.cacheBinding.schemaVersion,2);
  assert.equal(assertReusableAuditReport(sealed,{day:f.day,action:'replay',appRoot,dir:f.dir,sourceHash,inputDir:reused.inputDir}),true);
  fs.writeFileSync(path.join(reused.inputDir,'1',reused.blindName),'changed');
  assert.throws(()=>assertReusableAuditReport(sealed,{day:f.day,action:'replay',appRoot,dir:f.dir,sourceHash,inputDir:reused.inputDir}),/Cached audit report/);
}));

test('annual replay rejects an incomplete or extra prior blind input before OCR',()=>withFixture(f=>{
  fs.unlinkSync(f.reportFile);const reused=createExternalBlindInput(f);
  fs.writeFileSync(path.join(reused.inputDir,'1','extra.jpg'),'extra');
  const result=spawnSync(process.execPath,[path.join(appRoot,'tests/annual-replay.mjs'),'replay',path.dirname(f.day.folder),f.audit,
    '--reuse-blind-input',reused.round,f.day.date],{windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
  assert.equal(result.error,undefined);assert.notEqual(result.status,0);
  assert.match(result.stderr,/does not exactly match inventory/);assert.equal(fs.existsSync(path.join(f.dir,'input')),false);
}));
