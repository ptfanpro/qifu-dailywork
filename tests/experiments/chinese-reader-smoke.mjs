// Explicit, isolated actual-model smoke test. Never downloads a model and never
// treats an unavailable model as a pass. This is synthetic, not real-photo QA.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createChineseBodyReader} from './chinese-text-reader.mjs';
const sharp = createRequire(import.meta.url)('sharp');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modelRoot = process.argv[2];
if (!modelRoot) throw Error('Explicit private model directory required');
const reader = await createChineseBodyReader(appRoot, modelRoot);
try {
  assert.equal(reader.dictionaryLength, 6623);
  const sample = '春山秋水测试甲乙';
  const image = await sharp({text: {text: sample, font: 'Microsoft YaHei 48', rgba: true}})
    .flatten({background: 'white'}).extend({top: 12, bottom: 12, left: 12, right: 12, background: 'white'}).png().toBuffer();
  assert.equal((await reader.readLine(image)).text, sample);
  const vertical = await sharp({text: {text: [...sample].join('\n'), font: 'Microsoft YaHei 48', rgba: true}})
    .flatten({background: 'white'}).extend({top: 12, bottom: 12, left: 12, right: 12, background: 'white'}).png().toBuffer();
  assert.equal((await reader.readLine(await sharp(vertical).rotate(270).png().toBuffer())).text, sample);
  console.log('Chinese actual-model synthetic smoke passed; not photo binding acceptance');
} finally { await reader.release(); }
