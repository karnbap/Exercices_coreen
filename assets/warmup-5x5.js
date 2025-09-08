// assets/warmup-chooser-5x5.js
// 속도 선택 → 4그룹 발음 연습 → 평가/전송 (서버 analyze-pronunciation 스키마 호환)

const FN_BASE = (window.PONGDANG_FN_BASE || '/.netlify/functions');

const BUNDLES = [
  { key:'natifs_1_5',  label:'Natifs (1–5)',  text:'하나, 둘, 셋, 넷, 다섯',   voice:'alloy'   },
  { key:'natifs_6_10', label:'Natifs (6–10)', text:'여섯, 일곱, 여덟, 아홉, 열', voice:'shimmer' },
  { key:'hanja_1_5',   label:'Hanja (1–5)',   text:'일, 이, 삼, 사, 오',       voice:'alloy'   },
  { key:'hanja_6_10',  label:'Hanja (6–10)',  text:'육, 칠, 팔, 구, 십',       voice:'alloy'   },
];

const state = {
  mode: { speed:1.0, continuous:false },
  progress: {},           // key=bundle.key → { done, score, accuracy, audioBase64, duration, friendly }
  listenCount: {},        // key=bundle.key → number
  startISO: null, startMs: 0, name:'Élève'
};

function stripForContinuous(s){ return s.replace(/,\s*/g,' '); }
function mapVoice(provider, req){
  const VOICE_MAP = {
    openai: { default:'alloy', alloy:'alloy', shimmer:'verse' },
    google: { default:'ko-KR-Standard-A', alloy:'ko-KR-Standard-A', shimmer:'ko-KR-Standard-B' }
  };
  const t = VOICE_MAP[provider]||{};
  return t[req] || t.default || req;
}
function base64ToBlob(base64, mime='audio/mpeg'){
  const cleaned = base64.includes(',') ? base64.split(',')[1] : base64;
  const byteChars = atob(cleaned);
  const arr = new Uint8Array(byteChars.length);
  for(let i=0;i<byteChars.length;i++) arr[i]=byteChars.charCodeAt(i);
  return new Blob([arr],{type:mime});
}

// ---------- TTS ----------
let currentAudio=null, audioLock=false, aborter=null, currentSrc=null;
async function playTTS(text, voice='alloy', speed=1.0, btn){
  if(audioLock){
    if(currentAudio){
      if(currentAudio.paused){ await currentAudio.play(); setBtnPlaying(btn,true); }
      else { currentAudio.pause(); setBtnPlaying(btn,false); }
    }
    return;
  }
  audioLock=true; setTimeout(()=>audioLock=false,200);
  try{
    if(currentAudio && currentAudio._meta === `${text}|${speed}|${voice}`){
      if(currentAudio.paused){ await currentAudio.play(); setBtnPlaying(btn,true); }
      else { currentAudio.pause(); setBtnPlaying(btn,false); }
      return;
    }
    if(aborter){ try{aborter.abort();}catch{} }
    if(currentAudio){ try{currentAudio.pause();}catch{} }
    if(currentSrc){ URL.revokeObjectURL(currentSrc); currentSrc=null; }

    aborter = new AbortController();
    const provider = (window.PONGDANG_TTS?.provider) || 'openai';
    const payload = { text, voice: mapVoice(provider, voice), provider, speed };
    const res = await fetch(`${FN_BASE}/generate-audio`, {
      method:'POST', headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
      body:JSON.stringify(payload), signal:aborter.signal
    });
    if(!res.ok) throw new Error('TTS fail '+res.status);
    const data = await res.json();

    let src = null;
    if(data.audioBase64 || data.audioContent){
      const blob = base64ToBlob(data.audioBase64 || data.audioContent, data.mimeType || 'audio/mpeg');
      src = URL.createObjectURL(blob);
    } else if (data.audioUrl){ src = data.audioUrl; }
    currentSrc = src;

    const audio = new Audio(src);
    currentAudio = audio;
    audio._meta = `${text}|${speed}|${voice}`;
    audio.addEventListener('playing', ()=>setBtnPlaying(btn,true));
    audio.addEventListener('pause',   ()=>setBtnPlaying(btn,false));
    audio.addEventListener('ended',   ()=>{
      setBtnPlaying(btn,false);
      if(currentSrc){ URL.revokeObjectURL(currentSrc); currentSrc=null; }
    });
    await audio.play();
  }catch(e){ alert('Problème de lecture audio. Réessaie.'); }
}
function setBtnPlaying(btn, on){ if(!btn) return; btn.innerHTML = on ? '<i class="fas fa-pause"></i> Pause' : '<i class="fas fa-play"></i> Écouter'; }

// ---------- Recorder ----------
function makeRecorder(){
  let mediaRecorder=null, chunks=[], stream=null, ctx=null, analyser=null, raf=0;
  async function start(canvas){
    if(stream) stop(canvas);
    stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    mediaRecorder = new MediaRecorder(stream, { mimeType:'audio/webm' });
    chunks = [];
    mediaRecorder.ondataavailable = e => chunks.push(e.data);

    // VU
    ctx = new (window.AudioContext||window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    source.connect(analyser);
    drawVU(canvas, analyser);

    mediaRecorder.start(50);
  }
  function drawVU(canvas, analyser){
    if(!canvas) return;
    const cv = canvas, g = cv.getContext('2d');
    const data = new Uint8Array(analyser.frequencyBinCount);
    const w = cv.width, h = cv.height;
    function loop(){
      raf = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(data);
      g.clearRect(0,0,w,h);
      const bars = 32; const step = Math.floor(data.length / bars);
      for(let i=0;i<bars;i++){
        const v = data[i*step]/255; const bh = v*h;
        g.fillStyle = '#6366f1';
        g.fillRect(i*(w/bars)+2, h-bh, (w/bars)-4, bh);
      }
    }
    loop();
  }
  function stop(canvas){
    if(mediaRecorder && mediaRecorder.state==='recording') mediaRecorder.stop();
    if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
    if(ctx){ ctx.close(); ctx=null; }
    if(raf) cancelAnimationFrame(raf);
    if(canvas){ const g=canvas.getContext('2d'); g.clearRect(0,0,canvas.width,canvas.height); }
  }
  async function getResult(){
    return await new Promise((resolve)=>{
      const onStop = ()=>{
        const blob = new Blob(chunks, { type:'audio/webm' });
        const reader = new FileReader();
        const audio = document.createElement('audio');
        audio.src = URL.createObjectURL(blob);
        audio.addEventListener('loadedmetadata', ()=>{
          const duration = audio.duration;
          reader.onloadend = ()=> resolve({ base64: reader.result, duration, blob });
          reader.readAsDataURL(blob);
        });
      };
      if(mediaRecorder && mediaRecorder.state==='recording'){
        mediaRecorder.addEventListener('stop', onStop, { once:true });
        mediaRecorder.stop();
      }else{
        onStop();
      }
    });
  }
  return { start, stop, getResult };
}

// ---------- Pronunciation API ----------
function toBareBase64(dataUrlOrB64){
  return String(dataUrlOrB64||'').includes(',')
    ? String(dataUrlOrB64).split(',')[1]
    : String(dataUrlOrB64||'');
}
async function analyzePronunciation({ referenceText, record }){
  const payload = {
    referenceText,
    audio: {
      base64: toBareBase64(record.base64),
      filename: `rec_${Date.now()}.webm`,
      mimeType: 'audio/webm',
      duration: record.duration
    }
  };
  const r = await fetch(`${FN_BASE}/analyze-pronunciation`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(()=> ({}));
  if(!r.ok) throw new Error(data?.error || 'Analyse échouée');
  let acc = (typeof data.accuracy === 'number') ? data.accuracy : 0;
  if(acc > 1) acc = acc/100;
  const friendly = Array.isArray(data?.details?.explain) ? data.details.explain : [];
  return { accuracy: acc, friendly, transcript: data?.transcript||'' };
}

// ---------- UI Render ----------
function renderAll(){
  const wrap = document.getElementById('groups-wrap');
  wrap.innerHTML = '';
  state.progress = {};
  state.listenCount = {};
  BUNDLES.forEach(b=>{
    state.progress[b.key] = { done:false, score:null, accuracy:null, audioBase64:null, duration:null, friendly:[] };
    state.listenCount[b.key] = 0;
    wrap.appendChild(makeBundleCard(b));
  });
  document.querySelectorAll('.progress-dot').forEach(d=>d.classList.remove('on'));
}

function makeBundleCard(bundle){
  const wrap = document.createElement('div');
  wrap.className = 'wu-card';
  wrap.id = `bundle-${bundle.key}`;

  const refText = state.mode.continuous ? stripForContinuous(bundle.text) : bundle.text;

  wrap.innerHTML = `
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <div class="text-sm text-slate-500">Vitesse ${state.mode.speed}× ${state.mode.continuous?'<span class="text-slate-500 text-xs">(rythme continu)</span>':''}</div>
        <div class="text-lg font-semibold">${bundle.label} <span class="text-slate-500">· ${refText}</span></div>
        <div class="small-muted">1) Écouter  2) S’enregistrer  3) Évaluer</div>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn-sound btn-play"><i class="fas fa-play"></i> Écouter</button>
        <span class="text-sm text-slate-500">écoutes: <b class="play-count">0</b></span>
      </div>
    </div>

    <div class="mt-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50/60">
      <div class="text-sm text-slate-700 mb-2">🎤 S’enregistrer & Évaluer</div>

      <div class="flex flex-wrap gap-2 mb-2">
        <button class="btn btn-secondary btn-rec-start"><i class="fa-solid fa-microphone"></i> Démarrer l’enregistrement</button>
        <button class="btn btn-danger btn-rec-stop" disabled><i class="fa-solid fa-stop"></i> Arrêter</button>
        <button class="btn btn-primary btn-eval" disabled><i class="fa-solid fa-bolt"></i> Évaluer ma prononciation</button>
      </div>

      <div class="vu"><canvas class="vu-canvas" width="800" height="50"></canvas></div>

      <audio class="mt-2 w-full audio-playback hidden" controls></audio>
      <div class="mt-2 text-sm text-slate-600 status-line">Appuie sur “Démarrer l’enregistrement”, puis “Arrêter”, ensuite “Évaluer”.</div>

      <div class="mt-2 text-sm">
        <span class="inline-block bg-white border px-2 py-1 rounded score-pill hidden"></span>
      </div>
    </div>
  `;

  // 듣기
  const btnPlay = wrap.querySelector('.btn-play');
  const playCountTag = wrap.querySelector('.play-count');
  btnPlay.addEventListener('click', async (e)=>{
    await playTTS(refText, bundle.voice, state.mode.speed, e.currentTarget);
    state.listenCount[bundle.key] = (state.listenCount[bundle.key]||0) + 1;
    playCountTag.textContent = String(state.listenCount[bundle.key]);
  });

  // 녹음/평가
  const rec = makeRecorder();
  const btnStart = wrap.querySelector('.btn-rec-start');
  const btnStop  = wrap.querySelector('.btn-rec-stop');
  const btnEval  = wrap.querySelector('.btn-eval');
  const canvas   = wrap.querySelector('.vu-canvas');
  const status   = wrap.querySelector('.status-line');
  const audioUI  = wrap.querySelector('.audio-playback');
  const scoreTag = wrap.querySelector('.score-pill');

  let lastRecord = null;

  btnStart.addEventListener('click', async ()=>{
    btnStart.disabled = true; btnStop.disabled = false; btnEval.disabled = true;
    scoreTag.classList.add('hidden');
    status.textContent = 'Enregistrement… parle comme le modèle !';
    try{ await rec.start(canvas); }
    catch(e){ alert("Micro non autorisé. Vérifie les permissions du navigateur."); btnStart.disabled=false; btnStop.disabled=true; }
  });

  btnStop.addEventListener('click', async ()=>{
    btnStop.disabled = true;
    try{
      rec.stop(canvas);
      lastRecord = await rec.getResult();
      audioUI.src = lastRecord ? URL.createObjectURL(lastRecord.blob) : '';
      audioUI.classList.remove('hidden');
      btnEval.disabled = !lastRecord;
      btnStart.disabled = false;
      status.textContent = lastRecord ? `Enregistrement terminé (${(lastRecord.duration||0).toFixed(1)} s). Clique “Évaluer”.` : 'Réessaie.';
    }catch(e){
      btnStart.disabled = false;
      status.textContent = 'Problème d’enregistrement. Réessaie.';
    }
  });

  btnEval.addEventListener('click', async ()=>{
    if(!lastRecord?.base64) return;
    btnEval.disabled = true;
    status.textContent = 'Évaluation en cours…';
    try{
      const { accuracy, friendly } = await analyzePronunciation({ referenceText: refText, record: lastRecord });
      const percent = Math.round((accuracy || 0)*100);
      scoreTag.textContent = `Score: ${percent}%`;
      scoreTag.classList.remove('hidden');
      status.textContent = 'Groupe évalué. Passe au suivant.';

      state.progress[bundle.key] = {
        done:true, score:percent, accuracy,
        audioBase64: toBareBase64(lastRecord.base64),
        duration:lastRecord.duration,
        friendly
      };
      wrap.classList.add('wu-done');
      checkFinish();
    }catch(e){
      status.textContent = 'Échec de l’évaluation. Réessaie.';
    }finally{
      btnEval.disabled = false;
    }
  });

  return wrap;
}

function checkFinish(){
  const keys = BUNDLES.map(b=>b.key);
  const doneCount = keys.filter(k=> state.progress[k]?.done ).length;
  document.querySelectorAll('.progress-dot').forEach((d,idx)=> d.classList.toggle('on', idx < doneCount));
  if(doneCount === keys.length){
    document.getElementById('finish-wrap')?.classList.remove('hidden');
  }
}

// ---------- Results ----------
async function sendResults(){
  const questions = BUNDLES.map(b=>{
    const st = state.progress[b.key] || {};
    const refText = state.mode.continuous ? stripForContinuous(b.text) : b.text;
    return {
      number: `WU-${b.key}`,
      type: 'warmup_pronun',
      fr: `${b.label} — vitesse ${state.mode.speed}×${state.mode.continuous?' (rythme continu)':''}`,
      ko: refText,
      userAnswer: '',
      isCorrect: true,
      listenCount: state.listenCount[b.key] || 0,
      hint1Count: 0, hint2Count: 0,
      pronunciation: { accuracy: (st.accuracy ?? (st.score||0)/100), friendly: st.friendly || [] },
      recording: st.audioBase64 ? { base64: st.audioBase64, filename:`wu_${b.key}.webm`, mimeType:'audio/webm', duration: st.duration } : null
    };
  });

  const payload = {
    studentName: state.name || 'Élève',
    startTime: state.startISO || new Date().toISOString(),
    endTime: new Date().toISOString(),
    totalTimeSeconds: Math.max(0, Math.round((Date.now() - (state.startMs||Date.now()))/1000)),
    assignmentTitle: `Warm-up – Nombres (vitesse ${state.mode.speed}×${state.mode.continuous?' / continu':''})`,
    assignmentSummary: [
      '4 groupes: Natifs(1–5,6–10) + Hanja(1–5,6–10)',
      'Écouter → S’enregistrer → Évaluer (score en %)'
    ],
    questions
  };

  try{
    const r = await fetch(`${FN_BASE}/send-results`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const j = await r.json().catch(()=> ({}));
    if(!r.ok || j?.ok===false) throw new Error(j?.error || 'send-results failed');
    alert('Résultat envoyé ✔️');
  }catch(e){
    console.error(e);
    alert('Envoi impossible. Réessaie plus tard.');
  }
}

// ---------- Mount ----------
document.addEventListener('DOMContentLoaded', ()=>{
  // 이름 게이트
  window.StudentGate?.init?.();
  window.StudentGate?.requireBeforeInteraction?.(document);

  const startScreen = document.getElementById('start-screen');
  const quizRoot    = document.getElementById('quiz-root');
  const startBtn    = document.getElementById('start-btn');
  const modeChooser = document.getElementById('mode-chooser');

  startBtn?.addEventListener('click', ()=>{
    const v = (document.getElementById('student-name')?.value||'').trim();
    state.name = v || (window.StudentGate?.getName?.() || 'Élève');
    state.startISO = new Date().toISOString();
    state.startMs = Date.now();
    modeChooser.classList.remove('hidden');
    startBtn.disabled = true;
  });

  // 모드 선택 버튼 (data-speed, data-cont)
  modeChooser?.querySelectorAll('button[data-speed]')?.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const sp = parseFloat(btn.dataset.speed||'1.0');
      const cont = btn.dataset.cont === 'true';
      state.mode = { speed: sp, continuous: cont };

      document.getElementById('mode-chooser').classList.add('hidden');
      startScreen.classList.add('hidden');
      quizRoot.classList.remove('hidden');

      renderAll();

      document.getElementById('btn-send')?.addEventListener('click', sendResults);
      document.getElementById('btn-retry')?.addEventListener('click', ()=>{
        // 다시 모드 선택
        quizRoot.classList.add('hidden');
        startBtn.disabled = false;
        document.getElementById('mode-chooser').classList.remove('hidden');
        startScreen.classList.remove('hidden');
        document.getElementById('finish-wrap')?.classList.add('hidden');
        renderAll();
      });
    });
  });
});
