<script>
/* assets/results-bridge.js */
(function(){
  'use strict';

  const LS_KEY = 'PONGDANG_RESULTS_V1';

  function getStore(){
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { meta:{}, questions: [] };
    try { return JSON.parse(raw); } catch { return { meta:{}, questions: [] }; }
  }
  function setStore(obj){ localStorage.setItem(LS_KEY, JSON.stringify(obj)); }

  function resetSession(meta){
    const data = { meta: { ...meta, startTime: meta?.startTime || new Date().toISOString() }, questions: [] };
    setStore(data);
  }

  function pushAttempt(q){
    const data = getStore();
    data.questions.push(q);
    setStore(data);
  }

  async function finishAndShow(extraMeta={}){
    const data = getStore();
    data.meta.endTime = new Date().toISOString();
    if (extraMeta.studentName) data.meta.studentName = extraMeta.studentName;

    // 총 소요시간 계산
    const s = new Date(data.meta.startTime).getTime();
    const e = new Date(data.meta.endTime).getTime();
    data.meta.totalTimeSeconds = Math.max(0, Math.round((e - s)/1000));

    setStore(data);

    // 서버 전송 (실패해도 화면 전환은 진행)
    try{
      await fetch('/.netlify/functions/send-results', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          studentName: data.meta.studentName || 'Étudiant·e',
          startTime: data.meta.startTime,
          endTime: data.meta.endTime,
          totalTimeSeconds: data.meta.totalTimeSeconds,
          questions: data.questions
        })
      });
    }catch(err){
      // 전송 실패 로그
      try{
        await fetch('/.netlify/functions/log-error', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ where:'results-bridge.send-results', error:String(err) })
        });
      }catch(_){}
    }

    // 결과 페이지로 이동
    location.href = '/assignments/results.html';
  }

  // 브라우저 호환 오디오 재생 유틸 (base64 → Blob → ObjectURL)
  function base64ToBlob(base64, mime){
    const bin = atob(base64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'audio/webm' });
  }

  function playBase64AudioOnce(base64, mime){
    const blob = base64ToBlob(base64, mime);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener('ended', ()=> URL.revokeObjectURL(url), { once:true });
    audio.play().catch(()=> URL.revokeObjectURL(url));
  }

  // 전역 공개
  window.PONGDANG_RESULTS = {
    resetSession, pushAttempt, finishAndShow, base64ToBlob, playBase64AudioOnce
  };
})();
</script>
