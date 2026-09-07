// Local browser fixture: no production URLs, account, cookies, or writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {PrayerSite} from '../src/site.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage();
  const site=new PrayerSite('',{count(){}},()=>{});
  site.page=page;
  site.listSearchTimeoutMs=5000;
  let behavior='normal';
  const html=(date='2026-09-05')=>`<form id="keyWordForm" method="post" action="/blessing/list">
    <input name="startTime" id="startTime" value="${date}">
    <input name="endTime" id="endTime" value="2026-09-06">
    <input name="handelType" value="00"><input name="type" value="blessing">
    <select id="upload" name="upload"><option value="01">已上传</option></select>
    <select id="upload1" name="upload1"><option value="00">未上传</option></select>
    <input type="submit" value="检索" ${behavior==='no-submit'?'onclick="event.preventDefault()"':''}>
    </form><table><tr><td>Fixture</td></tr></table>`;
  await page.route('http://fixture.test/**',async route=>{
    if(behavior==='http-error' && route.request().method()==='POST') return route.fulfill({status:500,body:'error'});
    await route.fulfill({contentType:'text/html; charset=utf-8',body:html(behavior==='wrong-date' && route.request().method()==='POST'?'2026-09-04':'2026-09-05')});
  });
  for(const mode of ['normal','wrong-date','http-error','no-submit']) {
    behavior=mode;
    await page.goto('http://fixture.test/blessing/list');
    if(mode==='normal') await site.submitListSearch();
    else await assert.rejects(()=>site.submitListSearch(),undefined,`${mode} must never masquerade as an empty order list`);
  }
  console.log('List query browser regressions PASS (4 cases)');
} finally { await browser.close(); }
