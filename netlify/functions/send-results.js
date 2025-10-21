// netlify/functions/send-results.js (final)
// 결과 이메일 전송 (학생 제출 → 선생님 메일)
// Node 18+

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  const CORS = { 'Access-Control-Allow-Origin': '*' };
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok:false, reason:'METHOD_NOT_ALLOWED' }) };

    const body = JSON.parse(event.body || '{}');
    const { assignmentId, studentName, studentEmail, questions, startTime, endTime, totalTimeSeconds } = body;

    const { GMAIL_USER, GMAIL_APP_PASSWORD, RECIPIENT_EMAIL } = process.env;
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !RECIPIENT_EMAIL) {
      console.warn('[send-results] MISSING_ENV', { GMAIL_USER:!!GMAIL_USER, GMAIL_APP_PASSWORD:!!GMAIL_APP_PASSWORD, RECIPIENT_EMAIL:!!RECIPIENT_EMAIL });
      return { statusCode:500, headers:{ ...CORS, 'Content-Type':'application/json; charset=utf-8' }, body: JSON.stringify({ ok:false, reason:'MISSING_ENV' }) };
    }

    // Test A0_A1 전용 처리 (대소문자 무시)
    if ((assignmentId||'').toString().toLowerCase() === 'test_a0_a1' || (assignmentId||'').toString().toLowerCase() === 'test_a0-a1') {
      // A0-A1 테스트 결과 처리 함수
      function processTestResults() {
        // 테스트 완료 시각 정보
        const testDate = new Date(endTime || new Date()).toLocaleString('fr-FR', {
          year: 'numeric', month: 'long', day: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });

        // 시험 소요 시간 계산
        const duration = totalTimeSeconds ? `${Math.floor(totalTimeSeconds / 60)}분 ${totalTimeSeconds % 60}초` : '측정 불가';
        
        // 단계별 섹션 분리
        const listenReadQuestions = questions.filter(q => q.number >= 1 && q.number <= 5);
        const readAloneQuestions = questions.filter(q => q.number >= 6 && q.number <= 10);
        const vocabQuestion = questions.find(q => q.ko === '어휘 짝짓기 게임');
        const vocabScore = vocabQuestion ? vocabQuestion.userAnswer : 'N/A';
        
        const comprehensionQuestions = questions.filter(q => q.fr && q.fr.includes('Question de compréhension'));
        
        const listenSpeakQuestions = questions.filter(q => 
          q.ko && q.ko.includes('질문') && 
          typeof q.userAnswer === 'string' && 
          (q.userAnswer.includes('dictation') || q.userAnswer.includes('translation'))
        );
        
        // 각 녹음파일 추출
        const recordingsMap = new Map();
        questions.forEach(q => {
          if (q.recording && q.recording.base64) {
            recordingsMap.set(`recording_q${q.number}.webm`, {
              filename: `${studentName}_q${q.number}.webm`,
              content: Buffer.from(q.recording.base64, 'base64'),
              contentType: q.recording.mimeType || 'audio/webm'
            });
          }
        });
        
        // 첨부파일 배열 생성
        const attachments = Array.from(recordingsMap.values());
        
        // 이메일 HTML 템플릿 생성
        return {
          subject: `Test A0–A1 결과 — ${studentName || '학생'} — ${testDate}`,
          htmlBody: `
            <div style="font-family: Arial, Helvetica, sans-serif; max-width: 800px; margin: 0 auto;">
              <h1 style="color: #2563eb; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">
                <b>한국어 A0-A1 테스트 결과</b>
              </h1>
              
              <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <p><b>학생:</b> ${escapeHtml(studentName || '이름 없음')}</p>
                <p><b>이메일:</b> ${escapeHtml(studentEmail || '없음')}</p>
                <p><b>테스트 완료:</b> ${testDate}</p>
                <p><b>소요 시간:</b> ${duration}</p>
              </div>
              
              <!-- 1단계: 듣고 읽기 -->
              <h2 style="color: #4338ca; border-bottom: 1px solid #e5e7eb;">1단계: 듣고 읽기</h2>
              <div style="margin-left: 15px;">
                ${listenReadQuestions.map(q => `
                  <div style="margin-bottom: 15px; padding: 10px; border-left: 4px solid #93c5fd; background-color: #f0f9ff;">
                    <p><b>문제 ${q.number}:</b> ${escapeHtml(q.ko)}</p>
                    <p><i>불어:</i> ${escapeHtml(q.fr)}</p>
                    <p><b>듣기 횟수:</b> ${q.listenCount || 0}회</p>
                    ${q.recording ? 
                      `<p style="color: #059669;"><b>✓ 녹음 완료</b> (첨부파일 참조: ${studentName}_q${q.number}.webm)</p>` : 
                      `<p style="color: #dc2626;"><b>✗ 녹음 없음</b></p>`}
                  </div>
                `).join('')}
              </div>
              
              <!-- 2단계: 혼자 읽기 -->
              <h2 style="color: #4338ca; border-bottom: 1px solid #e5e7eb;">2단계: 혼자 읽기</h2>
              <div style="margin-left: 15px;">
                ${readAloneQuestions.map(q => `
                  <div style="margin-bottom: 15px; padding: 10px; border-left: 4px solid #93c5fd; background-color: #f0f9ff;">
                    <p><b>문제 ${q.number}:</b> ${escapeHtml(q.ko)}</p>
                    <p><i>불어:</i> ${escapeHtml(q.fr)}</p>
                    ${q.recording ? 
                      `<p style="color: #059669;"><b>✓ 녹음 완료</b> (첨부파일 참조: ${studentName}_q${q.number}.webm)</p>` : 
                      `<p style="color: #dc2626;"><b>✗ 녹음 없음</b></p>`}
                  </div>
                `).join('')}
              </div>
              
              <!-- 3단계: 어휘 짝짓기 -->
              <h2 style="color: #4338ca; border-bottom: 1px solid #e5e7eb;">3단계: 어휘 짝짓기</h2>
              <div style="margin-left: 15px; margin-bottom: 15px; padding: 10px; border-left: 4px solid #a5b4fc; background-color: #f5f3ff;">
                <p><b>점수:</b> ${vocabScore}</p>
              </div>
              
              <!-- 4단계: 이해력 -->
              <h2 style="color: #4338ca; border-bottom: 1px solid #e5e7eb;">4단계: 이해력</h2>
              <div style="margin-left: 15px;">
                ${comprehensionQuestions.map(q => `
                  <div style="margin-bottom: 15px; padding: 10px; border-left: 4px solid #a78bfa; background-color: #f5f3ff;">
                    <p><b>문제 ${q.number}:</b> ${escapeHtml(q.ko)}</p>
                    <p><i>정답:</i> ${escapeHtml(q.fr.replace('(Question de compréhension) ', ''))}</p>
                    <p><b>학생 답변:</b> ${escapeHtml(q.userAnswer || '(응답 없음)')}</p>
                  </div>
                `).join('')}
              </div>
              
              <!-- 5단계: 듣고 말하기 -->
              <h2 style="color: #4338ca; border-bottom: 1px solid #e5e7eb;">5단계: 듣고 말하기</h2>
              <div style="margin-left: 15px;">
                ${listenSpeakQuestions.map(q => {
                  let response = {};
                  try {
                    response = JSON.parse(q.userAnswer || '{}');
                  } catch (e) {
                    response = { dictation: '', translation: '', selfDictation: '' };
                  }
                  
                  return `
                    <div style="margin-bottom: 20px; padding: 12px; border-left: 4px solid #c084fc; background-color: #faf5ff;">
                      <p><b>문제 ${q.number}:</b> ${escapeHtml(q.ko.replace('(질문) ', ''))}</p>
                      <p><i>불어:</i> ${escapeHtml(q.fr.replace('(Question) ', ''))}</p>
                      
                      <div style="margin: 10px 0; padding: 8px; background-color: #f9fafb; border-radius: 4px;">
                        <p><b>a) 듣고 받아쓰기:</b> ${escapeHtml(response.dictation || '(응답 없음)')}</p>
                        <p><b>b) 번역:</b> ${escapeHtml(response.translation || '(응답 없음)')}</p>
                        <p><b>c) 자기 녹음 받아쓰기:</b> ${escapeHtml(response.selfDictation || '(응답 없음)')}</p>
                        ${q.recording ? 
                          `<p style="color: #059669;"><b>✓ 답변 녹음 완료</b> (첨부파일 참조: ${studentName}_q${q.number}.webm)</p>` : 
                          `<p style="color: #dc2626;"><b>✗ 답변 녹음 없음</b></p>`}
                      </div>
                      
                      <p><b>듣기 횟수:</b> ${q.listenCount || 0}회</p>
                    </div>
                  `;
                }).join('')}
              </div>
              
              <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 0.9rem; text-align: center;">
                자동 생성된 테스트 결과 보고서입니다.<br>
                모든 녹음 파일은 이메일에 첨부되어 있습니다.
              </p>
            </div>
          `,
          attachments
        };
      }

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
      });

      const result = processTestResults();
      
      const mailOptions = {
        from: `"Korean Homework" <${GMAIL_USER}>`,
        to: RECIPIENT_EMAIL,
        subject: result.subject,
        html: result.htmlBody,
        attachments: result.attachments
      };

      const info = await transporter.sendMail(mailOptions);
      
      return { statusCode:200, headers:{ ...CORS, 'Content-Type':'application/json; charset=utf-8' }, body: JSON.stringify({ ok:true }) };
    }

    // 기존(기본) 처리 로직은 그대로 유지
    return { statusCode:200, headers:CORS, body: JSON.stringify({ ok:true }) };

  } catch (err) {
    console.error('[send-results] ERROR', err);
    return { statusCode:500, headers:{ ...CORS, 'Content-Type':'application/json; charset=utf-8' }, body: JSON.stringify({ ok:false, reason:'SERVER_ERROR', message: err.message }) };
  }
};

// HTML 안전 출력을 위한 이스케이프 함수
function escapeHtml(s='') { 
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp',
    '<': '&lt',
    '>': '&gt',
    '"': '&quot',
    "'": '&#39;'
  }[c])); 
}
