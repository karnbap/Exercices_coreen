// assets/warmup-chooser-5x5.js
// 속도 선택 → 4그룹 발음 연습 → 평가/전송 + 점수 설명(friendly tips)

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
window.state = state;

function stripForContinuous(s){ return s.replace(/,\s*/g,' '); }
function mapVoice(provider, req){
  const VOICE_MAP = {
    openai: { default:'alloy', alloy:'alloy', shimmer:'verse' },
    google: { default:'ko-KR-Standard-A', alloy:'ko-KR-Standard-A', shimmer:'ko-KR-Standard-B' }
  };
  const t = VOICE_MAP[provider]||{}; return t[req] || t.default || req;
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

    const audio = new Audio(src); currentAudio = audio; audio._meta = `${text}|${speed}|${voice}`;
    audio.addEventListener('playing', ()=>setBtnPlaying(btn,true));
    audio.addEventListener('pause',   ()=>setBtnPlaying(btn,false));
    audio.addEventListener('ended',   ()=>{ setBtnPlaying(btn,false); if(currentSrc){ URL.revokeObjectURL(currentSrc); currentSrc=null; } });
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
    if(canvas){ const g=canvas.getContext('2d'); g.clearRect(0,0,canvas.width,canvas.h
