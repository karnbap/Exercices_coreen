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
    if(!OPENAI_API_KEY) return j(200, fail(['stt-fail:no-key']));

    const body = JSON.parse(event.body||'{}');
    const ref  = String(body.referenceText||'');
    const a    = body.audio||{};
    let b64    = String(a.base64||'');
    if(!b64) return j(400,{ message:'audio base64 required' });

    // dataURL 제거 + URL-safe 교정
    if(b64.startsWith('data:')){ const i=b64.indexOf(','); if(i>-1) b64=b64.slice(i+1); }
    b64 = b64.replace(/-/g,'+').replace(/_/g,'/');

    const dur  = Number(a.duration||0);
    if(dur && dur < 0.6) return j(200, fail(['trop-court']));

    // MIME/파일명 정규화
    const rawMime = String(a.mimeType||'audio/webm');
    let mime      = baseMime(rawMime);         // 'audio/webm' 형태로 정리
    let fname     = String(a.filename||'').trim();
    const buf     = Buffer.from(b64,'base64');
    const tags    = [];

    // 크기 진단
    tags.push('len:'+buf.length);

    // 컨테이너 시그니처로 실제 포맷 추정
    const cont = detectContainer(buf);
    if (cont) tags.push('container:'+cont);

    // 파일명-확장자 강제 보정 (브라우저가 webm이든 mp4든 헷갈려 보낼 때)
    if (!fname) fname = suggestNameByMime(mime);
    const needExt = extByMime(mime);
    if (!fname.toLowerCase().endsWith('.'+needExt)) {
      tags.push(`fix:ext:${fname}→.${needExt}`);
      fname = forceExt(fname, needExt);
    }

    // 컨테이너와 mime 불일치시 contentType도 교정
    if (cont === 'mp4' && mime !== 'audio/mp4') { tags.push(`mime-mismatch:mp4≠${mime}`); mime = 'audio/mp4'; fname = forceExt(fname,'m4a'); }
    if (cont === 'webm' && mime !== 'audio/webm') { tags.push(`mime-mismatch:webm≠${mime}`); mime = 'audio/webm'; fname = forceExt(fname,'webm'); }
    if (cont === 'ogg' && mime !== 'audio/ogg') { tags.push(`mime-mismatch:ogg≠${mime}`); mime = 'audio/ogg'; fname = forceExt(fname,'ogg'); }

    // 1차: gpt-4o-transcribe → 2차: whisper-1 폴백
    let transcript = '';
    try {
      transcript = await openaiTranscribe('gpt-4o-transcribe', buf, { mime, fname });
    } catch (e1) {
      tags.push('retry:whisper-1');
      try {
        transcript = await openaiTranscribe('whisper-1', buf, { mime, fname });
      } catch (e2) {
        // 실패 스니펫도 태그에 포함(앞 120자)
        const tag = e2?.tag || e1?.tag || 'stt-fail:400';
        tags.push(tag);
        return j(200, fail(tags));
      }
    }

    transcript = String(transcript||'').trim();

    const acc = similarity(norm(ref), norm(transcript));
    if (/요/.test(ref) && /유/.test(transcript)) tags.push('요→유');
    if (/으/.test(ref) && /우/.test(transcript)) tags.push('으→우');
    if (/에/.test(ref) && /애/.test(transcript)) tags.push('에↔애');
    if (/ㅅ/.test(ref) && /ㅆ/.test(transcript)) tags.push('ㅅ↔ㅆ');

    return j(200, { accuracy:Number(acc.toFixed(3)), transcript, confusionTags:tags });
  }catch(err){
    console.error(err);
    return j(200, fail(['stt-fail:exception']));
  }
};

// ---------- helpers ----------
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
    const snip = String(msg||'').slice(0,120).replace(/\s+/g,' ');
    const tag  = `stt-fail:${r.status}${snip?':'+snip:''}`;
    const e = new Error(tag); e.tag=tag; throw e;
  }
  const j = await r.json();
  return j.text || '';
}

function baseMime(m){ return String(m||'').split(';')[0] || 'audio/webm'; }
function extByMime(m){ return (m==='audio/mp4'||m==='audio/m4a')?'m4a': (m==='audio/ogg')?'ogg': (m==='audio/mpeg'||m==='audio/mp3')?'mp3':'webm'; }
function suggestNameByMime(m){ const e=extByMime(m); return 'rec.'+e; }
function forceExt(name, ext){ return name.replace(/\.[a-z0-9]+$/i,'')+'.'+ext; }

// 시그니처 기반 컨테이너 판별(대략)
function detectContainer(buf){
  if (!buf || buf.length<12) return '';
  // WebM/Matroska: 1A 45 DF A3
  if (buf[0]===0x1A && buf[1]===0x45 && buf[2]===0xDF && buf[3]===0xA3) return 'webm';
  // MP4/M4A: 00 00 00 ?? 66 74 79 70 ('ftyp')
  if (buf[4]===0x66 && buf[5]===0x74 && buf[6]===0x79 && buf[7]===0x70) return 'mp4';
  // OGG: 4F 67 67 53 ('OggS')
  if (buf[0]===0x4F && buf[1]===0x67 && buf[2]===0x67 && buf[3]===0x53) return 'ogg';
  return '';
}

function norm(s){ return String(s||'').replace(/\s+/g,'').replace(/[.,!?;:()"'’“”\-–—]/g,''); }
function similarity(a,b){
  const n=a.length, m=b.length; if(!n&&!m) return 1; if(!n||!m) return 0;
  const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
  for(let i=0;i<=n;i++) dp[i][0]=i; for(let j=0;j<=m;j++) dp[0][j]=j;
  for(let i=1;i<=n;i++){ for(let j=1;j<=m;j++){
    const c=a[i-1]===b[j-1]?0:1; dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+c);
  }}
  const d=dp[n][m]; return Math.max(0,1 - d/Math.max(n,1));
}
function fail(tags){ return { accuracy:0, transcript:'', confusionTags:Array.from(new Set(tags||[])) }; }
function hdr(){ return {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type,Authorization,Accept',
  'Content-Type':'application/json','Cache-Control':'no-store'
};}
function j(statusCode,obj){ return { statusCode, headers:hdr(), body:JSON.stringify(obj) }; }
