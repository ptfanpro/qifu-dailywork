import assert from 'node:assert/strict';
import {embeddedChineseDictionary} from './chinese-text-reader.mjs';
const field = (tag, text) => {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text);
  assert.ok(bytes.length < 128);
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
};
const entry = Buffer.concat([field(10, 'character'), field(18, '春\n山\n秋\n水\n')]);
const model = field(114, entry);
assert.deepEqual(embeddedChineseDictionary(model), ['春', '山', '秋', '水']);
assert.throws(() => embeddedChineseDictionary(Buffer.concat([model, model])), /duplicate/);
assert.throws(() => embeddedChineseDictionary(Buffer.alloc(0)), /Missing/);
assert.throws(() => embeddedChineseDictionary(model.subarray(0, -1)), /Truncated/);
assert.throws(() => embeddedChineseDictionary(Buffer.from([0])), /field/);
assert.throws(() => embeddedChineseDictionary(Buffer.from([15])), /wire/);
assert.throws(() => embeddedChineseDictionary(Buffer.from([9])), /Truncated/);
assert.throws(() => embeddedChineseDictionary(Buffer.from([128])), /Truncated/);
assert.throws(() => embeddedChineseDictionary(field(114, Buffer.concat([field(10, 'character'), field(18, '春\n\n山')]))), /Empty/);
console.log('Chinese reader metadata regression passed (no model loaded)');
