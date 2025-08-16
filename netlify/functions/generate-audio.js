// netlify/functions/generate-audio.js

const textToSpeech = require('@google-cloud/text-to-speech');

// 1. Netlify 환경 변수에서 인증 정보를 가져와 파싱합니다.
//    이 방법은 JSON 키 파일을 코드에 노출하지 않아 안전합니다.
let credentials;
try {
  if (!process.env.GOOGLE_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_CREDENTIALS_JSON environment variable is not set.');
  }
  credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
} catch (e) {
  console.error('Failed to parse Google credentials:', e);
  // 함수가 시작되기 전에 오류가 발생했으므로, 핸들러에서 처리할 수 있도록 전역 변수에 에러를 저장합니다.
  // This helps ensure the handler function can report the configuration error.
  global.initError = e;
}


// 2. API 클라이언트를 생성할 때, 위에서 준비한 인증 정보를 명시적으로 전달합니다.
const client = new textToSpeech.TextToSpeechClient({ credentials });

exports.handler = async function (event) {
  // 만약 초기화 과정에서 오류가 있었다면, 여기서 에러를 반환합니다.
  if (global.initError) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error.', message: global.initError.message }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { text, voice } = JSON.parse(event.body || '{}');

    if (!text) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Le texte à synthétiser est manquant.' }),
      };
    }

    const request = {
      input: { text: text },
      voice: {
        languageCode: 'ko-KR',
        name: voice === 'man' ? 'ko-KR-Wavenet-D' : 'ko-KR-Wavenet-B',
      },
      audioConfig: {
        audioEncoding: 'MP3',
      },
    };

    const [response] = await client.synthesizeSpeech(request);
    const audioData = response.audioContent.toString('base64');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioData: audioData,
        mimeType: 'audio/mpeg',
      }),
    };

  } catch (error) {
    console.error('ERROR:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to synthesize speech.' }),
    };
  }
};
