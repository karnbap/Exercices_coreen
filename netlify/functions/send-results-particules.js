const nodemailer = require('nodemailer');

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  },
  body: JSON.stringify(body)
});

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtDate(value) {
  if (!value) return '–';
  try {
    return new Date(value).toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (_) {
    return '–';
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, reason: 'METHOD_NOT_ALLOWED' });
  if ((event.body || '').length > 200000) return json(413, { ok: false, reason: 'PAYLOAD_TOO_LARGE' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { ok: false, reason: 'INVALID_JSON' }); }

  const aid = String(body.assignmentId || '').toLowerCase();
  if (!['particules_sujet_objet', 'particules-sujet-objet'].includes(aid)) {
    return json(400, { ok: false, reason: 'INVALID_ASSIGNMENT' });
  }
  if (body.trigger !== 'session_complete') {
    return json(400, { ok: false, reason: 'INVALID_TRIGGER' });
  }

  const studentName = String(body.studentName || '').trim().slice(0, 120);
  const studentEmail = String(body.studentEmail || '').trim().slice(0, 200);
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(studentEmail);
  if (!studentName || !validEmail) return json(400, { ok: false, reason: 'INVALID_STUDENT' });

  const { GMAIL_USER, GMAIL_APP_PASSWORD, RECIPIENT_EMAIL, RESULTS_RECEIVER } = process.env;
  const teacherEmail = RECIPIENT_EMAIL || RESULTS_RECEIVER;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !teacherEmail) {
    console.warn('[send-results-particules] missing mail environment');
    return json(500, { ok: false, reason: 'MISSING_ENV' });
  }

  const rounds = Array.isArray(body.questions) ? body.questions.slice(-20) : [];
  const perLevel = [1, 2, 3, 4].map((level) => {
    const items = rounds.filter((r) => Number(r.niveau) === level);
    if (!items.length) return { level, tries: 0, first: null, last: null, total: 5 };
    return {
      level,
      tries: items.length,
      first: Number(items[0].score),
      last: Number(items[items.length - 1].score),
      total: Number(items[items.length - 1].total || 5)
    };
  });

  const rows = perLevel.map((x) => {
    if (!x.tries) return `<tr><td>Niveau ${x.level}</td><td>–</td><td>non essayé</td></tr>`;
    const delta = x.last - x.first;
    const trend = delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : '=';
    return `<tr><td>Niveau ${x.level}</td><td>${x.tries}</td><td>${x.first}/${x.total} → <b>${x.last}/${x.total}</b> (${trend})</td></tr>`;
  }).join('');

  const historyRows = rounds.slice(-10).map((r) =>
    `<tr><td>${escapeHtml(fmtDate(r.ts))}</td><td>Niveau ${escapeHtml(r.niveau)}</td><td><b>${escapeHtml(r.score)}/${escapeHtml(r.total)}</b></td></tr>`
  ).join('') || '<tr><td colspan="3">Aucune manche vérifiée.</td></tr>';

  const dateStr = fmtDate(body.endTime || new Date().toISOString());
  const startStr = fmtDate(body.startTime);
  const best = escapeHtml(body.meilleursScores || '–');
  const tries = escapeHtml(body.nombreManches != null ? body.nombreManches : rounds.length);

  const teacherHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:800px;margin:0 auto;color:#1f2937">
      <h1 style="color:#2563eb;border-bottom:2px solid #e5e7eb;padding-bottom:10px">Résultats — Particules 이/가 &amp; 을/를</h1>
      <div style="background:#f8fafc;padding:15px;border-radius:8px">
        <p><b>Élève :</b> ${escapeHtml(studentName)}</p>
        <p><b>Email :</b> ${escapeHtml(studentEmail)}</p>
        <p><b>Début de cette session :</b> ${escapeHtml(startStr)}</p>
        <p><b>Fin :</b> ${escapeHtml(dateStr)}</p>
        <p><b>Manches vérifiées :</b> ${tries}</p>
      </div>
      <h2>Progression par niveau</h2>
      <table style="width:100%;border-collapse:collapse" border="1" cellpadding="7"><tr><th>Niveau</th><th>Essais</th><th>Premier → dernier</th></tr>${rows}</table>
      <h2>10 dernières manches</h2>
      <table style="width:100%;border-collapse:collapse" border="1" cellpadding="7"><tr><th>Date</th><th>Niveau</th><th>Score</th></tr>${historyRows}</table>
      <p><b>Meilleurs scores :</b> ${best}</p>
      <p style="color:#6b7280;font-size:.9rem">Rapport envoyé volontairement par l'élève à la fin de sa session.</p>
    </div>`;

  const studentHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#1f2937">
      <h1 style="color:#2563eb">안녕 ${escapeHtml(studentName)} !</h1>
      <p>Ta session de coréen est terminée. Voici ton bilan enregistré :</p>
      <div style="background:#f8fafc;padding:15px;border-radius:8px">
        <p><b>Meilleurs scores :</b> ${best}</p>
        <p><b>Session :</b> ${escapeHtml(startStr)} → ${escapeHtml(dateStr)}</p>
      </div>
      <p>Rappel : en coréen, le prédicat se place généralement à la fin, et les particules <b>이/가</b> et <b>을/를</b> indiquent le rôle des noms.</p>
      <p><b>화이팅 !</b></p>
    </div>`;

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });

    await transporter.sendMail({
      from: `"Korean Homework" <${GMAIL_USER}>`,
      to: teacherEmail,
      subject: `Particules 이/가·을/를 — ${studentName} — bilan de session — ${dateStr}`,
      html: teacherHtml
    });

    await transporter.sendMail({
      from: `"Korean Homework" <${GMAIL_USER}>`,
      to: studentEmail,
      subject: `안녕 ${studentName} ! Ton bilan de coréen 🇰🇷`,
      html: studentHtml
    });

    return json(200, { ok: true });
  } catch (error) {
    console.error('[send-results-particules] ERROR', error);
    return json(500, { ok: false, reason: 'SEND_FAILED' });
  }
};
