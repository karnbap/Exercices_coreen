// assets/warmup-5x5.js
// Warming up 5×5: 재생/녹음/평가 + 결과 전송
// 필요 파일: student-gate.js, pronun-utils.js, grading-criteria.js(선택), style.css(선택)
// 서버 함수: /.netlify/functions/generate-audio (TTS), /.netlify/functions/analyze-pronunciation (STT+채점), /.netlify/functions/send-results (메일)

// ===== 설정/데이터 =====
const FN_BASE = (window.PONGDANG_FN_BASE || '/.netlify/functions'); // 경로 공통
const BUNDLES = [
  { key:'natifs_1_5',  label:'Natifs (1–5)',  text:'하나, 둘, 셋, 넷, 다섯',   voice:'alloy'   },
  { key:'natifs_6_10', label:'Natifs (6–10)', text:'여섯, 일곱, 여덟, 아홉, 열', voice:'shimmer' },
  { key:'hanja_1_5',   label:'Hanja (1–5)',   text:'일, 이, 삼, 사, 오',       voice:'alloy'   },
  { key:'hanja_6_10',  label:'Hanja (6–10)',  text:'육, 칠, 팔, 구, 십',       voice:'alloy'   },
];
const STAGES = [
  { idx:0, title:'Étape 1', speed:0.7, continuous:false },
  { idx:1, title:'Étape 2', speed:1.0, continuous:false },
  { idx:2, title:'Étape 3', speed:1.2, continuous:false },
  { idx:3, title:'Étape 4', speed:1.5, continuous:false },
  { idx:4, title:'Étape 5 (rythme continu)', speed:1.5, continuous:true },
];

// 진행상태 + 듣기횟수
const progress = {};
const listenCount = {}; // key: `s{idx}-{bundle.key}` → number
STAGES.forEach(s => {
  progress[s.idx] = {};
  BUNDLES.forEach(b => {
    progress[s.idx][b.key] = { done:false, score:null, accuracy:null, audioBase64:null, duration:null, friendly:[] };
    listenCount[`s${s.idx}-${b.key}`] = 0;
  });
});

// ===== TTS =====
const VOICE_MAP = {
  openai: { default:'alloy', alloy:'alloy', shimmer:'verse' },
  google: { default:'ko-KR-Standard-A', alloy:'ko-KR-Standard-A', shimmer:'ko-KR-Standard-B' }
};
function mapVoice(provider, req){ const t = VOICE_MAP[provider]||{}; return t[req] || t.default || req; }
function base64ToBlob(base64, mime='audio/mpeg'){
  const cleaned = base64.includes(',') ? base64.split(',')[1] : base64;
  const byteChars = atob(cleaned);
  const arr = new Uint8Array(byteChars.length);
  for(let i=0;i<byteChars.length;i++) arr[i]=byteChars.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
function stripForContinuous(s){ return s.replace(/,\s*/g,' '); }

let currentAudio=null, audioLock=false, aborter=null, currentSrc=null;
async function playTTS(text, voice='alloy', speed=1.0, btn){
  if(audioLock){ if(currentAudio){ if(currentAudio.paused){ await currentAudio.play(); setBtnPlaying(btn,true);} else { currentAudio.pause(); setBtnPlaying(btn,false);} } return; }
  audioLock=true; setTimeout(()=>audioLock=false,200);
  try{
    if(currentAudio && currentAudio._meta === `${text}|${speed}|${voice}`){
      if(currentAudio.paused){ await currentAudio.play(); setBtnPlaying(btn,true);} else { currentAudio.pause(); setBtnPlaying(btn,false); }
      return;
    }
    if(aborter){ try{aborter.abort();}catch{} }
    if(currentAudio){ try{currentAudio.pause();}catch{} }
    if(currentSrc){ URL.revokeObjectURL(currentSrc); currentSrc=null; }

    aborter = new AbortController();
    const provider = (window.PONGDANG_TTS?.provider) || 'openai';
    const payload = { text, voice: mapVoice(provider, voice), provider, speed };
    const res = await fetch(`${FN_BASE}/generate-audio`, { method:'POST', headers:{'Content-Type':'application/json','Cache-Control':'no-store'}, body:JSON.stringify(payload), signal:aborter.signal });
    if(!res.ok) throw new Error('TTS fail '+res.status);
    const data = await res.json();

    let src = null;
    if(data.audioBase64 || data.audioContent){
      const blob = base64ToBlob(data.audioBase64 || data.audioContent, data.mimeType || 'audio/mpeg');
      src = URL.createObjectURL(blob);
    } else if (data.audioUrl){ src = data.audioUrl; }
    currentSrc = src;

    const audio = new Audio(src); currentAudio = audio; audio._meta = `${text}|${speed}|${voice}`;
    audio.addEventListener('playing', ()=>setBtnPlaying(btn,true));
    audio.addEventListener('pause',   ()=>setBtnPlaying(btn,false));
    audio.addEventListener('ended',   ()=>{ setBtnPlaying(btn,false); if(currentSrc){ URL.revokeObjectURL(currentSrc); currentSrc=null; } });
    await audio.play();
  }catch(e){ alert('Problème de lecture audio. Réessaie.'); }
}
function setBtnPlaying(btn, on){ if(!btn) return; btn.innerHTML = on ? '<i class="fas fa-pause"></i> Pause' : '<i class="fas fa-play"></i> Écouter'; }

// ===== 녹음 + 평가 =====
async function analyzePronunciation({ referenceText, audioBase64 }){
  const body = { text: referenceText, audioBase64, lang:'ko' };
  const r = await fetch(`${FN_BASE}/analyze-pronunciation`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(()=> ({}));
  if(!r.ok){ throw new Error(data?.error || 'Analyse échouée'); }
  let acc = 0;
  if(typeof data.accuracy === 'number') acc = data.accuracy;
  else if(typeof data.score === 'number') acc = data.score;
  else if(typeof data.percent === 'number') acc = data.percent / 100;
  if(acc > 1) acc = acc/100;
  return { accuracy: acc, raw:data };
}

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

// ===== 렌더링 =====
function renderStage(stage){
  const wrap = document.createElement('section');
  wrap.id = `stage-${stage.idx}`;
  wrap.innerHTML = `
    <h3 class="text-xl font-bold text-slate-800 mb-3">${stage.title} — vitesse ${stage.speed}× ${stage.continuous?'<span class="text-slate-500 text-sm">(rythme continu)</span>':''}</h3>
    <div class="space-y-4"></div>
  `;
  const list = wrap.querySelector('.space-y-4');
  BUNDLES.forEach(b => list.appendChild( makeBundleCard(stage, b) ));
  return wrap;
}

function makeBundleCard(stage, bundle){
  const wrap = document.createElement('div');
  wrap.className = 'wu-card';
  wrap.id = `stage-${stage.idx}-${bundle.key}`;

  const referenceText = stage.continuous ? stripForContinuous(bundle.text) : bundle.text;
  const listenKey = `s${stage.idx}-${bundle.key}`;

  wrap.innerHTML = `
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <div class="text-sm text-slate-500">${stage.title}</div>
        <div class="text-lg font-semibold">${bundle.label} <span class="text-slate-500">· ${referenceText}</span></div>
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

  // Écouter
  const btnPlay = wrap.querySelector('.btn-play');
  const playCountTag = wrap.querySelector('.play-count');
  btnPlay.addEventListener('click', async (e)=>{
    await playTTS(referenceText, bundle.voice, stage.speed, e.currentTarget);
    listenCount[listenKey] = (listenCount[listenKey]||0) + 1;
    playCountTag.textContent = String(listenCount[listenKey]);
  });

  // Recorder & Eval
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
    btnStart.disabled = true;
    btnStop.disabled  = false;
    btnEval.disabled  = true;
    scoreTag.classList.add('hidden');
    status.textContent = 'Enregistrement… parle comme le modèle !';
    try{
      await rec.start(canvas);
    }catch(e){
      alert("Micro non autorisé. Vérifie les permissions du navigateur.");
      btnStart.disabled = false; btnStop.disabled = true;
    }
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
    if(!lastRecord?.base64){ return; }
    btnEval.disabled = true;
    status.textContent = 'Évaluation en cours…';
    try{
      const { accuracy, raw } = await analyzePronunciation({ referenceText, audioBase64: lastRecord.base64 });
      const percent = Math.round((accuracy || 0)*100);
      scoreTag.textContent = `Score: ${percent}%`;
      scoreTag.classList.remove('hidden');
      status.textContent = 'Groupe évalué. Tu peux passer au suivant.';

      progress[stage.idx][bundle.key] = {
        done: true,
        score: percent,
        accuracy: accuracy,
        audioBase64: lastRecord.base64,
        duration: lastRecord.duration,
        friendly: raw?.tips || []
      };
      wrap.classList.add('wu-done');
      checkStageUnlock(stage.idx);
    }catch(e){
      status.textContent = 'Échec de l’évaluation. Réessaie.';
    }finally{
      btnEval.disabled = false;
    }
  });

  return wrap;
}

function checkStageUnlock(idx){
  const allDone = BUNDLES.every(b => progress[idx][b.key].done);
  if(!allDone) return;
  const dot = document.querySelector(`.progress-dot[data-dot="${idx}"]`);
  dot?.classList.add('on');

  const next = STAGES[idx+1];
  if(next){
    document.getElementById(`stage-${next.idx}`)?.classList.remove('hidden');
  }else{
    document.getElementById('finish-wrap')?.classList.remove('hidden');
  }
}

// ===== 결과 전송 =====
async function sendResults(){
  const questions = [];
  STAGES.forEach(s=>{
    BUNDLES.forEach(b=>{
      const st = progress[s.idx][b.key];
      const refText = s.continuous ? stripForContinuous(b.text) : b.text;
      const listenKey = `s${s.idx}-${b.key}`;
      questions.push({
        number: `WU-${s.idx+1}-${b.key}`,
        type: 'warmup_pronun',
        fr: `${b.label} — ${s.title} — vitesse ${s.speed}×${s.continuous?' (rythme continu)':''}`,
        ko: refText,
        userAnswer: '',
        isCorrect: true,
        listenCount: listenCount[listenKey] || 0,
        hint1Count: 0,
        hint2Count: 0,
        pronunciation: { accuracy: (st.accuracy ?? (st.score||0)/100), friendly: st.friendly || [] },
        recording: st.audioBase64 ? {
          base64: st.audioBase64, filename:`wu_${s.idx+1}_${b.key}.webm`, mimeType:'audio/webm', duration: st.duration
        } : null
      });
    });
  });

  const payload = {
    studentName: (document.getElementById('student-name')?.value || '').trim() || (window.StudentGate?.getName?.() || 'Élève'),
    startTime: window._startTime || new Date().toISOString(),
    endTime: new Date().toISOString(),
    totalTimeSeconds: Math.max(0, Math.round((Date.now() - (window._startMs||Date.now()))/1000)),
    assignmentTitle: 'Warming up 5×5 – Nombres coréens',
    assignmentSummary: [
      '4 groupes × 5 étapes (0.7/1.0/1.2/1.5/1.5 rythme continu)',
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
    document.getElementById('btn-next')?.classList.remove('hidden');
  }catch(e){
    console.error(e);
    alert('Envoi impossible. Réessaie plus tard.');
  }
}

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', ()=>{
  // 이름 게이트: 이름 없으면 상호작용 막기
  window.StudentGate?.init?.();
  window.StudentGate?.requireBeforeInteraction?.(document);

  const mount = document.getElementById('stages-wrap');
  STAGES.forEach((s, i)=>{
    const el = renderStage(s);
    if(i>0) el.classList.add('hidden');
    mount.appendChild(el);
  });

  document.getElementById('btn-send')?.addEventListener('click', sendResults);
});
