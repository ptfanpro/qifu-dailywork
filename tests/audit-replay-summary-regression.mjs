import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-audit-summary-test-'));
const fp='a'.repeat(64),hash='b'.repeat(64),round='replay-'+fp.slice(0,12);
const dates=['2026-01-25','2026-01-26','2026-01-27','2026-01-28'];
const json=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
const success={sourceHash:fp,date:dates[0],photos:1,pdfPages:1,assignments:1,unresolved:0,
  referenceDisagreements:0,manualEvidence:0,ready:true,safeToApply:true,missing:0,issues:0,pending:0,seconds:2,
  sourceUnchanged:true,rows:[{sha256:hash,assigned:'1.jpg',kind:'blessing',referenceLabel:'blessing',referenceNumber:1,disagreement:false,
    // Summary must never forward arbitrary fields or raw errors.
    privateText:'SYNTHETIC_PRIVATE_SENTINEL'}]};
try {
  json(path.join(root,'inventory.json'),{days:dates.map((date,index)=>({date,photos:index===1?[]:[{sha256:hash}],pdfs:[{}]}))});
  json(path.join(root,round,dates[0],'report.json'),success);
  const run=()=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./audit-status.mjs',import.meta.url)),root],{encoding:'utf8'}));
  let result=run().rounds.find(r=>r.round===round);
  assert.equal(result.pages,1,'Product reports use pdfPages, not pages');
  assert.equal(result.assignedPhotos,1,'Assignments must not disappear into confirmed=0');
  assert.equal(result.confirmed,null,'Assignments are plans, not verified business bindings');
  // Both filenames in one date must not cause double counting.
  json(path.join(root,round,dates[0],'summary.json'),success);
  json(path.join(root,round,dates[1],'report.json'),{sourceHash:fp,date:dates[1],status:'missing-source-material',photos:0,pdfs:1});
  json(path.join(root,round,dates[2],'report.json'),{sourceHash:fp,date:dates[2],error:'SYNTHETIC_PRIVATE_SENTINEL',photos:1,seconds:3});
  json(path.join(root,round,dates[3],'report.json'),{...success,date:dates[3],photos:2});
  const output=run();result=output.rounds.find(r=>r.round===round);
  assert.equal(result.completedDays,1);assert.equal(result.reportedDays,4);
  assert.equal(result.missingSourceDays,1);assert.equal(result.failedDays,1);assert.equal(result.invalidDays,1);
  assert.equal(result.photos,1);assert.equal(result.pages,1);assert.equal(result.assignedPhotos,1);
  assert.equal(result.seconds,2);assert.equal(result.failedSeconds,3);
  assert.equal(JSON.stringify(output).includes('SYNTHETIC_PRIVATE_SENTINEL'),false);
  assert.equal(output.status,'INCOMPLETE_NOT_RELEASE_ACCEPTANCE');
  // Count agreement alone cannot hide different/missing photo identities.
  json(path.join(root,round,dates[3],'report.json'),{...success,date:dates[3],rows:[{...success.rows[0],sha256:'c'.repeat(64)}]});
  assert.equal(run().rounds.find(r=>r.round===round).invalidDays,1);
  json(path.join(root,round,dates[3],'report.json'),{...success,date:dates[3],sourceUnchanged:false});
  result=run().rounds.find(r=>r.round===round);
  assert.equal(result.sourceChanges,1);assert.equal(result.assignedPhotos,1);
  json(path.join(root,round,dates[3],'report.json'),{...success,date:dates[3],sourceHash:'d'.repeat(64)});
  assert.equal(run().rounds.find(r=>r.round===round).invalidDays,1);
  fs.writeFileSync(path.join(root,round,dates[3],'report.json'),'{');
  assert.equal(run().rounds.find(r=>r.round===round).invalidDays,1);
  json(path.join(root,round,dates[3],'report.json'),{...success,date:dates[3],assignments:0,unresolved:1});
  assert.equal(run().rounds.find(r=>r.round===round).invalidDays,1);
  json(path.join(root,round,dates[3],'report.json'),{...success,date:dates[3],rows:[null]});
  assert.equal(run().rounds.find(r=>r.round===round).invalidDays,1);
  json(path.join(root,round,dates[3],'report.json'),{...success,date:dates[3],sourceHash:'a'.repeat(12)+'c'.repeat(52)});
  assert.equal(run().rounds.find(r=>r.round===round).status,'MIXED_SOURCE_NOT_SCORED');
  console.log('audit replay summary regression passed');
} finally {
  // Only this newly created, resolved test directory; never a caller path.
  assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('qifu-audit-summary-test-'));
  fs.rmSync(root,{recursive:true,force:true});
}
