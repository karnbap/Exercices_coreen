exports.handler = async function(event, context) {
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

    // 간단 매핑(원하는 보이스명으로 바꿔 사용)
    const voiceName = voice === 'man' ? 'Kore' : 'Kore';

    const payload = {
      contents: [{ parts: [{ text }] }],
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
      return { statusCode: response.status, body: JSON.stringify({ error: "L'API Google a retourné une erreur." }) };
    }

    const result = await response.json();
    const part = result?.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;     // Base64
    const mimeType = part?.inlineData?.mimeType;  // e.g. "audio/pcm;rate=24000" or "audio/mp3"

    if (!audioData || !mimeType) {
      return { statusCode: 500, body: JSON.stringify({ error: "Aucune donnée audio reçue de l'API Google." }) };
    }

    // ▼▼▼ 변경 포인트 #2: PCM이면 서버에서 WAV로 변환해서 반환 ▼▼▼
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

    // 브라우저가 재생 가능한 형식(mp3/wav 등)은 그대로 패스
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

// ▼▼▼ 변경 포인트 #1: PCM(Base64) → WAV(Base64) 변환 헬퍼 ▼▼▼
function pcm16ToWavBase64(pcmBase64, sampleRate = 24000) {
  const pcmBuffer = Buffer.from(pcmBase64, 'base64'); // 16-bit mono PCM
  const header = Buffer.alloc(44);

  // "RIFF"
  header.write('RIFF', 0);
  // ChunkSize = 36 + Subchunk2Size
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  // "WAVE"
  header.write('WAVE', 8);
  // "fmt "
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);     // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);      // AudioFormat (1 = PCM)
  header.writeUInt16LE(1, 22);      // NumChannels (1 = mono)
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(sampleRate * 1 * 2, 28); // ByteRate = sr * ch * bits/8
  header.writeUInt16LE(1 * 2, 32);  // BlockAlign = ch * bits/8
  header.writeUInt16LE(16, 34);     // BitsPerSample
  // "data"
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40); // Subchunk2Size

  const wavBuffer = Buffer.concat([header, pcmBuffer]);
  return wavBuffer.toString('base64');
}
