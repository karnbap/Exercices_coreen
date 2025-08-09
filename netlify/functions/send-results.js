// netlify/functions/send-results.js
const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // === 1) 환경변수 (Gmail) ===
    const GMAIL_USER = process.env.GMAIL_USER;               // 예: your@gmail.com
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD; // 구글 '앱 비밀번호'
    const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;     // 선생님 수신 메일

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

    // === 3) 첨부파일(녹음) 구성 (용량 보호) ===
    const PER_FILE_LIMIT_BYTES = 3 * 1024 * 1024; // 3MB
    const TOTAL_LIMIT_BYTES = 18 * 1024 * 1024;   // 전체 18MB 정도로 제한(메일서버 한도 고려)
    let totalBytes = 0;

    const attachments = [];
    questions.forEach((q) => {
      if (q?.recording?.base64) {
        const filename = q.recording.filename || `rec_q${q.number || 'X'}.webm`;
        const mimeType = q.recording.mimeType || 'audio/webm';
        const buf = Buffer.from(q.recording.base64, 'base64');

        if (buf.length <= PER_FILE_LIMIT_BYTES && totalBytes + buf.length <= TOTAL_LIMIT_BYTES) {
          totalBytes += buf.length;
          attachments.push({
            filename,
            content: buf,
            contentType: mimeType,
            cid: `recq${q.number}@inline`, // 본문 <audio src="cid:..."> 시도용
          });
        }
      }
    });

    // === 4) 메일 본문(HTML) 만들기 ===
    const mins = Math.floor(totalTimeSeconds / 60);
    const secs = totalTimeSeconds % 60;

    const rowHtml = questions.map((q) => {
      const answered = q.userAnswer ? escapeHtml(q.userAnswer) : '<i>(vide)</i>';
      const ok = q.isCorrect ? '✔️' : '—';
      const audioHtml = q?.recording?.base64
        ? `
          <div style="margin-top:6px">
            <b>Enregistrement élève:</b><br/>
            <!-- 일부 클라이언트에서만 재생됨 -->
            <audio controls src="cid:recq${q.number}@inline"></audio>
            <div style="font-size:12px;color:#666">
              * Si l'audio ne s'affiche pas, ouvrez la pièce jointe: ${escapeHtml(q.recording.filename || '')}
              (${q.recording.duration ? q.recording.duration + 's' : ''})
            </div>
          </div>
        `
        : `<div style="font-size:12px;color:#666">Aucun enregistrement</div>`;

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
        <tr>
          <td colspan="8" style="border:1px solid #eee;padding:6px;background:#fafafa">${audioHtml}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <div style="font-family:Arial, sans-serif">
        <h2>Résultats du test de coréen</h2>
        <p><b>Élève:</b> ${escapeHtml(studentName)}</p>
        <p><b>Début:</b> ${escapeHtml(String(startTime || ''))}<br/>
           <b>Fin:</b> ${escapeHtml(String(endTime || ''))}<br/>
           <b>Temps total:</b> ${mins}m ${secs}s
        </p>

        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <thead>
            <tr style="background:#f0f4f8">
              <th style="border:1px solid #eee;padding:6px">#</th>
              <th style="border:1px solid #eee;padding:6px">Français (문장 원문)</th>
              <th style="border:1px solid #eee;padding:6px">Coréen (문장 원문)</th>
              <th style="border:1px solid #eee;padding:6px">Réponse élève</th>
              <th style="border:1px solid #eee;padding:6px">OK?</th>
              <th style="border:1px solid #eee;padding:6px">Écoutes</th>
              <th style="border:1px solid #eee;padding:6px">Indice 1</th>
              <th style="border:1px solid #eee;padding:6px">Indice 2</th>
            </tr>
          </thead>
          <tbody>${rowHtml}</tbody>
        </table>

        <p style="color:#666;font-size:12px;margin-top:10px">
          * Certains clients e-mail ne permettent pas la lecture audio intégrée. Les fichiers sont joints en pièces jointes.
        </p>
      </div>
    `;

    // === 5) Gmail SMTP 트랜스포트 ===
    // Gmail: SSL 포트 465 고정(가장 안정적). 앱 비밀번호 필수!
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // SSL
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    await transporter.sendMail({
      from: GMAIL_USER,
      to: RECIPIENT_EMAIL,
      subject: `Résultats – ${studentName} – ${new Date().toLocaleString('fr-FR')}`,
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
