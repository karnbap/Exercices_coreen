// assets/live-stt.js
// 브라우저 Web Speech API 기반 실시간 STT 모듈
// - LiveSTT.mount(cardEl, { lang:'ko-KR', target: <.pronun-live 엘리먼트> })
// - cardEl에서 'recording:start' → SR 시작, 'recording:stop' → SR 중지
// - 종료 시 cardEl로 'livestt:final' 이벤트 디스패치(detail:{ text })

(function(w){
  'use strict';
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  const supported = !!SR;

  // 카드별 상태를 저장
  const store = new WeakMap(); // cardEl -> { rec, finalText, target }

  function mount(cardEl, opts={}){
    if(!cardEl || store.has(cardEl)) return;
    const lang   = opts.lang || 'ko-KR';
    const target = opts.target || cardEl.querySelector('.pronun-live');

    const state = { rec:null, finalText:'', target };
    store.set(cardEl, state);

    const onStart = ()=>{
      if(!supported || !state.target) return;
      if(state.rec){ try{ state.rec.stop(); }catch(_){} state.rec=null; }
      const rec = new SR();
      state.rec = rec; state.finalText = '';
      rec.lang = lang; rec.interimResults = true; rec.continuous = true;

      let interim = '';
      rec.onresult = (e)=>{
        interim = '';
        for(let i=e.resultIndex;i<e.results.length;i++){
          const r = e.results[i];
          if(r.isFinal) state.finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        state.target.classList.remove('hidden');
        state.target.innerHTML =
          `<div class="text-sm">
            <b>Live (Référence / 정답):</b> <span class="korean-font">${state.target.dataset.ref||''}</span><br/>
            <b>Live (Moi / 내 발음):</b> <span>${state.finalText}</span><span class="opacity-60">${interim}</span>
           </div>`;
      };
      rec.onerror = ()=>{};
      rec.onend   = ()=>{
        try{
          const evt = new CustomEvent('livestt:final',{ detail:{ text: (state.finalText||'').trim() }});
          cardEl.dispatchEvent(evt);
        }catch(_){}
      };
      try{ rec.start(); }catch(_){}
    };

    const onStop = ()=>{
      if(state.rec){ try{ state.rec.stop(); }catch(_){}
        state.rec = null;
      }
    };

    cardEl.addEventListener('recording:start', onStart);
    cardEl.addEventListener('recording:stop',  onStop);
  }

  function init(){
    document.querySelectorAll('.pronun-live').forEach(el=>{
      const card = el.closest('[data-card="warmup"]') || el.parentElement;
      if(card) mount(card, { lang:'ko-KR', target: el });
    });
  }

  w.LiveSTT = { supported, mount, init };
})(window);
