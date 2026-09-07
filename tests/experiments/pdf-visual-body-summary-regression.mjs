import assert from 'node:assert/strict';
import {summarizeVisualBodyComparison} from './pdf-visual-body-summary.mjs';
import {visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
const pdfSha256 = 'a'.repeat(64), sourceFingerprint = 'b'.repeat(64), modelSha256 = 'c'.repeat(64);
const pageSummaries = [1, 2].map(pageNumber => ({pdfSha256, pageNumber}));
const completion = {status: 'diagnostic-only-not-binding', sourceUnchanged: true, sourceFingerprint, modelSha256,
  date: '2026-01-25', photos: 1, pages: 2, pdfs: 1, pageSummaries, visual: {counts: {fabricated: 100}}};
const report = () => ({sourceFingerprint, modelSha256, date: completion.date, photoSha256: 'd'.repeat(64),
  status: completion.status, sourceUnchanged: true, expectedLayouts: ['horizontal', 'vertical'],
  results: visualBodyViewNames.map(view => ({view, readerAvailable: true, batchErrorCount: 0, truncated: false,
    totalPages: 2, textBearingPages: 2, topUniqueTieCount: 1,
    ranked: pageSummaries.map(p => ({...p, uniqueMatchedGrams: p.pageNumber === 1 ? 2 : 0}))}))});
const pair = () => ({textOnly: report(), visual: report()});
assert.deepEqual(summarizeVisualBodyComparison(completion, [pair()]).visualCounts, {'stable-diagnostic-candidate': 1});
assert.throws(() => summarizeVisualBodyComparison(completion, []), /Incomplete/);
assert.throws(() => summarizeVisualBodyComparison({...completion, sourceUnchanged: false}, [pair()]), /Incomplete/);
assert.throws(() => summarizeVisualBodyComparison({...completion, pageSummaries: [pageSummaries[0], pageSummaries[0]]}, [pair()]), /page set/);
for (const mutate of [p => { p.visual.photoSha256 = 'e'.repeat(64); },
  p => { p.visual.sourceFingerprint = 'f'.repeat(64); },
  p => { p.visual.date = '2026-01-26'; },
  p => { p.visual.results[0].ranked[1].pdfSha256 = 'e'.repeat(64); },
  p => { p.visual.expectedLayouts = ['horizontal']; }]) {
  const p = pair(); mutate(p); assert.throws(() => summarizeVisualBodyComparison(completion, [p]));
}
console.log('visual PDF A/B summary regression passed (exact photo and page identities)');
