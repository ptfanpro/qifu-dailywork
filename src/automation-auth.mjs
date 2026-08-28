import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const TOKEN_PATH = '/internal/automation/v1/token';
const STATUS_PATH = '/internal/automation/v1/status';
const DAILY_PLAN_PATH = '/internal/automation/v1/daily/plan';
const DAILY_PLAN_SCOPE = 'daily:plan:read';
const DAILY_PLAN_GROUPS = [
  'water', 'ordinary-red', 'ordinary-yellow', 'tablet-red',
  'tablet-yellow', 'renewal-red', 'renewal-yellow',
];

function decodeBase64(value, label) {
  if (!value) throw new Error(`接口认证凭据缺少${label}。`);
  return Buffer.from(String(value), 'base64').toString('utf8');
}

export function normalizeAutomationBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error('接口认证地址无效。'); }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('接口认证只允许 HTTPS；本机回归测试可使用 localhost HTTP。');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('接口认证地址不得包含账号、密码、查询参数或片段。');
  }
  return url.toString().replace(/\/$/, '');
}

export function readEncryptedAutomationCredential(credentialPath, helperPath) {
  if (!credentialPath || !helperPath || !fs.existsSync(credentialPath) || !fs.existsSync(helperPath)) return null;
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', helperPath, '-Path', credentialPath,
  ], { encoding:'utf8', windowsHide:true, timeout:10000 });
  if (result.status !== 0) throw new Error('接口认证凭据无法解密；请在本机重新配置。');
  try {
    const parsed = JSON.parse(String(result.stdout || '').trim());
    const credential = {
      baseUrl:normalizeAutomationBaseUrl(decodeBase64(parsed.baseUrlBase64, '服务地址')),
      clientId:decodeBase64(parsed.clientIdBase64, '客户端编号'),
      secret:decodeBase64(parsed.secretBase64, '机器密钥'),
    };
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(credential.clientId)) throw new Error('invalid client');
    if (Buffer.byteLength(credential.secret, 'utf8') < 32 || Buffer.byteLength(credential.secret, 'utf8') > 256) throw new Error('invalid secret');
    return credential;
  } catch (error) {
    if (/接口认证地址/.test(String(error?.message || ''))) throw error;
    throw new Error('接口认证凭据格式无效；请在本机重新配置。');
  }
}

export function canonicalTokenRequest(clientId, timestamp, nonce) {
  return ['POST', TOKEN_PATH, clientId, String(timestamp), nonce].join('\n');
}

export function createTokenRequest(credential, { now = () => Date.now(), randomBytes = crypto.randomBytes } = {}) {
  const clientId = String(credential?.clientId || '').trim();
  const secretText = String(credential?.secret || '');
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(clientId)) throw new Error('接口认证客户端编号无效。');
  const secret = Buffer.from(secretText, 'utf8');
  if (secret.length < 32 || secret.length > 256) { secret.fill(0); throw new Error('接口认证机器密钥无效。'); }
  const timestamp = Math.floor(Number(now()) / 1000);
  const nonce = randomBytes(24).toString('base64url');
  const canonical = canonicalTokenRequest(clientId, timestamp, nonce);
  const signature = crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  secret.fill(0);
  return {
    method:'POST',
    headers:{
      'Accept':'application/json',
      'X-Automation-Client-Id':clientId,
      'X-Automation-Timestamp':String(timestamp),
      'X-Automation-Nonce':nonce,
      'X-Automation-Signature':signature,
    },
  };
}

async function jsonResponse(response, action) {
  let body = null;
  try { body = await response.json(); } catch { /* fail below without exposing body */ }
  if (!response.ok) throw new Error(`${action}失败（HTTP ${response.status}）。`);
  if (!body || typeof body !== 'object') throw new Error(`${action}返回格式无效。`);
  return body;
}

function normalizeBusinessDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('机器接口业务日期必须为 YYYY-MM-DD。');
  const [year, month, day] = text.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('机器接口业务日期无效。');
  }
  return text;
}

function assertHash(value, label) {
  if (!/^[a-f0-9]{64}$/.test(String(value || ''))) throw new Error(`机器接口日清单${label}无效。`);
}

function validateDailyPlan(body, businessDate) {
  if (body.schemaVersion !== '1.0' || body.businessDate !== businessDate || body.timezone !== 'Asia/Shanghai' || body.dryRun !== true) {
    throw new Error('机器接口日清单日期或版本不一致。');
  }
  if (body.renewalQueueScope !== 'global-pending-not-date-filtered') {
    throw new Error('机器接口续费队列范围无效。');
  }
  assertHash(body.canonicalOrderSetSha256, '总订单哈希');
  if (!body.totals || !body.groups) throw new Error('机器接口日清单缺少汇总或分组。');
  let daily = 0;
  let renewal = 0;
  for (const name of DAILY_PLAN_GROUPS) {
    const group = body.groups[name];
    if (!group || !Number.isSafeInteger(group.count) || group.count < 0 || !Array.isArray(group.items) || group.items.length !== group.count) {
      throw new Error(`机器接口日清单分组 ${name} 无效。`);
    }
    assertHash(group.idSetSha256, `分组 ${name} 订单哈希`);
    for (const item of group.items) {
      if (!item || !/^[1-9]\d*$/.test(String(item.orderId || ''))) throw new Error(`机器接口日清单分组 ${name} 存在无效订单。`);
      if (!['blessing', 'renewal'].includes(item.recordType)) throw new Error(`机器接口日清单分组 ${name} 存在无效记录类型。`);
      if (item.recordType === 'renewal' && !/^[1-9]\d*$/.test(String(item.renewalId || ''))) throw new Error(`机器接口日清单分组 ${name} 存在无效续费记录。`);
      if (typeof item.blessingImageUploaded !== 'boolean' || typeof item.sceneImageUploaded !== 'boolean') {
        throw new Error(`机器接口日清单分组 ${name} 的上传状态无效。`);
      }
    }
    if (name.startsWith('renewal-')) renewal += group.count;
    else daily += group.count;
  }
  if (!Number.isSafeInteger(body.totals.daily) || !Number.isSafeInteger(body.totals.renewal) || !Number.isSafeInteger(body.totals.all)
      || body.totals.daily !== daily || body.totals.renewal !== renewal || body.totals.all !== daily + renewal) {
    throw new Error('机器接口日清单汇总数量不一致。');
  }
  return body;
}

export class AutomationApiClient {
  constructor(credential, { fetchImpl = globalThis.fetch, now = () => Date.now(), randomBytes = crypto.randomBytes, timeoutMs = 10000 } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持接口认证请求。');
    this.baseUrl = normalizeAutomationBaseUrl(credential?.baseUrl);
    this.credential = { clientId:String(credential?.clientId || ''), secret:String(credential?.secret || '') };
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.randomBytes = randomBytes;
    this.timeoutMs = timeoutMs;
    this.token = null;
  }

  async request(path, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try { return await this.fetchImpl(`${this.baseUrl}${path}`, { ...options, signal:controller.signal }); }
    catch (error) {
      if (error?.name === 'AbortError') throw new Error('接口认证请求超时。');
      throw new Error('接口认证服务暂时不可访问。');
    } finally { clearTimeout(timer); }
  }

  async exchangeToken() {
    const request = createTokenRequest(this.credential, { now:this.now, randomBytes:this.randomBytes });
    const body = await jsonResponse(await this.request(TOKEN_PATH, request), '机器身份认证');
    if (body.tokenType !== 'Bearer' || typeof body.accessToken !== 'string' || body.accessToken.length < 80) {
      throw new Error('机器身份认证返回的令牌无效。');
    }
    if (!Number.isFinite(Number(body.expiresAt)) || Number(body.expiresAt) <= Math.floor(Number(this.now()) / 1000)) {
      throw new Error('机器身份认证返回的有效期无效。');
    }
    const scopes = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
    this.token = { value:body.accessToken, expiresAt:Number(body.expiresAt), scopes:new Set(scopes) };
    return { expiresAt:this.token.expiresAt, scopes:[...scopes] };
  }

  async bearer(requiredScope) {
    const nowSeconds = Math.floor(Number(this.now()) / 1000);
    if (!this.token || this.token.expiresAt <= nowSeconds + 10) await this.exchangeToken();
    if (requiredScope && !this.token.scopes.has(requiredScope)) {
      throw new Error(`机器接口凭据缺少权限：${requiredScope}。`);
    }
    return this.token.value;
  }

  async status() {
    const token = await this.bearer();
    const response = await this.request(STATUS_PATH, {
      method:'GET', headers:{ 'Accept':'application/json', 'Authorization':`Bearer ${token}` },
    });
    const body = await jsonResponse(response, '机器身份状态检查');
    if (body.authenticated !== true || body.adminSessionCreated !== false) {
      throw new Error('机器身份状态校验失败。');
    }
    return { authenticated:true, clientId:String(body.clientId || ''), scopes:Array.isArray(body.scopes) ? [...body.scopes] : [] };
  }

  async dailyPlan(value) {
    const businessDate = normalizeBusinessDate(value);
    const token = await this.bearer(DAILY_PLAN_SCOPE);
    const query = new URLSearchParams({ businessDate, dryRun:'true' });
    const response = await this.request(`${DAILY_PLAN_PATH}?${query.toString()}`, {
      method:'GET', headers:{ 'Accept':'application/json', 'Authorization':`Bearer ${token}` },
    });
    return validateDailyPlan(await jsonResponse(response, '机器接口日清单检查'), businessDate);
  }

  clear() {
    this.token = null;
    this.credential.secret = '';
  }
}
