// (기존) inlineData 추출 바로 아래를 아래 코드로 교체
const candidate0 = result?.candidates?.[0] || null;
const parts = candidate0?.content?.parts || [];
const inline = parts.find(p => p?.inlineData?.data || p?.inlineData?.mimeType);

const audioData = inline?.inlineData?.data || null;
let mimeType = inline?.inlineData?.mimeType || '';

if (!audioData) {
  console.error("No inlineData. candidate0:", JSON.stringify(candidate0).slice(0, 1500));
  return {
    statusCode: 500,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      error: "Aucune donnée audio reçue de l'API Google.",
      debug: {
        rawMimeType: mimeType,
        hasCandidates: Array.isArray(result?.candidates),
        partsCount: parts.length,
        finishReason: candidate0?.finishReason || null,
        safetyRatings: candidate0?.safetyRatings || null,
        promptFeedback: result?.promptFeedback || null,
      },
    }),
  };
}

// ✅ PCM/Linear16/Wave 계열은 전부 WAV로 변환
const isPcmLike = /pcm|linear16|l16|x-wav|wave/i.test(mimeType);
const rateMatch = mimeType.match(/rate=(\d+)/);
const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

if (isPcmLike || !/^audio\//.test(mimeType)) {
  const wavBase64 = pcm16ToWavBase64(audioData, sampleRate);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioData: wavBase64, mimeType: "audio/wav" }),
  };
}

// (그 외 mp3 등은 그대로 전달)
return {
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ audioData, mimeType }),
};
