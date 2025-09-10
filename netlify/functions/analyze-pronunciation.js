// netlify/functions/analyze-pronunciation.js
// Whisper 전송부 + 숫자 보정 유사도
// 요청: { referenceText:string, audio:{ base64, filename, mimeType, duration } }
// 응답: { transcript:string, accuracy:number(0..1), details?:{explain:string[]} }

const fetch = global.fetch || require('node-fetch');
const FormData = require('form-data');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return json(405, { message: 'Method Not Allowed' });

  try{
    const body = JSON.parse(event.body||'{}');
    const ref  = koCanon(String(body.referenceText||'')); // 공백 제거된 한글 기준
    const audio = body.audio||{};
    if (!audio?.base64) return json(400, { message:'audio.base64 required' });

    const tj = await transcribeBase64({
      base64: audio.base64, filename: audio.filename||'rec.webm', mimeType: audio.mimeType||'audio/webm'
    });

    const transcriptRaw = String(tj?.text||'').trim();
    const acc = scoreWithNumberFallback(ref, transcriptRaw);

    return json(200, {
      transcript: transcriptRaw,
      accuracy: acc,
      details: { explain: transcriptRaw ? [] : ['입력이 너무 짧거나 무성 구간이 많았어요. 조금 더 길게 또박또박 읽어보세요.'] }
    });

  }catch(err){
    return json(200, { transcript:'', accuracy:0, confusionTags:[`stt-fail:${String(err).slice(0,80)}`] });
  }
};

// ===== 숫자/한글 보정 =====
const __KO_NUM_SINO   = {'0':'영','1':'일','2':'이','3':'삼','4':'사','5':'오','6':'육','7':'칠','8':'팔','9':'구'};
const __KO_NUM_NATIVE = {'0':'영','1':'하나','2':'둘','3':'셋','4':'넷','5':'다섯','6':'여섯','7':'일곱','8':'여덟','9':'아홉'};

function koCanon(s){
  return String(s||'')
    .toLowerCase()
    .replace(/[a-z]+/g,'')         // 로마자 제거
    .replace(/[^\uAC00-\uD7A3\d]/g,'') // 한글/숫자만
    .replace(/\s+/g,'');            // 공백 제거
}
function expandDigits(s){
  if (!/\d/.test(s)) return [s];
  const rep = (map)=> s.replace(/\d/g, d => map[d] || d);
  return [s, rep(__KO_NUM_SINO), rep(__KO_NUM_NATIVE)];
}
function scoreWithNumberFallback(refKo, transcript){
  const base = koCanon(transcript);
  const cands = expandDigits(base);
  let best = 0;
  for(const c of cands){
    const sim = scoreSimilarity(refKo, koCanon(c));
    if(sim > best) best = sim;
  }
  return best; // 0..1
}

// ===== Whisper =====
async function transcribeBase64({ base64, filename='rec.webm', mimeType='audio/webm' }){
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  const buf = Buffer.from(clean, 'base64');

  const fd = new FormData();
  fd.append('file', buf, { filename, contentType: mimeType });
  fd.append('model', 'whisper-1');
  fd.append('language', 'ko');
  fd.append('response_format', 'json');

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: fd
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`whisper ${r.status}: ${text}`);
  return JSON.parse(text);
}

// ===== 유사도 =====
function scoreSimilarity(a,b){
  const A = String(a||''), B = String(b||'');
  const n=A.length, m=B.length;
  if(!n && !m) return 1; if(!n || !m) return 0;
  const dp = Array.from({length:n+1},()=>Array(m+1).fill(0));
  for(let i=0;i<=n;i++) dp[i][0]=i; for(let j=0;j<=m;j++) dp[0][j]=j;
  for(let i=1;i<=n;i++){
    for(let j=1;j<=m;j++){
      const c = A[i-1]===B[j-1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+c);
    }
  }
  const d = dp[n][m];
  return Math.max(0, 1 - d/Math.max(n,1));
}

function json(statusCode, obj){ return { statusCode, headers: CORS, body: JSON.stringify(obj) }; }
