/* assets/pronun-client.js
   - 각 문제 카드 안에서: 녹음 시작/정지 + 파형(VU) + 자동 평가(정지 시)
   - 백엔드: /.netlify/functions/analyze-pronunciation
   - 외부에서 제공해야 할 요소들(카드 내부):
     .btn-rec  .btn-stop  canvas.vu  .pronun-display  (선택) .pronun-live
   - mount(rootEl, { getReferenceText, isKoCorrect, onResult })
*/

(function (global) {
  const DEFAULTS = {
    endpoint: '/.netlify/functions/analyze-pronunciation',
    minDurationSec: 0.7,
    maxDurationSec: 12,
    maxAnalysesPerCard: 40
  };

  function qs(sel, el = document) { return el.querySelector(sel); }
  function qsa(sel, el = document) { return Array.from(el.querySelectorAll(sel)); }

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => resolve(String(fr.result || '').split(',')[1] || '');
      fr.readAsDataURL(blob);
    });
  }

  async function jsonPost(url, payload) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // ------- VU (작고 가벼운 파형 표시) -------
  function makeVu(canvas) {
    if (!canvas) return { start() {}, stop() {} };
    const ctx = canvas.getContext('2d');
    let raf = 0, analyser, dataArr, src, ac;

    function draw() {
      raf = requestAnimationFrame(draw);
      if (!analyser) return;
      analyser.getByteTimeDomainData(dataArr);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#eef2ff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      const mid = canvas.height / 2;
      for (let x = 0; x < canvas.width; x++) {
        const v = dataArr[Math.floor(x / canvas.width * dataArr.length)] / 128.0 - 1.0;
        const y = mid + v * (mid - 4);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    return {
      async start(stream) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        src = ac.createMediaStreamSource(stream);
        analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        dataArr = new Uint8Array(analyser.fftSize);
        src.connect(analyser);
        if (!canvas.width) { canvas.width = canvas.clientWidth || 640; }
        if (!canvas.height) { canvas.height = canvas.clientHeight || 48; }
        draw();
      },
      stop() {
        cancelAnimationFrame(raf);
        try { src && src.disconnect(); } catch (_) {}
        try { analyser && analyser.disconnect(); } catch (_) {}
        try { ac && ac.close(); } catch (_) {}
        analyser = dataArr = src = ac = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }

  // ------- 카드 하나에 mount -------
  function mount(cardEl, opts) {
    const getRef = opts?.getReferenceText || (() => '');
    const isKoCorrect = opts?.isKoCorrect || (() => true);
    const onResult = typeof opts?.onResult === 'function' ? opts.onResult : () => {};

    const btnRec = qs('.btn-rec', cardEl);
    const btnStop = qs('.btn-stop', cardEl);
    const canvas = qs('canvas.vu', cardEl);
    const liveBox = qs('.pronun-live', cardEl);       // 선택(있으면 Live STT가 채움)
    const disp = qs('.pronun-display', cardEl);

    const vu = makeVu(canvas);
    let media, rec, chunks = [], startedAt = 0, analyses = 0;

    function setState(recOn) {
      if (btnRec) btnRec.disabled = !!recOn;
      if (btnStop) btnStop.disabled = !recOn;
    }

    function note(msg, ok = true) {
      if (!disp) return;
      disp.innerHTML = `<div class="mt-2 p-2 rounded ${ok ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'}">${msg}</div>`;
    }

    async function start() {
      if (rec) return;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        note('🎙️ 마이크 접근이 거부되었어요. 브라우저 권한을 확인하세요.', false);
        return;
      }

      chunks = [];
      rec = new MediaRecorder(media, { mimeType: 'audio/webm' });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = handleStop; // ⏹️ 정지 시 자동 평가

      startedAt = Date.now();
      await vu.start(media);
      rec.start();
      setState(true);
      if (liveBox) liveBox.textContent = 'En direct / 실시간…';
    }

    async function handleStop() {
      try {
        vu.stop();
        const dur = (Date.now() - startedAt) / 1000;
        const blob = new Blob(chunks, { type: 'audio/webm' });
        chunks = [];

        // 길이 필터 (너무 짧거나 너무 김)
        if (dur < DEFAULTS.minDurationSec) {
          setState(false);
          note('발화가 너무 짧아요. 조금만 더 길게 말해보세요.', false);
          cleanupStream();
          return;
        }
        if (dur > DEFAULTS.maxDurationSec) {
          note('발화가 너무 길어요. 문장 단위로 짧게 녹음해 주세요.', false);
        }

        if (!isKoCorrect()) {
          // 받아쓰기(한글)가 정답일 때만 발음 평가 권장 — 규칙에 맞춰 안내
          note('먼저 KO(한글) 답을 맞춘 다음 발음을 평가해요. (정답 확인 버튼으로 KO를 맞춰주세요)', false);
          cleanupStream();
          setState(false);
          return;
        }

        if (analyses >= DEFAULTS.maxAnalysesPerCard) {
          note('평가 한도를 초과했어요. 다음 문제로 넘어가 주세요.', false);
          cleanupStream();
          setState(false);
          return;
        }

        // 서버로 전송
        const base64 = await blobToBase64(blob);
        const refText = String(getRef() || '').replace(/\s+/g, '');
        const payload = {
          referenceText: refText,
          audio: { base64, mimeType: 'audio/webm', filename: 'rec.webm', duration: Math.round(dur * 100) / 100 }
        };

        disp && (disp.innerHTML = '<div class="mt-2 text-sm text-slate-500">⏳ 평가 중…</div>');
        const res = await jsonPost(DEFAULTS.endpoint, payload);
        analyses++;

        // 표준 형태: { accuracy(0..1), transcript, confusionTags[] }
        const acc = Math.max(0, Math.min(1, Number(res.accuracy || 0)));
        const pct = Math.round(acc * 100);

        const transcript = String(res.transcript || '').trim();
        const friendly = [];
        if (res.confusionTags && Array.isArray(res.confusionTags) && res.confusionTags.length) {
          friendly.push('• 발음 유의: ' + res.confusionTags.join(', '));
        }

        // 결과 표시 (두번째 스샷 스타일 요약)
        const html = `
          <div class="mt-2 p-3 rounded border bg-white">
            <div class="text-sm text-slate-600 mb-1">Explication de la note / 점수 설명</div>
            <div class="text-lg font-semibold">Score: ${pct}%</div>
            <div class="mt-1 text-sm"><b>Référence:</b> ${refText || '(vide)'}</div>
            <div class="mt-1 text-sm"><b>Ma prononciation:</b> ${transcript || '(vide)'}</div>
            ${friendly.length ? `<div class="mt-2 text-xs text-slate-600">${friendly.join('<br>')}</div>` : ''}
          </div>`;
        note(html);

        // 콜백 제공 (상위에서 성적 집계)
        onResult({ accuracy: acc, transcript, friendly });

      } catch (err) {
        console.error(err);
        note('평가 중 오류가 발생했어요. 다시 시도해 주세요.', false);
        // 서버 로깅
        fetch('/.netlify/functions/log-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ functionName: 'analyze-pronunciation(client)', error: String(err), pageUrl: location.href })
        }).catch(() => {});
      } finally {
        cleanupStream();
        setState(false);
        if (liveBox && liveBox.textContent && /실시간/.test(liveBox.textContent)) {
          // 라이브 자막 박스는 남겨두되, 상태 문구만 정리
          liveBox.textContent = 'En direct / 실시간 (final): ' + (liveBox.dataset.finalText || '');
        }
      }
    }

    function cleanupStream() {
      try {
        if (rec && rec.state !== 'inactive') rec.stop();
      } catch(_) {}
      try {
        media && media.getTracks().forEach(t => t.stop());
      } catch(_) {}
      rec = null; media = null;
    }

    async function stop() {
      if (!rec) return;
      rec.stop(); // ⏹️ → handleStop()에서 자동 평가
      vu.stop();
    }

    // 바인딩
    btnRec && btnRec.addEventListener('click', start);
    btnStop && btnStop.addEventListener('click', stop);
    setState(false);

    // Live STT가 있다면 최종 텍스트를 저장(표시 정리용)
    document.addEventListener('live-stt-final', (e) => {
      if (!cardEl.contains(e.target)) return;
      if (liveBox) liveBox.dataset.finalText = e.detail?.text || '';
    });
  }

  // ------- 공개 API -------
  global.Pronun = { mount };

})(window);
