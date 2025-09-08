// /.netlify/functions/send-results.js
// Node 18+
// 필요 env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL, TO_EMAIL
const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return json({ error: 'Method Not Allowed' }, 405);
    }

    const payload = JSON.parse(event.body || '{}');
    const {
      studentName = 'Élève',
      startTime,
      endTime,
      totalTimeSeconds = 0,
      questions = [],
      assignmentTitle = 'Exercice de coréen',
      assignmentTopic = '',
      assignmentSummary = [],
      gradingMessage,            // (옵션) 클라 제공
      categoryScores             // (옵션) { ko, fr, pron, overall }
    } = payload;

    // -------- 서버 집계 (클라 미제공 대비) --------
    const graded = questions.filter(q => typeof q.isCorrect === 'boolean');
    const correct = graded.filter(q => q.isCorrect).length;
    const overall = categoryScores?.overall ?? (graded.length ? Math.round((correct / graded.length) * 100) : 0);

    const totalQ = questions.length || 0;
    const koCorrectCount = questions.filter(q => q.isCorrectKo).length;
    const frCorrectCount = questions.filter(q => q.isCorrectFr).length;
    const koScore = categoryScores?.ko ?? (totalQ ? Math.round((koCorrectCount / totalQ) * 100) : 0);
    const frScore = categoryScores?.fr ?? (totalQ ? Math.round((frCorrectCount / totalQ) * 100) : 0);

    const pronVals = questions
      .map(q => q?.pronunciation?.accuracy)
      .filter(x => typeof x === 'number' && isFinite(x));
    const pronScore = categoryScores?.pron ?? (pronVals.length ? Math.round((pronVals.reduce((a,b)=>a+b,0)/pronVals.length)*100) : 0);

    // 서버에서도 동일 기준 메시지 산출(클라 미제공 대비)
    const gm = gradingMessage || serverGetGradingMessage(overall);

    // 발음 요약(평균/85% 미만/자주 태그)
    const pronunItems = questions
      .map(q => ({ n: q.number, p: q.pronunciation }))
      .filter(x => x.p && typeof x.p.accuracy === 'number');

    const avgAcc = pronunItems.length
      ? Math.round((pronunItems.reduce((s,x)=>s+(x.p.accuracy||0),0) / pronunItems.length) * 100)
      : null;

    const below = pronunItems.filter(x => (x.p.accuracy||0) < 0.85).map(x => x.n);
    const tagCount = {};
    pronunItems.forEach(x => (x.p.tags||[]).forEach(t => tagCount[t]=(tagCount[t]||0)+1));
    const topTags = Object.entries(tagCount).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t,c])=>`${t} ×${c}`);

    const html = buildEmailHtml({
      studentName, startTime, endTime, totalTimeSeconds,
      questions, assignmentTitle, assignmentTopic, assignmentSummary,
      overall, koScore, frScore, pronScore,
      gradedCount: graded.length, correctCount: correct,
      avgAcc, below, topTags, gm
    });

    const attachments = buildAttachments(questions);
    const transporter = await transportFromEnv();
    const info = await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: process.env.TO_EMAIL,
      subject: `Résultats – ${studentName} – ${assignmentTitle} – KO:${koScore}/100 FR:${frScore}/100 Pron:${pronScore}/100`,
      html,
      text: stripHtml(html),
      attachments
    });

    return json({ ok: true, messageId: info.messageId });

  } catch (e) {
    console.error('send-results error:', e);
    return json({ error: String(e?.message || e) }, 500);
  }
};

// ---------- helpers ----------
function transportFromEnv(){
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP env not set (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS)');
  }
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
  return Promise.resolve(nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  }));
}

function buildAttachments(questions=[]) {
  const out = [];
  questions.forEach((q, i) => {
    const rec = q && q.recording;
    if (!rec || !rec.base64) return;
    const b = Buffer.from(rec.base64, 'base64');
    const filename = rec.filename || `q${q.number || i+1}.webm`;
    const mimeType = rec.mimeType || 'audio/webm';
    out.push({ filename, content: b, contentType: mimeType, cid: `rec-${i}` });
  });
  return out;
}

function buildEmailHtml(ctx) {
  const {
    studentName, startTime, endTime, totalTimeSeconds,
    questions, assignmentTitle, assignmentTopic, assignmentSummary,
    overall, koScore, frScore, pronScore,
    gradedCount, correctCount, avgAcc, below, topTags, gm
  } = ctx;

  const mins = Math.floor((totalTimeSeconds || 0) / 60);
  const secs = Math.round((totalTimeSeconds || 0) % 60);

  const summaryList = Array.isArray(assignmentSummary) ? assignmentSummary : String(assignmentSummary||'').split(/\n+/).filter(Boolean);
  const summaryHtml = summaryList.length
    ? `<ul style="margin:8px 0 0 18px;padding:0">${summaryList.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul>`
    : '';

  const topPronun = (avgAcc != null || (below?.length) || (topTags?.length))
    ? `<div style="margin-top:8px;font-size:14px;color:#0a4">
         <b>Prononciation</b> — moyenne ${avgAcc != null ? avgAcc+'%' : '-'}
         ${below?.length ? ` · <span style="color:#a00">en-dessous de 85%: #${below.join(', ')}</span>` : ''}
         ${topTags?.length ? ` · erreurs fréquentes: ${topTags.join(', ')}` : ''}
       </div>`
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
      const tags = (q.pronunciation.tags || []).slice(0,2).join(', ');
      pronunCell = `<b>${p}%</b>${tags ? ` <span style="color:#666">| ${escapeHtml(tags)}</span>` : ''}`;
    }

    const friendly = (q.pronunciation?.friendly || []).slice(0,2)
      .map(m => `• ${escapeHtml(m.fr)} / ${escapeHtml(m.ko)}`).join('<br/>');
    const friendlyHtml = friendly
      ? `<div style="margin-top:6px;font-size:12px;color:#444">${friendly}</div>`
      : '';

    const audioHtml = q?.recording?.base64
      ? `<div style="margin-top:6px"><b>Enregistrement élève:</b><br/><div style="font-size:12px;color:#666">* Pièce jointe: ${escapeHtml(q.recording.filename || '')} ${q.recording.duration ? '('+q.recording.duration+'s)' : ''}</div></div>`
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

  // ✅ 분리 스코어 보드
  const splitHtml = `
    <div style="margin-top:6px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
      <span style="background:#e7f8ee;border:1px solid #9be4b8;border-radius:9999px;padding:4px 10px">KO ${koScore}/100</span>
      <span style="background:#e7f8ee;border:1px solid #9be4b8;border-radius:9999px;padding:4px 10px">FR ${frScore}/100</span>
      <span style="background:#e7f8ee;border:1px solid #9be4b8;border-radius:9999px;padding:4px 10px">Pron ${pronScore}/100</span>
    </div>`;

  const html = `
    <div style="font-family:Arial, sans-serif">
      <h2 style="margin:0 0 8px 0">${escapeHtml(assignmentTitle)}</h2>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px">
        <div><b>Thème / 주제:</b> ${escapeHtml(assignmentTopic || '-')}</div>
        ${summaryHtml}
        ${topPronun}
      </div>

      <div style="margin-top:10px">
        <p style="margin:6px 0">
          <b>Élève:</b> ${escapeHtml(studentName)}<br/>
          <b>Début:</b> ${escapeHtml(String(startTime || ''))} ·
          <b>Fin:</b> ${escapeHtml(String(endTime || ''))} ·
          <b>Temps total:</b> ${mins}m ${secs}s
        </p>
        <div style="background:#f0f4f8; padding:12px; border-radius:8px; margin:10px 0; text-align:center;">
          <h3 style="margin:0; font-size:22px;">Score (KO+FR): ${overall} / 100</h3>
          <p style="margin:6px 0 0; font-size:14px; color:#333;">(${correctCount} / ${gradedCount} bonnes réponses)</p>
          ${splitHtml}
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

function serverGetGradingMessage(score){
  const s = Number(score) || 0;
  if (s === 100) return { fr:"Parfait absolu ! 👑🎉 Génie confirmé !", ko:"완벽 그 자체! 👑🎉 천재 인증!", emoji:"👑", score:s };
  if (s >= 80)  return { fr:"Très bien joué ! 👍 Presque un maître !", ko:"아주 잘했어요! 👍 이 정도면 거의 마스터!", emoji:"👏", score:s };
  if (s >= 60)  return { fr:"Pas mal du tout ! 😎 Encore un petit effort et c’est le top !", ko:"꽤 잘했어요! 😎 조금만 더 가면 최고!", emoji:"✅", score:s };
  return { fr:"Allez, un petit café et on repart ! ☕", ko:"자, 커피 한 잔 하고 다시 가자! ☕💪", emoji:"☕", score:s };
}

function escapeHtml(s=''){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
function stripHtml(s=''){
  return s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
function json(obj, status=200){
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}
