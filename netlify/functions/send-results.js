// /netlify/functions/send-results.js
const nodemailer = require('nodemailer');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // --- Data Processing for Detailed Report ---
    const totalListens = data.questions.reduce((sum, q) => sum + q.listenCount, 0);
    const totalCorrect = data.questions.filter(q => q.isCorrect).length;
    const overallSuccessRate = (totalCorrect / data.questions.length) * 100;

    // Find top 5 most difficult questions (most wrong answers, then most attempts)
    const difficultQuestions = [...data.questions]
      .sort((a, b) => {
        if (b.wrongAnswers.length !== a.wrongAnswers.length) {
          return b.wrongAnswers.length - a.wrongAnswers.length;
        }
        return b.attemptCount - a.attemptCount;
      })
      .slice(0, 5)
      .filter(q => q.wrongAnswers.length > 0 || !q.isCorrect) // Only show questions they actually struggled with
      .map(q => `<li>Question #${q.id} (${q.wrongAnswers.length} erreur(s), ${q.attemptCount} tentative(s))</li>`)
      .join('');

    const questionsHtml = data.questions.map(q => {
      const successRate = q.attemptCount === 0 ? 'N/A' : `${(q.isCorrect ? 1 : 0)}/${q.attemptCount}`;
      const wrongAnswersList = q.wrongAnswers.length > 0
        ? `<ul>${q.wrongAnswers.map(wa => `<li><del>${wa}</del></li>`).join('')}</ul>`
        : '<em>(aucune)</em>';

      return `
        <tr style="border-bottom: 1px solid #eee; background-color: ${q.isCorrect ? '#f2fff2' : '#fff2f2'};">
          <td style="padding: 12px; text-align: center; font-weight: bold;">${q.id}</td>
          <td style="padding: 12px;">${q.questionText}</td>
          <td style="padding: 12px; text-align: center;">${q.listenCount}</td>
          <td style="padding: 12px; text-align: center;">${successRate} (${q.isCorrect ? 'Succès' : 'Échec'})</td>
          <td style="padding: 12px;">${wrongAnswersList}</td>
        </tr>
      `;
    }).join('');

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #333; line-height: 1.6; }
          .container { max-width: 800px; margin: auto; border: 1px solid #e0e0e0; padding: 25px; border-radius: 10px; background-color: #f9f9f9; }
          h1, h2 { color: #333; border-bottom: 2px solid #e0e0e0; padding-bottom: 10px; }
          h1 { font-size: 24px; }
          h2 { font-size: 20px; margin-top: 30px;}
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { padding: 12px; text-align: left; }
          th { background-color: #efefef; font-weight: bold; }
          tr:nth-child(even) { background-color: #ffffff; }
          .summary-box { background-color: #ffffff; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0; }
          .summary-box p { margin: 10px 0; font-size: 16px; }
          ul { padding-left: 20px; margin: 0; }
          li { margin-bottom: 5px; }
          del { color: #d9534f; text-decoration: none; border-bottom: 1px dotted #d9534f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Résultats détaillés du test de coréen</h1>
          
          <div class="summary-box">
            <p><strong>Étudiant :</strong> ${data.studentName}</p>
            <p><strong>Date :</strong> ${new Date(data.startTime).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}</p>
          </div>

          <h2>Résumé de la performance 📊</h2>
          <div class="summary-box">
            <p><strong>Taux de réussite global :</strong> ${overallSuccessRate.toFixed(1)}% (${totalCorrect} / ${data.questions.length} phrases)</p>
            <p><strong>Nombre total d'écoutes :</strong> ${totalListens} fois</p>
            ${difficultQuestions ? `
              <p><strong>Questions les plus difficiles (Top 5) :</strong></p>
              <ul>${difficultQuestions}</ul>
            ` : '<p><strong>Bravo, aucune difficulté majeure détectée !</strong></p>'}
          </div>

          <h2>Détails par question 📝</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Phrase correcte</th>
                <th>Écoutes</th>
                <th>Réussite / Tentatives</th>
                <th>Erreurs notées</th>
              </tr>
            </thead>
            <tbody>
              ${questionsHtml}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: `"Korean Pondant Résults" <${process.env.EMAIL_USER}>`,
      to: process.env.RECIPIENT_EMAIL,
      subject: `[Résultats] ${data.studentName} a terminé le test de coréen`,
      html: emailHtml,
    };

    await transporter.sendMail(mailOptions);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Résultats envoyés avec succès !' }),
    };

  } catch (error) {
    console.error('Error sending email:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Erreur lors de l\'envoi de l\'e-mail.', error: error.message }),
    };
  }
};
