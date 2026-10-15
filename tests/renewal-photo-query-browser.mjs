import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {PrayerSite} from '../src/site.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const rows=[{id:'renewal-a',blessingCode:'synthetic-223'},{id:'renewal-b',blessingCode:'synthetic-224'}];
const date='2026-10-14',scope={businessDate:date,rows,orderIdHash:PrayerSite.manifest(rows,date).orderIdHash};
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage();
 const site=new PrayerSite('',{count(){}},()=>{},{renewalPhotoScope:scope});site.page=page;
 site.waitForLogin=async()=>{};
 let mode='normal',searches=0,mutations=0;
 const inputs=['bCode','orderCode','userId','aTd','startTime','endTime'];
 const selects=['state','supportName','upload','upload1','renewHandelState','templet'];
 const html=(fields={},selectedRow=null)=>`<form method="post" action="/blessing/recharge">
 ${inputs.map(name=>`<input id="${name}" name="${name}" value="${fields[name]??'stale'}">`).join('')}
 ${selects.map(name=>`<select id="${name}" name="${name}"><option value="" ${fields[name]===''?'selected':''}>全部</option><option value="stale" ${fields[name]!==''?'selected':''}>未处理</option></select>`).join('')}
 <input type="submit" value="检索"></form>
 <div>共 ${selectedRow?1:0} 条 <select id="pageSize"><option value="1000">1000</option></select></div>
 <table><thead><tr><th>福单编号</th><th>供养物</th><th>开始日期</th><th>状态</th><th>延续处理状态</th></tr></thead><tbody>
 ${selectedRow?`<tr><td><input type="checkbox" name="ids" value="${mode==='foreign-id'?'foreign':selectedRow.id}">${selectedRow.blessingCode}</td><td>长生禄位</td><td>2026-10-15 00:00:00</td><td>已完成</td><td>已处理</td><td><a onclick="see('https://stqifu-prod.oss-cn-qingdao.aliyuncs.com/service/stqf/blessing/${selectedRow.id}.jpg')">查看</a></td></tr>`:''}
 </tbody></table>`;
 await page.route('https://admin.stqifu.com/**',async route=>{
  const req=route.request();
  if(new URL(req.url()).pathname!=='/blessing/recharge'){mutations++;return route.abort();}
  if(req.method()==='POST'){
   searches++;
   const fields=Object.fromEntries(new URLSearchParams(req.postData()));
   for(const name of [...inputs,...selects].filter(name=>name!=='bCode'))assert.equal(fields[name],'',`${name} must not exclude processed renewals or next-day start dates`);
   const selectedRow=rows.find(row=>row.blessingCode===fields.bCode);
   assert.ok(selectedRow,'queries must use exact codes from the export scope');
   return route.fulfill({contentType:'text/html; charset=utf-8',body:html(fields,selectedRow)});
  }
  return route.fulfill({contentType:'text/html; charset=utf-8',body:html()});
 });
 // Real readRows and real preview extraction; the next-day date is intentional.
 const references=await site.queryUploadedPhotoReferences(date,'renewal');
 assert.equal(references.length,2);assert.equal(searches,2);assert.equal(mutations,0);
 assert.deepEqual(references.map(ref=>ref.kind),['renewal','renewal']);
 assert.ok(references.every(ref=>ref.url));
 mode='foreign-id';
 assert.deepEqual(await site.queryUploadedPhotoReferences(date,'renewal'),[],'a similarly coded record outside the saved ID scope cannot confirm a photo');
 const before=searches;
 await assert.rejects(()=>site.queryUploadedPhotoReferences('2026-10-15','renewal'),/不一致/);
 assert.equal(searches,before,'date mismatch stops before browser queries');
 await page.close();
 console.log('Renewal photo browser PASS: processed next-day records, cleared filters, exact ID allowlist and read-only requests');
}finally{await browser.close();}
