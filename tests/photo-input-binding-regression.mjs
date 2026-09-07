import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createPhotoInputBinding,assertPhotoInputBinding} from '../src/recognition-provenance.mjs';
import {applyPhotoPreparation} from '../src/photo-prepare.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-photo-input-test-'));
try {
  const photos=path.join(dir,'photos'),work=path.join(dir,'work');fs.mkdirSync(photos);
  const a=path.join(photos,'a.jpg'),b=path.join(photos,'b.jpg');
  const image=await sharp({create:{width:400,height:300,channels:3,background:'#d03344'}}).jpeg().toBuffer();
  fs.writeFileSync(a,image);fs.writeFileSync(b,image);
  const plan={businessDate:'2026-09-07',ready:true,issues:[],photoDir:photos,
    photoInputBinding:createPhotoInputBinding(photos,[a,b]),
    assignments:[{source:a,targetName:'1.jpg',kind:'blessing'}],duplicateSources:[{source:b,duplicateOfNumber:1}]};
  assert.doesNotThrow(()=>assertPhotoInputBinding(plan));
  assert.throws(()=>assertPhotoInputBinding({...plan,photoInputBinding:undefined}),/缺少原图/);
  assert.throws(()=>assertPhotoInputBinding({...plan,assignments:[{source:a,targetName:'../1.jpg'}]}),/路径无效/);
  assert.throws(()=>assertPhotoInputBinding({...plan,assignments:[...plan.assignments,...plan.assignments]}),/不唯一/);
  const changed=Buffer.from(image);changed[changed.length-1]^=1;fs.writeFileSync(a,changed);
  await assert.rejects(applyPhotoPreparation(plan,work),/发生变化/);
  assert.equal(fs.existsSync(work),false,'stale plans fail before backups or writes');
  assert.deepEqual(fs.readFileSync(a),changed);assert.deepEqual(fs.readFileSync(b),image);
  fs.writeFileSync(a,image);fs.writeFileSync(b,changed);
  await assert.rejects(applyPhotoPreparation(plan,work),/发生变化/,'duplicate removal also needs a content-bound plan');
  fs.writeFileSync(b,image);
  // Simulate a sync client replacing the source immediately after backup.
  const copy=fs.copyFileSync;
  fs.copyFileSync=(source,destination,...args)=>{
    const result=copy(source,destination,...args);
    if(source===a&&destination.includes('photo-backups'))fs.writeFileSync(a,changed);
    return result;
  };
  try {await assert.rejects(applyPhotoPreparation(plan,work),/发生变化/);}
  finally {fs.copyFileSync=copy;}
  assert.deepEqual(fs.readFileSync(a),changed,'replacement remains untouched');
  assert.deepEqual(fs.readFileSync(b),image,'duplicate remains untouched');
  assert.equal(fs.existsSync(path.join(photos,'1.jpg')),false);
  fs.writeFileSync(a,image);
  // On rollback a sync-created name must not cause the quarantined original
  // to be discarded. Both versions are recoverable, not silently overwritten.
  fs.copyFileSync=(source,destination,...args)=>{
    if(source.includes('photo-staging')&&destination===path.join(photos,'1.jpg')){
      fs.writeFileSync(a,changed);throw Error('simulated write collision');
    }
    return copy(source,destination,...args);
  };
  const collisionWork=path.join(dir,'collision-work');
  try {await assert.rejects(applyPhotoPreparation(plan,collisionWork),/隔离副本已保留/);}
  finally {fs.copyFileSync=copy;}
  assert.deepEqual(fs.readFileSync(a),changed);
  const quarantineParent=path.join(collisionWork,'photo-quarantine');
  const quarantinedDir=path.join(quarantineParent,fs.readdirSync(quarantineParent)[0]);
  assert.deepEqual(fs.readFileSync(path.join(quarantinedDir,fs.readdirSync(quarantinedDir)[0])),image);
  fs.writeFileSync(a,image);fs.writeFileSync(b,image);
  const twoFilePlan={...plan,duplicateSources:[],assignments:[...plan.assignments,{source:b,targetName:'2.jpg',kind:'blessing'}]};
  fs.copyFileSync=(source,destination,...args)=>{
    if(source.includes('photo-staging')&&destination===path.join(photos,'2.jpg')){
      fs.writeFileSync(path.join(photos,'1.jpg'),changed);throw Error('simulated concurrent target replacement');
    }
    return copy(source,destination,...args);
  };
  try {await assert.rejects(applyPhotoPreparation(twoFilePlan,path.join(dir,'target-race-work')),/目标文件已被外部修改/);}
  finally {fs.copyFileSync=copy;}
  assert.deepEqual(fs.readFileSync(path.join(photos,'1.jpg')),changed,'rollback must not delete a sync-client replacement of a newly created target');
  assert.deepEqual(fs.readFileSync(a),image);assert.deepEqual(fs.readFileSync(b),image);
  console.log('Photo content binding / replacement race regression PASS');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
