// assets/pronun-client.js
(function (global) {
  const DEFAULTS = {
    endpoint: '/.netlify/functions/analyze-pronunciation',
    selectors: {
      btnStart: '.btn-rec',
      btnStop: '.btn-stop',
      canvas: '.vu',
      result: '.pronun-display'
    },
    minDurationSec: 0.8,    // 0.8s 미만은 재녹음 안내
    maxDurationSec: 12,     // 너무 긴 녹음 방지 (선택)
    maxAnalysesPerSession: 40
  };

  // FR/KO 이중표시 헬퍼
  const t = (fr, ko) => `${fr} / ${ko}`;

  // ---- 유틸(전역에서 재사용) ----
  function _norm(s){
    return String(s||'')
      .replace(/\s+/g,'')
      .replace(/[.,!?;:()"'’“”\-–—]/g,'');
  }
  function _sim(a,b){
    const n=a.length, m=b.length;
    if(!n&&!m) return 1;
    if(!n||!m) return 0;
    const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
    for(let i=0;i<=n;i++) dp[i][0]=i;
    for(let j=0;j<=m;j++) dp[0][j]=j;
    for(let i=1;i<=n;i++){
      for(let j=1;j<=m;j++){
        const c=a[i-1]===b[j-1]?0:1;
        dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+c);
      }
    }
    const d=dp[n][m];
    return Math.max(0, 1 - d/Math.max(n,1));
  }

  async function jsonPost(url, payload) {
    const r = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function blobToBase64(blob){
    return new Promise((res,rej)=>{
      const fr = new FileReader();
      fr.onerror = rej;
      fr.onload = ()=> res(String(fr.result||'').split(',')[1]||'');
      fr.readAsDataURL(blob);
    });
  }

  // 브라우저가 지원하는 최적 MIME 선택
  function pickMime(){
    const M = window.MediaRecorder;
    if(!M) return '';
    const ok = (t)=> M.isTypeSupported && M.isTypeSupported(t);
    if(ok('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'; // Chrome
    if(ok('audio/webm')) return 'audio/webm';                         // Chrome fallback
    if(ok('audio/mp4;codecs=mp4a.40.2')) return 'audio/mp4';          // Safari/iOS (m4a)
    if(ok('audio/ogg;codecs=opus')) return 'audio/ogg';
    return '';
  }

  // 간단 VU 미터 (파형)
  function buildVU(stream, canvas){
    const ac = new (window.AudioContext||window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = 1024;
    const data = new Uint8Array(an.fftSize);
    src.connect(an);

    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a'; // slate-900

    const st = { ac, an, data, canvas, ctx, raf:0, peak:0 };
    (function loop(){
      an.getByteTimeDomainData(data);
      for(let i=0;i<data.length;i++){
        st.peak = Math.max(st.peak, Math.abs(data[i]-128)/128);
      }
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.beginPath();
      for(let x=0;x<canvas.width;x++){
        const idx = Math.floor(x/ canvas.width * data.length);
        const v = data[idx]/128 - 1;
        const y = canvas.height/2 + v*(canvas.height/2-4);
        x ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
      }
      ctx.stroke();
      st.raf = requestAnimationFrame(loop);
    })();
    return st;
  }

  function uiRec(btn, on){
    btn.disabled = on;
    btn.innerHTML = on ? '🔴 Enregistrement… / 녹음 중' : '🎙️ Enregistrer / 녹음';
  }

  // 카드 하나에 장착
  function mount(cardEl, options){
    const opts = Object.assign({}, DEFAULTS, options||{});
    const btnStart = cardEl.querySelector(opts.selectors.btnStart);
    const btnStop  = cardEl.querySelector(opts.selectors.btnStop);
    const canvas   = cardEl.querySelector(opts.selectors.canvas);
    const outEl    = cardEl.querySelector(opts.selectors.result);
    if(!btnStart || !btnStop || !canvas || !outEl) return;

    outEl.innerHTML = `<div class="small-muted">${t("Appuie sur « Enregistrer », puis « Arrêter ». L’évaluation démarre automatiquement.","‘녹음’ 누르고 ‘정지’하면 자동으로 평가돼요.")}</div>`;

    let rec=null, chunks=[], startedAt=0, vu=null, stream=null, mime='audio/webm';

    // 녹음 시작
    btnStart.addEventListener('click', async ()=>{
      try{
        stream = await navigator.mediaDevices.getUserMedia({ audio:true });
        vu = buildVU(stream, canvas);

        mime = pickMime() || 'audio/webm';
        const recOpts = mime ? { mimeType: mime } : undefined;

        rec = new MediaRecorder(stream, recOpts);
        chunks=[];
        rec.ondataavailable = e=> { if (e.data && e.data.size) chunks.push(e.data); };
        rec.start(50);
        startedAt = Date.now();

        uiRec(btnStart,true);
        btnStop.disabled=false;
      }catch(e){
        console.error(e);
        outEl.innerHTML = `<div class="small-muted">${t("Micro refusé. Vérifie les permissions.","마이크 권한을 허용해 주세요.")}</div>`;
      }
    });

    // 녹음 정지 → 업로드/평가
    btnStop.addEventListener('click', async ()=>{
      btnStop.disabled=true;

      try{ vu && cancelAnimationFrame(vu.raf); }catch{}
      try{ stream && stream.getTracks().forEach(t=>t.stop()); }catch{}

      if(rec){
        await new Promise(r=>{ rec.onstop=r; rec.stop(); });
      }
      uiRec(btnStart,false);

      const duration = Math.max(0,(Date.now()-startedAt)/1000);
      const blob = new Blob(chunks, { type: mime||'audio/webm' });

      // 정리
      chunks=[]; stream=null; rec=null;

      // 길이 체크
      if (duration < opts.minDurationSec) {
        outEl.innerHTML = `<div class="small-muted">${t("Trop court (≥0,8 s). Réessaie.","너무 짧아요(0.8초 이상). 다시 녹음해요.")}</div>`;
        btnStop.disabled=false; return;
      }
      if (duration > opts.maxDurationSec) {
        outEl.innerHTML = `<div class="small-muted">${t("Trop long. Refais un enregistrement plus court.","너무 길어요. 더 짧게 녹음해요.")}</div>`;
        btnStop.disabled=false; return;
      }

      // 볼륨 경고(평가 자체는 계속 진행)
      const tips = [];
      if (vu && vu.peak < 0.03) {
        tips.push(t("Parle plus fort/près du micro.","소리가 아주 작아요. 마이크에 더 가까이 말해요."));
      }

      outEl.innerHTML = `<div class="small-muted">${t("Analyse en cours…","분석 중…")}</div>`;

      try{
        // 업로드 준비
        const base64 = await blobToBase64(blob);
        const ref = (opts.getReferenceText && opts.getReferenceText(cardEl)) || "";

        // MIME에 맞춘 확장자 선택
        const ext = (mime.includes('mp4')||mime.includes('m4a')) ? 'm4a'
                  : mime.includes('ogg') ? 'ogg'
                  : mime.includes('mp3') ? 'mp3'
                  : 'webm';

        const payload = {
          referenceText: ref,
          audio: {
            base64,
            mimeType: mime||'audio/webm',
            filename: `rec_${Date.now()}.${ext}`,
            duration
          }
        };

        // 서버 평가
        const data = await jsonPost(opts.endpoint, payload);

        // STT 실패 시, Live STT(브라우저 실시간 표시 박스)로 폴백 점수 추정
        if (Array.isArray(data.confusionTags) && data.confusionTags.some(t=>String(t).startsWith('stt-fail'))) {
          const liveBox = cardEl.querySelector('.pronun-live');
          const liveText = liveBox ? liveBox.textContent.replace(/^Live:\s*/,'').trim() : '';
          if (liveText) {
            const accFallback = _sim(_norm(ref), _norm(liveText));
            data.accuracy = Math.max(Number(data.accuracy||0), accFallback);
            data.transcript = data.transcript || liveText;
            try { data.confusionTags.push('fallback:live-stt'); } catch(_){}
          }
        }

        // 100% 보정(공백 제거 동일)
        let acc = typeof data.accuracy==='number' ? data.accuracy : 0;
        const refC = _norm(ref);
        const hypC = _norm(data.transcript||'');
        if (refC && hypC && refC === hypC) acc = 1;

        outEl.innerHTML = `
          <div class="${acc>=0.85?'pill pill-green':'pill pill-red'}">Prononciation ${Math.round(acc*100)}%</div>
          ${data.confusionTags?.length?`<div class="small-muted mt-1">⚠️ Confusions: ${data.confusionTags.join(', ')}</div>`:''}
          ${tips.length?`<ul class="list-disc pl-5 small-muted mt-1">${tips.map(s=>`<li>${s}</li>`).join('')}</ul>`:''}
          <div class="small-muted mt-2">STT: ${data.transcript||'-'}<br/>Ref: ${ref}</div>
          <div class="small-muted mt-2">ℹ️ ${t("Quand tu arrêtes, l’évaluation démarre automatiquement.","정지하면 자동 평가돼요.")}</div>
        `;

        opts.onResult && opts.onResult({ accuracy: acc, transcript: data.transcript });

      }catch(e){
        console.error(e);
        outEl.innerHTML = `<div class="small-muted">Échec de l'analyse / 분석 실패</div>`;
      }finally{
        btnStop.disabled=false;
      }
    });
  }

  global.Pronun = { mount };
})(window);
