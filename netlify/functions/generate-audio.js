// netlify/functions/generate-audio.js

// 1. Google Cloud Text-to-Speech 클라이언트 라이브러리를 가져옵니다.
const textToSpeech = require('@google-cloud/text-to-speech');

// 2. API 클라이언트를 생성합니다.
//    이 클라이언트는 자동으로 인증 정보를 찾아서 사용합니다.
const client = new textToSpeech.TextToSpeechClient();

exports.handler = async function (event) {
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

    // 3. API에 보낼 요청 객체를 구성합니다.
    const request = {
      // 음성으로 변환할 텍스트
      input: { text: text },
      // 목소리 설정
      voice: {
        languageCode: 'ko-KR', // 언어는 한국어
        // WaveNet 음성은 매우 자연스러운 고품질 음성입니다.
        // 남성: D, 여성: B 또는 C를 추천합니다.
        name: voice === 'man' ? 'ko-KR-Wavenet-D' : 'ko-KR-Wavenet-B',
      },
      // 오디오 파일 형식 설정
      audioConfig: {
        audioEncoding: 'MP3', // 가장 널리 호환되는 MP3 형식으로 설정
      },
    };

    // 4. API를 호출하여 음성을 합성합니다.
    const [response] = await client.synthesizeSpeech(request);
    
    // 5. 응답으로 받은 오디오 데이터를 Base64 문자열로 변환합니다.
    //    라이브러리가 이미 Buffer 형태로 주기 때문에 바로 변환 가능합니다.
    const audioData = response.audioContent.toString('base64');

    // 6. Base64로 인코딩된 오디오 데이터와 MIME 타입을 클라이언트에 반환합니다.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioData: audioData,
        mimeType: 'audio/mpeg', // MP3 파일의 MIME 타입
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
