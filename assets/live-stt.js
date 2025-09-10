<script>
/* 실시간 받아쓰기(Web Speech API)
   - ko-KR 인식, interim(중간결과) 표시
   - 자동 연결: .dictation-card / .quiz-card / .bundle-card
   - 버튼: .btn-rec(.btn-rec-start) 시작, .btn-stop(.btn-rec-stop) 정지
   - 표시는 .pronun-live 박스에 타이핑처럼 출력
   - mount(card, {lang?, target?}) 지원 (명시 장착용)
   - 이벤트: 'livestt:partial' / 'livestt:final'  (detail: { text, card })
*/
(function(w){
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  const supported = !!SR;

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,(c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]))); }

  function ensureBox(card, target){
    if (target) return target;
    let box = card.querySelector('.pronun-live');
    if (!box) {
      box = document.createElement('div');
      box.className = 'pronun-live mt-2 text-sm p-2 rounded border bg-white';
      const anchor = card.querySelector('.status-line') || card.firstElementChild || card;
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }
    return box;
  }

  // 타이핑 효과(이전 결과와 차이만 반투명)
  function renderTyping(el, prev, next){
    let i=0; const L=Math.min(prev.length, next.length);
    while(i<L && prev[i]===next[i]) i++;
    const frozen = next.slice(0,i), typing = next.slice(i);
    el.innerHTML =
      `<div><b>Live:</b> <span class="text-slate-800">${escapeHtml(frozen)}</span>`+
      `<span class="opacity-60">${escapeHtml(typing)}</span></div>`;
  }

  function attach(card, opts={}){
    const startBtn = card.querySelector('.btn-rec, .btn-rec-start');
    const stopBtn  = card.querySelector('.btn-stop, .btn-rec-stop');
    if(!startBtn || !stopBtn) return;

    const box = ensureBox(card, opts.target);
    if(!supported){
      box.innerHTML = '🗣️ Live STT indisponible. / 이 브라우저는 실시간 받아쓰기를 지원하지 않아요.';
      return;
    }

    const lang = opts.lang || 'ko-KR';
    let rec=null, started=false, prevShown='';
    function make(){
      const r = new SR();
      r.lang = lang; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
      let finalText='', interim='';
      r.onresult = (e)=>{
        interim='';
        for(let i=e.resultIndex;i<e.results.length;i++){
          const res=e.results[i];
          if(res.isFinal){ finalText += res[0].transcript; }
          else { interim += res[0].transcript; }
        }
        const merged = (finalText + interim).trim();
        renderTyping(box, prevShown, merged);
        prevShown = merged;
        card.dispatchEvent(new CustomEvent('livestt:partial',{ detail:{ text: merged, card }, bubbles:true }));
        if (interim==='') {
          card.dispatchEvent(new CustomEvent('livestt:final',{ detail:{ text: finalText.trim(), card }, bubbles:true }));
        }
      };
      r.onerror = ()=>{}; r.onend = ()=>{ started=false; };
      return r;
    }

    // 녹음 시작/정지 신호에 맞춰 STT 동작 (외부에서 커스텀 이벤트로도 제어 가능)
    startBtn.addEventListener('click', ()=>{
      try{
        prevShown=''; box.innerHTML = '<div class="opacity-60">🎧 실시간 인식 중…</div>';
        if(!rec) rec=make();
        if(!started){ rec.start(); started=true; }
      }catch(_){}
    });
    stopBtn.addEventListener('click', ()=>{ try{ rec && rec.stop(); }catch(_){ } });

    card.addEventListener('recording:start', ()=>{ startBtn.click(); });
    card.addEventListener('recording:stop',  ()=>{ stopBtn.click();  });
  }

  function init(rootSel = '#dictation-exercises, .quiz-container, #warmup-screen'){
    document.querySelectorAll(rootSel).forEach(container=>{
      container
        .querySelectorAll('.p-4.bg-white.rounded-lg.border, .quiz-card, .bundle-card, .dictation-card')
        .forEach(card=>attach(card));
    });
  }

  // 명시 장착 API
  function mount(card, opts){ try{ attach(card, opts||{}); }catch(_){ } }

  w.LiveSTT = { init, supported, mount };
  document.addEventListener('DOMContentLoaded', ()=>{ try{ init(); }catch(_){} });
})(window);
</script>
