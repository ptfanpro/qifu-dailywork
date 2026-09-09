import assert from 'node:assert/strict';
import {test} from 'node:test';
import {photoCaptureTimestamp, isContinuousPhotoCapture, inferPhotoSequences,
  inferPhotoGapsAroundExistingNumbers, reconcileDuplicatePhotoNumbers} from '../src/photo-prepare.mjs';

// Synthetic evidence only. File order / a numeric or anonymized name is not
// evidence of a continuous capture. A timestamp permits a sequence proposal;
// it does not establish the paper identity or authorize an upload.
const fileAt = second => `微信图片_202603011200${String(second).padStart(2, '0')}_sample.jpg`;
const frame = (number, file) => ({file, number, reliable: Number.isInteger(number), candidates: [],
  paperGeometry: {usablePaper: true, rectangularPaper: true, score: .3, boxArea: .5,
    width: .7, height: .7, fill: .8, top: .2}, visualMetrics: {edgeDensity: .2},
  evidence: {method: 'ocr', votes: 3, maxConfidence: 80}});
const numbers = items => items.map(item => item.number);

test('missing capture time must not count as continuity', () => {
  for (const name of [undefined, '', '101.jpg', 'audit_abcdef_0.jpg', 'raw.jpg']) {
    assert.equal(photoCaptureTimestamp(name), null);
    assert.equal(isContinuousPhotoCapture({file: name}, {file: fileAt(2)}), false);
    assert.equal(isContinuousPhotoCapture({file: fileAt(1)}, {file: name}), false);
    assert.equal(isContinuousPhotoCapture({file: name}, {file: name}), false);
  }
});

test('invalid calendar dates cannot roll over into valid capture times', () => {
  for (const value of ['20260230120000', '20260229120000', '20261301120000',
    '20260001120000', '20260300120000', '20260301240000', '20260301126000', '20260301120060']) {
    assert.equal(photoCaptureTimestamp(`微信图片_${value}_sample.jpg`), null, value);
  }
  assert.equal(photoCaptureTimestamp('微信图片_20240229120000_sample.jpg'), Date.UTC(2024, 1, 29, 12));
});

test('valid capture boundaries keep the existing twelve second behavior', () => {
  assert.equal(photoCaptureTimestamp(fileAt(0)), Date.UTC(2026, 2, 1, 12));
  assert.equal(isContinuousPhotoCapture({file: fileAt(0)}, {file: fileAt(12)}), true);
  assert.equal(isContinuousPhotoCapture({file: fileAt(0)}, {file: fileAt(13)}), false);
  assert.equal(isContinuousPhotoCapture({file: fileAt(2)}, {file: fileAt(1)}), false);
});

test('all sequence branches leave unknown-time frames unresolved, retaining anchors', () => {
  for (const seed of [[101, null, 103, null, 105], [105, null, 103, null, 101],
    [101, 102, null, null, null], [101, null, null]]) {
    for (const named of [false, true]) {
      const items = seed.map((n, i) => frame(n, named ? `audit_abcdef_${i}.jpg` : undefined));
      inferPhotoSequences(items, new Set([101, 102, 103, 104, 105]));
      assert.deepEqual(numbers(items), seed);
    }
    const timed = seed.map((n, i) => frame(n, fileAt(i)));
    inferPhotoSequences(timed, new Set([101, 102, 103, 104, 105]));
    const direction = seed[0] === 105 ? -1 : 1;
    assert.deepEqual(numbers(timed), seed.map((_, i) => seed[0] + direction * i));
  }
});

test('unknown timestamps cannot fill a gap between or before existing codes', () => {
  for (const seed of [[101, null, 103], [null, null, 103]]) {
    const items = seed.map((n, i) => frame(n, `audit_abcdef_${i}.jpg`));
    inferPhotoGapsAroundExistingNumbers(items, new Set([101, 102, 103]));
    assert.deepEqual(numbers(items), seed);
    const timed = seed.map((n, i) => frame(n, fileAt(i)));
    inferPhotoGapsAroundExistingNumbers(timed, new Set([101, 102, 103]));
    assert.deepEqual(numbers(timed), [101, 102, 103]);
  }
});

test('the last edge into the right anchor must be continuous too', () => {
  for (const lastFile of [fileAt(40), fileAt(0), '103.jpg']) {
    const items = [frame(101, fileAt(0)), frame(null, fileAt(1)), frame(103, lastFile)];
    inferPhotoGapsAroundExistingNumbers(items, new Set([101, 102, 103]));
    assert.deepEqual(numbers(items), [101, null, 103]);
  }
});

test('one missing timestamp breaks an otherwise timed sequence', () => {
  const items = [101, null, 103, null, 105].map((n, i) => frame(n, i === 1 ? 'unknown.jpg' : fileAt(i)));
  inferPhotoSequences(items, new Set([101, 102, 103, 104, 105]));
  assert.deepEqual(numbers(items), [101, null, 103, null, 105]);
});

test('duplicate correction cannot fabricate a capture sequence from sorted filenames', () => {
  const items = [168, 167, 168, 169].map((n, i) => frame(n, `audit_abcdef_${i}.jpg`));
  const original = numbers(items);
  assert.deepEqual(reconcileDuplicatePhotoNumbers(items, new Set([166, 167, 168, 169])), []);
  assert.deepEqual(numbers(items), original);
  const timed = [168, 167, 168, 169].map((n, i) => frame(n, fileAt(i)));
  assert.deepEqual(reconcileDuplicatePhotoNumbers(timed, new Set([166, 167, 168, 169]))
    .map(({from, to}) => [from, to]), [[168, 166]]);
});
