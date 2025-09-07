/* /assets/pronun-client.js */
;(function (global) {
  const DEFAULTS = {
    endpoint: '/.netlify/functions/analyze-pronunciation',
    // 크레딧 절약/반복 연습 정책
    requireKoCorrect: false,              // KO 정답 여부와 무관하게 STT 수행
    skipSecondPassIfAccurate: 0.90,       // 1차 정확도 ≥ 90%면 2차(Whisper) 생략 권고
    maxAnalysesPerSession: 50,            // 한 세션당 분석 상한(반복 연습 지원)
    minDurationSec: 0.6,                  // 너무 짧은 녹음 차단
    maxDurationSec: 10,                   // 너무 긴 녹음 차단
    cacheResults: true,                   // 동일 오디오 재분석 방지
    useLocalStorageCache: true,
    selectors: {
      btnStart:  '.btn-rec-start',
      btnStop:   '.btn-rec-stop',
      canvas:    '.vu-canvas',
      result:    '.pronun-display',
      koInput:   '.input-ko'
    },
    // 호출자 제공
    getReferenceText: null,               // (필수) 문항의 정답 한글문
    isKoCorrect: null,                    // (선택) KO 정답 여부 판별 함수
    onResult: null,
    onCostGuardHit: null
  };

  const session = { analyses: 0 };
  const memCache = new Map();

  function textBilingual(fr, ko) { return `${fr} / ${ko}`; }

  function uiSetRecording(btnStart, isRecording) {
    if (isRecording) {
      btnStart.classList.add('btn-rec-recording');
      btnStart.innerHTML = '🔴 Enregistrement… / 녹음 중 <span class="dot-rec"></span>';
      btnStart.disabled = true;
    } else {
      btnStart.classList.remove('btn-rec-recording');
      btnStart.innerHTML = '🎙️ Enregistrer / 녹음';
      btnStart.disabled = false;
    }
  }

  function drawLoop(state) {
    const { analyser, data, canvas, ctx } = state.vu;
    analyser.getByteTimeDomainData(data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    for (let x = 0; x < canvas.width; x++) {
      const i = Math.floor((x / canvas.width) * data.length);
      const y = (data[i] / 255) * canvas.height;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.stroke();
    state.vu.rafId = requestAnimationFrame(() => drawLoop(state));
  }

  function base64FromBlob(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function sha256Base64(b64) {
    try {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // 폴백 해시(충돌 가능성 있음)
      let h = 0; for (let i = 0; i < b64.length; i++) h = (h * 31 + b64.charCodeAt(i)) | 0;
      return 'x' + (h >>> 0).toString(16);
    }
  }

  function loadCache(key) {
    if (!key) return null;
    const k = 'pronun:' + key;
    if (memCache.has(k)) return memCache.get(k);
    try { const s = localStorage.getItem(k); if (s) { const v = JSON.parse(s); memCache.set(k, v); return v; } } catch {}
    return null;
  }

  function saveCache(key, value) {
    if (!key) return;
    const k = 'pronun:' + key;
    memCache.set(k, value);
    try { localStorage.setItem(k, JSON.stringify(value)); } catch {}
  }

  async function analyzeOnce(opts, payload, cacheKey) {
    if (opts.cacheResults) {
      const cached = loadCache(cacheKey);
      if (cached) return { ...cached, _cached: true };
    }
    const res = await fetch(opts.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Skip-Second-Pass-If-Accurate': String(opts.skipSecondPassIfAccurate || 0)
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('STT ' + res.status);
    const data = await res.json();
    if (opts.cacheResults) saveCache(cacheKey, data);
    return data;
  }

  async function startRecording(state) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    const data = new Uint8Array(analyser.fftSize);
    src.connect(analyser);

    state.media = { stream, rec, audioCtx };
    state.vu = { analyser, data, canvas: state.canvas, ctx: state.canvas.getContext('2d'), rafId: null };
    state.chunks = [];
    state.startedAt = Date.now();

    rec.ondataavailable = e => { if (e.data.size > 0) state.chunks.push(e.data); };
    rec.onstop = () => { /* cleanup in stopRecording */ };

    rec.start();
    drawLoop(state);
  }

  async function stopRecording(state) {
    const { rec, stream, audioCtx } = state.media || {};
    if (!rec) return null;

    return new Promise(resolve => {
      rec.onstop = async () => {
        try {
          if (state.vu?.rafId) cancelAnimationFrame(state.vu.rafId);
          state.vu.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
          stream.getTracks().forEach(t => t.stop());
          try { await audioCtx.close(); } catch {}
          const blob = new Blob(state.chunks, { type: 'audio/webm' });
          resolve({ blob, duration: Math.max(0, Math.round((Date.now() - state.startedAt) / 1000)) });
        } finally {
          state.media = null; state.vu = null; state.chunks = []; state.startedAt = 0;
        }
      };
      rec.stop();
    });
  }

  function pill(color, text) {
    const base = 'display:inline-block;border-radius:9999px;padding:.25rem .6rem;font-size:.8rem;border:1px solid;';
    if (color === 'green') return `<span style="${base}background:#e7f8ee;color:#0a7a3b;border-color:#9be4b8">${text}</span>`;
    return `<span style="${base}background:#fde8e8;color:#9b1c1c;border-color:#f7b4b4">${text}</span>`;
  }

  function renderResult(el, pct, tags) {
    const p = Math.round((pct || 0) * 100);
    const label = textBilingual(`Précision de prononciation ${p}%`, `발음 정확도 ${p}%`);
    const tagStr = (tags && tags.length) ? ` · ${textBilingual('Confusions détectées', '혼동')}: ${tags.join(', ')}` : '';
    el.innerHTML = (p >= 85)
      ? `${pill('green', label)}<div class="small-muted mt-1">${tagStr}</div>`
      : `${pill('red',   label)}<div class="small-muted mt-1">${tagStr}</div>`;
  }

  function msg(el, text) { el.innerHTML = `<div class="small-muted">${text}</div>`; }

  function mount(cardEl, userOpts) {
    const opts = Object.assign({}, DEFAULTS, userOpts || {});
    if (typeof opts.getReferenceText !== 'function') throw new Error('getReferenceText(option)가 필요해요.');

    const btnStart = cardEl.querySelector(opts.selectors.btnStart);
    const btnStop  = cardEl.querySelector(opts.selectors.btnStop);
    const canvas   = cardEl.querySelector(opts.selectors.canvas);
    const resultEl = cardEl.querySelector(opts.selectors.result);

    const state = { canvas, vu: null, media: null, chunks: [], startedAt: 0 };

    // 녹음 시작
    btnStart.addEventListener('click', async () => {
      // KO 정답 여부와 무관하게 분석 진행 (틀려도 안내만)
      if (typeof opts.isKoCorrect === 'function' && !opts.isKoCorrect(cardEl)) {
        msg(resultEl, textBilingual(
          "Vous pouvez enregistrer même si la dictée KO n'est pas parfaite. (Analyse effectuée)",
          "한국어 받아쓰기를 틀려도 녹음 가능합니다. (분석 진행)"
        ));
      }

      if (session.analyses >= opts.maxAnalysesPerSession) {
        const t = textBilingual("Limite d'analyses atteinte pour cette session.", "이번 세션 분석 한도에 도달했어요.");
        msg(resultEl, t);
        if (typeof opts.onCostGuardHit === 'function') opts.onCostGuardHit();
        return;
      }

      uiSetRecording(btnStart, true);
      btnStop.disabled = false;
      await startRecording(Object.assign(state, { canvas }));
    });

    // 정지+분석
    btnStop.addEventListener('click', async () => {
      btnStop.disabled = true;
      const out = await stopRecording(state);
      uiSetRecording(btnStart, false);

      if (!out) { btnStop.disabled = false; return; }
      const { blob, duration } = out;

      if (duration < opts.minDurationSec) {
        msg(resultEl, textBilingual("Trop court. Réessayez.", "너무 짧아요. 다시 녹음해요."));
        btnStop.disabled = false; return;
      }
      if (duration > opts.maxDurationSec) {
        msg(resultEl, textBilingual("Trop long. Coupez en dessous de 10 s.", "너무 길어요. 10초 이내로 줄여주세요."));
        btnStop.disabled = false; return;
      }

      msg(resultEl, textBilingual("Analyse en cours…", "분석 중…"));
      try {
        const base64 = await base64FromBlob(blob);
        const ref = String(opts.getReferenceText(cardEl) || '');
        const key = await sha256Base64(base64 + '|' + ref);
        const payload = {
          referenceText: ref,
          audio: { base64, mimeType: 'audio/webm', filename: `rec_${Date.now()}.webm`, duration },
          clientConfig: { skipSecondPassIfAccurate: opts.skipSecondPassIfAccurate, maxDurationSec: opts.maxDurationSec },
          clientHash: key
        };
        const data = await analyzeOnce(opts, payload, key);
        session.analyses++;
        renderResult(resultEl, data.accuracy, data.confusionTags);
        if (typeof opts.onResult === 'function') {
          opts.onResult({ accuracy: data.accuracy, confusionTags: data.confusionTags, transcript: data.transcript, key });
        }
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
