// netlify/functions/analyze-pronunciation.js
// 요청: { referenceText:string, audio:{ base64:string, mimeType:string, filename?:string, duration?:number } }
// 응답: { accuracy:number(0..1), transcript:string, confusionTags:string[] }

const fetch = global.fetch || require('node-fetch');
const FormData = require('form-data');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:hdr(), body:'' };
  if (event.httpMethod !== 'POST') return j(405,{ message:'Method Not Allowed' });

  try {
    const body = JSON.parse(event.body || '{}');
    const ref = String(body.referenceText || '');
    const audio = body.audio || {};
    const b64 = String(audio.base64 || '');
    const mime = String(audio.mimeType || 'audio/webm');
    const duration = Number(audio.duration || 0);

    if (!b64) return j(400, { message:'audio base64 required' });

    if (duration && duration < 0.6) {
      // 너무 짧으면 분석 무의미
      return j(200, { accuracy:0, transcript:'', confusionTags:['trop-court'] });
    }

    // Whisper STT (ko)
    const buf = Buffer.from(b64, 'base64');
    const fd = new FormData();
    fd.append('file', buf, { filename: audio.filename || 'rec.webm', contentType: mime });
    fd.append('model', 'whisper-1');
    fd.append('language', 'ko');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method:'POST',
      headers:{ Authorization:`Bearer ${OPENAI_API_KEY}` },
      body: fd
    });

    if (!r.ok) {
      const t = await r.text().catch(()=> '');
      return j(200, { accuracy:0, transcript:'', confusionTags:[`stt-fail:${r.status}`] });
    }
    const tj = await r.json();
    const hyp = String(tj.text || '').trim();

    // 정규화
    const norm = s => String(s||'').replace(/\s+/g,'').replace(/[.,!?;:()"'’“”\-–—]/g,'');
    const R = norm(ref), H = norm(hyp);

    // 레벤슈타인 기반 유사도
    const sim = (a,b) => {
      const n=a.length, m=b.length; if(!n&&!m) return 1; if(!n||!m) return 0;
      const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
      for(let i=0;i<=n;i++) dp[i][0]=i; for(let j=0;j<=m;j++) dp[0][j]=j;
      for(let i=1;i<=n;i++){ for(let j=1;j<=m;j++){
        const cost=a[i-1]===b[j-1]?0:1;
        dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
      }}
      const d=dp[n][m]; return Math.max(0, 1 - d/Math.max(n,1));
    };

    let acc = sim(R,H);

    // 혼동 태그(예: 요→유)
    const tags = [];
    if (/요/.test(ref) && /유/.test(hyp)) tags.push('요→유');     // “요”를 “유”로
    if (/으/.test(ref) && /우/.test(hyp)) tags.push('으→우');
    if (/에/.test(ref) && /애/.test(hyp)) tags.push('에↔애');
    if (/ㅅ/.test(ref) && /ㅆ/.test(hyp)) tags.push('ㅅ↔ㅆ');

    return j(200, { accuracy: Number(acc.toFixed(3)), transcript: hyp, confusionTags: tags });

  } catch (err) {
    console.error(err);
    return j(500, { message:'analyze-pronunciation failed', error:String(err) });
  }
};

function hdr(){ return {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type,Authorization,Accept',
  'Content-Type':'application/json',
  'Cache-Control':'no-store'
};}
function j(statusCode,obj){ return { statusCode, headers:hdr(), body:JSON.stringify(obj) }; }
