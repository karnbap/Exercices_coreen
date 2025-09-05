// tts-openai.js  (Netlify Functions)
// Node 18+ (global fetch 사용)

exports.handler = async (event) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return json({ error: { message: 'Missing OPENAI_API_KEY' } }, 500);
    }

    const body = JSON.parse(event.body || '{}');
    const text = (body.text ?? '안녕하세요, 오늘은 숫자를 배워봅시다.').toString().slice(0, 300);
    const voice = (body.voice ?? 'alloy').toString();         // alloy, shimmer, nova, echo, fable
    const speed = Number(body.speed ?? 1.0);                   // 0.5 ~ 2.0
    const model = 'gpt-4o-mini-tts';                           // OpenAI TTS 모델
    const format = 'mp3';

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,   // SSML 미지원 → 쉼표/마침표로 멈춤 표현
        speed,
        format
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(()=>'');
      return json({ error: { message: `OpenAI ${res.status}: ${errText}` } }, 200);
    }

    const arrayBuf = await res.arrayBuffer();
    const b64 = Buffer.from(arrayBuf).toString('base64');
    return json({ mimeType: 'audio/mpeg', audioBase64: b64 }, 200);
  } catch (e) {
    return json({ error: { message: e.message } }, 200);
  }
};

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}
