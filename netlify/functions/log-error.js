// netlify/functions/log-error.js
const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { GMAIL_USER, GMAIL_APP_PASSWORD, RECIPIENT_EMAIL } = process.env;
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !RECIPIENT_EMAIL) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Missing env: GMAIL_USER / GMAIL_APP_PASSWORD / RECIPIENT_EMAIL' }),
      };
    }

    const payload = JSON.parse(event.body || '{}');
    const {
      studentName = 'N/A',
      functionName = 'N/A',
      context = {},
      pageUrl = 'N/A',
      error = {},
    } = payload;

    const ua = (event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || 'N/A';

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    const html = `
      <h2>🚨 Korean Exercise Error Report</h2>
      <p><b>Student:</b> ${studentName}</p>
      <p><b>Function:</b> ${functionName}</p>
      <p><b>Page:</b> ${pageUrl}</p>
      <p><b>User-Agent:</b> ${ua}</p>
      <hr/>
      <pre><b>Error:</b> ${error.message || ''}</pre>
      <pre><b>Stack:</b> ${error.stack || ''}</pre>
      <hr/>
      <pre><b>Context:</b> ${JSON.stringify(context, null, 2)}</pre>
    `;

    await transporter.sendMail({
      from: `"Exercise Error" <${GMAIL_USER}>`,
      to: RECIPIENT_EMAIL,
      subject: '🚨 Exercise Error Log',
      html,
    });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('log-error failed:', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'log-error failed', error: String(err) }) };
  }
};
