// /.netlify/functions/send-results.js
// Node 18+
// Gmail 또는 Generic SMTP 지원
//  - Gmail: GMAIL_USER, GMAIL_APP_PASSWORD, RECIPIENT_EMAIL
//  - SMTP:  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL, TO_EMAIL
// CORS/OPTIONS 포함

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '*';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  };
  if (event.httpMethod === 'OPTIONS') return ({ statusCode: 204, headers, body: '' });
  if (event.httpMethod !== 'POST') return res({ error: 'Method Not Allowed' }, 405, headers);

  try {
    const payload = safeParse(event.body);
    if (!payload.ok) return res({ ok:false, error: 'Invalid JSON body' }, 400, headers);
    const body = payload.value;

    const {
      studentName = 'Élève',
      startTime, endTime, totalTimeSeconds = 0,
      questions = [],
      assignmentTitle = 'Exercice de coréen',
      assignmentTopic = '',
      assignmentSummary = [],
      gradingMessage,
      categoryScores
    } = body;

    // 서버 집계(보수)
    const graded = questions.filter(q => typeof q.isCorrect === 'boolean');
    const correct = graded.filter(q => q.isCorrect).length;
    const overall = num(categoryScores?.overall, graded.length ? Math.round((correct/graded.length)*100) : 0);

    const totalQ = questions.length || 0;
    const koScore = num(categoryScores?.ko, totalQ ? Math.round((questions.filter(q=>q.isCorrectKo).length/totalQ)*100) : 0);
    const frScore = num(categoryScores?.fr, totalQ ? Math.round((questions.filter(q=>q.isCorrectFr).length/totalQ)*100) : 0);
    const pronVals = questions.map(q=>q?.pronunciation?.accuracy).filter(x=>typeof x==='number'&&isFinite(x));
    const pronScore = num(categoryScores?.pron, pronVals.length ? Math.round((pronVals.reduce((a,b)=>a+b,0)/pronVals.length)*100) : 0);

    const gm = gradingMessage || serverGetGradingMessage(overall);

    const html = buildEmailHtml({
      studentName, startTime, endTime, totalTimeSeconds,
      questions, assignmentTitle, assignmentTopic, assignmentSummary,
      overall, koScore, frScore, pronScore, gradedCount: graded.length, correctCount: correct, gm
    });
    const text = stripHtml(html);
    const attachments = [
      ...buildRecordingAttachments(questions),
      { filename: 'payload.json', content: Buffer.from(JSON.stringify(body,null,2),'utf8'), contentType: 'application/json' }
    ];

    const transporter = await makeTransport();
    const { from, to } = mailFromTo();
    const info = await transporter.sendMail({
      from, to,
      subject: `Résultats – ${studentName} – ${assignmentTitle} – KO:${koScore}/100 FR:${frScore}/100 Pron:${pronScore}/100`,
      html, text, attachments
    });

    return res({ ok:true, messageId: info.messageId }, 200, headers);
  } catch (err) {
    console.error('send-results error:', err);
    return res({ ok:false, error: String(err?.message || err) }, 500, headers);
  }
};

// helpers
function res(obj, status=200, headers={ 'Content-Type':'application/json' }){
  return { statusCode: status, headers, body: JSON.stringify(obj) };
}
function safeParse(s){ try { return { ok:true, value: JSON.parse(s||'{}') }; } catch { return { ok:false }; } }
function num(x, fallback=0){ const n=Number(x); return Number.isFinite(n)?n:fallback; }
function stripHtml(s=''){ return s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }

function mailFromTo(){
  const GUSER = process.env.GMAIL_USER, GPASS = process.env.GMAIL_APP_PASSWORD, RECIP = process.env.RECIPIENT_EMAIL;
  if (GUSER && GPASS && RECIP) return { from: `"Results" <${GUSER}>`, to: RECIP };
  return { from: process.env.FROM_EMAIL, to: process.env.TO_EMAIL };
}

async function makeTransport(){
  const GUSER = process.env.GMAIL_USER, GPASS = process.env.GMAIL_APP_PASSWORD, RECIP = process.env.RECIPIENT_EMAIL;
  if (GUSER && GPASS && RECIP) {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: GUSER, pass: GPASS },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000
    });
  }
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error('Email env not set. Provide Gmail (GMAIL_USER/GMAIL_APP_PASSWORD/RECIPIENT_EMAIL) or SMTP (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS, FROM_EMAIL, TO_EMAIL).');
  }
  const secure = String(process.env.SMTP_SECURE||'').toLowerCase() === 'true';
  return nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT), secure, auth: { user: SMTP_USER, pass: SMTP_PASS }});
}

function buildRecordingAttachments(questions=[]){
  const out=[];
  questions.forEach((q,i)=>{
    const rec=q && q.recording;
    if(!rec||!rec.base64) return;
    out.push({
      filename: rec.filename || `q${q.number||i+1}.webm`,
      content: Buffer.from(rec.base64,'base64'),
      contentType: rec.mimeType || 'audio/webm'
    });
  });
  return out;
}

function buildEmailHtml(ctx){
  const {
    studentName, startTime, endTime, totalTimeSeconds,
    questions, assignmentTitle, assignmentTopic, assignmentSummary,
    overall, koScore, frScore, pronScore, gradedCount, correctCount, gm
  } = ctx;

  const esc = s => String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const mins = Math.floor(num(totalTimeSeconds)/60), secs = Math.round(num(totalTimeSeconds)%60);
  const sumList = Array.isArray(assignmentSummary) ? assignmentSummary : String(assignmentSummary||'').split(/\n+/).filter(Boolean);
  const sumHtml = sumList.length ? `<ul style="margin:6px 0 0 18px">${sumList.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>` : '';

  const rows = (questions||[]).map((q,idx)=>{
    const ok = q.isCorrect ? '✔️' : '❌';
    const userKo = typeof q.userAnswer==='string' ? q.userAnswer : (q.userAnswer?.ko||'');
    const userFr = q.userAnswerFr || q.userAnswer?.fr || '';
    let pron = '-';
    if (q.pronunciation && typeof q.pronunciation.accuracy==='number') {
      const p = Math.round((q.pronunciation.accuracy||0)*100);
      const tags = (q.pronunciation.tags||[]).slice(0,2).join(', ');
      pron = `<b>${p}%</b>${tags?` <span style="color:#666">| ${esc(tags)}</span>`:''}`;
    }
    return `
      <tr style="background:${idx%2? '#fff':'#fafafa'}">
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.number||idx+1}</td>
        <td style="border:1px solid #eee;padding:6px">${esc(q.fr||'')}</td>
        <td style="border:1px solid #eee;padding:6px">${esc(q.ko||'')}</td>
        <td style="border:1px solid #eee;padding:6px">
          <div><b>KO:</b> ${esc(userKo||'(vide)')}</div>
          <div style="margin-top:3px"><b>FR:</b> ${esc(userFr||'(vide)')}</div>
        </td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${ok}</td>
        <td style="border:1px solid #eee;padding:6px">${pron}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.listenCount||0}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.hint1Count||0}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.hint2Count||0}</td>
      </tr>`;
  }).join('');

  const badge = `<div style="display:flex;gap:8px;justify-content:center;margin-top:6px">
    <span style="background:#e7f8ee;border:1px solid #9be4b8;border-radius:9999px;padding:4px 10px">KO ${koScore}/100</span>
    <span style="background:#e7f8ee;border:1px solid #9be4b8;border-radius:9999px;padding:4px 10px">FR ${frScore}/100</span>
    <span style="background:#e7f8ee;border:1px solid #9be4b8;border-radius:9999px;padding:4px 10px">Pron ${pronScore}/100</span>
  </div>`;

  const gmHtml = gm ? `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px;margin:10px 0">
      <div style="font-weight:700">${esc(gm.emoji||'')} ${esc(gm.fr||'')}</div>
      <div style="color:#374151">${esc(gm.ko||'')}</div>
    </div>` : '';

  return `
    <div style="font-family:Arial,sans-serif">
      <h2 style="margin:0 0 6px 0">${esc(assignmentTitle)}</h2>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px">
        <div><b>Thème / 주제:</b> ${esc(assignmentTopic||'-')}</div>
        ${sumHtml}
      </div>

      <div style="background:#f0f4f8;padding:12px;border-radius:8px;margin:10px 0;text-align:center">
        <h3 style="margin:0;font-size:22px">Score (KO+FR): ${overall} / 100</h3>
        <p style="margin:6px 0 0;font-size:14px;color:#333">(${correctCount} / ${gradedCount} bonnes réponses)</p>
        ${badge}
      </div>
      ${gmHtml}

      <p style="margin:6px 0">
        <b>Élève:</b> ${esc(studentName)}<br/>
        <b>Début:</b> ${esc(String(startTime||''))} · <b>Fin:</b> ${esc(String(endTime||''))} · <b>Temps total:</b> ${Math.max(0,mins)}m ${Math.max(0,secs)}s
      </p>

      <table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:6px">
        <thead>
          <tr style="background:#eef2f7">
            <th style="border:1px solid #eee;padding:6px">#</th>
            <th style="border:1px solid #eee;padding:6px">Français</th>
            <th style="border:1px solid #eee;padding:6px">Coréen</th>
            <th style="border:1px solid #eee;padding:6px">Réponse élève (KO/FR)</th>
            <th style="border:1px solid #eee;padding:6px">OK?</th>
            <th style="border:1px solid #eee;padding:6px">Pron.</th>
            <th style="border:1px solid #eee;padding:6px">Écoutes</th>
            <th style="border:1px solid #eee;padding:6px">Indice 1</th>
            <th style="border:1px solid #eee;padding:6px">Indice 2</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function serverGetGradingMessage(score){
  const s=Number(score)||0;
  if (s===100) return { fr:"Parfait absolu ! 👑🎉 Génie confirmé !", ko:"완벽 그 자체! 👑🎉 천재 인증!", emoji:"👑", score:s };
  if (s>=80)  return { fr:"Très bien joué ! 👍 Presque un maître !", ko:"아주 잘했어요! 👍 이 정도면 거의 마스터!", emoji:"👏", score:s };
  if (s>=60)  return { fr:"Pas mal du tout ! 😎 Encore un petit effort et c’est le top !", ko:"꽤 잘했어요! 😎 조금만 더 가면 최고!", emoji:"✅", score:s };
  return { fr:"Allez, un petit café et on repart ! ☕", ko:"자, 커피 한 잔 하고 다시 가자! ☕💪", emoji:"☕", score:s };
}
