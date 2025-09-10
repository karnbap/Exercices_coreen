// netlify/functions/transcribe-whisper.js
// 필요 env: OPENAI_API_KEY
const fetch = global.fetch || require('node-fetch');
const FormData = require('form-data');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept',
    'Cache-Control': 'no-store'
  };
  if (event.httpMethod === 'OPTIONS') return ({ statusCode: 204, headers, body: '' });
  if (event.httpMethod !== 'POST')   return ({ statusCode: 405, headers, body: JSON.stringify({ message:'Method Not Allowed' }) });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ message: 'Missing OPENAI_API_KEY' }) };
    }

    const payload = JSON.parse(event.body || '{}');
    let { base64, mimeType = 'audio/webm', filename } = payload || {};
    if (!base64) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'base64 audio required' }) };
    }

    // dataURL 프리픽스 제거 + URL-safe 교정
    if (base64.startsWith('data:')) {
      const i = base64.indexOf(',');
      if (i > -1) base64 = base64.slice(i + 1);
    }
    base64 = base64.replace(/-/g, '+').replace(/_/g, '/');

    // MIME 정규화(세미콜론 뒤는 버리고, Safari m4a 대응)
    mimeType = String(mimeType || 'audio/webm').split(';')[0] || 'audio/webm';
    if (!filename) {
      if (mimeType === 'audio/mp4' || mimeType === 'audio/m4a') filename = 'rec.m4a';
      else if (mimeType === 'audio/ogg') filename = 'rec.ogg';
      else if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') filename = 'rec.mp3';
      else filename = 'rec.webm';
    }

    const buf = Buffer.from(base64, 'base64');
    const form = new FormData();
    form.append('file', buf, { filename, contentType: mimeType, knownLength: buf.length });
    form.append('model', 'whisper-1');
    form.append('language', 'ko');
    form.append('temperature', '0');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() },
      body: form
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { statusCode: 502, headers, body: JSON.stringify({ message: 'whisper error', detail: String(t).slice(0, 200) }) };
    }

    const data = await res.json(); // { text: "..." }
    return { statusCode: 200, headers, body: JSON.stringify({ text: data.text || '' }) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: String(e) }) };
  }
};
