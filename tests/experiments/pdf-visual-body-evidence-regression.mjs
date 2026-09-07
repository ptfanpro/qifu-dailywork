import assert from 'node:assert/strict';
import {buildVisualBodyPages, visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
import {rankBodyTextEvidence} from './body-text-evidence.mjs';
const pdfSha256 = 'a'.repeat(64);
const pages = [{pdfSha256, pageNumber: 1, text: '共用模板测试。春山测试甲乙'},
  {pdfSha256, pageNumber: 2, text: '秋水测试丙丁'}];
const readings = pages.map(page => ({pdfSha256, pageNumber: page.pageNumber,
  views: visualBodyViewNames.map(view => ({view, errors: 0, truncated: false,
    text: view.startsWith('chinese-vertical') ? '共用模板测试' : ''}))}));
assert.ok(rankBodyTextEvidence('共用模板测试', pages).ranked[0].uniqueMatchedGrams > 0,
  'Reproduce the text-layer-only false unique template evidence');
const before = structuredClone({pages, readings});
const augmented = buildVisualBodyPages(pages, readings);
assert.equal(rankBodyTextEvidence('共用模板测试', augmented).ranked[0].uniqueMatchedGrams, 0);
assert.equal(rankBodyTextEvidence('秋水测试丙丁', augmented).ranked[0].pageNumber, 2);
assert.deepEqual({pages, readings}, before, 'Do not mutate source evidence');
assert.throws(() => buildVisualBodyPages(pages, readings.slice(1)), /Incomplete/);
assert.throws(() => buildVisualBodyPages(pages, [readings[0], readings[0]]), /Duplicate/);
assert.throws(() => buildVisualBodyPages([pages[0], pages[0]], readings), /Duplicate/);
for (const mutation of [r => { r[0].views.pop(); },
  r => { r[0].views[0] = r[0].views[1]; },
  r => { r[0].views[0].errors = 1; },
  r => { r[0].views[0].truncated = true; },
  r => { r[0].views[0].text = null; },
  r => { r[0].pageNumber = 7; }]) {
  const changed = structuredClone(readings); mutation(changed);
  assert.throws(() => buildVisualBodyPages(pages, changed));
}
const serialized = JSON.stringify(rankBodyTextEvidence('秋水测试丙丁', augmented));
assert.ok(!serialized.includes('秋水') && !serialized.includes('共用'));
assert.equal(Object.hasOwn(JSON.parse(serialized), 'assignedNumber'), false);
console.log('visual PDF body corpus regression passed (diagnostic only)');
