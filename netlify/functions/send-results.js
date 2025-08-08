// 이메일 전송을 위한 nodemailer 모듈을 가져옵니다.
const nodemailer = require('nodemailer');

// Netlify 함수의 기본 핸들러
exports.handler = async function(event, context) {
    // POST 요청이 아니면 에러를 반환하고 함수를 종료합니다.
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 클라이언트(웹페이지)에서 보낸 학생 데이터를 파싱합니다.
        const studentData = JSON.parse(event.body);
        const { studentName, questions, startTime } = studentData;

        // Netlify 환경 변수에서 이메일 계정 정보를 안전하게 가져옵니다.
        // 이 변수들은 Netlify 대시보드에서 설정해야 합니다.
        const myEmail = process.env.GMAIL_USER;
        const myPassword = process.env.GMAIL_APP_PASSWORD;
        const recipientEmail = process.env.RECIPIENT_EMAIL; // 받는 사람 이메일 주소

        // Gmail SMTP 서버를 사용하기 위한 transporter 객체를 설정합니다.
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: myEmail,
                pass: myPassword,
            },
        });

        // --- [BUG FIX] 안전하게 질문 데이터를 정렬합니다. ---
        const safeQuestions = Array.isArray(questions) ? questions : [];
        safeQuestions.sort((a, b) => (a?.id || 0) - (b?.id || 0));
        // ----------------------------------------------------

        // --- [NEW] 총 걸린 시간 계산 ---
        const endTime = new Date();
        const durationInSeconds = startTime ? Math.round((endTime - new Date(startTime)) / 1000) : 0;
        const minutes = Math.floor(durationInSeconds / 60);
        const seconds = durationInSeconds % 60;
        const durationFormatted = `${minutes} min ${seconds} sec`;
        // ------------------------------------

        // 정답과 오답 개수를 계산합니다.
        const correctAnswers = safeQuestions.filter(q => q.isCorrect === true).length;
        const totalQuestions = safeQuestions.length;
        const score = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;

        // 이메일 본문을 HTML 형식으로 만듭니다.
        const emailBody = `
            <h1>📝 Exercice d'écoute - Résultats</h1>
            <p><strong>Étudiant(e) :</strong> ${studentName || 'Non spécifié'}</p>
            <p><strong>Date de début :</strong> ${startTime ? new Date(startTime).toLocaleString('fr-FR') : 'Non spécifié'}</p>
            <p><strong>Temps total :</strong> ${durationFormatted}</p>
            <hr>
            <h2>Score : ${score.toFixed(2)}% (${correctAnswers} / ${totalQuestions})</h2>
            <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 100%;">
                <thead>
                    <tr style="background-color: #f2f2f2;">
                        <th>#</th>
                        <th>Question (Coréen)</th>
                        <th>Réponse de l'étudiant(e)</th>
                        <th>Écoutes 🎧</th>
                        <th>Statut</th>
                    </tr>
                </thead>
                <tbody>
                    ${safeQuestions.map(q => `
                        <tr style="background-color: ${q.isCorrect ? '#e9fde9' : '#ffebee'};">
                            <td>${q.id}</td>
                            <td>${q.questionText || ''}</td>
                            <td>${q.userAnswer || '<em>(Pas de réponse)</em>'}</td>
                            <td>${q.listenCount || 0}</td>
                            <td>${q.isCorrect ? '✅ Correct' : '❌ Incorrect'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        // 이메일 옵션을 설정합니다.
        const mailOptions = {
            from: myEmail,
            to: recipientEmail, // 결과를 받을 이메일 주소
            subject: `[Résultats] Exercice d'écoute de ${studentName}`,
            html: emailBody,
        };

        // 설정한 옵션으로 이메일을 보냅니다.
        await transporter.sendMail(mailOptions);

        // 성공적으로 전송되면 200 상태 코드와 메시지를 반환합니다.
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Résultats envoyés avec succès !" }),
        };

    } catch (error) {
        // 에러가 발생하면 콘솔에 로그를 남기고 500 에러를 반환합니다.
        console.error("Erreur lors de l'envoi de l'e-mail:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Erreur lors de l'envoi de l'e-mail." }),
        };
    }
};
