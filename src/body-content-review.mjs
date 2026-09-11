// Veto-only current-PDF body review. A match never supplies a replacement
// number, verifies an order set, or clears an earlier failed review.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createChineseBodyReader} from './chinese-body-reader.mjs';
import {rankBodyTextEvidence} from './body-text-evidence.mjs';
import {compareBodyFieldEvidence} from './body-field-evidence.mjs';
import {buildVisualBodyPages,visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
import {readBodyObservation} from './body-observation-cache.mjs';
const require=createRequire(import.meta.url), hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const id=p=>`${p.pdfSha256}:${p.pageNumber}`;

export function assessBodyClaim(views,pages,claim) {
  if(!claim || pages.filter(p=>id(p)===id(claim)).length!==1) throw Error('Invalid claimed PDF identity');
  if(!Array.isArray(views)||views.length!==4||visualBodyViewNames.some(n=>views.filter(v=>v.view===n).length!==1)) throw Error('Incomplete body views');
  if(views.some(v=>v.errors!==0||v.truncated!==false||typeof v.text!=='string')) return {status:'body-reader-unavailable',bindingVerified:false};
  const results=visualBodyViewNames.map(name=>{
    const evidence=rankBodyTextEvidence(views.find(v=>v.view===name).text,pages);
    return {view:name,observedGrams:evidence.observedGrams,ranked:evidence.ranked};
  });
  const candidates=results.map(r=>r.ranked.filter(p=>p.corroboratedUniqueMatchedGrams>0));
  // Keep uncorroborated contrary reads visible without turning a single PDF
  // OCR error into an alleged different order. A real extracted/paired field
  // still vetoes, even when the claimed page has a much higher score.
  const uncorroboratedForeignEvidence=results.flatMap(r=>r.ranked
    .filter(p=>id(p)!==id(claim)&&p.uniqueMatchedGrams>p.corroboratedUniqueMatchedGrams)
    .map(p=>({view:r.view,pdfSha256:p.pdfSha256,pageNumber:p.pageNumber,
      uniqueMatchedGrams:p.uniqueMatchedGrams,corroboratedUniqueMatchedGrams:p.corroboratedUniqueMatchedGrams,
      evidenceSha256:p.uniqueEvidenceSha256})));
  const fieldEvidence=compareBodyFieldEvidence(views,pages);
  const fieldCandidates=fieldEvidence.readings.map(r=>r.ranked.filter(p=>p.specificExactFields>0));
  // Even a non-leading foreign candidate is contrary content, not a vote
  // that a higher score may cancel. One-view evidence stays ambiguous.
  const foreign=candidates.map((ps,i)=>[...new Set([...ps,...fieldCandidates[i]]
    .filter(p=>id(p)!==id(claim)).map(id))]);
  const pairedForeign=[0,2].some(i=>foreign[i].some(key=>foreign[i+1].includes(key)));
  const status=pairedForeign?'conflicting-body':foreign.some(ps=>ps.length)?'ambiguous-body'
    :candidates.some(ps=>ps.length)||fieldCandidates.some(ps=>ps.length)?'observed-body-consistent':'no-specific-body-evidence';
  return {status,bindingVerified:false,results,fieldEvidence,uncorroboratedForeignEvidence};
}

export function bodyReviewBlockReason(item) {
  if(item?.bodyReviewHistory===undefined)return null;
  const history=item.bodyReviewHistory;
  if(!Array.isArray(history)||!history.length)return 'body-review-incomplete';
  for(const review of history) {
    if(review?.schemaVersion!==1||review.bindingVerified!==false
      ||!Number.isInteger(review.claimedNumber)||!/^[a-f0-9]{64}$/.test(review.photoSha256||'')
      ||!/^[a-f0-9]{64}$/.test(review.pdfSetDigest||''))return 'body-review-incomplete';
    if(!['observed-body-consistent','no-specific-body-evidence'].includes(review.status))return `body-review-${review.status||'incomplete'}`;
    if(item.number!==review.claimedNumber)return 'body-review-number-changed';
  }
  return null;
}

export function retainBodyReview(item,review) {
  const entry=structuredClone(review);
  item.bodyReviewHistory=[...(item.bodyReviewHistory||[]),entry];
  const reason=bodyReviewBlockReason(item);
  if(reason) {
    item.reliable=false;
    item.number=null;
    item.pdfRecheck={status:'inconclusive',reason,claimedNumber:review.claimedNumber};
  }
  return entry;
}

export async function reviewCurrentPdfBodies({appRoot,pdfFiles,pdfPages,pdfIndexBinding,claims,onProgress=null,
  createReader=createChineseBodyReader,loadPages=null,cacheDir=null}) {
  if(!claims.length)return {status:'not-needed',attempted:0,blocked:0,results:[]};
  const started=Date.now(), results=[];
  let reader=null,pages=null;
  let cacheHits=0,freshReads=0;
  const readViews=async source=>{
    const result=await readBodyObservation({cacheDir,source,
      fingerprint:pdfIndexBinding.recognizerFingerprint,modelSha256:reader.modelSha256,
      read:bytes=>reader.read(bytes,{includeVertical:true})});
    if(result.cacheHit)cacheHits++;else freshReads++;
    return result.views;
  };
  const base=claim=>({schemaVersion:1,claimedNumber:claim.number,photoSha256:hash(fs.readFileSync(claim.file)),
    pdfSetDigest:pdfIndexBinding.digest,bindingVerified:false});
  const originals=claims.map(base);
  const verifySources=()=>{
    for(const pdf of pdfFiles) {
      const saved=pdfIndexBinding.files.filter(p=>p.name===path.basename(pdf));
      if(saved.length!==1||hash(fs.readFileSync(pdf))!==saved[0].sha256)throw Error('PDF source changed during body review');
    }
    for(let i=0;i<claims.length;i++)if(hash(fs.readFileSync(claims[i].file))!==originals[i].photoSha256)throw Error('Photo changed during body review');
  };
  try {
    verifySources();
    reader=await createReader(appRoot,path.join(appRoot,'models','paddleocr-zh-v4'));
    if(loadPages)pages=await loadPages(reader);
    else {
      const pdfjs=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
      const {createCanvas}=require('@napi-rs/canvas');
      const standardFontDataUrl=path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts').replaceAll('\\','/')+'/';
      const extracted=[],readings=[];
      for(const file of pdfFiles) {
        const bytes=fs.readFileSync(file),pdfSha256=hash(bytes);
        const document=await pdfjs.getDocument({data:new Uint8Array(bytes),disableWorker:true,standardFontDataUrl,useSystemFonts:false}).promise;
        try {
          for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++) {
            const page=await document.getPage(pageNumber),bounds=page.getViewport({scale:1});
            const viewport=page.getViewport({scale:1800/Math.max(bounds.width,bounds.height)});
            const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
            await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
            const fieldTexts=(await page.getTextContent()).items.map(v=>v.str||'');
            extracted.push({pdfSha256,pageNumber,fieldTexts});
            readings.push({pdfSha256,pageNumber,views:await readViews(canvas.toBuffer('image/png'))});
            page.cleanup();
            onProgress?.(`正文归属检查：已读取 ${extracted.length} 页 PDF 可见内容；只作冲突保护，不按最高分改号。`);
          }
        } finally {await document.destroy();}
      }
      pages=buildVisualBodyPages(extracted,readings);
    }
    // Map by PDF content and physical page, never by rank or historical name.
    const expectedIds=pdfPages.map(p=>{
      const file=p.pdf||p.file;
      const entry=pdfIndexBinding.files.filter(v=>v.name===path.basename(file||''));
      return entry.length===1?`${entry[0].sha256}:${p.pageNumber}`:null;
    });
    if(expectedIds.some(x=>!x)||new Set(expectedIds).size!==expectedIds.length
      ||pages.length!==expectedIds.length||pages.some(p=>!expectedIds.includes(id(p)))||new Set(pages.map(id)).size!==pages.length)throw Error('Incomplete body/index page identity');
    for(let i=0;i<claims.length;i++) {
      const claim=claims[i];
      let assessment;
      try {
        const positions=pdfPages.map((p,index)=>p.number===claim.number?index:-1).filter(n=>n>=0);
        if(positions.length!==1)throw Error('Claimed number is not unique');
        const target=pages.find(p=>id(p)===expectedIds[positions[0]]);
        assessment=assessBodyClaim(await readViews(fs.readFileSync(claim.file)),pages,target);
      } catch {assessment={status:'body-reader-unavailable',bindingVerified:false};}
      results.push({...originals[i],...assessment});
      onProgress?.(`正文归属检查：${i+1}/${claims.length} 张完成。`);
    }
    verifySources();
  } catch {
    // Missing models, partial PDF reads and source changes are failures, not
    // "no conflicting text". Discard apparent passes from an invalid corpus.
    results.splice(0,results.length,...originals.map(v=>({...v,status:'body-reader-unavailable'})));
  } finally {if(reader)try {await reader.release();}catch{}}
  for(let i=0;i<claims.length;i++)retainBodyReview(claims[i],results[i]);
  onProgress?.(`正文读取统计：本机缓存复用 ${cacheHits} 项，实际识别 ${freshReads} 项；归属仍以本次 PDF 核对结果为准。`);
  return {status:'veto-only-not-order-binding',attempted:claims.length,
    blocked:claims.filter(bodyReviewBlockReason).length,cacheHits,freshReads,seconds:(Date.now()-started)/1000,results};
}
