import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {recognitionSourceFingerprint} from '../src/recognition-provenance.mjs';
const app=fileURLToPath(new URL('..',import.meta.url));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-fingerprint-coverage-'));
try{
 fs.cpSync(path.join(app,'src'),path.join(root,'src'),{recursive:true});
 fs.mkdirSync(path.join(root,'ui'));
 fs.copyFileSync(path.join(app,'ui/Read-WindowsOcr.ps1'),path.join(root,'ui/Read-WindowsOcr.ps1'));
 const base=recognitionSourceFingerprint(root),file=path.join(root,'src/new-recognition-module.mjs');
 fs.writeFileSync(file,'export const policy = 1;');
 const added=recognitionSourceFingerprint(root);
 assert.notEqual(added,base,'new source modules must not be silently omitted from cache version identity');
 fs.writeFileSync(file,'export const policy = 2;');
 assert.notEqual(recognitionSourceFingerprint(root),added,'same-length source edits must invalidate recognition caches');
 fs.unlinkSync(file);assert.equal(recognitionSourceFingerprint(root),base);
 fs.mkdirSync(path.join(root,'src/nested-policy'));
 fs.writeFileSync(path.join(root,'src/nested-policy/rules.json'),'{}');
 assert.notEqual(recognitionSourceFingerprint(root),base,'nested source rules participate too');
 fs.unlinkSync(path.join(root,'src/nested-policy/rules.json'));
 assert.equal(recognitionSourceFingerprint(root),base);
 fs.unlinkSync(path.join(root,'src/photo-prepare.mjs'));
 assert.throws(()=>recognitionSourceFingerprint(root),'missing mandatory source is not a valid new cache version');
 console.log('Recognition fingerprint coverage: added, edited, removed and nested modules PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
