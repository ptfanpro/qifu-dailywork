import assert from 'node:assert/strict';
import {verticalBodyCrop} from './vertical-body-regions.mjs';

// Normalized aspect alone is not the physical shape of a text region.
const box = {left: .2, top: .1, width: .1, height: .2};
assert.ok(verticalBodyCrop(box, {width: 100, height: 200}, .5));
assert.equal(verticalBodyCrop(box, {width: 200, height: 100}, .5), null);
const crop = verticalBodyCrop({left: .1, top: .1, width: .05, height: .5}, {width: 200, height: 100}, .5);
assert.deepEqual(crop, {left: 15, top: 5, width: 20, height: 60, rotation: 270});
const clipped = verticalBodyCrop({left: 0, top: 0, width: .05, height: 1}, {width: 200, height: 100}, .65);
assert.deepEqual(clipped, {left: 0, top: 0, width: 17, height: 100, rotation: 270});
for (const bad of [NaN, Infinity, -1, 0]) {
  assert.throws(() => verticalBodyCrop(box, {width: bad, height: 100}, .5), /dimensions/);
}
for (const bad of [NaN, Infinity, -1]) assert.throws(() => verticalBodyCrop(box, {width: 100, height: 200}, bad), /padding/);
assert.throws(() => verticalBodyCrop({...box, left: NaN}, {width: 100, height: 200}, .5), /region/);
assert.throws(() => verticalBodyCrop({...box, left: .99}, {width: 100, height: 200}, .5), /region/);
assert.throws(() => verticalBodyCrop({...box, width: 0}, {width: 100, height: 200}, .5), /region/);
console.log('vertical body region regression passed (pixel geometry, bounds, orientation)');
