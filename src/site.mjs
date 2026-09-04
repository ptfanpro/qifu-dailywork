import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { listFilesRecursive, waitForNewPdf, verifyPdf } from './pdf.mjs';
import { normalizeText } from './quantity.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const LIST_URL = 'http://admin.stqifu.com/blessing/list?handelType=00&type=blessing';
const TABLET_URL = 'http://admin.stqifu.com/blessing/recharge';
const LAMP_LIST_URL = 'http://admin.stqifu.com/blessing/list?typeCode=qifudeng';
const TABLET_LIST_URL = 'http://admin.stqifu.com/blessing/list?typeCode=paiwei';
const MAIN_URL = 'http://admin.stqifu.com/main';
const IMAGE_UPLOAD_URL = 'http://admin.stqifu.com/blessing/mind/toUpload/name';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHARED_EDGE_PORT = 19227;
const SHARED_EDGE_ENDPOINT = `http://127.0.0.1:${SHARED_EDGE_PORT}`;
export const SCENE_UPLOAD_FRAME_TIMEOUT_MS = 60000;
export function isSceneUploadFrameUrl(url) {
  return /\/blessing\/toUploadMore\/scene(?:[/?#]|$)/i.test(String(url || ''));
}
export const CAPTCHA_INPUT_SELECTOR = [
  '#code:visible',
  'input[placeholder*="验证码"]:visible',
  'input[aria-label*="验证码"]:visible',
  'input[name*="captcha" i]:visible',
  'input[name*="verify" i]:visible',
  'input[id*="captcha" i]:visible',
  'input[id*="verify" i]:visible',
].join(', ');

export function isCaptchaInputDescriptor({ id = '', name = '', placeholder = '', ariaLabel = '' } = {}) {
  return String(id).toLowerCase() === 'code' || /captcha|verify|验证码/i.test([id, name, placeholder, ariaLabel].join(' '));
}

export function readEncryptedWindowsCredential(credentialPath, helperPath) {
  if (!credentialPath || !helperPath || !fs.existsSync(credentialPath) || !fs.existsSync(helperPath)) return null;
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', helperPath, '-Path', credentialPath,
  ], { encoding:'utf8', windowsHide:true, timeout:10000 });
  if (result.status !== 0) throw new Error('自动登录凭据无法解密；请在高级工具中清除后重新设置。');
  try {
    const parsed = JSON.parse(String(result.stdout || '').trim());
    if (!parsed.usernameBase64 || !parsed.passwordBase64) throw new Error('incomplete');
    return {
      username:Buffer.from(String(parsed.usernameBase64),'base64').toString('utf8'),
      password:Buffer.from(String(parsed.passwordBase64),'base64').toString('utf8'),
    };
  } catch {
    throw new Error('自动登录凭据格式无效；请在高级工具中清除后重新设置。');
  }
}

function hashIds(rows) { return crypto.createHash('sha256').update(rows.map((r) => r.id).sort().join('\n')).digest('hex'); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
export async function waitForSceneUploadFrame(page, {
  timeoutMs = SCENE_UPLOAD_FRAME_TIMEOUT_MS,
  pollMs = 150,
  sleepFn = sleep,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidates = page.frames().filter((frame) => isSceneUploadFrameUrl(frame.url()));
    const candidate = candidates.at(-1) || null;
    if (candidate && await candidate.locator('input[type="file"]').count().catch(() => 0) > 0) return candidate;
    await sleepFn(pollMs);
  }
  return null;
}
function fileSha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function copyFileWithRetry(source, destination) {
  let lastError = null;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try { fs.copyFileSync(source, destination); return; }
    catch (error) {
      lastError = error;
      if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt === 20) throw error;
      await sleep(300);
    }
  }
  throw lastError;
}
export function chooseReusablePage(pages) {
  const available = pages.filter((page) => !page.isClosed?.());
  return available.find((page) => /^https?:\/\/admin\.stqifu\.com\//i.test(page.url?.() || '')) || available[0] || null;
}
export function isClosedBrowserError(error) {
  return /target page, context or browser has been closed|target closed|browser has been closed|connection closed/i.test(String(error?.message || error || ''));
}
export function isNavigationRaceError(error) {
  return /execution context was destroyed|cannot find context with specified id|interrupted by another navigation|ERR_ABORTED|navigation/i.test(String(error?.message || error || ''));
}
const CONSUMED_CONFIRM_ATTRIBUTE = 'data-prayer-confirm-consumed';
export async function scheduleSiteClick(locator, { markConsumed = false, timeoutMs = 3000, allowMissing = false } = {}) {
  // Some site onclick handlers synchronously open another layer, submit a form, or
  // navigate. Waiting for element.click() inside locator.evaluate() therefore keeps
  // the CDP call open until Playwright's 30-second timeout, even when the business
  // action has already started. Schedule the click for the next browser task and
  // return immediately; callers must verify the resulting dialog/online state.
  const clickToken = markConsumed ? `prayer-${Date.now()}-${Math.random().toString(16).slice(2)}` : '';
  let handle = null;
  try {
    // Do not call locator.evaluate() here. A Layui layer can disappear between
    // the visibility check and evaluate(); Locator then waits its full default
    // 30 seconds for a replacement element even though another handler has
    // already accepted the dialog. Resolve one short-lived handle instead so a
    // disappearing confirmation is a bounded race, not a false upload failure.
    handle = await locator.elementHandle({ timeout: timeoutMs });
    if (!handle) {
      if (allowMissing) return 'skipped';
      throw new Error('要点击的网页按钮已经消失。');
    }
    return await handle.evaluate((element, token) => {
      if (token) element.setAttribute('data-prayer-confirm-consumed', token);
      globalThis.setTimeout(() => element.click(), 0);
      return 'scheduled';
    }, clickToken);
  } catch (error) {
    if (allowMissing && /timeout|waiting for locator|not attached|detached|execution context was destroyed/i.test(String(error?.message || error || ''))) {
      return 'skipped';
    }
    throw error;
  } finally {
    await handle?.dispose?.().catch(() => {});
  }
}
export function isTransientAutomationPage(url, title = '') {
  const normalizedUrl = String(url || '').trim();
  if (/^(?:about:blank|edge:\/\/newtab\/?)/i.test(normalizedUrl)) return true;
  return /^https?:\/\/admin\.stqifu\.com\//i.test(normalizedUrl) && /(?:后台.*登录|登录)/.test(String(title || ''));
}
export function resolveRenewalTerminalDialog(dialogText, optionTexts = []) {
  const terminalLabels = ['代理已处理', '延续已处理', '已处理'];
  const optionIndex = optionTexts.findIndex((text) => terminalLabels.includes(normalizeText(text)));
  if (optionIndex >= 0) return { mode:'select-option', optionIndex, label:normalizeText(optionTexts[optionIndex]) };
  const normalizedDialog = normalizeText(dialogText);
  if (/批量修改成(?:代理|延续)?已处理状态/.test(normalizedDialog)) {
    const matchedLabel = terminalLabels.find((label) => normalizedDialog.includes(label)) || '已处理';
    return { mode:'direct-confirm', optionIndex:-1, label:matchedLabel };
  }
  return { mode:'unrecognized', optionIndex:-1, label:null };
}
export function resolveBlessingUploadCount(messages, expectedCount) {
  const numericMessages = messages
    .map((message) => normalizeText(message))
    .filter((message) => /^\d+$/.test(message))
    .map(Number);
  return {
    uploadedCount: numericMessages.includes(Number(expectedCount)) ? Number(expectedCount) : undefined,
    numericMessages,
  };
}
export function resolveBlessingUploadResponseCount(payload, expectedCount) {
  let parsed = payload;
  if (Buffer.isBuffer(parsed)) parsed = parsed.toString('utf8');
  if (typeof parsed === 'string') {
    const text = parsed.trim();
    try { parsed = JSON.parse(text); }
    catch { parsed = text; }
  }
  const candidates = [];
  const push = (value) => {
    if (typeof value === 'string' || typeof value === 'number') candidates.push(String(value));
  };
  if (parsed && typeof parsed === 'object') {
    // The current site returns { result: { message: "N" } }. Only inspect
    // explicitly named receipt fields; never walk arbitrary response numbers
    // such as order IDs or totals and mistake one of them for this batch.
    push(parsed.result?.message);
    push(parsed.result?.uploadedCount);
    push(parsed.result?.count);
    push(parsed.data?.result?.message);
    push(parsed.data?.uploadedCount);
    push(parsed.data?.count);
    push(parsed.message);
    push(parsed.uploadedCount);
    push(parsed.count);
  } else {
    push(parsed);
  }
  return resolveBlessingUploadCount(candidates, expectedCount);
}
export function isBlessingUploadTransport(method, url) {
  let pathname = '';
  try { pathname = new URL(String(url || '')).pathname; } catch { return false; }
  return String(method || '').toUpperCase() === 'POST'
    && /\/blessing\/mind\/uploadPic(?:\/name)?\/?$/i.test(pathname);
}
function stableOrderIdHash(ids) {
  return crypto.createHash('sha256').update([...ids].map(String).sort().join('\n')).digest('hex');
}
export function resolveBlessingOrderSetUploadState(expectedRows, uploadedRows, notUploadedRows) {
  const expectedIds = (expectedRows || []).map((row) => String(row?.id || '').trim());
  const duplicateExpected = expectedIds.filter((id, index) => !id || expectedIds.indexOf(id) !== index);
  const expected = new Set(expectedIds.filter(Boolean));
  const uploaded = new Set((uploadedRows || []).map((row) => String(row?.id || '').trim()).filter(Boolean));
  const pending = new Set((notUploadedRows || []).map((row) => String(row?.id || '').trim()).filter(Boolean));
  const uploadedOrderIds = [];
  const pendingOrderIds = [];
  const conflictOrderIds = [...new Set(duplicateExpected)];
  for (const id of expected) {
    const isUploaded = uploaded.has(id);
    const isPending = pending.has(id);
    if (isUploaded === isPending) conflictOrderIds.push(id);
    else if (isUploaded) uploadedOrderIds.push(id);
    else pendingOrderIds.push(id);
  }
  const expectedOrderIds = [...expected];
  const state = !expectedOrderIds.length || conflictOrderIds.length
    ? 'ambiguous'
    : uploadedOrderIds.length === expectedOrderIds.length
      ? 'all-uploaded'
      : pendingOrderIds.length === expectedOrderIds.length
        ? 'none-uploaded'
        : 'partial';
  return {
    state,
    expectedCount:expectedOrderIds.length,
    uploadedCount:uploadedOrderIds.length,
    pendingCount:pendingOrderIds.length,
    conflictCount:conflictOrderIds.length,
    expectedOrderIdHash:stableOrderIdHash(expectedOrderIds),
    uploadedOrderIdHash:stableOrderIdHash(uploadedOrderIds),
    pendingOrderIdHash:stableOrderIdHash(pendingOrderIds),
    conflictOrderIds,
  };
}
export function watchBlessingUploadTransport(page, expectedCount) {
  const state = { requestCount:0, responseCount:0, receipts:[], tasks:[] };
  const onRequest = (request) => {
    if (isBlessingUploadTransport(request.method(), request.url())) state.requestCount += 1;
  };
  const onResponse = (response) => {
    if (!isBlessingUploadTransport(response.request().method(), response.url())) return;
    state.responseCount += 1;
    const task = (async () => {
      const body = await response.text().catch(() => '');
      const receipt = response.ok()
        ? resolveBlessingUploadResponseCount(body, expectedCount)
        : { uploadedCount:undefined, numericMessages:[] };
      state.receipts.push({ ...receipt, ok:response.ok(), status:response.status() });
    })();
    state.tasks.push(task);
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  return {
    state,
    async uploadedCount() {
      await Promise.allSettled([...state.tasks]);
      return state.receipts.find((receipt) => receipt.uploadedCount === Number(expectedCount))?.uploadedCount;
    },
    stop() {
      page.off('request', onRequest);
      page.off('response', onResponse);
    },
  };
}
function nextDateToken(date) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + 1));
  return value.toISOString().slice(0, 10);
}

export class PrayerSite {
  constructor(runDir, timing, log = console.log, options = {}) {
    this.runDir = runDir;
    this.timing = timing;
    this.log = log;
    this.dialogs = [];
    this.layerMessages = [];
    this.browserRecoveryAttempts = 0;
    this.loginTimeoutMs = Number(options.loginTimeoutMs || 10 * 60 * 1000);
    this.credentialPath = options.credentialPath || null;
    this.credentialHelperPath = options.credentialHelperPath || null;
    this.credentialReader = options.credentialReader || readEncryptedWindowsCredential;
    this.autoLoginAttempted = false;
  }
  async tryStoredLogin() {
    if (this.autoLoginAttempted || !this.credentialPath || !fs.existsSync(this.credentialPath)) return false;
    this.autoLoginAttempted = true;
    let credential = null;
    try {
      credential = this.credentialReader(this.credentialPath, this.credentialHelperPath);
      if (!credential) return false;
      const password = this.page.locator('input[type="password"]:visible').first();
      if (!await password.count()) return false;
      const usernameSelectors = [
        '#loginName:visible',
        'input[name="username"]:visible', 'input[name="userName"]:visible',
        'input[name="account"]:visible', 'input[name="loginName"]:visible',
        'input[type="email"]:visible', 'input[type="text"]:visible',
      ];
      let username = null;
      for (const selector of usernameSelectors) {
        const candidate = this.page.locator(selector).first();
        if (await candidate.count()) { username = candidate; break; }
      }
      if (!username) throw new Error('登录页面没有识别到账号输入框，已停止自动登录。');
      await username.fill(credential.username, { timeout:3000 });
      await password.fill(credential.password, { timeout:3000 });
      const captchaVisible = await this.page.locator(CAPTCHA_INPUT_SELECTOR).count().catch(() => 0);
      if (captchaVisible) {
        this.log('账号和密码已从 Windows 加密凭据安全填入。请在 Edge 输入验证码并点击登录，成功后程序会自动继续。');
        return 'captcha-required';
      }
      const submitSelectors = [
        'button[type="submit"]:visible', 'input[type="submit"]:visible',
        'button:has-text("登录"):visible', 'input[value="登录"]:visible',
        '.login-btn:visible', '#loginBtn:visible',
      ];
      let submit = null;
      for (const selector of submitSelectors) {
        const candidate = this.page.locator(selector).first();
        if (await candidate.count()) { submit = candidate; break; }
      }
      if (!submit) throw new Error('登录页面没有识别到登录按钮，已停止自动登录。');
      await scheduleSiteClick(submit, { timeoutMs:3000 });
      this.timing.count('browser_action_count');
      this.log('已使用 Windows 加密凭据提交登录，正在验证。');
      return 'submitted';
    } catch {
      // DPAPI 凭据只能由创建它的 Windows 用户解密。迁移电脑、重装系统或
      // 凭据文件损坏时，自动填充不可用不应终止照片/PDF 流程；本次直接
      // 降级为人工登录，并继续等待本人输入账号、密码和验证码。
      this.log('本机保存的登录凭据不可用，本次已改为手动登录。请在 Edge 输入账号、密码和验证码，登录后程序会自动继续。');
      return 'manual-required';
    } finally {
      if (credential) { credential.username = ''; credential.password = ''; }
      credential = null;
    }
  }
  async connectSharedEdge(timeout = 1500) {
    try {
      return await chromium.connectOverCDP(SHARED_EDGE_ENDPOINT, { timeout });
    } catch {
      return null;
    }
  }
  async launchSharedEdge() {
    if (!fs.existsSync(EDGE)) throw new Error('没有找到 Microsoft Edge，无法启动专用浏览器。');
    try {
      const child = spawn(EDGE, [
        `--remote-debugging-port=${SHARED_EDGE_PORT}`,
        '--remote-debugging-address=127.0.0.1',
        `--user-data-dir=${this.profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ], { detached:true, stdio:'ignore', windowsHide:false });
      child.unref();
    } catch (error) {
      throw new Error(`无法启动祈福专用 Edge：${String(error.message || error).split(/\r?\n/)[0]}`);
    }
    const deadline = Date.now() + 15000;
    let browser = null;
    while (!browser && Date.now() < deadline) {
      await sleep(300);
      browser = await this.connectSharedEdge(1000);
    }
    if (!browser) throw new Error('祈福专用 Edge 已启动，但无法建立共享连接。请关闭该专用 Edge 窗口后重试一次。');
    return browser;
  }
  async bindSharedPage() {
    this.context = this.browser.contexts()[0];
    if (!this.context) throw new Error('共享 Edge 没有可用的浏览器上下文。');
    const pageDeadline = Date.now() + 3000;
    let reusablePage = chooseReusablePage(this.context.pages());
    while (!reusablePage && Date.now() < pageDeadline) {
      await sleep(100);
      reusablePage = chooseReusablePage(this.context.pages());
    }
    this.page = reusablePage || await this.context.newPage(); this.timing.count('browser_action_count');
    try {
      const session = await this.context.newCDPSession(this.page);
      await session.send('Browser.setDownloadBehavior', { behavior:'allow', downloadPath:this.downloadDir, eventsEnabled:true });
      await session.detach();
    } catch (error) {
      this.log(`共享 Edge 下载目录设置未生效，将使用网页响应捕获作为后备：${String(error.message || error).split(/\r?\n/)[0]}`);
    }
    this.page.on('dialog', async (dialog) => { this.dialogs.push(dialog.message()); await dialog.accept(); });
    this.context.on('page', (page) => {
      page.on('dialog', async (dialog) => { this.dialogs.push(dialog.message()); await dialog.accept(); });
    });
  }
  async cleanupTransientPages() {
    for (const page of this.context.pages()) {
      if (page === this.page || page.isClosed()) continue;
      const url = page.url();
      const title = await page.title().catch(() => '');
      if (!isTransientAutomationPage(url,title)) continue;
      await page.close().catch(() => {});
      this.timing.count('browser_action_count');
      this.log('已清理程序产生的空白页或旧登录页，继续复用当前业务标签。');
    }
  }
  async recoverClosedBrowser(targetUrl, originalError) {
    if (!isClosedBrowserError(originalError) && this.browser?.isConnected?.() && this.page && !this.page.isClosed()) throw originalError;
    if (this.browserRecoveryAttempts >= 1) {
      this.timing.count('user_intervention_count');
      throw new Error('祈福专用 Edge 在本次检查中再次被关闭。请保持该窗口打开，然后点击“重新检测 PDF”。');
    }
    this.browserRecoveryAttempts += 1;
    this.timing.count('retry_count');
    this.log('检测到祈福专用 Edge 或页面已关闭，正在自动恢复一次；不会重复导出或修改状态。');
    this.browser = await this.connectSharedEdge();
    if (this.browser) {
      this.timing.count('browser_reconnect_count');
      this.log('已重新连接仍在运行的祈福专用 Edge。');
    } else {
      this.browser = await this.launchSharedEdge();
      this.log('已重新启动祈福专用 Edge；后续步骤会继续复用此窗口。');
    }
    await this.bindSharedPage();
    await this.page.goto(targetUrl, { waitUntil:'domcontentloaded', timeout:30000 }); this.timing.count('browser_action_count');
  }
  async open() {
    this.tempRoot = path.join(this.runDir, 'temp');
    fs.mkdirSync(this.tempRoot, { recursive:true });
    for (const entry of fs.readdirSync(this.tempRoot, { withFileTypes:true })) {
      if (!entry.isDirectory()) continue;
      const stale = path.join(this.tempRoot, entry.name);
      if (entry.name.startsWith('upload-')) {
        try { fs.rmSync(stale, { recursive:true, force:true }); } catch {}
        continue;
      }
      if (!entry.name.startsWith('downloads-')) continue;
      try { if (fs.readdirSync(stale).length === 0) fs.rmdirSync(stale); } catch {}
    }
    this.downloadDir = path.join(this.tempRoot, `downloads-${process.pid}-${Date.now()}-${crypto.randomUUID()}`);
    fs.mkdirSync(this.downloadDir, { recursive: true });
    const profileRoot = path.join(process.env.LOCALAPPDATA || this.runDir, 'PrayerDailyRunner');
    this.profileDir = path.join(profileRoot, 'browser-profile'); fs.mkdirSync(this.profileDir, { recursive: true });
    this.browser = await this.connectSharedEdge();
    if (this.browser) {
      this.timing.count('browser_reconnect_count');
      this.log('已复用正在运行的祈福专用 Edge，不会打开新窗口。');
    } else {
      this.browser = await this.launchSharedEdge();
      this.log('已启动祈福专用 Edge；本次打开软件期间的后续步骤都会复用此窗口。');
    }
    await this.bindSharedPage();
    try {
      await this.page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); this.timing.count('browser_action_count');
    } catch (error) {
      if (!isClosedBrowserError(error)) throw error;
      await this.recoverClosedBrowser(LIST_URL, error);
    }
    await this.waitForLogin(LIST_URL);
  }
  async waitForLogin(targetUrl = LIST_URL) {
    await sleep(250);
    const deadline = Date.now() + this.loginTimeoutMs;
    let navigationAttempts = 0;
    let loginPromptLogged = false;
    let autoLoginSubmittedAt = 0;
    while (Date.now() < deadline) {
      try {
        if (!this.browser?.isConnected?.() || !this.page || this.page.isClosed()) {
          await this.recoverClosedBrowser(targetUrl, new Error('Target page, context or browser has been closed'));
        }
        if (await this.page.locator('#startTime, input[value="检索"], #file[type="file"]').count()) { this.log('登录成功。'); await this.cleanupTransientPages(); return; }
        const currentUrl = this.page.url();
        const passwordVisible = await this.page.locator('input[type="password"]').isVisible().catch(() => false);
        if (passwordVisible && !this.autoLoginAttempted) {
          const loginMode = await this.tryStoredLogin();
          if (loginMode === 'submitted') { autoLoginSubmittedAt = Date.now(); await sleep(750); continue; }
          if (loginMode === 'captcha-required') { loginPromptLogged = true; await sleep(500); continue; }
          if (loginMode === 'manual-required') { loginPromptLogged = true; await sleep(500); continue; }
        }
        if (passwordVisible && autoLoginSubmittedAt && Date.now() - autoLoginSubmittedAt > 15000) {
          throw new Error('自动登录未成功。请检查账号密码，或手动处理验证码；程序没有重复尝试。');
        }
        if (!loginPromptLogged && (!passwordVisible || !this.credentialPath || !fs.existsSync(this.credentialPath))) {
          this.log('请在 Edge 窗口登录。登录成功后程序会自动继续。');
          loginPromptLogged = true;
        }
        const authenticatedMarker =
          await this.page.getByText('退出', { exact: true }).count().catch(() => 0) +
          await this.page.getByText('日常管理', { exact: true }).count().catch(() => 0) +
          await this.page.getByText(/待处理福单/).count().catch(() => 0);
        const reachedMainPage = /\/main(?:[/?#]|$)/i.test(currentUrl) || (!passwordVisible && authenticatedMarker > 0);
        if (!passwordVisible && authenticatedMarker > 0 && currentUrl.startsWith(targetUrl.split('?')[0])) {
          this.log('登录成功。');
          await this.cleanupTransientPages();
          return;
        }
        if (reachedMainPage && navigationAttempts < 2) {
          navigationAttempts += 1;
          this.log('已检测到登录成功，正在进入待处理福单页面。');
          await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          this.timing.count('browser_action_count');
          continue;
        }
      } catch (error) {
        if (!isClosedBrowserError(error)) throw error;
        await this.recoverClosedBrowser(targetUrl, error);
        loginPromptLogged = false;
        continue;
      }
      await sleep(500);
    }
    this.timing.count('user_intervention_count');
    if (this.loginTimeoutMs <= 10000) throw new Error('快速线上检查发现尚未登录，已跳过；照片业务不会因此被阻塞。');
    throw new Error('等待登录超过10分钟。');
  }
  async close() {
    // 共享 Edge 保持运行，供下一个按钮直接复用。Node 进程退出时连接自动断开；
    // 不关闭浏览器、不清除登录会话，也不创建后台保活请求。
    if (this.downloadDir) {
      for (let attempt = 0; attempt < 12 && fs.existsSync(this.downloadDir); attempt += 1) {
        try { fs.rmSync(this.downloadDir, { recursive:true, force:true }); } catch {}
        if (fs.existsSync(this.downloadDir)) await sleep(250);
      }
    }
    try { if (this.tempRoot && fs.existsSync(this.tempRoot) && fs.readdirSync(this.tempRoot).length === 0) fs.rmdirSync(this.tempRoot); } catch {}
  }
  async preparePageSize1000() {
    // pageSize 的 onchange 会把当前整张检索表单一起提交。站点会保留上一次
    // 查询条件；若旧条件恰好返回 0 条，服务端会把 1000 条/页强制恢复为 10。
    // 因此先在 DOM 中清空旧筛选，再让分页提交，落地后由调用方填写本次条件。
    for (const selector of ['#bCode','#orderCode','#userId','#receiveBlessing','#aTd','#startTime','#endTime']) {
      const control = this.page.locator(selector).first();
      if (!await control.count()) continue;
      await control.evaluate((element) => {
        element.removeAttribute('readonly');
        element.value = '';
        element.dispatchEvent(new Event('input',{bubbles:true}));
        element.dispatchEvent(new Event('change',{bubbles:true}));
      });
    }
    for (const selector of ['#state','#bType','#supportName','select[name="supportName"]','#upload','#upload1','#video1','#renewHandelState','#templet']) {
      const control = this.page.locator(selector).first();
      if (await control.count()) await control.selectOption('').catch(() => {});
    }
    const pageNum = this.page.locator('#pageNum').first();
    if (await pageNum.count()) await pageNum.fill('1').catch(() => {});
    await this.ensurePageSize1000();
  }
  async ensurePageSize1000() {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const pageSize = this.page.locator('#pageSize').first();
      if (!await pageSize.count()) return;
      const values = await pageSize.locator('option').evaluateAll((options) => options.map((option) => String(option.value))).catch(() => []);
      if (!values.includes('1000')) throw new Error('当前列表没有1000条/页选项，无法保证全量处理。');
      const current = await pageSize.inputValue().catch(() => '');
      if (current === '1000') return;
      const navigation = this.page.waitForNavigation({ waitUntil:'domcontentloaded', timeout:15000 }).catch(() => null);
      try { await pageSize.selectOption('1000'); }
      catch (error) { if (!isNavigationRaceError(error) && !isClosedBrowserError(error)) throw error; }
      await navigation;
      await sleep(900);
      const settled = this.page.locator('#pageSize').first();
      if (await settled.count() && await settled.inputValue().catch(() => '') === '1000') return;
      this.log(`1000条/页设置第 ${attempt}/3 次未稳定，正在重新进入当前列表复核。`);
      await this.page.reload({ waitUntil:'domcontentloaded', timeout:30000 }).catch(() => null);
    }
    throw new Error('系统每页1000条设置连续3次没有生效，已停止，避免只处理第一页。');
  }
  async submitListSearch(search = this.page.locator('input[value="检索"], button:has-text("检索")').first()) {
    await search.waitFor({ state:'visible', timeout:10000 });
    const navigation = this.page.waitForNavigation({ waitUntil:'domcontentloaded', timeout:20000 }).catch(() => null);
    try { await search.click(); }
    catch (error) { if (!isNavigationRaceError(error) && !isClosedBrowserError(error)) throw error; }
    await navigation;
    await sleep(700);
    this.timing.count('browser_action_count');
  }
  async readListPageTotal() {
    // 不能从 body 读取“共 N 条”：侧栏和其它业务模块也会出现相同文案，
    // 例如当前筛选 171 条时误抓到全局历史统计 7678 条。只从与 #pageSize
    // 同一分页控件的最小祖先读取；该区域正是当前列表的分页栏。
    const pageSize = this.page.locator('#pageSize').first();
    if (!await pageSize.count()) return null;
    return pageSize.evaluate((control) => {
      let node = control.parentElement;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        const matches = [...String(node.innerText || '').matchAll(/共\s*(\d+)\s*条/g)];
        if (matches.length === 1) return Number(matches[0][1]);
      }
      return null;
    }).catch(() => null);
  }
  async query(date, { url = LIST_URL } = {}) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); this.timing.count('browser_action_count');
    // 每页条数下拉框会立即触发整页导航。必须先等待它稳定，再设置日期和状态；
    // 否则导航会清空刚填好的筛选，产生“总数174、当前页104”之类的假分页。
    await this.preparePageSize1000();
    const endDate = nextDateToken(date);
    // 页面会保留上一次人工筛选。每次查询先恢复 V9 所需的完整待祈福范围，避免只导出某个供养物或上传状态。
    for (const selector of ['#bCode','#orderCode','#userId','#receiveBlessing','#aTd']) {
      if (await this.page.locator(selector).count()) await this.page.locator(selector).fill('');
    }
    for (const selector of ['#bType','#supportName','#upload','#upload1','#video1']) {
      if (await this.page.locator(selector).count()) await this.page.locator(selector).selectOption('');
    }
    await this.page.locator('#startTime').evaluate((element, value) => { element.removeAttribute('readonly'); element.value = value; element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})); }, date);
    await this.page.locator('#endTime').evaluate((element, value) => { element.removeAttribute('readonly'); element.value = value; element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})); }, endDate);
    await this.page.locator('#state').selectOption('00');
    await this.submitListSearch(); this.timing.count('browser_action_count');
    const rows = await this.readRows();
    const total = await this.readListPageTotal();
    if (total !== null && total > rows.length) throw new Error(`目标数据共 ${total} 条，超过当前页 ${rows.length} 条。为避免漏单，本版不会只处理第一页。`);
    return rows;
  }
  async queryLamp(date) { return this.query(date, { url:LAMP_LIST_URL }); }
  async queryDailyTablet(date) {
    const rows = await this.query(date, { url:TABLET_LIST_URL });
    await this.queryLamp(date);
    return rows;
  }
  async queryTabletPage(date) { return this.query(date, { url:TABLET_LIST_URL }); }
  async queryTabletGroup(date, productName, templateName) {
    await this.query(date, { url:TABLET_LIST_URL });
    await this.selectOptionByVisibleText('select[name="supportName"]', productName);
    await this.selectOptionByVisibleText('#templet', templateName);
    await this.submitListSearch();
    const rows = await this.readRows();
    if (rows.some((row) => normalizeText(row.productName) !== normalizeText(productName))) {
      throw new Error(`${productName} 牌位筛选结果混入了其他供养物，已停止导出。`);
    }
    return rows;
  }
  async queryRenewals({ productName = null, templateName = null } = {}) {
    await this.page.goto(TABLET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.timing.count('browser_action_count');
    await this.waitForLogin(TABLET_URL);
    // 本页修改每页条数会立刻单独跳转，而且不会保留其他筛选。必须先完成
    // 1000条/页跳转，再填写“未处理”等条件；反过来会悄悄清空筛选。
    await this.preparePageSize1000();
    // 续费是一个独立的全局“未处理”队列，不按祈福日期裁剪。必须清空页面可能
    // 保留的日期和其他筛选，只保留“延续处理状态=未处理”。
    for (const selector of ['#bCode','#orderCode','#userId','#aTd','#startTime','#endTime']) {
      const control = this.page.locator(selector).first();
      if (await control.count()) {
        await control.evaluate((element) => {
          element.removeAttribute('readonly');
          element.value = '';
          element.dispatchEvent(new Event('input',{bubbles:true}));
          element.dispatchEvent(new Event('change',{bubbles:true}));
        });
      }
    }
    for (const selector of ['#state','select[name="supportName"]','#upload','#templet']) {
      if (await this.page.locator(selector).count()) await this.page.locator(selector).selectOption('').catch(() => {});
    }
    if (!await this.page.locator('#renewHandelState').count()) throw new Error('续费页面没有识别到“延续处理状态”筛选。');
    await this.page.locator('#renewHandelState').selectOption('00');
    if (productName) await this.selectOptionByVisibleText('select[name="supportName"]', productName);
    if (templateName) await this.selectOptionByVisibleText('#templet', templateName);
    const search = this.page.locator('input[value="检索"], button:has-text("检索")').first();
    await search.waitFor({ state:'visible', timeout:10000 });
    // 该页的“检索”是整页提交。必须让 locator.click 等到这次导航落地；若先读取
    // 当前 loadState，会撞上旧页面已经 complete 的状态并读到新表格的半成品 DOM。
    await search.click();
    this.timing.count('browser_action_count');
    await sleep(500);
    const rows = await this.readRows();
    const total = await this.readListPageTotal();
    if (total !== null && total > rows.length) throw new Error(`续费未处理共 ${total} 条，超过当前页 ${rows.length} 条。为避免漏单，本版不会只处理第一页。`);
    if (rows.some((row) => normalizeText(row.renewalStatus) !== '未处理')) throw new Error('续费筛选结果混入了非“未处理”数据，已停止。');
    if (productName && rows.some((row) => normalizeText(row.productName) !== normalizeText(productName))) {
      throw new Error(`${productName} 续费筛选结果混入了其他供养物，已停止导出。`);
    }
    return rows;
  }
  async queryRenewalGroup(productName, templateName) {
    return this.queryRenewals({ productName, templateName });
  }
  async queryTablet(date) {
    // 牌位复核必须使用临时标签页。原福单页保留已经检索出的日期、状态和 1000 条分页，
    // 否则返回后会在牌位页寻找福单复选框，错误地把所有导出组判断为 0 条。
    const blessingPage = this.page;
    const tabletPage = await this.context.newPage();
    this.page = tabletPage;
    try {
      await this.page.goto(TABLET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); this.timing.count('browser_action_count');
      await this.waitForLogin(TABLET_URL);
      await this.preparePageSize1000();
      const endDate = nextDateToken(date);
      for (const selector of ['#bCode','#orderCode','#userId','#receiveBlessing','#aTd']) {
        if (await this.page.locator(selector).count()) await this.page.locator(selector).fill('');
      }
      for (const selector of ['#bType','#supportName, select[name="supportName"]','#upload','#upload1','#video1','#renewHandelState']) {
        if (await this.page.locator(selector).count()) await this.page.locator(selector).selectOption('').catch(() => {});
      }
      const selects = this.page.locator('select');
      let pendingSelected = false;
      for (let i = 0; i < await selects.count(); i++) {
        const select = selects.nth(i);
        const options = await select.locator('option').allTextContents();
        const index = options.findIndex((text) => normalizeText(text) === '待祈福');
        if (index >= 0) {
          const value = await select.locator('option').nth(index).getAttribute('value');
          await select.selectOption(value ?? { index }); pendingSelected = true; break;
        }
      }
      if (!pendingSelected) throw new Error('牌位页面没有识别到“待祈福”状态筛选。');
      const start = this.page.locator('#startTime, input[placeholder="开始日期"]').first();
      if (!await start.count()) throw new Error('牌位页面没有识别到开始日期筛选。');
      await start.evaluate((element, value) => { element.removeAttribute('readonly'); element.value = value; element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})); }, date);
      const end = this.page.locator('#endTime, input[placeholder="结束日期"]').first();
      if (await end.count()) await end.evaluate((element, value) => { element.removeAttribute('readonly'); element.value = value; element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})); }, endDate);
      const search = this.page.locator('input[value="检索"], button:has-text("检索")').first();
      try { await this.submitListSearch(search); }
      catch (error) { if (/Timeout/.test(String(error.message || error))) throw new Error('牌位页面在10秒内没有出现检索按钮。'); throw error; }
      const rows = await this.readRows();
      const total = await this.readListPageTotal();
      if (total !== null && total > rows.length) throw new Error(`牌位待祈福共 ${total} 条，超过当前页 ${rows.length} 条。为避免漏单，本版不会只检查第一页。`);
      return rows;
    } finally {
      await tabletPage.close().catch(() => {});
      this.page = blessingPage;
    }
  }
  async readRows() {
    const rows = await this.page.locator('table').evaluateAll((tables) => {
      const table = tables.find((candidate) => {
        const headers = [...candidate.querySelectorAll('th')].map((th) => (th.innerText || '').trim());
        return headers.includes('福单编号') && headers.includes('供养物') && (headers.includes('祈福日期') || headers.includes('开始日期'));
      });
      if (!table) return [];
      const headers = [...table.querySelectorAll('th')].map((th) => (th.innerText || '').trim());
      const indexOf = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
      const indexes = {
        blessingCode:indexOf('福单编号'), productName:indexOf('供养物'), prayerDate:indexOf('祈福日期','开始日期'),
        unitPrice:indexOf('单价 (元)'), quantity:indexOf('数量'), status:indexOf('状态'), renewalStatus:indexOf('延续处理状态'),
      };
      const cell = (cells, index) => index >= 0 ? (cells[index] || '') : '';
      return [...table.querySelectorAll('tbody tr')].map((tr) => {
        const cells = [...tr.querySelectorAll('td')].map((td) => (td.innerText || '').trim());
        const box = tr.querySelector('input[name="ids"]');
        if (!box?.value || !cells.length) return null;
        return { id: box.value, blessingCode: cell(cells,indexes.blessingCode), productName: cell(cells,indexes.productName), prayerDate: cell(cells,indexes.prayerDate), unitPrice: cell(cells,indexes.unitPrice), quantity: cell(cells,indexes.quantity), status: cell(cells,indexes.status), renewalStatus: cell(cells,indexes.renewalStatus) };
      }).filter(Boolean);
    });
    const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
    return unique;
  }
  async selectRows(predicate, allowedIds = null) {
    const result = await this.page.locator('table').evaluateAll((tables, options) => {
      const { kind, allowedIds: allowed } = options;
      const allowedSet = Array.isArray(allowed) ? new Set(allowed.map(String)) : null;
      const table = tables.find((candidate) => {
        const headers = [...candidate.querySelectorAll('th')].map((th) => (th.innerText || '').trim());
        return headers.includes('福单编号') && headers.includes('供养物') && (headers.includes('祈福日期') || headers.includes('开始日期'));
      });
      if (!table) return 0;
      const headers = [...table.querySelectorAll('th')].map((th) => (th.innerText || '').trim());
      const productIndex = headers.indexOf('供养物');
      if (productIndex < 0) return 0;
      let count = 0;
      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.querySelectorAll('td')].map((td) => (td.innerText || '').replace(/[\u00ad\u200b-\u200d\ufeff\s]/g,''));
        const product = cells[productIndex] || ''; const box = tr.querySelector('input[name="ids"]');
        const water = product.includes('供水养净');
        const wanted = kind === 'water' ? water
          : kind === 'ordinary' ? !water
          : kind === 'tablet-red' ? product.includes('长生禄位')
          : kind === 'tablet-yellow' ? product.includes('往生莲位')
          : kind === 'all';
        const idAllowed = !allowedSet || allowedSet.has(String(box?.value || ''));
        const selected = wanted && idAllowed;
        if (box) { box.checked = selected; box.dispatchEvent(new Event('change',{bubbles:true})); if (selected) count++; }
      }
      return count;
    }, { kind:predicate, allowedIds });
    return result;
  }
  async assertBlessingExportContext(expectedHash, expectedCount) {
    if (!/\/blessing\/list(?:[/?#]|$)/i.test(this.page.url())) {
      throw new Error('导出前页面不是“待处理福单”，已停止，避免在错误页面误判为没有订单。');
    }
    const rows = await this.readRows();
    if (rows.length !== expectedCount || hashIds(rows) !== expectedHash) {
      throw new Error(`导出前福单页清单发生变化：预期 ${expectedCount} 条，当前 ${rows.length} 条。已停止，未点击导出。`);
    }
    return rows.length;
  }
  async autoSiteConfirm(timeoutMs = 3000) {
    // Layui/Bootstrap 确认层有时在点击业务按钮后异步出现，不能只在同一瞬间检查一次。
    // 用户已授权本次上传/导出时，最多处理两个紧随动作出现的普通确认层。
    const deadline = Date.now() + timeoutMs;
    let handled = 0;
    while (Date.now() < deadline && handled < 2) {
      // innerText deliberately excludes hidden <script> text. The month layer
      // contains `$('#years').val(...)` inside its visible parent; textContent
      // used to leak that control script into the upload receipt collector.
      const messages = await this.page.locator('.layui-layer-msg:visible .layui-layer-content, .layui-layer:visible .layui-layer-content').allInnerTexts().catch(() => []);
      for (const message of messages.map((value) => normalizeText(value)).filter(Boolean)) {
        if (!this.layerMessages.includes(message)) this.layerMessages.push(message);
      }
      const button = this.page.locator(
        '.layui-layer:visible .layui-layer-btn0, .layui-layer:visible .layui-layer-btn a:has-text("确定"), .layui-layer:visible .layui-layer-btn a:has-text("确认"), .modal:visible button:has-text("确定"), .modal:visible button:has-text("确认"), button:visible:has-text("确认")',
      );
      let candidate = null;
      for (let index = 0; index < await button.count(); index += 1) {
        const current = button.nth(index);
        // Layui 关闭月份层时会保留一小段动画时间。已经触发过业务动作的
        // “确定”按钮带有消费标记，绝不能再当成后续确认层重复点击。
        const consumed = await current.getAttribute(CONSUMED_CONFIRM_ATTRIBUTE).catch(() => null);
        if (!consumed) { candidate = current; break; }
      }
      if (candidate && await candidate.isVisible().catch(()=>false)) {
        // 页面按钮可能同步弹出下一层 alert/confirm。普通 Playwright click 会等待
        // 整个处理链返回并在 CDP 复用 Edge 中超时；DOM click 能立即交还控制权，
        // 原生 dialog 仍由全局监听器自动接受。
        const clickResult = await scheduleSiteClick(candidate, {
          markConsumed:true,
          timeoutMs:750,
          allowMissing:true,
        });
        if (clickResult === 'scheduled') {
          this.timing.count('browser_action_count');
          handled += 1;
          await sleep(250);
        } else {
          // Native dialog listeners or a previous layer callback may have
          // already closed this transient button. Continue polling for the
          // explicit upload result instead of turning that benign race into a
          // 30-second failure.
          await sleep(50);
        }
      } else {
        await sleep(100);
      }
    }
    if (handled) this.log(`已自动处理 ${handled} 个确认窗口。`);
    return handled;
  }
  async setExportTitleDate(date) {
    const input = this.page.locator('#exportTime').first();
    if (!await input.count()) throw new Error('当前页面没有识别到“标题日期”输入框。');
    await input.evaluate((element, value) => {
      element.removeAttribute('readonly');
      element.value = value;
      element.dispatchEvent(new Event('input',{bubbles:true}));
      element.dispatchEvent(new Event('change',{bubbles:true}));
      element.dispatchEvent(new Event('blur',{bubbles:true}));
    }, date);
    const actual = await input.evaluate((element) => element.value);
    if (actual !== date) throw new Error(`标题日期设置失败：预期 ${date}，实际 ${actual || '空'}。`);
  }
  armPdfCapture() {
    let result = null;
    let captureError = null;
    let active = true;
    let sequence = 0;
    const attachedPages = new Set();
    const safeName = (name) => String(name || 'export.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const acceptSavedFile = async (file) => {
      if (!active || result) return;
      try { result = { path:file, verification:await verifyPdf(file) }; }
      catch (error) { captureError = error; }
    };
    const onDownload = async (download) => {
      if (!active || result) return;
      const suggested = download.suggestedFilename();
      const target = path.join(this.downloadDir, `captured-${Date.now()}-${sequence++}-${safeName(suggested)}`);
      try { await download.saveAs(target); await acceptSavedFile(target); }
      catch (error) {
        // 共享 Edge 设置了浏览器级下载目录时，文件可能已由 Edge 移入用户下载目录，
        // Playwright 的临时源随即消失并使 saveAs 报 ENOENT。此时按本次 download
        // 事件给出的唯一文件名接管，仍须通过完整 PDF 结构校验。
        const defaultDownload = path.join(process.env.USERPROFILE || '', 'Downloads', suggested);
        if (/ENOENT/i.test(String(error.message || error)) && fs.existsSync(defaultDownload)) await acceptSavedFile(defaultDownload);
        else captureError = error;
      }
    };
    const attachPage = (page) => {
      if (attachedPages.has(page)) return;
      attachedPages.add(page);
      page.on('download', onDownload);
    };
    const onPage = (page) => attachPage(page);
    const onResponse = async (response) => {
      if (!active || result) return;
      const contentType = String((await response.allHeaders().catch(() => ({})))['content-type'] || '');
      if (!/application\/pdf/i.test(contentType)) return;
      const target = path.join(this.downloadDir, `captured-${Date.now()}-${sequence++}-response.pdf`);
      try {
        const bytes = await response.body();
        fs.writeFileSync(target, bytes);
        await acceptSavedFile(target);
      } catch (error) { captureError = error; }
    };
    for (const page of this.context.pages()) attachPage(page);
    this.context.on('page', onPage);
    this.context.on('response', onResponse);
    return {
      getResult: () => result,
      getError: () => captureError,
      cancel: () => {
        active = false;
        this.context.off('page', onPage);
        this.context.off('response', onResponse);
        for (const page of attachedPages) page.off('download', onDownload);
      },
    };
  }
  async pdfExportButton() {
    const candidates = this.page.locator('input[value="导出"], button:has-text("导出")');
    const index = await candidates.evaluateAll((elements) => {
      const color = document.querySelector('#color');
      const colorRect = color?.getBoundingClientRect();
      const visible = elements.map((element, originalIndex) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { originalIndex, rect, shown:rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' };
      }).filter((item) => item.shown);
      if (!visible.length) return -1;
      if (!colorRect) return visible.at(-1).originalIndex;
      const colorCenter = colorRect.top + colorRect.height / 2;
      visible.sort((left, right) => {
        const leftCenter = left.rect.top + left.rect.height / 2;
        const rightCenter = right.rect.top + right.rect.height / 2;
        return Math.abs(leftCenter - colorCenter) - Math.abs(rightCenter - colorCenter);
      });
      return visible[0].originalIndex;
    });
    if (index < 0) throw new Error('没有识别到纸色筛选同一行的 PDF 导出按钮。');
    return candidates.nth(index);
  }
  async describePdfExportControls() {
    return this.page.locator('body').evaluate(() => {
      const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const describeRect = (element) => {
        const rect = element?.getBoundingClientRect();
        return rect ? { top:Math.round(rect.top), left:Math.round(rect.left), width:Math.round(rect.width), height:Math.round(rect.height) } : null;
      };
      const color = document.querySelector('#color');
      const exportTime = document.querySelector('#exportTime');
      const elements = [...document.querySelectorAll('input,button,a')].filter((element) => compact(element.value || element.textContent) === '导出');
      const menuLinks = [...document.querySelectorAll('a')]
        .map((element) => ({ text:compact(element.textContent), href:compact(element.getAttribute('href')) }))
        .filter((item) => ['待处理福单','供灯福单','牌位福单'].includes(item.text));
      const checkboxSummary = {};
      for (const checkbox of document.getElementsByName('ids')) {
        const key = `${checkbox.id || '(empty)'}|${checkbox.getAttribute('blessingType') || '(empty)'}`;
        checkboxSummary[key] = (checkboxSummary[key] || 0) + 1;
      }
      const describeCheckbox = (checkbox) => checkbox ? {
        id:checkbox.id,
        name:checkbox.getAttribute('name'),
        type:checkbox.getAttribute('type'),
        className:compact(checkbox.className),
        onclick:compact(checkbox.getAttribute('onclick')),
        onchange:compact(checkbox.getAttribute('onchange')),
        blessingType:checkbox.getAttribute('blessingType'),
        checked:Boolean(checkbox.checked),
      } : null;
      const rowCheckbox = document.getElementsByName('ids')[0];
      const headerCheckboxes = [...document.querySelectorAll('thead input[type="checkbox"], #checked_all')].map(describeCheckbox);
      return {
        color: color ? { tag:color.tagName, id:color.id, name:color.getAttribute('name'), rect:describeRect(color) } : null,
        exportTime: exportTime ? {
          tag:exportTime.tagName,
          id:exportTime.id,
          name:exportTime.getAttribute('name'),
          type:exportTime.getAttribute('type'),
          value:exportTime.value,
          placeholder:exportTime.getAttribute('placeholder'),
          readOnly:Boolean(exportTime.readOnly),
          options:[...exportTime.querySelectorAll('option')].map((option) => ({ value:option.value, text:compact(option.textContent) })).slice(0, 40),
          rect:describeRect(exportTime),
        } : null,
        exportListSource: typeof window.exportList === 'function' ? String(window.exportList).slice(0, 5000) : null,
        exportList1Source: typeof window.exportList1 === 'function' ? String(window.exportList1).slice(0, 5000) : null,
        exportDataSource: typeof window.exportData === 'function' ? String(window.exportData).slice(0, 5000) : null,
        checkOrCancelAllSource: typeof window.checkOrCancelAll === 'function' ? String(window.checkOrCancelAll).slice(0, 5000) : null,
        checkboxSummary,
        rowCheckbox:describeCheckbox(rowCheckbox),
        headerCheckboxes,
        menuLinks,
        controls: elements.map((element, index) => ({
          index,
          tag:element.tagName,
          id:element.id,
          name:element.getAttribute('name'),
          type:element.getAttribute('type'),
          className:compact(element.className),
          value:compact(element.value),
          text:compact(element.textContent),
          onclick:compact(element.getAttribute('onclick')),
          href:compact(element.getAttribute('href')),
          formAction:compact(element.form?.getAttribute('action')),
          rect:describeRect(element),
        })),
      };
    });
  }
  async summarizePdfExportControls() {
    const details = await this.describePdfExportControls();
    return {
      url:this.page.url(),
      color:details.color,
      exportTime:details.exportTime,
      checkboxSummary:details.checkboxSummary,
      rowCheckbox:details.rowCheckbox,
      headerCheckboxes:details.headerCheckboxes,
      controls:details.controls,
      exportDataSource:details.exportDataSource,
      checkOrCancelAllSource:details.checkOrCancelAllSource,
    };
  }
  async describeDailyModuleLinks() {
    const originalPage = this.page;
    const diagnosticPage = await this.context.newPage();
    try {
      this.page = diagnosticPage;
      await diagnosticPage.goto(MAIN_URL, { waitUntil:'domcontentloaded', timeout:30000 });
      await this.waitForLogin(MAIN_URL);
      await sleep(500);
      const output = [];
      for (const frame of diagnosticPage.frames()) {
        const links = await frame.locator('a').evaluateAll((elements) => elements.map((element) => ({
          text:String(element.textContent || '').replace(/\s+/g,'').trim(),
          href:String(element.getAttribute('href') || '').trim(),
          onclick:String(element.getAttribute('onclick') || '').replace(/\s+/g,' ').trim(),
        })).filter((item) => /待处理福单|供灯福单|牌位福单/.test(item.text)));
        output.push(...links);
      }
      return output;
    } finally {
      await diagnosticPage.close().catch(() => {});
      this.page = originalPage;
    }
  }
  async exportGroup(group, color, destination, expectedSelectionCount = null, exportDate = null, allowedIds = null) {
    if (fs.existsSync(destination)) throw new Error(`目标文件已存在，为防止重复编号，导出前已停止：${destination}`);
    const selected = await this.selectRows(group, allowedIds);
    if (expectedSelectionCount !== null && selected !== expectedSelectionCount) {
      throw new Error(`${group} 分组选择异常：预期 ${expectedSelectionCount} 条，实际勾选 ${selected} 条。已停止，未点击导出。`);
    }
    if (!selected) { this.log(`${group}：没有可选订单，跳过。`); return null; }
    if (exportDate && await this.page.locator('#exportTime').count()) await this.setExportTitleDate(exportDate);
    else if (exportDate && !/^tablet-/.test(group)) throw new Error('当前页面没有识别到“标题日期”输入框。');
    if (await this.page.locator('#color').count()) await this.page.locator('#color').selectOption(color);
    const before = listFilesRecursive(this.downloadDir); this.dialogs = []; this.layerMessages = [];
    const capture = this.armPdfCapture();
    let found;
    try {
      const exportButton = await this.pdfExportButton();
      await exportButton.click(); this.timing.count('browser_action_count');
      await this.autoSiteConfirm(); this.timing.count('download_directory_watch_count');
      await sleep(800);
      const immediateMessage = [...this.dialogs,...this.layerMessages].join('；');
      if (/没有|未找到|无对应|不存在|0条/.test(immediateMessage)) { this.log(`${group}：系统提示无对应数据，跳过。`); return null; }
      if (/待祈福|请选择|未设置|多种福单/.test(immediateMessage)) throw new Error(`${group} 导出被系统阻止：${immediateMessage}`);
      found = await waitForNewPdf(this.downloadDir, before, 25000, capture.getResult);
    } finally {
      capture.cancel();
    }
    if (!found) {
      const message = [...this.dialogs,...this.layerMessages].join('；');
      if (/没有|未找到|无对应|不存在|0条/.test(message)) { this.log(`${group}：系统提示无对应数据，跳过。`); return null; }
      const captureError = capture.getError();
      throw new Error(`${group} 导出后没有发现完整 PDF；为防止重复编号，程序不会自动重试。${message ? ` 系统提示：${message}` : ''}${captureError ? ` 捕获错误：${captureError.message}` : ''}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try {
      await copyFileWithRetry(found.path, destination);
      const verified = await verifyPdf(destination); this.log(`${path.basename(destination)}：${verified.pageCount}页，校验通过。`); return verified;
    } finally {
      const resolvedDownload = path.resolve(this.downloadDir) + path.sep;
      const resolvedFound = path.resolve(found.path);
      if (resolvedFound.startsWith(resolvedDownload)) {
        try { fs.unlinkSync(found.path); } catch {}
      }
    }
  }
  async openImageProcessing() {
    // “图片处理”在主页中通过 iframe 标签打开。直接进入实际上传地址，
    // 避免在主页外层 DOM 中寻找上传控件。
    await this.page.goto(IMAGE_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.timing.count('browser_action_count');
    await this.waitForLogin(IMAGE_UPLOAD_URL);
    const fileInput = this.page.locator('#file[type="file"]').first();
    try { await fileInput.waitFor({ state:'attached', timeout:10000 }); }
    catch { throw new Error('图片处理上传页没有加载完成；未选择任何文件。'); }
  }
  async uploadBlessingBatch(files, date, onStage = () => {}) {
    if (!files.length || files.length > 50) throw new Error('每批福单图必须为1至50张。');
    const stageDir = path.join(this.tempRoot, `upload-${process.pid}-${Date.now()}-${crypto.randomUUID()}`);
    fs.mkdirSync(stageDir, { recursive:true });
    const stagedFiles = [];
    try {
      onStage('staging-local-upload-cache');
      for (const source of files) {
        const destination = path.join(stageDir, path.basename(source));
        await copyFileWithRetry(source, destination);
        if (fileSha256(source) !== fileSha256(destination)) throw new Error(`上传缓存校验失败：${path.basename(source)}`);
        stagedFiles.push(destination);
      }
      this.log(`上传文件已复制到本地非同步缓存并完成哈希校验：${stagedFiles.length} 张。`);
      return await this.uploadBlessingBatchFromStaged(stagedFiles, date, onStage);
    } finally {
      for (let attempt = 0; attempt < 20 && fs.existsSync(stageDir); attempt += 1) {
        try { fs.rmSync(stageDir, { recursive:true, force:true }); } catch {}
        if (fs.existsSync(stageDir)) await sleep(250);
      }
      if (fs.existsSync(stageDir)) this.log('本地上传缓存暂时被浏览器占用，将在下次启动时继续清理。');
    }
  }
  async uploadBlessingBatchFromStaged(files, date, onStage = () => {}) {
    if (!files.length || files.length > 50) throw new Error('每批福单图必须为1至50张。');
    await this.openImageProcessing();
    this.dialogs = [];
    // 必须先监听 Playwright filechooser，再触发网页自己的相机按钮。
    // 直接对隐藏 input 调用 locator.setInputFiles 会等待 onchange=upload() 的同步弹窗链，
    // 即使文件已经写入也可能在 30 秒后误报超时，造成下一次运行无法判断是否要重传。
    const camera = this.page.locator('form#form button[onclick*="#file"], button:has(.fa-camera)').first();
    if (!await camera.count()) throw new Error('图片处理页面没有识别到相机上传按钮；未选择任何文件。');
    await camera.waitFor({ state:'visible', timeout:10000 });
    onStage('filechooser-armed');
    const chooserPromise = this.page.waitForEvent('filechooser', { timeout:10000 });
    await scheduleSiteClick(camera);
    const chooser = await chooserPromise;
    onStage('selecting-files');
    await chooser.setFiles(files, { noWaitAfter:true, timeout:60000 });
    onStage('files-selected');
    this.timing.count('browser_action_count');

    const [year, month] = date.split('-').map(Number);
    const monthText = `${year}${String(month).padStart(2, '0')}`;
    const layer = this.page.locator('.layui-layer:visible, .modal:visible, [role="dialog"]:visible').last();
    const monthInput = layer.locator('#years, input[name="years"], input:not([type="file"]):not([type="hidden"])').first();
    try { await monthInput.waitFor({ state:'visible', timeout:5000 }); }
    catch { throw new Error('选择文件后没有出现月份窗口；未提交上传。'); }
    await monthInput.evaluate((element, value) => {
      element.removeAttribute('readonly');
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
    }, monthText);

    const chooseButton = layer.locator(
      '.layui-layer-btn0, .layui-layer-btn a:has-text("确定"), button:has-text("确定")',
    ).first();
    if (!await chooseButton.count()) throw new Error('月份窗口没有识别到确定按钮；未提交上传。');
    try { await chooseButton.waitFor({ state:'visible', timeout:5000 }); }
    catch { throw new Error('月份窗口的确定按钮不可见；未提交上传。'); }
    // Observe the complete upload transaction rather than resolving on the
    // first matching response. Some deployments emit an intermediate response
    // before the final numeric JSON receipt, and the endpoint may omit /name.
    const uploadTransport = watchBlessingUploadTransport(this.page, files.length);
    // 这个按钮的处理函数会同步打开下一层确认框。CDP 复用 Edge 时，
    // Playwright 的常规 click 偶尔会一直等待该处理链结束并在 30 秒后超时，
    // 即使 DOM 元素本身已经可用。直接调用元素 click 可立即交还控制权，
    // 后续确认框仍由已安装的 dialog/layer 监听器自动接受。
    try {
      // Capture the dialog index before the click; native confirm can appear
      // and be accepted within the first 150 ms.
      const dialogStart = this.dialogs.length;
      onStage('month-submit-started');
      await scheduleSiteClick(chooseButton, { markConsumed:true });
      onStage('month-submitted');
      this.timing.count('browser_action_count');
      await sleep(150);
      // 月份窗口关闭有动画延迟。已点击按钮带消费标记，自动确认只会处理
      // 后续新出现的确认层，不会再次点击旧月份按钮。
      const confirmedLayers = await this.autoSiteConfirm(5000);
      const confirmDialogs = this.dialogs.slice(dialogStart).filter((message) => /上传|确定|确认/.test(normalizeText(message)));
      const confirmationSeen = confirmedLayers > 0 || confirmDialogs.length > 0;
      if (confirmationSeen) onStage('upload-confirmed');

      // 上传完成数可能通过接口 JSON、原生 alert 或 Layui 消息层返回。
      // 持续读取全部匹配响应，不能让中间响应抢先结束监听。
      const resultDeadline = Date.now() + 60000;
      let uploadedCount;
      let interfaceReceiptLogged = false;
      while (Date.now() < resultDeadline && uploadedCount === undefined) {
        uploadedCount = await uploadTransport.uploadedCount();
        if (uploadedCount === files.length && !interfaceReceiptLogged) {
          interfaceReceiptLogged = true;
          this.log(`已从上传接口回执确认本批 ${uploadedCount} 张。`);
        }
        const resultMessages = await this.page.locator('.layui-layer-msg:visible .layui-layer-content').allInnerTexts().catch(() => []);
        for (const message of resultMessages.map((value) => normalizeText(value)).filter(Boolean)) {
          if (!this.layerMessages.includes(message)) this.layerMessages.push(message);
        }
        if (uploadedCount === undefined) {
          const result = resolveBlessingUploadCount([...this.dialogs, ...this.layerMessages], files.length);
          uploadedCount = result.uploadedCount;
        }
        if (uploadedCount === undefined) await sleep(100);
      }
      if (uploadedCount !== files.length) {
        const summary = [...this.dialogs,...this.layerMessages].join('；');
        const error = new Error(`系统没有返回与本批一致的上传数量：本批 ${files.length} 张${summary ? `，提示：${summary}` : ''}。程序将按编号查询线上逐张对账。`);
        error.code = 'BLESSING_UPLOAD_OUTCOME_UNCONFIRMED';
        error.uploadEvidence = {
          confirmationSeen,
          requestStarted:uploadTransport.state.requestCount > 0,
          responseSeen:uploadTransport.state.responseCount > 0,
        };
        throw error;
      }
      onStage('verified');
      this.log(`福单图上传成功：${uploadedCount} 张，月份 ${monthText}。`);
      return { uploadedCount, month: monthText, files: files.map((file) => path.basename(file)) };
    } finally {
      uploadTransport.stop();
    }
  }
  async selectOptionByVisibleText(selector, wantedText, { exact = true, required = true } = {}) {
    const select = this.page.locator(selector).first();
    if (!await select.count()) {
      if (required) throw new Error(`没有识别到筛选框：${wantedText}`);
      return false;
    }
    const options = await select.locator('option').allTextContents();
    const index = options.findIndex((text) => exact ? normalizeText(text) === normalizeText(wantedText) : normalizeText(text).includes(normalizeText(wantedText)));
    if (index < 0) {
      if (required) throw new Error(`筛选框中没有“${wantedText}”选项。`);
      return false;
    }
    const value = await select.locator('option').nth(index).getAttribute('value');
    await select.selectOption(value ?? { index });
    return true;
  }
  async queryOrdersByBlessingUploadStatus(date, uploadStatus, { productMode = 'all', sceneStatus = null, url = LIST_URL, state = null, allStates = false } = {}) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.timing.count('browser_action_count');
    await this.waitForLogin(url);
    // 必须先清除站点保留的旧筛选，再切换分页，最后才填写本次条件。
    // 否则旧的 0 条结果会令后台把 pageSize 强制恢复为 10。
    await this.preparePageSize1000();
    const endDate = nextDateToken(date);
    for (const selector of ['#bCode','#orderCode','#userId','#receiveBlessing','#aTd']) {
      if (await this.page.locator(selector).count()) await this.page.locator(selector).fill('');
    }
    for (const selector of ['#bType','#supportName','#upload','#upload1','#video1']) {
      if (await this.page.locator(selector).count()) await this.page.locator(selector).selectOption('').catch(() => {});
    }
    await this.page.locator('#startTime').evaluate((element, value) => { element.removeAttribute('readonly'); element.value=value; element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})); }, date);
    await this.page.locator('#endTime').evaluate((element, value) => { element.removeAttribute('readonly'); element.value=value; element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})); }, endDate);
    if (allStates && await this.page.locator('#state').count()) await this.page.locator('#state').selectOption('');
    else if (state) await this.selectOptionByVisibleText('#state', state);
    await this.selectOptionByVisibleText('#upload', uploadStatus);
    if (sceneStatus) await this.selectOptionByVisibleText('#upload1', sceneStatus);
    if (productMode === 'water') await this.selectOptionByVisibleText('#supportName', '供水养净');
    await this.submitListSearch();
    const rows = await this.readRows();
    const total = await this.readListPageTotal();
    if (total !== null && total > rows.length) throw new Error(`照片订单共 ${total} 条，超过当前页 ${rows.length} 条；为避免漏单已停止。`);
    return rows;
  }
  async queryUploadedOrders(date, options = {}) {
    return this.queryOrdersByBlessingUploadStatus(date, '已上传', options);
  }
  async queryNotUploadedOrders(date, options = {}) {
    return this.queryOrdersByBlessingUploadStatus(date, '未上传', options);
  }
  async queryUploadedTabletPhotoOrders(date) {
    return this.queryOrdersByBlessingUploadStatus(date, '已上传', { url:TABLET_LIST_URL, allStates:true });
  }
  async queryNotUploadedTabletPhotoOrders(date) {
    return this.queryOrdersByBlessingUploadStatus(date, '未上传', { url:TABLET_LIST_URL, allStates:true });
  }
  async queryUploadedTabletOrders(date) {
    // 牌位没有场景图。回传图片由统一福单图入口匹配后，在牌位福单页表现为
    // “祈福中 + 牌位图已上传”；此时即可批量完成，不应再套用场景图条件。
    return this.queryOrdersByBlessingUploadStatus(date, '已上传', {
      url: TABLET_LIST_URL,
      state: '祈福中',
    });
  }
  async uploadSceneMode(date, mode, files, { attempt = 1, expectedPhotoDir = null } = {}) {
    const label = mode === 'water' ? '供水' : '供灯';
    if (!expectedPhotoDir) throw new Error(`${date} 的${label}场景图缺少业务日期目录校验，已停止上传。`);
    const expectedRealDir = fs.realpathSync.native(expectedPhotoDir);
    for (const file of files) {
      const realFile = fs.realpathSync.native(file);
      if (path.dirname(realFile).toLowerCase() !== expectedRealDir.toLowerCase()) {
        throw new Error(`${date} 的${label}场景图不属于该业务日期目录，禁止上传：${file}`);
      }
    }
    // 平台的供养物下拉筛选会把含不可见字符的“供水养净”数据漏成 0 条。
    // 始终查询完整的“福单已上传 + 场景图未上传”集合，再用已统一清洗的
    // 产品名称在本地分出供水/供灯；全选仍由 selectRows(mode) 按同一规则执行。
    const rows = await this.queryUploadedOrders(date, { productMode: 'all', sceneStatus: '未上传' });
    const expectedRows = mode === 'water' ? rows.filter((row) => normalizeText(row.productName).includes('供水养净')) : rows.filter((row) => !normalizeText(row.productName).includes('供水养净'));
    if (!expectedRows.length) {
      this.log(`${label}：没有“福单已上传且场景图未上传”的订单，跳过。`);
      return { mode, selectedCount: 0, skipped: true, files: [] };
    }
    if (!files.length) throw new Error(`${label}有 ${expectedRows.length} 条订单，但本地没有对应场景图。`);
    const selected = await this.selectRows(mode === 'water' ? 'water' : 'ordinary');
    if (selected !== expectedRows.length) throw new Error(`${label}场景图选择 ${selected} 条，与筛选结果 ${expectedRows.length} 条不一致。`);
    this.dialogs = [];
    const button = this.page.getByText('批量上传场景图', { exact: true }).first();
    if (!await button.count()) throw new Error('没有识别到“批量上传场景图”按钮。');
    await button.click();
    this.timing.count('browser_action_count');
    // 大批量订单时平台会先计算并拼接全部 ids，再延迟挂载 Layui iframe。
    // 2026-08-30 的 119 条供灯订单实测超过旧版 10 秒；窗口最终正常出现，
    // 旧版却已报错退出。取最后一个匹配 frame，并等待文件控件真正挂载，
    // 既能接管迟到窗口，也避免误用上一轮已隐藏的上传 frame。
    const uploadFrame = await waitForSceneUploadFrame(this.page);
    if (!uploadFrame) throw new Error(`场景图上传窗口等待 ${SCENE_UPLOAD_FRAME_TIMEOUT_MS / 1000} 秒仍未就绪；未选择或上传任何文件。`);
    const input = uploadFrame.locator('input[type="file"]').first();
    await input.waitFor({ state: 'attached', timeout: 10000 });
    await input.setInputFiles(files);
    const queuedDeadline = Date.now() + 10000;
    let queuedCount = 0;
    while (Date.now() < queuedDeadline) {
      queuedCount = await uploadFrame.locator('.filelist li').count();
      if (queuedCount === files.length) break;
      await sleep(100);
    }
    if (queuedCount !== files.length) throw new Error(`${label}场景图只加入上传队列 ${queuedCount}/${files.length} 张；尚未点击开始上传。`);
    const uploadButton = uploadFrame.locator('.uploadBtn').first();
    await uploadButton.waitFor({ state: 'visible', timeout: 10000 });
    let updateResponse = null;
    const trackUpdate = (response) => {
      if (/\/blessing\/updateScenePic(?:[?#]|$)/i.test(response.url()) && response.request().method() === 'POST') updateResponse = response;
    };
    this.page.on('response', trackUpdate);
    try {
      await uploadButton.click();
      this.timing.count('browser_action_count');
      const uploadDeadline = Date.now() + 120000;
      while (!updateResponse && Date.now() < uploadDeadline) {
        const itemCount = await uploadFrame.locator('.filelist li').count();
        const completeCount = await uploadFrame.locator('.filelist li.state-complete').count();
        const errorCount = await uploadFrame.locator('.filelist li.state-error').count();
        if (itemCount === files.length && completeCount + errorCount === itemCount && errorCount > 0) {
          throw new Error(`${label}场景图有 ${errorCount} 张上传失败。`);
        }
        await sleep(100);
      }
      if (!updateResponse) throw new Error(`${label}场景图上传超过120秒，未收到订单关联结果。`);
      if (!updateResponse.ok()) throw new Error(`${label}场景图关联订单失败：HTTP ${updateResponse.status()}。`);
      const updatePayload = await updateResponse.json().catch(() => null);
      if (updatePayload?.result && Number(updatePayload.result.state) !== 1) {
        throw new Error(`${label}场景图关联订单失败：${updatePayload.result.message || '系统返回失败状态'}。`);
      }
    } catch (error) {
      if (attempt < 3) {
        this.timing.count('retry_count');
        this.log(`${label}场景图第 ${attempt} 次上传未成功，正在按线上未上传状态自动重试：${String(error.message || error).split(/\r?\n/)[0]}`);
        await this.page.goto(LAMP_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this.timing.count('browser_action_count');
        return this.uploadSceneMode(date, mode, files, { attempt: attempt + 1, expectedPhotoDir });
      }
      throw error;
    } finally {
      this.page.off('response', trackUpdate);
    }
    await sleep(500);
    const remaining = await this.queryUploadedOrders(date, { productMode: 'all', sceneStatus: '未上传' });
    const remainingMode = mode === 'water' ? remaining.filter((row) => normalizeText(row.productName).includes('供水养净')) : remaining.filter((row) => !normalizeText(row.productName).includes('供水养净'));
    if (remainingMode.length) throw new Error(`${label}场景图上传后仍有 ${remainingMode.length} 条未上传，已停止。`);
    this.log(`${label}场景图上传并复核完成：${selected} 条订单，${files.length} 张场景图。`);
    return { mode, selectedCount: selected, skipped: false, files: files.map((file) => path.basename(file)) };
  }
  async countUploadedWithoutScene(date) {
    const rows = await this.queryUploadedOrders(date, { productMode:'all', sceneStatus:'未上传' });
    return rows.length;
  }
  async completeUploadedPhotoOrders(date, expectedOrderCount = null, expectedOrderIdHash = null) {
    const rows = await this.queryUploadedOrders(date, { productMode:'all', sceneStatus:'已上传' });
    if (!rows.length) {
      const recoveredCount = Number(expectedOrderCount || 0);
      this.log(`线上已没有待批量完成的订单；判定上次提交已经成功，本次只复核并补记 ${recoveredCount} 条完成回执。`);
      return recoveredCount;
    }
    if (Number(expectedOrderCount || 0) > 0 && rows.length !== Number(expectedOrderCount)) {
      throw new Error(`批量完成前线上订单数异常：预期 ${expectedOrderCount} 条，实际 ${rows.length} 条；已停止提交。`);
    }
    if (expectedOrderIdHash && hashIds(rows) !== expectedOrderIdHash) {
      throw new Error('批量完成前线上订单清单发生变化；已停止提交。');
    }
    if (await this.page.locator('#checked_all').count()) await this.page.locator('#checked_all').check();
    else await this.page.locator('table thead input[type="checkbox"]').first().check();
    const checkedCount = await this.page.locator('input[name="ids"]:checked').count();
    if (checkedCount !== rows.length) throw new Error(`批量完成全选数量异常：预期 ${rows.length} 条，实际 ${checkedCount} 条。`);
    const button = this.page.getByText('批量完成', { exact:true }).first();
    if (!await button.count()) throw new Error('没有识别到“批量完成”按钮。');
    // 站点 onclick 会同步打开确认层并可能保持事件处理器不返回。异步调度点击后，
    // 由下面的确认层处理和线上复核判断是否真正完成；断点重跑不会重复上传场景图。
    try {
      await scheduleSiteClick(button);
    } catch (error) {
      if (!/Execution context was destroyed|navigation|Target page, context or browser has been closed/i.test(String(error.message || error))) throw error;
    }
    this.timing.count('browser_action_count');
    await sleep(150);
    await this.autoSiteConfirm(5000);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await sleep(1000);
    let remaining = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        remaining = await this.queryUploadedOrders(date, { productMode:'all', sceneStatus:'已上传' });
        break;
      } catch (error) {
        lastError = error;
        if (!/ERR_ABORTED|interrupted by another navigation/i.test(String(error.message || error)) || attempt === 3) throw error;
        this.timing.count('retry_count');
        await sleep(1000);
      }
    }
    if (!remaining) throw lastError || new Error('批量完成后无法复核线上状态。');
    if (remaining.length) throw new Error(`批量完成后仍有 ${remaining.length} 条订单未完成；进度已保存，下次会从本环节安全续跑。`);
    this.log(`批量完成成功：${rows.length} 条订单。`);
    return rows.length;
  }
  async completeUploadedTabletOrders(date, expectedOrderCount = null, expectedOrderIdHash = null) {
    const rows = await this.queryUploadedTabletOrders(date);
    if (!rows.length) {
      const recoveredCount = Number(expectedOrderCount || 0);
      if (recoveredCount > 0) this.log(`线上已没有待完成的牌位；判定上次提交成功，本次补记 ${recoveredCount} 条牌位完成回执。`);
      else this.log('当天没有“祈福中且牌位图已上传”的牌位，牌位完成步骤无需提交。');
      return recoveredCount;
    }
    if (Number(expectedOrderCount || 0) > 0 && rows.length !== Number(expectedOrderCount)) {
      throw new Error(`牌位批量完成前线上数量异常：预期 ${expectedOrderCount} 条，实际 ${rows.length} 条；已停止提交。`);
    }
    if (expectedOrderIdHash && hashIds(rows) !== expectedOrderIdHash) {
      throw new Error('牌位批量完成前订单清单发生变化；已停止提交。');
    }
    if (rows.some((row) => !['长生禄位','往生莲位'].includes(normalizeText(row.productName)))) {
      throw new Error('牌位批量完成筛选结果混入了非牌位供养物；已停止提交。');
    }
    if (await this.page.locator('#checked_all').count()) await this.page.locator('#checked_all').check();
    else await this.page.locator('table thead input[type="checkbox"]').first().check();
    const checkedCount = await this.page.locator('input[name="ids"]:checked').count();
    if (checkedCount !== rows.length) throw new Error(`牌位批量完成全选数量异常：预期 ${rows.length} 条，实际 ${checkedCount} 条。`);
    const button = this.page.getByText('批量完成', { exact:true }).first();
    if (!await button.count()) throw new Error('牌位页面没有识别到“批量完成”按钮。');
    try {
      await scheduleSiteClick(button);
    } catch (error) {
      if (!/Execution context was destroyed|navigation|Target page, context or browser has been closed/i.test(String(error.message || error))) throw error;
    }
    this.timing.count('browser_action_count');
    await sleep(150);
    await this.autoSiteConfirm(5000);
    await this.page.waitForLoadState('domcontentloaded', { timeout:10000 }).catch(() => {});
    await sleep(1000);
    let remaining = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        remaining = await this.queryUploadedTabletOrders(date);
        break;
      } catch (error) {
        lastError = error;
        if (!/ERR_ABORTED|interrupted by another navigation/i.test(String(error.message || error)) || attempt === 3) throw error;
        this.timing.count('retry_count');
        await sleep(1000);
      }
    }
    if (!remaining) throw lastError || new Error('牌位批量完成后无法复核线上状态。');
    if (remaining.length) throw new Error(`牌位批量完成后仍有 ${remaining.length} 条未完成；断点已保存，下次会安全续跑。`);
    this.log(`牌位批量完成成功：${rows.length} 条。`);
    return rows.length;
  }
  static manifest(rows, date) { return { schemaVersion: 1, businessDate: date, orderCount: rows.length, orderIdHash: hashIds(rows), rows }; }
  async changeRenewalState(expectedHash) {
    const rows = await this.queryRenewals();
    if (!rows.length) throw new Error('续费未处理清单已经为空，没有需要修改的记录。');
    if (hashIds(rows) !== expectedHash) throw new Error('当前续费未处理清单与导出 PDF 时不一致，已停止状态变更。');
    if (await this.page.locator('#checked_all').count()) await this.page.locator('#checked_all').check();
    else await this.page.locator('table thead input[type="checkbox"]').first().check();
    const checkedCount = await this.page.locator('input[name="ids"]:checked').count();
    if (checkedCount !== rows.length) throw new Error(`续费状态变更全选数量异常：预期 ${rows.length} 条，实际 ${checkedCount} 条。`);
    const button = this.page.getByText('批量修改处理状态', { exact:true }).first();
    if (!await button.count()) throw new Error('续费页面没有识别到“批量修改处理状态”按钮。');
    try { await scheduleSiteClick(button); }
    catch (error) { if (!isNavigationRaceError(error) && !isClosedBrowserError(error)) throw error; }
    this.timing.count('browser_action_count');
    const dialog = this.page.locator('.layui-layer:visible, .modal:visible, [role="dialog"]:visible').last();
    await dialog.waitFor({ state:'visible', timeout:5000 }).catch(() => {});
    if (!await dialog.count()) throw new Error('续费状态确认窗口没有出现，未提交任何修改。');
    const dialogText = await dialog.innerText().catch(() => '');
    const selects = dialog.locator('select');
    let resolution = resolveRenewalTerminalDialog(dialogText);
    for (let i = 0; i < await selects.count() && resolution.mode !== 'select-option'; i += 1) {
      const select = selects.nth(i);
      const options = await select.locator('option').allTextContents();
      const candidate = resolveRenewalTerminalDialog(dialogText, options);
      if (candidate.mode === 'select-option') {
        const value = await select.locator('option').nth(candidate.optionIndex).getAttribute('value');
        await select.selectOption(value);
        resolution = candidate;
        break;
      }
    }
    if (resolution.mode === 'unrecognized') {
      throw new Error('续费状态窗口既没有已处理终态选项，也没有明确的“批量修改成已处理状态”确认文案，未提交任何修改。');
    }
    const confirm = dialog.locator(
      '.layui-layer-btn0, .layui-layer-btn a:has-text("确定"), button:has-text("确定"), button:has-text("确认"), a:has-text("确定")',
    ).first();
    if (!await confirm.count()) throw new Error('续费状态窗口没有识别到确定按钮，未提交任何修改。');
    try { await scheduleSiteClick(confirm); }
    catch (error) { if (!isNavigationRaceError(error) && !isClosedBrowserError(error)) throw error; }
    this.timing.count('browser_action_count');
    await this.page.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});
    await sleep(1200);
    const remaining = await this.queryRenewals();
    const remainingIds = new Set(remaining.map((row) => String(row.id)));
    const unchanged = rows.filter((row) => remainingIds.has(String(row.id)));
    if (unchanged.length) throw new Error(`续费状态修改后原批次仍有 ${unchanged.length} 条未处理，请人工核对。`);
    return { changedCount:rows.length, remainingRows:remaining, terminalUiLabel:resolution.label, dialogMode:resolution.mode };
  }
  async changeState(date, expectedHash, { reuseCurrentPage = false, pageType = 'lamp' } = {}) {
    // 状态变更必须在正式“供灯福单”页执行；“待处理福单”是另一业务入口。
    // 导出/已有PDF恢复分支在调用前已经完成同页日期、状态和订单哈希校验，
    // 此时再次 goto 会与页面自身的异步加载竞争并触发 ERR_ABORTED。
    const rows = reuseCurrentPage ? await this.readRows() : (pageType === 'tablet' ? await this.queryTabletPage(date) : await this.queryLamp(date)); const currentHash = hashIds(rows);
    if (reuseCurrentPage && !/\/blessing\/list(?:[/?#]|$)/i.test(this.page.url())) throw new Error('状态变更前已离开正式供灯福单页面。');
    if (currentHash !== expectedHash) throw new Error('当前待祈福订单与导出时清单不一致，已停止状态变更。请重新导出。');
    if (!rows.length) throw new Error('没有待变更订单。');
    if (await this.page.locator('#checked_all').count()) await this.page.locator('#checked_all').check();
    else await this.page.locator('table thead input[type="checkbox"]').first().check();
    const checkedCount = await this.page.locator('input[name="ids"]:checked').count();
    if (checkedCount !== rows.length) throw new Error(`状态变更全选数量异常：预期 ${rows.length} 条，实际 ${checkedCount} 条。`);
    await this.page.getByText('批量修改福单状态', { exact: true }).click(); this.timing.count('browser_action_count');
    await sleep(300);
    const select = this.page.locator('.layui-layer select, .modal select, select').filter({ has: this.page.locator('option') });
    let changed = false;
    for (let i = 0; i < await select.count(); i++) {
      const s = select.nth(i); const options = await s.locator('option').allTextContents(); const idx = options.findIndex((x) => normalizeText(x).includes('祈福中'));
      if (idx >= 0) { const value = await s.locator('option').nth(idx).getAttribute('value'); await s.selectOption(value); changed = true; break; }
    }
    if (!changed) { this.timing.count('user_intervention_count'); throw new Error('没有识别到“祈福中”状态选项，未提交任何修改。'); }
    const confirm = this.page.locator('.layui-layer-btn a:has-text("确定"), .modal button:has-text("确定"), button:has-text("确认")').first();
    if (!await confirm.count()) throw new Error('没有识别到状态确认按钮，未提交任何修改。');
    try {
      // 站点确认后会立即刷新列表。普通 click 会把该刷新当成当前点击的一部分等待，
      // 随后读取旧执行上下文时可能误报 Execution context was destroyed。
      // DOM click 只提交动作；是否成功一律由下面按原日期重新查询待祈福清单判断。
      await scheduleSiteClick(confirm);
    } catch (error) {
      if (!isNavigationRaceError(error) && !isClosedBrowserError(error)) throw error;
    }
    this.timing.count('browser_action_count');
    await this.page.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{}); await sleep(1200);
    let remaining = null;
    try { remaining = await this.readRows(); }
    catch (error) {
      if (!isNavigationRaceError(error) && !isClosedBrowserError(error)) throw error;
      this.timing.count('retry_count');
    }
    // 页面若仍显示旧行或刷新时旧上下文已经失效，按同一日期、待祈福状态重新查询。
    // 查询结果为 0 才确认成功；因此导航竞争不会造成重复提交。
    if (remaining === null || remaining.length) {
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await sleep(attempt === 1 ? 300 : 800);
          remaining = pageType === 'tablet' ? await this.queryTabletPage(date) : await this.queryLamp(date);
          break;
        } catch (error) {
          lastError = error;
          if ((!isNavigationRaceError(error) && !isClosedBrowserError(error)) || attempt === 3) throw error;
          this.timing.count('retry_count');
        }
      }
      if (remaining === null) throw lastError || new Error('状态变更后无法复核线上待祈福清单。');
    }
    if (remaining.length) throw new Error(`状态变更后仍有 ${remaining.length} 条待祈福订单，请人工核对。`);
    return rows.length;
  }
}
