// netlify/functions/analyze-pronunciation.js
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

const PROVIDERS = {
  azure: async ({ referenceText, audioBuffer }) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);
    speechConfig.speechRecognitionLanguage = "ko-KR";

    const audioConfig = sdk.AudioConfig.fromWavFileInput(audioBuffer);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    const pronunciationAssessmentConfig = new sdk.PronunciationAssessmentConfig(
      referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true
    );
    pronunciationAssessmentConfig.applyTo(recognizer);

    const result = await new Promise((resolve, reject) => {
      recognizer.recognizeOnceAsync(result => {
        resolve(result);
        recognizer.close();
      }, error => {
        reject(error);
        recognizer.close();
      });
    });

    if (result.reason === sdk.ResultReason.RecognizedSpeech) {
      const pronunciationResult = sdk.PronunciationAssessmentResult.fromResult(result);
      return {
        ok: true,
        accuracy: pronunciationResult.accuracyScore / 100,
        transcript: result.text,
        pronunciationResult: {
          accuracyScore: pronunciationResult.accuracyScore,
          pronunciationScore: pronunciationResult.pronunciationScore,
          completenessScore: pronunciationResult.completenessScore,
          fluencyScore: pronunciationResult.fluencyScore,
        },
        words: result.detail.Words?.map(word => ({
          word: word.Word,
          accuracy: word.PronunciationAssessment.AccuracyScore,
          errorType: word.PronunciationAssessment.ErrorType,
        }))
      };
    } else {
      throw new Error(`Speech could not be recognized: ${result.errorDetails}`);
    }
  },
  openai: async ({ referenceText, audioBuffer }) => {
    // OpenAI STT 로직 추가
    return { message: 'OpenAI STT not implemented yet.' };
  },
  gemini: async ({ referenceText, audioBuffer }) => {
    // Gemini AI STT 로직 추가
    return { message: 'Gemini AI STT not implemented yet.' };
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
  const provider = body.provider || 'azure';
  const { referenceText = '', audio = {} } = body;
  const { base64, mimeType = 'audio/wav' } = audio;

  if (!base64) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Audio data is required.' }) };
  }

  if (!PROVIDERS[provider]) {
    return { statusCode: 400, body: JSON.stringify({ message: `Provider '${provider}' is not supported.` }) };
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
