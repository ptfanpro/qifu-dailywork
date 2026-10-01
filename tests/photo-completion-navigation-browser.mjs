import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {PrayerSite} from '../src/site.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  for(const [kind,changesState] of [['lamp',true],['tablet',true],['lamp',false]]){
    const page=await browser.newPage();
    let requests=0,completed=false,queries=0,injected=false;
    const row={id:'synthetic-order',productName:kind==='tablet'?'长生禄位':'祈福灯'};
    const site=new PrayerSite('fixture',{count(){}},()=>{});site.page=page;
    page.on('dialog',dialog=>dialog.accept());
    await page.route('http://fixture.test/**',async route=>{
      if(route.request().url().endsWith('/complete')){
        assert.equal(route.request().method(),'POST');requests++;completed=changesState;
        return route.fulfill({contentType:'application/json',body:'{"ok":true}'});
      }
      return route.fulfill({contentType:'text/html; charset=utf-8',body:`
        <input id="checked_all" type="checkbox" onchange="document.querySelector('[name=ids]').checked=this.checked">
        <input name="ids" value="synthetic-order" type="checkbox">
        <button onclick="if(confirm('批量完成确认'))fetch('/complete',{method:'POST'})">批量完成</button>`});
    });
    await page.goto('http://fixture.test/list');
    const query=async()=>{
      queries++;
      if(completed&&queries===2)throw Error('Execution context was destroyed, most likely because of a navigation');
      return completed?[]:[row];
    };
    site.queryUploadedOrders=query;site.queryUploadedTabletOrders=query;
    const originalLocator=page.locator.bind(page);
    page.locator=(selector,...args)=>{
      const locator=originalLocator(selector,...args);
      if(!selector.includes('layui-layer-btn0'))return locator;
      return new Proxy(locator,{get(target,key){
        if(key==='elementHandles')return async()=>{
          if(!injected){
            const deadline=Date.now()+1000;while(!requests&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
            assert.equal(requests,1,'batch was already submitted before the context race');
            injected=true;
            await page.goto('http://fixture.test/done');
            throw Error('locator.elementHandles: Execution context was destroyed, most likely because of a navigation');
          }
          return target.elementHandles();
        };
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
    };
    try {
      const method=kind==='tablet'?'completeUploadedTabletOrders':'completeUploadedPhotoOrders';
      const run=site[method]('2026-09-30',1,PrayerSite.manifest([row],'2026-09-30').orderIdHash);
      if(changesState)assert.equal(await run,1);
      else await assert.rejects(run,/仍有 1 条订单未完成/);
      assert.equal(injected,true);
      assert.equal(requests,1,'context recovery must never resubmit the write');
      assert.ok(queries>=2,'completion must be verified online after the race');
      if(changesState){assert.equal(await site[method]('2026-09-30',1),1);assert.equal(requests,1,'restart verification must not submit again')}
    } finally {await page.close()}
  }
  // A layer confirmation navigates to a new page with an unrelated confirmation.
  // The new page's button must never be accepted as part of the old operation.
  const page=await browser.newPage();let oldClicks=0,newClicks=0;
  await page.route('http://boundary.test/**',async route=>route.fulfill({contentType:'text/html',body:route.request().url().endsWith('/new')
    ? '<button onclick="fetch(\'/unrelated\')">确认</button>'
    : '<div class="layui-layer"><div class="layui-layer-btn"><a class="layui-layer-btn0" onclick="location.href=\'/new\'">确定</a></div></div>'}));
  page.on('request',request=>{if(request.url().endsWith('/new'))oldClicks++;if(request.url().endsWith('/unrelated'))newClicks++});
  await page.goto('http://boundary.test/old');
  const site=new PrayerSite('fixture',{count(){}},()=>{});site.page=page;
  await site.autoSiteConfirm(1500);
  assert.equal(oldClicks,1);assert.equal(newClicks,0,'confirmation polling must stop at main-page navigation');
  await page.close();
  console.log('Photo completion navigation browser PASS: lamp/tablet, failed postcondition, restart idempotency and new-page boundary');
} finally {await browser.close()}
