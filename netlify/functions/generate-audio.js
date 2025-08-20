const textToSpeech = require('@google-cloud/text-to-speech');

let credentials;
try {
  if (!process.env.GOOGLE_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_CREDENTIALS_JSON environment variable is not set.');
  }
  // Netlify 환경 변수에서 JSON 키 내용을 파싱합니다.
  credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
} catch (e) {
  console.error('Failed to parse Google credentials:', e);
  global.initError = e;
}

// 공식 라이브러리의 클라이언트를 생성합니다.
const client = new textToSpeech.TextToSpeechClient({ credentials });

exports.handler = async function (event) {
  // 서버 설정 오류가 있으면 즉시 에러를 반환합니다.
  if (global.initError) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error.', message: global.initError.message }),
    };
  }

  // POST 요청만 허용합니다.
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

    // 최신 생성형 'Studio' 음성 모델 이름
    // Using standard WaveNet voices for guaranteed compatibility.
    const femaleVoices = ['ko-KR-Wavenet-A', 'ko-KR-Wavenet-C'];
    const maleVoices = ['ko-KR-Wavenet-B', 'ko-KR-Wavenet-D'];

    const selectedVoice =
      voice === 'man'
        ? maleVoices[Math.floor(Math.random() * maleVoices.length)]
        : femaleVoices[Math.floor(Math.random() * femaleVoices.length)];

    // API에 보낼 요청 객체를 생성합니다.
    const request = {
      input: { text },
      voice: {
        languageCode: 'ko-KR',
        name: selectedVoice, // 라이브러리가 이 이름을 보고 자동으로 최신 모델로 요청을 보냅니다.
      },
      audioConfig: {
        audioEncoding: 'MP3',
      },
    };

    // 음성 합성을 요청합니다.
    const [response] = await client.synthesizeSpeech(request);
    const audioData = response.audioContent.toString('base64');

    // 성공적으로 오디오 데이터를 반환합니다.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioData,
        mimeType: 'audio/mpeg',
        voiceUsed: selectedVoice,
      }),
    };

  } catch (error) {
    console.error('ERROR:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to synthesize speech.', message: error.message }),
    };
  }
};

