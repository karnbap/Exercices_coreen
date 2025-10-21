// netlify/functions/send-results.js (final)
// 결과 이메일 전송 (학생 제출 → 선생님 메일)
// Node 18+

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  const CORS = { 'Access-Control-Allow-Origin': '*' };
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok:false, reason:'METHOD_NOT_ALLOWED' }) };

    const body = JSON.parse(event.body || '{}');
    const { assignmentId, studentName, studentEmail, answers, audioBase64, audioFilename } = body;

    const { GMAIL_USER, GMAIL_APP_PASSWORD, RECIPIENT_EMAIL } = process.env;
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !RECIPIENT_EMAIL) {
      console.warn('[send-results] MISSING_ENV', { GMAIL_USER:!!GMAIL_USER, GMAIL_APP_PASSWORD:!!GMAIL_APP_PASSWORD, RECIPIENT_EMAIL:!!RECIPIENT_EMAIL });
      return { statusCode:500, headers:{ ...CORS, 'Content-Type':'application/json; charset=utf-8' }, body: JSON.stringify({ ok:false, reason:'MISSING_ENV' }) };
    }

    // Test A0_A1 전용 처리 (대소문자 무시)
    if ((assignmentId||'').toString().toLowerCase() === 'test_a0_a1' || (assignmentId||'').toString().toLowerCase() === 'test_a0-a1') {
      // 간단 채점(실제 정답/로직은 필요에 맞게 수정)
      function evaluateTestA0A1(answers = {}) {
        const expected = { q1: '안녕하세요', q2: '감사합니다', q3: '이름이 뭐예요?' };
        let score = 0, total = Object.keys(expected).length, feedback = [];
        for (const k of Object.keys(expected)) {
          const got = (answers[k]||'').toString().trim();
          const ok = got && got.toLowerCase() === expected[k].toLowerCase();
          if (ok) score++;
          feedback.push({ q:k, ok, got, expected: expected[k] });
        }
        return { score, total, percent: Math.round((score/total)*100), feedback };
      }

      const evaluation = evaluateTestA0A1(answers || {});

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
      });

      // 메일 제목은 메일 헤더에선 볼드가 적용되지 않음 — 본문에서 강조(bold) 처리
      const subject = `Test A0–A1 결과 — ${studentName || '학생'} — ${evaluation.percent}%`;
      const htmlBody = `
        <div style="font-family:Arial,Helvetica,sans-serif; max-width:680px;">
          <h2><b>Test A0–A1 결과</b></h2>
          <p><b>학생:</b> ${escapeHtml(studentName || '이름 없음')}</p>
          <p><b>학생 이메일:</b> ${escapeHtml(studentEmail || '없음')}</p>
          <p><b>점수:</b> ${evaluation.score}/${evaluation.total} (${evaluation.percent}%)</p>
          <h3>채점 상세</h3>
          <ul>
            ${evaluation.feedback.map(f => `<li style="margin-bottom:8px;padding:8px;background:${f.ok? '#e6ffed':'#fff0f0'};border-radius:4px;"><b>${f.q}</b>: ${f.ok? '정답':'오답'}<br>학생 답: ${escapeHtml(f.got||'')} ${f.ok? '': `<br>정답: ${escapeHtml(f.expected)}`}</li>`).join('')}
          </ul>
        </div>
      `;

      const mailOptions = {
        from: `"Korean Homework" <${GMAIL_USER}>`,
        to: RECIPIENT_EMAIL,
        subject,
        html: htmlBody,
        attachments: audioBase64 ? [{
          filename: audioFilename || `${(studentName||'student').replace(/\s+/g,'_')}_recording.webm`,
          content: Buffer.from(audioBase64, 'base64'),
          contentType: 'audio/webm'
        }] : []
      };

      const info = await transporter.sendMail(mailOptions);

      return { statusCode:200, headers:{ ...CORS, 'Content-Type':'application/json; charset=utf-8' }, body: JSON.stringify({ ok:true, evaluation, mailInfo: info }) };
    }

    // 기존(기본) 처리 로직은 그대로 유지
    // ...existing code...
    return { statusCode:200, headers:CORS, body: JSON.stringify({ ok:true }) };

  } catch (err) {
    console.error('[send-results] EX', err);
    return { statusCode:500, headers:{ 'Content-Type':'application/json; charset=utf-8' }, body: JSON.stringify({ ok:false, reason:'EXCEPTION', message: err.message }) };
  }
};

// 간단 HTML 이스케이프 (XSS 방지)
function escapeHtml(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
