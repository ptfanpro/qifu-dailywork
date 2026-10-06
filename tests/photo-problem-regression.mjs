import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {formatManualUploadProblem} from '../src/photo-problem.mjs';
import {scanManualNumberedWorkday,planManualNumberedPreparation} from '../src/manual-photo-workflow.mjs';

const files=['73.jpg','772.jpg','84.jpg'];
const partial=formatManualUploadProblem({files,readback:{matched:[{name:'73.jpg'}],missingNames:['772.jpg','84.jpg'],scanned:1}});
assert.match(partial,/772.jpg（文件编号 772）/);
assert.match(partial,/84.jpg（文件编号 84）/);
assert.doesNotMatch(partial,/73.jpg/,'confirmed files must not appear in the problem list');
assert.match(partial,/不代表它们的编号都写错/);
assert.doesNotMatch(partial,/阻断|禁止|没有对应订单|编号有误/,'unknown upload results must not be mislabeled as wrong numbers');
const rejected=formatManualUploadProblem({files,readback:{matched:[],missingNames:files,scanned:0},
  uploadEvidence:{applicationFailure:true,responseOutcomes:[{reason:'duplicate-image'}]}});
assert.match(rejected,/该图片已上传/);
assert.match(rejected,/后台没有指出具体文件/);
assert.match(rejected,/软件不会读取纸面编号或自动改名/);
assert.match(rejected,/本次没有再次上传/);

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-photo-problem-'));
try {
  const folder=path.join(temp,'10月5日','1');fs.mkdirSync(folder,{recursive:true});
  const sharp=createRequire(import.meta.url)('sharp');
  await sharp({create:{width:1800,height:1350,channels:3,background:'#adbdcf'}}).jpeg().toFile(path.join(folder,'72.jpg'));
  await sharp({create:{width:1800,height:1350,channels:3,background:'#dfaacc'}}).png().toFile(path.join(folder,'72.png'));
  const plan=await planManualNumberedPreparation({photoDir:folder,date:'2026-10-05'});
  assert.ok(plan.issues.some(message=>/编号 72 重复：72.jpg、72.png/.test(message)),JSON.stringify(plan.issues));
  const manifest=await scanManualNumberedWorkday(temp,'2026-10-05');
  assert.equal(manifest.uploadReady,false);
  assert.ok(manifest.blockingErrors.some(message=>/编号 72 重复：72.jpg、72.png/.test(message)));
} finally {
  assert.equal(path.dirname(fs.realpathSync(temp)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());
  fs.rmSync(temp,{recursive:true,force:true});
}
console.log('Photo problem filenames and honest numbering messages regression PASS');
