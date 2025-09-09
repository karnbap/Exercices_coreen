// netlify/functions/generate-audio.js
// TTS: OpenAI 우선 → 실패 시 Google 폴백
// 요청: { text?:string, ssml?:string, voice?:string, speed?:number, provider?:string }
// 응답: { audioData:string, audioBase64:string, mimeType:string }  ← 두 키 모두 제공(호환성)

const fetch = global.fetch || require('node-fetch');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GOOGLE_TTS_KEY = process.env.GOOGLE_TTS_KEY || '';

const SAFE_VOICES = new Set(['alloy','shimmer','verse','nova','fable','echo']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method Not Allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const provider = String(body.provider || 'openai').toLowerCase();
    const voiceReq = String(body.voice || 'alloy');
    const voice = SAFE_VOICES.has(voiceReq) ? voiceReq : 'alloy';
    const speed = clamp(Number(body.speed ?? 1.0), 0.5, 2.0);

    // 입력: ssml 우선
    const text = typeof body.text === 'string' ? body.text : '';
    const ssmlIn = typeof body.ssml === 'string' ? body.ssml : '';
    if (!text && !ssmlIn) return json(400, { message: 'text or ssml required' });

    // 1) OpenAI (plain text만 지원 → ssml이면 태그 제거)
    if (provider === 'openai' || !GOOGLE_TTS_KEY) {
      try {
        const input = ssmlIn ? stripXml(ssmlIn) : text;
        const r = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini-tts',
            input,
            voice,
            speed,
            format: 'wav' // 초두 클리핑 방지
          })
        });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          const b64 = buf.toString('base64');
          return json(200, { audioData: b64, audioBase64: b64, mimeType: 'audio/wav' });
        }
      } catch (_) {
        // fallthrough
      }
    }

    // 2) Google TTS (SSML 지원, 앞에 150ms 무음)
    if (!GOOGLE_TTS_KEY) throw new Error('No TTS provider available');
    const ssml = ssmlIn || `<speak><break time="150ms"/>${escapeXml(text)}</speak>`;
    const gr = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { ssml },
        voice: { languageCode: 'ko-KR' }, // 필요시 name 지정 가능
        audioConfig: { audioEncoding: 'OGG_OPUS', speakingRate: speed }
      })
    });
    if (!gr.ok) throw new Error(`google tts ${gr.status}`);
    const gj = await gr.json();
    return json(200, { audioData: gj.audioContent, audioBase64: gj.audioContent, mimeType: 'audio/ogg' });

  } catch (err) {
    console.error(err);
    return json(500, { message: 'generate-audio failed', error: String(err) });
  }
};

function json(statusCode, obj) { return { statusCode, headers: CORS, body: JSON.stringify(obj) }; }
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, isFinite(n) ? n : 1)); }
function escapeXml(s=''){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[c])); }
function stripXml(s=''){ return String(s).replace(/<[^>]*>/g,''); }
