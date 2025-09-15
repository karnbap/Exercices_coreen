// assets/results-compat.js
// Résultats (commun) — 슬림화 + 안전 전송 + 자동 캡처(sessionStorage)
// Config: window.PONDANT_RESULTS_URL, window.PONDANT_LOG_URL 로 엔드포인트 커스텀 가능

(function (global) {
  'use strict';

  const ENDPT = String(global.PONDANT_RESULTS_URL || '/.netlify/functions/send-results');
  const LOGPT = String(global.PONDANT_LOG_URL    || '/.netlify/functions/log-error');
  const KEY   = 'pondant_results';

  // ---------- 유틸 ----------
  function cloneJson(x){ try{ return JSON.parse(JSON.stringify(x||{})); }catch(_){ return x; } }
  function nowISO(){ return new Date().toISOString(); }
  function avg(arr){ const a=(arr||[]).map(Number).filter(Number.isFinite); return a.length? a.reduce((s,n)=>s+n,0)/a.length : 0; }
  function toInt(n){ n=Number(n); return Number.isFinite(n)? Math.round(n) : 0; }

  // ---------- 1) 페이로드 슬림화 ----------
  function slimResultsPayload(p) {
    const c = cloneJson(p)||{};
    try{
      // 거대 필드 제거(녹음/오디오)
      if (Array.isArray(c.questions)) {
        c.questions.forEach(q=>{
          if(q?.recording){
            delete q.recording.base64;
            delete q.recording.blob;
            // duration/filename/mimeType 등 메타는 유지
          }
          if(q){ delete q.audio; delete q.audioBase64; }
        });
      }
      // 학생 이름 과대 방지
      if (typeof c.studentName==='string' && c.studentName.length>8000) {
        c.studentName = c.studentName.slice(0,8000);
      }
      // 시간/총시간 보정
      const s = c.startTime || nowISO();
      const e = c.endTime   || nowISO();
      c.startTime = s; c.endTime = e;
      if (!Number.isFinite(Number(c.totalTimeSeconds))) {
        const dt = (new Date(e)-new Date(s))/1000;
        c.totalTimeSeconds = Math.max(0, Math.floor(dt));
      } else { c.totalTimeSeconds = Number(c.totalTimeSeconds)||0; }

      // totals 없으면 평균으로 생성(ko / fr / pron)
      if (!c.totals) {
        const N = Math.max(1, (c.questions||[]).length);
        let ko=[], fr=[], pr=[];
        (c.questions||[]).forEach(q=>{
          if(q?.scores?.ko!=null)   ko.push(q.scores.ko);
          if(q?.scores?.fr!=null)   fr.push(q.scores.fr);
          if(q?.scores?.pron!=null) pr.push(q.scores.pron);
        });
        c.totals = {
          ko: toInt(ko.length? avg(ko) : 0),
          fr: toInt(fr.length? avg(fr) : 0),
          pron: toInt(pr.length? avg(pr) : 0),
          n: N
        };
      }
    }catch(_){}
    return c;
  }

  // ---------- 2) 클라이언트 측 저장(sessionStorage) ----------
  function saveLocal(payload){
    try{
      const data = slimResultsPayload(payload);
      sessionStorage.setItem(KEY, JSON.stringify(data));
      return data;
    }catch(_){ return null; }
  }
  function readLocal(){
    try{ return JSON.parse(sessionStorage.getItem(KEY)||'null'); }catch(_){ return null; }
  }
  function openResults(){ location.href = '/assignments/results.html'; }

  // ---------- 3) 결과 전송(재시도+로그) ----------
  async function logClientError(info){
    try{
      await fetch(LOGPT, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ where:'client/send-results', ua:navigator.userAgent, ...info })
      });
    }catch(_){}
  }

  async function sendOnce(bodyStr){
    const res = await fetch(ENDPT, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      mode:'cors',
      body: bodyStr
    });
    if(!res.ok){
      const detail = await res.text().catch(()=> '');
      await logClientError({ status: res.status, detail });
      throw new Error(`send-results ${res.status}`);
    }
    return res.json();
  }

 async function sendResults(payload) {
  const slim = slimResultsPayload(payload);
  try {
    const res = await fetch('/.netlify/functions/send-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      mode: 'cors',
      credentials: 'omit',
      body: JSON.stringify(slim)
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw:text }; }
    if (!res.ok) {
      console.error('[send-results] HTTP', res.status, data);
      alert('Envoi échoué. / 전송 실패 (서버 응답 확인 필요)');
      return { ok:false, status:res.status, data };
    }
    return { ok:true, status:res.status, data };
  } catch (err) {
    console.error('[send-results] fetch error', err);
    alert('Envoi échoué. / 전송 실패 (네트워크 오류)');
    return { ok:false, error:String(err) };
  }
}


  // ---------- 4) “기존 페이지 수정 없이” 자동 캡처 ----------
  // fetch 가로채기
  const _fetch = global.fetch;
  if (typeof _fetch === 'function'){
    global.fetch = async function(resource, init){
      try{
        const url = typeof resource==='string' ? resource : (resource?.url || '');
        if (url.includes(ENDPT) && init?.method==='POST' && init?.body) {
          if (!(init.body instanceof Blob) && !(init.body instanceof FormData)) {
            const text = typeof init.body==='string' ? init.body : await(new Response(init.body)).text();
            try{ saveLocal(JSON.parse(text)); }catch(_){}
          }
        }
      }catch(_){}
      return _fetch.apply(this, arguments);
    };
  }

  // XHR 가로채기
  if (global.XMLHttpRequest) {
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(m,u){
      this.__pdHook = (m==='POST' && String(u||'').includes(ENDPT));
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(b){
      try{
        if (this.__pdHook && b) {
          if (typeof b==='string') { saveLocal(JSON.parse(b)); }
          else { try{ saveLocal(JSON.parse(String(b))); }catch(_){} }
        }
      }catch(_){}
      return _send.apply(this, arguments);
    };
  }

  // ---------- 5) 공개 API ----------
  global.SendResults = {
    sendResults,        // 서버 전송(+재시도)
    slimResultsPayload, // 사전 슬림화
    saveLocal, readLocal,
    openResults         // 결과 페이지 열기
  };

})(window);
