import assert from 'node:assert/strict';
import {PrayerSite, matchesBusinessPageIdentity} from '../src/site.mjs';

const target='https://admin.stqifu.com/blessing/list?handelType=00&type=blessing';
assert.equal(matchesBusinessPageIdentity(target,'https://admin.stqifu.com/blessing/list','供灯福单'),false,
  'a loaded lamp page must not impersonate the pending blessing page');
assert.equal(matchesBusinessPageIdentity(target,target,'未处理福单'),true);
assert.equal(matchesBusinessPageIdentity(target,'https://admin.stqifu.com/blessing/list','未处理福单'),true,
  'a site redirect may remove the query string while retaining the correct business page');

function fakeSite(outcomes) {
  let currentUrl='https://admin.stqifu.com/main',title='后台主页',gotoCalls=0;
  const logs=[];
  const page={
    isClosed:()=>false,
    url:()=>currentUrl,
    title:async()=>title,
    locator:(selector)=>({
      count:async()=>selector.includes('#startTime') && currentUrl.includes('/blessing/list') ? 1 : 0,
      isVisible:async()=>false,
    }),
    getByText:(value)=>({count:async()=>String(value)==='日常管理'?1:0}),
    goto:async()=>{
      const outcome=outcomes[gotoCalls++]||outcomes.at(-1)||{};
      currentUrl=outcome.url||currentUrl;
      title=outcome.title||title;
      if(outcome.error)throw new Error(outcome.error);
    },
  };
  return {
    browser:{isConnected:()=>true},page,autoLoginAttempted:true,credentialPath:null,loginTimeoutMs:10000,
    cleanupTransientPages:async()=>{},log:message=>logs.push(message),timing:{count:()=>{}},
    calls:()=>gotoCalls,logs,
  };
}

const aborted=fakeSite([{url:target,title:'未处理福单',error:'page.goto: net::ERR_ABORTED'}]);
await PrayerSite.prototype.waitForLogin.call(aborted,target);
assert.equal(aborted.calls(),1,'an aborted goto that still lands on target should be accepted after verification');

const wrongPage=fakeSite([
  {url:'https://admin.stqifu.com/blessing/list',title:'供灯福单',error:'page.goto: net::ERR_ABORTED'},
  {url:target,title:'未处理福单'},
]);
await PrayerSite.prototype.waitForLogin.call(wrongPage,target);
assert.equal(wrongPage.calls(),2,'a wrong business page must trigger another bounded navigation');

const neverLands=fakeSite([{error:'page.goto: net::ERR_ABORTED'}]);
await assert.rejects(PrayerSite.prototype.waitForLogin.call(neverLands,target),/目标业务页.*3.*次/);
assert.equal(neverLands.calls(),3,'navigation retries must be bounded');

const mainTarget='https://admin.stqifu.com/main';
const alreadyOnMain=fakeSite([]);
await PrayerSite.prototype.waitForLogin.call(alreadyOnMain,mainTarget);
assert.equal(alreadyOnMain.calls(),0,'authenticated main page must remain a valid target without list controls');

console.log('Login navigation regression PASS: aborted goto verification, wrong-page rejection, bounded retry');
