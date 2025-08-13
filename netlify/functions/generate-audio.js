// netlify/functions/generate-audio.js

// ✅ Netlify가 Node 18이 아니면 fetch가 없습니다. 폴리필 추가(CJS 방식).
const fetch =
  typeof globalThis.fetch === "function"
    ? globalThis.fetch
    : (...args) =>
        import("node-fetch").then(({ default: f }) => f(...args));

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { text, voice } = JSON.parse(event.body || "{}");
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("La clé API Google n'est pas configurée sur le serveur.");
    if (!text) {
      return { statusCode: 400, body: JSON.stringify({ error: "Le texte à synthétiser est manquant." }) };
    }

    // 원하는 프리빌트 보이스명으로 바꾸세요.
    const voiceName = voice === "man" ? "Kore" : "Kore";

    const payload = {
      contents: [{ role: "user", parts: [{ text }] }], // ✅ role 추가
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
      model: "gemini-2.5-flash-preview-tts",
    };

    const apiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=" +
      apiKey;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(no body)");
      console.error("Google API error:", errorBody);
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "L'API Google a retourné une erreur.", errorBody }),
      };
    }

    const result = await response.json();

    // ✅ inlineData가 있는 part를 전체에서 탐색
    const candidate0 = result?.candidates?.[0] || null;
    const parts = candidate0?.content?.parts || [];
    const inline = parts.find((p) => p?.inlineData?.data);
    const audioData = inline?.inlineData?.data; // Base64
    const mimeType = inline?.inlineData?.mimeType; // ex) audio/pcm;rate=24000, audio/mp3, ...

    if (!audioData || !mimeType) {
      // 안전성 차단/쿼터 등 이유를 확인하기 위한 디버그 정보를 함께 반환
      console.error("No inlineData. candidate0:", JSON.stringify(candidate0).slice(0, 1500));
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Aucune donnée audio reçue de l'API Google.",
          debug: {
            hasCandidates: Array.isArray(result?.candidates),
            partsCount: parts.length,
            finishReason: candidate0?.finishReason || null,
            safetyRatings: candidate0?.safetyRatings || null,
            promptFeedback: result?.promptFeedback || null,
          },
        }),
      };
    }

    // ✅ PCM이면 서버에서 WAV로 감싸서 브라우저 호환 보장
    if (mimeType.startsWith("audio/pcm")) {
      const rateMatch = mimeType.match(/rate=(\d+)/);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
      const wavBase64 = pcm16ToWavBase64(audioData, sampleRate);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioData: wavBase64, mimeType: "audio/wav" }),
      };
    }

    // mp3/wav 등은 그대로 전달
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioData, mimeType }),
    };
  } catch (error) {
    console.error("Server function error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

// PCM(16bit mono) Base64 → WAV Base64
function pcm16ToWavBase64(pcmBase64, sampleRate = 24000) {
  const pcmBuffer = Buffer.from(pcmBase64, "base64");
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  const wavBuffer = Buffer.concat([header, pcmBuffer]);
  return wavBuffer.toString("base64");
}
