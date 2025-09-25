// netlify/functions/transcribe-whisper.js
// 필요 env: OPENAI_API_KEY (Node 18+, undici 내장 fetch/FormData/Blob 사용)
exports.handler = async (event) => {
  // CORS (선택)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: cors(), body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    const {
      base64,
      mimeType = 'audio/webm',
      filename = 'rec.webm',
      options = {}
    } = body;

    if (!process.env.OPENAI_API_KEY) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ message: 'Missing OPENAI_API_KEY' }) };
    }
    if (!base64) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ message: 'base64 audio required' }) };
    }

    // ✅ Whisper에 “한글 수사로 표기” 편향 주기
    const lang = options.language || 'ko';
    const temperature = (options.temperature ?? 0);
    const prompt = (typeof options.prompt === 'string' && options.prompt.trim().length)
      ? options.prompt
      : '모든 수사는 한글로 표기하세요. 숫자(0-9)는 사용하지 마세요.';

    const buf = Buffer.from(base64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mimeType }), filename);
    form.append('model', 'whisper-1');
    form.append('language', String(lang));
    form.append('temperature', String(temperature));
    form.append('prompt', prompt);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });

    if (!res.ok) {
      const t = await res.text().catch(()=> '');
      return { statusCode: 502, headers: cors(), body: JSON.stringify({ message: 'whisper error', detail: t }) };
    }

    const data = await res.json(); // { text: "..." }
    return {
      statusCode: 200,
      headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ text: data.text || '' })
    };
  } catch (e) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ message: String(e) }) };
  }
};

function cors(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };
}
