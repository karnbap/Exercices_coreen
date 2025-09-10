// Whisper 전송부 FormData 보정 + 단순 스코어러(유사도 폴백)
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
    const ref  = String(body.referenceText||'').replace(/\s+/g,'');
    const audio = body.audio||{};
    if (!audio?.base64) return json(400, { message:'audio.base64 required' });

    const tj = await transcribeBase64({
      base64: audio.base64, filename: audio.filename||'rec.webm', mimeType: audio.mimeType||'audio/webm'
    });

    const transcript = String(tj?.text||'').trim();
    const acc = scoreSimilarity(ref, transcript.replace(/\s+/g,''));

    return json(200, {
      transcript,
      accuracy: acc, // 0..1
      details: { explain: transcript ? [] : ['입력이 너무 짧거나 무성 구간이 많았어요. 조금 더 길게 또박또박 읽어보세요.'] }
    });

  }catch(err){
    // Whisper 오류도 200으로 돌려보내되, 클라이언트 폴백이 유사도 계산하도록
    return json(200, { transcript:'', accuracy:0, confusionTags:[`stt-fail:${String(err).slice(0,80)}`] });
  }
};

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

function scoreSimilarity(a,b){
  // 레벤슈타인 기반 간단 유사도
  const n=a.length, m=b.length;
  if(!n && !m) return 1;
  if(!n || !m) return 0;
  const dp = Array.from({length:n+1},()=>Array(m+1).fill(0));
  for(let i=0;i<=n;i++) dp[i][0]=i; for(let j=0;j<=m;j++) dp[0][j]=j;
  for(let i=1;i<=n;i++){
    for(let j=1;j<=m;j++){
      const c = a[i-1]===b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+c);
    }
  }
  const d = dp[n][m];
  return Math.max(0, 1 - d/Math.max(n,1));
}

function json(statusCode, obj){ return { statusCode, headers: CORS, body: JSON.stringify(obj) }; }
