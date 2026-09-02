/**
 * Cloudflare Pages Function — 表单后端（POST /api/lead）
 *
 * 说明：本文件为 Pages Functions（随 Pages 静态站一起部署），
 * 文件路径 functions/api/lead.js 自动映射为路由 /api/lead。
 * 前端 index.html 的表单同域调用 `/api/lead`，无需独立 Worker、无需 CORS。
 *
 * 逻辑流程（与原独立 Worker 版一致）：
 *   1) 字段校验
 *   2) Turnstile 人机校验（防垃圾提交）
 *   3) 写入飞书多维表格（CRM 线索库）
 *   4) 可选：飞书群自定义机器人即时通知
 *
 * 环境变量（Cloudflare Dashboard → Workers & Pages → minova-titanv →
 * Settings → Environment variables）：
 *   TURNSTILE_SECRET_KEY      (secret)  Turnstile 密钥；未配置则跳过校验（仅开发）
 *   ALLOWED_ORIGIN            (var)     允许的前端来源，如 https://minova.dhow.ink；缺省 *
 *   FEISHU_APP_ID             (secret)  飞书自建应用 App ID
 *   FEISHU_APP_SECRET         (secret)  飞书自建应用 App Secret
 *   FEISHU_BITABLE_APP_TOKEN  (var)     多维表格 app_token（表格 URL 里 /base/ 之后那段）
 *   FEISHU_BITABLE_TABLE_ID   (var)     数据表 table_id（表格 URL 里 ?table= 之后那段）
 *   FEISHU_BOT_WEBHOOK_URL    (secret)  飞书群自定义机器人 webhook（可选）
 */

// 飞书多维表格字段名：必须与表列名「完全一致」（可改成中文，如 '姓名'）
const FIELDS = {
  first: 'First Name',
  last: 'Last Name',
  email: 'Email',
  company: 'Company',
  country: 'Country',
  interest: 'Interest',
  message: 'Message',
  pageUrl: 'Page URL',
};

const LEAD_PATH = '/api/lead';

// tenant_access_token 有效期 2 小时，做进程内缓存（单 isolate 内有效）
let tokenCache = { token: null, expiresAt: 0 };

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function corsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function verifyTurnstile(token, ip, secret) {
  if (!secret) {
    console.warn('[lead] TURNSTILE_SECRET_KEY not set — skipping verification (dev/demo).');
    return { ok: true, codes: [] };
  }
  if (!token) return { ok: false, codes: ['missing-input-response'] };
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: ip || '' }),
  });
  const data = await res.json();
  return { ok: !!data.success, codes: data['error-codes'] || [] };
}

async function getTenantToken(env) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60 * 1000) return tokenCache.token;
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`feishu token: ${data.msg || data.code}`);
  tokenCache = { token: data.tenant_access_token, expiresAt: now + (data.expire || 7200) * 1000 };
  return tokenCache.token;
}

async function pushToBitable(lead, env) {
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_BITABLE_APP_TOKEN || !env.FEISHU_BITABLE_TABLE_ID) {
    console.warn('[lead] Feishu Bitable not configured — lead accepted but not persisted.');
    return 'none';
  }
  const token = await getTenantToken(env);

  // 只写入非空字段，避免空值触发字段类型校验报错
  const fields = {
    [FIELDS.first]: lead.first,
    [FIELDS.last]: lead.last,
    [FIELDS.email]: lead.email,
    [FIELDS.company]: lead.company,
  };
  if (lead.country) fields[FIELDS.country] = lead.country;
  if (lead.interest) fields[FIELDS.interest] = lead.interest;
  if (lead.message) fields[FIELDS.message] = lead.message;
  if (lead.pageUrl) fields[FIELDS.pageUrl] = lead.pageUrl;

  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BITABLE_TABLE_ID}/records`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`feishu record: ${data.msg || data.code}`);
  return 'feishu-bitable';
}

async function notifyBot(lead, env) {
  if (!env.FEISHU_BOT_WEBHOOK_URL) return;
  const text = [
    '📥 新 Titan V 线索',
    `姓名：${lead.first} ${lead.last}`,
    `邮箱：${lead.email}`,
    `公司：${lead.company}`,
    `国家：${lead.country || '-'}`,
    `意向：${lead.interest || '-'}`,
    '',
    lead.message || '',
    '',
    `来源：${lead.pageUrl}`,
  ].join('\n');
  const res = await fetch(env.FEISHU_BOT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text } }),
  });
  const data = await res.json();
  if (!res.ok || data.code !== 0) console.warn(`[lead] bot notify failed: ${data.msg || res.status}`);
}

/** POST /api/lead — 接收表单线索 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = corsHeaders(env);

  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== LEAD_PATH) {
    return json({ ok: false, error: 'not-found' }, 404, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid-json' }, 400, cors);
  }

  const lead = {
    first: String(body.first ?? '').trim().slice(0, 200),
    last: String(body.last ?? '').trim().slice(0, 200),
    email: String(body.email ?? '').trim().toLowerCase().slice(0, 320),
    company: String(body.company ?? '').trim().slice(0, 300),
    country: String(body.country ?? '').trim().slice(0, 120),
    interest: String(body.interest ?? '').trim().slice(0, 120),
    message: String(body.message ?? '').trim().slice(0, 2000),
    pageUrl: String(body.pageUrl ?? '').trim().slice(0, 500),
  };

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!lead.first || !lead.last || !lead.company) return json({ ok: false, error: 'missing-required' }, 422, cors);
  if (!emailRe.test(lead.email)) return json({ ok: false, error: 'invalid-email' }, 422, cors);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const token = String(body['cf-turnstile-response'] ?? '');
  const verdict = await verifyTurnstile(token, ip, env.TURNSTILE_SECRET_KEY);
  if (!verdict.ok) return json({ ok: false, error: 'verification-failed', codes: verdict.codes }, 403, cors);

  // 落库 + 通知均「尽力而为」，飞书临时故障也不让访客看到失败
  let crm = 'none';
  try { crm = await pushToBitable(lead, env); } catch (err) { console.error('[lead] Bitable write failed:', err.message); }
  try { await notifyBot(lead, env); } catch (err) { console.error('[lead] bot notify failed:', err.message); }

  return json({ ok: true, message: 'received', crm }, 200, cors);
}

/** OPTIONS /api/lead — CORS 预检（保留兼容，同域调用时通常不触发） */
export async function onRequestOptions(context) {
  const { env } = context;
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}
