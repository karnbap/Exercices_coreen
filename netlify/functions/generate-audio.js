// netlify/functions/generate-audio.js
const fetch = global.fetch || require("node-fetch");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const GOOGLE_TTS_KEY = process.env.GOOGLE_TTS_KEY || "";

exports.handler = async (event) => {
  try {
    const { text = "", voice = "alloy", speed = 1.0 } = JSON.parse(event.body || "{}");
    if (!text) return resp(400, { message: "text required" });

    // 1) OpenAI TTS → WAV (초두 클리핑 방지)
    try {
      const r = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          input: text,
          voice,
          speed,
          format: "wav" // ★ mp3 → wav
        })
      });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        return resp(200, { audioData: buf.toString("base64"), mimeType: "audio/wav" });
      }
    } catch (_) {}

    // 2) Fallback: Google TTS → OGG_OPUS (+ 150ms 무음)
    if (!GOOGLE_TTS_KEY) throw new Error("no TTS available");

    const ssml = `<speak><break time="150ms"/>${escapeXml(text)}</speak>`;
    const gr = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { ssml },
        // 한국어 중심이라 ko-KR 기본, 필요시 다른 voiceName 전달
        voice: { languageCode: "ko-KR" },
        audioConfig: { audioEncoding: "OGG_OPUS", speakingRate: speed }
      })
    });
    if (!gr.ok) throw new Error(`google tts ${gr.status}`);
    const gj = await gr.json();
    return resp(200, { audioData: gj.audioContent, mimeType: "audio/ogg" });

  } catch (err) {
    console.error(err);
    return resp(500, { message: "generate-audio failed", error: String(err) });
  }
};

function resp(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function escapeXml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&apos;" }[c]));
}
