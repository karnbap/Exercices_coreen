// netlify/functions/analyze-pronunciation.js
const { Buffer } = require('buffer');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8'
};

const PROVIDERS = {
  openai: async ({ referenceText, audioBuffer }) => {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'whisper-1',
        file: audioBuffer,
        prompt: referenceText,
        language: 'ko'
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI STT failed: ${response.statusText}`);
    }

    const result = await response.json();
    return {
      ok: true,
      transcript: result.text,
      words: result.words || []
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
  const provider = 'openai';
  const { referenceText = '', audio = {} } = body;
  const { base64, mimeType = 'audio/wav' } = audio;

  if (!base64) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Audio data is required.' }) };
  }

  try {
    const audioBuffer = Buffer.from(base64.split(',').pop(), 'base64');
    const result = await PROVIDERS[provider]({ referenceText, audioBuffer });
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error(`Error in ${provider} STT:`, error);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ message: `Failed to analyze pronunciation with ${provider}.`, error: error.message })
    };
  }
};
