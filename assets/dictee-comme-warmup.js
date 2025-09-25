/* assets/dictee-comme-warmup.js
   Dictée “Comme/처럼” — 최종본
   - 정지→자동평가 + [⚡ Évaluer]로 재평가 가능
   - 힌트 버튼: 전역 토글(StudentGate) 사용 + 최초 1회만 카운트
   - 실시간 자막 수신(LiveSTT 이벤트) + 폴백 문구
   - 저음량 민감도 향상(GainNode, minDecibels, smoothing)
   - VU: DPR 스케일 + 막대/타임도메인 하이브리드
   - 결과 전송: /.netlify/functions/send-results
*/
(function(){
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

  // ===== 데이터 =====
  const SAFE_VOICES = ['alloy','shimmer','verse','nova','fable','echo'];
  const vAt = i => SAFE_VOICES[i % SAFE_VOICES.length];

  const ex = [
    { ko:"혜진이는 천사 같아요.", fr:"Hyejin est comme un ange.", hint1:"ㅎㅈㅇㄴ ㅊㅅ ㄱㅇㅇ", hint2:"천사=ange",          voice:vAt(0) },
    { ko:"오늘 이 소식은 꿈 같아요.", fr:"Cette nouvelle d'aujourd'hui est comme un rêve.", hint1:"ㅇㄴ ㅇ ㅅㅅㅇ ㄲ ㄱㅇㅇ", hint2:"꿈=rêve",           voice:vAt(1) },
    { ko:"민수의 친구는 가족 같아요.", fr:"L'ami de Minsu est comme de la famille.",       hint1:"ㅁㅅㅇ ㅊㄱㄴ ㄱㅈ ㄱㅇㅇ", hint2:"가족=famille",     voice:vAt(2) },
    { ko:"우리 아빠 마음은 바다처럼 넓어요.", fr:"Le cœur de mon père est large comme la mer.", hint1:"ㅇㄹ ㅇㅃ ㅁㅇㅇ ㅂㄷㅊㄹ ㄴㄹㅇㅇ", hint2:"바다=mer", voice:vAt(3) },
    { ko:"그 친구는 소처럼 많이 먹어요.", fr:"Cet(te) ami(e) mange beaucoup, comme une vache.", hint1:"ㄱ ㅊㄱㄴ ㅅㅊㄹ ㅁㅇ ㅁㅇㅇ", hint2:"소=vache",       voice:vAt(4) },
    { ko:"저 남자는 바람처럼 달려요.", fr:"Cet homme court comme le vent.",                   hint1:"ㅈ ㄴㅈㄴ ㅂㄹㅊㄹ ㄷㄹㅇ", hint2:"바람=vent",        voice:vAt(5) },
    { ko:"민지는 가수처럼 노래를 잘해요.", fr:"Minji chante bien comme une chanteuse.",         hint1:"ㅁㅈㄴ ㄱㅅㅊㄹ ㄴㄹㄹ ㅈㅎㅇ", hint2:"가수=chanteur", voice:vAt(0) },
    { ko:"준호는 로봇처럼 걸어요.", fr:"Junho marche comme un robot.",                         hint1:"ㅈㅎㄴ ㄹㅂㅊㄹ ㄱㄹㅇ", hint2:"로봇=robot",        voice:vAt(1) },
    { ko:"저는 친구랑 같이 갔어요.", fr:"Je suis allé(e) avec mon ami(e).",                   hint1:"ㅈㄴ ㅊㄱㄹ ㄱㅊ  ㄱㅆㅇㅇ", hint2:"같이=ensemble", voice:vAt(2) },
    { ko:"그 아이는 별처럼 춤을 춰요.", fr:"Cet enfant danse comme une étoile.",               hint1:"ㄱ ㅇㅇㄴ ㅂㅊㄹ ㅊㅇ ㅊㅇ", hint2:"별=étoile",      voice:vAt(3) },
    { ko:"오늘은 어제 같아요.", fr:"Aujourd'hui est comme hier.",                               hint1:"ㅇㄴㅇ ㅇㅈ ㄱㅇㅇ", hint2:"어제=hier",           voice:vAt(4) },
    { ko:"그 사람은 배우 같아요.", fr:"Cette personne est comme un(e) acteur/actrice.",       hint1:"ㄱ ㅅㄹㅇ ㅂㅇ ㄱㅇㅇ", hint2:"배우=acteur",       voice:vAt(5) },
    { ko:"제 손은 얼음 같아요.", fr:"Ma main est comme de la glace (froide).",                 hint1:"ㅈ ㅅㅇ ㅇㅇ ㄱㅇㅇ", hint2:"얼음=glace",         voice:vAt(0) },
    { ko:"그 가수의 목소리는 설탕 같아요.", fr:"La voix de ce chanteur est douce comme le sucre.", hint1:"ㄱ ㄱㅅㅇ ㅁㅅㄹㄴ ㅅㅌ ㄱㅇㅇ", hint2:"설탕=sucre",   voice:vAt(1) },
    { ko:"그 아이는 인형 같아요.", fr:"Cet enfant est comme une poupée.",                       hint1:"ㄱ ㅇㅇㄴ ㅇㅎ ㄱㅇㅇ", hint2:"인형=poupée",       voice:vAt(2) },
    { ko:"그 사람은 물처럼 돈을 써요.", fr:"Cette personne dépense de l'argent comme de l'eau.",   hint1:"ㄱ ㅅㄹㅇ ㅁㅊㄹ ㄷㄴ ㅆㅇ", hint2:"물=eau",        voice:vAt(3) },
    { ko:"그 친구는 거북이처럼 느려요.", fr:"Cet(te) ami(e) est lent(e) comme une tortue.",       hint1:"ㄱ ㅊㄱㄴ ㄱㅂㅇㅊㄹ ㄴㄹㅇ", hint2:"거북이=tortue",  voice:vAt(4) },
    { ko:"민수는 전문가처럼 말해요.", fr:"Minsu parle comme un expert.",                          hint1:"ㅁㅅㄴ ㅈㅁㄱㅊㄹ ㅁㅎㅇ", hint2:"전문가=expert",   voice:vAt(5) },
    { ko:"우리 아기는 아기처럼 잘 자요.", fr:"Notre bébé dort comme un bébé.",                     hint1:"ㅇㄹ ㅇㄱㄴ ㅇㄱㅊㄹ ㅈ  ㅈㅇ", hint2:"아기=bébé",  voice:vAt(0) },
    { ko:"그 남자는 영화배우처럼 잘생겼어요.", fr:"Cet homme est beau comme un acteur de cinéma.",  hint1:"ㄱ ㄴㅈㄴ ㅇㅎㅂㅇㅊㄹ ㅈㅅㄱㅆㅇㅇ", hint2:"영화배우=acteur", voice:vAt(1) }
  ];

  // per-question state
  const st = ex.map(()=>({listen:0,h1:0,h2:0,koOK:false,frOK:false,recBase64:null,recDur:0,acc:null,trans:''}));

  // ===== 유틸 =====
  function base64ToBlob(b64, mime="audio/mpeg"){
    const clean = b64.includes(',') ? b64.split(',')[1] : b64;
    const bin=atob(clean), u8=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
    return new Blob([u8],{type:mime});
  }
  const audioCache=new Map();
  async function ttsPlay(text, voice){
    const key=`${voice}|${text}|1.0`;
    const play=async(blob)=>{
      const url=URL.createObjectURL(blob);
      const a=new Audio(); a.playbackRate=1.0; a.src=url; a.preload='auto';
      await new Promise(res=>a.addEventListener('canplaythrough',res,{once:true}));
      a.addEventListener('ended',()=>URL.revokeObjectURL(url),{once:true});
      await a.play();
    };
    if(audioCache.has(key)) return play(audioCache.get(key));
    const r=await fetch('/.netlify/functions/generate-audio',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text,voice,speed:1.0})
    });
    if(!r.ok) throw new Error('TTS '+r.status);
    const j=await r.json();
    const b64 = j.audioBase64 || j.audioContent || j.audioData;
    const blob=base64ToBlob(b64, j.mimeType||'audio/mpeg');
    audioCache.set(key,blob); return play(blob);
  }

  function styleHintKO(s){
    const hasJeon=/(저는|전)/.test(s), hasNa=/(나는|난)/.test(s), polite=/(요|니다)[\s.]*$/.test(s);
    if(hasJeon && !polite) return "“저는/전”이면 끝을 -요/-(스)ㅂ니다로.";
    if(hasNa && polite) return "“나는/난”이면 반말(-아/어)로 끝내요.";
    return '';
  }

  // ===== 렌더 =====
  function render(){
    const root=$('#dictee-root'); root.innerHTML='';
    ex.forEach((q,i)=>{
      const el=document.createElement('section'); el.className='card'; el.dataset.card='1';
      el.innerHTML=`
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-3">
            <span class="text-2xl font-extrabold text-indigo-600">${i+1}</span>
            <button class="btn btn-primary play" data-requires-name>▶ Écouter</button>
            <span class="text-sm text-slate-500">écoutes: <b class="listen">0</b></span>
          </div>
          <div class="text-xs text-slate-500">Écouter → KO → FR → 🎙️ Arrêter = évaluer</div>
        </div>

        <div class="mt-3 grid gap-2 ml-10">
          <input class="ko kof p-2 border-2 rounded-lg focus:border-indigo-500" placeholder="Écrivez ici (한글로) / 여기에 한국어로 입력하세요"/>
          <input class="fr p-2 border-2 rounded-lg focus:border-indigo-500" placeholder="Traduction en français / 불어로 번역을 적으세요"/>

          <div class="flex gap-2">
            <button type="button" class="btn-hint btn-hint1" data-target=".hint1-box" aria-pressed="false" data-allow-before-name="1">
              🙏 Aidez-moi <span class="ml-1 text-sm text-slate-100">(초성)</span>
            </button>
            <button type="button" class="btn-hint btn-hint2" data-target=".hint2-box" aria-pressed="false" data-allow-before-name="1">
              🦺 Au secours <span class="ml-1 text-sm text-slate-100">(단어)</span>
            </button>
            <button class="btn btn-ghost check">Vérifier (정답 확인)</button>
          </div>

          <!-- 힌트 박스(전역 토글 사용: .show) -->
          <div class="hint-box hint1-box"><b>🙏 초성:</b> <span class="kof">${q.hint1 || '—'}</span></div>
          <div class="hint-box hint2-box"><b>🦺 단어:</b> ${q.hint2 ? q.hint2 : '—'}</div>

          <div class="mt-1 flex items-center gap-2">
            <button class="btn btn-ghost rec"  data-requires-name>🎙️ Démarrer</button>
            <button class="btn btn-ghost stop" data-requires-name disabled>⏹️ Arrêter</button>
            <button class="btn btn-primary eval" data-requires-name disabled>⚡ Évaluer</button>
            <span class="text-sm text-slate-500">정지하면 자동 평가</span>
          </div>
          <canvas class="vu" style="width:100%;height:96px;border:1px solid #e2e8f0;border-radius:.5rem;background:#fff"></canvas>
          <div class="live text-xs p-2 rounded border bg-white">En direct / 실시간…</div>
          <div class="out text-sm"></div>
        </div>`;
      root.appendChild(el);

      // 듣기
      const btnPlay=$('.play',el), listen=$('.listen',el);
      btnPlay.onclick=async()=>{ await ttsPlay(q.ko,q.voice); st[i].listen++; listen.textContent=String(st[i].listen); };

      // ===== 힌트 카운트만(전역 토글 사용) =====
      // student-gate.js가 btn에 'hint-toggle' 이벤트를 디스패치함(bubbles=true)
      el.addEventListener('hint-toggle', (e)=>{
        if(!e?.detail?.shown) return;
        const btn = e.target; // 실제 누른 버튼
        if(btn.classList.contains('btn-hint1') && !btn.dataset._opened){ st[i].h1++; btn.dataset._opened='1'; }
        if(btn.classList.contains('btn-hint2') && !btn.dataset._opened){ st[i].h2++; btn.dataset._opened='1'; }
      });

      // ===== 채점 =====
      const koInp=$('.ko',el), frInp=$('.fr',el), out=$('.out',el);
      const pill=(ok,label)=> ok?`<span class="tag tag-green">${label} ✓</span>`:`<span class="tag tag-red">${label} ✗</span>`;
      function grade(){
        const ko=koInp.value||'', fr=frInp.value||'';
        const gk=window.AnswerJudge?.gradeKO
          ? window.AnswerJudge.gradeKO(q.ko, ko, { allowSubstring:true })  // “부분 포함도 정답 인정”
          : { isCorrect:false, note:'(AnswerJudge 없음)' };
        const gf=window.AnswerJudge?.gradeFR ? window.AnswerJudge.gradeFR(q.fr, fr) : { isCorrect:false, note:'(AnswerJudge 없음)' };
        st[i].koOK=gk.isCorrect; st[i].frOK=gf.isCorrect;
        const style=styleHintKO(ko);
        const roman=/[A-Za-z]/.test(ko)?'라틴 문자(ga teun 등) 금지':'';
        const notes=[gk.note&&('KO: '+gk.note), gf.note&&('FR: '+gf.note), style, roman].filter(Boolean).join(' · ');
        const ok=gk.isCorrect&&gf.isCorrect;
        out.innerHTML = ok
          ? `<div class="p-3 rounded border bg-emerald-50">🎉 Super! ${pill(true,'KO')} ${pill(true,'FR')}<div class="mt-1 kof"><b>정답(한):</b> ${q.ko}</div><div><b>Traduction:</b> ${q.fr}</div>${notes?`<div class="text-xs mt-1">${notes}</div>`:''}</div>`
          : `<div class="p-3 rounded border bg-rose-50">👍 거의 맞았어요. ${pill(st[i].koOK,'KO')} ${pill(st[i].frOK,'FR')}<div class="mt-1"><b>Ma réponse (KO):</b> ${ko||'(vide)'} / <b>FR:</b> ${fr||'(vide)'}</div><div class="kof"><b>정답(한):</b> ${q.ko}</div><div><b>Traduction:</b> ${q.fr}</div>${notes?`<div class="text-xs mt-1">${notes}</div>`:''}</div>`;
      }
      $('.check',el).onclick=grade;
      koInp.addEventListener('keydown',e=>{ if(e.key==='Enter') grade(); });
      frInp.addEventListener('keydown',e=>{ if(e.key==='Enter') grade(); });

      // ===== 녹음/정지/평가 (+민감도 향상 VU, 실시간 자막) =====
      let media=null, mr=null, chunks=[], started=0, lastBlob=null, lastDur=0;
      const vuCanvas=$('.vu',el), live=$('.live',el), btnRec=$('.rec',el), btnStop=$('.stop',el), btnEval=$('.eval',el);
      // STT 핸들러 레퍼런스(스코프 밖에 보관)
      let partHandler = null;
      let finalHandler = null;

      function ensureCanvasSize(cv){
        const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
        const w = cv.clientWidth, h = cv.clientHeight;
        if (!w || !h) return;
        cv.width  = w * dpr;
        cv.height = h * dpr;
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr,0,0,dpr,0,0);
      }
      ensureCanvasSize(vuCanvas);
      window.addEventListener('resize', ()=>ensureCanvasSize(vuCanvas), { passive:true });

      const ctx=vuCanvas.getContext('2d'); let an,src,ac,raf=0,gainNode;

      function drawHybrid(){
        raf=requestAnimationFrame(drawHybrid);
        if(!an) return;
        const freq=new Uint8Array(an.frequencyBinCount);
        const time=new Uint8Array(an.fftSize);
        an.getByteFrequencyData(freq);
        an.getByteTimeDomainData(time);

        const W=vuCanvas.clientWidth, H=vuCanvas.clientHeight;
        ctx.clearRect(0,0,W,H);
        ctx.fillStyle='#eef2ff'; ctx.fillRect(0,0,W,H);

        const bars=24, barW=Math.max(2,Math.floor((W-(bars-1)*2)/bars)), step=Math.floor(freq.length/bars);
        for(let b=0;b<bars;b++){
          const slice=freq.slice(b*step,(b+1)*step);
          const avg=slice.reduce((a,c)=>a+c,0)/Math.max(1,slice.length);
          const h=Math.max(3,(avg/255)*(H-8)), x=b*(barW+2), y=H-h-2;
          ctx.fillStyle='#6366f1'; ctx.fillRect(x,y,barW,h);
          ctx.fillStyle='#a5b4fc'; ctx.fillRect(x,y,barW,2);
        }
        ctx.beginPath();
        const mid=H/2;
        for(let x=0;x<W;x++){
          const v=time[Math.floor(x/W*time.length)]/128-1, y=mid+v*(mid-6);
          x?ctx.lineTo(x,y):ctx.moveTo(x,y);
        }
        ctx.strokeStyle='#94a3b8'; ctx.lineWidth=1; ctx.stroke();
      }

      async function startVu(stream){
        ac=new (window.AudioContext||window.webkitAudioContext)();
        src=ac.createMediaStreamSource(stream);
        gainNode = ac.createGain();
        gainNode.gain.value = 1.6;                 // 저음량 보정
        src.connect(gainNode);
        an=ac.createAnalyser();
        an.fftSize = 2048;
        an.minDecibels = -100;                     // 민감도 ↑
        an.maxDecibels = -10;
        an.smoothingTimeConstant = 0.85;
        gainNode.connect(an);
        drawHybrid();
      }
      function stopVu(){
        cancelAnimationFrame(raf);
        try{gainNode&&gainNode.disconnect();}catch(_){}
        try{src&&src.disconnect();}catch(_){}
        try{an&&an.disconnect();}catch(_){}
        try{ac&&ac.close();}catch(_){}
        an=src=ac=gainNode=null;
        ctx.clearRect(0,0,vuCanvas.clientWidth,vuCanvas.clientHeight);
      }

      async function recStart(){
        if(mr) return;
        try{
          media=await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }
          });
        }catch{
          $('.out',el).innerHTML='<div class="text-rose-600">🎙️ 마이크 권한 필요 / Autorisez le micro.</div>';
          return;
        }
        chunks=[]; mr=new MediaRecorder(media,{mimeType:'audio/webm'});
        mr.ondataavailable=e=>{ if(e.data&&e.data.size) chunks.push(e.data); };
        mr.onstop=onStop; started=Date.now();
        await startVu(media); mr.start();
        btnRec.disabled=true; btnStop.disabled=false; btnEval.disabled=true;
        live.textContent='En direct / 실시간… (préparation)';

// Live STT(있으면) 연결
if (window.LiveSTT) {
  const api = window.LiveSTT;
  const opts = { root: el, startSel: '.rec', stopSel: '.stop', outSel: '.live', lang: 'ko-KR' };
  if (typeof api.mount === 'function') api.mount(opts);
  else if (typeof api.attach === 'function') api.attach(opts);
}

const handleText = (rawText, isFinal=false)=>{
  const raw = String(rawText||'').trim();
  const ref = q.ko || '';
  const norm = (window.PronunUtils?.NumNormalizer?.refAwareNormalize)
    ? window.PronunUtils.NumNormalizer.refAwareNormalize(ref, raw)
    : (window.NumHangul?.forceHangulNumbers ? window.NumHangul.forceHangulNumbers(raw) : raw);
  live.textContent = isFinal ? ('En direct / 실시간 (final): ' + norm) : norm;
};

// 이벤트 네이밍 호환(콜론/하이픈 모두 수신)
partHandler  = (e)=>{ if(e?.detail?.text!=null) handleText(e.detail.text, false); };
finalHandler = (e)=>{ if(e?.detail?.text!=null) handleText(e.detail.text, true); };

['livestt:partial','live-stt-partial'].forEach(evt=>{
  el.addEventListener(evt, partHandler);
  document.addEventListener(evt, partHandler);
});
['livestt:final','live-stt-final'].forEach(evt=>{
  el.addEventListener(evt, finalHandler);
  document.addEventListener(evt, finalHandler);
});

setTimeout(()=>{
  if(live.textContent.includes('(préparation)')) live.textContent='En direct / 실시간…';
}, 1500);
      }

      async function onStop(){
         ['livestt:partial','live-stt-partial'].forEach(evt=>{
  el.removeEventListener(evt, onPart); document.removeEventListener(evt, onPart);
});
['livestt:final','live-stt-final'].forEach(evt=>{
  el.removeEventListener(evt, onFinal); document.removeEventListener(evt, onFinal);
});

        stopVu();
           // STT 이벤트 핸들러 해제(스코프 밖 레퍼런스 사용)
  if (partHandler){
    ['livestt:partial','live-stt-partial'].forEach(evt=>{
      el.removeEventListener(evt, partHandler);
      document.removeEventListener(evt, partHandler);
    });
    partHandler = null;
  }
  if (finalHandler){
    ['livestt:final','live-stt-final'].forEach(evt=>{
      el.removeEventListener(evt, finalHandler);
      document.removeEventListener(evt, finalHandler);
    });
    finalHandler = null;
  }

        const dur=(Date.now()-started)/1000;
        const blob=new Blob(chunks,{type:'audio/webm'}); chunks=[];
        btnRec.disabled=false; btnStop.disabled=true; btnEval.disabled=false;
        try{ media.getTracks().forEach(t=>t.stop()); }catch(_){}
        mr=null; media=null;

        lastBlob=blob; lastDur=dur;

        if(!st[i].koOK){
          $('.out',el).innerHTML+='<div class="text-xs text-slate-500 mt-1">KO 정답 확인 후 발음 평가가 정확해져요.</div>';
          return;
        }
        await evaluate(blob, dur);
      }
      async function recStop(){ if(!mr) return; mr.stop(); }

      // ===== 평가(백엔드) =====
      async function evaluate(blob, dur){
        const out=$('.out',el);
        try{
          out.innerHTML='<div class="text-sm text-slate-500">⏳ 평가 중…</div>';
          const base64 = await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onerror=rej; fr.onload=()=>res(String(fr.result||'').split(',')[1]||''); fr.readAsDataURL(blob); });
          const ref = q.ko.replace(/\s+/g,'');
          const r=await fetch('/.netlify/functions/analyze-pronunciation',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({
  referenceText: ref,
  hints: q.ko.split(/\s+/).slice(0,12),
  audio: { base64, mimeType:'audio/webm', filename:'rec.webm', duration: Math.round(dur*100)/100 }
})
});
          const j=await r.json().catch(()=>({}));
          if(!r.ok || j.ok===false){
            const frMsg = j.messageFr || "Échec de l'analyse. Réessayez.";
            const koMsg = j.messageKo || "평가에 실패했어요. 다시 시도해 주세요.";
            out.innerHTML = `<div class="p-3 rounded border bg-rose-50"><b>${frMsg}</b><br>${koMsg}</div>`;
            return;
          }

          const acc=Math.max(0,Math.min(1,Number(j.accuracy||0))); const pct=Math.round(acc*100);
st[i].acc = acc;
let tr = String(j.transcript||'').trim();
if (window.PronunUtils?.NumNormalizer?.refAwareNormalize) {
  tr = window.PronunUtils.NumNormalizer.refAwareNormalize(q.ko, tr);
} else if (window.NumHangul?.forceHangulNumbers) {
  tr = window.NumHangul.forceHangulNumbers(tr);
}
st[i].trans = tr;
st[i].recBase64 = base64;
st[i].recDur = dur;

          const tips = Array.isArray(j.confusionTags)&&j.confusionTags.length
            ? `• 발음 유의 / À noter: ${j.confusionTags.join(', ')}`
            : (j.warnFr || j.warnKo ? `• ${j.warnFr||''} ${j.warnKo||''}` : '');

          out.innerHTML = `
            <div class="p-3 rounded border bg-white">
              <div class="text-sm text-slate-600 mb-1">Explication de la note / 점수 설명</div>
              <div class="text-lg font-semibold">Score: ${pct}%</div>
              <div class="mt-1 text-sm"><b>Référence:</b> ${ref}</div>
              <div class="mt-1 text-sm"><b>Ma prononciation:</b> ${st[i].trans||'(vide)'}</div>
              ${tips?`<div class="mt-2 text-xs text-slate-600">${tips}</div>`:''}
            </div>`;
        }catch(e){
          console.error(e);
          out.innerHTML='<div class="text-rose-600">평가 오류. 다시 시도해 주세요. / Erreur d’analyse. Réessayez.</div>';
          fetch('/.netlify/functions/log-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({functionName:'dictee-comme-warmup',error:String(e),pageUrl:location.href})}).catch(()=>{});
        }
      }

      btnRec.onclick=recStart;
      btnStop.onclick=recStop;
      btnEval.onclick=async()=>{ if(!lastBlob){ $('.out',el).innerHTML+='<div class="text-xs text-slate-500 mt-1">녹음 후 평가할 수 있어요.</div>'; return; } await evaluate(lastBlob,lastDur); };
    });
  }

  // ===== 컨트롤 =====
  $('#restart-btn')?.addEventListener('click',()=>{
    $('#dictee-root').innerHTML='';
    for(const s of st){ Object.assign(s,{listen:0,h1:0,h2:0,koOK:false,frOK:false,recBase64:null,recDur:0,acc:null,trans:''}); }
    render();
  });

  $('#finish-btn')?.addEventListener('click', async ()=>{
    const name=(window.StudentGate?.getName?.()||$('#student-name')?.value||$('#studentName')?.value||'').trim()||'N/A';
    const total=ex.length, koC=st.filter(s=>s.koOK).length, frC=st.filter(s=>s.frOK).length;
    const koScore=Math.round(100*koC/Math.max(1,total));
    const frScore=Math.round(100*frC/Math.max(1,total));
    const pron = st.map(s=>s.acc).filter(x=>typeof x==='number'&&isFinite(x));
    const pronScore=Math.round(100*(pron.reduce((a,b)=>a+b,0)/Math.max(1,pron.length)));
    const overall=Math.round((koScore+frScore)/2);

    const gm=(window.Grading?.getGradingMessage?.(overall))||null;
    alert(`${gm?gm.emoji+' '+gm.fr+' / '+gm.ko+'\n':''}총점 ${overall}/100\nKO ${koScore}/100 · FR ${frScore}/100 · 발음 ${isFinite(pronScore)?pronScore:0}/100`);

    try{
      const payload={
        studentName:name,
        startTime: window._startTime || new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalTimeSeconds: Math.round((Date.now()-(window._startMs||Date.now()))/1000),
        assignmentTitle:"Dictée – Comme (style Warm-up)",
        assignmentTopic:"같아요/같은/처럼/같이",
        assignmentSummary:["nom+처럼/같이","~와/과 같다","동사+처럼/같이"],
        gradingMessage:gm,
        categoryScores:{ko:koScore,fr:frScore,pron:pronScore,overall},
        questions: ex.map((q,i)=>({
          number:i+1, ko:q.ko, fr:q.fr,
          userAnswer: $$('.ko')[i]?.value||'',
          userAnswerFr: $$('.fr')[i]?.value||'',
          isCorrect: st[i].koOK && st[i].frOK,
          isCorrectKo: st[i].koOK, isCorrectFr: st[i].frOK,
          listenCount: st[i].listen, hint1Count: st[i].h1, hint2Count: st[i].h2,
          pronunciation: st[i].acc!=null?{accuracy:st[i].acc, transcript:st[i].trans}:null,
          recording: st[i].recBase64?{ base64:st[i].recBase64, filename:`dictee-${i+1}.webm`, mimeType:'audio/webm', duration:Math.round(st[i].recDur*100)/100 }:null
        }))
      };
      const r=await fetch('/.netlify/functions/send-results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||j.ok===false) alert('⚠️ 전송 실패 / Envoi échoué.');
      else alert('✅ 결과 전송 완료 / Résultats envoyés !');
    }catch(e){
      fetch('/.netlify/functions/log-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({functionName:'send-results(dictee)',error:String(e),pageUrl:location.href})});
    }
  });

  // ===== init =====
  window._startTime=new Date().toISOString();
  window._startMs=Date.now();
  document.addEventListener('DOMContentLoaded', () => {
    // 이름 게이트(필요 페이지에서만 동작)
    if (window.StudentGate){
      StudentGate.init();
      StudentGate.requireBeforeInteraction(document);
      StudentGate.applyRequiresNameState?.(document);
    }
    render();
  });
})();
