/* assets/student-gate.js */
;(function (global) {
  const LS_KEY = 'korean:studentName';

  const NAMES = [
    'Julie','Lucas','Emma','Louis','Camille','Maxime','Léa','Hugo',
    'Chloé','Arthur','Zoé','Gabriel','Manon','Paul','Inès','Noah'
  ];
  function pickName(){ return NAMES[Math.floor(Math.random()*NAMES.length)]; }

  function getName() { return (localStorage.getItem(LS_KEY) || '').trim(); }
  function setName(n){ localStorage.setItem(LS_KEY, (n||'').trim()); }

  function blockPage() {
    const overlay = document.createElement('div');
    overlay.id = 'student-gate-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.35);
      display:flex;align-items:center;justify-content:center;z-index:99999;
      backdrop-filter: blur(2px);
    `;
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.15);
                  width:min(680px,92vw);padding:22px 22px">
        <h2 style="margin:0 0 10px 0;font-size:22px">
          ✍️ Nom de l'élève / 학생 이름
        </h2>
        <p style="margin:0 0 10px 0;color:#444;font-size:14px">
          Entrez votre nom pour commencer. / 시작하려면 이름을 적어 주세요.
        </p>
        <div style="display:flex;gap:10px;align-items:center;margin-top:8px">
          <input id="sg-name" type="text" placeholder="Ex. ${pickName()}"
                 style="flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:16px"/>
          <button id="sg-save" style="padding:10px 16px;border:none;border-radius:10px;
                  background:#2563eb;color:#fff;font-weight:600;cursor:pointer">
            OK / 확인
          </button>
        </div>
        <p style="margin:8px 0 0 0;font-size:12px;color:#666">
          Astuce: vous pourrez le changer plus tard. / 팁: 나중에 바꿀 수 있어요.
        </p>
      </div>
    `;
    document.body.appendChild(overlay);

    function save() {
      const v = String(document.getElementById('sg-name').value || '').trim();
      if (!v) {
        document.getElementById('sg-name').focus();
        return;
      }
      setName(v);
      overlay.remove();
      document.dispatchEvent(new CustomEvent('student-ready', { detail: { name: v }}));
    }
    overlay.querySelector('#sg-save').addEventListener('click', save);
    overlay.querySelector('#sg-name').addEventListener('keydown', (e)=>{ if(e.key==='Enter') save(); });
    setTimeout(()=>overlay.querySelector('#sg-name').focus(), 0);
  }

  function init() {
    if (!getName()) blockPage();
  }

  function requireBeforeInteraction(root=document) {
    if (getName()) return;
    root.addEventListener('click', gateHandler, true);
    root.addEventListener('keydown', gateHandler, true);
    function clean(){ root.removeEventListener('click', gateHandler, true); root.removeEventListener('keydown', gateHandler, true); }
    document.addEventListener('student-ready', clean, { once:true });
  }
  function gateHandler(e){
    const el = e.target;
    // 이름 관련 UI는 통과
    if (document.getElementById('student-gate-overlay')?.contains(el)) return;
    e.preventDefault(); e.stopPropagation();
    blockPage();
  }

  global.StudentGate = { init, getName, setName, requireBeforeInteraction };
})(window);

// ===== Global fetch middleware for send-results (put at bottom of assets/student-gate.js) =====
(function(){
  if (window.__sendResultsFetchWrapped) return;
  window.__sendResultsFetchWrapped = true;

  const SEND_PATH = '/.netlify/functions/send-results';
  const LOG_PATH  = '/.netlify/functions/log-error';
  const origFetch = window.fetch.bind(window);

  // helper: safe JSON parse
  function safeJson(s){ try { return JSON.parse(s || '{}'); } catch { return {}; } }

  window.fetch = async function(input, init) {
    const url = (typeof input === 'string') ? input : (input && input.url) || '';

    // Non target fetch → 그대로 통과
    if (!url.includes(SEND_PATH)) {
      return origFetch(input, init);
    }

    // ---- send-results 요청만 가로채서 응답 전문 로깅 ----
    let bodyPreview = {};
    try {
      // JSON string body만 간단 프리뷰 (학생이름/문항수)
      const bodyStr = init && typeof init.body === 'string' ? init.body : '';
      const p = safeJson(bodyStr);
      bodyPreview = {
        studentName: p.studentName || 'N/A',
        totalQ: Array.isArray(p.questions) ? p.questions.length : 0
      };
    } catch(_) {}

    // 실제 요청
    const resp = await origFetch(input, init);

    // 응답 전문 확보(원본 resp는 clone해서 본문 추출)
    let text = '';
    try { text = await resp.clone().text(); } catch(_) {}

    // 실패/서버오류 또는 {ok:false} 형태면 에러 메일로 보냄
    let j = null; try { j = text ? JSON.parse(text) : null; } catch(_) {}
    if (!resp.ok || (j && j.ok === false)) {
      // fire-and-forget: 서버로 에러 전문 전송
      origFetch(LOG_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          functionName: 'send-results',
          pageUrl: location.href,
          status: resp.status,
          statusText: resp.statusText,
          respBody: text,
          payloadPreview: bodyPreview,
          ua: navigator.userAgent
        })
      }).catch(()=>{});
    }

    return resp; // 원래 흐름 유지
  };
})();

