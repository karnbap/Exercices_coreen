// netlify/functions/generate-audio.js
const sdk = require("microsoft-cognitiveservices-speech-sdk");
const { Buffer } = require('buffer');

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8'
};

function estimateDurationSec({ text = '', ssml = '', speed = 1.0 } = {}) {
  const cleanText = (ssml || text).replace(/<[^>]+>/g, '');
  const syllables = (cleanText.match(/[가-힣]/g) || []).length;
  if (syllables === 0) {
    return Math.max(0.5, cleanText.length / 10);
  }
  const sps = 5.0 * speed; // Syllables per second
  return Math.max(0.5, syllables / sps);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
    return { statusCode: 500, body: JSON.stringify({ message: 'Azure Speech credentials are not configured.' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const text = body.text;
    const speed = body.speed || 1.0;
    const voice = body.voice || 'ko-KR-SunHiNeural';

    if (!text) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Text is required.' }) };
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);
    speechConfig.speechSynthesisVoiceName = voice;
    
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

    const ssml = `
        <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR">
            <voice name="${voice}">
                <prosody rate="${speed}">
                    ${text}
                </prosody>
            </voice>
        </speak>`;

    const result = await new Promise((resolve, reject) => {
      synthesizer.speakSsmlAsync(
        ssml,
        result => {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            resolve(result);
          } else {
            reject(new Error(`Speech synthesis failed: ${result.errorDetails}`));
          }
          synthesizer.close();
        },
        error => {
          reject(error);
          synthesizer.close();
        }
      );
    });

    const audioBuffer = Buffer.from(result.audioData);
    const audioBase64 = audioBuffer.toString('base64');

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioData: audioBase64,
        audioBase64: audioBase64,
        mimeType: 'audio/wav',
        durationEstimateSec: estimateDurationSec({ text, speed }),
        meta: { provider: 'azure', voice, speed }
      })
    };

  } catch (error) {
    console.error('Error in Azure TTS:', error);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ message: 'Failed to generate audio with Azure.', error: error.message })
    };
  }
};



