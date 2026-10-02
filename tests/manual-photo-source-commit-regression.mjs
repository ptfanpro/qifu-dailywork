import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import * as manual from '../src/manual-photo-workflow.mjs';
import {applyPhotoPreparation} from '../src/photo-prepare.mjs';

const sharp=createRequire(import.meta.url)('sharp');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-source-commit-'));
const holders=[];
async function hold(file,share='ReadWrite') {
  const script=`$f=[IO.File]::Open('${file.replaceAll("'","''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::${share}); [Console]::WriteLine('READY'); [Console]::Out.Flush(); [void][Console]::ReadLine(); $f.Dispose()`;
  const child=spawn('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  holders.push(child);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('file holder did not start')),15000);
    child.stdout.on('data',data=>{if(data.toString().includes('READY')){clearTimeout(timer);resolve();}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);if(code)reject(Error(`holder exited ${code}`));});
  });
  return child;
}
try {
  const sourceRoot=path.join(base,'source'),sourceDir=path.join(sourceRoot,'9月30日','1'),workDir=path.join(base,'state','photos');
  fs.mkdirSync(sourceDir,{recursive:true});
  const original=path.join(sourceDir,'472.jpg');
  await sharp({create:{width:4000,height:3000,channels:3,background:'#7a3040'}}).jpeg({quality:100}).toFile(original);
  const before=hash(original),mirror=manual.ensureManualPhotoMirror({root:sourceRoot,date:'2026-09-30',workDir});
  const mirrorDir=path.join(mirror.root,'9月30日','1');
  await applyPhotoPreparation(await manual.planManualNumberedPreparation({photoDir:mirrorDir,date:'2026-09-30'}),workDir);
  // Reproduce the former successful-preparation path: it returned with only
  // the local mirror compressed and left every original at camera dimensions.
  const commit=manual.commitManualPhotoSources;
  if(commit) await commit({mirror,date:'2026-09-30',workDir});
  const metadata=await sharp(fs.readFileSync(original)).metadata();
  assert.deepEqual([metadata.width,metadata.height],[1800,1350],'successful manual preparation must also normalize the original directory');
  assert.ok(fs.statSync(original).size<=1572864);
  const normalized=path.join(mirrorDir,'472.jpg'),normalizedHash=hash(normalized);
  assert.equal(hash(original),normalizedHash,'source and uploaded bytes must be identical');
  const reused=manual.ensureManualPhotoMirror({root:sourceRoot,date:'2026-09-30',workDir});
  assert.equal(reused.root,mirror.root,'source writeback must preserve existing mirror/upload hashes');
  const second=await commit({mirror:reused,date:'2026-09-30',workDir});
  assert.equal(second.processedCount,0,'restart must not re-encode normalized photos');
  assert.equal(hash(original),normalizedHash);
  assert.equal(hash(second.files[0].backup),before,'original camera bytes must have a verified recovery backup');

  if(process.platform==='win32') {
    const make=async(number)=>{
      const file=path.join(sourceDir,`${number}.jpg`);
      await sharp({create:{width:3200,height:2400,channels:3,background:'#223366'}}).jpeg().toFile(file);
      const snapshot=manual.ensureManualPhotoMirror({root:sourceRoot,date:'2026-09-30',workDir});
      await applyPhotoPreparation(await manual.planManualNumberedPreparation({photoDir:path.join(snapshot.root,'9月30日','1'),date:'2026-09-30'}),workDir);
      return {file,snapshot,before:hash(file)};
    };
    const allowed=await make(473),reader=await hold(allowed.file);
    assert.throws(()=>fs.renameSync(allowed.file,path.join(sourceDir,'moved.jpg')),error=>['EBUSY','EPERM','EACCES'].includes(error.code),'real Windows reader must block the old rename strategy');
    const result=await commit({mirror:allowed.snapshot,date:'2026-09-30',workDir});
    assert.equal(result.processedCount,1,'shared reader without delete sharing must allow an in-place save');
    assert.equal(hash(allowed.file),hash(path.join(allowed.snapshot.root,'9月30日','1','473.jpg')));
    reader.stdin.end('\n');

    const blocked=await make(474),blocker=await hold(blocked.file,'Read');
    const started=Date.now();
    await assert.rejects(()=>commit({mirror:blocked.snapshot,date:'2026-09-30',workDir,attempts:2,delayMs:25}),/占用|写入|locked/i);
    assert.ok(Date.now()-started<15000,'a true write lock must stop within a finite retry budget');
    assert.equal(hash(blocked.file),blocked.before,'write denial must not truncate or remove the original');
    blocker.stdin.end('\n');
    await new Promise(resolve=>blocker.once('exit',resolve));
    const recovered=await commit({mirror:blocked.snapshot,date:'2026-09-30',workDir});
    assert.equal(recovered.processedCount,1,'a released lock must resume with the same prepared bytes');

    const changed=await make(475);
    await sharp({create:{width:3200,height:2400,channels:3,background:'#eeeecc'}}).jpeg().toFile(changed.file);
    const changedHash=hash(changed.file);
    await assert.rejects(()=>commit({mirror:changed.snapshot,date:'2026-09-30',workDir}),/变化|来源/);
    assert.equal(hash(changed.file),changedHash,'a synchronization revision must never be overwritten with stale prepared bytes');

    const png=path.join(sourceDir,'476.png');
    await sharp({create:{width:3200,height:2400,channels:3,background:'#663355'}}).png().toFile(png);
    const converted=manual.ensureManualPhotoMirror({root:sourceRoot,date:'2026-09-30',workDir});
    await applyPhotoPreparation(await manual.planManualNumberedPreparation({photoDir:path.join(converted.root,'9月30日','1'),date:'2026-09-30'}),workDir);
    const conversion=await commit({mirror:converted,date:'2026-09-30',workDir});
    assert.equal(fs.existsSync(png),false,'PNG extension conversion must remain supported');
    assert.equal(hash(path.join(sourceDir,'476.jpg')),hash(path.join(converted.root,'9月30日','1','476.jpg')));
    assert.equal(conversion.processedCount,2,'changed camera JPG and PNG both need source normalization');
    assert.equal(manual.ensureManualPhotoMirror({root:sourceRoot,date:'2026-09-30',workDir}).root,converted.root);
  }
} finally {
  for(const child of holders)if(child.exitCode===null){child.stdin.end('\n');await new Promise(resolve=>child.once('exit',resolve));}
  fs.rmSync(base,{recursive:true,force:true});
}
console.log('Manual photo source commit regression PASS: original dimensions, identical upload bytes, backups, stable resume, actual Windows share locks');
