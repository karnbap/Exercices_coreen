<!-- /assets/live-stt.js -->
<script>
/* 실시간 받아쓰기(Web Speech API) – 프론트 표시 전용
   - ko-KR 인식, interim(중간결과) 활성화
   - 각 문제 카드에서 .btn-rec(.btn-rec-start), .btn-stop(.btn-rec-stop)을 자동 연결
   - .pronun-live 박스를 자동 생성해 "한 글자씩" 타이핑처럼 표시
   - CustomEvent: 'livestt:partial' / 'livestt:final' (detail: {text, card})
*/
(function(w){
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  const supported = !!SR;

  function ensureBox(card){
    let box = card.querySelector('.pronun-live');
    if (!box) {
      box = document.createElement('div');
      box.className = 'pronun-live mt-2 text-sm p-2 rounded border bg-white';
      const anchor = card.querySelector('.status-line') || card.firstElementChild || card;
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }
    return box;
  }

  // 글자 단위 타이핑 효과(이전 결과와의 차이만 추가)
  function renderTyping(el, prev, next){
    // 이미 확정된 부분 찾기
    let i=0; const L=Math.min(prev.length, next.length);
    while(i<L && prev[i]===next[i]) i++;
    const frozen = next.slice(0,i);          // 변함없는 앞부분(확정)
    const typing = next.slice(i);            // 새로 들어온 부분
    el.innerHTML =
      `<div><b>Live:</b> <span class="text-slate-800">${escapeHtml(frozen)}</span>`+
      `<span class="opacity-60">${escapeHtml(typing)}</span></div>`;
  }

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,(c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]))); }

  function attach(card){
    const startBtn = card.querySelector('.btn-rec, .btn-rec-start');
    const stopBtn  = card.querySelector('.btn-stop, .btn-rec-stop');
    if(!startBtn || !stopBtn) return;

    const box = ensureBox(card);
    if(!supported){
      box.innerHTML = '🗣️ Live STT indisponible. / 이 브라우저는 실시간 받아쓰기를 지원하지 않아요.';
      return;
    }

    let rec=null, started=false, prevShown='';
    function make(){
      const r = new SR();
      r.lang='ko-KR'; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
      let finalText='', interim='';
      r.onresult = (e)=>{
        interim='';
        for(let i=e.resultIndex;i<e.results.length;i++){
          const res=e.results[i];
          if(res.isFinal){ finalText += res[0].transcript; }
          else { interim += res[0].transcript; }
        }
        const merged = finalText + interim;
        renderTyping(box, prevShown, merged);
        prevShown = merged;
        card.dispatchEvent(new CustomEvent('livestt:partial',{ detail:{ text: merged, card }, bubbles:true }));
        if (interim==='') {
          card.dispatchEvent(new CustomEvent('livestt:final',{ detail:{ text: finalText, card }, bubbles:true }));
        }
      };
      r.onerror = ()=>{}; r.onend = ()=>{ started=false; };
      return r;
    }

    startBtn.addEventListener('click', ()=>{
      try{
        prevShown=''; box.innerHTML = '<div class="opacity-60">🎧 실시간 인식 중…</div>';
        if(!rec) rec=make();
        if(!started){ rec.start(); started=true; }
      }catch(_){}
    });
    stopBtn.addEventListener('click', ()=>{ try{ rec && rec.stop(); }catch(_){ } });
  }

// ✅ 교체: /assets/live-stt.js 의 init 함수 통째로
function init(rootSel = '#dictation-exercises, .quiz-container, #warmup-screen'){
  document.querySelectorAll(rootSel).forEach(container=>{
    container
      .querySelectorAll('.p-4.bg-white.rounded-lg.border, .quiz-card, .bundle-card, .dictation-card')
      .forEach(attach);
  });


  w.LiveSTT = { init, supported };
  document.addEventListener('DOMContentLoaded', ()=>{ try{ init(); }catch(_){} });
})(window);
</script>
