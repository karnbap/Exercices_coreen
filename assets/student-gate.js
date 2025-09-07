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
