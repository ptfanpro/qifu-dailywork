// Explicit pinned-runtime integration: generated pixels / mocked reader data.
// Real OCR accuracy is a separate frozen historical-plan gate.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {syntheticPositionedViews} from './positioned-body-evidence-regression.mjs';
import {codeBodyTestInput,freshItem} from './code-body-adjudication-regression.mjs';
import {collectPositionedLayouts} from '../src/positioned-layout-collector.mjs';
import {adjudicateCodeBody,retainCodeBodyResolution,codeBodyResolution,codeBodySourceBlockReason} from '../src/code-body-adjudication.mjs';
import {buildVisualBodyPages} from '../src/pdf-visual-body-evidence.mjs';
import {applyPhotoPreparation,recheckReliablePhotoClaimsWithPdf} from '../src/photo-prepare.mjs';
import {createPdfIndexBinding,createPhotoInputBinding} from '../src/recognition-provenance.mjs';
const appRoot=process.argv[2];if(!appRoot||!path.isAbsolute(appRoot))throw Error('Explicit staged app-local runtime required');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-positioned-join-integration-')),started=Date.now();
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),sharp=createRequire(import.meta.url)('sharp');
const width=600,height=400,pixels=Buffer.alloc(width*height,240);let seed=713;
const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
for(let i=0;i<350;i++){const x=12+rand(576),y=12+rand(376),r=2+rand(5);
 for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(dx*dx+dy*dy<=r*r)pixels[(y+dy)*width+x+dx]=20;}
const page=await sharp(pixels,{raw:{width,height,channels:1}}).png().toBuffer(),photoPixels=Buffer.alloc(800*600,240);
for(let y=0;y<height;y++)pixels.copy(photoPixels,(y+100)*800+100,y*width,(y+1)*width);
const photo=await sharp(photoPixels,{raw:{width:800,height:600,channels:1}}).jpeg().toBuffer(),photoHash=hash(photo);
const pdf=path.join(root,'synthetic.pdf');fs.writeFileSync(pdf,'synthetic two-page identity');
const pdfHash=hash(fs.readFileSync(pdf)),terms=[['松风亭','清净堂'],['松风亭','明月台']];
const pageInputs=terms.map((fieldTexts,i)=>({id:pdfHash+':'+(i+1),source:page,fieldTexts,views:syntheticPositionedViews(fieldTexts)}));
const views=syntheticPositionedViews(terms[0],{width:800,height:600,offsetX:100,offsetY:100});
const positionedLayoutReview=await collectPositionedLayouts({appRoot,pages:pageInputs,photos:[{id:photoHash,source:photo,views}]});
const base=codeBodyTestInput();base.photoSha256=base.read.inputSha256=photoHash;base.read.sourceDimensions={width:800,height:600};
for(const key of ['observations','independent','readings'])for(const o of base.read[key])o.crop={...o.crop,left:o.crop.left+200,top:o.crop.top+150};
base.index.forEach(p=>p.pdfSha256=pdfHash);
base.pages=buildVisualBodyPages(terms.map((fieldTexts,i)=>({pdfSha256:pdfHash,pageNumber:i+1,fieldTexts})),
 pageInputs.map((p,i)=>({pdfSha256:pdfHash,pageNumber:i+1,views:p.views})));
base.views=views;base.positionedLayoutReview=positionedLayoutReview;
assert.notEqual(adjudicateCodeBody({...base,positionedLayoutReview:undefined}).status,'resolved');
const resolved=adjudicateCodeBody(base);assert.equal(resolved.status,'resolved',JSON.stringify(resolved));
assert.equal(resolved.policy,'observed-code-plus-positioned-current-body-v1');assert.equal(resolved.positionedSupport.fields.length,2);
const rejects={
 'serialized geometry':x=>x.positionedLayoutReview=structuredClone(positionedLayoutReview),
 'missing live geometry':x=>delete x.positionedLayoutReview,
 'swapped PDF body':x=>{[x.pages[0].visibleFieldViews,x.pages[1].visibleFieldViews]=[x.pages[1].visibleFieldViews,x.pages[0].visibleFieldViews];},
 'changed extracted fields':x=>x.pages[1].fieldTexts.push('清净堂'),
 'changed physical corpus':x=>x.index[1].pdfSha256='e'.repeat(64),
 'changed photo view':x=>x.views[0].text='另外内容',
 'incomplete corpus':x=>x.pages.pop(),
 'credible alternate code':x=>{x.read.independent[0].confidence=30;x.read.readings[2].confidence=30;},
 'wrong code/page join':x=>x.index.reverse().forEach((p,i)=>p.number=17+i),
 'code from neighbouring sheet':x=>{for(const key of ['observations','independent','readings'])for(const o of x.read[key])o.crop.left-=200;},
};
for(const [label,alter] of Object.entries(rejects)){
 const data={...structuredClone({...base,positionedLayoutReview:null}),positionedLayoutReview};alter(data);
 assert.notEqual(adjudicateCodeBody(data).status,'resolved',label);
}
const photoDir=path.join(root,'photos');fs.mkdirSync(photoDir);const file=path.join(photoDir,'raw.jpg');fs.writeFileSync(file,photo);
const item=freshItem(base);item.sourceSha256=photoHash;item.file=file;
const binding=createPdfIndexBinding('2026-03-04',[pdf],'synthetic-restart-regression');
assert.equal(retainCodeBodyResolution(item,{...base,pdfSetDigest:binding.digest}).status,'resolved');
assert.equal(codeBodyResolution(item).number,17);
assert.equal(codeBodyResolution(structuredClone(item)),null);
const pdfPages=[1,2].map((pageNumber,i)=>({pdf,pageNumber,number:17+i,_localShapeFingerprint:[1]}));
assert.equal(codeBodySourceBlockReason(item,pdfPages),null);
assert.equal((await recheckReliablePhotoClaimsWithPdf([item],pdfPages)).confirmed,1);
const plan={businessDate:'2026-03-04',createdAt:new Date().toISOString(),folder:root,photoDir,safeToApply:true,ready:false,issues:[],
 pdfIndexBinding:binding,pdfPages,photoInputBinding:createPhotoInputBinding(photoDir,[file]),photoReviewExclusions:{schemaVersion:1,files:[]},
 bodyClaimReview:{status:'veto-only-not-order-binding'},allowedBlessingNumbers:[17,18],recognized:[item],duplicateSources:[],assignments:[{source:file,targetName:'17.jpg',kind:'blessing',evidence:item.evidence}]};
const receipt=await applyPhotoPreparation(plan,path.join(root,'work'));assert.equal(receipt.processedCount,1);
fs.writeFileSync(path.join(root,'plan.json'),JSON.stringify(plan));fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(receipt));
const restart=expected=>{const child=spawnSync(process.execPath,[fileURLToPath(new URL('./code-body-restart-regression.mjs',import.meta.url)),
 '--restart-child',root,expected],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(child.status,0,child.stderr);};
restart('pass');
fs.renameSync(path.join(root,'receipt.json'),path.join(root,'receipt.saved'));restart('reject');fs.renameSync(path.join(root,'receipt.saved'),path.join(root,'receipt.json'));
const output=path.join(photoDir,'17.jpg'),saved=fs.readFileSync(output);fs.writeFileSync(output,'same name different content');restart('reject');fs.writeFileSync(output,saved);
fs.writeFileSync(pdf,'changed PDF');restart('reject');
assert.notEqual(codeBodySourceBlockReason(item,pdfPages),null);
positionedLayoutReview.complete=false;
assert.notEqual(adjudicateCodeBody(base).status,'resolved','mutated live report');
const result={passed:true,freshJoin:1,negatives:Object.keys(rejects).length+1,restarts:4,seconds:(Date.now()-started)/1000,
 actualOcrAccuracy:false,businessAcceptance:false,root};fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
