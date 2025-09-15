// assets/pronun-client.js  (v4.3)
// 공용 발음기: Pronun.mount(el, { getReferenceText:()=>string, onResult:(res)=>void })
(function (global) {
  // 캐시/중복 로드 방지
  if (global.Pronun && global.Pronun.__v >= 43) return;

  const CFG = {
    endpoint: (global.PONGDANG_FN_BASE || '/.netlify/functions') + '/analyze-pronunciation',
    minSec: 0.8,
    maxSec: 12,
    canvasW: 240,
    canvasH: 40,

    // 판정/가비지 필터
    passBase: 0.75,       // 일반 문장 임계치(75%)
    passShortRef: 0.80,   // 아주 짧은 참조(숫자 1~2음절) 임계치(80%)
    shortRefLen: 4,
    lowSimil: 0.35,
    lenRatioGarbage: 2.5,
    // 내부 판정 전용(절대 UI로 노출하지 않음)
    garbageWords: [
      "배달의민족","영상편집","자막","광고","구독","좋아요","알림설정","스폰서",
      "후원","협찬","문의","링크","다운로드","설명란","채널","스트리밍","썸네일",
      "유튜브","클릭","이벤트","특가","광고주","제휴","비디오","구매","할인"
    ]
  };

  // ── 유틸 ─────────────────────────────
  function pctSafe(x){
    if (x === null || x === undefined) return '--';
    const v = Number(x);
    if (!isFinite(v)) return '--';
    return `${Math.round(v > 1 ? v : v * 100)}%`;
  }
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else el.setAttribute(k, attrs[k]);
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
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status} ${t}`);
    }
    return r.json();
  }
  function startVU(stream, canvas) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return { stop() {} };
    const ac = new AC();
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const ctx = canvas.getContext('2d');
    let raf = 0, alive = true;
    function draw() {
      if (!alive) return;
      const data = new Uint8Array(an.frequencyBinCount);
      an.getByteTimeDomainData(data);
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const y = (data[i] / 255) * h;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    }
    draw();
    return { stop() { alive = false; try { cancelAnimationFrame(raf); } catch(_){} try { ac.close(); } catch(_){} } };
  }

  // 정규화 & 유사도
  function normalizeKo(s){
    if(!s) return { raw:"", ko:"" };
    let t = String(s).toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF]/g,'')
      .replace(/[.,!?;:()[\]{}"“”'‘’`~^%$#+=<>…]/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    const onlyKo = t.replace(/[^ㄱ-ㅎ가-힣0-9\s]/g,'').replace(/\s+/g,'').trim();
    return { raw: t, ko: onlyKo };
  }
  function similarity(a, b){
    if(a===b) return 1;
    const m=a.length,n=b.length;
    if(!m||!n) return 0;
    const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
    for(let i=0;i<=m;i++) dp[i][0]=i;
    for(let j=0;j<=n;j++) dp[0][j]=j;
    for(let i=1;i<=m;i++){
      for(let j=1;j<=n;j++){
        const cost = a[i-1]===b[j-1]?0:1;
        dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
      }
    }
    const dist = dp[m][n];
    return 1 - (dist / Math.max(m,n));
  }
  function looksGarbage(refN, hypN){
    const refLen = refN.ko.length || refN.raw.length;
    const hypLen = hypN.ko.length || hypN.raw.length;
    const sim = similarity(refN.ko, hypN.ko);
    const hasBadWord = CFG.garbageWords.some(k => hypN.raw.includes(k));
    const isShortRef = (refLen <= CFG.shortRefLen);
    const lenRatioBad = isShortRef && hypLen > 0 && (hypLen / Math.max(1,refLen)) >= CFG.lenRatioGarbage;
    const simTooLow  = isShortRef && sim < CFG.lowSimil;
    return hasBadWord || lenRatioBad || simTooLow;
  }

  // 숫자→한글 강제(로컬 폴백)
  function localForceHangulNumbers(s){
    let x = String(s||'');
    x = x.replace(/\b1\b/g,'일').replace(/\b2\b/g,'이');
    x = x.replace(/(^|[^0-9])1([^0-9]|$)/g, '$1일$2');
    x = x.replace(/(^|[^0-9])2([^0-9]|$)/g, '$1이$2');
    return x;
  }

  // STT 도메인 보정(참조 기반 스냅)
  function coerceTowardsRef(refRaw, hypRaw) {
    let out = hypRaw;
    const ref = refRaw.replace(/\s+/g,'');
    const hyp = hypRaw.replace(/\s+/g,'');

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
    for (const r of RULES) { if (r.when.test(ref) && r.hyp.test(hyp)) return r.to; }
    return out;
  }

  // ── UI ─────────────────────────────
  function buildUI(mountEl) {
    const ui = {
      root: h('div', { class: 'flex items-center gap-2 flex-wrap' }),
      rec:  h('button', { class: 'btn btn-secondary' }, '🎙️ Enregistrer / 녹음'),
      stop: h('button', { class: 'btn btn-secondary disabled', disabled: 'true' }, '⏹️ Stop / 정지'),
      eval: h('button', { class: 'btn btn-primary disabled', disabled: 'true' }, '✅ Évaluer / 평가'),
      cvs:  h('canvas', { width: String(CFG.canvasW), height: String(CFG.canvasH), class: 'border rounded' }),
      msg:  h('div', { class: 'text-sm text-slate-700 w-full' }),
      out:  h('div', { class: 'text-sm font-semibold w-full mt-1' })
    };
    mountEl.innerHTML = '';
    ui.root.append(ui.rec, ui.stop, ui.eval, ui.cvs, ui.msg, ui.out);
    mountEl.appendChild(ui.root);
    return ui;
  }
  function setState(ui, state, chunksLen) {
    if (state === 'idle') {
      ui.rec.disabled = false; ui.rec.classList.remove('disabled');
      ui.stop.disabled = true;  ui.stop.classList.add('disabled');
      const canEval = (chunksLen||0) > 0;
      ui.eval.disabled = !canEval; ui.eval.classList.toggle('disabled', !canEval);
    } else if (state === 'rec') {
      ui.rec.disabled = true;  ui.rec.classList.add('disabled');
      ui.stop.disabled = false; ui.stop.classList.remove('disabled');
      ui.eval.disabled = true;  ui.eval.classList.add('disabled');
    } else { // 'stop'
      ui.rec.disabled = false; ui.rec.classList.remove('disabled');
      ui.stop.disabled = true;  ui.stop.classList.add('disabled');
      ui.eval.disabled = false; ui.eval.classList.remove('disabled');
    }
  }

  function mount(mountEl, opts) {
    const getRef   = typeof opts?.getReferenceText === 'function' ? opts.getReferenceText : () => '';
    const onResult = typeof opts?.onResult        === 'function' ? opts.onResult        : () => {};

    const ui = buildUI(mountEl);
    let stream = null, rec = null, chunks = [], vu = null, startMs = 0;
    let mime = pickMime(), lastDur = 0, evalBusy = false;

    async function startRec() {
      try {
        chunks = [];
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        rec = new MediaRecorder(stream, { mimeType: mime });
        rec.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
        rec.onstop = () => setState(ui, 'stop', chunks.length);
        vu = startVU(stream, ui.cvs);
        rec.start();
        startMs = Date.now();
        ui.msg.textContent = '🎧 Enregistrement… / 녹음 중이에요';
        setState(ui, 'rec');
        setTimeout(() => { if (rec && rec.state === 'recording') stopRec(); }, CFG.maxSec * 1000);
      } catch (e) {
        console.warn('[mic]', e);
        ui.msg.textContent = '🔒 Autorise le micro / 브라우저에서 마이크 사용을 허용해 주세요';
        setState(ui, 'idle', chunks.length);
      }
    }
    function stopTracks(){ try { stream?.getTracks()?.forEach(t=>t.stop()); } catch(_){} stream = null; }
    function stopRec() {
      if (rec && rec.state === 'recording') { try { rec.stop(); } catch(_){} }
      vu?.stop(); vu = null; stopTracks();
      lastDur = (Date.now() - startMs) / 1000;
      if (lastDur < CFG.minSec) {
        ui.msg.textContent = `⏱️ Un peu plus long (≥ ${CFG.minSec}s) / 조금 더 길게`;
        ui.eval.disabled = true; ui.eval.classList.add('disabled');
      } else {
        ui.msg.textContent = '⏹️ Terminé. Appuie sur “Évaluer” / 완료! “평가”를 눌러 주세요';
      }
      setState(ui, 'stop', chunks.length);
    }

    async function evalRec() {
      if (evalBusy) return;
      if (!chunks.length) { ui.msg.textContent = '🔁 Enregistre d’abord / 먼저 녹음해 주세요'; return; }
      const refOrig = String(getRef() || '').trim();
      if (!refOrig) { ui.msg.textContent = '📝 La phrase n’est pas prête / 문장이 아직 준비되지 않았어요'; return; }

      evalBusy = true;
      const blob = new Blob(chunks, { type: mime.split(';')[0] || 'audio/webm' });
      const base64 = await blobToBase64(blob);

      ui.msg.textContent = '⏳ Évaluation… / 평가 중…';
      ui.out.textContent = '';
      let transcript = '', accuracy = null, needsRetry = false;

      try {
        const res = await postJSON(CFG.endpoint, {
          referenceText: refOrig,
          audio: { base64, mimeType: blob.type || 'audio/webm', filename: 'rec.webm', duration: lastDur }
        });
        accuracy = (res?.accuracy === null || res?.accuracy === undefined) ? null : res.accuracy;
        transcript = String(res?.transcript || '');
        needsRetry = !!res?.needsRetry;
      } catch (e) {
        console.warn('[eval server]', e);
        ui.msg.textContent = '⚠️ Analyse indisponible. Réessaie. / 분석 서버 오류, 다시 시도';
        try { onResult({ status:'error', reason:'server_error' }); } catch(_) {}
        evalBusy = false;
        return;
      }

      // 숫자→한글 강제
      transcript = (global.NumHangul?.forceHangulNumbers)
        ? global.NumHangul.forceHangulNumbers(transcript)
        : localForceHangulNumbers(transcript);
      const refForCoerce = (global.NumHangul?.forceHangulNumbers)
        ? global.NumHangul.forceHangulNumbers(refOrig)
        : localForceHangulNumbers(refOrig);

      // 도메인 보정(일/이 스냅 등)
      transcript = coerceTowardsRef(refForCoerce, transcript);

      // 정규화 + 가비지 검사
      const refN = normalizeKo(refForCoerce);
      const hypN = normalizeKo(transcript);
      if (!needsRetry) needsRetry = looksGarbage(refN, hypN);

      // 정확도 0~100 보정
      if (accuracy !== null && accuracy !== undefined) {
        const a = Number(accuracy);
        accuracy = isFinite(a) ? (a <= 1 ? Math.round(a * 100) : Math.round(a)) : null;
      }
      if (accuracy === null || accuracy === undefined) {
        const sim = similarity(refN.ko, hypN.ko);
        accuracy = Math.round(sim * 100);
      }

      // 최종 판정
      const isShortRef = (refN.ko.length || refN.raw.length) <= CFG.shortRefLen;
      const passCut = Math.round((isShortRef ? CFG.passShortRef : CFG.passBase) * 100);
      const finalStatus = (!needsRetry && accuracy >= passCut) ? 'ok' : 'retry';

      // 🔐 학생 UI: 정확도만 표시 (Transcript/사유 비노출)
      ui.out.innerHTML = `🎯 Exactitude: <span class="text-blue-600">${pctSafe(accuracy)}</span>`;
      if (finalStatus === 'ok') {
        ui.msg.innerHTML = '✅ C’est bon ! Tu peux passer à la suite / 좋아요! 다음으로 넘어가세요';
      } else {
        ui.msg.innerHTML = `💡 Encore un peu: vise ≥ ${passCut}% / 조금만 더 또렷하게 (목표 ${passCut}% 이상)`;
      }

      // 외부 콜백: 상태/점수만 전달
      try { onResult({ status: finalStatus, accuracy }); } catch(_) {}
      evalBusy = false;
    }

    // 버튼 바인딩
    ui.rec.addEventListener('click', startRec);
    ui.stop.addEventListener('click', stopRec);
    ui.eval.addEventListener('click', evalRec);

    window.addEventListener('beforeunload', () => {
      try { if (rec && rec.state === 'recording') rec.stop(); } catch(_) {}
      try { vu?.stop(); } catch(_) {}
      try { stream?.getTracks()?.forEach(t=>t.stop()); } catch(_) {}
    });
  }

  global.Pronun = { __v: 43, mount };
})(window);
