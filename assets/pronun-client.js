/* /assets/pronun-client.js */
;(function (global) {
  const DEFAULTS = {
    endpoint: '/.netlify/functions/analyze-pronunciation',
    // 크레딧 절약/반복 연습 정책
    requireKoCorrect: false,              // KO 정답 여부와 무관하게 STT 수행
    skipSecondPassIfAccurate: 0.99,       // 더 섬세하게: 1차 ≥ 99%면 2차(Whisper) 생략 권고 (높여서 민감도 ↑)
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

  // --- 한글 음절 분해/강조 표시 유틸 ---
  const Ls = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const Vs = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  const Ts = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  function decomposeSyllable(ch){
    const code = ch && ch.charCodeAt && ch.charCodeAt(0);
    if (!code || code < 0xAC00 || code > 0xD7A3) return null;
    const S = code - 0xAC00;
    const L = Math.floor(S / 588);
    const V = Math.floor((S % 588) / 28);
    const T = S % 28;
    return { L: Ls[L], V: Vs[V], T: Ts[T] || '' };
  }
  function highlightPair(ref, hyp){
    const A=[...String(ref||'')], B=[...String(hyp||'')];
    const len=Math.max(A.length,B.length);
    let refHTML='', hypHTML='';
    for(let i=0;i<len;i++){
      const a=A[i]??'', b=B[i]??'';
      if(a && b){
        if(a===b){ refHTML+=a; hypHTML+=b; continue; }
        const da=decomposeSyllable(a), db=decomposeSyllable(b);
        if(da && db){
          const diffs=[];
          if(da.L!==db.L) diffs.push(`초성 ${da.L}→${db.L}`);
          if(da.V!==db.V) diffs.push(`중성 ${da.V}→${db.V}`);
          if(da.T!==db.T) diffs.push(`종성 ${da.T||'∅'}→${db.T||'∅'}`);
          const title=`${diffs.join(', ')}`;
          refHTML+=`<mark style="background:#ffedd5;border-radius:4px;padding:0 2px" title="${title}">${a}</mark>`;
          hypHTML+=`<mark style="background:#fee2e2;border-radius:4px;padding:0 2px" title="${title}">${b}</mark>`;
        } else {
          refHTML+=`<mark style="background:#ffedd5;border-radius:4px;padding:0 2px">${a||'∅'}</mark>`;
          hypHTML+=`<mark style="background:#fee2e2;border-radius:4px;padding:0 2px">${b||'∅'}</mark>`;
        }
      } else if (a && !b){
        refHTML+=`<mark style="background:#ffedd5;border-radius:4px;padding:0 2px">${a}</mark>`;
      } else if (!a && b){
        hypHTML+=`<mark style="background:#fee2e2;border-radius:4px;padding:0 2px">${b}</mark>`;
      }
    }
    return {refHTML, hypHTML};
  }

  // == 쉬운 용어 설명 생성: 모음/자음 바뀜·빠짐·추가 (FR/KO 병기) ==
function friendlyExplainBySyllable(refText = '', hypText = '') {
  const ref = [...refText];
  const hyp = [...hypText];
  const { pairs, ops } = alignSyllables(ref, hyp); // (a,b,op) 배열

  const msgs = [];
  const Ls = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const Vs = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  const Ts = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

  function decomp(ch) {
    const c = ch && ch.charCodeAt && ch.charCodeAt(0);
    if (!c || c < 0xAC00 || c > 0xD7A3) return null;
    const S=c-0xAC00, L=Math.floor(S/588), V=Math.floor((S%588)/28), T=S%28;
    return { L: Ls[L], V: Vs[V], T: Ts[T]||'' };
  }

  for (const { a, b, op } of pairs) {
    if (op === 'equal') continue;

    if (op === 'del') {
      msgs.push({
        fr: `➡️ Lettre manquante: “${a}”`,
        ko: `➡️ 글자 빠짐: “${a}”`
      });
      continue;
    }
    if (op === 'ins') {
      msgs.push({
        fr: `➕ Lettre en plus: “${b}”`,
        ko: `➕ 글자 추가: “${b}”`
      });
      continue;
    }

    // op === 'sub'
    const da = decomp(a), db = decomp(b);
    if (da && db) {
      if (da.L !== db.L) {
        msgs.push({
          fr: `🔡 Consonne du début changée: ${da.L} → ${db.L}`,
          ko: `🔡 초성 바뀜: ${da.L} → ${db.L}`
        });
      }
      if (da.V !== db.V) {
        msgs.push({
          fr: `🅰️ Voyelle changée: ${da.V} → ${db.V}`,
          ko: `🅰️ 모음 바뀜: ${da.V} → ${db.V}`
        });
      }
      if (da.T !== db.T) {
        const from = da.T || '∅', to = db.T || '∅';
        const isMissing = da.T && !db.T;
        msgs.push({
          fr: isMissing ? `🧱 Finale (받침) manquante: ${da.T}` : `🧱 Finale changée: ${from} → ${to}`,
          ko: isMissing ? `🧱 받침 빠짐: ${da.T}` : `🧱 받침 바뀜: ${from} → ${to}`
        });
      }
    } else {
      msgs.push({
        fr: `✏️ Changement de lettre: ${a || '∅'} → ${b || '∅'}`,
        ko: `✏️ 글자 바뀜: ${a || '∅'} → ${b || '∅'}`
      });
    }
  }

  // 동일한 문구 중복 줄이기 (앞쪽 6개만)
  const uniq = [];
  const seen = new Set();
  for (const m of msgs) {
    const k = `${m.fr}||${m.ko}`;
    if (!seen.has(k)) { seen.add(k); uniq.push(m); }
    if (uniq.length >= 6) break;
  }
  return uniq;
}

// == 음절 정렬 (삽입/삭제/치환 판정용 간단 DP) ==
function alignSyllables(A, B) {
  const m=A.length, n=B.length;
  const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  const bt=Array.from({length:m+1},()=>Array(n+1).fill(null));
  for(let i=0;i<=m;i++){dp[i][0]=i; bt[i][0]='D'}
  for(let j=0;j<=n;j++){dp[0][j]=j; bt[0][j]='I'}
  bt[0][0]=null;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      const cost = A[i-1]===B[j-1]?0:1;
      let best=dp[i-1][j-1]+cost, op = cost? 'S':'M';
      if (dp[i-1][j]+1 < best){best=dp[i-1][j]+1; op='D'}
      if (dp[i][j-1]+1 < best){best=dp[i][j-1]+1; op='I'}
      dp[i][j]=best; bt[i][j]=op;
    }
  }
  const pairs=[]; let i=m,j=n;
  while(i>0 || j>0){
    const op=bt[i][j];
    if (op==='M'){ pairs.push({a:A[i-1],b:B[j-1],op:'equal'}); i--; j--; }
    else if (op==='S'){ pairs.push({a:A[i-1],b:B[j-1],op:'sub'}); i--; j--; }
    else if (op==='D'){ pairs.push({a:A[i-1],b:'',op:'del'}); i--; }
    else if (op==='I'){ pairs.push({a:'',b:B[j-1],op:'ins'}); j--; }
    else break;
  }
  pairs.reverse();
  return { pairs, ops: bt };
}


  function renderResult(el, pct, tags, _explainFromServer, refText, transcript) {
  const p = Math.round((pct || 0) * 100);
  const label = `Précision de prononciation ${p}% / 발음 정확도 ${p}%`;

  const pill = (p >= 85)
    ? `<span style="display:inline-block;border-radius:9999px;padding:.25rem .6rem;font-size:.8rem;border:1px solid; background:#e7f8ee;color:#0a7a3b;border-color:#9be4b8">${label}</span>`
    : `<span style="display:inline-block;border-radius:9999px;padding:.25rem .6rem;font-size:.8rem;border:1px solid; background:#fde8e8;color:#9b1c1c;border-color:#f7b4b4">${label}</span>`;

  // 문장 내 하이라이트
  const { refHTML, hypHTML } = highlightPair(refText||'', transcript||'');

  // 어린이 친화 설명(서버 explain 대신 로컬 생성)
  const friendly = (p < 99) ? friendlyExplainBySyllable(refText||'', transcript||'') : [];
  const items = friendly.map(e => `<li>${e.fr} / ${e.ko}</li>`).join('');
  const detailsHTML = friendly.length
    ? `<ul class="small-muted mt-2 list-disc pl-5">${items}</ul>`
    : '';

  const tagStr = (tags && tags.length)
    ? `<div class="small-muted mt-1">⚠️ ${'Confusions détectées / 혼동'}: ${tags.join(', ')}</div>`
    : '';

  const disclaimer = `<div class="small-muted mt-2 italic">
    🧪 Fonction en test — les résultats peuvent ne pas être 100% exacts. Merci de nous dire s’il y a un truc bizarre !
    / 시험 중 기능이에요. 100% 정확하지 않을 수 있어요. 이상한 점이 있으면 꼭 알려주세요!
  </div>`;

  el.innerHTML = `
    ${pill}
    ${tagStr}
    <div class="mt-2 korean-font">
      <div><strong>정확한 발음:</strong> ${refHTML}</div>
      <div><strong>학생 발음(전사):</strong> ${hypHTML}</div>
    </div>
    ${detailsHTML}
    ${disclaimer}
  `;
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
        renderResult(resultEl, data.accuracy, data.confusionTags, data.details?.explain, ref, data.transcript);
       if (typeof opts.onResult === 'function') {
        const friendly = (typeof friendlyExplainBySyllable === 'function')
          ? friendlyExplainBySyllable(ref, data.transcript || '')
          : [];
        opts.onResult({
          accuracy: data.accuracy,
          confusionTags: data.confusionTags,
          transcript: data.transcript,
          key,
          friendly
        });
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
