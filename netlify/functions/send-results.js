// netlify/functions/send-results.js
const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // === 1) 환경변수 (Gmail) ===
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
    const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

    if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !RECIPIENT_EMAIL) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Missing env: GMAIL_USER / GMAIL_APP_PASSWORD / RECIPIENT_EMAIL' }),
      };
    }

    // === 2) 프런트에서 보낸 payload ===
    const payload = JSON.parse(event.body || '{}');
    const {
      studentName = 'Élève',
      startTime,
      endTime,
      totalTimeSeconds = 0,
      questions = [],
    } = payload;

    // === 3) 첨부파일(녹음) 구성 ===
    const attachments = [];
    questions.forEach((q) => {
      if (q?.recording?.base64) {
        const filename = q.recording.filename || `rec_q${q.number || 'X'}.webm`;
        const mimeType = q.recording.mimeType || 'audio/webm';
        const buf = Buffer.from(q.recording.base64, 'base64');
        attachments.push({
          filename,
          content: buf,
          contentType: mimeType,
          cid: `recq${q.number}@inline`,
        });
      }
    });

    // === 4) 메일 본문(HTML) 만들기 ===
    const mins = Math.floor(totalTimeSeconds / 60);
    const secs = Math.round(totalTimeSeconds % 60);

    // ✅ 수정됨: 서버에서 직접 점수 계산
    const correctCount = questions.filter(q => q.isCorrect).length;
    const totalGraded = questions.length;
    const score = totalGraded > 0 ? Math.round((correctCount / totalGraded) * 100) : 0;

    const rowHtml = questions.map((q) => {
      const answered = q.userAnswer ? escapeHtml(q.userAnswer) : '<i>(vide)</i>';
      const ok = q.isCorrect ? '✔️' : '❌';
      const audioHtml = q?.recording?.base64
        ? `<div style="margin-top:6px"><b>Enregistrement élève:</b><br/><div style="font-size:12px;color:#666">* Ouvrez la pièce jointe: ${escapeHtml(q.recording.filename || '')} (${q.recording.duration ? q.recording.duration + 's' : ''})</div></div>`
        : '';

      return `
        <tr>
          <td style="border:1px solid #eee;padding:6px;text-align:center">${q.number ?? ''}</td>
          <td style="border:1px solid #eee;padding:6px">${escapeHtml(q.fr || '')}</td>
          <td style="border:1px solid #eee;padding:6px">${escapeHtml(q.ko || '')}</td>
          <td style="border:1px solid #eee;padding:6px">${answered}</td>
          <td style="border:1px solid #eee;padding:6px;text-align:center">${ok}</td>
          <td style="border:1px solid #eee;padding:6px;text-align:center">${q.listenCount || 0}</td>
          <td style="border:1px solid #eee;padding:6px;text-align:center">${q.hint1Count || 0}</td>
          <td style="border:1px solid #eee;padding:6px;text-align:center">${q.hint2Count || 0}</td>
        </tr>
        ${audioHtml ? `<tr><td colspan="8" style="border:1px solid #eee;padding:6px;background:#fafafa">${audioHtml}</td></tr>` : ''}
      `;
    }).join('');

    const html = `
      <div style="font-family:Arial, sans-serif">
        <h2>Résultats du test de coréen</h2>
        <p><b>Élève:</b> ${escapeHtml(studentName)}</p>
        
        <!-- ✅ 수정됨: 총점 표시 섹션 추가 -->
        <div style="background:#f0f4f8; padding:15px; border-radius:8px; margin:15px 0; text-align:center;">
            <h3 style="margin:0; font-size:24px;">Score Final: ${score} / 100</h3>
            <p style="margin:5px 0 0; font-size:16px; color:#333;">(${correctCount} / ${totalGraded} bonnes réponses)</p>
        </div>

        <p><b>Début:</b> ${escapeHtml(String(startTime || ''))}<br/>
           <b>Fin:</b> ${escapeHtml(String(endTime || ''))}<br/>
           <b>Temps total:</b> ${mins}m ${secs}s
        </p>

        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <thead>
            <tr style="background:#f0f4f8">
              <th style="border:1px solid #eee;padding:6px">#</th>
              <th style="border:1px solid #eee;padding:6px">Français</th>
              <th style="border:1px solid #eee;padding:6px">Coréen</th>
              <th style="border:1px solid #eee;padding:6px">Réponse élève</th>
              <th style="border:1px solid #eee;padding:6px">OK?</th>
              <th style="border:1px solid #eee;padding:6px">Écoutes</th>
              <th style="border:1px solid #eee;padding:6px">Indice 1</th>
              <th style="border:1px solid #eee;padding:6px">Indice 2</th>
            </tr>
          </thead>
          <tbody>${rowHtml}</tbody>
        </table>
      </div>
    `;

    // === 5) Gmail SMTP 트랜스포트 ===
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    await transporter.sendMail({
      from: `Korean Pondant <${GMAIL_USER}>`,
      to: RECIPIENT_EMAIL,
      subject: `Résultats – ${studentName} – Score: ${score}/100`,
      html,
      attachments,
    });

    return { statusCode: 200, body: JSON.stringify({ message: 'OK' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ message: err.message }) };
  }
};

// 안전한 HTML 이스케이프
function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, (s) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[s]));
}
