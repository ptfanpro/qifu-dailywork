// Actual audit CLI, generated pixels, real fixed models; no business inputs.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),sharp=require('sharp');
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-detection-cache-test-'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const run=()=>spawnSync(process.execPath,[path.join(source,'tests/experiments/annual-detection-replay.mjs'),root,
 path.join(source,'models/paddleocr-zh-v4/ch_PP-OCRv4_det_mobile.onnx'),'0','1','2026-01-02'],
 {encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});
try{
 const file=path.join(root,'synthetic.png');
 fs.writeFileSync(file,await sharp({create:{width:320,height:240,channels:3,background:'#ffffff'}}).png().toBuffer());
 const photo={file,sha256:sha(fs.readFileSync(file)),referenceLabel:'unlabelled',referenceNumber:null};
 fs.writeFileSync(path.join(root,'inventory.json'),JSON.stringify({days:[{date:'2026-01-02',photos:[photo]}]}));
 assert.equal(run().status,0,'fresh actual diagnostic must complete');
 const rounds=fs.readdirSync(root).filter(name=>name.startsWith('detection-'));assert.equal(rounds.length,1);
 const dir=path.join(root,rounds[0],'2026-01-02'),report=path.join(dir,`${photo.sha256}.json`);
 const first=fs.readFileSync(report),entry=JSON.parse(first);
 assert.equal(entry.schemaVersion,2);assert.equal(entry.identity.sha256,photo.sha256);
 assert.equal(entry.bindingVerified,false);assert.equal(entry.errors,0);
 const timestamp=fs.statSync(report,{bigint:true}).mtimeNs;
 assert.equal(run().status,0,'unchanged evidence must resume');
 assert.equal(fs.statSync(report,{bigint:true}).mtimeNs,timestamp,'resume must not recompute or rewrite the row');
 entry.identity.sourceVersion='0'.repeat(64);fs.writeFileSync(report,JSON.stringify(entry));
 assert.equal(run().status,0,'stale evidence must be regenerated');
 assert.notEqual(JSON.parse(fs.readFileSync(report)).identity.sourceVersion,entry.identity.sourceVersion);
 const prior=fs.readdirSync(dir).filter(name=>name.includes('.prior-'));assert.equal(prior.length,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,prior[0]))).identity.sourceVersion,entry.identity.sourceVersion);
 const beforeChangedSource=sha(fs.readFileSync(report));
 fs.writeFileSync(file,await sharp({create:{width:320,height:240,channels:3,background:'#555555'}}).png().toBuffer());
 const changed=run();assert.notEqual(changed.status,0,'cached result cannot hide a changed original');
 assert.ok(changed.stderr.includes('source changed since inventory'));
 assert.equal(sha(fs.readFileSync(report)),beforeChangedSource,'source mismatch must not rewrite evidence');
 console.log('Actual detection CLI cache identity / source replacement integration PASS');
}finally{
 const actual=fs.realpathSync(root),parent=fs.realpathSync(os.tmpdir());
 assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());
 assert.ok(path.basename(actual).startsWith('qifu-detection-cache-test-'));
 fs.rmSync(actual,{recursive:true,force:true});
}
