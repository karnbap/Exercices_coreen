// netlify/functions/generate-audio.js
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { text, voice } = JSON.parse(event.body || "{}");
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("La clé API Google n'est pas configurée sur le serveur.");
    if (!text) {
      return { statusCode: 400, body: JSON.stringify({ error: "Le texte à synthétiser est manquant." }) };
    }

    // 보이스 매핑 (원하시는 보이스명으로 교체 가능)
    const voiceName = voice === 'man' ? 'Kore' : 'Kore';

    // ✅ (1) role 추가
    const payload = {
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
      },
      model: "gemini-2.5-flash-preview-tts"
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Erreur de l'API Google:", errorBody);
      return { statusCode: response.status, body: JSON.stringify({ error: "L'API Google a retourné une erreur.", errorBody }) };
    }

    const result = await response.json();

    // ✅ (2) inlineData가 있는 파트를 탐색
    const parts = result?.candidates?.[0]?.content?.parts || [];
    const inline = parts.find(p => p?.inlineData?.data);
    const audioData = inline?.inlineData?.data;     // Base64
    const mimeType = inline?.inlineData?.mimeType;  // ex) "audio/pcm;rate=24000" or "audio/mp3"

    if (!audioData || !mimeType) {
      // ✅ (3) 디버그 정보 더 풍부하게 반환
      const candidate0 = result?.candidates?.[0] || null;
      console.error("No inlineData. candidate0:", JSON.stringify(candidate0).slice(0, 1200));
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: "Aucune donnée audio reçue de l'API Google.",
          debug: {
            hasCandidates: !!result?.candidates,
            partsCount: parts.length,
            safetyRatings: candidate0?.safetyRatings || null,
            finishReason: candidate0?.finishReason || null,
            groundingMetadata: candidate0?.groundingMetadata || null,
            promptFeedback: result?.promptFeedback || null
          }
        })
      };
    }

    // PCM이면 WAV로 감싸서 반환
    if (mimeType.startsWith('audio/pcm')) {
      const rateMatch = mimeType.match(/rate=(\d+)/);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
      const wavBase64 = pcm16ToWavBase64(audioData, sampleRate);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioData: wavBase64, mimeType: 'audio/wav' })
      };
    }

    // mp3/wav 등은 그대로 전달
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioData, mimeType })
    };

  } catch (error) {
    console.error("Erreur dans la fonction serveur:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

// PCM(Base64) → WAV(Base64)
function pcm16ToWavBase64(pcmBase64, sampleRate = 24000) {
  const pcmBuffer = Buffer.from(pcmBase64, 'base64'); // 16-bit mono PCM
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20);  // AudioFormat = PCM
  header.writeUInt16LE(1, 22);  // NumChannels = 1
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(sampleRate * 1 * 2, 28); // ByteRate = sr * ch * 2
  header.writeUInt16LE(2, 32);  // BlockAlign = ch * 2
  header.writeUInt16LE(16, 34); // BitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  const wavBuffer = Buffer.concat([header, pcmBuffer]);
  return wavBuffer.toString('base64');
}
