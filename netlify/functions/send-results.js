// /.netlify/functions/send-results.js
// Node 18+
// 필요 ENV: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL, TO_EMAIL
const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  try {
    // CORS(선택) — 같은 도메인이면 문제 없지만, 서브도메인/프리뷰 대비
    if (event.httpMethod === 'OPTIONS') {
      return jres({ ok: true }, 200, true);
    }
    if (event.httpMethod !== 'POST') {
      return jres({ ok: false, error: 'Method Not Allowed' }, 405, true);
    }

    const payload = safeJson(event.body);
    const {
      studentName = 'Élève',
      startTime,
      endTime,
      totalTimeSeconds = 0,
      questions = [],
      assignmentTitle = 'Exercice de coréen',
      assignmentTopic = '',
      assignmentSummary = [],
      gradingMessage // (옵션) 클라이언트에서 보낸 메시지
    } = payload;

    // ----- 점수 집계 -----
    const graded = questions.filter(q => typeof q?.isCorrect === 'boolean');
    const correct = graded.filter(q => q.isCorrect).length;
    const score = graded.length ? Math.round((correct / graded.length) * 100) : 0;

    // 클라 미제공 대비 서버에서도 동일 기준 메시지 생성
    const gm = gradingMessage || serverGetGradingMessage(score);

    // 발음 요약 (평균)
    const pronArr = (questions || []).map(q => q?.pronunciation).filter(Boolean);
    const avgAcc = pronArr.length
      ? Math.round(pronArr.reduce((s, p) => s + (p.accuracy || 0), 0) / pronArr.length * 100)
      : null;

    // ----- SMTP Transport -----
    const transporter = await transportFromEnv(); // 여기서 ENV 검증

    // ----- 본문/첨부 -----
    const html = buildEmailHtml({
      studentName, startTime, endTime, totalTimeSeconds,
      questions, assignmentTitle, assignmentTopic, assignmentSummary,
      score, gradedCount: graded.length, correctCount: correct,
      avgAcc, gm
    });
    const attachments = buildAttachments(questions);

    // ----- 메일 발송 -----
    const info = await transporter.sendMail({
      from: mustEnv('FROM_EMAIL'),
      to: mustEnv('TO_EMAIL'),
      subject: `Résultats – ${studentName} – ${assignmentTitle} – Score: ${score}/100`,
      html,
      text: stripHtml(html),
      attachments
    });

    return jres({ ok: true, messageId: info.messageId }, 200, true);

  } catch (e) {
    // 항상 JSON 에러(+CORS)로 반환 → 클라에서 바로 원인 확인 가능
    return jres({
      ok: false,
      error: String(e?.message || e),
      // 민감정보 제외한 디버그 힌트
      hint: {
        host: process.env.SMTP_HOST || null,
        port: process.env.SMTP_PORT || null,
        secure: autoSecurePreview(process.env.SMTP_PORT, process.env.SMTP_SECURE),
        from: process.env.FROM_EMAIL ? 'set' : 'missing',
        to: process.env.TO_EMAIL ? 'set' : 'missing'
      }
    }, 500, true);
  }
};

// ---------- helpers ----------

function safeJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

function mustEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
}

// 포트-보안 자동 판별: SMTP_SECURE 지정 없으면 465→true, 그 외→false
function autoSecurePreview(port, secureEnv) {
  if (String(secureEnv).toLowerCase() === 'true') return true;
  if (String(secureEnv).toLowerCase() === 'false') return false;
  return Number(port) === 465; // 일반적 관례
}

async function transportFromEnv() {
  const host = mustEnv('SMTP_HOST');
  const port = Number(mustEnv('SMTP_PORT'));
  const user = mustEnv('SMTP_USER');
  const pass = mustEnv('SMTP_PASS');
  const secure = autoSecurePreview(port, process.env.SMTP_SECURE);

  return nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass }
  });
}

function buildAttachments(questions = []) {
  const out = [];
  questions.forEach((q, i) => {
    const rec = q?.recording;
    if (!rec?.base64) return;
    out.push({
      filename: rec.filename || `q${q.number || i + 1}.webm`,
      content: Buffer.from(rec.base64, 'base64'),
      contentType: rec.mimeType || 'audio/webm'
    });
  });
  return out;
}

function buildEmailHtml(ctx) {
  const {
    studentName, startTime, endTime, totalTimeSeconds,
    questions, assignmentTitle, assignmentTopic, assignmentSummary,
    score, gradedCount, correctCount, avgAcc, gm
  } = ctx;

  const mins = Math.floor((totalTimeSeconds || 0) / 60);
  const secs = Math.round((totalTimeSeconds || 0) % 60);

  const summaryList = Array.isArray(assignmentSummary)
    ? assignmentSummary
    : String(assignmentSummary || '').split(/\n+/).filter(Boolean);

  const summaryHtml = summaryList.length
    ? `<ul style="margin:8px 0 0 18px;padding:0">${summaryList.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`
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
      const tags = (q.pronunciation.tags || []).slice(0, 2).join(', ');
      pronunCell = `<b>${p}%</b>${tags ? ` <span style="color:#666">| ${escapeHtml(tags)}</span>` : ''}`;
    }

    const friendly = (q.pronunciation?.friendly || []).slice(0, 2)
      .map(m => `• ${escapeHtml(m.fr)} / ${escapeHtml(m.ko)}`).join('<br/>');
    const friendlyHtml = friendly
      ? `<div style="margin-top:6px;font-size:12px;color:#444">${friendly}</div>`
      : '';

    const audioHtml = q?.recording?.base64
      ? `<div style="margin-top:6px"><b>Enregistrement élève:</b><br/><div style="font-size:12px;color:#666">* Pièce jointe: ${escapeHtml(q.recording.filename || '')} ${q.recording.duration ? '(' + q.recording.duration + 's)' : ''}</div></div>`
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

  const html = `
    <div style="font-family:Arial, sans-serif">
      <h2 style="margin:0 0 8px 0">${escapeHtml(assignmentTitle)}</h2>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px">
        <div><b>Thème / 주제:</b> ${escapeHtml(assignmentTopic || '-')}</div>
        ${summaryHtml}
        <div style="margin-top:8px;font-size:14px;color:#0a4"><b>Prononciation</b> — moyenne ${avgAcc != null ? (avgAcc + '%') : '-'}</div>
      </div>

      <div style="margin-top:10px">
        <p style="margin:6px 0">
          <b>Élève:</b> ${escapeHtml(studentName)}<br/>
          <b>Début:</b> ${escapeHtml(String(startTime || ''))} ·
          <b>Fin:</b> ${escapeHtml(String(endTime || ''))} ·
          <b>Temps total:</b> ${mins}m ${secs}s
        </p>
        <div style="background:#f0f4f8; padding:12px; border-radius:8px; margin:10px 0; text-align:center;">
          <h3 style="margin:0; font-size:22px;">Score Final: ${score} / 100</h3>
          <p style="margin:6px 0 0; font-size:14px; color:#333;">(${correctCount} / ${gradedCount} bonnes réponses)</p>
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

function serverGetGradingMessage(score) {
  const s = Number(score) || 0;
  if (s === 100) return { fr: "Parfait absolu ! 👑🎉 Génie confirmé !", ko: "완벽 그 자체! 👑🎉 천재 인증!", emoji: "👑", score: s };
  if (s >= 80)  return { fr: "Très bien joué ! 👍 Presque un maître !", ko: "아주 잘했어요! 👍 이 정도면 거의 마스터!", emoji: "👏", score: s };
  if (s >= 60)  return { fr: "Pas mal du tout ! 😎 Encore un petit effort et c’est le top !", ko: "꽤 잘했어요! 😎 조금만 더 가면 최고!", emoji: "✅", score: s };
  return { fr: "Allez, un petit café et on repart ! ☕", ko: "자, 커피 한 잔 하고 다시 가자! ☕💪", emoji: "☕", score: s };
}

function escapeHtml(s = '') {
  return String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function stripHtml(s = '') { return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

// JSON + CORS 응답
function jres(obj, status = 200, withCORS = false) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (withCORS) {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Allow-Methods'] = 'POST,OPTIONS';
  }
  return { statusCode: status, headers, body: JSON.stringify(obj) };
}
