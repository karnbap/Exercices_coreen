// netlify/functions/analyze-pronunciation.js
// - Whisper STT 호출 (model: whisper-1)
// - 입력: { referenceText, audio:{ base64, mimeType, filename, duration } }
// - 출력 성공: { ok:true, accuracy(0..1), transcript, confusionTags:[], needsRetry?:true, messageFr?, messageKo? }
// - 출력 실패: { ok:false, messageFr, messageKo }

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const FormData = require('form-data');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { ok:false, messageFr: "Méthode non autorisée.", messageKo: "허용되지 않은 메서드입니다." });
    }

    const body = JSON.parse(event.body || '{}');
    const { referenceText = '', audio = {} } = body || {};
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

    // base64 (data URL도 대응)
    let b64 = String(base64 || '');
    if (b64.includes(',')) b64 = b64.split(',').pop();
    const bin = Buffer.from(b64, 'base64');

    // === OpenAI Whisper STT ===
    const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_TOKEN;
    if (!OPENAI_KEY) {
      return json(500, { ok:false, messageFr:"Clé OpenAI absente côté serveur.", messageKo:"서버에 OpenAI 키가 설정되지 않았습니다." });
    }

    const form = new FormData();
    form.append('model', 'whisper-1');
    form.append('response_format', 'json');
    form.append('language', 'ko');
    form.append('file', bin, { filename, contentType: mimeType });

    let transcriptRaw = '';
    try {
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}` },
        body: form
      });
      const j = await r.json();
      if (!r.ok) {
        const errText = (j && j.error && j.error.message) ? j.error.message : `HTTP ${r.status}`;
        return json(r.status, {
          ok:false,
          messageFr:`Échec du STT (Whisper): ${errText}`,
          messageKo:`음성 인식(STT) 실패: ${errText}`,
        });
      }
      transcriptRaw = String(j.text || '').trim();
    } catch (e) {
      return json(502, { ok:false, messageFr:"Service STT indisponible.", messageKo:"음성 인식 서비스에 연결할 수 없습니다." });
    }

    // === 숫자 → 한글 수사 강제(표시/채점 공통) ===
    const transcriptKo = forceHangulNumbers(transcriptRaw);
    const refKo        = forceHangulNumbers(referenceText || '');

    // === 유사도(캐논) ===
    const hyp = koCanon(transcriptKo);
    const ref = koCanon(refKo);
    let acc   = similarity(ref, hyp); // 0..1
if (ref && hyp && ref === hyp) acc = 1; // 완전 일치면 100% 고정

    // 부분 포함 가점(짧은 과제에서 과도한 감점 방지)
    if (hyp && ref && hyp.includes(ref)) acc = Math.max(acc, 0.9);

    // === 짧은 발음 오인식 필터 ===
    const isShortRef = ref.length <= 4;                                  // ‘일일’, ‘세살’, ‘한시’ 등
    const tooLongHyp = hyp.length >= Math.max(6, ref.length * 2 + 2);    // 기준 대비 과도하게 김
    const lowSim     = acc < 0.55;

    if (isShortRef && tooLongHyp && lowSim) {
      return json(200, {
        ok: true,
        needsRetry: true,                // 클라이언트: 0점 대신 재시도 안내
        accuracy: null,
        transcript: transcriptKo,
        messageFr: "Phrase courte mal reconnue. Réessaie calmement.",
        messageKo: "짧은 문장이 길게 인식됐어요. 또박또박 다시 한 번 읽어주세요."
      });
    }

    // === 팁(간단) ===
    const tags = deriveTips(ref, hyp);

    return json(200, { ok:true, accuracy: acc, transcript: transcriptKo, confusionTags: tags });

  } catch (e) {
    return json(500, {
      ok:false,
      messageFr:"Erreur serveur pendant l'analyse.",
      messageKo:"분석 중 서버 오류가 발생했습니다.",
    });
  }
};

// ===== helpers =====
function json(code, obj){
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

// 캐논: 공백·문장부호 제거 + 소문자
function koCanon(s){
  return String(s||'')
    .replace(/[.,!?;:~、。！？；：]/g,'')
    .replace(/\s+/g,'')
    .toLowerCase();
}

// 레벤슈타인 기반 유사도
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

// 숫자 → 한글(일·이·삼 / 십·백·천·만·억) + 단위 앞 고유어 축약
const SINO = ['','일','이','삼','사','오','육','칠','팔','구'];
const NUM_UNITS = [
  ['억',  100000000],
  ['만',       10000],
  ['천',         1000],
  ['백',          100],
  ['십',           10],
  ['',              1],
];
function clampInt(n,min,max){ n=parseInt(n,10); if(!Number.isFinite(n)) n=0; return Math.max(min, Math.min(max, n)); }
function numToSino(n){
  n = clampInt(n, 0, 99999999);
  if(!n) return '영';
  let out='', rest=n;
  for(const [u,v] of NUM_UNITS){
    const q = Math.floor(rest / v); rest %= v;
    if(!q) continue;
    if(v===10 && q===1) out+='십';
    else out += SINO[q] + u;
  }
  return out;
}
function digitsToSinoInText(s){ return String(s||'').replace(/\d+/g, m=>numToSino(m)); }
function applyCounterVariants(s){
  let x=String(s||'');
  x=x.replace(/십일(?=[가-힣])/g,'열한')
     .replace(/십이(?=[가-힣])/g,'열두')
     .replace(/십삼(?=[가-힣])/g,'열세')
     .replace(/십사(?=[가-힣])/g,'열네')
     .replace(/이십일(?=[가-힣])/g,'스물한')
     .replace(/이십이(?=[가-힣])/g,'스물두')
     .replace(/이십삼(?=[가-힣])/g,'스물세')
     .replace(/이십사(?=[가-힣])/g,'스물네')
     .replace(/이십(?=[가-힣])/g,'스무')
     .replace(/일(?=[가-힣])/g,'한')
     .replace(/이(?=[가-힣])/g,'두')
     .replace(/삼(?=[가-힣])/g,'세')
     .replace(/사(?=[가-힣])/g,'네');
  // 흔한 축약 보정
  x = x.replace(/셋(?=살)/g,'세').replace(/넷(?=살)/g,'네');
  return x;
}
function forceHangulNumbers(s){
  const base = digitsToSinoInText(String(s||'').replace(/[A-Za-z]+/g,''));
  return applyCounterVariants(base);
}

// 간단 팁: 길이 차이/특정 자음 힌트 (캐논 문자열 기준)
function deriveTips(refC, hypC){
  const tips=[];
  const R = String(refC||'');
  const H = String(hypC||'');

  if (!H) tips.push('STT 없음 / pas de STT');
  if (R && H && Math.abs(R.length - H.length) >= 3) tips.push('길이가 많이 달라요 / longueur très différente');

  // 자모 힌트(원본 캐논으로 매우 러프하게)
  if (/ㄹ/.test(R) && !/ㄹ/.test(H)) tips.push('ㄹ 발음 주의 / attention au “ㄹ”');
  if (/ㅅ/.test(R) && !/ㅅ/.test(H)) tips.push('ㅅ 발음 주의 / attention au “ㅅ”');

  return tips;
}
