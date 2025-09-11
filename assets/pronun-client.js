// assets/pronun-client.js
// 공용 발음기: Pronun.mount(el, { getReferenceText:()=>string, onResult:(res)=>void })
(function (global) {
  if (global.Pronun && global.Pronun.__v >= 3) return;

  const CFG = {
    endpoint: (global.PONGDANG_FN_BASE || '/.netlify/functions') + '/analyze-pronunciation',
    minSec: 0.8,
    maxSec: 12,
    canvasW: 240,
    canvasH: 40
  };

  // ── 내부 유틸(학생 화면에 노출 X) ─────────────────────────────
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
  function pct(x){ return `${Math.round((Number(x)||0)*100)}%`; }

  // ── 학생용 UI(불어/한글) ────────────────────────────────────
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
    } else {
      ui.rec.disabled = false; ui.rec.classList.remove('disabled');
      ui.stop.disabled = true;  ui.stop.classList.add('disabled');
      ui.eval.disabled = false; ui.eval.classList.remove('disabled');
    }
  }

  function mount(mountEl, opts) {
    const getRef  = typeof opts?.getReferenceText === 'function' ? opts.getReferenceText : () => '';
    const onResult = typeof opts?.onResult === 'function' ? opts.onResult : () => {};

    const ui = buildUI(mountEl);
    let stream = null, rec = null, chunks = [], vu = null, startMs = 0;
    let mime = pickMime();

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
        ui.msg.textContent = '🔒 Autorise le micro dans le navigateur / 브라우저에서 마이크 사용을 허용해 주세요';
        setState(ui, 'idle', chunks.length);
      }
    }
    function stopTracks(){ try { stream?.getTracks()?.forEach(t=>t.stop()); } catch(_){} stream = null; }
    function stopRec() {
      if (rec && rec.state === 'recording') { try { rec.stop(); } catch(_){} }
      vu?.stop(); vu = null; stopTracks();
      const dur = (Date.now() - startMs) / 1000;
      if (dur < CFG.minSec) {
        ui.msg.textContent = `⏱️ Un peu plus long, s’il te plaît (≥ ${CFG.minSec}s) / 조금만 더 길게 녹음해 주세요`;
      } else {
        ui.msg.textContent = '⏹️ Terminé. Appuie sur “Évaluer” / 완료! 이제 “평가”를 눌러 주세요';
      }
      setState(ui, 'stop', chunks.length);
    }
    async function evalRec() {
      if (!chunks.length) { ui.msg.textContent = '🔁 Enregistre d’abord / 먼저 녹음해 주세요'; return; }
      const blob = new Blob(chunks, { type: mime.split(';')[0] || 'audio/webm' });
      const base64 = await blobToBase64(blob);
      const ref = String(getRef() || '').trim();
      if (!ref) { ui.msg.textContent = '📝 La phrase n’est pas prête / 문장이 아직 준비되지 않았어요'; return; }

      ui.msg.textContent = '⏳ Évaluation… / 평가 중…';
      ui.out.textContent = '';
      try {
        const res = await postJSON(CFG.endpoint, { referenceText: ref, audio: { base64, mimeType: blob.type || 'audio/webm', filename: 'rec.webm' } });
        const acc = res?.accuracy ?? 0;
        const tr  = res?.transcript || '';
        ui.out.innerHTML = `🎯 Exactitude: <span class="text-blue-600">${pct(acc)}</span> · 👂 Reconnu: <span class="text-slate-700">${tr || '(vide / 비어 있음)'}</span>`;
        ui.msg.textContent = '✅ C’est bon ! Tu peux passer à la suite / 좋아요! 다음으로 넘어가세요';
        try { onResult(res); } catch(_) {}
      } catch (e) {
        console.error('[eval]', e);
        ui.msg.textContent = '⚠️ Réessaie s’il te plaît / 다시 한 번 시도해 주세요';
      }
    }

    ui.rec.addEventListener('click', startRec);
    ui.stop.addEventListener('click', stopRec);
    ui.eval.addEventListener('click', evalRec);

    window.addEventListener('beforeunload', () => {
      try { if (rec && rec.state === 'recording') rec.stop(); } catch(_) {}
      vu?.stop(); stopTracks();
    });
  }

  global.Pronun = { __v: 3, mount };
})(window);
