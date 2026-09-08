import assert from 'node:assert/strict';
import {assessBodyClaim,retainBodyReview,bodyReviewBlockReason} from '../src/body-content-review.mjs';
import {visualBodyViewNames,buildVisualBodyPages} from '../src/pdf-visual-body-evidence.mjs';

// Synthetic short fields: the old four-character-only veto sees only the
// shared template, despite reading the other page's whole variable field.
const views=(a,b=a,c='',d=c)=>visualBodyViewNames.map((view,i)=>({view,text:[a,b,c,d][i],errors:0,truncated:false}));
const page=(pageNumber,fieldTexts)=>({pdfSha256:'e'.repeat(64),pageNumber,fieldTexts,supplementalText:[]});
const pages=[page(1,['松柏青','阖家平安']),page(2,['海月明','阖家平安'])];
const wrong=assessBodyClaim(views('海月明。阖家平安'),pages,pages[0]);
assert.equal(wrong.status,'conflicting-body','a readable foreign short field must not bypass the body veto');
assert.equal(wrong.bindingVerified,false);
assert.equal(assessBodyClaim(views('海月明',''),pages,pages[0]).status,'ambiguous-body');
assert.equal(assessBodyClaim(views('松柏青。海月明'),pages,pages[0]).status,'conflicting-body','a partially matching old page may span two current pages');
assert.equal(assessBodyClaim(views('松柏青'),pages,pages[0]).status,'observed-body-consistent');
assert.equal(assessBodyClaim(views('松柏青'),pages,pages[0]).bindingVerified,false,'whole short fields still do not prove order identity');
assert.equal(assessBodyClaim(views('阖家平安'),pages,pages[0]).status,'no-specific-body-evidence');
assert.equal(assessBodyClaim(views('海月明'),[page(1,['海月明祈福']),pages[1]],pages[0]).status,'no-specific-body-evidence','a term inside a longer field elsewhere is not unique');
assert.equal(assessBodyClaim(views('海月\n明'),pages,pages[0]).status,'no-specific-body-evidence');
assert.equal(assessBodyClaim(views('海月明'),[page(1,['海月明']),page(2,['海月明'])],pages[0]).status,'no-specific-body-evidence','identical bodies cannot distinguish repeated orders');
const glyphs=[page(1,['松','柏','青']),page(2,['海','月','明'])];
const visible=buildVisualBodyPages(glyphs,glyphs.map((p,i)=>({...p,views:views('','',''+(i?'海月明':'松柏青'))})));
assert.equal(assessBodyClaim(views('','','海月明'),visible,visible[0]).status,'conflicting-body','paired visible-PDF lines preserve whole-field evidence');
const template=buildVisualBodyPages(pages,pages.map(p=>({...p,views:views('海月明')})));
assert.equal(assessBodyClaim(views('海月明'),template,template[0]).status,'no-specific-body-evidence','visible shared template must not become foreign identity');
const claim={number:1,reliable:true};
retainBodyReview(claim,{schemaVersion:1,claimedNumber:1,photoSha256:'a'.repeat(64),pdfSetDigest:'b'.repeat(64),...wrong});
assert.ok(bodyReviewBlockReason(claim));
assert.equal(claim.number,null,'veto must never assign the alternative page');
assert.doesNotMatch(JSON.stringify(wrong),/松柏青|海月明|阖家平安/);
console.log('Short-field body veto regressions PASS (not order binding)');
