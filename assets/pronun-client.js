// 공통 발음 마운터(녹음/분석 UI) – 작은 VU + REC 점 + 길이 측정 보정
(function(w){
  'use strict';
  const FN_BASE = (w.PONGDANG_FN_BASE || '/.netlify/functions');

  function toBareBase64(s){ return String(s||'').includes(',') ? String(s).split(',')[1] : String(s||''); }

  // ===== 녹음기(작은 VU) =====
  function pickMime(){
    const M = w.MediaRecorder; if(!M) return '';
    const c = (t)=> M.isTypeSupported && M.isTypeSupported(t);
    if (c('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
    if (c('audio/webm'))             return 'audio/webm';
    if (c('audio/mp4;codecs=mp4a.40.2')) return 'audio/mp4';
    return '';
  }

  function makeRecorder(){
    let mediaRecorder=null, chunks=[], stream=null, ctx=null, analyser=null, raf=0;
    let mime='', startedAt=0; // ← 시작 시각(밀리초)

    async function start(canvas){
      if(stream) stop(canvas);
      stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      mime = pickMime();
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType:mime }) : new MediaRecorder(stream);
      chunks = []; mediaRecorder.ondataavailable = e => chunks.push(e.data);

      // 작은 VU
      if(canvas){
        canvas.classList.add('vu-mini'); canvas.height = 16;
        ctx = new (w.AudioContext||w.webkitAudioContext)();
        const source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser(); analyser.fftSize = 512;
        source.connect(analyser);
        const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
        const data = new Uint8Array(analyser.frequencyBinCount);
        (function loop(){
          raf = requestAnimationFrame(loop);
          analyser.getByteFrequencyData(data);
          g.clearRect(0,0,W,H);
          const bars = 24, step = Math.floor(data.length/bars);
          g.fillStyle = '#6366f1';
          for(let i=0;i<bars;i++){
            const v=data[i*step]/255, bh=v*H;
            g.fillRect(i*(W/bars)+1, H-bh, (W/bars)-2, bh);
          }
        })();
      }
      startedAt = performance.now();           // ← 시작 시각 기록
      mediaRecorder.start(50);
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
          const reader = new FileReader();
          const audio = new Audio(URL.createObjectURL(blob));
          audio.addEventListener('loadedmetadata', ()=>{
            // 1차: 오디오 메타에서 길이
            let duration = Number(audio.duration);
            // 2차 폴백: 시작~지금까지의 경과시간(ms)
            if(!isFinite(duration) || duration<=0) duration = (performance.now()-startedAt)/1000;
            // 3차 안전망: 최소 0.1초
            if(!isFinite(duration) || duration<=0) duration = 0.1;

            reader.onloadend = ()=> resolve({
              base64: reader.result,
              duration,
              blob,
              mime: (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm'
            });
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

  // ===== 서버 분석 =====
  async function analyzePronunciation({ referenceText, record }){
    const payload = {
      referenceText,
      audio: { base64: toBareBase64(record.base64), filename:`rec_${Date.now()}.webm`, mimeType: record.mime || 'audio/webm', duration: record.duration }
    };
    const r = await fetch(`${FN_BASE}/analyze-pronunciation`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const data = await r.json().catch(()=> ({}));
    let acc = (typeof data.accuracy==='number') ? (data.accuracy>1 ? data.accuracy/100 : data.accuracy) : 0;
    const transcript = String(data.transcript||'');
    const friendly = Array.isArray(data?.details?.explain)?data.details.explain:[];
    return { accuracy: acc, transcript, friendly };
  }

  // ===== 마운트 =====
  function mount(root, opts){
    const recBtn  = root.querySelector('.btn-rec, .btn-rec-start');
    const stopBtn = root.querySelector('.btn-stop, .btn-rec-stop');
    const stat    = root.querySelector('.pronun-display') || root.querySelector('.status-line');
    const vu      = root.querySelector('canvas.vu, canvas');

    if(vu){ vu.classList.add('vu-mini'); vu.height = 16; }

    // REC 점(없으면 생성)
    let recDot = root.querySelector('.rec-indicator');
    if(!recDot){ recDot = document.createElement('span'); recDot.className='rec-indicator'; recDot.textContent='● REC';
      (recBtn?.parentElement||root).appendChild(recDot);
    }

    if(!recBtn || !stopBtn || !stat) return;
    const recorder = makeRecorder();
    let last=null;

    recBtn.addEventListener('click', async ()=>{
      recBtn.disabled=true; stopBtn.disabled=false;
      root.classList.add('is-recording');               // REC 켜기
      stat.textContent = 'Enregistrement… / 녹음 중…';
      try{
        await recorder.start(vu||null);
        // Web Speech 시작(라이브 STT)
        root.dispatchEvent(new CustomEvent('recording:start'));
      }catch(_){
        stat.textContent='Micro non autorisé / 마이크 권한';
        root.classList.remove('is-recording');
        recBtn.disabled=false; stopBtn.disabled=true;
      }
    });

    stopBtn.addEventListener('click', async ()=>{
      stopBtn.disabled=true;
      try{
        // Web Speech 정지
        root.dispatchEvent(new CustomEvent('recording:stop'));
        last = await recorder.getResult();
        root.classList.remove('is-recording');          // REC 끄기
        if(last?.duration) stat.textContent = `Terminé (${last.duration.toFixed(1)}s).`;
        else stat.textContent = 'Terminé.';
      }catch(_){
        stat.textContent='Problème enregistrement';
      }finally{
        recBtn.disabled=false;
      }
    });

    // 자동 평가(정지 후, KO가 맞은 카드만)
    root.addEventListener('recording:stop', async ()=>{
      if(!opts?.isKoCorrect || !opts.isKoCorrect()) return;
      try{
        const ref = (opts.getReferenceText?opts.getReferenceText():'').replace(/\s+/g,'');
        const { accuracy, transcript, friendly } = await analyzePronunciation({ referenceText: ref, record: last });
        stat.innerHTML = `Prononciation <b>${Math.round((accuracy||0)*100)}%</b> · STT: <span class="korean-font">${(transcript||'')}</span>`;
        if (opts.onResult) opts.onResult({ accuracy, transcript, friendly });
      }catch(_){
        // 조용히 통과 (폴백은 페이지에서 할 수 있음)
      }
    }, { once:false });
  }

  w.Pronun = { mount };
})(window);
