// netlify/functions/send-results.js
// 결과 이메일 전송 (학생 제출 → 선생님 메일)
// Node 18 이상

const nodemailer = require("nodemailer");

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body || "{}");

    // --- 점수 계산 유틸 ---
    function avg(arr) {
      if (!Array.isArray(arr) || !arr.length) return 0;
      const s = arr.map(Number).filter(n => Number.isFinite(n));
      return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
    }
    function computeFallbackScores(payload) {
      const qs = Array.isArray(payload?.questions) ? payload.questions : [];
      const total = qs.length || 0;
      const koOK = qs.filter(q => q?.isCorrectKo === true).length;
      const frOK = qs.filter(q => q?.isCorrectFr === true).length;
      const pron = qs.map(q => q?.pronunciation?.accuracy).filter(n => typeof n === "number");
      const koScore = total ? Math.round(100 * koOK / total) : 0;
      const frScore = total ? Math.round(100 * frOK / total) : 0;
      const pronScore = pron.length ? Math.round(100 * avg(pron)) : 0;
      const overall = Math.round((koScore + frScore) / 2);
      return { ko: koScore, fr: frScore, pron: pronScore, overall };
    }
    function pickOverall(payload) {
      const cand = [
        payload?.categoryScores?.overall,
        payload?.overall,
        payload?.score
      ].map(Number).find(n => Number.isFinite(n));
      if (Number.isFinite(cand)) return Math.round(cand);
      return computeFallbackScores(payload).overall;
    }

    // --- 메일 제목 생성 ---
    const name = (payload?.studentName || "N/A").trim();
    const title = (payload?.assignmentTitle || "Exercice").trim();
    const overall = pickOverall(payload);
    const dateStr = new Date(payload?.endTime || Date.now()).toLocaleString("fr-FR", { hour12: false });
    const subject = `Résultats ${overall}/100 – ${title} – ${name} (${dateStr})`;

    // --- 메일 본문 (간단 텍스트) ---
    let body = `Résultats de l’exercice\n\n`;
    body += `Nom: ${name}\n`;
    body += `Exercice: ${title}\n`;
    body += `Score global: ${overall}/100\n\n`;

    if (payload?.categoryScores) {
      body += `Détail:\n`;
      body += `- KO: ${payload.categoryScores.ko ?? "-"}\n`;
      body += `- FR: ${payload.categoryScores.fr ?? "-"}\n`;
      body += `- Prononciation: ${payload.categoryScores.pron ?? "-"}\n\n`;
    }

    // --- nodemailer SMTP 전송 (예: Gmail / Mailgun / 기타 SMTP) ---
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Pongdang Korean" <${process.env.SMTP_USER}>`,
      to: process.env.RESULTS_RECEIVER || "Lapeace29@gmail.com",
      subject,
      text: body,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (e) {
    console.error(e);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(e) }),
    };
  }
};
