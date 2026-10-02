import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cleanupLocalState} from '../src/cleanup.mjs';
const base=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-source-retention-'));
const root=path.join(base,'祈福运行数据'),now=Date.parse('2026-10-20T00:00:00Z');
const date=days=>new Date(now-days*86400000).toISOString();
const json=(file,data)=>fs.writeFileSync(file,JSON.stringify(data));
function fixture(day,sourceAge,writing=false) {
  const photos=path.join(root,'workdays',day,'photos');
  for(const name of ['photo-backups','source-photo-backups','photo-quarantine']){
    fs.mkdirSync(path.join(photos,name),{recursive:true});fs.writeFileSync(path.join(photos,name,'original.jpg'),'recoverable-original');
  }
  json(path.join(photos,'photo-prepare-receipt.json'),{completedAt:date(10),cleanupPending:[],files:[]});
  json(path.join(photos,'source-photo-commit.json'),{completedAt:writing?null:date(sourceAge),files:[{status:writing?'writing':'verified',backup:path.join(photos,'source-photo-backups','original.jpg')}]});
  json(path.join(photos,'photo-online-closure.json'),{complete:true,checkedAt:date(10)});
  return photos;
}
try {
  const recent=fixture('2026-10-01',1),interrupted=fixture('2026-10-02',9,true),old=fixture('2026-10-03',9);
  cleanupLocalState(root,{force:true,nowMs:now});
  for(const photos of [recent,interrupted])for(const name of ['photo-backups','source-photo-backups'])
    assert.equal(fs.existsSync(path.join(photos,name,'original.jpg')),true,'old mirror receipt must not purge new/interrupted original recovery files');
  assert.equal(fs.existsSync(path.join(interrupted,'photo-quarantine','original.jpg')),true,'old online completion must not purge an interrupted source conversion');
  assert.equal(fs.existsSync(path.join(old,'source-photo-backups')),false,'verified source recovery files should expire after seven days');
  assert.equal(JSON.parse(fs.readFileSync(path.join(old,'source-photo-commit.json'),'utf8')).files[0].backup,null);
} finally {fs.rmSync(base,{recursive:true,force:true});}
console.log('Manual source backup retention regression PASS');
