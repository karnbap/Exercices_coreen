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

const PROVIDERS = {
  openai: async ({ text }) => {
    // OpenAI TTS logic implementation
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const response = await fetch('https://api.openai.com/v1/audio/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model: 'whisper-tts',
        language: 'ko'
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI TTS failed: ${response.statusText}`);
    }

    const result = await response.json();
    return {
      audioBase64: result.audio,
      mimeType: 'audio/wav',
      durationEstimateSec: estimateDurationSec({ text }),
      meta: { provider: 'openai' }
    };
  }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const body = JSON.parse(event.body || '{}');
  const provider = body.provider || 'openai';
  const text = body.text;
  const speed = body.speed || 1.0;
  const voice = body.voice || 'ko-KR-SunHiNeural';

  if (!text) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Text is required.' }) };
  }

  if (!PROVIDERS[provider]) {
    return { statusCode: 400, body: JSON.stringify({ message: `Provider '${provider}' is not supported.` }) };
  }

  try {
    const result = await PROVIDERS[provider]({ text, speed, voice });
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error(`Error in ${provider} TTS:`, error);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ message: `Failed to generate audio with ${provider}.`, error: error.message })
    };
  }
};



