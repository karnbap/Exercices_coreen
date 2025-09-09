// 속도 선택(WU_go) → 4그룹 발음 연습 렌더 → 평가/전송
const FN_BASE = (window.PONGDANG_FN_BASE || '/.netlify/functions');

const BUNDLES = [
  { key:'natifs_1_5',  label:'Natifs (1–5)',  text:'하나, 둘, 셋, 넷, 다섯',   voice:'alloy'   },
  { key:'natifs_6_10', label:'Natifs (6–10)', text:'여섯, 일곱, 여덟, 아홉, 열', voice:'shimmer' },
  { key:'hanja_1_5',   label:'Hanja (1–5)',   text:'일, 이, 삼, 사, 오',       voice:'alloy'   },
  { key:'hanja_6_10',  label:'Hanja (6–10)',  text:'육, 칠, 팔, 구, 십',       voice:'alloy'   },
];

const state = {
  mode: { speed:1.0, continuous:false }, // turbo(2.0x)도 여기서 처리
  progress: {}, listenCount: {},
  startISO: null, startMs: 0, name:'Élève'
};

// ---------- Utils ----------
function splitTokens(s){ return String(s||'').split(/[,\s]+/).filter(Boolean); }
function collapseKorean(s){ return splitTokens(s).join(''); }

// 연속 읽기시 자연스러운 연음 보정(간단 규칙): "일 이" → "이리"
// 요청 케이스: "일이삼사오"를 "이리삼사오"처럼 붙여 읽기
function applySimpleLiaisonForNumbers(text){
  // 토큰화 후 '일' 다음이 '이'면 '이리'로 합성
  const t = splitTokens(text);
  const out = [];
  for(let i=0;i<t.length;i++){
    if(t[i]==='일' && t[i+1]==='이'){
      out.push('이리'); i++; // 다음 토큰(이) 스킵
    } else {
      out.push(t[i]);
    }
  }
  return out.join(' ');
}

function makeTTSContinuous(text, speed=1.0){
  const provider = (window.PONGDANG_TTS?.provider) || 'openai';
  const raw = applySimpleLiaisonForNumbers(text);
  const parts = splitTokens(raw);
  if(provider === 'google'){
    const rate = Math.round(speed*100)+'%';
    return { ssml: `<speak><prosody rate="${rate}">${parts.join('<break time="0ms"/>')}</prosody></speak>` };
  }
  // WORD JOINER로 끊김 없이 연속 낭독
  return { text: parts.join('\u2060') };
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

// 느린 로딩시 경고가 먼저 떠버리는 문제 → 재시도 1회 + 토스트 표기(알럿 제거)
async function fetchAudioPayload(payload, signal){
  const res = await fetch(`${FN_BASE}/generate-audio`, {
    method:'POST', headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
    body: JSON.stringify(payload), signal
  });
  if(!res.ok) throw new Error('TTS '+res.status);
  return await res.json();
}
function showToast(msg){
  const el = document.createElement('div');
  el.style.cssText='position:fixed;left:12px;bottom:12px;background:#111827;color:#fff;padding:8px 10px;border-radius:10px;font:12px/1.4 ui-sans-serif;z-index:9999;opacity:.95';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 1800);
}

async function playTTS(input, voice='alloy', speed=1.0, btn, onStart){
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

    let data;
    try{
      data = await fetchAudioPayload(payload, aborter.signal);
    }catch(e){
      // 첫 실패 → 짧은 대기 후 1회 재시도
      await new Promise(r=>setTimeout(r, 700));
      data = await fetchAudioPayload(payload, aborter.signal);
    }

    let src = null;
    if(data.audioBase64 || data.audioContent){
      const blob = base64ToBlob(data.audioBase64 || data.audioContent, data.mimeType || 'audio/mpeg');
      src = URL.createObjectURL(blob);
    } else if (data.audioUrl){ src = data.audioUrl; }
    if(!src) throw new Error('No audio source');
    currentSrc = src;

    const audio = new Audio(src); currentAudio = audio;
    audio._meta = `${textOrSSML}|${speed}|${voice}|${isSSML?'ssml':'text'}`;
    audio.addEventListener('playing', ()=>setBtnPlaying(btn,true));
    audio.addEventListener('pause',   ()=>setBtnPlaying(btn,false));
    audio.addEventListener('ended',   ()=>{ setBtnPlaying(btn,false); if(currentSrc){ URL.revokeObjectURL(currentSrc); currentSrc=null; } });

    await audio.play();
    if(typeof onStart === 'function') onStart();
  }catch(e){
    showToast('⚠️ Audio: réseau lent. Réessaie / 네트워크 지연');
  }
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
  const hasSTT = !!transcript;
  const percent = hasSTT ? Math.round((accuracy||0)*100) : 0;

  const lines = [];
  // 불/한 병기 메시지(기본)
  if (!hasSTT) {
    lines.push('🎧 Reconnaissance vocale instable. Réessaie après 2–3 sec. / 음성 인식이 불안정해요. 2–3초 뒤 다시 시도하세요.');
  } else if (percent === 100) {
    lines.push('✅ Parfait ! Garde le rythme. / 완벽해요! 지금 리듬 유지.');
  }

  // 서버에서 온 친절 설명(객체 섞여도 문자열만)
  if (Array.isArray(friendly) && friendly.length) {
    friendly.forEach(it=>{
      if (typeof it === 'string') lines.push(it);
      else if (it && (it.tip || it.message || it.tag)) lines.push(String(it.tip || it.message || it.tag));
    });
  }

  // 모음 힌트 미들웨어
  try{
    const extra1 = (window.PronunUtils?.quickTips?.(refText, transcript)) || [];
    const extra2 = (window.VowelMiddleware?.hints?.(refText, transcript)) || [];
    [...extra1, ...extra2].forEach(t => {
      if (typeof t === 'string') lines.push(t);
      else if (t && (t.tip || t.message)) lines.push(String(t.tip || t.message));
    });
  }catch(_){}

  const sttLine = transcript ? `<div class="mt-2 text-[13px] text-slate-600">STT: ${transcript}</div>` : '';
  box.querySelector('.feedback-body').innerHTML =
    `<div class="text-slate-800 mb-1">Score / 점수: <b>${percent}%</b></div>
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
        <div class="text-xs text-slate-500">1) Écouter / 듣기  2) S’enregistrer / 녹음  3) Évaluer / 평가</div>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn-sound btn-play"><i class="fas fa-play"></i> Écouter</button>
        <span class="text-sm text-slate-500">écoutes: <b class="play-count">0</b></span>
      </div>
    </div>

    <div class="mt-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50/60">
      <div class="text-sm text-slate-700 mb-2">🎤 S’enregistrer & Évaluer / 녹음하고 평가받기</div>
      <div class="flex flex-wrap gap-2 mb-2">
        <button class="btn btn-secondary btn-rec-start"><i class="fa-solid fa-microphone"></i> Démarrer / 시작</button>
        <button class="btn btn-outline btn-rec-stop" disabled><i class="fa-solid fa-stop"></i> Arrêter / 정지</button>
        <button class="btn btn-primary btn-eval" disabled><i class="fa-solid fa-bolt"></i> Évaluer / 평가</button>
      </div>
      <div class="vu"><canvas class="vu-canvas" width="800" height="50"></canvas></div>
      <audio class="mt-2 w-full audio-playback hidden" controls></audio>
      <div class="mt-2 text-sm text-slate-600 status-line">Démarrer → Arrêter → Évaluer / 시작 → 정지 → 평가</div>
      <div class="mt-2 text-sm"><span class="inline-block bg-white border px-2 py-1 rounded score-pill hidden"></span></div>

      <div class="mt-3 feedback-card hidden">
        <div class="font-semibold mb-1">🧠 Explication / 점수 설명</div>
        <div class="text-sm text-slate-700 feedback-body"></div>
      </div>
    </div>
  `;

  const btnPlay = wrap.querySelector('.btn-play');
  const playCountTag = wrap.querySelector('.play-count');
  btnPlay.addEventListener('click', async (e)=>{
    await playTTS(
      ttsInput,
      bundle.voice,
      state.mode.speed,
      e.currentTarget,
      () => { // 새 재생 시작시에만 듣기 횟수 증가
        state.listenCount[bundle.key] = (state.listenCount[bundle.key]||0) + 1;
        playCountTag.textContent = String(state.listenCount[bundle.key]);
      }
    );
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
    status.textContent = 'Enregistrement… parle comme le modèle ! / 녹음 중… 모델처럼 읽어봐요!';
    try{ await rec.start(canvas); }
    catch(e){ showToast('🎙️ Micro refusé. Autorise-le dans le navigateur. / 마이크 권한을 허용해주세요.'); btnStart.disabled=false; btnStop.disabled=true; }
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
      status.textContent = lastRecord ? `Terminé (${(lastRecord.duration||0).toFixed(1)} s). Clique “Évaluer”. / 완료, “평가” 버튼을 눌러요.` : 'Réessaie / 다시 시도';
    }catch(e){
      btnStart.disabled = false;
      status.textContent = 'Problème d’enregistrement. Réessaie. / 녹음 오류. 다시 시도.';
    }
  });

  btnEval.addEventListener('click', async ()=>{
    if(!lastRecord?.base64) return;
    btnEval.disabled = true; status.textContent = 'Évaluation… / 평가 중…';
    try{
      const { accuracy, friendly, transcript } = await analyzePronunciation({ referenceText: refEval, record: lastRecord });
      const hasSTT = !!transcript;
      const percent = hasSTT ? Math.round((accuracy || 0)*100) : 0;
      scoreTag.textContent = `Score / 점수: ${percent}%`;
      scoreTag.classList.remove('hidden');

      state.progress[bundle.key] = {
        done:true, score:percent, accuracy,
        audioBase64: toBareBase64(lastRecord.base64),
        duration:lastRecord.duration, friendly
      };
      wrap.classList.add('ring-2','ring-emerald-300','bg-emerald-50');
      renderFeedback(fbBox, { friendly, accuracy, transcript, refText: refEval });
      fbBox.classList.remove('hidden');
      status.textContent = 'Passe au suivant. / 다음 그룹으로!';
      checkFinish();
    }catch(e){
      status.textContent = 'Échec de l’évaluation. Réessaie. / 평가 실패. 다시 시도.';
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
    showToast('📨 Résultat envoyé / 결과 전송 완료');
  }catch(e){
    console.error(e);
    showToast('❌ Envoi impossible. Réessaie / 전송 실패');
  }
}

// ---------- Public API ----------
function WU_go(mode){
  if(mode === 'slow')      state.mode = { speed:0.7, continuous:false };
  else if(mode === 'fast') state.mode = { speed:1.5, continuous:true  };
  else if(mode === 'turbo')state.mode = { speed:2.0, continuous:true  }; // 2배속 추가
  else                     state.mode = { speed:1.0, continuous:false };

  state.name = (document.getElementById('student-name')?.value || state.name || 'Élève');
  state.startISO = new Date().toISOString();
  state.startMs = Date.now();

  document.getElementById('mode-picker')?.classList.add('hidden');
  document.getElementById('warmup-screen')?.classList.remove('hidden');

  renderAll();
  const target = document.getElementById('warmup-screen');
  if(target) window.scrollTo({ top: target.offsetTop-8, behavior:'smooth' });
}
window.WU_go = WU_go;

// ---------- Mount ----------
document.addEventListener('DOMContentLoaded', ()=>{
  try{
    window.StudentGate?.init?.();
    window.StudentGate?.requireBeforeInteraction?.(document);
  }catch(_){}
});
