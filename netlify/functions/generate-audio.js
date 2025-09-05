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

// 프런트에서 오는 임의 보이스 토큰을 한국어 TTS로 매핑
function mapTokenToKoVoice(voiceToken = '') {
  const token = String(voiceToken).toLowerCase();
  // Neural2 계열이 자연스럽습니다.
  if (['nova', 'fable'].includes(token)) return 'ko-KR-Neural2-A'; // 여성
  if (['alloy', 'echo'].includes(token)) return 'ko-KR-Neural2-B'; // 남성
  if (['shimmer'].includes(token))       return 'ko-KR-Neural2-C'; // 여성
  if (token === 'man')                   return 'ko-KR-Neural2-B'; // 기존 호환
  return 'ko-KR-Neural2-A'; // 기본
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

    const { text = '', voice = 'female', speakingRate = 1.0 } = JSON.parse(event.body || '{}');
    if (!text.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Text is required' }) };
    }

    const voiceName = mapTokenToKoVoice(voice);
    const request = {
      input: { text },
      voice: { languageCode: 'ko-KR', name: voiceName },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: Math.max(0.8, Math.min(1.2, Number(speakingRate) || 1.0)),
      },
    };

    const [response] = await client.synthesizeSpeech(request);
    const audioBase64 = response.audioContent.toString('base64');

    // ✅ 역호환 완벽지원: audioBase64 / audioContent / data: URL 모두 제공
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        audioBase64,                               // 최신 페이지(Blob 변환 재생)
        audioContent: audioBase64,                 // Google 표준 키명 호환
        audioUrl: `data:audio/mpeg;base64,${audioBase64}`, // 구형 페이지(new Audio(url))도 재생
        mimeType: 'audio/mpeg',
        voiceUsed: voiceName,
      }),
    };
  } catch (err) {
    console.error('generate-audio error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'TTS failed', message: String(err) }) };
  }
};
