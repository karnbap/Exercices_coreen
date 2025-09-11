// Netlify Function: analyze-pronunciation
// - Whisper STT 호출 시 반드시 model 지정(whisper-1)
// - 요청: { referenceText, audio:{ base64, mimeType, filename, duration } }
// - 응답: { ok:true, accuracy(0..1), transcript, confusionTags:[] }
// - 에러시: { ok:false, messageFr, messageKo }  (한-불 설명 포함)

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const FormData = require('form-data');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { ok:false, messageFr: "Méthode non autorisée.", messageKo: "허용되지 않은 메서드입니다." });
    }

    const body = JSON.parse(event.body || '{}');
    const { referenceText = '', audio = {} } = body || {};
    const ref = String(referenceText || '').replace(/\s+/g, '');
    const { base64, mimeType='audio/webm', filename='audio.webm' } = audio || {};

    if (!base64) {
      return json(400, {
        ok:false,
        messageFr:"Aucun audio reçu. Réenregistrez et réessayez.",
        messageKo:"오디오가 수신되지 않았습니다. 다시 녹음해 주세요.",
        warnFr:"Astuces: vérifiez le micro et les permissions navigateur.",
        warnKo:"도움말: 마이크/브라우저 권한을 확인하세요."
      });
    }

    // base64 -> Buffer
    const bin = Buffer.from(base64, 'base64');

    // === OpenAI Whisper STT ===
    const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_TOKEN;
    if (!OPENAI_KEY) {
      return json(500, { ok:false, messageFr:"Clé OpenAI absente côté serveur.", messageKo:"서버에 OpenAI 키가 설정되지 않았습니다." });
    }

    // multipart/form-data
    const form = new FormData();
    form.append('model', 'whisper-1');              // ✅ 반드시 model 지정
    form.append('response_format', 'json');
    form.append('language', 'ko');                  // 한국어 우선
    form.append('file', bin, { filename, contentType: mimeType });

    let transcript = '';
    try {
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}` },
        body: form
      });
      const j = await r.json();
      if (!r.ok) {
        // Whisper 400 같은 에러를 한-불로 포맷
        const errText = (j && j.error && j.error.message) ? j.error.message : `HTTP ${r.status}`;
        return json(r.status, {
          ok:false,
          messageFr:`Échec du STT (Whisper): ${errText}`,
          messageKo:`음성 인식(STT) 실패: ${errText}`,
        });
      }
      transcript = String(j.text || '').trim();
    } catch (e) {
      return json(502, { ok:false, messageFr:"Service STT indisponible.", messageKo:"음성 인식 서비스에 연결할 수 없습니다." });
    }

    // === 간단 채점: 레퍼런스와의 문자 유사도(자모 단순화 전처리 가능) ===
    const hyp = transcript.replace(/\s+/g, '');
    const acc = similarity(ref, hyp); // 0..1

    const tags = deriveTips(ref, hyp); // 간단한 자주 헷갈리는 패턴 안내
    return json(200, { ok:true, accuracy: acc, transcript, confusionTags: tags });

  } catch (e) {
    return json(500, {
      ok:false,
      messageFr:"Erreur serveur pendant l'analyse.",
      messageKo:"분석 중 서버 오류가 발생했습니다.",
    });
  }
};

// ===== helpers =====
function json(code, obj){ return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }; }

// 매우 단순한 유사도(레벤슈타인 기반 정규화)
function similarity(a, b){
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen ? Math.max(0, 1 - dist / maxLen) : 0;
}
function levenshtein(a,b){
  const m=a.length,n=b.length;
  const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0]=i;
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      const c = a[i-1]===b[j-1]?0:1;
      dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+c);
    }
  }
  return dp[m][n];
}

// 간단 팁: 특정 자음/모음 대치, 받침 누락 등 (아주 러프)
function deriveTips(ref, hyp){
  const tips=[];
  if (!hyp) tips.push('STT 없음 / pas de STT');
  if (ref && hyp && Math.abs(ref.length - hyp.length) >= 3) tips.push('길이가 많이 달라요 / longueur très différente');
  if (/[ㄹ]/.test(ref) && !/[ㄹ]/.test(hyp)) tips.push('ㄹ 발음 주의 / attention au “ㄹ”');
  if (/[ㅅ]/.test(ref) && !/[ㅅ]/.test(hyp)) tips.push('ㅅ 발음 주의 / attention au “ㅅ”');
  return tips;
}
