/* warmup-5x5.js
 * 5×5 숫자 워밍업: 듣기 → 녹음 → 평가
 * - (신규) 각 스테이지에서 참조 오디오 길이(refDurationSec) 기록
 * - (신규) 녹음 길이(userDurationSec)와 함께 Scoring.gradeKO에 전달해
 *         1.0×/1.5×에서 속도(템포) 페널티 반영
 */

(function (global) {
  const FN = window.PONGDANG_FN_BASE || '/.netlify/functions';
  const TTS_ENDPOINT = `${FN}/generate-audio`;
  const MODE = new URLSearchParams(location.search).get('mode') || 'normal'; // slow|normal|fast
  const SPEED = MODE === 'slow' ? 0.7 : MODE === 'fast' ? 1.5 : 1.0;

  // 5×5 묶음
  const PACKS = [
    { label: 'Natifs 1–5',  items: ['하나','둘','셋','넷','다섯'] },
    { label: 'Natifs 6–10', items: ['여섯','일곱','여덟','아홉','열'] },
    { label: 'Hanja 1–5',   items: ['일','이','삼','사','오'] },
    { label: 'Hanja 6–10',  items: ['육','칠','팔','구','십'] },
    { label: 'Mix',         items: ['한 주','일주일','세 시','15분','30초'] }
  ];

  const WU = {
    stages: [],
    results: [],
    repeat: Math.max(2, Number(window.WARMUP_REPEAT || 2)),
  };
  window.WU_RESULTS = WU; // 결과 전송 시 참조할 수 있도록 외부 노출

  // ========= 유틸 =========
  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }
  async function tts(text, voice = 'alloy', speed = SPEED) {
    const res = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ text, voice, speed })
    });
    if (!res.ok) throw new Error('TTS HTTP '+res.status);
    const { audioBase64, mimeType } = await res.json();
    // base64→Blob→ObjectURL (브라우저 안정 재생)
    const blob = b64ToBlob(audioBase64, mimeType || 'audio/mp3');
    const url = URL.createObjectURL(blob);
    return { url, blob, mimeType };
  }
  function b64ToBlob(base64, mimeType) {
    const byteStr = atob(base64);
    const len = byteStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = byteStr.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || 'audio/mp3' });
  }

  // 간단 녹음기
  async function recordOnce(maxSec = 12) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const chunks = [];
    let startedAt = 0;
    let stoppedAt = 0;

    const p = new Promise((resolve, reject) => {
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstart = () => { startedAt = performance.now(); };
      rec.onstop = () => {
        stoppedAt = performance.now();
        const dur = Math.max(0.2, (stoppedAt - startedAt) / 1000);
        const blob = new Blob(chunks, { type: 'audio/webm' });
        resolve({ blob, duration: dur, mimeType: 'audio/webm' });
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
      };
      rec.onerror = (e) => reject(e.error || e.name || e);
    });

    rec.start();
    // 자동 제한
    const to = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, maxSec * 1000);

    return {
      stop: () => { clearTimeout(to); if (rec.state === 'recording') rec.stop(); },
      done: p
    };
  }

  // ========= 렌더 =========
  document.addEventListener('DOMContentLoaded', () => {
    const wrap = document.getElementById('stages-wrap');
    PACKS.forEach((pack, idx) => {
      const stage = {
        idx,
        label: pack.label,
        items: pack.items,
        refDurationSec: 0,     // (신규) 기준 오디오 길이
        lastEval: null
      };
      const node = renderStage(stage);
      wrap.appendChild(node);
      WU.stages.push({ ...stage, node });
    });

    // 반복 버튼
    const r2 = document.getElementById('btn-repeat-2');
    const r3 = document.getElementById('btn-repeat-3');
    function syncRepeatUI() {
      if (WU.repeat === 2) { r2.classList.add('active'); r3.classList.remove('active'); }
      else { r3.classList.add('active'); r2.classList.remove('active'); }
    }
    r2.addEventListener('click', () => { WU.repeat = 2; syncRepeatUI(); });
    r3.addEventListener('click', () => { WU.repeat = 3; syncRepeatUI(); });
    syncRepeatUI();
  });

  function renderStage(stage) {
    const refText = stage.items.join(' · ');
    const id = `stg-${stage.idx}`;
    const node = el(`
      <section class="info-card" id="${id}">
        <div class="flex items-center justify-between gap-3 mb-2">
          <h4 class="font-bold">${stage.label}</h4>
          <div class="text-xs text-slate-500">${MODE.toUpperCase()} · ${SPEED.toFixed(1)}×</div>
        </div>
        <div class="px-3 py-2 rounded border bg-white mb-2 text-slate-800">${refText}</div>

        <div class="flex flex-wrap gap-2 mb-2">
          <button class="btn btn-outline btn-say"><i class="fa-solid fa-volume-high"></i> Écouter</button>
          <button class="btn btn-secondary btn-rec"><i class="fa-solid fa-microphone"></i> S’enregistrer</button>
          <button class="btn btn-primary btn-eval" disabled><i class="fa-solid fa-check"></i> Évaluer</button>
        </div>

        <div class="text-sm text-slate-600 mb-2">
          <span class="ref-dur">—</span>
          <span class="sep hidden"> · </span>
          <span class="rec-dur">—</span>
        </div>

        <div class="rounded border bg-slate-50 px-3 py-2 text-sm">
          <div class="res-line">Score: <b class="score">—</b></div>
          <div class="res-reason text-slate-600 mt-1"></div>
        </div>
      </section>
    `);

    const btnSay  = node.querySelector('.btn-say');
    const btnRec  = node.querySelector('.btn-rec');
    const btnEval = node.querySelector('.btn-eval');

    const refDurEl = node.querySelector('.ref-dur');
    const recDurEl = node.querySelector('.rec-dur');
    const sepEl    = node.querySelector('.sep');

    const scoreEl  = node.querySelector('.score');
    const reasonEl = node.querySelector('.res-reason');

    let lastTTS = null;
    let lastRec = null;

    btnSay.addEventListener('click', async () => {
      btnSay.disabled = true;
      try {
        const { url } = await tts(refText, pickVoice(stage.idx), SPEED);
        const audio = new Audio(url);
        // 길이 측정
        await new Promise((res, rej) => {
          const onMeta = () => res();
          const onErr = (e) => rej(e);
          audio.addEventListener('loadedmetadata', onMeta, { once: true });
          audio.addEventListener('error', onErr, { once: true });
        });
        // (신규) 기준 오디오 길이 기록
        stage.refDurationSec = Math.max(0.1, audio.duration || 0);
        lastTTS = { url, duration: stage.refDurationSec };
        refDurEl.textContent = `🎧 Réf: ${stage.refDurationSec.toFixed(2)}s`;
        sepEl.classList.remove('hidden');

        // 반복 재생
        let count = 0;
        audio.playbackRate = 1.0; // 이미 서버에서 speed 반영된 파일
        audio.addEventListener('ended', async () => {
          count++;
          if (count < WU.repeat) {
            audio.currentTime = 0;
            await audio.play();
          }
        });
        await audio.play();
      } catch (e) {
        console.error(e);
        alert('TTS erreur / 오디오 생성 오류');
      } finally {
        btnSay.disabled = false;
      }
    });

    btnRec.addEventListener('click', async () => {
      btnRec.disabled = true;
      btnEval.disabled = true;
      try {
        const rec = await recordOnce(12);
        // 안내: 다시 누르면 정지
        btnRec.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
        const stopOnClick = () => { rec.stop(); };
        btnRec.addEventListener('click', stopOnClick, { once: true });

        const r = await rec.done;
        lastRec = r; // { blob, duration, mimeType }
        recDurEl.textContent = `🎙️ Enreg.: ${r.duration.toFixed(2)}s`;
        btnEval.disabled = false;
      } catch (e) {
        console.error(e);
        alert('Enregistrement erreur / 녹음 오류');
      } finally {
        btnRec.innerHTML = '<i class="fa-solid fa-microphone"></i> S’enregistrer';
        btnRec.disabled = false;
      }
    });

    btnEval.addEventListener('click', async () => {
      if (!lastRec) { alert('녹음 후 평가하세요 / Enregistrez d’abord.'); return; }

      // ASR 호출(선택): 이미 별도 함수가 있다면 교체
      const asrText = await simpleWhisper(lastRec.blob);

      const tempoOpt = {
        mode: MODE,                                 // slow | normal | fast
        refDurationSec: stage.refDurationSec || 0,  // 재생 전이라 0이면, 길이 기준 없음 → 페널티 0
        userDurationSec: lastRec.duration || 0
      };

      // === 핵심 변경: Scoring.gradeKO에 tempo 옵션 전달 ===
      const result = (window.Scoring || {}).gradeKO
        ? window.Scoring.gradeKO(refText, asrText, { tempo: tempoOpt })
        : { score: 0, baseScore: 0, tempoPenalty: 0, tempoReason: 'Scoring 모듈 없음', similarity: 0 };

      stage.lastEval = result;
      WU.results[stage.idx] = {
        number: stage.idx + 1,
        ko: refText,
        fr: '', // 필요 시 매핑
        userAnswer: asrText,
        isCorrect: result.score >= 90,
        listenCount: WU.repeat,
        hint1Count: 0,
        hint2Count: 0,
        recording: {
          base64: null, // 전송 시점에 필요하면 채움
          filename: `wu-${stage.idx + 1}.webm`,
          mimeType: lastRec.mimeType || 'audio/webm',
          duration: lastRec.duration
        },
        debug: {
          refDurationSec: stage.refDurationSec || 0,
          tempoPenalty: result.tempoPenalty || 0
        }
      };

      scoreEl.textContent = `${result.score} / 100`;
      reasonEl.innerHTML = [
        result.tempoReason ? `⏱️ ${escapeHTML(result.tempoReason)}` : '',
        result.baseScore !== undefined ? `🅱️ Base: ${result.baseScore}` : ''
      ].filter(Boolean).join('<br>');

      maybeRevealFinish();
    });

    return node;
  }

  function pickVoice(i) {
    // 간단 남/여 섞기
    const voices = ['alloy','shimmer','nova','fable','echo'];
    return voices[i % voices.length];
  }

  // 매우 간단한 브라우저 STT 대체(있으면 교체)
  async function simpleWhisper(blob) {
    // analyze-pronunciation 함수가 이미 있다면 거기에 붙여도 됨
    try {
      // 가능한 경우: /.netlify/functions/analyze-pronunciation
      const ep = '/.netlify/functions/analyze-pronunciation';
      const b64 = await blobToBase64(blob);
      const r = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          referenceText: '',
          audio: { base64: b64, mimeType: blob.type || 'audio/webm', filename: 'rec.webm' }
        })
      });
      if (r.ok) {
        const j = await r.json();
        return (j.transcript || '').trim();
      }
    } catch (e) { /* noop */ }
    // 실패 시 빈 문자열
    return '';
  }

  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = rej;
      fr.onload = () => res(String(fr.result || '').split(',')[1] || '');
      fr.readAsDataURL(blob);
    });
  }

  function escapeHTML(s) {
    return String(s || '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function maybeRevealFinish() {
    // 모든 스테이지에 점수가 있으면 finish-wrap 노출
    const done = WU.stages.every(st => st.lastEval);
    if (!done) return;
    const fin = document.getElementById('finish-wrap');
    if (fin) fin.classList.remove('hidden');

    // 결과 묶음(전송용) 정리
    const name = (localStorage.getItem('korean.studentName') || '').trim() || 'Élève';
    window.WU_RESULTS.questions = (WU.results || []).filter(Boolean);
    window.__pondant_startTime = window.__pondant_startTime || new Date(Date.now() - 1000 * 60 * 3);
  }

})(window);
