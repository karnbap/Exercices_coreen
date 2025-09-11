<script>
/* 기존 페이지 수정 없이 send-results POST를 가로채 sessionStorage 저장 */
(function(){
  'use strict';
  const KEY='pondant_results', ENDPT='/.netlify/functions/send-results';
  function savePayload(body){
    try{
      const data = typeof body==='string' ? JSON.parse(body) : body;
      if(!data||!data.questions) return;
      const now=new Date().toISOString();
      data.startTime=data.startTime||now; data.endTime=data.endTime||now;
      data.totalTimeSeconds=Number(data.totalTimeSeconds||0);
      if(!data.totals){
        let ko=0,fr=0,pr=0,n=Math.max(1,(data.questions||[]).length);
        (data.questions||[]).forEach(q=>{
          if(q?.scores?.ko) ko+=Number(q.scores.ko)||0;
          if(q?.scores?.fr) fr+=Number(q.scores.fr)||0;
          if(q?.scores?.pron) pr+=Number(q.scores.pron)||0;
        });
        data.totals={ ko:Math.round(ko/n), fr:Math.round(fr/n), pron:Math.round(pr/n) };
      }
      sessionStorage.setItem(KEY, JSON.stringify(data));
    }catch(_){}
  }
  const _fetch=window.fetch;
  window.fetch=async function(resource,init){
    try{
      const url=typeof resource==='string'?resource:(resource?.url||'');
      if(url.includes(ENDPT)&&init?.method==='POST'&&init?.body){
        if(!(init.body instanceof Blob)&&!(init.body instanceof FormData)){
          const t=typeof init.body==='string'?init.body:await(new Response(init.body)).text();
          savePayload(t);
        }
      }
    }catch(_){}
    return _fetch.apply(this, arguments);
  };
  const _open=XMLHttpRequest.prototype.open, _send=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){ this.__pd=(m==='POST'&&String(u||'').includes(ENDPT)); return _open.apply(this,arguments); };
  XMLHttpRequest.prototype.send=function(b){ try{ if(this.__pd&&b) savePayload(b); }catch(_){}
    return _send.apply(this,arguments); };
  window.PONDANT_OPEN_RESULTS=()=>location.href='/assignments/results.html';
})();
</script>
