import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBodyClaim} from '../src/body-content-review.mjs';
import {rankBodyTextEvidence} from '../src/body-text-evidence.mjs';
import {buildVisualBodyPages,visualBodyViewNames} from '../src/pdf-visual-body-evidence.mjs';
const views=(...texts)=>visualBodyViewNames.map((view,i)=>({view,text:texts[i]||'',errors:0,truncated:false}));
const corpus=(foreignViews,foreignFields=['共同模板'])=>buildVisualBodyPages([
  {pdfSha256:'a'.repeat(64),pageNumber:1,fieldTexts:['山川草木春风秋雨','往生净土']},
  {pdfSha256:'a'.repeat(64),pageNumber:2,fieldTexts:foreignFields},
],[
  {pdfSha256:'a'.repeat(64),pageNumber:1,views:views('山川草木春风秋雨。往生净土','山川草木春风秋雨。往生净土')},
  {pdfSha256:'a'.repeat(64),pageNumber:2,views:foreignViews},
]);

test('one uncorroborated PDF OCR typo cannot masquerade as a foreign page identity',()=>{
  const pages=corpus(views('往生净士','往生净土'));
  const result=assessBodyClaim(views('山川草木春风秋雨。往生净士','山川草木春风秋雨。往生净士'),pages,pages[0]);
  assert.equal(result.status,'observed-body-consistent');
  assert.equal(result.bindingVerified,false);
  const foreign=result.results[0].ranked.find(p=>p.pageNumber===2);
  assert.equal(foreign.uniqueMatchedGrams,1,'keep the original contrary observation');
  assert.equal(foreign.corroboratedUniqueMatchedGrams,0);
  assert.equal(result.uncorroboratedForeignEvidence.length,2);
  assert.doesNotMatch(JSON.stringify(result),/净士|春风/);
});

test('extracted or paired visible foreign content still blocks and never changes a number',()=>{
  for(const pages of [corpus(views('往生净士',''),['往生净士']),corpus(views('往生净士','往生净士')),
    corpus(views('','','往生净士','往生净士'))]){
    assert.equal(assessBodyClaim(views('山川草木春风秋雨。往生净士','山川草木春风秋雨。往生净士'),pages,pages[0]).status,'conflicting-body');
    assert.equal(assessBodyClaim(views('往生净士'),pages,pages[0]).status,'ambiguous-body');
  }
});

test('different orientations, source fragments and unbound supplemental text do not corroborate',()=>{
  for(const pages of [corpus(views('往生净士','','往生净士','')),corpus(views('往生\n净士','往生\n净士'))]){
    const result=rankBodyTextEvidence('往生净士',pages).ranked.find(p=>p.pageNumber===2);
    assert.equal(result.corroboratedUniqueMatchedGrams,0);
  }
  const page={pdfSha256:'c'.repeat(64),pageNumber:1,fieldTexts:['往生','净士'],supplementalText:['往生净士','往生净士']};
  const result=rankBodyTextEvidence('往生净士',[page]).ranked[0];
  assert.equal(result.matchedGrams,1);assert.equal(result.corroboratedUniqueMatchedGrams,0);
});

test('raw mentions on other pages still prevent a corroborated phrase becoming falsely unique',()=>{
  const pages=corpus(views('往生净土',''),['共同模板']);
  const result=rankBodyTextEvidence('往生净土',pages).ranked;
  assert(result.every(p=>p.uniqueMatchedGrams===0&&p.corroboratedUniqueMatchedGrams===0));
});

test('failed, duplicate, truncated or mismatched PDF view identity is rejected',()=>{
  for(const mutate of [p=>p.visibleFieldViews[1].view=p.visibleFieldViews[0].view,
    p=>p.visibleFieldViews[1].errors=1,p=>p.visibleFieldViews[1].truncated=true,
    p=>p.visibleFieldViews[1].text='different',p=>p.visibleFieldViews.pop()]){
    const pages=corpus(views('往生净士','往生净士'));mutate(pages[1]);
    assert.throws(()=>rankBodyTextEvidence('往生净士',pages),/PDF.*(view|source)|visual/i);
  }
});
