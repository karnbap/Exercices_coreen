const textToSpeech = require('@google-cloud/text-to-speech');

let credentials;
try {
  if (!process.env.GOOGLE_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_CREDENTIALS_JSON environment variable is not set.');
  }
  credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
} catch (e) {
  console.error('Failed to parse Google credentials:', e);
  global.initError = e;
}

const client = new textToSpeech.TextToSpeechClient({ credentials });

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

    // ✅ 자연스러운 남/여 목소리 랜덤 선택
    const femaleVoices = ['ko-KR-Wavenet-A', 'ko-KR-Wavenet-C'];
    const maleVoices = ['ko-KR-Wavenet-B', 'ko-KR-Wavenet-D'];

    const selectedVoice =
      voice === 'man'
        ? maleVoices[Math.floor(Math.random() * maleVoices.length)]
        : femaleVoices[Math.floor(Math.random() * femaleVoices.length)];

    const request = {
      input: { text },
      voice: {
        languageCode: 'ko-KR',
        name: selectedVoice,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        pitch: 0.0,
        speakingRate: 1.0,
      },
    };

    const [response] = await client.synthesizeSpeech(request);
    const audioData = response.audioContent.toString('base64');

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
