// /.netlify/functions/generate-audio.js
// Node 18+ (global fetch 사용)

const textToSpeech = require('@google-cloud/text-to-speech');

// --- Google TTS 클라이언트 준비 ---
let gClient = null;
try {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON || '{}');
  if (creds.client_email && creds.private_key) {
    gClient = new textToSpeech.TextToSpeechClient({ credentials: creds });
  }
} catch (e) {
  console.error('Google credentials parse error:', e);
}

// --- 보이스 세트 ---
const OPENAI_VOICES = new Set(['alloy', 'shimmer', 'nova', 'echo', 'fable']);
const GOOGLE_KO_VOICES = new Set([
  'ko-KR-Neural2-A','ko-KR-Neural2-B','ko-KR-Neural2-C','ko-KR-Neural2-D','ko-KR-Neural2-E',
  'ko-KR-Standard-A','ko-KR-Standard-B','ko-KR-Standard-C','ko-KR-Standard-D',
  'ko-KR-Wavenet-A','ko-KR-Wavenet-B','ko-KR-Wavenet-C','ko-KR-Wavenet-D',
]);

const GOOGLE_DEFAULT = 'ko-KR-Neural2-D';
const OPENAI_DEFAULT  = 'alloy';

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return resp({ error: 'Method Not Allowed' }, 405);
    }

    const body = JSON.parse(event.body || '{}');
    const {
      text = '',
      voice = OPENAI_DEFAULT,
      provider = 'auto',      // 'openai' | 'google' | 'auto'
      speed,                  // OpenAI 전용 (0.5~2.0)
      speakingRate            // Google 전용 (0.25~4.0)
    } = body;

    if (!String(text).trim()) {
      return resp({ error: 'Text is required' }, 400);
    }

    const decided = decideProvider(provider, voice);

    // 1차: OpenAI (요청이 openai거나 auto+openai 보이스) → 실패 시 Google 폴백
    if (decided === 'openai') {
      try {
        const r = await synthOpenAI({ text, voice, speed });
        return resp(r, 200);
      } catch (e) {
        console.warn('OpenAI failed, fallback to Google if available:', e?.message);
        if (gClient) {
          const r = await synthGoogle({
            text,
            voice: GOOGLE_KO_VOICES.has(voice) ? voice : GOOGLE_DEFAULT,
            speakingRate: (typeof speakingRate === 'number' && speakingRate > 0) ? speakingRate : 1.0
          });
          return resp(r, 200);
        }
        return resp({ error: friendlyOpenAIError(e) }, 502);
      }
    }

    // 1차: Google
    if (!gClient) return resp({ error: 'Google credentials not configured' }, 500);
    const r = await synthGoogle({
      text,
      voice: GOOGLE_KO_VOICES.has(voice) ? voice : GOOGLE_DEFAULT,
      speakingRate: (typeof speakingRate === 'number' && speakingRate > 0) ? speakingRate : 1.0
    });
    return resp(r, 200);

  } catch (e) {
    console.error('generate-audio fatal:', e);
    return resp({ error: 'TTS failed', detail: String(e?.message || e) }, 500);
  }
};

function decideProvider(provider, voice) {
  if (provider === 'openai') return 'openai';
  if (provider === 'google') return 'google';
  if (OPENAI_VOICES.has(String(voice))) return 'openai';
  if (String(voice).startsWith('ko-KR-')) return 'google';
  return 'openai';
}

async function synthOpenAI({ text, voice, speed }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const v = OPENAI_VOICES.has(voice) ? voice : OPENAI_DEFAULT;

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: v,
      input: String(text),
      format: 'mp3',
      speed: (typeof speed === 'number' && speed > 0) ? speed : 1.0
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let msg = `OpenAI TTS ${res.status}`;
    try {
      const j = JSON.parse(errText);
      msg = j?.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }

  // 바이너리 → base64
  const arr = await res.arrayBuffer();
  const b64 = Buffer.from(arr).toString('base64');
  return {
    mimeType: 'audio/mpeg',
    audioBase64: b64,
    audioData: b64,               // 구페이지 호환 키
    providerUsed: 'openai',
    voiceUsed: v
  };
}

async function synthGoogle({ text, voice, speakingRate }) {
  const name = GOOGLE_KO_VOICES.has(voice) ? voice : GOOGLE_DEFAULT;
  const [gRes] = await gClient.synthesizeSpeech({
    input: { text: String(text) },
    voice: { languageCode: 'ko-KR', name },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: (typeof speakingRate === 'number' && speakingRate > 0) ? speakingRate : 1.0
    }
  });
  const b64 = Buffer.from(gRes.audioContent || Buffer.alloc(0)).toString('base64');
  return {
    mimeType: 'audio/mpeg',
    audioBase64: b64,
    audioData: b64,               // 구페이지 호환 키
    providerUsed: 'google',
    voiceUsed: name
  };
}

function resp(obj, status = 200) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(obj)
  };
}

function friendlyOpenAIError(e) {
  const m = String(e?.message || e);
  if (/insufficient_quota|quota|429/i.test(m)) {
    return 'OpenAI 잔액/월 한도가 부족합니다. Billing을 확인하세요.';
  }
  return m;
}
