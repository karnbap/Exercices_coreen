// netlify/functions/send-results.js
// Node 18+
// Email via Gmail(App Password) 혹은 일반 SMTP 자동 선택
// ENV (Gmail): GMAIL_USER, GMAIL_APP_PASSWORD, RECIPIENT_EMAIL
// ENV (SMTP):  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, TO_EMAIL(또는 RECIPIENT_EMAIL)

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return jres({ ok: true }, 200, true);
    }
    if (event.httpMethod !== 'POST') {
      return jres({ ok: false, error: 'Method Not Allowed' }, 405, true);
    }

    const payload = safeJson(event.body);
    const {
      studentName = 'Élève',
      startTime,
      endTime,
      totalTimeSeconds = 0,
      questions = [],
      assignmentTitle = 'Exercice de coréen',
      assignmentTopic = '',
      assignmentSummary = [],       // array or \n-joined string
      gradingMessage                // optional {fr,ko,emoji,score}
    } = payload || {};

    // 점수 집계
    const graded = questions.filter(q => typeof q?.isCorrect === 'boolean');
    const correct = graded.filter(q => q.isCorrect).length;
    const score = graded.length ? Math.round((correct / graded.length) * 100) : 0;

    const gm = gradingMessage || serverGetGradingMessage(score);

    // 발음 평균
    const pronArr = (questions || []).map(q => q?.pronunciation).filter(Boolean);
    const avgAcc = pronArr.length
      ? Math.round(pronArr.reduce((s, p) => s + (p.accuracy || 0), 0) / pronArr.length * 100)
      : null;

    // 이메일 트랜스포트
    const { transporter, from, to, envFlavor } = await createSmartTransport();

    // 연결/인증 사전 점검
    try { await transporter.verify(); }
    catch (e) {
      return jres({
        ok: false,
        error: 'SMTP verify failed',
        detail: String(e?.message || e),
        stack: String(e?.stack || ''),
        envFlavor
      }, 500, true);
    }

    // 본문/첨부
    const html = buildEmailHtml({
      studentName, startTime, endTime, totalTimeSeconds,
      questions, assignmentTitle, assignmentTopic, assignmentSummary,
      score, gradedCount: graded.length, correctCount: correct,
      avgAcc, gm
    });
    const attachments = buildAttachments(questions);

    // 발송
    const info = await transporter.sendMail({
      from,
      to,
      subject: `Résultats – ${studentName} – ${assignmentTitle} – Score: ${score}/100`,
      html,
      text: stripHtml(html),
      attachments
    });

    return jres({ ok: true, messageId: info.messageId, envFlavor }, 200, true);

  } catch (e) {
    return jres({
      ok: false,
      error: String(e?.message || e),
      stack: String(e?.stack || '')
    }, 500, true);
  }
};

// ---------- helpers ----------
function safeJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

async function createSmartTransport(){
  // Gmail (권장)
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || process.env.TO_EMAIL;

  if (GMAIL_USER && GMAIL_APP_PASSWORD && RECIPIENT_EMAIL) {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });
    return { transporter, from: `Korean Pondant <${GMAIL_USER}>`, to: RECIPIENT_EMAIL, envFlavor: 'gmail' };
  }

  // SMTP (대안)
  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
  const SMTP_SECURE = /^true$/i.test(String(process.env.SMTP_SECURE || ''));
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const TO_EMAIL  = process.env.TO_EMAIL || process.env.RECIPIENT_EMAIL;

  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && TO_EMAIL) {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    return { transporter, from: SMTP_USER, to: TO_EMAIL, envFlavor: 'smtp' };
  }

  throw new Error('Email env missing. Provide either GMAIL_USER/GMAIL_APP_PASSWORD/RECIPIENT_EMAIL or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/TO_EMAIL');
}

function buildAttachments(questions = []) {
  const out = [];
  questions.forEach((q, i) => {
    const rec = q?.recording;
    if (!rec?.base64) return;
    out.push({
      filename: rec.filename || `q${q.number || i + 1}.webm`,
      content: Buffer.from(rec.base64, 'base64'),
      contentType: rec.mimeType || 'audio/webm'
    });
  });
  return out;
}

function buildEmailHtml(ctx) {
  const {
    studentName, startTime, endTime, totalTimeSeconds,
    questions, assignmentTitle, assignmentTopic, assignmentSummary,
    score, gradedCount, correctCount, avgAcc, gm
  } = ctx;

  const mins = Math.floor((totalTimeSeconds || 0) / 60);
  const secs = Math.round((totalTimeSeconds || 0) % 60);

  const summaryList = Array.isArray(assignmentSummary)
    ? assignmentSummary
    : String(assignmentSummary || '').split(/\n+/).filter(Boolean);

  const summaryHtml = summaryList.length
    ? `<ul style="margin:8px 0 0 18px;padding:0">${summaryList.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`
    : '';

  const thead = `
    <thead>
      <tr style="background:#f0f4f8">
        <th style="border:1px solid #eee;padding:6px">#</th>
        <th style="border:1px solid #eee;padding:6px">Français</th>
        <th style="border:1px solid #eee;padding:6px">Coréen</th>
        <th style="border:1px solid #eee;padding:6px">Réponse élève</th>
        <th style="border:1px solid #eee;padding:6px">OK?</th>
        <th style="border:1px solid #eee;padding:6px">Prononciation</th>
        <th style="border:1px solid #eee;padding:6px">Écoutes</th>
        <th style="border:1px solid #eee;padding:6px">Indice 1</th>
        <th style="border:1px solid #eee;padding:6px">Indice 2</th>
      </tr>
    </thead>`;

  const rows = (questions || []).map((q, idx) => {
    const answered = q.userAnswer ? escapeHtml(q.userAnswer) : '<i>(vide)</i>';
    const ok = q.isCorrect ? '✔️' : '❌';

    let pronunCell = '<span style="color:#888">-</span>';
    if (q.pronunciation && typeof q.pronunciation.accuracy === 'number') {
      const p = Math.round((q.pronunciation.accuracy || 0) * 100);
      const tags = (q.pronunciation.tags || []).slice(0, 2).join(', ');
      pronunCell = `<b>${p}%</b>${tags ? ` <span style="color:#666">| ${escapeHtml(tags)}</span>` : ''}`;
    }

    const friendly = (q.pronunciation?.friendly || []).slice(0, 2)
      .map(m => `• ${escapeHtml(m.fr)} / ${escapeHtml(m.ko)}`).join('<br/>');
    const friendlyHtml = friendly
      ? `<div style="margin-top:6px;font-size:12px;color:#444">${friendly}</div>`
      : '';

    const audioHtml = q?.recording?.base64
      ? `<div style="margin-top:6px"><b>Enregistrement élève:</b><br/><div style="font-size:12px;color:#666">* Pièce jointe: ${escapeHtml(q.recording.filename || '')} ${q.recording.duration ? '(' + q.recording.duration + 's)' : ''}</div></div>`
      : '';

    const detailRow = (audioHtml || friendlyHtml)
      ? `<tr><td colspan="9" style="border:1px solid #eee;padding:6px;background:#fafafa">${audioHtml}${friendlyHtml}</td></tr>`
      : '';

    return `
      <tr>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.number ?? ''}</td>
        <td style="border:1px solid #eee;padding:6px">${escapeHtml(q.fr || '')}</td>
        <td style="border:1px solid #eee;padding:6px">${escapeHtml(q.ko || '')}</td>
        <td style="border:1px solid #eee;padding:6px">${answered}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${ok}</td>
        <td style="border:1px solid #eee;padding:6px">${pronunCell}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.listenCount || 0}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.hint1Count || 0}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.hint2Count || 0}</td>
      </tr>
      ${detailRow}
    `;
  }).join('');

  const gmHtml = gm ? `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px;margin:10px 0">
      <div style="font-weight:700">${escapeHtml(gm.emoji || '')} ${escapeHtml(gm.fr || '')}</div>
      <div style="color:#374151">${escapeHtml(gm.ko || '')}</div>
    </div>
  ` : '';

  const html = `
    <div style="font-family:Arial, sans-serif">
      <h2 style="margin:0 0 8px 0">${escapeHtml(assignmentTitle)}</h2>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px">
        <div><b>Thème / 주제:</b> ${escapeHtml(assignmentTopic || '-')}</div>
        ${summaryHtml}
        <div style="margin-top:8px;font-size:14px;color:#0a4"><b>Prononciation</b> — moyenne ${avgAcc != null ? (avgAcc + '%') : '-'}</div>
      </div>

      <div style="margin-top:10px">
        <p style="margin:6px 0">
          <b>Élève:</b> ${escapeHtml(studentName)}<br/>
          <b>Début:</b> ${escapeHtml(String(startTime || ''))} ·
          <b>Fin:</b> ${escapeHtml(String(endTime || ''))} ·
          <b>Temps total:</b> ${mins}m ${secs}s
        </p>
        <div style="background:#f0f4f8; padding:12px; border-radius:8px; margin:10px 0; text-align:center;">
          <h3 style="margin:0; font-size:22px;">Score Final: ${score} / 100</h3>
          <p style="margin:6px 0 0; font-size:14px; color:#333;">(${correctCount} / ${gradedCount} bonnes réponses)</p>
        </div>
        ${gmHtml}
      </div>

      <table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:6px">
        ${thead}
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  return html;
}

function serverGetGradingMessage(score) {
  const s = Number(score) || 0;
  if (s === 100) return { fr: "Parfait absolu ! 👑🎉 Génie confirmé !", ko: "완벽 그 자체! 👑🎉 천재 인증!", emoji: "👑", score: s };
  if (s >= 80)  return { fr: "Très bien joué ! 👍 Presque un maître !", ko: "아주 잘했어요! 👍 이 정도면 거의 마스터!", emoji: "👏", score: s };
  if (s >= 60)  return { fr: "Pas mal du tout ! 😎 Encore un petit effort et c’est le top !", ko: "꽤 잘했어요! 😎 조금만 더 가면 최고!", emoji: "✅", score: s };
  return { fr: "Allez, un petit café et on repart ! ☕", ko: "자, 커피 한 잔 하고 다시 가자! ☕💪", emoji: "☕", score: s };
}

function escapeHtml(s = '') {
  return String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function stripHtml(s = '') { return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

function jres(obj, status = 200, withCORS = false) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (withCORS) {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Allow-Methods'] = 'POST,OPTIONS';
  }
  return { statusCode: status, headers, body: JSON.stringify(obj) };
}
