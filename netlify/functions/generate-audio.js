const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

let credentials;
let projectId;
try {
  if (!process.env.GOOGLE_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_CREDENTIALS_JSON environment variable is not set.');
  }
  credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  projectId = credentials.project_id;
  if (!projectId) {
    throw new Error('Project ID is missing in the credentials JSON.');
  }
} catch (e) {
  console.error('Failed to parse Google credentials:', e);
  global.initError = e;
}

// 인증을 위한 함수
const getAuthToken = async () => {
  const auth = new GoogleAuth({
    credentials,
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  return accessToken.token;
};

exports.handler = async function (event) {
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

    // ✅ 새로운 생성형 'Studio' 음성 모델
    const femaleVoices = ['ko-KR-Studio-O']; // 여성 Studio 목소리
    const maleVoices = ['ko-KR-Studio-P'];   // 남성 Studio 목소리

    const selectedVoice =
      voice === 'man'
        ? maleVoices[Math.floor(Math.random() * maleVoices.length)]
        : femaleVoices[Math.floor(Math.random() * femaleVoices.length)];

    const token = await getAuthToken();
    const API_ENDPOINT = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/texttospeech:synthesize`;

    const requestBody = {
      input: { text },
      voice: {
        languageCode: 'ko-KR',
        name: selectedVoice,
      },
      audioConfig: {
        audioEncoding: 'MP3',
      },
    };

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorBody = await response.json();
        console.error('API Error:', errorBody);
        throw new Error(`API call failed with status ${response.status}: ${errorBody.error.message}`);
    }

    const responseData = await response.json();
    const audioData = responseData.audioContent; // Base64로 이미 인코딩되어 있음

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
