// netlify/functions/send-results.js
// 결과 이메일 전송 (학생 제출 → 선생님 메일)
// Node 18+

const nodemailer = require('nodemailer');

// ========= 안전 필터 =========
function sanitizePayload(payload) {
  try {
    if (payload && Array.isArray(payload.questions)) {
      payload.questions.forEach(q => {
        if (!q) return;
        if (q.recording) delete q.recording;
        delete q.audio; delete q.audioBase64; delete q.logs;
      });
    }
  } catch (_) {}
  return payload;
}

// ========= 유틸 =========
function avg(arr){
  if(!Array.isArray(arr) || !arr.length) return 0;
  const s = arr.map(Number).filter(n => Number.isFinite(n));
  return s.length ? s.reduce((a,b)=>a+b,0)/s.length : 0;
}
function computeFallbackScores(payload){
  const qs = Array.isArray(payload?.questions) ? payload.questions : [];
  const total = qs.length || 0;
  const koOK = qs.filter(q => q?.isCorrectKo === true).length;
  const frOK = qs.filter(q => q?.isCorrectFr === true).length;
  const pron = qs.map(q => q?.pronunciation?.accuracy).filter(n => typeof n === 'number');
  const koScore = total ? Math.round(100 * koOK / total) : 0;
  const frScore = total ? Math.round(100 * frOK / total) : 0;
  const pronScore = pron.length ? Math.round(100 * avg(pron)) : 0;
  const overall = Math.round((koScore + frScore) / 2);
  return { ko: koScore, fr: frScore, pron: pronScore, overall };
}
function pickOverall(payload){
  const cand = [
    payload?.categoryScores?.overall,
    payload?.overall,
    payload?.score
  ].map(Number).find(n => Number.isFinite(n));
  if (Number.isFinite(cand)) return Math.round(cand);
  return computeFallbackScores(payload).overall;
}
function safeNum(n, d=0){
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
}
function esc(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
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

// ========= HTML 본문 =========
function buildHtml(payload){
  const name  = esc((payload?.studentName||'N/A').trim());
  const title = esc((payload?.assignmentTitle||'Exercice').trim());
  const topic = esc(payload?.assignmentTopic||'');
  const startISO = fmtDateISO(payload?.startTime);
  const endISO   = fmtDateISO(payload?.endTime);
  const cat = payload?.categoryScores || computeFallbackScores(payload);
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
    return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${n}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${esc(q?.ko||'')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${esc(q?.fr||'')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${icon}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${k?'✓':'–'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${f?'✓':'–'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${acc!=null? acc+'%':'–'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${lc}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${h1}/${h2}</td>
      </tr>`;
  }).join('');

  return `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,'Helvetica Neue',Arial,'Noto Sans','Apple SD Gothic Neo',sans-serif;color:#0f172a;background:#f8fafc;padding:20px">
    <div style="max-width:860px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 8px 20px rgba(2,6,23,.06);overflow:hidden">
      <div style="padding:18px 20px;border-bottom:1px solid #e5e7eb;background:#f1f5f9">
        <div style="font-size:20px;font-weight:800;color:#1e293b">Résultats de l’exercice</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">${frDate}</div>
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
}
function buildText(payload){
  const name  = (payload?.studentName||'N/A').trim();
  const title = (payload?.assignmentTitle||'Exercice').trim();
  const cat = payload?.categoryScores || computeFallbackScores(payload);
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

  const name  = (payload?.studentName || 'N/A').trim();
  const title = (payload?.assignmentTitle || 'Exercice').trim();
  const overall = pickOverall(payload);
  const dateStr = new Date(payload?.endTime || Date.now()).toLocaleString('fr-FR', { hour12:false });
  const subject = `Résultats ${overall}/100 – ${title} – ${name} (${dateStr})`;

  // ========= Gmail 환경변수 사용 =========
const GMAIL_USER = process.env.GMAIL_USER || process.env.SMTP_USER || '';
const GMAIL_PASS = process.env.GMAIL_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '';
const RESULTS_RECEIVER = process.env.RESULTS_RECEIVER || 'Lapeace29@gmail.com';

if (!GMAIL_USER || !GMAIL_PASS) {
  console.warn('[send-results] MISSING_ENV', {
    GMAIL_USER: !!GMAIL_USER,
    GMAIL_PASS: !!GMAIL_PASS,
    GMAIL_APP_PASSWORD: !!process.env.GMAIL_APP_PASSWORD
  });
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:false, reason:'MISSING_ENV' }) };
}


  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS }
  });

  try {
    await transporter.sendMail({
      from: `"Pongdang Korean" <${GMAIL_USER}>`,
      to: RESULTS_RECEIVER,
      subject,
      text: buildText(payload),
      html: buildHtml(payload)
    });

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:true }) };
  } catch (e) {
    console.error('[send-results] error', e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok:false, error:String(e) }) };
  }
};

