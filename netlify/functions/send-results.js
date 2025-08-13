// 이 파일은 Netlify 서버에서 실행되는 백엔드 코드입니다.
// 학생의 시험 결과를 이메일로 전송하는 역할을 합니다.
const nodemailer = require('nodemailer');

exports.handler = async (event, context) => {
  // HTTP 메소드가 POST가 아니면 에러를 반환합니다.
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    
    // 이메일 전송을 위한 transporter 설정 (Gmail 예시)
    // Netlify 환경 변수에서 이메일 계정 정보를 가져옵니다.
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    // --- 이메일 본문(HTML) 생성 ---
    
    // 상세 결과 테이블의 각 행(row)을 생성합니다.
    // 이 부분이 기존 코드에서 누락되었을 가능성이 높습니다.
    const resultsRows = data.details.map((item, index) => `
      <tr style="background-color: ${index % 2 === 0 ? '#f9f9f9' : '#ffffff'};">
        <td style="padding: 8px; border: 1px solid #ddd;">${index + 1}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.type.replace('_', ' ')}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.question}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.userAnswer || '(vide)'}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.isCorrect ? '✔' : '✖'}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.attempts}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.details.audioPlays}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.details.hint1Used ? 'Oui' : 'Non'}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.details.hint2Used ? 'Oui' : 'Non'}</td>
      </tr>
    `).join('');

    // 녹음 파일이 있는 경우, 첨부 파일 목록을 생성합니다.
    const attachments = data.details
      .map((item, index) => {
        if (item.details.recordedAudio) {
          // Base64 데이터 URI에서 실제 데이터 부분만 추출합니다.
          const base64Data = item.details.recordedAudio.split(';base64,').pop();
          return {
            filename: `enregistrement_Q${index + 1}_${data.studentName}.webm`,
            content: base64Data,
            encoding: 'base64',
          };
        }
        return null;
      })
      .filter(Boolean); // null 값을 제거합니다.

    // 전체 이메일 HTML 구조
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: sans-serif; }
          table { border-collapse: collapse; width: 100%; }
          th, td { text-align: left; padding: 8px; border: 1px solid #ddd; }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <h1>Résultats du test de coréen</h1>
        <p><strong>Élève:</strong> ${data.studentName}</p>
        <p><strong>Date:</strong> ${new Date(data.submissionDate).toLocaleString('fr-FR')}</p>
        <p><strong>Temps total:</strong> ${Math.floor(data.totalTime / 60)}m ${data.totalTime % 60}s</p>
        <p><strong>Score:</strong> ${data.score} / ${data.totalQuestions}</p>
        <hr>
        <h2>Détails des réponses</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Type</th>
              <th>Question</th>
              <th>Réponse élève</th>
              <th>OK?</th>
              <th>Tentatives</th>
              <th>Écoutes</th>
              <th>Indice 1</th>
              <th>Indice 2</th>
            </tr>
          </thead>
          <tbody>
            ${resultsRows}
          </tbody>
        </table>
        <hr>
        <p>* Certains clients e-mail ne permettent pas la lecture audio intégrée. Les fichiers sont joints en pièces jointes.</p>
      </body>
      </html>
    `;

    // 이메일 옵션 설정
    await transporter.sendMail({
      from: `"Résultats d'exercice" <${process.env.GMAIL_USER}>`,
      to: process.env.RECIPIENT_EMAIL,
      subject: `Nouveau résultat de test de ${data.studentName}`,
      html: emailHtml,
      attachments: attachments, // 녹음 파일 첨부
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Résultats envoyés avec succès' }),
    };
  } catch (error) {
    console.error("Erreur lors de l'envoi de l'e-mail:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Échec de l'envoi de l'e-mail." }),
    };
  }
};
