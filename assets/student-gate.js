// assets/student-gate.js
// 공통 유틸(최종 안정판)
// - 이름 게이트: opt-in(data-requires-name)만 차단 → 다른 연습문제 영향 최소화
// - finish 버튼 자동 비활성/활성
// - 전역 오류/전송 로깅 (중복 래핑 방지, 안전 파싱)
// - Hint: FR/KO 라벨, 도와주세요/살려주세요 규칙, 자동 불어 보강(없으면 소사전 추정)
// - 전역 Hint 토글(카드 범위 data-target 우선, 폴백 안전)
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
  };
  window.MSG = Object.assign({}, window.MSG||{}, MSG);

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
    const ANALYZE='/.netlify/functions/analyze-pronunciation';
    const origFetch = window.fetch.bind(window);
    const safeJson = s=>{ try{ return JSON.parse(s||'{}'); }catch{ return {}; } };

    window.fetch = async function(input, init){
      const url = (typeof input==='string') ? input : ((input&&input.url)||'');

      // Intercept analyze-pronunciation calls to ensure referenceText is present
      if (url.includes(ANALYZE)) {
        try {
          const bodyStr = (init && typeof init.body === 'string') ? init.body : '';
          const p = safeJson(bodyStr);
          const ref = String(p.referenceText || '').trim();
          if (!ref) {
            // UX: prevent sending a bad request and prompt student to pick/prepare the sentence
            alert('문장(원문)이 비어 있어 평가할 수 없습니다. 문장을 확인한 뒤 다시 시도하세요.\nLa phrase de référence est vide — vérifiez la phrase et réessayez.');
            // focus any name or card area to guide the student
            const firstCard = document.querySelector('#cards .card');
            if (firstCard) firstCard.scrollIntoView({behavior:'smooth', block:'center'});
            return new Response(JSON.stringify({ ok:false, message:'client_missing_reference', messageKo:'클라이언트: 참조 텍스트 누락', messageFr:'Client: référence manquante' }), { status:400, headers:{'Content-Type':'application/json'} });
          }
        } catch (e) {
          // parsing failed - let the original fetch handle it
        }
      }

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

/* =========================
   Hint Utilities (FR/KO)
   ========================= */

// 안전 토글(전역)
window.toggleHint = window.toggleHint || function(box, html){
  if (!box) return;
  const hidden = box.classList.contains('hidden');
  if (hidden) {
    if (html != null) box.innerHTML = html;
    box.classList.remove('hidden');
    box.style.display = 'block';
  } else {
    box.classList.add('hidden');
    box.style.display = 'none';
  }
};

// 작은 한-불 사전(페이지에서 window.KO_FR_LEXICON로 확장 가능)
const __BASE_LEXICON = {
  '시간이':'le temps','없어서':'faute de','회의를':'la réunion','준비하든지':'préparer (au choix)',
  '숙제를':'les devoirs','하든지':'faire (au choix)','한':'un(e)','가지만':'seulement une',
  '골라야':'devoir choisir','했어요.':'(passé)','어쩔':'aucun','수':'moyen','없었어요.':'pas le choix'
};

function __choseong(str){
  const S=0xAC00, V=21, T=28, Lc=19, Nc=V*T, Sc=Lc*Nc;
  const Ls=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  let out=''; for (const ch of String(str)){
    const c=ch.codePointAt(0);
    if (c>=S && c<S+Sc){ out += Ls[Math.floor((c-S)/Nc)]; }
    else out += /\s/.test(ch) ? ' ' : ch;
  } return out.replace(/\s+/g,' ').trim();
}
function __splitKo(s){ return String(s).replace(/[“”"‘’'.,!?;:~()]/g,' ').split(/\s+/).filter(Boolean); }
function __pairsFromKo(ko){
  const lex = Object.assign({}, __BASE_LEXICON, window.KO_FR_LEXICON||{});
  return __splitKo(ko).map(w=>{
    const key = w.replace(/[을를은는이가]$/,'');
    return { ko:w, fr: (lex[w] || lex[key] || '—') };
  });
}
function __frHalf(fr, ko){
  const base = fr && fr.trim()
    ? fr.trim()
    : __pairsFromKo(ko).map(p=>p.fr).filter(x=>x!=='—').join(' ');
  const arr = base.split(/\s+/).filter(Boolean);
  const half = Math.max(1, Math.ceil(arr.length/2));
  return arr.slice(0, half).join(' ') + (arr.length>half ? ' …' : '');
}

// 공용 힌트 UI (FR/KO 라벨 + 규칙)
window.mkHintRow = function({ ko = '', fr = '' } = {}){
  const row  = document.createElement('div'); row.className  = 'flex flex-wrap gap-2 pt-1';
  const wrap = document.createElement('div'); wrap.className = 'mt-2 space-y-2 text-sm text-slate-700';

  const b1 = document.createElement('button');
  b1.className = 'btn px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 btn-hint1';
  b1.textContent = '🙏 Aidez-moi / 도와주세요';

  const b2 = document.createElement('button');
  b2.className = 'btn px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 btn-hint2';
  b2.textContent = '🦺 Au secours / 살려주세요';

  const box1 = document.createElement('div');
  box1.className = 'hidden p-3 rounded-lg bg-indigo-50 border border-indigo-200 hint-box hint1-box';
  box1.dataset.managed = 'toggleHint';

  const box2 = document.createElement('div');
  box2.className = 'hidden p-3 rounded-lg bg-amber-50 border border-amber-200 hint-box hint2-box';
  box2.dataset.managed = 'toggleHint';

  // 도와주세요 → 초성 + “초성(initiales)” + 불어 절반 문장(불어 없으면 자동 보강)
  b1.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    const html = `
      <div><strong>초성</strong> (<em>initiales</em>) : ${__choseong(ko)}</div>
      <div class="mt-1"><strong>FR (moitié)</strong> : ${__frHalf(fr, ko) || '(—)'}</div>`;
    window.toggleHint(box1, html);
  });

  // 살려주세요 → 문장 내 모든 단어 KO/FR 목록 (FR 없으면 자동 추정)
  b2.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    const pairs = __pairsFromKo(ko);
    const list  = pairs.map(p=>`<li><b>${p.ko}</b> — ${p.fr}</li>`).join('');
    const html  = `<div class="font-semibold mb-1">📚 Vocabulaire (KO → FR)</div><ul class="list-disc pl-5">${list}</ul>`;
    window.toggleHint(box2, html);
  });

  row.appendChild(b1); row.appendChild(b2);
  wrap.appendChild(box1); wrap.appendChild(box2);
  return [row, wrap];
};

// 전역 위임 토글(폴백): data-target 우선 → 형제 .hint-box
// mkHintRow가 관리하는 박스(dataset.managed='toggleHint')는 건드리지 않음
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.btn-hint1, .btn-hint2, .btn-hint');
  if (!btn) return;

  // 이름 필수 가드
  if (!window.StudentGate?.getName?.() && btn.closest('[data-requires-name]') && !btn.closest('[data-allow-before-name]')){
    e.preventDefault(); e.stopPropagation();
    alert((window.MSG&&window.MSG.needName) || '이름을 먼저 입력해주세요 / Entrez votre nom d’abord.');
    return;
  }

  const card = btn.closest('.card, [data-card], .dictation-card, .quiz-card') || document;
  const sel  = btn.getAttribute('data-target');
  let box = sel ? card.querySelector(sel) : null;
  if (!box){
    const next = btn.nextElementSibling;
    if (next && next.classList?.contains('hint-box')) box = next;
  }
  if (!box || box.dataset.managed === 'toggleHint') return; // mkHintRow 관리 항목은 스킵

  const show = box.style.display === 'none' || !box.style.display;
  box.style.display = show ? 'block' : 'none';
  box.classList.toggle('hidden', !show);
  btn.setAttribute('aria-pressed', show ? 'true' : 'false');

  try {
    const type = btn.classList.contains('btn-hint1') ? 'hint1' :
                 btn.classList.contains('btn-hint2') ? 'hint2' : 'hint';
    btn.dispatchEvent(new CustomEvent('hint-used', { bubbles:true, detail:{ type, shown:show }}));
  } catch {}
});
