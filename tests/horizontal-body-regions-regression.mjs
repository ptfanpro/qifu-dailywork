import assert from 'node:assert/strict';
import {test} from 'node:test';
import {horizontalBodyCrop} from '../src/vertical-body-regions.mjs';

const physicalRegion = (width, height) => ({left: 50 / width, top: 50 / height, width: 60 / width, height: 20 / height});
test('the same physical line has the same crop on portrait, square and landscape canvases', () => {
  for (const [width, height] of [[800, 200], [200, 800], [400, 400]]) {
    assert.deepEqual(horizontalBodyCrop(physicalRegion(width, height), {width, height}, .5),
      {left: 40, top: 40, width: 80, height: 40});
  }
});
test('a physically vertical region is not a horizontal line on a narrow portrait canvas', () => {
  assert.equal(horizontalBodyCrop({left: .1, top: .1, width: .16, height: .1}, {width: 200, height: 800}, .5), null);
});
test('padding uses line height in pixels for both axes and clips at the image boundary', () => {
  assert.deepEqual(horizontalBodyCrop({left: .1, top: .1, width: .3, height: .1}, {width: 400, height: 200}, .5),
    {left: 30, top: 10, width: 140, height: 40});
  assert.deepEqual(horizontalBodyCrop({left: 0, top: 0, width: 1, height: .1}, {width: 400, height: 200}, .5),
    {left: 0, top: 0, width: 400, height: 30});
});
test('existing height limit is retained and invalid geometry fails closed', () => {
  assert.equal(horizontalBodyCrop({left: .1, top: .1, width: .5, height: .13}, {width: 400, height: 200}, .5), null);
  const region = physicalRegion(400, 400);
  for (const value of [0, -1, NaN, Infinity, 2.5]) {
    assert.throws(() => horizontalBodyCrop(region, {width: value, height: 400}, .5), /dimensions/);
  }
  for (const value of [-1, NaN, Infinity, 1.1]) assert.throws(() => horizontalBodyCrop(region, {width: 400, height: 400}, value), /padding/);
  for (const value of [null, {...region, width: 0}, {...region, left: NaN}, {...region, top: .99}]) {
    assert.throws(() => horizontalBodyCrop(value, {width: 400, height: 400}, .5), /region/);
  }
});
