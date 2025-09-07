// netlify/functions/log-error.js
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const JSON_TYPE = { 'Content-Type': 'application/json' };

exports.handler = async (event) => {
  try {
    // --- CORS / Origin allowlist ---
    const originHdr = event.headers?.origin || event.headers?.Origin || '';
    const allowlist = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowOrigin = allowlist.length ? (allowlist.includes(originHdr) ? originHdr : allowlist[0]) : '*';
    const CORS = {
      ...JSON_TYPE,
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Log-Token',
      'Vary': 'Origin'
    };

    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: CORS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: CORS, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    // --- Optional token check ---
    const requiredToken = process.env.LOG_ERROR_TOKEN;
    const providedToken = event.headers?.['x-log-token'] || event.headers?.['X-Log-Token'];
    if (requiredToken && providedToken !== requiredToken) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    // --- Env check ---
    const { GMAIL_USER, GMAIL_APP_PASSWORD, RECIPIENT_EMAIL } = process.env;
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !RECIPIENT_EMAIL) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ message: 'Missing env: GMAIL_USER / GMAIL_APP_PASSWORD / RECIPIENT_EMAIL' })
      };
    }

    // --- Safe JSON parse ---
    const payload = safeParse(event.body);
    if (!payload.ok) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Invalid JSON body' }) };
    }
    const {
      studentName = 'N/A',
      functionName = 'N/A',
      context = {},
      pageUrl = 'N/A',
      error = {}
    } = payload.value || {};

    const ua = event.headers?.['user-agent'] || event.headers?.['User-Agent'] || 'N/A';
    const reqId = event.headers?.['x-nf-request-id'] || 'N/A';
    const ip = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for'] || 'N/A';

    // --- Fingerprint (for grouping) ---
    const firstStackLine = String(error.stack || '').split('\n')[1]?.trim() || '';
    const fp = crypto.createHash('sha1').update([
      functionName || '',
      error.message || '',
      firstStackLine,
      pageUrl || ''
    ].join('|')).digest('hex').slice(0, 12);

    // --- Escape & truncate ---
    const esc = escapeHtml;
    const ctxString = JSON.stringify(context || {}, null, 2);
    const ctxPreviewMax = 8000; // 본문 내 미리보기 길이 제한
    const ctxPreview = ctxString.length > ctxPreviewMax
      ? (ctxString.slice(0, ctxPreviewMax) + `\n... (truncated, see attachment)`)
      : ctxString;

    // --- Mail HTML ---
    const html = `
      <h2>🚨 Korean Exercise Error Report</h2>
      <p><b>Fingerprint:</b> ${esc(fp)}</p>
      <p><b>Student:</b> ${esc(String(studentName))}</p>
      <p><b>Function:</b> ${esc(String(functionName))}</p>
      <p><b>Page:</b> ${esc(String(pageUrl))}</p>
      <p><b>User-Agent:</b> ${esc(String(ua))}</p>
      <p><b>Client IP:</b> ${esc(String(ip))}</p>
      <p><b>Request ID:</b> ${esc(String(reqId))}</p>
      <hr/>
      <pre style="white-space:pre-wrap"><b>Error:</b> ${esc(String(error.message || ''))}</pre>
      <pre style="white-space:pre-wrap"><b>Stack:</b> ${esc(String(error.stack || ''))}</pre>
      <hr/>
      <pre style="white-space:pre-wrap"><b>Context (preview):</b>\n${esc(ctxPreview)}</pre>
    `;

    // --- Plain text (fallback) ---
    const text =
`[Korean Exercise Error Report]
Fingerprint: ${fp}
Student: ${studentName}
Function: ${functionName}
Page: ${pageUrl}
User-Agent: ${ua}
Client IP: ${ip}
Request ID: ${reqId}

Error: ${error.message || ''}
Stack:
${error.stack || ''}

Context (preview):
${ctxPreview}
`;

    // --- Attachments (full context as JSON) ---
    const attachments = [{
      filename: `context-${fp}.json`,
      content: Buffer.from(ctxString, 'utf8'),
      contentType: 'application/json'
    }];

    // --- SMTP (Gmail) ---
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000
    });

    await transporter.sendMail({
      from: `"Exercise Error" <${GMAIL_USER}>`,
      to: RECIPIENT_EMAIL,
      subject: `🚨 Exercise Error Log [${fp}] – ${studentName} – ${functionName}`,
      html,
      text,
      headers: { 'X-Error-Fingerprint': fp, 'X-Request-ID': reqId },
      attachments
      // (선택) DKIM은 조직 도메인 SMTP 사용 시 설정 권장 — nodemailer DKIM 플러그인 활용
    });

    return { statusCode: 200, headers: { ...CORS }, body: JSON.stringify({ ok: true, fingerprint: fp, requestId: reqId }) };
  } catch (err) {
    console.error('log-error failed:', err);
    return { statusCode: 500, headers: JSON_TYPE, body: JSON.stringify({ message: 'log-error failed', error: String(err) }) };
  }
};

// ---------- helpers ----------
function safeParse(body) {
  try {
    return { ok: true, value: JSON.parse(body || '{}') };
  } catch (_) {
    return { ok: false };
  }
}
function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}
