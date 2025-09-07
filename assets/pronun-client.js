/* /assets/pronun-client.js */
;(function (global) {
  const DEFAULTS = {
    endpoint: '/.netlify/functions/analyze-pronunciation',
    // 크레딧 절약/반복 연습 정책
    requireKoCorrect: false,
    skipSecondPassIfAccurate: 0.99,
    maxAnalysesPerSession: 50,
    minDurationSec: 0.6,
    maxDurationSec: 10,
    cacheResults: true,
    useLocalStorageCache: true,
    selectors: {
      btnStart:  '.btn-rec-start',
      btnStop:   '.btn-rec-stop',
      canvas:    '.vu-canvas',
      result:    '.pronun-display'
    },
    // 호출자 제공
    getReferenceText: null,
    isKoCorrect: null,
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
      const v = data[x] / 128.0 - 1.0;
      const y = (canvas.height / 2) + v * (canvas.height / 2 - 4);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    state.vu.raf = requestAnimationFrame(()=>drawLoop(state));
  }

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

  async function sha256Base64(b64) {
    try {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      let h = 0; for (let i = 0; i < b64.length; i++) h = (h * 31 + b64.charCodeAt(i)) | 0;
      return 'x' + (h >>> 0).toString(16);
    }
  }

  function loadCache(key) {
    if (!key) return null;
    const k = 'pronun:' + key;
    if (memCache.has(k)) return memCache.get(k);
    try {
      const s = localStorage.getItem(k); if (s) { const v = JSON.parse(s); memCache.set(k, v); return v; }
    } catch {}
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
    const data = await jsonPost(opts.endpoint, payload);
    if (opts.cacheResults) saveCache(cacheKey, data);
    return data;
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
    analyser.fftSize = 2048;
    const data = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    return { ac, src, analyser, data, canvas, ctx, raf:0 };
  }

  function startRecording(state) {
    const chunks = [];
    const rec = new MediaRecorder(state.media.stream, { mimeType: 'audio/webm' });
    rec.ondataavailable = e => chunks.push(e.data);
    rec.start();
    state.rec = rec;
    state.chunks = chunks;
  }

  function stopRecording(state) {
    return new Promise(resolve => {
      const rec = state.rec;
      if (!rec) return resolve(null);
      rec.onstop = () => {
        try {
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
          const sameLead = da.L===db.L, sameVowel = da.V===db.V, sameTail = da.T===db.T;
          const cl = (sameLead && sameVowel && !sameTail) ? 'bg-amber-100'
                   : (sameLead && !sameVowel) ? 'bg-red-100'
                   : (!sameLead && sameVowel) ? 'bg-blue-100'
                   : 'bg-pink-100';
          refHTML += `<span class="${cl}">${a}</span>`;
          hypHTML += `<span class="${cl}">${b}</span>`;
        } else {
          refHTML += `<span class="bg-pink-100">${a}</span>`;
          hypHTML += `<span class="bg-pink-100">${b}</span>`;
        }
      } else if (a && !b) {
        refHTML += `<span class="bg-purple-100">${a}</span>`;
      } else if (!a && b) {
        hypHTML += `<span class="bg-purple-100">${b}</span>`;
      }
    }
    return { refHTML, hypHTML };
  }

  // 숫자(0-9, 연속된 자리수)를 한자어 표기로 치환 (표시/강조용)
  const DIGITS = ['영','일','이','삼','사','오','육','칠','팔','구'];
  function numToSino(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return String(n||'');
    if (n === 0) return '영';
    const units = ['', '십', '백', '천'];
    const d = String(n).split('').map(x=>+x);
    let out = '';
    for (let i=0;i<d.length;i++) {
      const p = d.length - 1 - i;
      const digit = d[i];
      if (digit === 0) continue;
      if (p === 0) { out += DIGITS[digit]; continue; }
      if (digit === 1) out += units[p];
      else out += DIGITS[digit] + units[p];
    }
    return out;
  }
  function replaceDigitSequencesWithSino(str) {
    return String(str||'').replace(/\d+/g, (m)=> numToSino(parseInt(m,10)));
  }

  function friendlyExplainBySyllable(ref, hyp){
    const msgs=[];
    const A=[...String(ref||'')], B=[...String(hyp||'')];
    const len=Math.max(A.length,B.length);
    const decomp=decomposeSyllable;
    for(let i=0;i<len;i++){
      const a=A[i]??'', b=B[i]??'';
      const op = a && b ? 'sub' : (a && !b ? 'del' : (!a && b ? 'ins' : 'eq'));
      if (op === 'eq') continue;
      if (op === 'del') {
        msgs.push({ fr:`➡️ Lettre manquante: “${a}”`, ko:`➡️ 글자 빠짐: “${a}”` });
        continue;
      }
      if (op === 'ins') {
        msgs.push({ fr:`➕ Lettre en plus: “${b}”`, ko:`➕ 글자 추가: “${b}”` });
        continue;
      }
      const da = decomp(a), db = decomp(b);
      if (da && db) {
        if (da.L !== db.L) msgs.push({ fr:`🔡 Consonne du début changée: ${da.L} → ${db.L}`, ko:`🔡 초성 바뀜: ${da.L} → ${db.L}` });
        if (da.V !== db.V) msgs.push({ fr:`🅰️ Voyelle changée: ${da.V} → ${db.V}`, ko:`🅰️ 모음 바뀜: ${da.V} → ${db.V}` });
        if (da.T !== db.T) msgs.push({ fr:`📎 Finale changée: ${da.T||'∅'} → ${db.T||'∅'}`, ko:`📎 받침 바뀜: ${da.T||'∅'} → ${db.T||'∅'}` });
      } else {
        msgs.push({ fr:`✏️ Changement de lettre: ${a||'∅'} → ${b||'∅'}`, ko:`✏️ 글자 바뀜: ${a||'∅'} → ${b||'∅'}` });
      }
    }
    return msgs;
  }

  function renderResult(el, pct, tags, _explainFromServer, refText, transcript) {
    const p = Math.round((pct || 0) * 100);
    const label = `Précision de prononciation ${p}% / 발음 정확도 ${p}%`;

    const pill = (p >= 85)
      ? `<span style="display:inline-block;border-radius:9999px;padding:.25rem .5rem;border:1px solid;background:#e7f8ee;color:#0a7a3b;border-color:#9be4b8">${label}</span>`
      : `<span style="display:inline-block;border-radius:9999px;padding:.25rem .5rem;border:1px solid;background:#fde8e8;color:#9b1c1c;border-color:#f7b4b4">${label}</span>`;

    // 숫자 표기 통일(보기 편하게): 15 → 십오 등
    const refDisplay = replaceDigitSequencesWithSino(refText||'');
    const hypDisplay = replaceDigitSequencesWithSino(transcript||'');

    const { refHTML, hypHTML } = highlightPair(refDisplay, hypDisplay);

    const friendly = (p < 99) ? friendlyExplainBySyllable(refDisplay, hypDisplay) : [];
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
        <div><strong>학생 발음:</strong> ${hypHTML}</div>
      </div>
      ${detailsHTML}
      ${disclaimer}
    `;
  }

  function msg(el, text) { el.innerHTML = `<div class="small-muted">${text}</div>`; }

  function mount(cardEl, options) {
    const opts = Object.assign({}, DEFAULTS, options||{});
    if (!cardEl) return;
    const btnStart = cardEl.querySelector(opts.selectors.btnStart);
    const btnStop  = cardEl.querySelector(opts.selectors.btnStop);
    const canvas   = cardEl.querySelector(opts.selectors.canvas);
    const resultEl = cardEl.querySelector(opts.selectors.result);
    if (!btnStart || !btnStop || !canvas || !resultEl) return;

    let state = { media:null, vu:null, rec:null, chunks:[], startedAt:0 };

    btnStart.addEventListener('click', async () => {
      if (session.analyses >= opts.maxAnalysesPerSession) {
        if (typeof opts.onCostGuardHit === 'function') opts.onCostGuardHit();
        return;
      }
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
      try { state.vu && cancelAnimationFrame(state.vu.raf); } catch {}
      try { state.media && state.media.stream && state.media.stream.getTracks().forEach(t=>t.stop()); } catch {}
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
          opts.onResult({ accuracy: data.accuracy, confusionTags: data.confusionTags, transcript: data.transcript, key, base64, duration });
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
