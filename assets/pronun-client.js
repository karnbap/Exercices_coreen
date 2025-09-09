// assets/pronun-client.js
(function (global) {
  const DEFAULTS = {
    endpoint: '/.netlify/functions/analyze-pronunciation',
    selectors: { btnStart: '.btn-rec', btnStop: '.btn-stop', canvas: '.vu', result: '.pronun-display' },
    minDurationSec: 0.8,
    maxDurationSec: 12,
    skipSecondPassIfAccurate: true,
    maxAnalysesPerSession: 40,
    cacheResults: true
  };

  function textBilingual(fr, ko){ return `${fr} / ${ko}`; }
  function jsonPost(url, payload) {
    return fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)})
      .then(r=>r.ok ? r.json() : r.text().then(t=>Promise.reject(new Error(`${r.status} ${t}`))));
  }
  async function base64FromBlob(blob) {
    return new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = ()=> resolve((fr.result||'').toString().split(',')[1] || '');
      fr.readAsDataURL(blob);
    });
  }
  function msg(el, text) { el.innerHTML = `<div class="small-muted">${text}</div>`; }

  function uiSetRecording(btnStart, isRecording) {
    if (isRecording) {
      btnStart.classList.add('btn-rec-recording');
      btnStart.innerHTML = '🔴 Enregistrement… / 녹음 중';
      btnStart.disabled = true;
    } else {
      btnStart.classList.remove('btn-rec-recording');
      btnStart.innerHTML = '🎙️ Enregistrer / 녹음';
      btnStart.disabled = false;
    }
  }

  function getUserMediaSafe() {
    return navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ audio:true })
      : Promise.reject(new Error('getUserMedia unsupported'));
  }

  function buildVU(stream, canvas) {
    const ctx = canvas.getContext('2d');
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    const data = new Uint8Array(analyser.fftSize);
    src.connect(analyser);
    return { ac, src, analyser, data, canvas, ctx, raf:0, peak:0 };
  }

  function drawLoop(state) {
    const { analyser, data, canvas, ctx } = state.vu;
    analyser.getByteTimeDomainData(data);
    // peak 측정
    for (let i=0;i<data.length;i++) {
      const v = Math.abs(data[i] - 128)/128;
      state.vu.peak = Math.max(state.vu.peak, v);
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    for (let x = 0; x < canvas.width; x++) {
      const v = data[x] / 128.0 - 1.0;
      const y = (canvas.height / 2) + v * (canvas.height / 2 - 4);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    state.vu.raf = requestAnimationFrame(()=>drawLoop(state));
  }

  function pickMime() {
    const M = window.MediaRecorder;
    if (!M) return null;
    const c = (t)=> M.isTypeSupported && M.isTypeSupported(t);
    if (c('audio/webm;codecs=opus'))   return 'audio/webm;codecs=opus';
    if (c('audio/webm'))               return 'audio/webm';
    if (c('audio/mp4;codecs=mp4a.40.2')) return 'audio/mp4'; // Safari
    return '';
  }

  function startRecording(state) {
    const mime = pickMime();
    const chunks = [];
    const rec = new MediaRecorder(state.media.stream, mime ? { mimeType:mime } : undefined);
    rec.ondataavailable = e => chunks.push(e.data);
    rec.start(50);
    state.rec = rec; state.chunks = chunks; state.mime = mime || 'audio/webm';
  }

  function stopRecording(state) {
    return new Promise(resolve => {
      const rec = state.rec;
      if (!rec) return resolve(null);
      rec.onstop = () => {
        try {
          const blob = new Blob(state.chunks, { type: state.mime || 'audio/webm' });
          resolve({ blob, duration: Math.max(0, (Date.now() - state.startedAt) / 1000), mime: state.mime||'audio/webm', peak: state.vu?.peak||0 });
        } finally {
          state.media = null; try{ state.vu?.ac?.close(); }catch(_){}
          state.vu = null; state.chunks = []; state.startedAt = 0;
        }
      };
      rec.stop();
    });
  }

  // 결과 렌더
  function renderResult(el, pct, tags, refText, transcript, extraTips=[]) {
    const p = Math.round((pct || 0) * 100);
    const pill = (p >= 85)
      ? `<span class="pill pill-green">Prononciation ${p}%</span>`
      : `<span class="pill pill-red">Prononciation ${p}%</span>`;
    const tips = (extraTips||[]).map(t=>`<li>${t}</li>`).join('');
    el.innerHTML = `
      ${pill}
      ${tags?.length?`<div class="small-muted mt-1">⚠️ Confusions: ${tags.join(', ')}</div>`:''}
      ${tips?`<ul class="list-disc pl-5 small-muted mt-1">${tips}</ul>`:''}
      <div class="small-muted mt-2">ℹ️ Quand tu arrêtes, l’évaluation démarre automatiquement. / 정지하면 자동 평가돼요.</div>
    `;
  }

  const memCache = new Map();
  function loadCache(key){ try{ const s=localStorage.getItem('pronun:'+key); return s?JSON.parse(s):null; }catch{return null;} }
  function saveCache(key,v){ try{ localStorage.setItem('pronun:'+key, JSON.stringify(v)); }catch{} }
  async function sha256Base64(b64){
    try{
      const bin = atob(b64); const buf = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
      const d = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,'0')).join('');
    }catch{ return 'x'+(b64.length.toString(16)); }
  }

  const session = { analyses: 0 };

  function mount(cardEl, options) {
    const opts = Object.assign({}, DEFAULTS, options||{});
    if (!cardEl) return;
    const btnStart = cardEl.querySelector(opts.selectors.btnStart);
    const btnStop  = cardEl.querySelector(opts.selectors.btnStop);
    const canvas   = cardEl.querySelector(opts.selectors.canvas);
    const resultEl = cardEl.querySelector(opts.selectors.result);
    if (!btnStart || !btnStop || !canvas || !resultEl) return;

    // 초기 안내
    msg(resultEl, textBilingual("Appuie sur « Enregistrer », puis « Arrêter ». L’évaluation se lance automatiquement.",
                                "‘녹음’ 누르고 ‘정지’하면 자동으로 평가돼요."));

    let state = { media:null, vu:null, rec:null, chunks:[], startedAt:0, mime:'audio/webm' };

    btnStart.addEventListener('click', async () => {
      if (session.analyses >= opts.maxAnalysesPerSession) return;
      try {
        const stream = await getUserMediaSafe();
        const vu = buildVU(stream, canvas);
        state.media = { stream }; state.vu = vu; state.startedAt = Date.now();
        uiSetRecording(btnStart, true);
        btnStop.disabled = false;
        drawLoop(state);
        startRecording(state);
      } catch (err) {
        console.error(err);
        msg(resultEl, textBilingual("Micro refusé. Vérifie les permissions.", "마이크 권한을 허용해 주세요."));
      }
    });

    btnStop.addEventListener('click', async () => {
      btnStop.disabled = true;
      try{ state.vu && cancelAnimationFrame(state.vu.raf); }catch{}
      try{ state.media?.stream?.getTracks().forEach(t=>t.stop()); }catch{}
      const out = await stopRecording(state);
      uiSetRecording(btnStart, false);

      if (!out) { btnStop.disabled = false; return; }
      const { blob, duration, mime, peak } = out;

      // 길이/무음 체크
      if (duration < opts.minDurationSec) {
        msg(resultEl, textBilingual("Trop court. Réessayez (≥0,8 s).", "너무 짧아요(0.8초 이상). 다시 녹음해요."));
        btnStop.disabled = false; return;
      }
      if (peak < 0.03) {
        msg(resultEl, textBilingual("Volume très faible. Parle plus près du micro.", "소리가 너무 작아요. 마이크에 가까이 말해요."));
        // 계속 평가하되 안내도 함께
      }

      msg(resultEl, textBilingual("Analyse en cours…", "분석 중…"));
      try {
        const base64 = await base64FromBlob(blob);
        const ref = String((options && options.getReferenceText && options.getReferenceText(cardEl)) || '');
        const key = await sha256Base64(base64 + '|' + ref);
        const payload = {
          referenceText: ref,
          audio: { base64, mimeType: mime || 'audio/webm', filename: `rec_${Date.now()}.webm`, duration },
          clientHash: key
        };

        // 캐시
        if (memCache.has(key)) {
          const data = memCache.get(key);
          session.analyses++;
          renderResult(resultEl, data.accuracy, data.confusionTags, ref, data.transcript);
          options?.onResult?.({ accuracy:data.accuracy, transcript:data.transcript, key, base64, duration });
          btnStop.disabled = false; return;
        }

        const data = await jsonPost(opts.endpoint, payload);
        memCache.set(key, data);
        session.analyses++;

        // STT가 정확히 동일하면 100% 보장
        let acc = (typeof data.accuracy==='number') ? data.accuracy : 0;
        const refC = String(ref||'').replace(/\s+/g,'');
        const hypC = String(data.transcript||'').replace(/\s+/g,'');
        if (refC && hypC && refC===hypC) acc = 1;

        renderResult(resultEl, acc, data.confusionTags, ref, data.transcript,
          (peak<0.03)?[textBilingual("Parle plus fort/près du micro.", "조금 더 크게/가까이 말해요.")]:[]);

        options?.onResult?.({ accuracy: acc, transcript: data.transcript, key, base64, duration });
      } catch (err) {
        console.error(err);
        msg(resultEl, textBilingual("Échec de l'analyse.", "분석 실패"));
      } finally {
        btnStop.disabled = false;
      }
    });
  }

  global.Pronun = { mount };
})(window);
