// netlify/functions/generate-audio.js
const textToSpeech = require('@google-cloud/text-to-speech');

let credentials;
try {
  if (!process.env.GOOGLE_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_CREDENTIALS_JSON env is not set.');
  }
  credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
} catch (e) {
  console.error('Failed to parse Google credentials:', e);
  global.initError = e;
}

const client = new textToSpeech.TextToSpeechClient({ credentials });

// 프런트 토큰 → 한국어 보이스 매핑
function mapTokenToKoVoice(voiceToken = '') {
  const token = String(voiceToken).toLowerCase();
  if (['nova', 'fable'].includes(token)) return 'ko-KR-Neural2-A'; // 여성
  if (['alloy', 'echo'].includes(token)) return 'ko-KR-Neural2-B'; // 남성
  if (['shimmer'].includes(token))       return 'ko-KR-Neural2-C'; // 여성
  if (token === 'ko-kr-neural2-a') return 'ko-KR-Neural2-A';
  if (token === 'ko-kr-neural2-b') return 'ko-KR-Neural2-B';
  if (token === 'ko-kr-neural2-c') return 'ko-KR-Neural2-C';
  if (token === 'ko-kr-neural2-d') return 'ko-KR-Neural2-D';
  if (token === 'man')             return 'ko-KR-Neural2-B';
  return 'ko-KR-Neural2-A';
}

exports.handler = async (event) => {
  try {
    if (global.initError) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error.', message: global.initError.message }),
      };
    }
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const {
      text = '',
      voice = 'female',
      speakingRate = 1.0,
      ssml = false,
      insertBreakMs = 0
    } = JSON.parse(event.body || '{}');

    if (!String(text).trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Text is required' }) };
    }

    const voiceName = mapTokenToKoVoice(voice);

    // SSML 구성 (토큰 사이 <break time="Xms"/> 삽입)
    const needsBreak = !!ssml || Number(insertBreakMs) > 0;
    const br = Math.max(100, Math.min(2000, Number(insertBreakMs) || 300));

    const input = !needsBreak
      ? { text }
      : {
          ssml:
            `<speak><s>` +
            String(text)
              .split(/[,\s]+/).filter(Boolean)
              .map(tok => `${tok}<break time="${br}ms"/>`).join('') +
            `</s></speak>`
        };

    const request = {
      input,
      voice: { languageCode: 'ko-KR', name: voiceName },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: Math.max(0.8, Math.min(1.2, Number(speakingRate) || 1.0)),
      },
    };

    const [response] = await client.synthesizeSpeech(request);
    const audioBase64 = response.audioContent.toString('base64');

    // 역호환 완벽 지원
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        audioBase64,                               // 최신(Blob 변환)
        audioContent: audioBase64,                 // Google 표준 키명
        audioUrl: `data:audio/mpeg;base64,${audioBase64}`, // 구형(new Audio(url))
        mimeType: 'audio/mpeg',
        voiceUsed: voiceName,
      }),
    };
  } catch (err) {
    console.error('generate-audio error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'TTS failed', message: String(err) }) };
  }
};

// /.netlify/functions/generate-audio.js
// Node 18+ (global fetch 사용)
const textToSpeech = require('@google-cloud/text-to-speech');

let googleCredentials = null;
try { googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON || '{}'); } catch {}
const gClient = googleCredentials ? new textToSpeech.TextToSpeechClient({ credentials: googleCredentials }) : null;

const OPENAI_VOICES = new Set(['alloy','shimmer','nova','echo','fable']);
const GOOGLE_KO_VOICES = new Set([
  'ko-KR-Neural2-A','ko-KR-Neural2-B','ko-KR-Neural2-C','ko-KR-Neural2-D','ko-KR-Neural2-E',
  'ko-KR-Standard-A','ko-KR-Standard-B','ko-KR-Standard-C','ko-KR-Standard-D',
  'ko-KR-Wavenet-A','ko-KR-Wavenet-B','ko-KR-Wavenet-C','ko-KR-Wavenet-D',
]);

const GOOGLE_DEFAULT = 'ko-KR-Neural2-D';
const OPENAI_DEFAULT = 'alloy';

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const {
      text = '',
      voice = OPENAI_DEFAULT,
      // provider: 'openai' | 'google' | 'auto'
      provider = 'auto',
      speed,            // OpenAI 전용(0.5~2.0)
      speakingRate,     // Google 전용(0.25~4.0)
    } = body;

    const decided = decideProvider(provider, voice);
    let result;

    if (decided === 'openai') {
      try {
        result = await synthOpenAI({ text, voice, speed });
      } catch (e) {
        // 잔액/한도/일시 장애 시 Google 폴백 (가능할 때만)
        if (gClient) {
          result = await synthGoogle({ text, voice: GOOGLE_DEFAULT, speakingRate: speakingRate ?? 1.0 });
        } else {
          throw e;
        }
      }
    } else { // google
      result = await synthGoogle({ text, voice, speakingRate: speakingRate ?? 1.0 });
    }

    return json(result, 200);
  } catch (e) {
    return json({ error: { message: e.message } }, 200); // 항상 JSON
  }
};

function decideProvider(provider, voice) {
  if (provider === 'openai') return 'openai';
  if (provider === 'google') return 'google';
  // auto: 보이스 이름으로 추정
  if (OPENAI_VOICES.has(voice)) return 'openai';
  if (voice && voice.startsWith('ko-KR-')) return 'google';
  // 기본은 OpenAI로 (이 페이지 의도에 맞춤)
  return 'openai';
}

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

  const raw = await res.text();
  if (!res.ok) {
    // 429 insufficient_quota 등 친절 메시지
    try {
      const j = JSON.parse(raw);
      const code = j?.error?.code || j?.error?.type || '';
      if (res.status === 429 && String(code).includes('insufficient_quota')) {
        throw new Error('OpenAI 잔액/월한도가 부족합니다 (insufficient_quota). Billing을 확인하세요.');
      }
    } catch {}
    throw new Error(`OpenAI TTS ${res.status}: ${raw}`);
  }

  const buf = Buffer.from(raw, 'binary'); // text로 먼저 받았으니 다시 처리
  // 위 한 줄로는 모호하니 arrayBuffer 로 재시도
  const arrRes = await fetch('data:;base64,');
  const arrayBuf = Buffer.from(raw);
  const b64 = arrayBuf.toString('base64');
  return { mimeType: 'audio/mpeg', audioBase64: b64 };
}

async function synthGoogle({ text, voice, speakingRate }) {
  if (!gClient) throw new Error('Google credentials not configured');
  const name = GOOGLE_KO_VOICES.has(voice) ? voice : GOOGLE_DEFAULT;

  const [resp] = await gClient.synthesizeSpeech({
    input: { text: String(text) },                 // 이 경로에선 SSML 미사용(간단)
    voice: { languageCode: 'ko-KR', name },
    audioConfig: { audioEncoding: 'MP3', speakingRate: speakingRate ?? 1.0 },
  });

  const audioBase64 = Buffer.from(resp.audioContent).toString('base64');
  return { mimeType: 'audio/mpeg', audioBase64 };
}

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}

