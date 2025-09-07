// netlify/functions/transcribe-whisper.js
// 필요 env: OPENAI_API_KEY
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    const { base64, mimeType = 'audio/webm', filename = 'rec.webm' } = JSON.parse(event.body || '{}');
    if (!process.env.OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Missing OPENAI_API_KEY' }) };
    }
    if (!base64) {
      return { statusCode: 400, body: JSON.stringify({ message: 'base64 audio required' }) };
    }

    const buf = Buffer.from(base64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mimeType }), filename);
    form.append('model', 'whisper-1');
    form.append('language', 'ko');           // 언어 고정 → 교정 최소화
    form.append('temperature', '0');         // 랜덤성 최소화
    // form.append('prompt','');              // 힌트 비우기(스냅 방지)

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    if (!res.ok) {
      const t = await res.text().catch(()=> '');
      return { statusCode: 502, body: JSON.stringify({ message: 'whisper error', detail: t }) };
    }
    const data = await res.json(); // { text: "..." }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ text: data.text || '' })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ message: String(e) }) };
  }
};
