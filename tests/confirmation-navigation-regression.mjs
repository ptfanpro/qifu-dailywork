import assert from 'node:assert/strict';
import {PrayerSite} from '../src/site.mjs';

const siteFor=(error)=>{
  const site=Object.create(PrayerSite.prototype);
  site.layerMessages=[];site.timing={count(){throw Error('no click should be retried during navigation')}};site.log=()=>{};
  site.page={locator:selector=>selector.includes('layui-layer-msg')
    ? {allInnerTexts:async()=>[]}
    : {elementHandles:async()=>{throw error}}};
  return site;
};
for(const message of [
  'locator.elementHandles: Execution context was destroyed, most likely because of a navigation',
  'Cannot find context with specified id',
  'locator.elementHandles: Unable to adopt element handle from a different document',
])assert.equal(await siteFor(Error(message)).autoSiteConfirm(50),0,'navigation must end confirmation discovery, leaving success to online verification');
await assert.rejects(()=>siteFor(Error('unexpected selector failure')).autoSiteConfirm(50),/unexpected selector failure/);
console.log('Confirmation navigation regression PASS: destroyed context stops discovery; unrelated errors propagate');
