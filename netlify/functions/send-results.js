// netlify/functions/send-results.js
const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    const payload = JSON.parse(event.body || '{}');
    const {
      studentName = 'Élève',
      startTime,
      endTime,
      totalTimeSeconds = 0,
      questions = []
    } = payload;

    // 첨부(녹음) 구성: 용량 보호 (예: 개별 파일 3MB 초과 시 제외)
    const attachments = [];
    questions.forEach(q=>{
      if (q.recording && q.recording.base64) {
        const buf = Buffer.from(q.recording.base64, 'base64');
        const maxBytes = 3 * 1024 * 1024; // 3MB 제한 예시
        if (buf.length <= maxBytes) {
          attachments.push({
            filename: q.recording.filename || `rec_q${q.number||'X'}.webm`,
            content: buf,
            contentType: q.recording.mimeType || 'audio/webm',
            cid: `recq${q.number}@inline` // 이메일 본문에서 cid로 참조 가능(지원하는 클라이언트 한정)
          });
        }
      }
    });

    // HTML 본문: 문항 번호, 원문(불/한), 학생답, 정답여부, 듣기/힌트 카운트
    const rows = questions.map(q=>{
      const answered = q.userAnswer ? q.userAnswer : '<i>(vide)</i>';
      const ok = q.isCorrect ? '✔️' : '—';
      const audioCell = q.recording && q.recording.base64
        ? `
        <div style="margin-top:6px">
          <b>Enregistrement élève:</b><br/>
          <!-- 일부 클라이언트에서만 재생 가능 -->
          <audio controls src="cid:recq${q.number}@inline"></audio>
          <div style="font-size:12px;color:#666">Si l'audio ne s'affiche pas, ouvrez la pièce jointe: ${q.recording.filename}</div>
        </div>`
        : `<div style="font-size:12px;color:#666">Aucun enregistrement</div>`;

      return `
      <tr>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.number}</td>
        <td style="border:1px solid #eee;padding:6px">${q.fr}</td>
        <td style="border:1px solid #eee;padding:6px">${q.ko}</td>
        <td style="border:1px solid #eee;padding:6px">${answered}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${ok}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.listenCount||0}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.hint1Count||0}</td>
        <td style="border:1px solid #eee;padding:6px;text-align:center">${q.hint2Count||0}</td>
      </tr>
      <tr>
        <td colspan="8" style="border:1px solid #eee;padding:6px;background:#fafafa">
          ${audioCell}
        </td>
      </tr>`;
    }).join('');

    const mins = Math.floor(totalTimeSeconds/60);
    const secs = totalTimeSeconds%60;

    const html = `
    <div style="font-family:Arial,sans-serif">
      <h2>Résultats du test de coréen</h2>
      <p><b>Élève:</b> ${escapeHtml(studentName)}</p>
      <p><b>Début:</b> ${escapeHtml(String(startTime))}<br/>
         <b>Fin:</b> ${escapeHtml(String(endTime))}<br/>
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
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#666;font-size:12px;margin-top:10px">
        * Certains clients e-mail ne permettent pas la lecture audio intégrée. Les fichiers sont joints en pièces jointes.
      </p>
    </div>`;

    // 메일 전송
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: process.env.MAIL_TO, // 선생님 메일 (혹은 payload에 teacherEmail을 넣어도 됨)
      subject: `Résultats – ${studentName} – ${new Date().toLocaleString('fr-FR')}`,
      html,
      attachments
    });

    return { statusCode: 200, body: JSON.stringify({ message: 'OK' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ message: err.message }) };
  }
};

function escapeHtml(str=''){
  return str.replace(/[&<>"']/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s]));
}
