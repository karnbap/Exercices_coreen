  // assets/student-gate.js
  // 공통: 이름 게이트 + 시작시각 기록 + 전역 fetch 로깅(send-results 실패 자동 보고)
  //       + 전역 오류 핸들러(window error/unhandledrejection → log-error)
  //       + 힌트 버튼/모든 버튼에 이름 필요 시각적 비활성(data-requires-name)
  //       + (선택) data-allow-before-name 달린 요소는 이름 없이도 허용
  //       + 전역 Hint 토글(카드 범위 data-target 우선, 폴백 지원)
  
  ;(function(){
    // ===== 전역 시작 시간 =====
    if (!window._startTime) window._startTime = new Date().toISOString();
    if (!window._startMs)   window._startMs   = Date.now();
  
    // ===== 이름 저장 =====
    const KEY = 'korean.studentName';
    function getName(){ try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
    function setName(v){
      try { localStorage.setItem(KEY, String(v||'')); } catch {}
      applyRequiresNameState(document);
      document.dispatchEvent(new CustomEvent('student-ready', { detail:{ name:getName() }}));
      toggleFinish();
    }
  
    // ===== UX: 스크롤/플래시 =====
    function flash(el){
      if (!el) return;
      el.classList.remove('flash-on');
      void el.offsetWidth; // reflow
      el.classList.add('flash-on');
    }
  function focusName(){
    const input = document.getElementById('student-name') || document.getElementById('studentName');
    if (!input) return;
    input.focus({ preventScroll:true });
    (input.closest('.card')||input).scrollIntoView({behavior:'smooth',block:'center'});
    flash(input.closest('.card')||input);
  }
  
    // ===== 초기화 =====
  function init(){
    const input = document.getElementById('student-name') || document.getElementById('studentName');
    if (input){
      const cur = getName();
      if (cur && !input.value) input.value = cur;
  
      const commit = ()=>{ const v = String(input.value||'').trim(); if (v) setName(v); };
      input.addEventListener('change', commit);
      input.addEventListener('keyup', e=>{ if (e.key === 'Enter') commit(); });
  
      // 랜덤 프랑스 이름 placeholder (1회)
      if (!input.placeholder || /Ex\./i.test(input.placeholder)){
        const names = ['Camille','Noé','Chloé','Lucas','Léa','Louis','Emma','Hugo','Manon','Arthur','Jules','Zoé','Léna','Nina','Paul','Sofia'];
        const pick = ()=>names[Math.floor(Math.random()*names.length)];
        input.placeholder = `Ex. ${pick()}, ${pick()}, ${pick()}...`;
      }
    }
    toggleFinish();
    applyRequiresNameState(document);
  }
  
  
  function toggleFinish(){
    const input = document.getElementById('student-name') || document.getElementById('studentName');
    const finishBtn = document.getElementById('finish-btn');
    const has = ((input && input.value.trim()) || getName());
    if (finishBtn) finishBtn.disabled = !has;
  }
  
  
    // ===== 시각적 비활성: data-requires-name =====
   function applyRequiresNameState(root = document){
  const hasName = !!getName();
  root.querySelectorAll('[data-requires-name]').forEach(el => {
    // 1) 시각적/접근성 비활성 상태 반영
    if ('disabled' in el) el.disabled = !hasName;
    el.classList.toggle('is-disabled', !hasName);
    el.setAttribute('aria-disabled', hasName ? 'false' : 'true');

    // 2) title 관리: 이름 없을 때 원래 title 보관 → 경고 문구로 교체
    if (!hasName) {
      if (!el.dataset._origTitle) {
        el.dataset._origTitle = el.getAttribute('title') || '';
      }
      el.setAttribute('title', '이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
    } else {
      // 3) 이름 생기면 원래 title 복구 후 data-* 깨끗이 제거
      if (el.dataset._origTitle != null) {
        el.setAttribute('title', el.dataset._origTitle);
        delete el.dataset._origTitle;
      }
    }
  });
}

  
    // ===== 이름 없으면 상호작용 차단(캡처 단계) =====
  function requireBeforeInteraction(root=document){
    const needName = (t)=>{
      if (!t) return false;
      const el = t.closest('[data-requires-name]');
      if (!el) return false;
      if (el.closest('[data-allow-before-name]')) return false;
      return true;
    };
  
    const guard = (e)=>{
      if (getName()) return;
      const t = e.target;
  
      if (e.type === 'keydown' && !['Enter',' '].includes(e.key)) return;
      if (!needName(t)) return;
  
      e.preventDefault(); e.stopPropagation();
      alert('이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
      focusName();
    };
  
    root.addEventListener('click',guard,true);
    root.addEventListener('pointerdown',guard,true);
    root.addEventListener('touchstart',guard,true);
    root.addEventListener('keydown',guard,true);
    root.addEventListener('submit',(e)=>{
      if(!getName() && needName(e.target)){
        e.preventDefault(); e.stopPropagation();
        alert('이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
        focusName();
      }
    },true);
  
    const mo = new MutationObserver(()=>applyRequiresNameState(root));
    mo.observe(root,{childList:true,subtree:true,attributes:true});
  }
  
  
    // ===== 공개 API =====
    window.StudentGate = { init, requireBeforeInteraction, getName, setName, applyRequiresNameState };
  
    // ===== 전역 오류 리포트 (log-error) =====
    const LOG='/.netlify/functions/log-error';
    function postLog(p){ try{ fetch(LOG,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).catch(()=>{}); }catch(_){ } }
    window.addEventListener('error', e=>{
      postLog({ functionName:'client-error', pageUrl:location.href,
        error:{ message:String(e?.message||'window.error'), stack:String(e?.error?.stack||'') },
        context:{ filename:e?.filename, lineno:e?.lineno, colno:e?.colno, ua:navigator.userAgent }});
    });
    window.addEventListener('unhandledrejection', e=>{
      postLog({ functionName:'unhandledrejection', pageUrl:location.href,
        error:{ message:String(e?.reason?.message||e?.reason||'unhandledrejection'), stack:String(e?.reason?.stack||'') },
        context:{ ua:navigator.userAgent }});
    });
  
    // ===== send-results 감시(실패 자동 보고 + 페이로드 프리뷰) =====
    if (!window.__sendResultsFetchWrapped){
      window.__sendResultsFetchWrapped=true;
      const SEND='/.netlify/functions/send-results';
      const origFetch=window.fetch.bind(window);
      const safeJson=s=>{ try{return JSON.parse(s||'{}');}catch{return{};} };
  
      window.fetch=async function(input, init){
        const url=(typeof input==='string')?input:((input&&input.url)||'');
        if (!url.includes(SEND)) return origFetch(input,init);
  
        let preview={}; try{
          const bodyStr=init && typeof init.body==='string' ? init.body : '';
          const p=safeJson(bodyStr);
          preview={ studentName:p.studentName||'N/A',
                    totalQ:Array.isArray(p.questions)?p.questions.length:0,
                    overall:p?.categoryScores?.overall ?? null };
        }catch{}
  
        const resp=await origFetch(input,init);
        let text=''; try{ text=await resp.clone().text(); }catch{}
        let j=null; try{ j=text?JSON.parse(text):null; }catch{}
  
        if (!resp.ok || (j && j.ok===false)){
          postLog({ functionName:'send-results', studentName:preview.studentName, pageUrl:location.href,
            error:{ message:(j&&(j.error||j.message))||resp.statusText||'send-results failed', stack:j?.stack||'' },
            context:{ status:resp.status, statusText:resp.statusText, respBody:text, payloadPreview:preview, ua:navigator.userAgent }});
        }
        return resp;
      };
    }
  
    // ===== 자동 초기화 =====
    document.addEventListener('DOMContentLoaded', ()=>{
      init();
      requireBeforeInteraction(document);
      applyRequiresNameState(document);
    });
  })();
  
  // ===== 전역 Hint 버튼 토글 =====
  // data-target 우선(예: ".hint1-box"), 없으면 바로 다음 형제 .hint-box 사용
  document.addEventListener('click', (e)=>{
    const btn=e.target.closest('.btn-hint1, .btn-hint2, .btn-hint');
    if(!btn) return;
  
    // 이름 의무: 허용 안 할 거면 data-allow-before-name 없이 두세요.
    if (!window.StudentGate?.getName?.() && !btn.closest('[data-allow-before-name]')){
      e.preventDefault(); e.stopPropagation();
      alert('이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
      (window.StudentGate&&StudentGate.applyRequiresNameState(document), StudentGate) && StudentGate.init();
      return;
    }
  
    const card = btn.closest('.card, [data-card], .dictation-card, .quiz-card') || document;
    const sel  = btn.getAttribute('data-target');
    let box = sel ? card.querySelector(sel) : null;
    if(!box){
      const next = btn.nextElementSibling;
      if (next && next.classList?.contains('hint-box')) box = next;
    }
    if(!box) return;
  
    const show = !box.classList.contains('show');
    box.classList.toggle('show', show);
    box.style.display = show ? 'block' : 'none';
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
  
    // 최초 열림 카운트(카드별 통계용): btn.dataset._opened 플래그 사용
    if (show && !btn.dataset._opened){
      const isH1 = btn.classList.contains('btn-hint1');
      const root = card; // 카드 안에서만 검색
      const idxEl = root.querySelector('.text-2xl.font-extrabold'); // 번호 배지
      let idx = -1; try { idx = parseInt(idxEl?.textContent||'-1',10)-1; } catch {}
      if (!isNaN(idx) && idx>=0){
        (window.__dicteeStats = window.__dicteeStats || (Array(100).fill(null).map(()=>({h1:0,h2:0})) ));
        if (isH1) window.__dicteeStats[idx].h1++; else window.__dicteeStats[idx].h2++;
      }
      btn.dataset._opened='1';
    }
  });
