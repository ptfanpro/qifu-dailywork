import test from 'node:test';
import assert from 'node:assert/strict';
import {patchBytes} from './siglip2-patches.mjs';

test('patch grid serialization is finite, little-endian and does not silently accept pooled output',()=>{
 const data=new Float32Array(2*196*768).fill(.125);data[768]=-.25;
 const bytes=patchBytes({dims:[2,196,768],data});
 assert.equal(bytes.length,data.length*4);assert.equal(bytes.readFloatLE(768*4),-.25);
 assert.throws(()=>patchBytes({dims:[2,768],data}));
 assert.throws(()=>patchBytes({dims:[2,196,768],data:data.slice(1)}));
 data[10]=NaN;assert.throws(()=>patchBytes({dims:[2,196,768],data}));
});
