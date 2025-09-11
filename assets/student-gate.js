// assets/student-gate.js
// 공통: 이름 게이트 + 시작시각 기록 + 전역 fetch 로깅(send-results 실패 전문 자동 보고)
//       + 전역 오류 핸들러(window error/unhandledrejection → log-error)

(function(){
  // ===== 시작 시간 (전역) =====
  if (!window._startTime) window._startTime = new Date().toISOString();
  if (!window._startMs)   window._startMs   = Date.now();

  // ===== StudentGate (이름 저장/요구) =====
  const KEY = 'korean.studentName';
  function getName(){ try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
  function setName(v){
    try { localStorage.setItem(KEY, String(v||'')); } catch {}
    document.dispatchEvent(new CustomEvent('student-ready', { detail: { name: getName() }}));
  }
  function init(){
    const input = document.getElementById('student-name');
    if (input){
      const cur = getName();
      if (cur && !input.value) input.value = cur;
      input.addEventListener('change', (e)=>{
        const v = String(e.target.value||'').trim();
        if (v) setName(v);
        toggleFinish();
      });
      // 랜덤 프랑스 이름 placeholder
      if (!input.placeholder || /Ex\./i.test(input.placeholder)) {
        const names = ['Camille','Noé','Chloé','Lucas','Léa','Louis','Emma','Hugo','Manon','Arthur','Jules','Zoé','Léna','Nina','Paul','Sofia'];
        const pick=()=>names[Math.floor(Math.random()*names.length)];
        input.placeholder = `Ex. ${pick()}, ${pick()}, ${pick()}...`;
      }
    }
    toggleFinish();
  }
  function toggleFinish(){
    const input = document.getElementById('student-name');
    const finishBtn = document.getElementById('finish-btn');
    if (finishBtn) finishBtn.disabled = !((input && input.value.trim()) || getName());
  }
  function requireBeforeInteraction(root=document){
    const guard = (e)=>{
      // 이름칸 자체는 통과
      const t = e.target;
      if (t && (t.id === 'student-name' || (t.closest && t.closest('#student-name')))) return;
      if (!getName()){
        e.preventDefault(); e.stopPropagation();
        alert('이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
        document.getElementById('student-name')?.focus();
      }
    };
    root.addEventListener('click', guard, true);
    root.addEventListener('input', guard, true);
  }

  // 공개
  window.StudentGate = { init, requireBeforeInteraction, getName, setName };

  // ===== 전역 오류 리포트 (log-error) =====
  const LOG = '/.netlify/functions/log-error';
  function postLog(payload){
    try{
      fetch(LOG,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(()=>{});
    }catch(_){}
  }
  window.addEventListener('error', (e)=>{
    postLog({
      functionName:'client-error',
      pageUrl: location.href,
      error: { message: String(e?.message||'window.error'), stack: String(e?.error?.stack||'') },
      context: { filename: e?.filename, lineno: e?.lineno, colno: e?.colno, ua: navigator.userAgent }
    });
  });
  window.addEventListener('unhandledrejection', (e)=>{
    postLog({
      functionName:'unhandledrejection',
      pageUrl: location.href,
      error: { message: String(e?.reason?.message||e?.reason||'unhandledrejection'), stack: String(e?.reason?.stack||'') },
      context: { ua: navigator.userAgent }
    });
  });

  // ===== send-results 전송 감시(실패 전문 자동 보고) =====
  if (!window.__sendResultsFetchWrapped){
    window.__sendResultsFetchWrapped = true;
    const SEND = '/.netlify/functions/send-results';
    const origFetch = window.fetch.bind(window);
    function safeJson(s){ try { return JSON.parse(s||'{}'); } catch { return {}; } }

    window.fetch = async function(input, init){
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (!url.includes(SEND)) return origFetch(input, init);

      // payload 프리뷰(이름/문항수)
      let preview={}; try{
        const bodyStr = init && typeof init.body === 'string' ? init.body : '';
        const p = safeJson(bodyStr);
        preview = { studentName: p.studentName||'N/A', totalQ: Array.isArray(p.questions)?p.questions.length:0 };
      }catch{}

      const resp = await origFetch(input, init);
      let text=''; try{ text = await resp.clone().text(); }catch{}
      let j=null; try{ j = text ? JSON.parse(text) : null; }catch{}

      if (!resp.ok || (j && j.ok===false)){
        postLog({
          functionName:'send-results',
          studentName: preview.studentName,
          pageUrl: location.href,
          error: { message: (j && (j.error||j.message)) || resp.statusText || 'send-results failed', stack: j?.stack || '' },
          context: { status: resp.status, statusText: resp.statusText, respBody: text, payloadPreview: preview, ua: navigator.userAgent }
        });
      }
      return resp;
    };
  }
})();

// Hint 토글 전역 이벤트 (모든 문제 카드 공통)
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.btn-hint');
  if(!btn) return;
  const targetSel = btn.getAttribute('data-target');
  if(!targetSel) return;
  const box = document.querySelector(targetSel);
  if(!box) return;
  box.classList.toggle('show');
});

