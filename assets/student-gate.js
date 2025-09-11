// assets/student-gate.js
// 공통: 이름 게이트 + 시작시각 기록 + 전역 fetch 로깅(send-results 실패 자동 보고)
//       + 전역 오류 핸들러(window error/unhandledrejection → log-error)
//       + 힌트 버튼 전역 토글(카드 단위 탐색)
// 개선: 이름 미입력 차단 범위 확대(pointerdown/keydown/submit/touchstart), UX 개선(스크롤/플래시),
//       선택적 data-requires-name 자동 비활성화 지원

(function(){
  // ===== 전역 시작 시간 =====
  if (!window._startTime) window._startTime = new Date().toISOString();
  if (!window._startMs)   window._startMs   = Date.now();

  // ===== StudentGate (이름 저장/요구) =====
  const KEY = 'korean.studentName';

  function getName(){
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
  }
  function setName(v){
    try { localStorage.setItem(KEY, String(v||'')); } catch {}
    document.dispatchEvent(new CustomEvent('student-ready', { detail: { name: getName() }}));
    toggleFinish();
    applyRequiresNameState(document);
  }

  function flash(el){
    if (!el) return;
    el.classList.remove('flash-on');
    // reflow
    void el.offsetWidth;
    el.classList.add('flash-on');
  }

  function focusName(){
    const input = document.getElementById('student-name');
    if (input){
      input.focus({ preventScroll:true });
      const box = input.closest('.card') || input;
      box.scrollIntoView({ behavior:'smooth', block:'center' });
      flash(box);
    }
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

      input.addEventListener('keyup', (e)=>{
        if (e.key === 'Enter'){
          const v = String(e.target.value||'').trim();
          if (v) setName(v);
        }
      });

      // 랜덤 프랑스 이름 placeholder
      if (!input.placeholder || /Ex\./i.test(input.placeholder)) {
        const names = ['Camille','Noé','Chloé','Lucas','Léa','Louis','Emma','Hugo','Manon','Arthur','Jules','Zoé','Léna','Nina','Paul','Sofia'];
        const pick=()=>names[Math.floor(Math.random()*names.length)];
        input.placeholder = `Ex. ${pick()}, ${pick()}, ${pick()}...`;
      }
    }

    toggleFinish();
    applyRequiresNameState(document);
  }

  function toggleFinish(){
    const input = document.getElementById('student-name');
    const finishBtn = document.getElementById('finish-btn');
    const has = ((input && input.value.trim()) || getName());
    if (finishBtn) finishBtn.disabled = !has;
  }

  // data-requires-name 속성 가진 요소는 이름 없을 때 자동 비활성화
  function applyRequiresNameState(root=document){
    const hasName = !!getName();
    const nodes = root.querySelectorAll('[data-requires-name]');
    nodes.forEach(el=>{
      const tag = (el.tagName||'').toLowerCase();
      if (['button','input','select','textarea'].includes(tag)){
        el.disabled = !hasName;
      }
      el.setAttribute('aria-disabled', hasName ? 'false' : 'true');
    });
  }

  function requireBeforeInteraction(root=document){
    const allow = (target)=>{
      // 이름 입력칸/라벨/컨테이너는 통과
      if (!target) return true;
      if (target.id === 'student-name') return true;
      if (target.closest && target.closest('#student-name')) return true;
      // 프린트/메일 링크 등 허용하려면 아래 추가 가능
      return false;
    };

    const guard = (e)=>{
      if (getName()) return;
      const t = e.target;
      if (allow(t)) return;
      // 키보드로 버튼/링크 활성화도 막기 (Enter/Space)
      if (e.type === 'keydown'){
        const k = e.key;
        if (!['Enter',' '].includes(k)) return;
      }
      e.preventDefault();
      e.stopPropagation();
      alert('이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
      focusName();
    };

    // 캡처 단계에서 광범위하게 가로채기
    root.addEventListener('click',       guard, true);
    root.addEventListener('pointerdown', guard, true);
    root.addEventListener('touchstart',  guard, true);
    root.addEventListener('keydown',     guard, true);
    root.addEventListener('submit', (e)=>{
      if (!getName()){
        e.preventDefault(); e.stopPropagation();
        alert('이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
        focusName();
      }
    }, true);
  }

  // 공개 API
  window.StudentGate = { init, requireBeforeInteraction, getName, setName, applyRequiresNameState };

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

// ===== Hint 버튼 토글 (모든 페이지/문제 공통) =====
// - 각 카드(.card / [data-card] / .dictation-card / .quiz-card) 내부에서 data-target 우선 → 폴백: 다음 형제 .hint-box
// - aria-pressed 업데이트, .show 클래스 토글 (style.css의 .hint-box.show {display:block;}와 연동)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-hint1, .btn-hint2, .btn-hint');
  if (!btn) return;

  // 카드 범위
  const card = btn.closest('.card, [data-card], .dictation-card, .quiz-card') || document;

  // 우선 data-target
  const sel = btn.getAttribute('data-target');
  let box = sel ? card.querySelector(sel) : null;

  // 폴백: 버튼의 바로 다음 형제 중 .hint-box
  if (!box) {
    const next = btn.nextElementSibling;
    if (next && next.classList?.contains('hint-box')) box = next;
  }
  if (!box) return;

  const willShow = !box.classList.contains('show');
  box.classList.toggle('show', willShow);
  // 인라인 보조(외부 CSS 우선순위 문제 대비)
  box.style.display = willShow ? 'block' : 'none';
  btn.setAttribute('aria-pressed', willShow ? 'true' : 'false');
});
