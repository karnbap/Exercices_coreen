exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { text, voice } = JSON.parse(event.body); // ← voice도 받기
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) throw new Error("La clé API Google n'est pas configurée sur le serveur.");
    if (!text) return { statusCode: 400, body: JSON.stringify({ error: "Le texte à synthétiser est manquant." }) };

    // 간단 매핑: 프런트에서 'woman'/'man' 보냄 → 기본값 'Kore'
    // (다른 음성으로 바꾸면 여기만 조정)
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
    const audioData = part?.inlineData?.data;
    const mimeType = part?.inlineData?.mimeType;

    if (!audioData) {
      return { statusCode: 500, body: JSON.stringify({ error: "Aucune donnée audio reçue de l'API Google." }) };
    }

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
