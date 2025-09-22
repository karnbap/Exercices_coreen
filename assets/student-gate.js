// assets/student-gate.js
// 공통 유틸(최종 안정판)
// - 이름 게이트: opt-in(data-requires-name)만 차단 → 다른 연습문제 영향 최소화
// - finish 버튼 자동 비활성/활성
// - 전역 오류/전송 로깅 (중복 래핑 방지, 안전 파싱)
// - 전역 Hint 토글(카드 범위 data-target 우선 → 폴백, CSS 없어도 인라인 display 토글)
// - 자동 초기화: 페이지에 #student-name / [data-requires-name] 있을 때만 동작

;(function () {
  // ===== idempotent =====
  if (window.__StudentGateLoaded) return;
  window.__StudentGateLoaded = true;

  // ===== global timers =====
  if (!window._startTime) window._startTime = new Date().toISOString();
  if (!window._startMs)   window._startMs   = Date.now();

  // ===== name storage =====
  const KEY = 'korean.studentName';

  // ===== messages =====
  const MSG = {
    needName : '이름을 먼저 입력해주세요 / Entrez votre nom d’abord.'
    // (발음 관련 메시지/가드 완전 제거)
  };

  function getName(){
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
  }
  function setName(v){
    try { localStorage.setItem(KEY, String(v||'')); } catch {}
    applyRequiresNameState(document);
    toggleFinish();
    document.dispatchEvent(new CustomEvent('student-ready', { detail:{ name:getName() }}));
  }

  // ===== UX helpers =====
  function flash(el){
    if(!el) return;
    el.classList.remove('flash-on'); void el.offsetWidth;
    el.classList.add('flash-on');
    setTimeout(()=>el.classList.remove('flash-on'), 500);
  }
  function focusName(){
    const input = document.getElementById('student-name') || document.getElementById('studentName');
    if(!input) return;
    input.focus({preventScroll:true});
    (input.closest('.card')||input).scrollIntoView({behavior:'smooth',block:'center'});
    flash(input.closest('.card')||input);
  }

  // ===== init =====
  function init(){
    const input = document.getElementById('student-name') || document.getElementById('studentName');
    if (input){
      const cur = getName();
      if (cur && !input.value) input.value = cur;

      const commit = ()=>{ const v=String(input.value||'').trim(); if(v) setName(v); };
      input.addEventListener('change', commit);
      input.addEventListener('keyup', e=>{ if(e.key==='Enter') commit(); });

      // 입력 중에도 UI 상태 갱신(저장은 Enter/blur)
      input.addEventListener('input', ()=>{
        toggleFinish();
        applyRequiresNameState(document);
      });

      // fun placeholder
      if (!input.placeholder || /Ex\./i.test(input.placeholder)){
        const names=['Camille','Noé','Chloé','Lucas','Léa','Louis','Emma','Hugo','Manon','Arthur','Jules','Zoé','Léna','Nina','Paul','Sofia'];
        const pick=()=>names[Math.floor(Math.random()*names.length)];
        input.placeholder=`Ex. ${pick()}, ${pick()}, ${pick()}...`;
      }
    }
    toggleFinish();
    applyRequiresNameState(document);
  }

  // ===== finish lock =====
  function toggleFinish(){
    const input = document.getElementById('student-name') || document.getElementById('studentName');
    const finishBtn = document.getElementById('finish-btn');
    const has = ((input && input.value.trim()) || getName());
    if (finishBtn) finishBtn.disabled = !has;
  }

  // ===== visual/aria lock for [data-requires-name] =====
  function applyRequiresNameState(root=document){
    const hasName = !!getName();
    root.querySelectorAll('[data-requires-name]').forEach(el=>{
      if ('disabled' in el) el.disabled = !hasName;
      el.classList.toggle('is-disabled', !hasName);
      el.setAttribute('aria-disabled', hasName ? 'false' : 'true');

      if (!hasName){
        if (!el.dataset._origTitle) el.dataset._origTitle = el.getAttribute('title') || '';
        el.setAttribute('title', MSG.needName);
      }else{
        if (el.dataset._origTitle != null){
          el.setAttribute('title', el.dataset._origTitle);
          delete el.dataset._origTitle;
        }
      }
    });
  }

  // ===== block interactions before name (opt-in only) =====
  function requireBeforeInteraction(root=document){
    const needName = (t)=>{
      if (!t) return false;
      const guardEl = t.closest?.('[data-requires-name]');
      if (!guardEl) return false;
      if (guardEl.closest?.('[data-allow-before-name]')) return false; // opt-out
      return true;
    };

    const guard = (e)=>{
      if (getName()) return;
      const t=e.target;
      if (e.type==='keydown' && !['Enter',' '].includes(e.key)) return;
      if (!needName(t)) return;
      e.preventDefault(); e.stopPropagation();
      alert(MSG.needName);
      focusName();
    };

    root.addEventListener('click',guard,true);
    root.addEventListener('pointerdown',guard,true);
    root.addEventListener('touchstart',guard,true);
    root.addEventListener('keydown',guard,true);
    root.addEventListener('submit', (e)=>{
      if (!getName() && needName(e.target)){
        e.preventDefault(); e.stopPropagation();
        alert(MSG.needName);
        focusName();
      }
    }, true);

    // 변화 감지 최적화
    let raf = null;
    const mo = new MutationObserver(()=>{
      if (raf) return;
      raf = requestAnimationFrame(()=>{
        raf = null;
        applyRequiresNameState(root);
      });
    });
    mo.observe(root,{childList:true,subtree:true,attributes:true});
  }

  // ===== expose =====
  window.StudentGate = { init, requireBeforeInteraction, getName, setName, applyRequiresNameState };

  // ===== error logging =====
  const LOG='/.netlify/functions/log-error';
  function postLog(p){ try{ fetch(LOG,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).catch(()=>{});}catch(_){} }
  window.addEventListener('error', e=>{
    postLog({
      functionName:'client-error', pageUrl:location.href,
      error:{ message:String(e?.message||'window.error'), stack:String(e?.error?.stack||'') },
      context:{ filename:e?.filename, lineno:e?.lineno, colno:e?.colno, ua:navigator.userAgent }
    });
  });
  window.addEventListener('unhandledrejection', e=>{
    postLog({
      functionName:'unhandledrejection', pageUrl:location.href,
      error:{ message:String(e?.reason?.message||e?.reason||'unhandledrejection'), stack:String(e?.reason?.stack||'') },
      context:{ ua:navigator.userAgent }
    });
  });

  // ===== wrap fetch for send-results failures (idempotent) =====
  if (!window.__sendResultsFetchWrapped){
    window.__sendResultsFetchWrapped = true;
    const SEND='/.netlify/functions/send-results';
    const origFetch = window.fetch.bind(window);
    const safeJson = s=>{ try{ return JSON.parse(s||'{}'); }catch{ return {}; } };

    window.fetch = async function(input, init){
      const url = (typeof input==='string') ? input : ((input&&input.url)||'');
      if (!url.includes(SEND)) return origFetch(input, init);

      let preview={};
      try{
        const bodyStr = (init && typeof init.body === 'string') ? init.body : '';
        const p = safeJson(bodyStr);
        preview = {
          studentName: p.studentName||'N/A',
          totalQ: Array.isArray(p.questions)?p.questions.length:0,
          overall: p?.categoryScores?.overall ?? null
        };
      }catch{}

      const resp = await origFetch(input, init);
      let text=''; try{ text = await resp.clone().text(); }catch{}
      let j=null; try{ j = text ? JSON.parse(text) : null; }catch{}
      if (!resp.ok || (j && j.ok===false)){
        postLog({
          functionName:'send-results', studentName:preview.studentName, pageUrl:location.href,
          error:{ message:(j&&(j.error||j.message))||resp.statusText||'send-results failed', stack:j?.stack||'' },
          context:{ status:resp.status, statusText:resp.statusText, respBody:text, payloadPreview:preview, ua:navigator.userAgent }
        });
      }
      return resp;
    };
  }

  // ===== multi-tab sync =====
  window.addEventListener('storage', (e)=>{
    if (e.key !== KEY) return;
    const v = getName();
    const input = document.getElementById('student-name') || document.getElementById('studentName');
    if (input && input.value !== v) input.value = v || '';
    applyRequiresNameState(document);
    toggleFinish();
  });

  // ===== auto init (only when needed) =====
  document.addEventListener('DOMContentLoaded', ()=>{
    const hasNameUI = !!(document.getElementById('student-name') || document.getElementById('studentName'));
    const hasRequireNodes = !!document.querySelector('[data-requires-name]');
    if (hasNameUI || hasRequireNodes){
      init();
      requireBeforeInteraction(document);
      applyRequiresNameState(document);
    }
  });
})();

// ===== Global Hint Toggle =====
// - data-target 우선 (예: data-target=".hint1-box"), 없으면 버튼 다음 형제 .hint-box
// - 카드(.card / [data-card] / .dictation-card / .quiz-card) 범위에서만 탐색
// - CSS 없어도 보이게 inline display까지 토글
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.btn-hint1, .btn-hint2, .btn-hint');
  if (!btn) return;

  // 이름 필수면 data-requires-name을 버튼(또는 래퍼)에 붙여 활용 가능
  if (!window.StudentGate?.getName?.() && btn.closest('[data-requires-name]') && !btn.closest('[data-allow-before-name]')){
    e.preventDefault(); e.stopPropagation();
    alert((window.MSG&&MSG.needName) || '이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
    return;
  }

  const card = btn.closest('.card, [data-card], .dictation-card, .quiz-card') || document;
  const sel  = btn.getAttribute('data-target');
  let box = sel ? card.querySelector(sel) : null;
  if (!box){
    const next = btn.nextElementSibling;
    if (next && next.classList?.contains('hint-box')) box = next;
  }
  if (!box) return;

  const show = !box.classList.contains('show');
  box.classList.toggle('show', show);
  box.style.display = show ? 'block' : 'none';
  btn.setAttribute('aria-pressed', show ? 'true' : 'false');

  // 집계 이벤트(페이지 스크립트에서 수집 가능)
  try {
    const type = btn.classList.contains('btn-hint1') ? 'hint1' :
                 btn.classList.contains('btn-hint2') ? 'hint2' : 'hint';
    btn.dispatchEvent(new CustomEvent('hint-used', {
      bubbles:true, detail:{ type, shown:show }
    }));
  } catch {}
});

// (발음 가드 전역 바인딩 블록은 완전히 제거했습니다)
