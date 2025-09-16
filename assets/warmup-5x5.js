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

const state = {
  speed: 1.0,      // 0.7 / 1.0 / 1.5
  repeats: 2,      // ×2 기본
  progress: {}, listenCount: {},
  startISO: null, startMs: 0, name:'Élève',
  evalCount: 0     // ✅ 전체 평가 횟수(전역)
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
  function normalizeKoNumberish(s){
    if (window.NumHangul?.forceHangulNumbers) return window.NumHangul.forceHangulNumbers(s);
    return s;
  }
  function bestSimAgainstRef(refCollapsed, hypRaw){
    const normed = normalizeKoNumberish(hypRaw);
    return similarity(refCollapsed, collapse(normed));
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
    return { text: seqs.join(', ') }; // 쉼표로 가벼운 멈춤
  }
  function mapVoice(provider, req){
    const MAP = {
      openai: { default:'alloy', alloy:'alloy', shimmer:'verse', nova:'nova', echo:'echo', fable:'fable', verse:'verse' },
      google: { default:'ko-KR-Standard-A', alloy:'ko-KR-Standard-A', shimmer:'ko-KR-Standard-B', verse:'ko-KR-Standard-C', nova:'ko-KR-Standard-D' }
    };
    const t = MAP[provider]||{}; return t[req] || t.default || req;
  }
  let currentAudio=null, aborter=null, currentSrc=null, audioLock=false;
  async function playTTS(input, voice='alloy', speed=1.0, btn){
    const provider = (window.PONGDANG_TTS?.provider) || 'openai';
    const isSSML = typeof input === 'object' && !!input.ssml;
    const textOrSSML = (typeof input === 'object') ? (input.ssml || input.text) : input;

    if(audioLock){
      if(currentAudio){
        if(currentAudio.paused){ await currentAudio.play(); setBtnPlaying(btn,true); }
        else { currentAudio.pause(); setBtnPlaying(btn,false); }
      }
      return;
    }
    audioLock=true; setTimeout(()=>audioLock=false,200);

    try{
      if(currentAudio && currentAudio._meta === `${textOrSSML}|${speed}|${voice}|${isSSML?'ssml':'text'}`){
        if(currentAudio.paused){ await currentAudio.play(); setBtnPlaying(btn,true); }
        else { currentAudio.pause(); setBtnPlaying(btn,false); }
        return;
      }
      aborter?.abort(); currentAudio?.pause();
      if(currentSrc){ URL.revokeObjectURL(currentSrc); currentSrc=null; }

      aborter = new AbortController();
      const payload = isSSML
        ? { ssml: textOrSSML, voice: mapVoice(provider, voice), provider, speed }
        : { text: textOrSSML, voice: mapVoice(provider, voice), provider, speed };
      const res = await fetch(`${FN_BASE}/generate-audio`, {
        method:'POST', headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
        body: JSON.stringify(payload), signal: aborter.signal
      });
      if(!res.ok) throw new Error('TTS fail '+res.status);
      const data = await res.json();
      let src=null;
      if(data.audioBase64 || data.audioContent){
        const blob = base64ToBlob(data.audioBase64 || data.audioContent, data.mimeType || 'audio/mpeg');
        src = URL.createObjectURL(blob);
      } else if (data.audioUrl) src = data.audioUrl;
      currentSrc = src;

      const audio = new Audio(src); currentAudio = audio;
      audio._meta = `${textOrSSML}|${speed}|${voice}|${isSSML?'ssml':'text'}`;
      audio.playbackRate = state.speed; // 실제 재생도 선택 속도 적용
      audio.addEventListener('playing', ()=>setBtnPlaying(btn,true));
      audio.addEventListener('pause',   ()=>setBtnPlaying(btn,false));
      audio.addEventListener('ended',   ()=>{ setBtnPlaying(btn,false); if(currentSrc){ URL.revokeObjectURL(currentSrc); currentSrc=null; } });
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
          const reader = new FileReader(); const audio = new Audio(URL.createObjectURL(blob));
          audio.addEventListener('loadedmetadata', ()=>{
            const duration = audio.duration;
            reader.onloadend = ()=> resolve({ base64: reader.result, duration, blob, mime: (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm' });
            reader.readAsDataURL(blob);
          }, { once:true });
        };
        if(mediaRecorder && mediaRecorder.state==='recording'){
          mediaRecorder.addEventListener('stop', finish, { once:true }); mediaRecorder.stop();
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

    // 서버 응답 정규화
    const out = {
      needsRetry: !!data.needsRetry,
      accuracy: (typeof data.accuracy==='number') ? (data.accuracy>1 ? data.accuracy/100 : data.accuracy) : null,
      transcript: normalizeKoNumberish(String(data.transcript||''))
    };
    return out;
  }

  // ---------- 속도 툴바 ----------
  function renderSpeedToolbar(){
    const wu = $('#warmup-screen'); if(!wu) return;
    let bar = $('#speed-toolbar', wu);
    if(!bar){
      bar = document.createElement('div');
      bar.id = 'speed-toolbar';
      bar.className = 'mb-4 flex flex-wrap gap-2 justify-center';
      wu.prepend(bar);
    }
    bar.innerHTML = `
      <div class="p-2 rounded-xl bg-white border flex flex-wrap items-center gap-2">
        <div class="text-sm text-slate-600 mr-1">Vitesse / 속도</div>
        ${SPEEDS.map(s=>`
          <button class="btn ${state.speed===s.val?'btn-primary':'btn-outline'} btn-sm speed-btn" data-v="${s.val}">${s.label}</button>
        `).join('')}
        <div class="text-xs text-slate-500 ml-2">Étapes: <b>Écouter</b> → <b>Répéter</b> → Évaluer</div>
      </div>
    `;
    bar.querySelectorAll('.speed-btn').forEach(b=>{
      b.addEventListener('click', e=>{
        const v = parseFloat(e.currentTarget.dataset.v);
        if(!isNaN(v)){ state.speed = v; renderAll(); window.scrollTo({ top: wu.offsetTop-8, behavior:'smooth' }); }
      });
    });
  }

  // ---------- 렌더 ----------
  function renderAll(){
    renderSpeedToolbar();

    const wrap = document.getElementById('stages-wrap'); if(!wrap) return;
    wrap.innerHTML=''; state.progress={}; state.listenCount={};

    BUNDLES.forEach(b=>{
      state.progress[b.key] = { done:false, score:null, accuracy:null, audioBase64:null, duration:null, friendly:[] };
      state.listenCount[b.key] = 0;
      wrap.appendChild(makeBundleCard(b));
    });

    document.getElementById('finish-wrap')?.classList.add('hidden');

    // LiveSTT: 전역 init만 호출(카드별 mount 불필요)
    ensureLiveSTT().then(()=>{ window.LiveSTT?.init?.(); }).catch(()=>{});
    checkFinish(); // 진행도 박스는 항상 보여줌(전송 먼저 가능)
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
            Vitesse ${state.speed}× · Répétitions:
            <span class="rep-chip rep-2 ${state.repeats===2?'text-indigo-700 font-bold':''}">×2</span>
            <span class="mx-1">/</span>
            <span class="rep-chip rep-3 ${state.repeats===3?'text-indigo-700 font-bold':''}">×3</span>
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

    // 반복 선택
    card.querySelector('.rep-2').addEventListener('click', ()=>{
      state.repeats=2;
      card.querySelector('.rep-2').classList.add('text-indigo-700','font-bold');
      card.querySelector('.rep-3').classList.remove('text-indigo-700','font-bold');
    });
    card.querySelector('.rep-3').addEventListener('click', ()=>{
      state.repeats=3;
      card.querySelector('.rep-3').classList.add('text-indigo-700','font-bold');
      card.querySelector('.rep-2').classList.remove('text-indigo-700','font-bold');
    });

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
    let liveText = ''; // live-stt 최종 텍스트(숫자→한글 강제 포함)
    
    // 🔒 전역 가드용: 이 카드의 발음 상태를 기억해 다음 이동 허용
    function updatePronunGuard(card, { accuracy=null, res=null } = {}){
      const st = card.__pronunState || { evalCount: 0, passed: false };
      st.evalCount += 1;
      const ok = (typeof accuracy === 'number' && accuracy >= 0.8) || (res && (res.ok || res.passed));
      if (ok) st.passed = true;
      card.__pronunState = st;
}


    // live-stt 이벤트 리슨(+ 숫자→한글 강제)
    card.addEventListener('livestt:final', (e)=>{
      if (e?.detail?.text) {
        const raw = String(e.detail.text).trim();
        liveText = normalizeKoNumberish(raw);
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
      function bumpEval(){
    bumpEval();
    updatePronunGuard(card, {}); // 카드별 상태 유지

}

      if(!lastRecord?.base64) return;
      btnEval.disabled = true; status.textContent = 'Évaluation en cours…';
      try{
        // 1차: 서버 채점
        const srv = await analyzePronunciation({ referenceText: refEval, record: lastRecord });
        let accuracy = (typeof srv.accuracy==='number') ? srv.accuracy : 0;
        let transcript = String(srv.transcript||'');

        // 2차: needsRetry 구제 (LiveSTT가 충분히 비슷하면 그걸로 점수)
        const ref = collapse(refEval);
        if (srv.needsRetry) {
          const fb = liveText ? bestSimAgainstRef(ref, liveText) : 0;
          if (fb >= 0.75) {
            accuracy = Math.max(accuracy, fb);
            transcript = liveText || transcript;
          } else {
            // 재시도 안내(UI 유지, 0점 금지)
            status.textContent = '⚠️ Phrase courte mal reconnue. Réessaie clairement. / 짧은 문장이 길게 인식됐어요. 또박또박 다시 한 번!';
            btnEval.disabled = false;
            bumpEval(); // ✅ 조기 반환 케이스도 평가 1회로 인정
            return;
          }
        } else {
          // 일반 폴백: LiveSTT가 더 좋으면 교체
          if (liveText) {
            const fb = bestSimAgainstRef(ref, liveText);
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

        // 피드백
        fbBox.querySelector('.feedback-body').innerHTML =
          `<div class="text-slate-800 mb-1">Score: <b>${percent}%</b></div>
           <div class="text-sm">
             <div><b>Référence:</b> <span class="korean-font">${refDisplay}</span></div>
             <div class="mt-1"><b>Ma prononciation:</b> <span class="korean-font">${esc(transcript||'')}</span></div>
           </div>`;
        fbBox.classList.remove('hidden');

        updatePronunGuard(card, { accuracy, res: srv }); // ✅ 카드 상태 반영(점수 0.8↑면 passed)
        checkFinish();
      }catch(_){
        status.textContent = 'Échec de l’évaluation. Réessaie.';
      } finally {
        btnEval.disabled = false;
        state.evalCount++;        // 🔄 성공/실패/재시도 포함 모든 평가 클릭 → 카운트
        updatePronunGuard(card, {}); // ✅ 점수와 무관하게 evalCount만 +1 보장
        updateNextAvailability();
      }

    });
    bumpEval(); // ✅ 오류도 한 번의 시도로 집계
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

    const next = getNextSpeed(state.speed);
    const nextLabel = next ? `${next.toFixed(1)}×` : '';

    // ✅ 진행률 안내 문구(완료 전에도 노출)
    const subtitle = (doneCount === keys.length)
      ? (next ? 'Passe à la vitesse suivante / 다음 속도로 넘어가요.'
              : 'Passe aux exercices / 다음 연습문제로 이동해요.')
      : `Progression: ${doneCount}/${keys.length} · Tu peux déjà envoyer ou continuer. / 진행도 ${doneCount}/${keys.length} · 먼저 전송해도 되고 계속해도 돼요.`;

    box.innerHTML = `
      <div class="p-5 bg-white rounded-lg border mb-4 max-w-xl mx-auto text-center">
        <div class="text-lg font-extrabold">🎉 Warming up</div>
        <div class="text-slate-600 mt-1">${subtitle}</div>
      </div>
      <div class="flex flex-wrap gap-2 justify-center">
        <!-- 끝내기(전송) 버튼은 항상 활성 -->
        <button id="btn-finish-send" class="btn btn-primary btn-lg">
          <i class="fa-solid fa-paper-plane"></i> Finir · Envoyer
        </button>

        <!-- 다음 속도: 남아 있으면 활성, 없으면 비활성 표시 -->
        ${
          next
            ? `<button id="btn-next-speed" class="btn btn-secondary btn-lg">
                 ${nextLabel} → Vitesse suivante / 다음 속도
               </button>`
            : `<button id="btn-next-speed" class="btn btn-secondary btn-lg" disabled
                     style="opacity:.5;pointer-events:none">— → Vitesse suivante / 다음 속도</button>`
        }

        <!-- 다음 연습문제: 항상 보이되, 전송 전엔 비활성 -->
       <a id="btn-go-ex" href="numbers-exercises.html"
         class="btn btn-outline btn-lg pointer-events-none opacity-50" aria-disabled="true">
        <i class="fa-solid fa-list-check"></i> Exercice suivant · 다음 연습문제로 가기
      </a>

           class="btn btn-outline btn-lg pointer-events-none opacity-50" aria-disabled="true">
          <i class="fa-solid fa-list-check"></i> Exercice suivant · 다음 연습문제로 가기
        </a>
      </div>`;
    box.classList.remove('hidden');
    updateNextAvailability(); // ✅ 페이지 렌더 시점에서도 2회 이상이면 활성화
      document.getElementById('btn-go-ex')?.addEventListener('click', (e)=>{
  if (!window.isNextAllowed || !window.isNextAllowed()){
    e.preventDefault();
    alert("👉 Évalue ta prononciation au moins 2 fois.\n👉 발음을 최소 2회 녹음·평가해 주세요.");
    window.WU_shake && window.WU_shake();
  }
});

    // --- 전송 버튼 (성공/실패 상관없이 다음 단계 해제 + 로컬 폴백 저장) ---
    document.getElementById('btn-finish-send')?.addEventListener('click', async (e)=>{
  const btn = e.currentTarget;
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ...';

  try{
    const ok = await sendResults();
    if (ok) {
      alert('✅ Résultats envoyés. / 결과 전송 완료');
    } else {
      alert('⚠️ Réseau occupé. Résultats sauvegardés localement. Ils seront renvoyés automatiquement. / 네트워크 문제: 결과를 기기에 임시 저장했고, 다음에 자동 재전송됩니다.');
    }
  }catch(_){
    alert('⚠️ Envoi échoué — réessaie. / 전송 실패 — 다시 시도');
  }finally{
    // ✅ 성공/실패와 무관하게 다음 연습문제 버튼 활성화
    const goEx = document.getElementById('btn-go-ex');
    if (goEx){
      goEx.classList.remove('pointer-events-none','opacity-50','btn-outline');
      goEx.classList.add('btn-primary');
      goEx.removeAttribute('aria-disabled');
    }
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}, { once:true });


    // 다음 속도로 재시작
    const ns = document.getElementById('btn-next-speed');
    if (ns && next) {
      ns.addEventListener('click', ()=>{
        state.speed = next;
        state.startISO = new Date().toISOString(); state.startMs = Date.now();
        renderAll();
        window.scrollTo({ top: document.getElementById('warmup-screen').offsetTop - 8, behavior:'smooth' });
      }, { once:true });
    }
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
      assignmentTitle: `Warm-up – Nombres (vitesse ${state.speed}×, ×${state.repeats})`,
      assignmentSummary: [
        '4 groupes: Natifs(1–5,6–10) + Hanja(1–5,6–10)',
        'Paquet de 5 → répétitions (×2 par défaut, ×3 possible)',
        'Étapes: Écouter → Répéter → Évaluer'
      ],
      questions
    };

    // 네트워크 타임아웃 + 폴백 저장
    const ctrl = new AbortController();
    const to = setTimeout(()=>ctrl.abort(), 12000); // 12초 타임아웃

    try{
      const r = await fetch(`${FN_BASE}/send-results`, {
        method:'POST',
        headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });

      // 응답 파싱(비JSON도 안전 처리)
      let j = {};
      try { j = await r.json(); } catch { j = {}; }

      // r.ok이면 대부분 성공. 명시적으로 { ok:false }만 실패로 처리
      if (!r.ok || j?.ok === false) {
        throw new Error(`send-results ${r.status} / ${j?.error||'no-ok'}`);
      }

      // 성공 → 대기열 제거
      try { localStorage.removeItem('pending-results'); } catch {}
      return true;

    } catch(err){
      // 실패 → 로컬에 보관(다음 진입 시 자동 재전송용)
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
      // 캐시 무효화 쿼리
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
      // 조용히 무시(다음 진입 때 또 시도)
    }
  }
    function isNextAllowed(){
  return (state.evalCount || 0) >= 2;  // ✅ 최소 2회 평가
}
window.isNextAllowed = isNextAllowed;

function updateNextAvailability(){
  const goEx = document.getElementById('btn-go-ex');
  if (!goEx) return;
  if (isNextAllowed()){
    goEx.classList.remove('pointer-events-none','opacity-50','btn-outline');
    goEx.classList.add('btn-primary');
    goEx.removeAttribute('aria-disabled');
  }
}
window.updateNextAvailability = updateNextAvailability;

function WU_shake(){
  const t = document.getElementById('warmup-screen') || document.body;
  t.classList.add('shake');
  setTimeout(()=>t.classList.remove('shake'), 600);
}
window.WU_shake = WU_shake;

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

  document.addEventListener('DOMContentLoaded', ()=>{
    // 보류분 자동 재전송 시도
    tryResendPending();

    const m = new URLSearchParams(location.search).get('mode');
    if(m){ WU_go(m); }
  });
})();
