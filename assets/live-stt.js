<!-- /assets/live-stt.js -->
<script>
/* 초경량 실시간 받아쓰기(Web Speech API) — 프론트 전용
   - 한국어 ko-KR, 중간결과(interim) 표시
   - pronun-client 녹음 버튼(.btn-rec/.btn-stop)과 함께 동작
   - 각 카드에 .pronun-live 영역 자동 생성 (없으면 만들어줌)
*/
(function(w){
  const ok = ('webkitSpeechRecognition' in w) || ('SpeechRecognition' in w);
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;

  function ensureLiveBox(card){
    let box = card.querySelector('.pronun-live');
    if (!box) {
      box = document.createElement('div');
      box.className = 'pronun-live mt-2 text-sm p-2 rounded border bg-white';
      const anchor = card.querySelector('.status-line') || card;
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }
    return box;
  }
  function setMsg(el, html){ el.innerHTML = html; }

  function attachCard(card){
    const startBtn = card.querySelector('.btn-rec, .btn-rec-start');
    const stopBtn  = card.querySelector('.btn-stop, .btn-rec-stop');
    if (!startBtn || !stopBtn) return;
    const live = ensureLiveBox(card);

    if (!ok){
      setMsg(live, '🗣️ Live STT indisponible sur ce navigateur. / 이 브라우저는 실시간 받아쓰기를 지원하지 않아요.');
      return;
    }

    let rec=null, started=false;
    function makeRec(){
      const r = new SR();
      r.lang='ko-KR';
      r.interimResults = true;
      r.continuous = true;
      r.maxAlternatives = 1;

      let finalText = '', interimText = '';
      r.onresult = (e)=>{
        interimText = '';
        for(let i=e.resultIndex; i<e.results.length; i++){
          const res = e.results[i];
          if(res.isFinal){ finalText += res[0].transcript; }
          else { interimText += res[0].transcript; }
        }
        setMsg(live, `<div><b>Live:</b> ${finalText}<span class="opacity-60">${interimText}</span></div>`);
      };
      r.onerror = ()=>{ /* 조용히 무시(권한/중복 등) */ };
      r.onend = ()=>{ started=false; };
      return r;
    }

    startBtn.addEventListener('click', ()=>{
      if (!ok) return;
      try{
        if (!rec) rec = makeRec();
        if (!started){ rec.start(); started=true; setMsg(live, '🎧 Écoute en cours… / 실시간 인식 중…'); }
      }catch(_){}
    });
    stopBtn.addEventListener('click', ()=>{
      if (!ok) return;
      try{ rec && rec.stop(); }catch(_){}
    });
  }

  function init(rootSel='.quiz-container'){
    document.querySelectorAll(rootSel).forEach(container=>{
      container.querySelectorAll('.p-4.bg-white.rounded-lg.border, .quiz-card, .bundle-card').forEach(attachCard);
    });
  }

  w.LiveSTT = { init };
  document.addEventListener('DOMContentLoaded', ()=>{ try{ init(); }catch(_){ } });
})(window);
</script>
