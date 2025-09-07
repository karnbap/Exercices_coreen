// /.netlify/functions/analyze-pronunciation.js
// Node 18+ (global fetch, FormData, Blob 사용)
// OPENAI_API_KEY 필요

const OPENAI_BASE = 'https://api.openai.com/v1';
const OPENAI_KEY = process.env.OPENAI_API_KEY;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }
    if (!OPENAI_KEY) {
      return json({ error: 'Missing OPENAI_API_KEY' }, 500);
    }

    const { referenceText, audio } = JSON.parse(event.body || '{}');
    if (!referenceText || !audio?.base64 || !audio?.mimeType) {
      return json({ error: 'Invalid payload' }, 400);
    }

    const audioBuf = Buffer.from(audio.base64, 'base64');
    const fileName = audio.filename || 'audio.webm';

    // 1차: gpt-4o-mini-transcribe
    const first = await transcribe('gpt-4o-mini-transcribe', audioBuf, audio.mimeType, fileName);
    const firstScore = scorePronunciation(referenceText, first.text);
    const needSecond = firstScore.accuracy < 0.85 || (firstScore.confusionTags && firstScore.confusionTags.length);

    let final = {
      modelUsed: 'gpt-4o-mini-transcribe',
      transcript: first.text,
      accuracy: firstScore.accuracy,
      cer: firstScore.cer,
      confusionTags: firstScore.confusionTags
    };

    // 2차: whisper-1 (조건부)
    let secondRaw = null, secondScore = null;
    if (needSecond) {
      secondRaw = await transcribe('whisper-1', audioBuf, audio.mimeType, fileName);
      secondScore = scorePronunciation(referenceText, secondRaw.text);
      // 더 높은 정확도 선택
      if ((secondScore.accuracy || 0) > (firstScore.accuracy || 0)) {
        final = {
          modelUsed: 'whisper-1',
          transcript: secondRaw.text,
          accuracy: secondScore.accuracy,
          cer: secondScore.cer,
          confusionTags: secondScore.confusionTags
        };
      }
    }

    return json({
      ...final,
      firstPass: { model: 'gpt-4o-mini-transcribe', transcript: first.text, accuracy: firstScore.accuracy, cer: firstScore.cer },
      ...(secondRaw ? { secondPass: { model: 'whisper-1', transcript: secondRaw.text, accuracy: secondScore.accuracy, cer: secondScore.cer } } : {})
    }, 200);

  } catch (err) {
    console.error('analyze-pronunciation error:', err);
    return json({ error: String(err) }, 500);
  }
};

// ---------------- OpenAI Transcribe ----------------
async function transcribe(model, buf, mime, filename) {
  const form = new FormData();
  const blob = new Blob([buf], { type: mime });
  form.append('file', blob, filename);
  form.append('model', model);
  // 한국어 고정 (인식 힌트)
  form.append('language', 'ko');

  const r = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: form
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> '');
    throw new Error(`OpenAI STT ${model} ${r.status} ${t}`);
  }
  const data = await r.json();
  // OpenAI 응답: { text: "...", ... }
  return { text: (data.text || '').trim() };
}

// ---------------- 채점 (자모 CER + 혼동 태그) ----------------
function scorePronunciation(ref, hyp) {
  const refNorm = normalizeHangulForCER(ref);
  const hypNorm = normalizeHangulForCER(hyp);

  const { dist, ops } = levenshteinOps(refNorm, hypNorm);
  const cer = refNorm.length ? (dist / refNorm.length) : 1.0;
  const accuracy = Math.max(0, 1 - cer);

  const confusionTags = detectConfusions(ref, hyp, ops);

  return { cer, accuracy, confusionTags };
}

// 한글 → 자모열 변환 (초/중/종 분해)
function decomposeToJamo(str) {
  const res = [];
  for (const ch of (str||'')) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const S = code - 0xAC00;
      const L = Math.floor(S / (21 * 28));
      const V = Math.floor((S % (21 * 28)) / 28);
      const T = S % 28;
      res.push(LEADS[L], VOWELS[V]);
      if (T > 0) res.push(TAILS[T]);
    } else if (/[ㄱ-ㅎㅏ-ㅣ]/.test(ch)) {
      res.push(ch);
    } else if (/\s/.test(ch)) {
      // ignore spaces for CER
    } else {
      // ignore punctuation
    }
  }
  return res.join('');
}
function normalizeHangulForCER(s){
  return decomposeToJamo((s||'').normalize('NFC')).replace(/\s+/g,'');
}

// 레벤슈타인 + 연산 경로
function levenshteinOps(a,b){
  const m=a.length,n=b.length;
  const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  const bt=Array.from({length:m+1},()=>Array(n+1).fill(null));
  for(let i=0;i<=m;i++){dp[i][0]=i;bt[i][0]='D';}
  for(let j=0;j<=n;j++){dp[0][j]=j;bt[0][j]='I';}
  bt[0][0]=null;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      let best=dp[i-1][j-1]+cost, op= cost? 'S':'M';
      if(dp[i-1][j]+1<best){best=dp[i-1][j]+1;op='D';}
      if(dp[i][j-1]+1<best){best=dp[i][j-1]+1;op='I';}
      dp[i][j]=best;bt[i][j]=op;
    }
  }
  const ops=[];
  let i=m,j=n;
  while(i>0 || j>0){
    const op=bt[i][j];
    if(op==='M' || op==='S'){ ops.push({op, a:a[i-1]||'', b:b[j-1]||''}); i--; j--; }
    else if(op==='D'){ ops.push({op, a:a[i-1]||'', b:''}); i--; }
    else if(op==='I'){ ops.push({op, a:'', b:b[j-1]||''}); j--; }
    else break;
  }
  ops.reverse();
  return { dist: dp[m][n], ops };
}

// 혼동 태그 탐지 (간단 휴리스틱)
function detectConfusions(refText, hypText, ops){
  const tags = new Set();

  // 받침 누락: 원문에서 종성 있는 음절 비율 대비 인식 자모열에서 종성 비율 낮으면 태그
  const refTails = countJong(refText);
  const hypTails = countJong(hypText);
  if (refTails.total > 0 && hypTails.count < refTails.count * 0.7) {
    tags.add('받침 누락');
  }

  // 자모 치환 패턴
  const pairs = new Set();
  for (const step of ops) {
    if (step.op === 'S') {
      const a = step.a, b = step.b;
      if (isPair(a,b, 'ㄴ','ㄹ')) pairs.add('ㄴ/ㄹ 혼동');
      if (isPair(a,b, 'ㅂ','ㅍ')) pairs.add('ㅂ/ㅍ 혼동');
      if (isPair(a,b, 'ㄷ','ㅌ')) pairs.add('ㄷ/ㅌ 혼동');
      if (isPair(a,b, 'ㅈ','ㅊ')) pairs.add('ㅈ/ㅊ 혼동');
      if (isPair(a,b, 'ㅅ','ㅆ')) pairs.add('ㅅ/ㅆ 혼동');
    }
  }
  for (const t of pairs) tags.add(t);
  return Array.from(tags);
}
function isPair(a,b,x,y){ return (a===x && b===y)||(a===y && b===x); }
function countJong(s){
  let total=0, count=0;
  for(const ch of (s||'')){
    const code=ch.charCodeAt(0);
    if(code>=0xAC00 && code<=0xD7A3){
      total++;
      const T=(code-0xAC00)%28;
      if(T>0) count++;
    }
  }
  return { total, count };
}

// 자모 테이블
const LEADS = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const VOWELS = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const TAILS = [ '', 'ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ' ];

// 응답 헬퍼
function json(data, status=200){
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}
