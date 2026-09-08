import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {classifyScenes} from '../src/photo-prepare.mjs';
const sharp = createRequire(import.meta.url)('sharp');

// Actual image scoring, generated fixtures only. Occupied names are capacity,
// never evidence that a new or ambiguous photograph belongs to the other kind.
export async function runSceneCategoryCapacityRegression() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qifu-scene-capacity-test-'));
  const fixture = async (name, body) => {
    const file = path.join(root, name);
    await sharp(Buffer.from(`<svg width="160" height="120" xmlns="http://www.w3.org/2000/svg">${body}</svg>`)).jpeg({quality: 92}).toFile(file);
    return file;
  };
  try {
    const lamps = [];
    for (let i = 0; i < 3; i++) lamps.push(await fixture(`lamp-${i}.jpg`, '<rect width="160" height="120" fill="#201408"/><rect x="8" y="38" width="40" height="70" fill="#f2b13c"/>'));
    const water = await fixture('water.jpg', '<rect width="160" height="120" fill="#d8c7a0"/>');
    const unknown = await fixture('unknown.jpg', '<rect width="160" height="120" fill="#666666"/>');
    const unknownDark = await fixture('unknown-dark.jpg', '<rect width="160" height="120" fill="#222222"/>');
    const bothLamps = new Set(['2.1.jpg', '2.2.jpg']);
    const bothWater = new Set(['2.5.jpg', '2.6.jpg']);
    const cases = [
      {name: 'lamp capacity full cannot become water', files: [lamps[0]], occupied: bothLamps, expected: []},
      {name: 'water capacity full cannot become lamp', files: [water], occupied: bothWater, expected: []},
      {name: 'unknown with lamp capacity full', files: [unknown], occupied: bothLamps, expected: []},
      {name: 'unknown with water capacity full', files: [unknown], occupied: bothWater, expected: []},
      {name: 'relative brightness alone is not a category', files: [unknown, unknownDark], occupied: new Set(), expected: []},
      {name: 'extra lamps do not consume water slots', files: [...lamps, water], occupied: new Set(), expected: [[water, '2.5.jpg', 'scene-water']]},
      {name: 'known lamp proceeds beside ambiguous brighter image', files: [unknown, lamps[0]], occupied: new Set(), expected: [[lamps[0], '2.1.jpg', 'scene-lamp']]},
      {name: 'known water proceeds beside ambiguous darker image', files: [water, unknownDark], occupied: new Set(), expected: [[water, '2.5.jpg', 'scene-water']]},
    ];
    for (const test of cases) {
      const result = await classifyScenes(test.files, test.occupied);
      assert.deepEqual(result.assignments.map(x => [x.source, x.targetName, x.kind]), test.expected, test.name);
      assert.ok(result.issues.length > 0, `${test.name}: unresolved sources need explanation`);
    }
    for (const [files, occupied, expected] of [
      [[water], bothLamps, [['2.5.jpg', 'scene-water']]],
      [[lamps[0]], bothWater, [['2.1.jpg', 'scene-lamp']]],
      [[lamps[0]], new Set(['2.1.jpg']), [['2.2.jpg', 'scene-lamp']]],
      [[water], new Set(['2.5.jpg']), [['2.6.jpg', 'scene-water']]],
      [[lamps[1], lamps[0]], new Set(), [['2.1.jpg', 'scene-lamp'], ['2.2.jpg', 'scene-lamp']]],
    ]) {
      const result = await classifyScenes(files, occupied);
      assert.deepEqual(result.assignments.map(x => [x.targetName, x.kind]), expected);
      assert.equal(result.issues.length, 0);
    }
    const source = fs.readFileSync(new URL('../src/photo-prepare.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /remaining-scene-after-two-verified-lamp-scenes|remaining-water-scene-slots|remaining-lamp-scene-slots|scene-brightness-cluster/,
      'verified batches and ordinary supplements must not bypass independent category evidence');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runSceneCategoryCapacityRegression();
  console.log('Scene category/capacity regression passed');
}
