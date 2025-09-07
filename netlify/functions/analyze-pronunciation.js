// /.netlify/functions/analyze-pronunciation.js
// Node 18+ (global fetch, FormData, Blob 사용)
// OPENAI_API_KEY 필요

const OPENAI_BASE = 'https://api.openai.com/v1';
const OPENAI_KEY = process.env.OPENAI_API_KEY;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!OPENAI_KEY) return json({ error: 'Missing OPENAI_API_KEY' }, 500);

    const body = JSON.parse(event.body || '{}');
    const { referenceText, audio, clientConfig, clientHash } = body;
    const skipSecondPassIfAccurate =
      Number(event.headers['x-skip-second-pass-if-accurate'] || (clientConfig?.skipSecondPassIfAccurate ?? 0)) || 0;

    if (!referenceText || !audio?.base64 || !audio?.mimeType) return json({ error: 'Invalid payload' }, 400);
    if (audio?.duration && audio.duration > 10) return json({ error: 'Audio too long' }, 400);
    if (audio?.duration && audio.duration < 0.5) return json({ error: 'Audio too short' }, 400);

    const audioBuf = Buffer.from(audio.base64, 'base64');
    const fileName = audio.filename || 'audio.webm';

    // 1차: gpt-4o-mini-transcribe
    const first = await transcribe('gpt-4o-mini-transcribe', audioBuf, audio.mimeType, fileName);
    const firstScore = scorePronunciation(referenceText, first.text);

    const needSecond =
      (firstScore.accuracy < Math.max(0.85, skipSecondPassIfAccurate)) ||
      (firstScore.confusionTags && firstScore.confusionTags.length);

    let final = {
      transcript: first.text,
      accuracy: firstScore.accuracy,
      cer: firstScore.cer,
      confusionTags: firstScore.confusionTags
    };

    // 2차: whisper-1 (조건부)
    if (needSecond) {
      const second = await transcribe('whisper-1', audioBuf, audio.mimeType, fileName);
      const secondScore = scorePronunciation(referenceText, second.text);
      if ((secondScore.accuracy || 0) > (firstScore.accuracy || 0)) {
        final = {
          transcript: second.text,
          accuracy: secondScore.accuracy,
          cer: secondScore.cer,
          confusionTags: secondScore.confusionTags
        };
      }
    }

    // 최종 점수(ops 포함) 산출 후 설명 생성
    const finalScore = (needSecond && final.transcript !== first.text)
      ? scorePronunciation(referenceText, final.transcript)
      : firstScore;

    const explain = explainMistakes(referenceText, final.transcript, finalScore.ops, finalScore.confusionTags);

    return json({
      accuracy: final.accuracy,
      cer: final.cer,
      transcript: final.transcript,
      confusionTags: final.confusionTags,
      details: { explain }, // 99% 미만일 때 클라이언트가 상세 안내 표시
      firstPass: { model: 'gpt-4o-mini-transcribe', accuracy: firstScore.accuracy, cer: firstScore.cer },
      ...(needSecond ? { secondPassTried: true } : {})
    }, 200);

  } catch (err) {
    console.error('analyze-pronunciation error:', err);
    return json({ error: String(err) }, 500);
  }
};

// -------- OpenAI Transcribe --------
async function transcribe(model, buf, mime, filename) {
  const form = new FormData();
  const blob = new Blob([buf], { type: mime });
  form.append('file', blob, filename);
  form.append('model', model);
  form.append('language', 'ko'); // 한국어 고정

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
  return { text: (data.text || '').trim() };
}

// -------- 채점 (자모 CER + 혼동 태그) --------
function scorePronunciation(ref, hyp) {
  const refNorm = normalizeHangulForCER(ref);
  const hypNorm = normalizeHangulForCER(hyp);
  const { dist, ops } = levenshteinOps(refNorm, hypNorm);
  const cer = refNorm.length ? (dist / refNorm.length) : 1.0;
  const accuracy = Math.max(0, 1 - cer);
  const confusionTags = detectConfusions(ref, hyp, ops);
  return { cer, accuracy, confusionTags, ops };
}

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
    }
  }
  return res.join('');
}
function normalizeHangulForCER(s){ return decomposeToJamo((s||'').normalize('NFC')).replace(/\s+/g,''); }

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
  const ops=[]; let i=m,j=n;
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

function detectConfusions(refText, hypText, ops){
  const tags = new Set();
  const refTails = countJong(refText);
  const hypTails = countJong(hypText);
  if (refTails.total > 0 && hypTails.count < refTails.count * 0.7) tags.add('받침 누락');

  for (const step of ops) if (step.op === 'S') {
    if (isPair(step.a,step.b,'ㄴ','ㄹ')) tags.add('ㄴ/ㄹ 혼동');
    if (isPair(step.a,step.b,'ㅂ','ㅍ')) tags.add('ㅂ/ㅍ 혼동');
    if (isPair(step.a,step.b,'ㄷ','ㅌ')) tags.add('ㄷ/ㅌ 혼동');
    if (isPair(step.a,step.b,'ㅈ','ㅊ')) tags.add('ㅈ/ㅊ 혼동');
    if (isPair(step.a,step.b,'ㅅ','ㅆ')) tags.add('ㅅ/ㅆ 혼동');
  }
  return Array.from(tags);
}
function isPair(a,b,x,y){ return (a===x && b===y)||(a===y && b===x); }

function countJong(s){
  let total=0, count=0;
  for(const ch of (s||'')){
    const code=ch.charCodeAt(0);
    if(code>=0xAC00 && code<=0xD7A3){
      total++; const T=(code-0xAC00)%28; if(T>0) count++;
    }
  }
  return { total, count };
}

function explainMistakes(refText, hypText, ops, tags=[]) {
  const out = [];
  let sub=0, del=0, ins=0;

  const note = (fr, ko)=>({ fr, ko });

  if (tags.includes('받침 누락')) {
    out.push(note(
      "Finale de syllabe (받침) absente à plusieurs endroits",
      "받침이 여러 곳에서 누락된 것으로 보여요"
    ));
  }

  const pairNote = (a,b)=>{
    const P=[['ㄴ','ㄹ'],['ㅂ','ㅍ'],['ㄷ','ㅌ'],['ㅈ','ㅊ'],['ㅅ','ㅆ']];
    for(const [x,y] of P){
      if((a===x&&b===y)||(a===y&&b===x)) return ` (confusion ${x}/${y})`;
    }
    return '';
  };

  for (const step of ops) {
    if (out.length >= 6) break; // 너무 길지 않게 상위 6개만
    if (step.op==='S' && step.a && step.b) {
      sub++;
      const tail = pairNote(step.a, step.b);
      out.push(note(
        `Substitution: ${step.a} → ${step.b}${tail}`,
        `치환: ${step.a} → ${step.b}${tail ? ' ('+tail.replace('confusion','혼동')+')':''}`
      ));
    } else if (step.op==='D' && step.a) {
      del++;
      out.push(note(`Suppression: ${step.a}`, `삭제: ${step.a}`));
    } else if (step.op==='I' && step.b) {
      ins++;
      out.push(note(`Insertion: ${step.b}`, `삽입: ${step.b}`));
    }
  }

  out.push(note(
    `Résumé — Substitutions: ${sub}, Suppressions: ${del}, Insertions: ${ins}`,
    `요약 — 치환: ${sub}, 삭제: ${del}, 삽입: ${ins}`
  ));
  return out;
}

const LEADS = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const VOWELS = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const TAILS = [ '', 'ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ' ];

function json(data, status=200){ return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }; }
