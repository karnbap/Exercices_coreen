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
