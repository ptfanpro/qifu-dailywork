import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {codeBodyTestInput,freshItem,views} from './code-body-adjudication-regression.mjs';
import {reviewCurrentPdfBodies} from '../src/body-content-review.mjs';
import {photoCodeAuditBlockReason,recheckReliablePhotoClaimsWithPdf} from '../src/photo-prepare.mjs';
import {codeBodyResolution} from '../src/code-body-adjudication.mjs';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-code-body-collector-test-'));
try {
  const pdf=path.join(root,'synthetic.pdf'),file=path.join(root,'synthetic.jpg');
  const make=()=>{
    fs.writeFileSync(pdf,'synthetic PDF content');fs.writeFileSync(file,'synthetic photo content');
    const data=codeBodyTestInput(),item=freshItem(data),pdfHash=sha(fs.readFileSync(pdf));
    item.file=file;item.sourceSha256=item.detectedCodeRead.inputSha256=sha(fs.readFileSync(file));
    data.pages.forEach(p=>p.pdfSha256=pdfHash);
    return {item,data,args:{appRoot:root,pdfFiles:[pdf],
      pdfPages:[1,2].map((pageNumber,i)=>({pdf,pageNumber,number:17+i,_localShapeFingerprint:[1]})),
      pdfIndexBinding:{digest:sha('set'),files:[{name:path.basename(pdf),sha256:pdfHash}]},
      claims:[],unresolvedClaims:[item],loadPages:async()=>data.pages,
      createReader:async()=>({read:async(_bytes,options)=>{
        assert.equal(options.includePositions,true,'unresolved candidate must preserve positions');
        return data.views;
      },release:async()=>{}})}};
  };
  const {item,args}=make(),history=JSON.stringify(item.codeAuditHistory);
  const result=await reviewCurrentPdfBodies(args);
  assert.equal(result.adjudicated.length,1,'collector must review unresolved code candidates too');
  assert.equal(result.adjudicated[0],item);
  assert.equal(item.number,17);assert.equal(photoCodeAuditBlockReason(item),null);
  assert.equal(JSON.stringify(item.codeAuditHistory),history);
  assert.equal((await recheckReliablePhotoClaimsWithPdf([item],args.pdfPages)).confirmed,1,'complete plan recheck must accept the newly validated proof');
  const noShape=make();
  assert.equal((await reviewCurrentPdfBodies(noShape.args)).adjudicated.length,1);
  noShape.args.pdfPages.forEach(page=>delete page._localShapeFingerprint);
  assert.equal((await recheckReliablePhotoClaimsWithPdf([noShape.item],noShape.args.pdfPages)).confirmed,1,
    'source-bound code/body proof must recheck physical PDF bytes and index without an unrelated grayscale fingerprint');
  for(const kind of ['pdf-change','photo-change','photo-changed-before-body','truncated','incomplete-pages','prior-conflict',
    'pdf-change-on-release','photo-change-on-release']) {
    const test=make();
    if(kind==='photo-changed-before-body')fs.writeFileSync(file,'changed before body starts');
    if(kind==='prior-conflict')test.item.pdfRecheck={status:'rejected',reason:'prior'};
    if(kind==='incomplete-pages')test.args.loadPages=async()=>test.data.pages.slice(0,1);
    test.args.createReader=async()=>({read:async()=>{
      if(kind==='pdf-change')fs.writeFileSync(pdf,'changed PDF');
      if(kind==='photo-change')fs.writeFileSync(file,'changed photo');
      if(kind==='truncated')return test.data.views.map(v=>({...v,truncated:true}));
      return test.data.views;
    },release:async()=>{
      if(kind==='pdf-change-on-release')fs.writeFileSync(pdf,'changed after body read');
      if(kind==='photo-change-on-release')fs.writeFileSync(file,'changed after body read');
    }});
    const failure=await reviewCurrentPdfBodies(test.args);
    assert.equal(failure.adjudicated?.length||0,0,kind);
    assert.equal(test.item.number,null,kind);
    assert.equal(codeBodyResolution(test.item),null,kind);
  }
  const short=make();short.data.views=views('阖家平安');
  const missingGeometry=await reviewCurrentPdfBodies(short.args);
  assert.equal(missingGeometry.adjudicated.length,0,'missing geometry cannot turn a shared field into identity');
  assert.equal(missingGeometry.positionedLayoutReview.status,'positioned-layout-unavailable');
  assert.equal(short.item.number,null);assert.ok(photoCodeAuditBlockReason(short.item));
  for(const kind of ['pdf-bytes','photo-bytes','other-file-same-page','other-page-number','other-index-number','missing-other-page','serialized-label']) {
    const test=make();
    assert.equal((await reviewCurrentPdfBodies(test.args)).adjudicated.length,1);
    if(kind==='pdf-bytes')fs.writeFileSync(pdf,'different PDF with the same page count');
    if(kind==='photo-bytes')fs.writeFileSync(file,'different photo after body review');
    if(kind==='other-file-same-page'){
      const otherPdf=path.join(root,'other.pdf');fs.writeFileSync(otherPdf,'different physical PDF');
      test.args.pdfPages=test.args.pdfPages.map(p=>({...p,pdf:otherPdf}));
    }
    if(kind==='other-page-number')test.args.pdfPages[0].pageNumber=2;
    if(kind==='other-index-number')test.args.pdfPages[1].number=19;
    if(kind==='missing-other-page')test.args.pdfPages.pop();
    const checked=kind==='serialized-label'?JSON.parse(JSON.stringify(test.item)):test.item;
    const recheck=await recheckReliablePhotoClaimsWithPdf([checked],test.args.pdfPages);
    assert.equal(recheck.confirmed,0,`post-body source/index substitution: ${kind}`);
    assert.equal(checked.reliable,false,kind);
  }
} finally {fs.rmSync(root,{recursive:true,force:true});}
console.log('Code/body actual collector integration PASS: unresolved candidates, source race, partial corpus and prior conflicts');
