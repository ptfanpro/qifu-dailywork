import assert from 'node:assert/strict';
import {positionedLayoutFailureCode} from '../src/body-content-review.mjs';

const cases=[
  ['Positioned layout budget exceeded','positioned-layout-budget'],
  ['Positioned image budget exceeded','positioned-layout-budget'],
  ['Positioned layout timed out','positioned-layout-timeout'],
  ['Layout worker failed','positioned-layout-worker-failed'],
  ['Layout result or runtime integrity verification failed','positioned-layout-result-invalid'],
  ['Runtime asset integrity mismatch','positioned-layout-runtime-integrity'],
  ['Runtime directory missing or linked','positioned-layout-runtime-unavailable'],
  ['Positioned photo geometry identity mismatch','positioned-layout-input-binding'],
  ['Body/image dimensions disagree','positioned-layout-input-binding'],
  ['Incomplete or duplicated positioned PDF corpus','positioned-layout-incomplete-corpus'],
  ['Positioned layout observation is not fresh','positioned-layout-incomplete-corpus'],
  ['Missing positioned image bytes','positioned-layout-invalid-input'],
  ['unexpected internal condition','positioned-layout-unknown'],
];
for(const [message,expected] of cases)assert.equal(positionedLayoutFailureCode(new Error(message)),expected);
assert.doesNotMatch(JSON.stringify(cases.map(([message])=>positionedLayoutFailureCode(new Error(message)))),/[A-Z]:\\|客户|微信图片/);
console.log(`Positioned layout failure regression passed: ${cases.length}`);
