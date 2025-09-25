// assets/results-compat.js
// 결과 전송 공통(슬림화 + 로깅 + 로컬 폴백)
// - window.sendResults(payload) 제공 (results-viewer.js 호환)
// - window.SendResults.sendResults(payload)도 함께 제공

(function (global) {
  'use strict';

  const ENDPT = (global.PONGDANG_FN_BASE || '/.netlify/functions') + '/send-results';
  const KEY_LOCAL = 'pongdang:lastResults';
  const KEY_SESSION = 'pondant_results';

  // ---- 큰 필드 제거(녹음/오디오 등) ----
  function slimResultsPayload(p) {
    try {
      const c = JSON.parse(JSON.stringify(p || {}));
      if (Array.isArray(c.questions)) {
        c.questions.forEach(q => {
          if (!q) return;
          if (q.recording) { delete q.recording.base64; delete q.recording.blob; delete q.recording.file; }
          delete q.audio; delete q.audioBase64; delete q.logs;
        });
      }
      // 학생 이름 비정상 길이 방지
      if (typeof c.studentName === 'string' && c.studentName.length > 8000) {
        c.studentName = c.studentName.slice(0, 8000);
      }
      return c;
    } catch (_) {
      return p;
    }
  }

  // ---- 로컬/세션 저장(결과 페이지용 폴백) ----
  function stash(payload) {
    try { sessionStorage.setItem(KEY_SESSION, JSON.stringify(payload)); } catch(_){}
    try { localStorage.setItem(KEY_LOCAL, JSON.stringify(payload)); } catch(_){}
  }

  // ---- 실제 전송 함수 ----
  async function sendResults(payload) {
    const slim = slimResultsPayload(payload);
    // 전송 전 우선 저장(혹시 실패 시 결과페이지에서 읽을 수 있게)
    stash(slim);

    try {
      const res = await fetch(ENDPT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        mode: 'cors',
        credentials: 'omit',
        body: JSON.stringify(slim)
      });

      const txt = await res.text().catch(()=>'');
      let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

      if (!res.ok || data?.ok === false) {
        console.error('[send-results] HTTP', res.status, data);
        return { ok:false, status:res.status, data };
      }

      return { ok:true, status:res.status, data };
    } catch (err) {
      console.error('[send-results] fetch error', err);
      return { ok:false, error:String(err) };
    }
  }

  // 전역 노출 (두 방식 모두 지원)
  global.sendResults = sendResults;
  global.SendResults = { sendResults };

})(window);

// ===== Results (공용) v1.1 — 전송 유틸만 제공, 자동 실행 없음 =====
;(function(g){
  'use strict';
  if (g.Results && Number(g.Results.__v||0) >= 11) return;

  const FN_BASE = (g.PONGDANG_FN_BASE || '/.netlify/functions');
  const Tr = { startTime: g._startTime || new Date().toISOString(),
               listen:new Map(), hint1:new Map(), hint2:new Map(),
               evals:new Map(), inputs:new Map() };

  function wrapTTS(host, name='tts'){
    const orig = host[name];
    if (typeof orig!=='function' || orig.__wrapped) return;
    host[name] = async (text, ...rest)=>{
      const k=String(text||''); Tr.listen.set(k,(Tr.listen.get(k)||0)+1);
      return orig(text, ...rest);
    };
    host[name].__wrapped = true;
  }

  function onHintUsed(e){
    const t=e?.detail?.type;
    const btn=e.target.closest('.btn');
    const guess=btn?.nextElementSibling?.textContent||'';
    const key=String(guess||''); if(!key) return;
    if (t==='hint1') Tr.hint1.set(key,(Tr.hint1.get(key)||0)+1);
    if (t==='hint2') Tr.hint2.set(key,(Tr.hint2.get(key)||0)+1);
  }

  function onGraded(e){
    const { ref, hyp, score, recDur } = e.detail||{};
    if (!ref) return;
    Tr.evals.set(ref,{ score:Number(score||0),
                       duration:Number(recDur||0),
                       transcript:String(hyp||'') });
  }

  function snapStep1(selector, step1){
    document.querySelectorAll(selector).forEach((card,idx)=>{
      const ko=card.querySelector('input[placeholder^="받아쓰기"]')?.value||'';
      const fr=card.querySelector('input[placeholder^="Sens"]')?.value||'';
      const key=step1[idx]?.ko||''; if(key) Tr.inputs.set(key,{ko,fr});
    });
  }

  function build({ studentName, step1=[], step2=[], step3='' }){
    const endTime=new Date().toISOString();
    const startMs=g._startMs||Date.now();
    const total=Math.max(1,Math.round((Date.now()-startMs)/1000));
    const keys=[...step1.map(x=>x.ko),...step2.map(x=>x.ko),step3].filter(Boolean);
    const questions=keys.map((k,i)=>{
      const inp=Tr.inputs.get(k)||{ko:'',fr:''};
      const ev =Tr.evals.get(k)||{score:0,duration:0,transcript:''};
      const frRef=(step1.find(x=>x.ko===k)?.fr)||'';
      return {
        number:i+1, ko:k, fr:frRef, userAnswer:inp.ko||'',
        isCorrect:!!(ev.score>=60),
        listenCount:Number(Tr.listen.get(k)||0),
        hint1Count:Number(Tr.hint1.get(k)||0),
        hint2Count:Number(Tr.hint2.get(k)||0),
        recording:{ base64:'', filename:'rec.webm', mimeType:'audio/webm', duration:Number(ev.duration||0) },
        asrTranscript: ev.transcript||'',
        pronunScore: Number(ev.score||0)
      };
    });
    return { studentName:String(studentName||''), startTime:g._startTime||new Date(startMs).toISOString(), endTime, totalTimeSeconds:total, questions };
  }

  async function send(pathOrUrl, payload){
    const url=pathOrUrl|| (FN_BASE+'/send-results');
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json().catch(()=>null);
    if (!r.ok || (j&&j.ok===false)) throw new Error((j&&j.error)||'send-results failed');
    return true;
  }

  g.Results={__v:11, wrapTTS, onHintUsed, onGraded, snapStep1, build, send};
})(window);
