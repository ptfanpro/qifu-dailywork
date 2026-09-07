import assert from 'node:assert/strict';
import {bodyTextGrams, rankBodyTextEvidence} from './body-text-evidence.mjs';
const pdfSha256 = 'a'.repeat(64);
const pages = [
  {pdfSha256, pageNumber: 1, text: '祈福共用模板。春山测试甲乙。267-1-6'},
  {pdfSha256, pageNumber: 2, text: '祈福共用模板。秋水测试丙丁。267-1-8'},
];
const result = rankBodyTextEvidence('267-1-8 祈福共用模板。春 山 测 试 甲 乙', pages);
assert.equal(result.ranked[0].pageNumber, 1, 'Content is compared independently from the printed number');
assert.equal(result.status, 'diagnostic-only-not-binding');
assert.equal(Object.hasOwn(result, 'assignedNumber'), false);
assert.equal(result.ranked[1].uniqueMatchedGrams, 0, 'Shared template text is not unique proof');
assert.equal(rankBodyTextEvidence('267-1-8', pages).observedGrams, 0);
assert.equal(rankBodyTextEvidence('祈福共用模板', pages).topUniqueTieCount, 2);
assert.equal(rankBodyTextEvidence('', pages).topUniqueTieCount, 2);
assert.equal(rankBodyTextEvidence('春山测试甲乙', [pages[0], {...pages[0], pageNumber: 2}]).topUniqueTieCount, 2);
assert.equal(rankBodyTextEvidence('春山测试甲乙', [{...pages[0], text: ''}]).textBearingPages, 0);
const mixedLayerPages = [
  {pdfSha256, pageNumber: 1, text: '共用模板测试。春山测试甲乙'},
  {pdfSha256, pageNumber: 2, text: '秋水测试丙丁', supplementalText: ['共用模板测试']},
];
assert.equal(rankBodyTextEvidence('共用模板测试', mixedLayerPages).ranked[0].uniqueMatchedGrams, 0,
  'Visible template text absent from one PDF text layer is not unique to another page');
assert.equal(rankBodyTextEvidence('秋水测试丙丁。共用模板测试', mixedLayerPages).ranked[0].pageNumber, 2);
assert.equal(rankBodyTextEvidence('春山测试', [{pdfSha256, pageNumber: 1, text: '春山', supplementalText: ['测试']}]).ranked[0].matchedGrams, 0,
  'Do not invent body phrases by concatenating separate extraction sources');
assert.throws(() => rankBodyTextEvidence('', [{...pages[0], supplementalText: 'invalid'}]), /supplemental/i);
assert.equal(bodyTextGrams('春山123测试').size, 0, 'Do not create matches across numeric boundaries');
assert.deepEqual(bodyTextGrams('春 山 测 试'), bodyTextGrams('春山测试'));
assert.equal(bodyTextGrams('春山\n测试').size, 0, 'Separate OCR lines are not a four-character phrase');
const fragmentedPage = {pdfSha256, pageNumber: 1, text: '春山 测试', fieldTexts: ['春山', '测试']};
assert.equal(rankBodyTextEvidence('春山测试', [fragmentedPage]).observedGrams, 1);
assert.equal(rankBodyTextEvidence('春山测试', [fragmentedPage]).ranked[0].matchedGrams, 0,
  'PDF extraction order is not evidence that separate items are one phrase');
assert.equal(rankBodyTextEvidence('春山测试', [{...fragmentedPage, supplementalText: ['春山测试']}]).ranked[0].matchedGrams, 1,
  'A real visible line may restore a phrase, independently of glyph extraction');
assert.throws(() => rankBodyTextEvidence('', [{...fragmentedPage, fieldTexts: [null]}]), /field/i);
assert.throws(() => rankBodyTextEvidence('', [pages[0], pages[0]]), /Duplicate/);
assert.throws(() => rankBodyTextEvidence('', [{...pages[0], pdfSha256: ''}]), /identity/);
assert.throws(() => bodyTextGrams('春山', 2), /three/);
const serialized = JSON.stringify(result);
assert.ok(!serialized.includes('春山') && !serialized.includes('祈福'));
assert.ok(!serialized.includes('267-1-8'), 'Public diagnostics must not include source text');
console.log('body-text-evidence regression passed (diagnostic only)');
