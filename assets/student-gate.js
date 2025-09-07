// assets/student-gate.js
// 공통: 이름 placeholder, 시작시각 기록, 전역 fetch 로깅(send-results 실패 전문 자동 보고),
//       전역 오류 핸들러(window error/unhandledrejection → log-error)

// ===== 시작 시간 (전역) =====
if (!window._startTime) window._startTime = new Date().toISOString();
if (!window._startMs)   window._startMs   = Date.now();

// ===== 랜덤 프랑스 이름 =====
(function(){
  const names = ['Camille','Noé','Chloé','Lucas','Léa','Louis','Emma','Hugo','Manon','Arthur','Jules','Zoé','Léna','Nina','Paul','Sofia'];
  function pick(){ return names[Math.floor(Math.random()*names.length)]; }

  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('student-name');
    if (input) {
      if (!input.placeholder || /Ex\./i.test(input.placeholder)) {
        input.placeholder = `Ex. ${pick()}, ${pick()}, ${pick()}...`;
      }
      // 이름 없으면 finish 비활성화(있으면 즉시 활성화)
      const finishBtn = document.getElementById('finish-btn');
      const toggle = ()=>{ if (finishBtn) finishBtn.disabled = !(input.value && input.value.trim().length>0); };
      if (finishBtn) { toggle(); input.addEventListener('input', toggle); }
    }
  });
})();

// ===== 전역 오류 리포트 (log-error) =====
(function(){
  const LOG = '/.netlify/functions/log-error';
  function post(payload){
    try{
      fetch(LOG, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(()=>{});
    }catch(_){}
  }
  window.addEventListener('error', (e)=>{
    post({
      functionName:'client-error',
      pageUrl: location.href,
      error: { message: String(e?.message||'window.error'), stack: String(e?.error?.stack||'') },
      context: { filename: e?.filename, lineno: e?.lineno, colno: e?.colno, ua: navigator.userAgent }
    });
  });
  window.addEventListener('unhandledrejection', (e)=>{
    post({
      functionName:'unhandledrejection',
      pageUrl: location.href,
      error: { message: String(e?.reason?.message||e?.reason||'unhandledrejection'), stack: String(e?.reason?.stack||'') },
      context: { ua: navigator.userAgent }
    });
  });
})();

// ===== Global fetch middleware for send-results =====
(function(){
  if (window.__sendResultsFetchWrapped) return;
  window.__sendResultsFetchWrapped = true;

  const SEND = '/.netlify/functions/send-results';
  const LOG  = '/.netlify/functions/log-error';
  const origFetch = window.fetch.bind(window);

  function safeJson(s){ try { return JSON.parse(s || '{}'); } catch { return {}; } }

  window.fetch = async function(input, init) {
    const url = (typeof input === 'string') ? input : (input && input.url) || '';

    // 대상 외 요청은 그대로 통과
    if (!url.includes(SEND)) return origFetch(input, init);

    // payload 프리뷰(학생이름/문항수)
    let preview = {};
    try{
      const bodyStr = init && typeof init.body === 'string' ? init.body : '';
      const p = safeJson(bodyStr);
      preview = {
        studentName: p.studentName || 'N/A',
        totalQ: Array.isArray(p.questions) ? p.questions.length : 0
      };
    }catch(_){}

    // 실제 요청
    const resp = await origFetch(input, init);

    // 응답 전문 확보
    let text = ''; try { text = await resp.clone().text(); } catch(_){}
    let j = null; try { j = text ? JSON.parse(text) : null; } catch(_){}

    // 실패 or {ok:false} → log-error로 자동 보고
    if (!resp.ok || (j && j.ok === false)) {
      try{
        origFetch(LOG, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            functionName:'send-results',
            studentName: preview.studentName,
            pageUrl: location.href,
            error: {
              message: (j && (j.error || j.message)) || resp.statusText || 'send-results failed',
              stack: j?.stack || ''
            },
            context: {
              status: resp.status,
              statusText: resp.statusText,
              respBody: text,
              payloadPreview: preview,
              ua: navigator.userAgent
            }
          })
        }).catch(()=>{});
      }catch(_){}
    }

    return resp;
  };
})();
