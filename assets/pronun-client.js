// assets/pronun-client.js  (v4.8 final)
// 공용 발음기: Pronun.mount(el, { getReferenceText:()=>string, onResult:(res)=>void, ui:'classic'|'warmup', maxSeconds?:number })
// - 실시간 경과시간 표시(예: "🎙️ 녹음 중… 1.3 s")
// - maxSeconds(기본 12초) 옵션/전역 오버라이드 지원(PRONUN_MAX_SEC)
// - 짧은 녹음/에러 시에도 항상 재녹음 가능(버튼 복구)
// - 서버측 보정 비활성 요청(strictTranscript/disableLM)
// - 공용 위젯이라 모든 미래 연습문제에 자동 적용
(function (global) {
  'use strict';

  // 중복 로드 가드
  if (global.Pronun && Number(global.Pronun.__v||0) >= 48) return;

  // 기본 UI 모드(외부에서 window.PRONUN_UI_DEFAULT='warmup' 등 지정 가능)
  global.PRONUN_UI_DEFAULT = global.PRONUN_UI_DEFAULT || 'classic';

  // ===== 설정 =====
  const CFG = {
    endpoint: (global.PONGDANG_FN_BASE || '/.netlify/functions') + '/analyze-pronunciation',
    minSec: 1.0,           // ⏱️ 최소 발화 길이
    maxSec: 12,            // ⏱️ 최대 녹음 길이(실시간 타이머/자동정지에 사용)
    canvasW: 240, canvasH: 40,
    passBase: 0.75, passShortRef: 0.80, shortRefLen: 4,
    lowSimil: 0.35, lenRatioGarbage: 2.5,
    garbageWords: [
      '배달의민족','영상편집','자막','광고','구독','좋아요','알림설정','스폰서',
      '후원','협찬','문의','링크','다운로드','설명란','채널','스트리밍','썸네일',
      '유튜브','클릭','이벤트','특가','광고주','제휴','비디오','구매','할인'
    ]
  };
  // 전역 오버라이드(선택)
  if (Number.isFinite(global.PRONUN_MIN_SEC)) {
    CFG.minSec = Math.max(0.5, Number(global.PRONUN_MIN_SEC));
  }
  if (Number.isFinite(global.PRONUN_MAX_SEC)) {
    CFG.maxSec = Math.max(CFG.minSec + 1, Number(global.PRONUN_MAX_SEC));
  }
  // ---- AudioContext singleton & safe closer ----
let __pdAudioCtx = null;

function pdGetAudioCtx() {
  if (__pdAudioCtx && __pdAudioCtx.state !== 'closed') return __pdAudioCtx;
    __pdAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return __pdAudioCtx;
}

async function pdSafeCloseCtx() {
  if (!__pdAudioCtx) return;
  try {
    // 이미 closed면 아무 것도 안 함
    if (__pdAudioCtx.state === 'closed') { __pdAudioCtx = null; return; }
    // 수업 도중에는 suspend까지만 (재개 가능)
    await __pdAudioCtx.suspend();
  } catch (_) {}
}

// 탭/페이지 떠날 때만 실제 close
window.addEventListener('pagehide', async () => {
  if (__pdAudioCtx && __pdAudioCtx.state !== 'closed') {
    try { await __pdAudioCtx.close(); } catch (_) {}
    __pdAudioCtx = null;
  }
});

  // ===== Utils =====
  const $ = (s, r=document)=>r.querySelector(s);

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
    }
    kids.forEach(k => el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
    return el;
  }

  function pickMime() {
    const M = window.MediaRecorder;
    if (!M || !M.isTypeSupported) return 'audio/webm';
    if (M.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
    if (M.isTypeSupported('audio/webm')) return 'audio/webm';
    if (M.isTypeSupported('audio/mp4')) return 'audio/mp4';
    return 'audio/webm';
  }

  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = rej;
      fr.onload = () => res(String(fr.result || '').split(',')[1] || '');
      fr.readAsDataURL(blob);
    });
  }

  async function postJSON(url, payload) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) { const t = await r.text().catch(()=> ''); throw new Error(`HTTP ${r.status} ${t}`); }
    return r.json();
  }

  function normalizeKo(s){
    if(!s) return { raw:'', ko:'' };
    let t = String(s).toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF]/g,'')
      .replace(/[.,!?;:()[\]{}"“”'‘’`~^%$#+=<>…]/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    const onlyKo = t.replace(/[^ㄱ-ㅎ가-힣0-9\s]/g,'').replace(/\s+/g,'').trim();
    return { raw:t, ko:onlyKo };
  }

  function similarity(a, b){
    if(a===b) return 1; const m=a.length,n=b.length; if(!m||!n) return 0;
    const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
    for(let i=0;i<=m;i++) dp[i][0]=i; for(let j=0;j<=n;j++) dp[0][j]=j;
    for(let i=1;i<=m;i++)for(let j=1;j<=n;j++){
      const cost = a[i-1]===b[j-1]?0:1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
    return 1 - (dp[m][n] / Math.max(m,n));
  }

  // 숫자/날짜 간단 보정(로컬)
  function localForceHangulNumbers(s){
    let x = String(s||'');
    x = x.replace(/\b1\b/g,'일').replace(/\b2\b/g,'이');
    x = x.replace(/(^|[^0-9])1([^0-9]|$)/g,'$1일$2');
    x = x.replace(/(^|[^0-9])2([^0-9]|$)/g,'$1이$2');
    return x;
  }

  // 참조 형태로 유도(자주 헷갈리는 페어 교정)
  function coerceTowardsRef(refRaw, hypRaw) {
    let out = hypRaw; const ref = refRaw.replace(/\s+/g,''), hyp = hypRaw.replace(/\s+/g,'');
    const RULES = [
      { when: /^일$/,  hyp: /^(하나|한|1|Ⅰ)$/, to:'일' },
      { when: /^이$/,  hyp: /^(둘|두|2|Ⅱ)$/,   to:'이' },
      { when: /^(일일)$/, hyp: /(한일|하닐|한닐|1일|Ⅰ일)/, to:'일일' },
      { when: /^(이일)$/, hyp: /(두일|둘일|2일|Ⅱ일)/,       to:'이일' },
      { when: /사일/,     hyp: /(네일|내일)/,           to:'사일' },
      { when: /한시/,     hyp: /일시/,                  to:'한시' },
      { when: /십유로/,   hyp: /열유로/,                to:'십유로' },
      { when: /삼십분/,   hyp: /서른분/,                to:'삼십분' },
      { when: /세살/,     hyp: /삼살/,                  to:'세살' }
    ];
    for (const r of RULES) if (r.when.test(ref) && r.hyp.test(hyp)) return r.to;
    return out;
  }

  // === Garbage transcript guard ===
  function isGarbageTranscript(refN, hypN, rawTranscript, durSec) {
    const koRef = refN?.ko || ''; const koHyp = hypN?.ko || ''; const raw = String(rawTranscript || '').trim();
    if (!Number.isFinite(durSec) || durSec < CFG.minSec) return { bad:true, reason:'too_short' };
    if (!koHyp || koHyp.length < 2) return { bad:true, reason:'empty_or_tiny' };
    const rawNoSpace = (hypN.raw || '').replace(/\s+/g,'');
    const koRatio = hypN.ko.length / Math.max(1, rawNoSpace.length);
    if (koRatio < 0.35) return { bad:true, reason:'low_korean_ratio' };
    if (koRef && koHyp.length > Math.max(6, koRef.length * CFG.lenRatioGarbage))
      return { bad:true, reason:'too_long_vs_ref' };
    if (CFG.garbageWords.some(w => raw.includes(w))) return { bad:true, reason:'blacklist' };
    const sim = similarity(koRef, koHyp);
    if (koRef && koRef.length >= CFG.shortRefLen && sim < CFG.lowSimil)
      return { bad:true, reason:'very_low_similarity' };
    return { bad:false };
  }

  // === 실패/짧은녹음 시 재시도 가능하게 복구 ===
  function _recoverToReady(ui){
    if (!ui) return;
    if (ui.btnStart) ui.btnStart.disabled = false;
    if (ui.btnStop)  ui.btnStop.disabled  = true;
    if (ui.btnEval)  ui.btnEval.disabled  = true;
    if (typeof global.PRONUN_ON_SHORT === 'function') {
      try { global.PRONUN_ON_SHORT(CFG.minSec); } catch(_){}
    }
  }

  // ===== 공용 UI 빌더 =====
  function buildVUCanvas(w,h){
    const c = document.createElement('canvas'); c.width=w; c.height=h;
    c.className = 'mt-1 w-full'; return c;
  }

  function buildClassicUI(root){
    const ui = {};
    root.classList.add('pronun-classic');
    const title = h('div', { class:'text-sm text-slate-600 mb-1' }, '🎤 Enregistrer & tester / 녹음·발음 평가');
    const ctrl  = h('div', { class:'flex items-center gap-2 mb-1' });
    ui.btnStart = h('button', { class:'btn btn-secondary' }, 'Démarrer');
    ui.btnStop  = h('button', { class:'btn btn-outline', disabled:'' }, '■ Stop');
    ui.btnEval  = h('button', { class:'btn btn-primary', disabled:'' }, 'Évaluer');
    ctrl.append(ui.btnStart, ui.btnStop, ui.btnEval);

    ui.canvas = buildVUCanvas(CFG.canvasW, CFG.canvasH);
    ui.msg = h('div', { class:'text-sm text-slate-600 mt-1' }, 'Démarrer → Arrêter → Évaluer.');

    root.append(title, ctrl, ui.canvas, ui.msg);
    return ui;
  }

  function buildWarmupUI(root){
    const ui = {};
    root.classList.add('pronun-warmup');
    const title = h('div', { class:'text-sm text-slate-600 mb-1' }, '🎤 Enregistrer & tester / 녹음·발음 평가');

    const ctrl  = h('div', { class:'flex flex-wrap gap-2 mb-2' });
    ui.btnStart = h('button', { class:'px-3 py-1 rounded bg-emerald-600 text-white' }, '● Rec');
    ui.btnStop  = h('button', { class:'px-3 py-1 rounded bg-slate-300', disabled:'' }, '■ Stop');
    ui.btnEval  = h('button', { class:'px-3 py-1 rounded bg-blue-600 text-white', disabled:'' }, '✔ Évaluer');
    ctrl.append(ui.btnStart, ui.btnStop, ui.btnEval);

    ui.canvas = buildVUCanvas(CFG.canvasW, CFG.canvasH);
    ui.msg = h('div', { class:'text-xs text-slate-600 mt-1' }, 'Démarrer → Arrêter → Évaluer.');

    root.append(title, ctrl, ui.canvas, ui.msg);
    return ui;
  }

  // ===== 녹음 내부 =====
function makeRecorder(drawCanvas){
    let mediaRecorder=null, chunksLocal=[], raf=0, ac=null, analyser=null, stream=null, mime='audio/webm', tStart=0;

    function clearCanvas(){
      if (!drawCanvas) return;
      const g = drawCanvas.getContext('2d'); g.clearRect(0,0,drawCanvas.width,drawCanvas.height);
    }

    async function start(){
      stop(); // 중복 방지
      stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      mime = pickMime();
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType:mime }) : new MediaRecorder(stream);
      tStart = performance.now();

      chunksLocal = [];
      mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) chunksLocal.push(e.data); };

      ac = pdGetAudioCtx(); // 전역 싱글턴 AudioContext
    const source = ac.createMediaStreamSource(stream);

      analyser = ac.createAnalyser(); analyser.fftSize = 512;
      source.connect(analyser);

      const g = drawCanvas.getContext('2d'), w = drawCanvas.width, h = drawCanvas.height;
      const data = new Uint8Array(analyser.frequencyBinCount);
      (function loop(){
        raf = requestAnimationFrame(loop);
        analyser.getByteFrequencyData(data);
        g.clearRect(0,0,w,h);
        g.fillStyle = '#6366f1';
        const bars=32, step=Math.floor(data.length/bars);
        for(let i=0;i<bars;i++){
          const v=data[i*step]/255, bh=v*h;
          g.fillRect(i*(w/bars)+2, h-bh, (w/bars)-4, bh);
        }
      })();

      mediaRecorder.start(50);
      return { mime, stop:() => new Promise(resolve=>{
        const finalize=()=>resolve({ chunks:chunksLocal.slice(), mime });
        if (mediaRecorder && mediaRecorder.state==='recording') {
          mediaRecorder.addEventListener('stop', finalize, { once:true });
          mediaRecorder.stop();
        } else finalize();
      })};
    }

    function stop(){
      try { if (mediaRecorder && mediaRecorder.state==='recording') mediaRecorder.stop(); } catch(_){}
      try { stream?.getTracks().forEach(t => t.stop()); } catch(_){}
    try { await pdSafeCloseCtx(); } catch(_){}
      stream=null; mediaRecorder=null; analyser=null;
      if (raf) cancelAnimationFrame(raf); raf=0;
      clearCanvas();
    }

    async function finalizeToBlobDuration(chunks, mimeType){
      const blob = new Blob(chunks, { type:(mimeType.split(';')[0]||'audio/webm') });
      // 메타데이터 기반 실제 길이 산출(브라우저/버퍼 영향 최소화)
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      return await new Promise((resolve)=>{
audio.addEventListener('loadedmetadata', ()=>{
  const dur = Number(audio.duration||0);
  const approx = Math.max(0,(performance.now()-tStart)/1000);
  URL.revokeObjectURL(url);
  resolve({ blob, duration: dur, approx });
}, { once:true });

      });
    }

    return { start, stop, finalizeToBlobDuration, get mime(){ return mime; } };
  }

  // ===== 전역 상태 =====
  let chunks=[], lastDur=0, mime='audio/webm', evalBusy=false;

  // ===== 메인 평가 =====
  async function doEvaluate(ui, getRef, onResult){
    if (evalBusy) return;

    if (lastDur < CFG.minSec) {
      ui.msg.textContent = `⏱️ 좀 더 길게 말해 주세요 (≥ ${CFG.minSec}s) / Parlez un peu plus longtemps`;
      _recoverToReady(ui);
      return;
    }
    if (!chunks.length) {
      ui.msg.textContent = '🔁 먼저 녹음하세요 / Enregistrez d’abord';
      _recoverToReady(ui);
      return;
    }
    const refOrig = String(getRef?.()||'').trim();
    if (!refOrig){
      ui.msg.textContent = '📝 문장 준비 중 / Phrase non prête';
      _recoverToReady(ui);
      return;
    }

    evalBusy = true;

    const blob = new Blob(chunks, { type: (mime.split(';')[0]||'audio/webm') });
    const base64 = await blobToBase64(blob).catch(()=> '');

    ui.msg.textContent = '⏳ Évaluation… / 평가 중…';
    let transcript = '', accuracy = null, needsRetry = false;

    try {
      const res = await postJSON(CFG.endpoint, {
        referenceText: refOrig,
        options: { strictTranscript: true, disableLM: true },
        audio: {
          base64,
          mimeType: blob.type || 'audio/webm',
          filename: 'rec.webm',
          duration: lastDur
        }
      });
      accuracy = res?.accuracy ?? null;
      transcript = String(res?.transcript || '');
      needsRetry = !!res?.needsRetry;
    } catch (e) {
      ui.msg.textContent='⚠️ Analyse indisponible. Réessaie. / 서버 오류';
      try{ onResult?.({ status:'error', reason:'server_error' }); }catch(_){}
      evalBusy=false; _recoverToReady(ui); return;
    }

    if (!transcript || transcript.replace(/\s+/g,'').length < 2) {
      ui.msg.textContent = '⚠️ 더 또렷하고 길게 말해 주세요 / Parlez plus clairement et un peu plus longtemps';
      try { onResult?.({ status:'retry', transcript:'', accuracy:0, needsRetry:true, duration:lastDur, reason:'too_short_transcript' }); } catch(_){}
      evalBusy = false; _recoverToReady(ui); return;
    }

    transcript = localForceHangulNumbers(transcript);
    const refForCoerce = localForceHangulNumbers(refOrig);
    transcript = coerceTowardsRef(refForCoerce, transcript);

    const refN = normalizeKo(refForCoerce);
    const hypN = normalizeKo(transcript);
    const g = isGarbageTranscript(refN, hypN, transcript, lastDur);
    if (g.bad) {
      ui.msg.textContent = '⚠️ Parlez plus distinctement. / 또박또박 더 분명하게 말해요.';
      try { onResult?.({ status:'retry', transcript:'', accuracy:0, needsRetry:true, duration:lastDur, reason:g.reason }); } catch(_){}
      evalBusy=false; _recoverToReady(ui); return;
    }

    const refLen = refN.ko.length;
    const need = (refLen >= CFG.shortRefLen) ? CFG.passBase : CFG.passShortRef;
    const score = (typeof accuracy === 'number')
      ? (accuracy > 1 ? accuracy/100 : accuracy)
      : similarity(refN.ko, hypN.ko);
    const ok = score >= need;

    const out = { status:'ok', transcript, accuracy:score, score, ok, passed:ok, needsRetry, duration:lastDur };
    ui.msg.textContent = ok ? `✅ ${lastDur.toFixed(1)} s · Bon travail ! / 좋아요!` : `ℹ️ ${lastDur.toFixed(1)} s · 한 번 더 또박또박!`;
    try { onResult?.(out); } catch(_){}
    evalBusy = false;

    // 평가 후에도 재녹음 허용
    _recoverToReady(ui);
  }

  // ===== 장착 =====
  function mount(root, opts={}){
    if (!root) return;
    const host = (typeof root === 'string') ? $(root) : root;
    if (!host) return;

    // 인스턴스별 오버라이드
    if (Number.isFinite(opts.maxSeconds)) {
      CFG.maxSec = Math.max(CFG.minSec + 1, Number(opts.maxSeconds));
    }

    const getRef  = typeof opts.getReferenceText === 'function' ? opts.getReferenceText : ()=> '';
    const onResult= typeof opts.onResult === 'function' ? opts.onResult : ()=> {};
    const uiMode  = (opts.ui || global.PRONUN_UI_DEFAULT || 'classic');

    const ui = (uiMode === 'warmup') ? buildWarmupUI(host) : buildClassicUI(host);
    const R = makeRecorder(ui.canvas);

    // 녹음 타이머(실시간 경과 표기)
    let recStart = 0, recTimer = 0;
    function startRecTimer(){
      recStart = Date.now();
      stopRecTimer();
      recTimer = window.setInterval(()=>{
        const sec = Math.min(CFG.maxSec, (Date.now() - recStart)/1000);
        ui.msg.textContent = `🎙️ Enregistrement… / 녹음 중…  ${sec.toFixed(1)} s`;
        // 최대길이 자동 정지
        if (sec >= CFG.maxSec) {
          try { ui.btnStop.click(); } catch(_){}
        }
      }, 100);
    }
    function stopRecTimer(){
      if (recTimer) { clearInterval(recTimer); recTimer = 0; }
    }

    // Start
    ui.btnStart.addEventListener('click', async ()=>{
      try{
        ui.btnStart.disabled = true;
        ui.btnStop.disabled  = true;
        ui.btnEval.disabled  = true;
        ui.msg.textContent   = '🎙️ Enregistrement… / 녹음 중…';
        startRecTimer();

        const session = await R.start();
        // 최소 1초 지나야 Stop 활성(실수 방지)
        setTimeout(()=>{ ui.btnStop.disabled = false; }, 1000);

        // Stop을 눌렀을 때 결과 정리 (한 세션에 한 번만)
        const onStopOnce = async ()=>{
          stopRecTimer();
          try{
            ui.btnStop.disabled = true;
            const out = await session.stop();
            // 실제 길이로 duration 산출
const { blob, duration, approx } = await R.finalizeToBlobDuration(out.chunks, out.mime);
chunks = out.chunks.slice();
const durClean = (!isFinite(duration) || duration<=0 || duration>CFG.maxSec-0.05) ? approx : duration;
lastDur = Math.min(CFG.maxSec, Math.max(0, durClean));
mime = out.mime || 'audio/webm';


            // 항상 Start 복구
            ui.btnStart.disabled = false;

            if (!chunks.length || lastDur < CFG.minSec) {
              ui.btnEval.disabled = true;
              ui.msg.textContent = `⏱️ 너무 짧아요. 조금 더 길게 말해 주세요 (≥ ${CFG.minSec}s).`;
            } else {
              ui.btnEval.disabled = false;
              ui.msg.textContent = `✅ ${lastDur.toFixed(1)} s · “Évaluer / 평가”를 눌러보세요.`;
            }
          }catch(_){
            _recoverToReady(ui);
            ui.msg.textContent = '🎙️ 마이크 처리 중 문제가 있었어요. 다시 시도해 주세요.';
          } finally {
            try{ R.stop(); }catch(_){}
          }
        };
        // once: true라서 매 세션에 리스너가 누적되지 않음
        ui.btnStop.addEventListener('click', onStopOnce, { once:true });
      }catch(_){
        stopRecTimer();
        _recoverToReady(ui);
        ui.msg.textContent = '🎙️ 마이크 권한을 확인해 주세요 / Autorisez le micro';
      }
    });

    // Eval
    ui.btnEval.addEventListener('click', async ()=>{
      await doEvaluate(ui, getRef, onResult);
    });

    return { ui };
  }

  // ===== 공개 API =====
  global.Pronun = { mount, __v: 48 };
})(window);
