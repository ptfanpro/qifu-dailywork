import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compareReplayRows} from './verify-replay-comparison.mjs';
const row=(sha256,assigned=null,kind=null)=>({sha256,assigned,kind});
test('replay comparison distinguishes new assignments, losses, and remaps, not just total count',()=>{
  const before=[row('a','1.jpg','blessing'),row('b'),row('c','2.1.jpg','scene-lamp'),row('d','3.jpg','blessing')];
  const after=[row('a'),row('b','4.jpg','blessing'),row('c','2.5.jpg','scene-water'),row('d','3.jpg','blessing')];
  const result=compareReplayRows(before,after);
  assert.equal(result.added,1);assert.equal(result.removed,1);assert.equal(result.reassigned,1);
  assert.equal(result.changes.length,3);
  assert.equal(compareReplayRows(before,structuredClone(before)).changes.length,0);
});
test('replay comparison rejects changed photo identity or ordering before reporting improvements',()=>{
  assert.throws(()=>compareReplayRows([row('a'),row('b')],[row('a'),row('c')]));
  assert.throws(()=>compareReplayRows([row('a'),row('b')],[row('b'),row('a')]));
  assert.throws(()=>compareReplayRows([row('a')],[row('a'),row('a')]));
});
