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
    const { referenceText = '', audio = {} } = body;
    const { base64, mimeType = 'audio/wav' } = audio;

    if (!base64) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Audio data is required.' }) };
    }

    const audioBuffer = Buffer.from(base64.split(',').pop(), 'base64');

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
      const accuracy = pronunciationResult.accuracyScore;
      const transcript = result.text;
      
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true,
          accuracy: accuracy / 100, // 0..1 범위로
          transcript: transcript,
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
        })
      };
    } else {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ ok: false, message: `Speech could not be recognized: ${result.errorDetails}` })
      };
    }

  } catch (error) {
    console.error('Error in Azure STT:', error);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ message: 'Failed to analyze pronunciation with Azure.', error: error.message })
    };
  }
};
