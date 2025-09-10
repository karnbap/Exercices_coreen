// netlify/functions/analyze-pronunciation.js
// 요청: { referenceText, audio:{ base64, mimeType, filename?, duration? } }
// 응답: { accuracy(0..1), transcript, confusionTags[] }

const fetch = global.fetch || require('node-fetch');
const FormData = require('form-data');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:hdr(), body:'' };
  if (event.httpMethod !== 'POST')    return j(405,{ message:'Method Not Allowed' });

  try{
    if(!OPENAI_API_KEY) return j(200, fail('stt-fail:no-key'));

    const body = JSON.parse(event.body||'{}');
    const ref  = String(body.referenceText||'');
    const a    = body.audio||{};
    let b64    = String(a.base64||'');
    if(!b64) return j(400,{ message:'audio base64 required' });

    // dataURL 제거 + URL-safe base64 교정
    if(b64.startsWith('data:')){ const i=b64.indexOf(','); if(i>-1) b64=b64.slice(i+1); }
    b64 = b64.replace(/-/g,'+').replace(/_/g,'/');

    const dur  = Number(a.duration||0);
    if(dur && dur < 0.6) return j(200, fail('trop-court'));

    // MIME/파일명 정규화
    const rawMime = String(a.mimeType||'audio/webm');
    const mime    = rawMime.split(';')[0] || 'audio/webm';
    const fname   = a.filename || pickNameByMime(mime);

    // 업로드 본문
    const buf = Buffer.from(b64,'base64');
    const trySTT = (model)=>openaiTranscribe(model, buf, { mime, fname });

    let text='';
    try{
      text = await trySTT('gpt-4o-transcribe');   // 1차
    }catch(e1){
      try{
        text = await trySTT('whisper-1');         // 2차 폴백
      }catch(e2){
        const tag = e2?.tag || e1?.tag || 'stt-fail:400';
        return j(200, fail(tag));
      }
    }

    const transcript = String(text||'').trim();
    const acc = similarity(norm(ref), norm(transcript));

    const tags=[];
    if(/요/.test(ref) && /유/.test(transcript)) tags.push('요→유');
    if(/으/.test(ref) && /우/.test(transcript)) tags.push('으→우');
    if(/에/.test(ref) && /애/.test(transcript)) tags.push('에↔애');
    if(/ㅅ/.test(ref) && /ㅆ/.test(transcript)) tags.push('ㅅ↔ㅆ');

    return j(200, { accuracy:Number(acc.toFixed(3)), transcript, confusionTags:tags });
  }catch(err){
    console.error(err);
    return j(200, fail('stt-fail:exception'));
  }
};

// ---- helpers ----
async function openaiTranscribe(model, buf, { mime, fname }){
  const fd = new FormData();
  fd.append('file', buf, { filename: fname, contentType: mime, knownLength: buf.length });
  fd.append('model', model);
  fd.append('language','ko');

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method:'POST',
    headers:{ Authorization:`Bearer ${OPENAI_API_KEY}`, ...fd.getHeaders() },
    body: fd
  });

  if(!r.ok){
    let msg=''; try{ msg=await r.text(); }catch(_){}
    const code = r.status||400;
    const snip = String(msg||'').slice(0,120).replace(/\s+/g,' ');
    const tag  = `stt-fail:${code}${snip?':'+snip:''}`;
    const e = new Error(tag); e.tag=tag; throw e;
  }
  const j = await r.json();
  return j.text || '';
}

function pickNameByMime(m){
  if(m==='audio/mp4' || m==='audio/m4a') return 'rec.m4a';
  if(m==='audio/ogg') return 'rec.ogg';
  if(m==='audio/mpeg' || m==='audio/mp3') return 'rec.mp3';
  return 'rec.webm';
}
function norm(s){ return String(s||'').replace(/\s+/g,'').replace(/[.,!?;:()"'’“”\-–—]/g,''); }
function similarity(a,b){
  const n=a.length, m=b.length; if(!n&&!m) return 1; if(!n||!m) return 0;
  const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
  for(let i=0;i<=n;i++) dp[i][0]=i; for(let j=0;j<=m;j++) dp[0][j]=j;
  for(let i=1;i<=n;i++){ for(let j=1;j<=m;j++){
    const c=a[i-1]===b[j-1]?0:1;
    dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+c);
  }}
  const d=dp[n][m]; return Math.max(0,1 - d/Math.max(n,1));
}
function fail(tag){ return { accuracy:0, transcript:'', confusionTags:[String(tag||'stt-fail')] }; }
function hdr(){ return {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type,Authorization,Accept',
  'Content-Type':'application/json','Cache-Control':'no-store'
};}
function j(statusCode,obj){ return { statusCode, headers:hdr(), body:JSON.stringify(obj) }; }
