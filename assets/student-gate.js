// assets/student-gate.js
// 공통 유틸 (안정판)
// - 이름 게이트: 입력 전엔 특정 요소만 막는 "opt-in 방식"(data-requires-name)
// - finish 버튼 자동 비활성/활성
// - 전역 오류/전송 로깅 (중복 래핑 방지)
// - 전역 힌트 버튼 토글(카드 범위 탐색, data-target 우선 → 폴백 지원, CSS 없어도 동작)
// - 다른 연습문제는 건드리지 않도록: 페이지에 #student-name 또는 [data-requires-name] 있을 때만 게이트 구동

;(function () {
  // ====== 중복 로드 방지 ======
  if (window.__StudentGateLoaded) return;
  window.__StudentGateLoaded = true;

  // ====== 전역 시작 시각 ======
  if (!window._startTime) window._startTime = new Date().toISOString();
  if (!window._startMs)   window._startMs   = Date.now();

  // ====== 이름 저장/복원 ======
  const KEY = 'korean.studentName';
  function getName() {
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
  }
  function setName(v) {
    try { localStorage.setItem(KEY, String(v||'')); } catch {}
    applyRequiresNameState(document);
    toggleFinish();
    document.dispatchEvent(new CustomEvent('student-ready', { detail: { name: getName() }}));
  }

  // ====== 작은 UX 유틸 ======
  function flash(el) {
    if (!el) return;
    el.classList.remove('flash-on'); // (style.css에 .flash-on 애니메이션 정의됨)
    void el.offsetWidth;             // reflow
    el.classList.add('flash-on');
  }
  function focusName() {
    const input = document.getElementById('student-name') || document.getElementById('studentName');
    if (!input) return;
    input.focus({ preventScroll:true });
    (input.closest('.card')||input).scrollIntoView({ behavior:'smooth', block:'center' });
    flash(input.closest('.card')||input);
  }

  // ====== 초기화 ======
  function init() {
    const input = document.getElementById('student-name') || document.getElementById('studentName');
    if (input) {
      const cur = getName();
      if (cur && !input.value) input.value = cur;

      const commit = () => {
        const v = String(input.value||'').trim();
        if (v) setName(v);
      };
      input.addEventListener('change', commit);
      input.addEventListener('keyup', (e)=>{ if (e.key === 'Enter') commit(); });

      // placeholder 가독성 (1회)
      if (!input.placeholder || /Ex\./i.test(input.placeholder)) {
        const names = ['Camille','Noé','Chloé','Lucas','Léa','Louis','Emma','Hugo','Manon','Arthur','Jules','Zoé','Léna','Nina','Paul','Sofia'];
        const pick = () => names[Math.floor(Math.random()*names.length)];
        input.placeholder = `Ex. ${pick()}, ${pick()}, ${pick()}...`;
      }
    }
    toggleFinish();
    applyRequiresNameState(document);
  }

  // finish 버튼 잠금/해제
  function toggleFinish() {
    const input = document.getElementById('student-name') || document.getElementById('studentName');
    const finishBtn = document.getElementById('finish-btn');
    const has = ((input && input.value.trim()) || getName());
    if (finishBtn) finishBtn.disabled = !has;
  }

  // ====== 이름 필요 요소의 시각/접근성 상태 반영 ======
  function applyRequiresNameState(root=document) {
    const hasName = !!getName();
    root.querySelectorAll('[data-requires-name]').forEach(el => {
      if ('disabled' in el) el.disabled = !hasName;
      el.classList.toggle('is-disabled', !hasName);
      el.setAttribute('aria-disabled', hasName ? 'false' : 'true');

      // title 안전 처리(원래 값을 보관/복구)
      if (!hasName) {
        if (!el.dataset._origTitle) {
          el.dataset._origTitle = el.getAttribute('title') || '';
        }
        el.setAttribute('title', '이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
      } else {
        if (el.dataset._origTitle != null) {
          el.setAttribute('title', el.dataset._origTitle);
          delete el.dataset._origTitle;
        }
      }
    });
  }

  // ====== 이름 입력 전 상호작용 차단(Opt-in: data-requires-name가 붙은 것만) ======
  function requireBeforeInteraction(root=document) {
    const needName = (t) => {
      if (!t) return false;
      const guardEl = t.closest('[data-requires-name]');
      if (!guardEl) return false;
      if (guardEl.closest('[data-allow-before-name]')) return false; // 예외 허용
      return true;
    };

    const guard = (e) => {
      if (getName()) return;
      const t = e.target;
      if (e.type === 'keydown' && !['Enter',' '].includes(e.key)) return;
      if (!needName(t)) return;

      e.preventDefault(); e.stopPropagation();
      alert('이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
      focusName();
    };

    // 캡처 단계에서 넓게 가로채되, opt-in 요소만 막음
    root.addEventListener('click',       guard, true);
    root.addEventListener('pointerdown', guard, true);
    root.addEventListener('touchstart',  guard, true);
    root.addEventListener('keydown',     guard, true);
    root.addEventListener('submit', (e) => {
      if (!getName() && needName(e.target)) {
        e.preventDefault(); e.stopPropagation();
        alert('이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
        focusName();
      }
    }, true);

    // 동적 렌더링 대응
    const mo = new MutationObserver(() => applyRequiresNameState(root));
    mo.observe(root, { childList:true, subtree:true, attributes:true });
  }

  // ====== 공개 API ======
  window.StudentGate = {
    init,
    requireBeforeInteraction,
    getName,
    setName,
    applyRequiresNameState,
  };

  // ====== 전역 오류 로깅 ======
  const LOG = '/.netlify/functions/log-error';
  function postLog(payload){
    try {
      fetch(LOG, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      }).catch(()=>{});
    } catch(_) {}
  }
  window.addEventListener('error', (e) => {
    postLog({
      functionName: 'client-error',
      pageUrl: location.href,
      error: {
        message: String(e?.message||'window.error'),
        stack: String(e?.error?.stack||'')
      },
      context: {
        filename: e?.filename, lineno: e?.lineno, colno: e?.colno,
        ua: navigator.userAgent
      }
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    postLog({
      functionName: 'unhandledrejection',
      pageUrl: location.href,
      error: {
        message: String(e?.reason?.message||e?.reason||'unhandledrejection'),
        stack: String(e?.reason?.stack||'')
      },
      context: { ua: navigator.userAgent }
    });
  });

  // ====== send-results 실패 자동 보고 (idempotent) ======
  if (!window.__sendResultsFetchWrapped) {
    window.__sendResultsFetchWrapped = true;
    const SEND = '/.netlify/functions/send-results';
    const origFetch = window.fetch.bind(window);
    const safeJson = (s)=>{ try{ return JSON.parse(s||'{}'); } catch { return {}; } };
    window.fetch = async function(input, init){
      const url = (typeof input === 'string') ? input : ((input && input.url) || '');
      if (!url.includes(SEND)) return origFetch(input, init);

      // payload 프리뷰(이름/문항수/overall)
      let preview = {};
      try {
        const bodyStr = init && typeof init.body === 'string' ? init.body : '';
        const p = safeJson(bodyStr);
        preview = {
          studentName: p.studentName || 'N/A',
          totalQ: Array.isArray(p.questions) ? p.questions.length : 0,
          overall: p?.categoryScores?.overall ?? null
        };
      } catch {}

      const resp = await origFetch(input, init);
      let text = ''; try { text = await resp.clone().text(); } catch {}
      let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
      if (!resp.ok || (j && j.ok === false)) {
        postLog({
          functionName: 'send-results',
          studentName: preview.studentName,
          pageUrl: location.href,
          error: { message: (j && (j.error||j.message)) || resp.statusText || 'send-results failed',
                   stack: j?.stack || '' },
          context: { status: resp.status, statusText: resp.statusText, respBody: text,
                     payloadPreview: preview, ua: navigator.userAgent }
        });
      }
      return resp;
    };
  }

  // ====== 자동 초기화 (다른 연습문제 영향 최소화) ======
  document.addEventListener('DOMContentLoaded', () => {
    // 페이지에 이름 인풋 또는 data-requires-name 요소가 있을 때만 게이트 동작
    const hasNameUI = !!(document.getElementById('student-name') || document.getElementById('studentName'));
    const hasRequireNodes = !!document.querySelector('[data-requires-name]');
    if (hasNameUI || hasRequireNodes) {
      init();
      requireBeforeInteraction(document);
      applyRequiresNameState(document);
    }
  });
})();

// ====== 전역 Hint 버튼 토글 ======
// - data-target 우선(예: data-target=".hint1-box"), 없으면 버튼 다음 형제 .hint-box 사용
// - CSS 없어도 보이게 inline display까지 함께 토글
// - 카드 범위(.card / [data-card] / .dictation-card / .quiz-card) 내부만 탐색 → 중복 방지
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-hint1, .btn-hint2, .btn-hint');
  if (!btn) return;

  // (선택) 이름 없으면 힌트 막고 안내 — 힌트 버튼 자체에 data-allow-before-name 주면 우회 가능
  if (!window.StudentGate?.getName?.() && !btn.closest('[data-allow-before-name]')) {
    e.preventDefault(); e.stopPropagation();
    alert('이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
    return;
  }

  const card = btn.closest('.card, [data-card], .dictation-card, .quiz-card') || document;
  const sel  = btn.getAttribute('data-target');
  let box = sel ? card.querySelector(sel) : null;

  // 폴백: 버튼의 바로 다음 형제 .hint-box
  if (!box) {
    const next = btn.nextElementSibling;
    if (next && next.classList?.contains('hint-box')) box = next;
  }
  if (!box) return;

  // 토글 (CSS 유무와 무관하게 표시 보장)
  const willShow = !box.classList.contains('show');
  box.classList.toggle('show', willShow);
  box.style.display = willShow ? 'block' : 'none';
  btn.setAttribute('aria-pressed', willShow ? 'true' : 'false');

  // 분석/통계용 커스텀 이벤트(필요시 사용)
  try {
    btn.dispatchEvent(new CustomEvent('hint-toggle', {
      bubbles: true, detail: { shown: willShow, targetSelector: sel || '.hint-box' }
    }));
  } catch {}
});
