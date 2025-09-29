// netlify/functions/send-results.js (final)
// 결과 이메일 전송 (학생 제출 → 선생님 메일)
// Node 18+

const nodemailer = require('nodemailer');

// ========= 안전 필터 =========
function sanitizePayload(payload) {
  try {
    if (payload && Array.isArray(payload.questions)) {
      payload.questions.forEach(q => {
        if (!q) return;
        if (q.recording) delete q.recording;     // 대용량 제거
        delete q.audio; delete q.audioBase64;    // 불필요 필드 제거
        delete q.logs;
      });
    }
  } catch (_) {}
  return payload;
}

// ========= 유틸 =========
function safeNum(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
}
function esc(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

// Simple highlight HTML sanitizer (no external deps)
// Allows only a small set of tags and very limited inline styles (color/background-color/font-weight)
function sanitizeHighlightHtml(raw){
  if (!raw) return '';
  let s = String(raw);
  // remove script/style blocks
  s = s.replace(/<(?:script|style)[\s\S]*?>[\s\S]*?<\/(?:script|style)>/gi, '');
  // remove event handler attributes
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  const allowedTags = new Set(['span','ins','del','strong','em','b','i','u','br']);

  // process tags: keep allowed tags, strip others
  s = s.replace(/<([^>]+)>/gi, (m, inner) => {
    // detect end tag
    if (/^\/?\s*([a-z0-9]+)/i.test(inner)){
      const isEnd = inner.trim().startsWith('/');
      const tagName = inner.replace(/^\/?\s*([a-z0-9]+).*$/i,'$1').toLowerCase();
      if (!allowedTags.has(tagName)) return ''; // drop tag
      if (isEnd) return `</${tagName}>`;
      // parse attributes (only style allowed)
      const styleMatch = inner.match(/style\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      let cleanStyle = '';
      if (styleMatch){
        const rawStyle = styleMatch[2]||styleMatch[3]||styleMatch[4]||'';
        // allow only color, background-color, font-weight
        const allowed = [];
        const re = /(?:color|background-color|font-weight)\s*:\s*([^;]+)\s*(?:;|$)/gi;
        let m2;
        while((m2=re.exec(rawStyle))){
          const prop = RegExp.lastMatch.split(':')[0] || '';
          const val = (m2[1]||'').trim();
          // basic value whitelist: hex, rgb or word
          if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(val) || /^rgb\(/i.test(val) || /^[a-z\-]+$/i.test(val)){
            allowed.push(`${prop}:${val}`);
          }
        }
        if (allowed.length) cleanStyle = ` style="${allowed.join(';')}"`;
      }
      return `<${tagName}${cleanStyle}>`;
    }
    return '';
  });

  // finally escape any stray angle brackets
  s = s.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // but restore allowed tags (they were escaped) - simpler: unescape allowed tag patterns produced above
  s = s.replace(/&lt;(\/?(span|ins|del|strong|em|b|i|u|br)(?:[^&]*)&gt;)/gi, '<$1>');
  // note: this is conservative; if something odd remains it'll be escaped
  return s;
}
function fmtDateISO(s){
  try { return new Date(s || Date.now()).toISOString(); } catch { return new Date().toISOString(); }
}
function fmtDateFR(s){
  try { return new Date(s || Date.now()).toLocaleString('fr-FR', { hour12:false }); } catch { return new Date().toLocaleString('fr-FR', { hour12:false }); }
}
function msBetweenISO(startISO, endISO){
  try { return new Date(endISO) - new Date(startISO); } catch { return 0; }
}
function hhmmss(sec){
  sec = Math.max(0, Math.floor(Number(sec)||0));
  const h = String(Math.floor(sec/3600)).padStart(2,'0');
  const m = String(Math.floor((sec%3600)/60)).padStart(2,'0');
  const s = String(sec%60).padStart(2,'0');
  return `${h}:${m}:${s}`;
}
function avg(arr){
  if(!Array.isArray(arr) || !arr.length) return 0;
  const s = arr.map(Number).filter(n => Number.isFinite(n));
  return s.length ? s.reduce((a,b)=>a+b,0)/s.length : 0;
}

// (A) isCorrect 기반 총점 계산(클라이언트 채점 활용)
function computeOverallFromIsCorrect(payload){
  try {
    const qs = Array.isArray(payload?.questions) ? payload.questions : [];
    const graded = qs.filter(q => typeof q?.isCorrect === 'boolean');
    const correct = graded.filter(q => q.isCorrect === true).length;
    const total   = graded.length || qs.length || 0;
    const pct     = total ? Math.round((100 * correct) / total) : 0;
    return { correct, total, pct };
  } catch { return { correct:0, total:0, pct:0 }; }
}

// (B) KO/FR/발음 보조 점수(폴백용)
function computeFallbackCategoryScores(payload){
  try {
    const qs = Array.isArray(payload?.questions) ? payload.questions : [];
    const total = qs.length || 0;
    const koOK = qs.filter(q => q?.isCorrectKo === true).length;
    const frOK = qs.filter(q => q?.isCorrectFr === true).length;
    const pronArr = qs.map(q => q?.pronunciation?.accuracy).filter(n => typeof n === 'number');

    const ko   = total ? Math.round(100 * koOK / total) : 0;
    const fr   = total ? Math.round(100 * frOK / total) : 0;
    const pron = pronArr.length ? Math.round(100 * avg(pronArr)) : 0;
    const overall = Math.round((ko + fr) / 2);

    return { ko, fr, pron, overall };
  } catch { return { ko:0, fr:0, pron:0, overall:0 }; }
}

// ⚠️ 서버 최종 점수 선택 규칙
function pickOverall(payload){
  // 1) 클라이언트가 보낸 overall/score가 있으면 최우선
  const cand = [payload?.overall, payload?.categoryScores?.overall, payload?.score]
    .map(Number).find(n => Number.isFinite(n));
  if (Number.isFinite(cand)) return Math.round(cand);

  // 2) 문항 isCorrect 기반(채점 문항 ≥1개)
  const from = computeOverallFromIsCorrect(payload); // {correct,total,pct}
  if (Number.isFinite(from.pct) && from.total > 0) return from.pct;

  // 3) 최후 폴백: 카테고리 평균
  const fb = computeFallbackCategoryScores(payload).overall;
  return Number.isFinite(fb) ? fb : 0;
}

// ========= HTML 본문 =========
function buildHtml(payload){
  const name   = esc((payload?.studentName||'N/A').trim());
  const title  = esc((payload?.assignmentTitle||'Exercice').trim());
  const topic  = esc(payload?.assignmentTopic||'');
  const startISO = fmtDateISO(payload?.startTime);
  const endISO   = fmtDateISO(payload?.endTime);

  const cat = payload?.categoryScores || computeFallbackCategoryScores(payload);
  const ko   = safeNum(cat.ko);
  const fr   = safeNum(cat.fr);
  const pron = safeNum(cat.pron);
  const overall = pickOverall(payload);

  const frDate = fmtDateFR(endISO);
  const durationSec = safeNum(payload?.totalTimeSeconds, Math.max(1, Math.floor(msBetweenISO(startISO,endISO)/1000)));
  const banner = (overall >= 90)
    ? `<div style="margin:16px 0;padding:14px;border-radius:12px;background:#fff7ed;border:1px solid #fdba74;text-align:center;font-weight:700">
         👑 Parfait absolu ! 👑🎉 Génie confirmé !<br/>완벽 그 자체! 👑🎉 천재 인증!
       </div>` : '';

  const detailRows = (Array.isArray(payload?.questions) ? payload.questions : []).map(q=>{
    const n = safeNum(q?.number);
    const ok = !!q?.isCorrect;
    const k  = !!q?.isCorrectKo;
    const f  = !!q?.isCorrectFr;
    const lc = safeNum(q?.listenCount);
    const h1 = safeNum(q?.hint1Count);
    const h2 = safeNum(q?.hint2Count);
    const acc = (q?.pronunciation && Number.isFinite(q.pronunciation.accuracy))
      ? Math.round(q.pronunciation.accuracy * 100) : null;
    const icon = ok ? '✅' : '❌';
    const ttsDur = (q?.pronunciation && Number.isFinite(q.pronunciation.ttsDuration)) ? `${Number(q.pronunciation.ttsDuration).toFixed(1)}s` : '–';
    const recDur = (q?.pronunciation && Number.isFinite(q.pronunciation.recDuration)) ? `${Number(q.pronunciation.recDuration).toFixed(1)}s` : '–';
  const refH = q?.refHtml ? sanitizeHighlightHtml(q.refHtml) : esc(q?.ko||'');
  const hypH = q?.hypHtml ? sanitizeHighlightHtml(q.hypHtml) : esc('');
    return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top">${n}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top">${esc(q?.ko||'')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top">${esc(q?.fr||'')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top">${icon}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top">${k?'✓':'–'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top">${f?'✓':'–'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top">${acc!=null? acc+'%':'–'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top">${ttsDur}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top">${recDur}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top">${lc}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top">${h1}/${h2}</td>
      </tr>
      <tr>
        <td colspan="11" style="padding:8px 12px;border-bottom:1px solid #e5e7eb;background:#fbfbfd">
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:240px"><strong>Référence / 원문</strong><div style="margin-top:6px;color:#0f172a;padding:10px;border-radius:999px;background:#f8fafc;border:1px solid #e6eef6">${refH}</div></div>
            <div style="flex:1;min-width:240px"><strong>Prononciation / 내 발음</strong><div style="margin-top:6px;color:#7f1d1d;padding:10px;border-radius:999px;background:linear-gradient(90deg,#fff7f7,#fff);border:1px solid #fee2e2">${hypH}</div></div>
            <div style="min-width:160px;color:#475569;font-size:13px;text-align:right">Durée TTS: ${ttsDur}<br/>Durée enregistrement: ${recDur}</div>
          </div>
        </td>
      </tr>`;
  }).join('');

  const durHMS = hhmmss(durationSec);

  // Wrap the content in a complete HTML document with explicit UTF-8 charset
  const inner = `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,'Helvetica Neue',Arial,'Noto Sans','Apple SD Gothic Neo',sans-serif;color:#0f172a;background:#f8fafc;padding:20px">
    <div style="max-width:860px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 8px 20px rgba(2,6,23,.06);overflow:hidden">
      <div style="padding:18px 20px;border-bottom:1px solid #e5e7eb;background:#f1f5f9">
        <div style="font-size:20px;font-weight:800;color:#1e293b">Résultats de l’exercice</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">${frDate}</div>
      </div>

      <div style="padding:16px 20px;display:flex;gap:12px;flex-wrap:wrap">
        <div><b>Nom</b>: ${name}</div>
        <div><b>Exercice</b>: ${title}${topic ? ` · ${topic}` : ''}</div>
        <div><b>Durée</b>: ${durHMS}</div>
        <div><b>Global</b>: <b>${overall}</b>/100</div>
        <div>KO: ${ko}/100 · FR: ${fr}/100 · Pron.: ${pron}/100</div>
      </div>

      <div style="padding:18px 20px">${banner}
        <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-top:12px">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #e5e7eb">
              <th>#</th><th>KO</th><th>FR</th><th>OK</th>
              <th>KO✓</th><th>FR✓</th><th>Pron.</th><th>Écoutes</th><th>Hints</th>
            </tr>
          </thead>
          <tbody>
            ${detailRows || `<tr><td colspan="9" style="padding:12px;text-align:center;color:#64748b">Aucun détail.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div style="padding:12px 20px;border-top:1px solid #e5e7eb;font-size:12px;text-align:center">
        made by <b>성일, Pongdang</b> · <a href="mailto:Lapeace29@gmail.com">Lapeace29@gmail.com</a>
      </div>
    </div>
  </div>`;

  return `<!doctype html>
  <html lang="ko">
    <head>
      <meta charset="utf-8">
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Résultats de l'exercice</title>
      <style>body{margin:0;padding:0}</style>
    </head>
    <body>
      ${inner}
    </body>
  </html>`;
}

function buildText(payload){
  const name  = (payload?.studentName||'N/A').trim();
  const title = (payload?.assignmentTitle||'Exercice').trim();
  const cat   = payload?.categoryScores || computeFallbackCategoryScores(payload);
  const overall = pickOverall(payload);
  return [
    `Résultats de l’exercice`,
    ``,
    `Nom: ${name}`,
    `Exercice: ${title}`,
    `KO: ${cat.ko ?? '-'}/100`,
    `FR: ${cat.fr ?? '-'}/100`,
    `Prononciation: ${cat.pron ?? '-'}/100`,
    `Global: ${overall}/100`,
  ].join('\n');
}

// ========= CORS =========
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

// ========= 핸들러 =========
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Only POST' };
  }

  let payload = {};
  try {
    payload = sanitizePayload(JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok:false, error:'Bad JSON' }) };
  }

  // ===== 제목 구성: "학생이름 / 연습문제이름 / 총점"
  const name    = (payload?.studentName || 'Élève').trim();
  const title   = (payload?.assignmentTitle || 'Exercice').trim();
  const overall = pickOverall(payload);
  const dateStr = new Date(payload?.endTime || Date.now()).toLocaleString('fr-FR', { hour12:false });

  const subject = `${name} / ${title} / ${overall}/100 (${dateStr})`;

  // ========= Gmail 환경변수 사용 =========
  const GMAIL_USER = process.env.GMAIL_USER || '';
  // 새 이름: GMAIL_APP_PASSWORD (기존 GMAIL_PASS는 폴백 허용)
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASS || '';
  const RESULTS_RECEIVER = process.env.RESULTS_RECEIVER || 'Lapeace29@gmail.com';

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.warn('[send-results] MISSING_ENV', { GMAIL_USER: !!GMAIL_USER, GMAIL_APP_PASSWORD: !!GMAIL_APP_PASSWORD });
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:false, reason:'MISSING_ENV' }) };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });

  try {
    await transporter.sendMail({
      from: `"Pongdang Korean" <${GMAIL_USER}>`,
      to: RESULTS_RECEIVER,
      subject,
      text: buildText(payload),
      // add alternatives and explicit charset to help mail clients interpret utf-8
      html: buildHtml(payload),
      alternatives: [{ contentType: 'text/html; charset=utf-8', content: buildHtml(payload) }]
    });

    // If client asked for HTML, return the HTML page directly
    const accept = (event?.headers?.accept || '').toLowerCase();
    const wantHtmlHeader = (event?.headers?.['x-return-html'] || event?.headers?.['X-Return-HTML']);
    const wantHtmlQuery = event?.queryStringParameters?.html === '1';
    const wantHtml = accept.includes('text/html') || String(wantHtmlHeader) === '1' || wantHtmlQuery;

    if (wantHtml) {
      return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'text/html; charset=utf-8' }), body: buildHtml(payload) };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:true }) };
  } catch (e) {
    console.error('[send-results] error', e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok:false, error:String(e) }) };
  }
};
