import assert from 'node:assert/strict';
import {compareBodyFieldEvidence} from './body-field-evidence.mjs';
import {bodyTextGrams} from './body-text-evidence.mjs';
import {visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
const page = (pageNumber, fieldTexts, supplementalText = []) => ({pdfSha256: 'a'.repeat(64), pageNumber, fieldTexts, supplementalText});
const views = (text, second = text, vertical = '') => visualBodyViewNames.map((view, i) => ({view,
  text: i === 0 ? text : i === 1 ? second : vertical, errors: 0, truncated: false}));
const pages = [page(1, ['王小宁', '阖家平安']), page(2, ['陈小安', '阖家平安'])];
assert.equal(bodyTextGrams('王小宁').size, 0, 'The existing four-character diagnostic omits this readable short field');
const result = compareBodyFieldEvidence(views('王小宁。阖家平安'), pages);
assert.equal(result.state, 'single-page-field-candidate');
assert.equal(result.readings[0].ranked[0].shortSpecificFields, 1);
assert.equal(result.readings[0].ranked[0].specificExactFields, 1, 'Shared prayer is not identity');
assert.equal(result.readings[0].ranked[0].observedAllExtractedDistinctFields, true);
assert.equal(result.status, 'diagnostic-only-not-binding');
assert.equal(Object.hasOwn(result, 'assignedNumber'), false);
assert.equal(Object.hasOwn(result, 'safeToApply'), false);
assert.equal(compareBodyFieldEvidence(views('王小宁'), [pages[0], page(2, ['陈王小宁合家'])]).state,
  'no-specific-field-evidence', 'A name inside another longer field is not page-unique');
assert.equal(compareBodyFieldEvidence(views('王小宁'), [pages[0], page(2, ['陈小安'], ['王小宁祈福'])]).state,
  'no-specific-field-evidence', 'Visible template text excluded even if absent from other text layer');
assert.equal(compareBodyFieldEvidence(views('阖家平安'), pages).state, 'no-specific-field-evidence');
assert.equal(compareBodyFieldEvidence(views('王小宁'), [pages[0], page(2, ['王小宁', '不同正文'])]).state,
  'no-specific-field-evidence', 'Repeated customer cannot disambiguate distinct orders');
assert.equal(compareBodyFieldEvidence(views('王小宁'), [page(1, ['王小', '宁']), pages[1]]).state,
  'no-specific-field-evidence', 'Never glue separate fields into one name');
assert.equal(compareBodyFieldEvidence(views('王小。宁'), pages).state, 'no-specific-field-evidence');
assert.equal(compareBodyFieldEvidence(views('王123小宁'), pages).state, 'no-specific-field-evidence');
assert.equal(compareBodyFieldEvidence(views('王小宁合家'), pages).state, 'no-specific-field-evidence',
  'Observed longer line is not exact short field evidence');
assert.equal(compareBodyFieldEvidence(views('王 小 宁'), pages).state, 'single-page-field-candidate');
assert.equal(compareBodyFieldEvidence(views('王小\n宁'), pages).state, 'no-specific-field-evidence',
  'Separate OCR lines must not manufacture an exact name');
assert.equal(compareBodyFieldEvidence(views('王小\r\n宁'), pages).state, 'no-specific-field-evidence');
assert.equal(compareBodyFieldEvidence(views('王小\u2028宁'), pages).state, 'no-specific-field-evidence');
assert.equal(compareBodyFieldEvidence(views('王小宁。陈小安'), pages).state, 'multiple-page-field-evidence',
  'Old page split across current pages must retain both candidates');
assert.equal(compareBodyFieldEvidence(views('王小宁', '陈小安'), pages).state, 'inconsistent-field-views');
assert.equal(compareBodyFieldEvidence(views('王小宁', ''), pages).state, 'inconsistent-field-views');
assert.equal(compareBodyFieldEvidence(views('王小宁', '王小宁', '陈小安'), pages).state, 'inconsistent-field-views');
const repeated = compareBodyFieldEvidence(views('王小宁'), [page(1, ['王小宁', '王小宁'])]);
assert.equal(repeated.readings[0].ranked[0].extractedFields, 2);
assert.equal(repeated.readings[0].ranked[0].distinctExtractedFields, 1);
assert.equal(Object.hasOwn(repeated, 'bindingVerified'), false, 'Distinct-field coverage does not prove order multiplicity');
assert.throws(() => compareBodyFieldEvidence(views(''), [pages[0], pages[0]]), /Duplicate/);
assert.throws(() => compareBodyFieldEvidence(views('').slice(1), pages), /Incomplete/);
assert.throws(() => compareBodyFieldEvidence(views('').map(v => ({...v, errors: 1})), pages), /Failed/);
assert.throws(() => compareBodyFieldEvidence(views('').map(v => ({...v, truncated: true})), pages), /truncated/);
assert.throws(() => compareBodyFieldEvidence(views(''), [page(1, null)]), /corpus/);
assert.throws(() => compareBodyFieldEvidence(views(''), [page(1, ['测试'], null)]), /corpus/);
assert.ok(!JSON.stringify(result).includes('王小宁') && !JSON.stringify(result).includes('阖家'));
assert.deepEqual(pages, [page(1, ['王小宁', '阖家平安']), page(2, ['陈小安', '阖家平安'])]);
console.log('body field evidence regression passed (diagnostic only)');
