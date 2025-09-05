// /.netlify/functions/generate-audio.js
// Node 18+ (Netlify 런타임은 global fetch 지원)

const textToSpeech = require('@google-cloud/text-to-speech');

// ---- Google Client (optional: 폴백용) ----
let googleCredentials = null;
try {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  }
} catch (e) {
  console.error('GOOGLE_CREDENTIALS_JSON parse error:', e);
}
const gClient = googleCredentials
  ? new textToSpeech.TextToSpeechClient({ credentials: googleCredentials })
  : null;

// ---- Voice sets ----
const OPENAI_VOICES = new Set(['alloy', 'shimmer', 'nova', 'echo', 'fable']);
const GOOGLE_KO_VOICES = new Set([
  'ko-KR-Neural2-A','ko-KR-Neural2-B','ko-KR-Neural2-C','ko-KR-Neural2-D','ko-KR-Neural2-E',
  'ko-KR-Standard-A','ko-KR-Standard-B','ko-KR-Standard-C','ko-KR-Standard-D',
  'ko-KR-Wavenet-A','ko-KR-Wavenet-B','ko-KR-Wavenet-C','ko-KR-Wavenet-D',
]);

const GOOGLE_DEFAULT = 'ko-KR-Neural2-D';
const OPENAI_DEFAULT = 'alloy';

// ---- Helpers ----
function decideProvider(provider, voice) {
  if (provider === 'openai') return 'openai';
  if (provider === 'google') return 'google';
  // auto: 보이스로 추정
  if (OPENAI_VOICES.has(voice)) return 'openai';
  if (voice && voice.startsWith('ko-KR-')) return 'google';
  // 기본은 OpenAI (이 페이지 의도)
  return 'openai';
}

function json(body, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

// ---- Providers ----
async function synthOpenAI({ text, voice, speed }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const v = OPENAI_VOICES.has(voice) ? voice : OPENAI_DEFAULT;

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: v,
      input: String(text),
      format: 'mp3',
      speed: (typeof speed === 'number' && speed > 0) ? speed : 1.0,
    }),
  });

  // OpenAI는 바이너리 반환 → arrayBuffer로 받기
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      const code = j?.error?.code || j?.error?.type || '';
      detail = j?.error?.message || '';
      if (res.status === 429 && String(code).includes('insufficient_quota')) {
        throw new Error('OpenAI 잔액/월한도가 부족합니다 (insufficient_quota). Billing을 확인하세요.');
      }
    } catch {
      detail = await res.text().catch(()=> '');
    }
    throw new Error(`OpenAI TTS ${res.status}: ${detail}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const b64 = Buffer.from(arrayBuf).toString('base64');
  return { mimeType: 'audio/mpeg', audioBase64: b64 };
}

async function synthGoogle({ text, voice, speakingRate }) {
  if (!gClient) throw new Error('Google credentials not configured');
  const name = GOOGLE_KO_VOICES.has(voice) ? voice : GOOGLE_DEFAULT;

  const [resp] = await gClient.synthesizeSpeech({
    input: { text: String(text) }, // 간단 경로(SSML 미사용)
    voice: { languageCode: 'ko-KR', name },
    audioConfig: { audioEncoding: 'MP3', speakingRate: speakingRate ?? 1.0 },
  });

  const audioBase64 = Buffer.from(resp.audioContent).toString('base64');
  return { mimeType: 'audio/mpeg', audioBase64 };
}

// ---- Netlify handler ----
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return json({ error: 'Method Not Allowed' }, 405);
    }

    const body = JSON.parse(event.body || '{}');
    const {
      text = '',
      voice = OPENAI_DEFAULT,
      provider = 'auto',         // 'openai' | 'google' | 'auto'
      speed,                     // OpenAI 전용(0.5~2.0)
      speakingRate,              // Google 전용(0.25~4.0)
    } = body;

    if (!String(text).trim()) {
      return json({ error: 'Text is required' }, 400);
    }

    const decided = decideProvider(provider, voice);
    let result;

    if (decided === 'openai') {
      try {
        result = await synthOpenAI({ text, voice, speed });
      } catch (e) {
        // 한도/장애 시 Google 폴백(가능할 때만)
        if (gClient) result = await synthGoogle({ text, voice: GOOGLE_DEFAULT, speakingRate: speakingRate ?? 1.0 });
        else throw e;
      }
    } else {
      result = await synthGoogle({ text, voice, speakingRate: speakingRate ?? 1.0 });
    }

    // 프런트 호환 필드들 통일
    return json({
      ...result,
      audioContent: result.audioBase64,
      audioUrl: `data:${result.mimeType || 'audio/mpeg'};base64,${result.audioBase64}`,
      voiceUsed: voice,
      providerUsed: decided,
    });
  } catch (err) {
    console.error('generate-audio error:', err);
    return json({ error: 'TTS failed', message: String(err) }, 200); // 항상 JSON
  }
};
