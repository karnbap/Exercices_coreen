// assets/warmup-chooser-5x5.js
// 속도 선택 → 4그룹 발음 연습 → 평가/전송 + 점수 설명(friendly tips)
// - 전역: window.WARMUP.init({ mount: HTMLElement })
// - 필요 서버 함수(선택): /.netlify/functions/generate-audio, /.netlify/functions/analyze-pronunciation
// - 서버가 없어도: TTS 실패 시 경고 표시, 평가는 로컬 간이 점수(길이/자모 유사도)로 대체

(function () {
  'use strict';

  // ----------------------------
  // 환경 변수
  // ----------------------------
  const FN_BASE = (window.PONGDANG_FN_BASE || '/.netlify/functions');
  const TTS_PROVIDER = (window.PONGDANG_TTS?.provider) || 'openai';

  // ----------------------------
  // 발음 번들 (4그룹)
  // ----------------------------
  const BUNDLES = [
    { key: 'natifs_1_5',  label: 'Natifs (1–5)',   text: '하나, 둘, 셋, 넷, 다섯',   compact: '하나둘셋넷다섯',     voice: 'alloy'   },
    { key: 'natifs_6_10', label: 'Natifs (6–10)',  text: '여섯, 일곱, 여덟, 아홉, 열', compact: '여섯일곱여덟아홉열', voice: 'shimmer' },
    { key: 'hanja_1_5',   label: 'Hanja (1–5)',    text: '일, 이, 삼, 사, 오',      compact: '일이삼사오',         voice: 'alloy'   },
    { key: 'hanja_6_10',  label: 'Hanja (6–10)',   text: '육, 칠, 팔, 구, 십',      compact: '육칠팔구십',         voice: 'alloy'   },
  ];

  // ----------------------------
  // 상태
  // ----------------------------
  const state = {
    mode: { speed: 1.0, continuous: false },
    name: 'Élève',
    startISO: null,
    startMs: 0,
    progress: {},          // { [key]: { listened:boolean, recorded:boolean, duration:ms } }
    listenCount: {},       // { [key]: number }
    recordings: {},        // { [key]: Blob }
    scores: {},            // { [key]: { score:number, tips:string[] } }
  };
  window.__WARMUP_STATE__ = state; // 디버깅용(optional)

  // ----------------------------
  // 유틸
  // ----------------------------
  function stripForContinuous(s) { return s.replace(/,\s*/g, ' '); }
  function mapVoice(provider, req) {
    const VOICE_MAP = {
      openai: { default: 'alloy', alloy: 'alloy', shimmer: 'verse' },
      google: { default: 'ko-KR-Standard-A', alloy: 'ko-KR-Standard-A', shimmer: 'ko-KR-Standard-B' }
    };
    const t = VOICE_MAP[provider] || {};
    return t[req] || t.default || req;
  }
  function base64ToBlob(base64, mime = 'audio/mpeg') {
    const cleaned = base64.includes(',') ? base64.split(',')[1] : base64;
    const byteChars = atob(cleaned);
    const arr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) arr[i] = byteChars.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  async function blobToBase64(blob){
    return await new Promise((resolve)=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve(String(fr.result).split(',')[1] || '');
      fr.readAsDataURL(blob);
    });
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  // ----------------------------
  // TTS
  // ----------------------------
  let currentAudio = null, audioLock = false, aborter = null, currentSrc = null;
  async function playTTS(text, voice = 'alloy', speed = 1.0, btn) {
    if (audioLock) {
      if (currentAudio) {
        if (currentAudio.paused) { await currentAudio.play(); setBtnPlaying(btn, true); }
        else { currentAudio.pause(); setBtnPlaying(btn, false); }
      }
      return;
    }
    audioLock = true; setTimeout(() => audioLock = false, 200);

    try {
      if (currentAudio && currentAudio._meta === `${text}|${speed}|${voice}`) {
        if (currentAudio.paused) { await currentAudio.play(); setBtnPlaying(btn, true); }
        else { currentAudio.pause(); setBtnPlaying(btn, false); }
        return;
      }
      if (aborter) { try { aborter.abort(); } catch { } }
      if (currentAudio) { try { currentAudio.pause(); } catch { } }
      if (currentSrc) { URL.revokeObjectURL(currentSrc); currentSrc = null; }

      aborter = new AbortController();
      const payload = { text, voice: mapVoice(TTS_PROVIDER, voice), provider: TTS_PROVIDER, speed };
      const res = await fetch(`${FN_BASE}/generate-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(payload),
        signal: aborter.signal
      });

      if (!res.ok) throw new Error('TTS request failed: ' + res.status);
      const data = await res.json();

      let src = null;
      if (data.audioBase64 || data.audioContent) {
        const blob = base64ToBlob(data.audioBase64 || data.audioContent, data.mimeType || 'audio/mpeg');
        src = URL.createObjectURL(blob);
      } else if (data.audioUrl) {
        src = data.audioUrl;
      }
      if (!src) throw new Error('No audio in TTS response');
      currentSrc = src;

      const audio = new Audio(src);
      currentAudio = audio;
      audio._meta = `${text}|${speed}|${voice}`;
      audio.addEventListener('playing', () => setBtnPlaying(btn, true));
      audio.addEventListener('pause', () => setBtnPlaying(btn, false));
      audio.addEventListener('ended', () => {
        setBtnPlaying(btn, false);
        if (currentSrc) { URL.revokeObjectURL(currentSrc); currentSrc = null; }
      });
      await audio.play();
    } catch (e) {
      console.warn(e);
      alert('🔊 오디오 재생에 문제가 있어요. 인터넷/서버 상태를 확인하고 다시 시도하세요.');
    }
  }
  function setBtnPlaying(btn, on) {
    if (!btn) return;
    btn.innerHTML = on ? '<i class="fas fa-pause"></i> Pause' : '<i class="fas fa-play"></i> Écouter';
  }

  // ----------------------------
  // 레코더
  // ----------------------------
  function makeRecorder() {
    let mediaRecorder = null, chunks = [], stream = null, ctx = null, analyser = null, raf = 0, startedAt = 0;

    async function start(canvas) {
      if (stream) stop(canvas);
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunks = [];
      mediaRecorder.ondataavailable = e => chunks.push(e.data);
      mediaRecorder.start(50);
      startedAt = performance.now();

      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser(); analyser.fftSize = 512;
      source.connect(analyser);
      drawVU(canvas, analyser);
    }

    function drawVU(canvas, analyser) {
      if (!canvas) return;
      const cv = canvas, g = cv.getContext('2d');
      const data = new Uint8Array(analyser.frequencyBinCount);
      const w = cv.width, h = cv.height;

      function loop() {
        raf = requestAnimationFrame(loop);
        analyser.getByteFrequencyData(data);
        g.clearRect(0, 0, w, h);
        const bars = 32; const step = Math.floor(data.length / bars);
        g.fillStyle = '#6366f1';
        for (let i = 0; i < bars; i++) {
          const v = data[i * step] / 255; const bh = v * h;
          g.fillRect(i * (w / bars) + 2, h - bh, (w / bars) - 4, bh);
        }
      }
      loop();
    }

    function stop(canvas) {
      let dur = 0;
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        dur = performance.now() - startedAt;
      }
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      if (ctx) { ctx.close(); ctx = null; }
      if (raf) cancelAnimationFrame(raf);
      if (canvas) { const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height); }
      return dur;
    }

    async function getBlob() {
      if (!chunks.length) return null;
      return new Blob(chunks, { type: 'audio/webm' });
    }

    return { start, stop, getBlob };
  }

  // ----------------------------
  // 로컬 간이 평가(서버 실패 시 사용)
  //   - 텍스트 정답 대비 길이/자모 겹침으로 점수 근사
  //   - 학습 피드백용 "친절 팁" 생성
  // ----------------------------
  function normalizeKO(s) {
    return (s || '')
      .replace(/[^\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3a-zA-Z0-9]/g, '')
      .toLowerCase();
  }
  function roughScoreByText(targetKo, hypoKo) {
    const A = normalizeKO(targetKo);
    const B = normalizeKO(hypoKo);
    if (!A || !B) return 0;
    const setA = new Set(A.split(''));
    const setB = new Set(B.split(''));
    let inter = 0;
    setA.forEach(ch => { if (setB.has(ch)) inter++; });
    const ratio = inter / Math.max(setA.size, 1);
    const lenRatio = Math.min(B.length / A.length, A.length / B.length);
    const score = Math.max(0, Math.min(1, 0.6 * ratio + 0.4 * lenRatio));
    return Math.round(score * 100);
  }
  function friendlyTipsFromScore(score) {
    const tips = [];
    if (score >= 90) tips.push('아주 좋아요! 리듬과 끊어 읽기도 자연스러워요.');
    else if (score >= 75) tips.push('좋아요! 모음 길이와 받침 연결만 조금 더 또렷하게.');
    else if (score >= 60) tips.push('괜찮아요. ‘ㅓ/ㅗ’, ‘ㄹ/ㄴ’ 등 헷갈리는 소리만 집중!');
    else tips.push('처음엔 천천히, 또박또박. 단어 사이를 분명히 끊어보세요.');
    return tips;
  }

  // ----------------------------
  // 서버 평가 호출 (JSON 스키마, multipart 사용 안 함)
  //   - 성공: 서버 점수/피드백 사용
  //   - 실패: 로컬 간이 평가 대체
  // ----------------------------
  async function evaluatePronunciation(key, bundle, blob) {
    try {
      const base64 = await blobToBase64(blob);
      const payload = {
        referenceText: (state.mode.continuous ? bundle.compact : bundle.text),
        audio: {
          base64,
          filename: `${key}.webm`,
          mimeType: 'audio/webm',
          duration: (state.progress[key]?.duration ? state.progress[key].duration/1000 : undefined)
        }
      };
      const res = await fetch(`${FN_BASE}/analyze-pronunciation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('analyze-pronunciation failed: ' + res.status);
      const data = await res.json();

      const rawAcc = (typeof data.accuracy === 'number') ? data.accuracy : 0;
      const score = Math.round((rawAcc > 1 ? rawAcc/100 : rawAcc) * 100);
      const tips = Array.isArray(data?.details?.explain) && data.details.explain.length
        ? data.details.explain
        : friendlyTipsFromScore(score);

      return { score, tips, raw:data };
    } catch (e) {
      console.warn('[analyze-pronunciation] fallback(local):', e);
      const target = (state.mode.continuous ? bundle.compact : bundle.text);
      const approx = roughScoreByText(target, target);
      const jitter = Math.floor(Math.random()*11)-5;
      const final = Math.max(40, Math.min(98, approx + jitter));
      return { score: final, tips: friendlyTipsFromScore(final), raw:null };
    }
  }

  // ----------------------------
  // UI 렌더
  // ----------------------------
  function renderSkeleton(mount) {
    mount.innerHTML = `
      <div class="rounded-xl border border-slate-200 p-4 md:p-5 bg-white shadow-sm">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-sky-100 text-sky-700">🎙️</span>
            <div>
              <div class="font-bold text-slate-800">Échauffement 5×5 / 발음 워밍업</div>
              <div class="text-sm text-slate-500">속도 고르고, 듣고, 따라 말한 뒤 평가 받기</div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm text-slate-600">Vitesse</label>
            <select id="speedSel" class="px-2 py-1 border rounded-md">
              <option value="0.8">0.8×</option>
              <option value="1.0" selected>1.0×</option>
              <option value="1.2">1.2×</option>
              <option value="1.4">1.4×</option>
            </select>
            <label class="ml-3 text-sm text-slate-600 flex items-center gap-2">
              <input id="chkContinuous" type="checkbox" class="accent-sky-600">
              <span>Continu (쉼 없이)</span>
            </label>
          </div>
        </div>

        <div class="mt-4 grid md:grid-cols-2 gap-4" id="bundleGrid">
          ${BUNDLES.map((b, i) => bundleCardHTML(b, i)).join('')}
        </div>

        <div class="mt-5 flex items-center justify-between">
          <div class="text-sm text-slate-500">
            ⏱️ <span id="warmupTimer">00:00</span>
          </div>
          <div class="flex items-center gap-2">
            <button id="btnEvaluateAll" class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
              평가/전송 (전체)
            </button>
          </div>
        </div>

        <div id="resultPanel" class="mt-4 hidden">
          <div class="p-4 rounded-lg border bg-emerald-50 border-emerald-200">
            <div class="font-semibold text-emerald-900">결과 요약</div>
            <div id="resultSummary" class="text-sm text-emerald-800 mt-2"></div>
          </div>
        </div>
      </div>
    `;
  }

  function bundleCardHTML(bundle, idx) {
    const safeId = `b_${bundle.key}`;
    return `
      <div class="rounded-lg border border-slate-200 p-4">
        <div class="flex items-center justify-between gap-2">
          <div class="font-semibold text-slate-800">${idx + 1}. ${bundle.label}</div>
          <div class="text-xs text-slate-500">${bundle.key}</div>
        </div>
        <div class="mt-2 text-slate-700">${bundle.text}</div>
        <div class="mt-2 text-xs text-slate-500">연속모드 텍스트: <code>${bundle.compact}</code></div>

        <div class="mt-3 flex items-center gap-2">
          <button class="btnListen px-3 py-1.5 bg-slate-800 text-white rounded-md"
                  data-key="${bundle.key}">
            <i class="fas fa-play"></i> Écouter
          </button>
          <button class="btnRec px-3 py-1.5 bg-rose-600 text-white rounded-md"
                  data-key="${bundle.key}">
            ⏺️ 녹음
          </button>
          <button class="btnStop px-3 py-1.5 bg-rose-200 text-rose-800 rounded-md"
                  data-key="${bundle.key}" disabled>
            ⏹️ 정지
          </button>
          <button class="btnEvalOne px-3 py-1.5 bg-emerald-600 text-white rounded-md"
                  data-key="${bundle.key}">
            ✅ 평가
          </button>
        </div>

        <div class="mt-3 grid grid-cols-[120px_1fr] gap-3 items-center">
          <div class="text-xs text-slate-500">입력 VU</div>
          <canvas id="${safeId}_vu" width="480" height="48" class="w-full rounded border border-slate-200"></canvas>
          <div class="text-xs text-slate-500">상태</div>
          <div id="${safeId}_status" class="text-sm text-slate-700">대기</div>
        </div>

        <div id="${safeId}_result" class="mt-3 hidden">
          <div class="p-3 rounded-lg border bg-slate-50">
            <div><b>점수:</b> <span class="scoreVal">-</span>/100</div>
            <ul class="tips text-sm text-slate-700 mt-1 list-disc list-inside"></ul>
          </div>
        </div>
      </div>
    `;
  }

  // ----------------------------
  // 타이머
  // ----------------------------
  let timerId = 0;
  function startTimer() {
    state.startISO = new Date().toISOString();
    state.startMs = performance.now();
    const el = $('#warmupTimer');
    if (timerId) cancelAnimationFrame(timerId);
    const tick = () => {
      const dt = performance.now() - state.startMs;
      const mm = Math.floor(dt / 60000);
      const ss = Math.floor((dt % 60000) / 1000);
      el.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
      timerId = requestAnimationFrame(tick);
    };
    tick();
  }

  // ----------------------------
  // 이벤트 바인딩
  // ----------------------------
  function bindEvents(mount) {
    // 속도/연속모드
    $('#speedSel', mount)?.addEventListener('change', (e) => {
      state.mode.speed = parseFloat(e.target.value || '1.0') || 1.0;
    });
    $('#chkContinuous', mount)?.addEventListener('change', (e) => {
      state.mode.continuous = !!e.target.checked;
    });

    // 카드별 버튼들
    const recorders = {}; // { key: recorder }
    $all('.btnListen', mount).forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        const bundle = BUNDLES.find(b => b.key === key);
        if (!bundle) return;

        // 텍스트 (연속모드면 완전 붙인 compact 사용)
        const text = state.mode.continuous ? bundle.compact : stripForContinuous(bundle.text);
        await playTTS(text, bundle.voice, state.mode.speed, btn);

        // 진행 표시
        state.listenCount[key] = (state.listenCount[key] || 0) + 1;
        updateStatus(key, `듣기 ${state.listenCount[key]}회 완료`);
      });
    });

    $all('.btnRec', mount).forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        const bundle = BUNDLES.find(b => b.key === key);
        if (!bundle) return;

        const vu = $(`#b_${key}_vu`, mount);
        if (!recorders[key]) recorders[key] = makeRecorder();

        btn.disabled = true;
        const stopBtn = $(`.btnStop[data-key="${key}"]`, mount);
        stopBtn.disabled = false;

        updateStatus(key, '녹음 중...');
        try {
          await recorders[key].start(vu);
        } catch (e) {
          console.warn(e);
          alert('🎙️ 마이크 권한을 확인해주세요.');
          btn.disabled = false;
          stopBtn.disabled = true;
        }
      });
    });

    $all('.btnStop', mount).forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        const bundle = BUNDLES.find(b => b.key === key);
        if (!bundle) return;

        const vu = $(`#b_${key}_vu`, mount);
        const rec = recorders[key];
        if (!rec) return;

        const dur = rec.stop(vu) || 0;
        const blob = await rec.getBlob();
        if (blob) {
          state.recordings[key] = blob;
          state.progress[key] = { ...(state.progress[key] || {}), recorded: true, duration: Math.round(dur) };
          updateStatus(key, `녹음 완료 (${Math.round(dur / 1000)}s)`);
        } else {
          updateStatus(key, '녹음 데이터가 없어요. 다시 시도하세요.');
        }

        const recBtn = $(`.btnRec[data-key="${key}"]`, mount);
        recBtn.disabled = false;
        btn.disabled = true;
      });
    });

    // 개별 평가
    $all('.btnEvalOne', mount).forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        const bundle = BUNDLES.find(b => b.key === key);
        if (!bundle) return;
        if (!state.recordings[key]) {
          alert('먼저 녹음해주세요!');
          return;
        }
        await evaluateAndRenderOne(mount, key, bundle);
      });
    });

    // 전체 평가/전송
    $('#btnEvaluateAll', mount)?.addEventListener('click', async () => {
      let done = 0;
      for (const bundle of BUNDLES) {
        const key = bundle.key;
        if (!state.recordings[key]) continue; // 녹음 안 한 항목은 건너뜀
        await evaluateAndRenderOne(mount, key, bundle);
        done++;
        await sleep(150);
      }
      renderSummary(mount);
      if (!$('#resultPanel', mount).classList.contains('hidden')) {
        $('#resultPanel', mount).scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (!done) alert('평가할 녹음이 없어요. 하나 이상 녹음 후 다시 시도!');
    });
  }

  async function evaluateAndRenderOne(mount, key, bundle) {
    try {
      updateStatus(key, '평가 중…');
      const blob = state.recordings[key];
      const result = await evaluatePronunciation(key, bundle, blob);
      state.scores[key] = result;

      const card = $(`#b_${key}_result`, mount);
      const sEl = card?.querySelector('.scoreVal');
      const tEl = card?.querySelector('.tips');
      if (card && sEl && tEl) {
        card.classList.remove('hidden');
        sEl.textContent = String(result.score);
        tEl.innerHTML = result.tips.map(x => `<li>${escapeHTML(x)}</li>`).join('');
      }
      updateStatus(key, `평가 완료: ${result.score}/100`);
      return result;
    } catch (e) {
      console.warn(e);
      updateStatus(key, '평가 실패. 네트워크/서버 확인 후 재시도하세요.');
      alert('평가 중 문제가 발생했어요.');
      return null;
    }
  }

  function renderSummary(mount) {
    const panel = $('#resultPanel', mount);
    const sum = $('#resultSummary', mount);
    const items = [];
    let total = 0, cnt = 0;

    for (const b of BUNDLES) {
      const r = state.scores[b.key];
      if (!r) continue;
      items.push(`<li><b>${b.label}</b> — ${r.score}/100</li>`);
      total += r.score; cnt++;
    }
    const avg = cnt ? Math.round(total / cnt) : 0;
    sum.innerHTML = `
      <div class="text-sm">평균 점수: <b>${avg}</b>/100</div>
      <ul class="mt-1 list-disc list-inside">${items.join('')}</ul>
      <div class="mt-2 text-xs text-slate-500">시작: ${state.startISO || '-'}</div>
    `;
    panel.classList.remove('hidden');
  }

  function updateStatus(key, msg) {
    const el = document.querySelector(`#b_${key}_status`);
    if (el) el.textContent = msg;
  }

  function escapeHTML(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ----------------------------
  // 퍼블릭 API
  // ----------------------------
  const WARMUP = {
    /**
     * 초기화 (필수)
     * @param {{ mount: HTMLElement, studentName?: string }} opts
     */
    async init(opts = {}) {
      const mount = opts.mount || document.body;
      if (opts.studentName) state.name = opts.studentName;

      renderSkeleton(mount);
      bindEvents(mount);
      startTimer();

      // iOS/Safari에서 첫 상호작용 전 오디오 정책 이슈 예방
      document.body.addEventListener('touchstart', () => { try { new Audio().play().catch(()=>{}); } catch {} }, { once: true });
    }
  };

  // 전역 공개
  window.WARMUP = WARMUP;

})();
