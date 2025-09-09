// 속도 선택(WU_go) → 4그룹 발음 연습 렌더 → 평가/전송
const FN_BASE = (window.PONGDANG_FN_BASE || '/.netlify/functions');

const BUNDLES = [
  { key:'natifs_1_5',  label:'Natifs (1–5)',  text:'하나둘셋넷다섯',   voice:'alloy'   },
  { key:'natifs_6_10', label:'Natifs (6–10)', text:'여섯일곱여덟아홉열', voice:'shimmer' },
  { key:'hanja_1_5',   label:'Hanja (1–5)',   text:'일이삼사오',       voice:'alloy'   },
  { key:'hanja_6_10',  label:'Hanja (6–10)',  text:'육칠팔구십',       voice:'alloy'   },
];

const state = {
  mode: { speed:1.0, continuous:false },
  progress: {}, listenCount: {},
  startISO: null, startMs: 0, name:'Élève'
};

// ---------- Utils ----------
function splitTokens(s){ return String(s||'').split(/[,\s]+/).filter(Boolean); }
function collapseKorean(s){ return splitTokens(s).join(''); }
function makeTTSContinuous(text, speed=1.0){
  const parts = splitTokens(text);
  const provider = (window.PONGDANG_TTS?.provider) || 'openai';
  if(provider === 'google'){
    const rate = Math.round(speed*100)+'%';
    return { ssml: `<speak><prosody rate="${rate}">${parts.join('<break time="0ms"/>')}</prosody></speak>` };
  }
  return { text: parts.join('\u2060') }; // WORD JOINER
}
function mapVoice(provider, req){
  const MAP = {
    openai: { default:'alloy', alloy:'alloy', shimmer:'verse' },
    google: { default:'ko-KR-Standard-A', alloy:'ko-KR-Standard-A', shimmer:'ko-KR-Standard-B' }
  };
  const t = MAP[provider]||{}; return t[req] || t.default || req;
}
function base64ToBlob(base64, mime='audio/mpeg'){
  const cleaned = base64.includes(',') ? base64.split(',')[1] : base64;
  const byteChars = atob(cleaned);
  const arr = new Uint8Array(byteChars.length);
  for(let i=0;i<byteChars.length;i++) arr[i]=byteChars.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
function toBareBase64(s){ return String(s||'').includes(',') ? String(s).split(',')[1] : String(s||''); }

// ---------- TTS ----------
let currentAudio=null, audioLock=false, aborter=null, currentSrc=null;
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
    aborter?.abort();
    currentAudio?.pause();
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

    let src = null;
    if(data.audioBase64 || data.audioContent){
      const blob = base64ToBlob(data.audioBase64 || data.audioContent, data.mimeType || 'audio/mpeg');
      src = URL.createObjectURL(blob);
    } else if (data.audioUrl){ src = data.audioUrl; }
    currentSrc = src;

    const audio = new Audio(src); currentAudio = audio;
    audio._meta = `${textOrSSML}|${speed}|${voice}|${isSSML?'ssml':'text'}`;
    audio.addEventListener('playing', ()=>setBtnPlaying(btn,true));
    audio.addEventListener('pause',   ()=>setBtnPlaying(btn,false));
    audio.addEventListener('ended',   ()=>{ setBtnPlaying(btn,false); if(currentSrc){ URL.revokeObjectURL(currentSrc); currentSrc=null; } });
    await audio.play();
  }catch(e){ alert('Problème de lecture audio. Réessaie.'); }
}
function setBtnPlaying(btn, on){
  if(!btn) return;
  btn.innerHTML = on ? '<i class="fas fa-pause"></i> Pause' : '<i class="fas fa-play"></i> Écouter';
}

// ---------- Recorder ----------
function makeRecorder(){
  let mediaRecorder=null, chunks=[], stream=null, ctx=null, analyser=null, raf=0;
  async function start(canvas){
    if(stream) stop(canvas);
    stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    mediaRecorder = new MediaRecorder(stream, { mimeType:'audio/webm' });
    chunks = []; mediaRecorder.ondataavailable = e => chunks.push(e.data);

    ctx = new (window.AudioContext||window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    source.connect(analyser); drawVU(canvas, analyser);
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
      g.fillStyle = '#6366f1';
      for(let i=0;i<bars;i++){
        const v = data[i*step]/255; const bh = v*h;
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
      }else{ onStop(); }
    });
  }
  return { start, stop, getResult };
}

// ---------- Pronunciation API ----------
async function analyzePronunciation({ referenceText, record }){
  const payload = {
    referenceText,
    audio: { base64: toBareBase64(record.base64), filename:`rec_${Date.now()}.webm`, mimeType:'audio/webm', duration: record.duration }
  };
  const r = await fetch(`${FN_BASE}/analyze-pronunciation`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
  });
  const data = await r.json().catch(()=> ({}));
  if(!r.ok) throw new Error(data?.error || 'Analyse échouée');
  let acc = (typeof data.accuracy === 'number') ? data.accuracy : 0;
  if(acc > 1) acc = acc/100;
  const friendly = Array.isArray(data?.details?.explain) ? data.details.explain : [];
  return { accuracy: acc, friendly, transcript: data?.transcript||'' };
}

// ---------- Feedback ----------
function renderFeedback(box, {friendly=[], accuracy=0, transcript='', refText=''}) {
  if(!box) return;
  const percent = Math.round((accuracy||0)*100);
  const lines = [];
  if (percent === 100) lines.push('✅ Parfait ! / 완벽해요! 리듬 유지.');
  if (Array.isArray(friendly) && friendly.length) lines.push(...friendly);
  try{
    const extra1 = (window.PronunUtils?.quickTips?.(refText, transcript)) || [];
    const extra2 = (window.VowelMiddleware?.hints?.(refText, transcript)) || [];
    [...extra1, ...extra2].forEach(t => t && lines.push(t));
  }catch(_){}
  const sttLine = transcript ? `<div class="mt-2 text-[13px] text-slate-600">STT: ${transcript}</div>` : '';
  box.querySelector('.feedback-body').innerHTML =
    `<div class="text-slate-800 mb-1">Score: <b>${percent}%</b></div>
     <ul class="list-disc list-inside">${lines.map(x=>`<li>${x}</li>`).join('')}</ul>${sttLine}`;
}

// ---------- UI Render ----------
function renderAll(){
  const wrap = document.getElementById('stages-wrap');
  if(!wrap) return;
  wrap.innerHTML = '';
  state.progress = {}; state.listenCount = {};
  BUNDLES.forEach(b=>{
    state.progress[b.key] = { done:false, score:null, accuracy:null, audioBase64:null, duration:null, friendly:[] };
    state.listenCount[b.key] = 0;
    wrap.appendChild(makeBundleCard(b));
  });
  updateProgress(0);
  document.getElementById('finish-wrap')?.classList.add('hidden');
}

function makeBundleCard(bundle){
  const wrap = document.createElement('div');
  wrap.className = 'p-4 bg-white rounded-lg border';

  const refDisplay = state.mode.continuous ? splitTokens(bundle.text).join(' ') : bundle.text;
  const refEval    = collapseKorean(bundle.text);
  const ttsInput   = makeTTSContinuous(bundle.text, state.mode.speed);

  wrap.innerHTML = `
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <div class="text-sm text-slate-500">Vitesse ${state.mode.speed}× ${state.mode.continuous?'<span class="text-slate-500 text-xs">(rythme continu)</span>':''}</div>
        <div class="text-lg font-semibold">${bundle.label} <span class="text-slate-500">· ${refDisplay}</span></div>
        <div class="text-xs text-slate-500">1) Écouter  2) S’enregistrer  3) Évaluer</div>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn-sound btn-play"><i class="fas fa-play"></i> Écouter</button>
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
      <audio class="mt-2 w-full audio-playback hidden" controls></audio>
      <div class="mt-2 text-sm text-slate-600 status-line">Démarrer → Arrêter → Évaluer.</div>
      <div class="mt-2 text-sm"><span class="inline-block bg-white border px-2 py-1 rounded score-pill hidden"></span></div>

      <div class="mt-3 feedback-card hidden">
        <div class="font-semibold mb-1">🧠 Explication de la note / 점수 설명</div>
        <div class="text-sm text-slate-700 feedback-body"></div>
      </div>
    </div>
  `;

  const btnPlay = wrap.querySelector('.btn-play');
  const playCountTag = wrap.querySelector('.play-count');
  btnPlay.addEventListener('click', async (e)=>{
    await playTTS(ttsInput, bundle.voice, state.mode.speed, e.currentTarget);
    state.listenCount[bundle.key] = (state.listenCount[bundle.key]||0) + 1;
    playCountTag.textContent = String(state.listenCount[bundle.key]);
  });

  const rec = makeRecorder();
  const btnStart = wrap.querySelector('.btn-rec-start');
  const btnStop  = wrap.querySelector('.btn-rec-stop');
  const btnEval  = wrap.querySelector('.btn-eval');
  const canvas   = wrap.querySelector('.vu-canvas');
  const status   = wrap.querySelector('.status-line');
  const audioUI  = wrap.querySelector('.audio-playback');
  const scoreTag = wrap.querySelector('.score-pill');
  const fbBox    = wrap.querySelector('.feedback-card');

  let lastRecord = null;

  btnStart.addEventListener('click', async ()=>{
    btnStart.disabled = true; btnStop.disabled = false; btnEval.disabled = true;
    scoreTag.classList.add('hidden'); fbBox.classList.add('hidden'); fbBox.querySelector('.feedback-body').innerHTML='';
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
      status.textContent = lastRecord ? `Terminé (${(lastRecord.duration||0).toFixed(1)} s). Clique “Évaluer”.` : 'Réessaie.';
    }catch(e){
      btnStart.disabled = false;
      status.textContent = 'Problème d’enregistrement. Réessaie.';
    }
  });

  btnEval.addEventListener('click', async ()=>{
    if(!lastRecord?.base64) return;
    btnEval.disabled = true; status.textContent = 'Évaluation en cours…';
    try{
      const { accuracy, friendly, transcript } = await analyzePronunciation({ referenceText: refEval, record: lastRecord });
      const percent = Math.round((accuracy || 0)*100);
      scoreTag.textContent = `Score: ${percent}%`;
      scoreTag.classList.remove('hidden');
      status.textContent = 'Groupe évalué. Passe au suivant.';

      state.progress[bundle.key] = {
        done:true, score:percent, accuracy,
        audioBase64: toBareBase64(lastRecord.base64),
        duration:lastRecord.duration, friendly
      };
      wrap.classList.add('ring-2','ring-emerald-300','bg-emerald-50');
      renderFeedback(fbBox, { friendly, accuracy, transcript, refText: refEval });
      fbBox.classList.remove('hidden');
      checkFinish();
    }catch(e){
      status.textContent = 'Échec de l’évaluation. Réessaie.';
    }finally{
      btnEval.disabled = false;
    }
  });

  return wrap;
}

function updateProgress(doneCount){
  const dots = document.querySelectorAll('#global-progress .progress-dot');
  dots.forEach((d,idx)=> d.classList.toggle('on', idx < doneCount));
}
function checkFinish(){
  const keys = BUNDLES.map(b=>b.key);
  const doneCount = keys.filter(k=> state.progress[k]?.done ).length;
  updateProgress(doneCount);
  if(doneCount === keys.length){
    document.getElementById('finish-wrap')?.classList.remove('hidden');
    document.getElementById('btn-send')?.addEventListener('click', sendResults, { once:true });
  }
}

// ---------- Results ----------
async function sendResults(){
  const questions = BUNDLES.map(b=>{
    const st = state.progress[b.key] || {};
    const refText = collapseKorean(b.text);
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
    studentName: (document.getElementById('student-name')?.value || state.name || 'Élève'),
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
    const r = await fetch(`${FN_BASE}/send-results`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const j = await r.json().catch(()=> ({}));
    if(!r.ok || j?.ok===false) throw new Error(j?.error || 'send-results failed');
    alert('Résultat envoyé ✔️');
  }catch(e){
    console.error(e);
    alert('Envoi impossible. Réessaie plus tard.');
  }
}

// ---------- Public API ----------
function WU_go(mode){
  if(mode === 'slow')      state.mode = { speed:0.7, continuous:false };
  else if(mode === 'fast') state.mode = { speed:1.5, continuous:true  };
  else                     state.mode = { speed:1.0, continuous:false };

  state.name = (document.getElementById('student-name')?.value || state.name || 'Élève');
  state.startISO = new Date().toISOString();
  state.startMs = Date.now();

  // 화면 토글
  document.getElementById('mode-picker')?.classList.add('hidden');
  document.getElementById('warmup-screen')?.classList.remove('hidden');

  renderAll();
  window.scrollTo({ top: document.getElementById('warmup-screen').offsetTop-8, behavior:'smooth' });
}
window.WU_go = WU_go;

// ---------- Mount ----------
document.addEventListener('DOMContentLoaded', ()=>{
  try{
    window.StudentGate?.init?.();
    window.StudentGate?.requireBeforeInteraction?.(document);
  }catch(_){}
});
