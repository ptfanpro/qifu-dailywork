import assert from 'node:assert/strict';
import {summarizeBodyProbeReports} from './body-probe-summary.mjs';
const reading = view => ({view, readerAvailable: true, batchErrorCount: 0, truncated: false,
  totalPages: 2, textBearingPages: 2, topUniqueTieCount: 1,
  ranked: [{pdfSha256: 'a'.repeat(64), pageNumber: 1, uniqueMatchedGrams: 2}]});
const report = () => ({sourceFingerprint: 'b'.repeat(64), modelSha256: 'c'.repeat(64),
  photoSha256: 'd'.repeat(64), date: '2026-09-03', sourceUnchanged: true,
  status: 'diagnostic-only-not-binding', results: ['chinese-detected-0.35', 'chinese-detected-0.65'].map(reading)});
const outcome = value => summarizeBodyProbeReports([value]).outcomes[0].state;
assert.equal(outcome(report()), 'stable-diagnostic-candidate');
for (const field of ['readerAvailable', 'truncated']) {
  const value = report(); value.results[0][field] = field === 'truncated';
  assert.equal(outcome(value), 'incomplete-reader-evidence');
}
const missingTruncation = report(); delete missingTruncation.results[0].truncated;
assert.equal(outcome(missingTruncation), 'incomplete-reader-evidence');
const error = report(); error.results[0].batchErrorCount = 1;
assert.equal(outcome(error), 'incomplete-reader-evidence');
const missing = report(); missing.results.pop();
assert.equal(outcome(missing), 'incomplete-reader-evidence');
const repeatedView = report(); repeatedView.results.push(repeatedView.results[0]);
assert.equal(outcome(repeatedView), 'incomplete-reader-evidence');
const pdfText = report(); pdfText.results[1].textBearingPages = 1;
assert.equal(outcome(pdfText), 'incomplete-pdf-text');
const disagree = report(); disagree.results[1].ranked[0].pageNumber = 2;
assert.equal(outcome(disagree), 'ambiguous-or-disagreeing-views');
const tied = report(); tied.results[1].topUniqueTieCount = 2;
assert.equal(outcome(tied), 'ambiguous-or-disagreeing-views');
const empty = report(); empty.results.forEach(r => { r.ranked[0].uniqueMatchedGrams = 0; });
assert.equal(outcome(empty), 'no-unique-body-evidence');
const changed = report(); changed.sourceUnchanged = false;
assert.throws(() => summarizeBodyProbeReports([changed]), /changed-source/);
const mixed = report(); mixed.sourceFingerprint = 'f'.repeat(64);
assert.throws(() => summarizeBodyProbeReports([report(), mixed]), /Mixed/);
assert.throws(() => summarizeBodyProbeReports([report(), report()]), /Duplicate/);
assert.throws(() => summarizeBodyProbeReports([]), /No completed/);
const serialized = JSON.stringify(summarizeBodyProbeReports([report()]));
assert.equal(serialized.includes('assignedNumber'), false);
assert.equal(serialized.includes('accuracy'), false);
console.log('body probe summary regression passed (availability is not binding)');
