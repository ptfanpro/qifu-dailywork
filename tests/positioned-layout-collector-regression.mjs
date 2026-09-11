import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import {collectPositionedLayouts,positionedLayoutEvidence,preparePositionedLayoutInput,layoutBatches} from '../src/positioned-layout-collector.mjs';
import {visualBodyViewNames} from '../src/pdf-visual-body-evidence.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const blankViews=(width,height)=>visualBodyViewNames.map(view=>({view,text:'',lineCount:0,regions:0,errors:0,truncated:false,
 positioned:{schemaVersion:1,dimensions:{width,height},fields:[]}}));
test('layout collector binds oriented source dimensions and immutable image bytes',async()=>{
 const source=await sharp({create:{width:2400,height:1600,channels:3,background:'white'}}).png().toBuffer();
 const views=blankViews(2400,1600),id=hash(source),prepared=await preparePositionedLayoutInput({id,source,views});
 assert.equal(prepared.sourceSha256,id);assert.deepEqual(prepared.shape,[1200,1800]);
 assert.equal(prepared.viewsSha256,hash(JSON.stringify(views)));
 const before=prepared.viewsSha256;views[0].text='changed';assert.equal(prepared.viewsSha256,before);
 await assert.rejects(preparePositionedLayoutInput({id,source,views:blankViews(1800,1200)}),/dimensions/);
 const broken=blankViews(2400,1600);delete broken[0].positioned;
 await assert.rejects(preparePositionedLayoutInput({id,source,views:broken}),/positioned/);
 await assert.rejects(preparePositionedLayoutInput({id:'b'.repeat(64),source,views:blankViews(2400,1600)}),/identity/);
});
test('layout request batches retain every physical page and every photo exactly once',()=>{
 const pages=Array.from({length:65},(_,i)=>({id:`${'a'.repeat(64)}:${i+1}`}));
 const photos=Array.from({length:9},(_,i)=>({id:i.toString(16).padStart(64,'0')}));
 const batches=layoutBatches(pages,photos);assert.equal(batches.length,6);
 const pairs=batches.flatMap(b=>b.photos.flatMap(p=>b.pages.map(q=>`${p.id}/${q.id}`)));
 assert.equal(pairs.length,65*9);assert.equal(new Set(pairs).size,pairs.length);
 for(const b of batches){assert.ok(b.pages.length<=32);assert.ok(b.photos.length<=8);}
 assert.throws(()=>layoutBatches([...pages,pages[0]],photos),/identity/);
 assert.throws(()=>layoutBatches(pages,[photos[0],photos[0]]),/identity/);
 assert.throws(()=>layoutBatches([],photos),/budget/);
});
test('serialized or hand-made geometry is not a live positioned observation',async()=>{
 assert.equal(positionedLayoutEvidence({schemaVersion:1,complete:true}),null);
 await assert.rejects(collectPositionedLayouts({appRoot:process.cwd(),pages:[],photos:[]}),/budget/);
});
