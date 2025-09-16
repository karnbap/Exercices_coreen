// assets/results-compat.js
// 결과 전송 공통(슬림화 + 로깅 + 로컬 폴백)
// - window.sendResults(payload) 제공 (results-viewer.js 호환)
// - window.SendResults.sendResults(payload)도 함께 제공

(function (global) {
  'use strict';

  const ENDPT = (global.PONGDANG_FN_BASE || '/.netlify/functions') + '/send-results';
  const KEY_LOCAL = 'pongdang:lastResults';
  const KEY_SESSION = 'pondant_results';

  // ---- 큰 필드 제거(녹음/오디오 등) ----
  function slimResultsPayload(p) {
    try {
      const c = JSON.parse(JSON.stringify(p || {}));
      if (Array.isArray(c.questions)) {
        c.questions.forEach(q => {
          if (!q) return;
          if (q.recording) { delete q.recording.base64; delete q.recording.blob; delete q.recording.file; }
          delete q.audio; delete q.audioBase64; delete q.logs;
        });
      }
      // 학생 이름 비정상 길이 방지
      if (typeof c.studentName === 'string' && c.studentName.length > 8000) {
        c.studentName = c.studentName.slice(0, 8000);
      }
      return c;
    } catch (_) {
      return p;
    }
  }

  // ---- 로컬/세션 저장(결과 페이지용 폴백) ----
  function stash(payload) {
    try { sessionStorage.setItem(KEY_SESSION, JSON.stringify(payload)); } catch(_){}
    try { localStorage.setItem(KEY_LOCAL, JSON.stringify(payload)); } catch(_){}
  }

  // ---- 실제 전송 함수 ----
  async function sendResults(payload) {
    const slim = slimResultsPayload(payload);
    // 전송 전 우선 저장(혹시 실패 시 결과페이지에서 읽을 수 있게)
    stash(slim);

    try {
      const res = await fetch(ENDPT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        mode: 'cors',
        credentials: 'omit',
        body: JSON.stringify(slim)
      });

      const txt = await res.text().catch(()=>'');
      let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

      if (!res.ok || data?.ok === false) {
        console.error('[send-results] HTTP', res.status, data);
        return { ok:false, status:res.status, data };
      }

      return { ok:true, status:res.status, data };
    } catch (err) {
      console.error('[send-results] fetch error', err);
      return { ok:false, error:String(err) };
    }
  }

  // 전역 노출 (두 방식 모두 지원)
  global.sendResults = sendResults;
  global.SendResults = { sendResults };

})(window);
