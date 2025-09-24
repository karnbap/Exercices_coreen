// /assets/warmup-5x5.js
// 5×5 숫자 워밍업 (듣기→따라 말하기→평가)
// - 속도바(0.7×/1.0×/1.5×) 항상 표시
// - 재생/생성 모두 state.speed 반영
// - LiveSTT.init() 자동 연결 (카드별 mount 불필요)
// - 실시간 자막 상자 .pronun-live는 숨김 제거
// - 서버 STT 실패/needsRetry 시 Live STT로 폴백 유사도(구제), 아니면 재시도 안내
(function(){
  'use strict';

  const FN_BASE = (window.PONGDANG_FN_BASE || '/.netlify/functions');

  // 최소 발화 시간(하드/소프트)
  const MIN_SEC_HARD = 0.30;  // 0.3초 미만 무효(0.1초 포함)
  const MIN_SEC_SOFT = 1.00;  // 1.0초 미만 재시도 안내

  const state = {
    speed: 1.0,      // 0.7 / 1.0 / 1.5
    repeats: 2,      // ×2 기본
    progress: {}, listenCount: {},
    startISO: null, startMs: 0, name:'Élève',
    evalCount: 0
  };

  const SPEEDS = [
    { val:0.7,  label:'0.7× Débutant' },
    { val:1.0,  label:'1.0× Normal'   },
    { val:1.5,  label:'1.5× Rapide'   },
  ];
  const SPEED_ORDER = [0.7, 1.0, 1.5];
  function getNextSpeed(curr){
    const i = SPEED_ORDER.indexOf(curr);
    return (i>=0 && i < SPEED_ORDER.length-1) ? SPEED_ORDER[i+1] : null;
  }

  const BUNDLES = [
    { key:'natifs_1_5',  label:'Natifs 1–5',  text:'하나 둘 셋 넷 다섯',     voice:'alloy'   },
    { key:'natifs_6_10', label:'Natifs 6–10', text:'여섯 일곱 여덟 아홉 열', voice:'shimmer' },
    { key:'hanja_1_5',   label:'Hanja 1–5',   text:'일 이 삼 사 오',        voice:'verse'   },
    { key:'hanja_6_10',  label:'Hanja 6–10',  text:'육 칠 팔 구 십',         voice:'nova'    }
  ];

  // ---------- utils ----------
  const $  = (s,r=document)=>r.querySelector(s);
  const esc = (s='')=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const collapse = s=>String(s||'').replace(/\s+/g,'');
  function splitTokens(s){ return String(s||'').split(/[,\s]+/).filter(Boolean); }
  function toBareBase64(s){ return String(s||'').includes(',') ? String(s).split(',')[1] : String(s||''); }
  function similarity(a,b){
    const s=String(a||''), t=String(b||''); const n=s.length, m=t.length;
    if(!n&&!m) return 1; if(!n||!m) return 0;
    const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
    for(let i=0;i<=n;i++) dp[i][0]=i; for(let j=0;j<=m;j++) dp[0][j]=j;
    for(let i=1;i<=n;i++){ for(let j=1;j<=m;j++){
      const c=s[i-1]===t[j-1]?0:1; dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+c);
    }}
    const d=dp[n][m]; return Math.max(0,1 - d/Math.max(n,1));
  }

  // --- 숫자→한글 보정 유틸: NumHangul.forceHangulNumbers 우선 사용 ---
  function normalizeKo_Numberish(s){
    if (window.NumHangul?.forceHangulNumbers) return window.NumHangul.forceHangulNumbers(s);
    return s;
  }
  function bestSimAgainstRef(refCollapsed, hypRaw){
    const normed = normalizeKo_Numberish(hypRaw);
    return similarity(refCollapsed, collapse(normed));
  }

  // ---------- 오디오 속도 적용 유틸 ----------
  function applyPlaybackRate(audio, rate){
    if(!audio) return;
    audio.playbackRate = Number(rate) || 1.0;
    if ('preservesPitch' in audio) audio.preservesPitch = false;
    if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = false;
    if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = false;
  }

function setSpeed(){
  // 1.0× 고정
  state.speed = 1.0;
}


  // ---------- TTS ----------
  function base64ToBlob(base64, mime='audio/mpeg'){
    const cleaned = base64.includes(',') ? base64.split(',')[1] : base64;
    const byteChars = atob(cleaned);
    const arr = new Uint8Array(byteChars.length);
    for(let i=0;i<byteChars.length;i++) arr[i]=byteChars.charCodeAt(i);
    return new Blob([arr],{type:mime});
  }
  function makeTTSPayload(text, speed=1.0, repeats=2){
    const provider = (window.PONGDANG_TTS?.provider) || 'openai';
    const base = splitTokens(text).join(' ');
    const seqs = Array.from({length:Math.max(1,repeats|0)}, ()=>base);
    if (provider === 'google'){
      const rate = Math.round(speed*100)+'%';
      const body = seqs.map(s=>`${s}<break time="200ms"/>`).join('');
      return { ssml:`<speak><prosody rate="${rate}">${body}</prosody></speak>` };
    }
    return { text: seqs.join(', ') };
  }
  function mapVoice(provider, req){
    const MAP = {
      openai: { default:'alloy', alloy:'alloy', shimmer:'verse', nova:'nova', echo:'echo', fable:'fable', verse:'verse' },
      google: { default:'ko-KR-Standard-A', alloy:'ko-KR-Standard-A', shimmer:'ko-KR-Standard-B', verse:'ko-KR-Standard-C', nova:'ko-KR-Standard-D' }
    };
    const t = MAP[provider]||{}; return t[req] || t.default || req;
  }
  let currentSrc=null, audioLock=false;
  async function playTTS(input, voice='alloy', speed=1.0, btn){
    const provider = (window.PONGDANG_TTS?.provider) || 'openai';
    const isSSML = typeof input === 'object' && !!input.ssml;
    const textOrSSML = (typeof input === 'object') ? (input.ssml || input.text) : input;

    if(audioLock){
      if(window.__WU_currentAudio){
        if(window.__WU_currentAudio.paused){ await window.__WU_currentAudio.play(); setBtnPlaying(btn,true); }
        else { window.__WU_currentAudio.pause(); setBtnPlaying(btn,false); }
      }
      return;
    }
    audioLock=true; setTimeout(()=>audioLock=false,200);

    try{
      // 새 요청 준비
      if(window.__WU_currentAudio){
        try{ window.__WU_currentAudio.pause(); }catch(_){}
      }
      if(currentSrc){ try{ URL.revokeObjectURL(currentSrc); }catch{} currentSrc=null; }

      const payload = isSSML
        ? { ssml: textOrSSML, voice: mapVoice(provider, voice), provider, speed }
        : { text: textOrSSML, voice: mapVoice(provider, voice), provider, speed };

      const res = await fetch(`${FN_BASE}/generate-audio`, {
        method:'POST', headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
        body: JSON.stringify(payload)
      });
      if(!res.ok) throw new Error('TTS fail '+res.status);
      const data = await res.json();

      let src=null;
      if(data.audioBase64 || data.audioContent){
        const blob = base64ToBlob(data.audioBase64 || data.audioContent, data.mimeType || 'audio/mpeg');
        src = URL.createObjectURL(blob);
      } else if (data.audioUrl) src = data.audioUrl;
      currentSrc = src;

      const audio = new Audio(src);
      window.__WU_currentAudio = audio;
      audio.classList.add('__5x5_current');

      // 선택 속도 즉시 적용
      applyPlaybackRate(audio, state.speed);

      audio.addEventListener('playing', ()=>setBtnPlaying(btn,true));
      audio.addEventListener('pause',   ()=>setBtnPlaying(btn,false));
      audio.addEventListener('ended',   ()=>{
        setBtnPlaying(btn,false);
        try{ if(currentSrc){ URL.revokeObjectURL(currentSrc); } }catch(_){}
        currentSrc=null;
      });

      await audio.play();
    }catch(_){
      alert('Problème audio. Réessaie.');
    }
  }
  function setBtnPlaying(btn,on){ if(btn) btn.innerHTML = on? '⏸️ Pause' : '▶️ Écouter'; }

  // ---------- Recorder ----------
  function pickMime(){
    const M = window.MediaRecorder;
    if (!M) return '';
    const c = (t)=> M.isTypeSupported && M.isTypeSupported(t);
    if (c('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
    if (c('audio/webm'))             return 'audio/webm';
    if (c('audio/mp4;codecs=mp4a.40.2')) return 'audio/mp4';
    return '';
  }
  function makeRecorder(){
    let mediaRecorder=null, chunks=[], stream=null, ctx=null, analyser=null, raf=0, mime='';
    async function start(canvas){
      if(stream) stop(canvas);
      stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      mime = pickMime();
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType:mime }) : new MediaRecorder(stream);
      chunks = []; mediaRecorder.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };

      const AC = window.AudioContext||window.webkitAudioContext;
      ctx = new AC(); const source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser(); analyser.fftSize = 512;
      source.connect(analyser); drawVU(canvas, analyser);
      mediaRecorder.start(50);
    }
    function drawVU(canvas, analyser){
      if(!canvas) return;
      const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
      const data = new Uint8Array(analyser.frequencyBinCount);
      (function loop(){
        raf = requestAnimationFrame(loop);
        analyser.getByteFrequencyData(data);
        g.clearRect(0,0,w,h);
        g.fillStyle='#6366f1';
        const bars=32, step=Math.floor(data.length/bars);
        for(let i=0;i<bars;i++){
          const v=data[i*step]/255, bh=v*h;
          g.fillRect(i*(w/bars)+2, h-bh, (w/bars)-4, bh);
        }
      })();
    }
    function stop(canvas){
      try{ if(mediaRecorder?.state==='recording') mediaRecorder.stop(); }catch(_){}
      try{ stream?.getTracks().forEach(t=>t.stop()); }catch(_){}
      try{ ctx?.close(); }catch(_){}
      stream=null; ctx=null; analyser=null; if(raf) cancelAnimationFrame(raf); raf=0;
      if(canvas){ const g=canvas.getContext('2d'); g.clearRect(0,0,canvas.width,canvas.height); }
    }
    async function getResult(){
      return await new Promise((resolve)=>{
        const finish = ()=>{
          const blob = new Blob(chunks, { type: (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm' });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.addEventListener('loadedmetadata', ()=>{
            let dur = Number(audio.duration || 0);
            if (!isFinite(dur) || dur <= 0) {
              dur = blob.size / 4000; // fallback (≈32kbps 기준)
            }
            URL.revokeObjectURL(url);

            const reader = new FileReader();
            reader.onloadend = ()=>{
              const full = String(reader.result||'');
              const base64 = full.includes(',') ? full.split(',')[1] : full;
              resolve({ base64, duration: dur, blob, mime: (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm' });
            };
            reader.readAsDataURL(blob);
          }, { once:true });
        };
        if(mediaRecorder && mediaRecorder.state==='recording'){
          mediaRecorder.addEventListener('stop', finish, { once:true });
          mediaRecorder.stop();
        } else finish();
      });
    }

    return { start, stop, getResult };
  }

  // ---------- 서버 채점 ----------
  async function analyzePronunciation({ referenceText, record }){
    let data = {};
    try{
      const payload = {
        referenceText,
        audio: { base64: toBareBase64(record.base64), filename:`rec_${Date.now()}.webm`, mimeType: record.mime || 'audio/webm', duration: record.duration }
      };
      const r = await fetch(`${FN_BASE}/analyze-pronunciation`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
      });
      data = await r.json().catch(()=> ({}));
    }catch(_){ data = {}; }

    const out = {
      needsRetry: !!data.needsRetry,
      accuracy: (typeof data.accuracy==='number') ? (data.accuracy>1 ? data.accuracy/100 : data.accuracy) : null,
      transcript: normalizeKo_Numberish(String(data.transcript||''))
    };
    return out;
  }

function renderSpeedToolbar(){
  // 속도는 1.0× 고정, 툴바 표시 안 함
  const bar = document.getElementById('speed-toolbar');
  if (bar) bar.remove();
  state.speed = 1.0;
}



  // ---------- 렌더 ----------
  function renderAll(){
    renderSpeedToolbar();
    updateNextAvailability();

    const wrap = document.getElementById('stages-wrap'); if(!wrap) return;
    wrap.innerHTML=''; state.progress={}; state.listenCount={};

    BUNDLES.forEach(b=>{
      state.progress[b.key] = { done:false, score:null, accuracy:null, audioBase64:null, duration:null, friendly:[] };
      state.listenCount[b.key] = 0;
      wrap.appendChild(makeBundleCard(b));
    });

    document.getElementById('finish-wrap')?.classList.add('hidden');

    ensureLiveSTT().then(()=>{ window.LiveSTT?.init?.(); }).catch(()=>{});
    checkFinish();
  }

  function makeBundleCard(bundle){
    const card = document.createElement('div');
    card.className = 'p-4 bg-white rounded-lg border';
    card.setAttribute('data-card','warmup');

    const refDisplay = splitTokens(bundle.text).join(' ');
    const refEval    = collapse(bundle.text);

    card.innerHTML = `
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div>
<div class="text-sm text-slate-500">
  Vitesse 1.0× (fixe) · Répétitions ×2 (fixe)
</div>

          <div class="text-lg font-semibold">${bundle.label} <span class="text-slate-500">· ${refDisplay}</span></div>
          <div class="text-xs text-slate-500">1) Écouter  2) Répéter  3) Évaluer</div>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-primary btn-play">▶️ Écouter</button>
          <span class="text-sm text-slate-500">écoutes: <b class="play-count">0</b></span>
        </div>
      </div>

      <div class="mt-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50/60">
        <div class="text-sm text-slate-700 mb-2">🎤 S’enregistrer & Évaluer</div>
        <div class="flex flex-wrap gap-2 mb-2">
          <button class="btn btn-secondary btn-rec-start"><i class="fa-solid fa-microphone"></i> Démarrer</button>
          <button class="btn btn-outline btn-rec-stop" disabled><i class="fa-solid fa-stop"></i> Arrêter</button>
          <button class="btn btn-primary btn-eval" disabled><i class="fa-solid fa-bolt"></i> Évaluer</button>
        </div>
        <div class="vu"><canvas class="vu-canvas" width="800" height="50"></canvas></div>
        <div class="pronun-live mt-2 text-sm p-2 rounded border bg-white" data-ref="${esc(refDisplay)}"></div>
        <audio class="mt-2 w-full audio-playback hidden" controls></audio>
        <div class="mt-2 text-sm text-slate-600 status-line">Démarrer → Arrêter → Évaluer.</div>
        <div class="mt-2 text-sm"><span class="inline-block bg-white border px-2 py-1 rounded score-pill hidden"></span></div>

        <div class="mt-3 feedback-card hidden">
          <div class="font-semibold mb-1">🧠 Explication de la note</div>
          <div class="text-sm text-slate-700 feedback-body"></div>
        </div>
      </div>
    `;

// 반복은 ×2로 고정 (UI 없음)
state.repeats = 2;


    // 듣기
    const btnPlay = card.querySelector('.btn-play');
    const playCountTag = card.querySelector('.play-count');
    btnPlay.addEventListener('click', async (e)=>{
      const payload = makeTTSPayload(bundle.text, state.speed, state.repeats);
      await playTTS(payload, bundle.voice, state.speed, e.currentTarget);
      state.listenCount[bundle.key] = (state.listenCount[bundle.key]||0) + 1;
      playCountTag.textContent = String(state.listenCount[bundle.key]);
    });

    // 녹음 + 평가
    const rec = makeRecorder();
    const btnStart = card.querySelector('.btn-rec-start');
    const btnStop  = card.querySelector('.btn-rec-stop');
    const btnEval  = card.querySelector('.btn-eval');
    const canvas   = card.querySelector('.vu-canvas');
    const status   = card.querySelector('.status-line');
    const audioUI  = card.querySelector('.audio-playback');
    const scoreTag = card.querySelector('.score-pill');
    const fbBox    = card.querySelector('.feedback-card');

    let lastRecord = null;
    let liveText = '';

    function updatePronunGuard(card, { accuracy=null, res=null } = {}){
      const st = card.__pronunState || { evalCount: 0, passed: false };
      st.evalCount += 1;
      const ok = (typeof accuracy === 'number' && accuracy >= 0.8) || (res && (res.ok || res.passed));
      if (ok) st.passed = true;
      card.__pronunState = st;
      updateNextAvailability();
    }

    card.addEventListener('livestt:final', (e)=>{
      if (e?.detail?.text) {
        const raw = String(e.detail.text).trim();
        liveText = normalizeKo_Numberish(raw);
      }
    });

    btnStart.addEventListener('click', async ()=>{
      btnStart.disabled = true; btnStop.disabled = false; btnEval.disabled = true;
      scoreTag.classList.add('hidden'); fbBox.classList.add('hidden'); fbBox.querySelector('.feedback-body').innerHTML='';
      status.textContent = 'Enregistrement… parle comme le modèle.';
      try{
        await rec.start(canvas);
        card.dispatchEvent(new CustomEvent('recording:start'));
      }catch(_){
        alert('Micro non autorisé. Vérifie les permissions du navigateur.');
        btnStart.disabled=false; btnStop.disabled=true;
      }
    });

    btnStop.addEventListener('click', async ()=>{
      btnStop.disabled = true;
      try{
        const out = await rec.getResult();
        card.dispatchEvent(new CustomEvent('recording:stop'));

        lastRecord = out;
        if (out?.blob){
          audioUI.src = URL.createObjectURL(out.blob);
          audioUI.classList.remove('hidden');
        }
        btnEval.disabled = !lastRecord;
        btnStart.disabled = false;
        status.textContent = lastRecord ? `Terminé (${(lastRecord.duration||0).toFixed(1)} s). Clique “Évaluer”.` : 'Réessaie.';
      }catch(_){
        btnStart.disabled = false;
        status.textContent = 'Problème d’enregistrement. Réessaie.';
      }
    });

    btnEval.addEventListener('click', async ()=>{
      if(!lastRecord?.base64) return;

      // 녹음 길이 가드
      const dur = Number(lastRecord?.duration || 0);
      if (dur < MIN_SEC_HARD) {
        status.textContent = `⚠️ Trop court (≈${dur.toFixed(2)} s). Parle clairement ≥ 1 s. / 너무 짧아요(≈${dur.toFixed(2)}초). 1초 이상 또박또박 말해주세요.`;
        btnEval.disabled = false;
        bumpEvalOnce();
        return;
      }
      if (dur < MIN_SEC_SOFT) {
        status.textContent = `⚠️ Phrase courte (≈${dur.toFixed(2)} s). Réessaie ≥ 1 s. / 조금 짧아요(≈${dur.toFixed(2)}초). 1초 이상으로 다시 해주세요.`;
        btnEval.disabled = false;
        bumpEvalOnce();
        return;
      }

      function bumpEvalOnce(){
        state.evalCount = (state.evalCount || 0) + 1;
        updatePronunGuard(card, {});
        updateNextAvailability();
      }

      btnEval.disabled = true;
      status.textContent = 'Évaluation en cours…';

      try{
        const srv = await analyzePronunciation({ referenceText: refEval, record: lastRecord });
        let accuracy = (typeof srv.accuracy==='number') ? srv.accuracy : 0;
        let transcript = String(srv.transcript||'');

        const refC = collapse(refEval);
        const raw = String(transcript || '').trim();
        const rawNoSpace = raw.replace(/\s+/g,'');
        const ko = collapse(normalizeKo_Numberish(raw));
        const koRatio = ko.length / Math.max(1, rawNoSpace.length);
        const sim = similarity(refC, ko);
        const tooLong = ko && refC && (ko.length > Math.max(6, refC.length * 2.5));
        const looksLikeNews = /뉴스|기자입니다|보도|앵커|두덕영/.test(raw);

        if ((ko.length < 2) || (koRatio < 0.35) || (refC.length >= 4 && sim < 0.35) || tooLong || looksLikeNews) {
          if (liveText) {
            const fb = bestSimAgainstRef(refC, liveText);
            if (fb >= 0.75) {
              accuracy = Math.max(accuracy, fb);
              transcript = normalizeKo_Numberish(liveText);
            } else {
              transcript = '';
            }
          } else {
            transcript = '';
          }
        }

        if (srv.needsRetry) {
          const fb = liveText ? bestSimAgainstRef(refC, liveText) : 0;
          if (fb >= 0.75) {
            accuracy = Math.max(accuracy, fb);
            transcript = liveText || transcript;
          } else {
            status.textContent = '⚠️ Phrase courte mal reconnue. Réessaie clairement. / 짧은 문장이 길게 인식됐어요. 또박또박 다시 한 번!';
            btnEval.disabled = false;
            bumpEvalOnce();
            return;
          }
        } else {
          if (liveText) {
            const fb = bestSimAgainstRef(refC, liveText);
            if (!transcript || accuracy < fb) { accuracy = fb; transcript = liveText; }
          }
        }

        const percent = Math.round((accuracy || 0)*100);
        scoreTag.textContent = `Score: ${percent}%`;
        scoreTag.classList.remove('hidden');
        status.textContent = 'Groupe évalué. Passe au suivant.';

        state.progress[bundle.key] = {
          done:true, score:percent, accuracy,
          audioBase64: toBareBase64(lastRecord.base64),
          duration:lastRecord.duration, friendly:[]
        };
        card.classList.add('ring-2','ring-emerald-300','bg-emerald-50');

        fbBox.querySelector('.feedback-body').innerHTML =
          `<div class="text-slate-800 mb-1">Score: <b>${percent}%</b></div>
           <div class="text-slate-600">
             Référence: <code>${esc(refDisplay)}</code><br/>
             Reconnu: <code>${esc(transcript || '(vide)')}</code>
           </div>`;
        fbBox.classList.remove('hidden');

        updatePronunGuard(card, { accuracy, res: srv });
        checkFinish();
      }catch(_){
        status.textContent = 'Échec de l’évaluation. Réessaie.';
      } finally {
        btnEval.disabled = false;
        (function bumpEvalOnce(){ state.evalCount = (state.evalCount || 0) + 1; updatePronunGuard(card, {}); updateNextAvailability(); })();
      }
    });

    return card;
  }

  function updateProgress(doneCount){
    document.querySelectorAll('#global-progress .progress-dot')
      .forEach((d,idx)=> d.classList.toggle('on', idx < doneCount));
  }

function checkFinish(){
  const keys = BUNDLES.map(b=>b.key);
  const doneCount = keys.filter(k=> state.progress[k]?.done ).length;
  updateProgress(doneCount);

  const box = document.getElementById('finish-wrap');
  if(!box) return;

  const subtitle = (doneCount === keys.length)
    ? 'Passe aux exercices / 다음 연습문제로 이동해요.'
    : `Progression: ${doneCount}/${keys.length} · Tu peux déjà envoyer ou continuer. / 진행도 ${doneCount}/${keys.length} · 먼저 전송해도 되고 계속해도 돼요.`;

box.innerHTML = `
      <div class="p-5 bg-white rounded-lg border mb-4 max-w-xl mx-auto text-center">
        <div class="text-lg font-extrabold">🎉 Warming up</div>
        <div class="text-slate-600 mt-1">${subtitle}</div>
      </div>
      <div class="flex flex-wrap gap-2 justify-center">
        <button id="btn-finish-send" class="btn btn-primary btn-lg">
          <i class="fa-solid fa-paper-plane"></i> Finir · Envoyer
        </button>
        <button id="btn-refaire" class="btn btn-secondary btn-lg">
          Refaire (1.0× · ×2)
        </button>
        <a id="btn-go-ex" href="numbers-exercises.html"
           class="btn btn-outline btn-lg pointer-events-none opacity-50" aria-disabled="true">
          <i class="fa-solid fa-list-check"></i> Exercice suivant · 다음 연습문제로 가기
        </a>
      </div>
    `;

  box.classList.remove('hidden');

  document.getElementById('btn-go-ex')?.addEventListener('click', (e)=>{
    e.preventDefault();
    const href = e.currentTarget.getAttribute('href') || '/assignments/numbers-exercises.html';
    location.href = href;
  });

  document.getElementById('btn-finish-send')?.addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ...';
    try{
      const ok = await sendResults();
      if (ok) alert('✅ Résultats envoyés. / 결과 전송 완료');
      else    alert('⚠️ Réseau occupé. Résultats sauvegardés localement. / 네트워크 문제: 임시 저장');
    }catch(_){
      alert('⚠️ Envoi échoué — réessaie. / 전송 실패 — 다시 시도');
    }finally{
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }, { once:true });
}


  // --- 결과 전송(타임아웃 + 로컬 저장 폴백 포함) ---
  async function sendResults(){
    const questions = BUNDLES.map(b=>{
      const st = state.progress[b.key] || {};
      return {
        number: `WU-${b.key}`,
        type: 'warmup_pronun',
        fr: `${b.label} — vitesse ${state.speed}× · répétitions ×${state.repeats}`,
        ko: collapse(b.text),
        userAnswer: '',
        isCorrect: true,
        listenCount: state.listenCount[b.key] || 0,
        hint1Count: 0, hint2Count: 0,
        pronunciation: { accuracy: (st.accuracy ?? (st.score||0)/100) }
      };
    });

    const payload = {
      studentName: getStudentName(),
      startTime: state.startISO || new Date().toISOString(),
      endTime: new Date().toISOString(),
      totalTimeSeconds: Math.max(0, Math.round((Date.now() - (state.startMs||Date.now()))/1000)),
      assignmentTitle: `Warm-up – Nombres (vitesse 1.0×, ×2 fixe)`,
      assignmentSummary: [
        '4 groupes: Natifs(1–5,6–10) + Hanja(1–5,6–10)',
        'Paquet de 5 → répétitions (×2 par défaut, ×3 possible)',
        'Étapes: Écouter → Répéter → Évaluer'
      ],
      questions
    };

    const ctrl = new AbortController();
    const to = setTimeout(()=>ctrl.abort(), 12000);

    try{
      const r = await fetch(`${FN_BASE}/send-results`, {
        method:'POST',
        headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      let j = {};
      try { j = await r.json(); } catch { j = {}; }
      if (!r.ok || j?.ok === false) throw new Error(`send-results ${r.status} / ${j?.error||'no-ok'}`);
      try { localStorage.removeItem('pending-results'); } catch {}
      return true;
    } catch(err){
      try { localStorage.setItem('pending-results', JSON.stringify({ when: Date.now(), payload })); } catch {}
      console.warn('[send-results] fallback saved:', err?.message||err);
      return false;
    } finally {
      clearTimeout(to);
    }
  }

  // ---------- LiveSTT 로더 ----------
  function ensureLiveSTT(){
    return new Promise((resolve,reject)=>{
      if (window.LiveSTT) return resolve();
      const s = document.createElement('script');
      s.src = '../assets/live-stt.js?v=' + Date.now();
      s.defer = true;
      s.onload = ()=> resolve();
      s.onerror = ()=> reject(new Error('live-stt load fail'));
      document.head.appendChild(s);
    });
  }

  // --- 보너스: 보류된 결과 자동 재전송 ---
  async function tryResendPending(){
    try{
      const raw = localStorage.getItem('pending-results');
      if(!raw) return;
      const saved = JSON.parse(raw);
      if(!saved?.payload) return;
      const r = await fetch(`${FN_BASE}/send-results`, {
        method:'POST',
        headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
        body: JSON.stringify(saved.payload)
      });
      let j = {};
      try { j = await r.json(); } catch { j = {}; }
      if (r.ok && j?.ok !== false) {
        localStorage.removeItem('pending-results');
        console.info('[send-results] pending batch flushed.');
      }
    }catch(e){
      // 조용히 무시
    }
  }

  function isNextAllowed(){ return true; }
  window.isNextAllowed = isNextAllowed;

  function WU_shake(){
    const t = document.getElementById('warmup-screen') || document.body;
    t.classList.add('shake');
    setTimeout(()=>t.classList.remove('shake'), 600);
  }
  window.WU_shake = WU_shake;

  function findNextButtons(){
    const ids = ['btnNext','btnNextExos','go-next','btnToExercises','btn-go-ex'];
    const q = ids.map(id => document.getElementById(id)).filter(Boolean);
    const dataBtns = Array.from(document.querySelectorAll('[data-action="go-next"],[data-next]'));
    return [...q, ...dataBtns];
  }

  function getTotalEvalAttempts(){
    const cards = Array.from(document.querySelectorAll('[data-card="warmup"]')) || [];
    const sumCard = cards.reduce((a,c)=> a + ((c.__pronunState && c.__pronunState.evalCount) || 0), 0);
    const globalTry = Number(state.evalCount || 0);
    return Math.max(sumCard, globalTry);
  }

  function getTotalEvalCount(){
    let n = 0;
    document.querySelectorAll('[data-card="warmup"]').forEach(c=>{
      n += (c.__pronunState?.evalCount || 0);
    });
    return n;
  }

  function canGoNext(){ return true; }

  function updateNextAvailability(){
    const btnSpeed  = document.querySelector('#btnNextSpeed,#btn-next-speed');
    const btnNextEx = document.querySelector('#btnNextExercise,#btn-go-ex');
    [btnSpeed, btnNextEx].forEach(b=>{
      if(!b) return;
      b.disabled = false;
      b.removeAttribute('aria-disabled');
      b.classList?.remove('pointer-events-none','opacity-50');
      b.title = '';
    });
  }

  function bindNextGuards(){
    // 가드 비활성화
  }

  // ---------- 공개 API ----------
  function getStudentName(){
    const el = document.getElementById('student-name') || document.getElementById('studentName');
    const v  = (el && el.value) ? String(el.value).trim() : '';
    return v || state.name || 'Élève';
  }

  function WU_go(mode){
    state.speed = (mode==='slow')?0.7 : (mode==='fast')?1.5 : 1.0;
    state.name = getStudentName();
    state.startISO = new Date().toISOString(); state.startMs = Date.now();

    document.getElementById('mode-picker')?.classList.add('hidden');
    const wu = document.getElementById('warmup-screen'); wu?.classList.remove('hidden');

    renderAll();

    if (wu){
      window.scrollTo({ top: wu.offsetTop-8, behavior:'smooth' });
      wu.classList.remove('flash-on'); void wu.offsetWidth; wu.classList.add('flash-on');
      setTimeout(()=>wu.classList.remove('flash-on'), 900);
    }
  }
  window.WU_go = WU_go;

// 반복/속도 전역 위임 비활성 (고정값 사용)
document.addEventListener('click', ()=>{ /* no-op */ });
state.repeats = 2;
state.speed = 1.0;


  // 초기 진입
  document.addEventListener('DOMContentLoaded', ()=>{
    tryResendPending();
    updateNextAvailability();

// 다음 속도/가드 리스너 없음 (1.0× 고정)

  });
})();
