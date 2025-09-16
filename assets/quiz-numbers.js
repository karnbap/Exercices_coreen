// assets/quiz-numbers.js
// Nombres 종합 퀴즈: 선택(5) → 불→한(10) → 받아쓰기(5)
// - 이름 체크, 상단 인쇄, Sticky 5×5, 힌트2(초성/부분뜻), 녹음 1회 시도→다음 활성화
// - 오디오 base64→Blob→URL 재생, 끝내기 시 결과 저장+전송

(function(){
  'use strict';

  const FN_BASE = (window.PONGDANG_FN_BASE || '/.netlify/functions');

  // ===== 상태 =====
  const S = {
    start: Date.now(),
    name: '',
    idx: 0,
    qs: [],
    audio: { el:null, url:null, btn:null, fetching:false, lock:false, ac:null },
  };

  // ===== 유틸 =====
  const $ = (s,r=document)=>r.querySelector(s);
  const strip = s => String(s||'').replace(/\s/g,'');
  const base64ToBlob = (b64, mime='audio/mpeg')=>{
    const clean = b64.includes(',') ? b64.split(',')[1] : b64;
    const bin = atob(clean); const arr = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    return new Blob([arr],{type:mime});
  };
  const fmtSecs = t => `${Math.max(0, Math.round(t/1000))} s`;

  // ===== 오디오 =====
  async function playAudio(text, voice='alloy', opts={}){
    const btn = opts._btn || null;
    if (S.audio.lock || S.audio.fetching) {
      // 같은 버튼이면 토글
      if (S.audio.el && S.audio.btn===btn){
        try{
          if (!S.audio.el.paused) { S.audio.el.pause(); markBtn(btn,false); }
          else { await S.audio.el.play(); markBtn(btn,true); }
        }catch(_){}
      }
      return;
    }
    S.audio.lock = true; setTimeout(()=>S.audio.lock=false, 220);

    try{
      // 기존 재생 정리
      cleanupAudio();

      // 요청
      S.audio.fetching = true;
      const ac = new AbortController(); S.audio.ac = ac;
      const res = await fetch(`${FN_BASE}/generate-audio`,{
        method:'POST',
        headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
        body: JSON.stringify({ text, voice, speed:(opts.speed??1.0) }),
        signal: ac.signal
      });
      if(!res.ok){ throw new Error(`TTS ${res.status}`); }
      const data = await res.json();

      let srcUrl = null;
      if(data.audioBase64 || data.audioContent){
        const blob = base64ToBlob(data.audioBase64||data.audioContent, data.mimeType||'audio/mpeg');
        srcUrl = URL.createObjectURL(blob);
      }else if(data.audioUrl){ srcUrl = data.audioUrl; }
      else { throw new Error('Invalid TTS response'); }

      const audio = new Audio(srcUrl);
      S.audio.el = audio; S.audio.url = srcUrl; S.audio.btn = btn;

      audio.addEventListener('playing', ()=> markBtn(btn,true));
      audio.addEventListener('pause',   ()=> markBtn(btn,false));
      audio.addEventListener('ended',   ()=> markBtn(btn,false));
      audio.addEventListener('error',   ()=> markBtn(btn,false));

      // 듣기 카운트
      const q = S.qs[S.idx]; if(q) q.listenCount = (q.listenCount||0)+1;

      await audio.play();
    }catch(e){
      console.error(e);
      alert('오디오 재생 오류가 발생했습니다. 다시 시도해 주세요.');
    }finally{
      S.audio.fetching = false;
    }
  }
  function stopAudio(){
    if(!S.audio.el) return;
    try { S.audio.el.pause(); S.audio.el.currentTime = 0; } catch(_){}
    markBtn(S.audio.btn,false);
  }
  function cleanupAudio(){
    try{ if(S.audio.el) S.audio.el.pause(); }catch(_){}
    if(S.audio.url){ URL.revokeObjectURL(S.audio.url); }
    S.audio = { el:null, url:null, btn:null, fetching:false, lock:false, ac:null };
  }
  function markBtn(btn, playing){
    if(!btn) return;
    btn.classList.toggle('playing', playing);
    btn.textContent = playing ? 'Pause (일시정지)' : 'Écouter (듣기)';
  }

  // ===== 문제 세트 =====
  function getQuestions(){
    // 1–5 선택(개념)
    const choiceData = [
      { context:"Pour la date '1일', on dit :", options:["일일","하나일"], answer:"일일", hints:{choseong:"ㅇㅇ", part:"date: ‘~일’ (Hanja)"} },
      { context:"Pour l'heure '1시', on dit :", options:["한 시","일 시"], answer:"한 시", hints:{choseong:"ㅎ ㅅ", part:"heure: natif + 시"} },
      { context:"Pour l'âge '3살', on dit :", options:["세 살","삼 살"], answer:"세 살", hints:{choseong:"ㅅ ㅅ", part:"âge: natif + 살"} },
      { context:"Pour l'argent '10 euro', on dit :", options:["십 유로","열 유로"], answer:"십 유로", hints:{choseong:"ㅅ ㅇㄹ", part:"argent: sino + 유로"} },
      { context:"Pour 30 minutes (30분), on dit :", options:["삼십 분","서른 분"], answer:"삼십 분", hints:{choseong:"ㅅㅅ ㅂ", part:"minutes: sino + 분"} },
    ];

    // 6–15 불→한 (듣고 한국어로)
    const frKo = [
      { fr:"Quelle heure est-il ?", audio:"몇 시예요?", frGuide:"Ex. Il est 3 h.", ko:"세 시예요.", accepted:["3시예요","세시예요","지금은 세 시예요.","세 시입니다."], voice:"alloy", hints:{choseong:"ㅅ ㅅㅇㅇ", part:"‘~시예요’(c’est ~h)"} },
      { fr:"Quel jour du mois ?", audio:"며칠이에요?", frGuide:"Ex. Le 10.", ko:"십일이에요.", accepted:["10일이에요","오늘은 십일이에요","오늘 십일이에요"], voice:"shimmer", hints:{choseong:"ㅅㅇㅇㅇ", part:"date: sino + 일"} },
      { fr:"Combien ça coûte ?", audio:"얼마예요?", frGuide:"Ex. 10 euros.", ko:"십 유로예요.", accepted:["10유로예요","십유로예요","열 유로예요"], voice:"alloy", hints:{choseong:"ㅅ ㅇㄹㅇㅇ", part:"prix: sino + 유로"} },
      { fr:"Combien de personnes ?", audio:"몇 명이에요?", frGuide:"Ex. Huit.", ko:"여덟 명이에요.", accepted:["8명이에요","여덟명이에요"], voice:"nova", hints:{choseong:"ㅇㄷ  ㅁㅇㅇㅇ", part:"compter personnes: natif + 명"} },
      { fr:"Combien de minutes ?", audio:"몇 분이에요?", frGuide:"Ex. 30.", ko:"삼십 분이에요.", accepted:["30분이에요","서른 분이에요"], voice:"echo", hints:{choseong:"ㅅㅅ ㅂㅇㅇㅇ", part:"minutes: sino + 분"} },

      { fr:"À quelle heure est le rendez-vous ?", audio:"약속이 몇 시예요?", frGuide:"Ex. 4 h.", ko:"네 시예요.", accepted:["4시예요","네시예요"], voice:"fable", hints:{choseong:"ㄴ ㅅㅇㅇ", part:"heure: natif + 시"} },
      { fr:"Quel jour du mois ?", audio:"며칠이에요?", frGuide:"Ex. 15.", ko:"십오일이에요.", accepted:["15일이에요"], voice:"alloy", hints:{choseong:"ㅅㅇㅇㅇㅇ", part:"date: sino + 일"} },
      { fr:"Combien ça coûte ?", audio:"얼마예요?", frGuide:"Ex. 12 euros.", ko:"십이 유로예요.", accepted:["12유로예요","십이유로예요"], voice:"shimmer", hints:{choseong:"ㅅㅇ ㅇㄹㅇㅇ", part:"prix: sino + 유로"} },
      { fr:"Combien de tasses de café ?", audio:"커피 몇 잔이에요?", frGuide:"Ex. Trois.", ko:"세 잔이에요.", accepted:["3잔이에요","세잔이에요"], voice:"alloy", hints:{choseong:"ㅅ  ㅈㅇㅇㅇ", part:"compter tasses: natif + 잔"} },
      { fr:"Combien de secondes ?", audio:"몇 초예요?", frGuide:"Ex. Dix secondes.", ko:"십 초예요.", accepted:["10초예요","십초예요"], voice:"nova", hints:{choseong:"ㅅ ㅊㅇㅇ", part:"secondes: sino + 초"} },
    ];

    // 16–20 받아쓰기
    const dictee = [
      { ko:"지금 몇 시예요?", fr:"Quelle heure est-il ?", guide:"Ex. Il est 3 h.", voice:"shimmer", hints:{choseong:"ㅈㄱ  ㅁ ㅅㅇㅇ?", part:"‘몇 시’ → heure"} },
      { ko:"오늘 며칠이에요?", fr:"Quel jour du mois est-on ?", guide:"Ex. Le 10.", voice:"nova", hints:{choseong:"ㅇㄴ  ㅁㅊㄹㅇㅇ?", part:"‘며칠’ → date (jour)"} },
      { ko:"얼마예요?", fr:"Combien ça coûte ?", guide:"Ex. 12 euros.", voice:"alloy", hints:{choseong:"ㅇㄹㅁ ㅇㅇ?", part:"prix"} },
      { ko:"몇 명이에요?", fr:"Combien de personnes ?", guide:"Ex. Huit.", voice:"echo", hints:{choseong:"ㅁ  ㅁㅇㅇㅇ?", part:"compter personnes"} },
      { ko:"지금 몇 시 몇 분이에요?", fr:"Quelle heure et quelle minute est-il ?", guide:"Ex. 2 h 30.", voice:"fable", hints:{choseong:"ㅈㄱ  ㅁ ㅅ  ㅁ ㅂㄴㅇㅇ?", part:"heure + minutes"} },
    ];

    const choice = choiceData.map((q,i)=>({
      number:i+1, type:'choice', context:q.context, options:q.options, answer:q.answer,
      hints:q.hints, userAnswer:null, isCorrect:null,
      listenCount:0, hint1Count:0, hint2Count:0,
      pronunRequired:true, pronunAttempted:false
    }));

    const fr_prompt_ko = frKo.map((q,i)=>({
      number: choice.length + i + 1, type:'fr_prompt_ko',
      fr:q.fr, audioText:q.audio, frGuide:q.frGuide, ko:q.ko,
      accepted:q.accepted||[], voice:q.voice||'alloy', hints:q.hints,
      userAnswer:"", textChecked:false, textCorrect:null, isCorrect:null,
      listenCount:0, hint1Count:0, hint2Count:0,
      pronunRequired:true, pronunAttempted:false
    }));

    const dictation = dictee.map((q,i)=>({
      number: choice.length + fr_prompt_ko.length + i + 1, type:'dictation',
      ko:q.ko, fr:q.fr, frAnswerGuide:q.guide, voice:q.voice, hints:q.hints,
      userAnswer:{ko:"", replyKo:""}, isCorrect:null,
      listenCount:0, hint1Count:0, hint2Count:0,
      pronunRequired:true, pronunAttempted:false
    }));

    return [...choice, ...fr_prompt_ko, ...dictation];
  }

  // ===== 렌더 =====
  function render(){
    const q = S.qs[S.idx]; if(!q) return;
    // Sticky 5×5: Q6부터
    $('#sticky55').classList.toggle('hidden', q.number < 6);

    $('#progressText').textContent = `Question ${q.number} / ${S.qs.length}`;
    $('#progressBar').style.width = `${Math.round((S.idx / S.qs.length)*100)}%`;

    const badge = `<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-800 text-white">${label(q.type)}</span>`;
    let html = `<div class="flex items-center gap-2 mb-1">${badge}<span class="text-sm text-slate-500">Q${q.number}/${S.qs.length}</span></div>`;

    if(q.type==='choice'){
      html += `<h2 class="text-lg font-semibold mb-1">${q.context}</h2>`;
      html += `<p class="text-sm text-slate-600 mb-2">Choisissez la bonne réponse. / 알맞은 답을 고르세요.</p>`;
      q.options.forEach(opt=>{
        const isSel = (q.userAnswer===opt);
        html += `<button class="choice-btn ${isSel?'selected':''}" onclick="Quiz.selectChoice('${safe(opt)}')">${opt}</button>`;
      });
      // 정답 선택 시 발음 위젯 + 힌트
      if (q.userAnswer === q.answer) {
        html += hintBox(q);
        html += pronunBox(q, q.answer);
      }
    }

    if(q.type==='fr_prompt_ko'){
      html += `<h2 class="text-lg font-semibold mb-1">${q.fr}</h2>`;
      html += `
        <div class="flex gap-2 mb-2">
          <button class="btn btn-primary flex-1" onclick="Quiz.playAudio('${safe(q.audioText)}','${q.voice}',{_btn:this})">Écouter (듣기)</button>
          <button class="btn" onclick="Quiz.stopAudio()">■ Stop</button>
        </div>
        <div class="p-3 bg-white rounded border mb-3 text-sm text-slate-700">
          <span class="font-medium">Guide (FR)</span> : ${q.frGuide}
        </div>
        function hintBoxHTML(q){
          // 1~5번(개념 선택)은 힌트 숨김
          if (q.number <= 5) return '';
          return `
            <div class="flex flex-wrap gap-2 items-center mb-2">
              <button class="btn btn-outline" onclick="Quiz.showHint(1)">🙏 Aidez-moi (힌트1: 초성)</button>
              <button class="btn btn-outline" onclick="Quiz.showHint(2)">🦺 Au secours (힌트2: 부분뜻)</button>
              <span class="text-xs text-slate-500">H1: ${q.hint1Count||0} · H2: ${q.hint2Count||0}</span>
            </div>
            <div id="hintArea" class="text-sm text-slate-700"></div>
          `;
        }

      if(q.textChecked){
        const ok = q.textCorrect===true;
        html += `<div class="mt-3 ${ok?'text-emerald-700':'text-rose-700'} font-semibold">
          ${ok?'✅ Correct ! 맞았습니다!':'❌ Incorrect. 틀렸습니다.'}
          ${ok?'':` <span class="ml-2 text-slate-700">Réponse (KO) / 정답: <b>${q.ko}</b></span>`}
        </div>`;
        html += pronunBox(q, q.ko);
      }
    }

    if(q.type==='dictation'){
      html += `<h2 class="text-lg font-semibold mb-1">Dictée + Réponse / 받아쓰기 + 대답</h2>`;
      html += `
        <div class="flex gap-2 mb-2">
          <button class="btn btn-primary flex-1" onclick="Quiz.playAudio('${safe(q.ko)}','${q.voice}',{_btn:this})">Écouter (듣기)</button>
          <button class="btn" onclick="Quiz.stopAudio()">■ Stop</button>
        </div>
        <div class="space-y-3">
          ${hintBox(q)}
          <div>
            <label class="block mb-1 font-semibold">1) Dictée (받아쓰기)</label>
            <input class="input-field" value="${q.userAnswer.ko||''}" placeholder="(Écoutez et écrivez tel quel / 그대로 적기)" oninput="Quiz.updateDictee('ko',this.value)">
          </div>
          <div>
            <label class="block mb-1 font-semibold">2) Réponse (한국어 대답)</label>
            <input class="input-field input-reply-ko" value="${q.userAnswer.replyKo||''}" placeholder="Ex. 네 시예요 / 10유로예요 …" oninput="Quiz.updateDictee('replyKo',this.value)">
            <div class="text-xs text-slate-500 mt-1">Ex (FR) : ${q.frAnswerGuide||''}</div>
          </div>
          ${pronunBox(q, '(2) votre réponse / 당신의 대답')}
        </div>`;
    }

    $('#qArea').innerHTML = html;
    updateNav();

    // Pronun 위젯 mount
    const mount = $('#pronunMount');
    if(mount && window.Pronun){
      try{
        const markAttempt = ()=>{ q.pronunAttempted = true; updateNav(); };
        setTimeout(()=>{
          mount.querySelectorAll('button')?.forEach(b=>{
            const t=(b.textContent||'');
            if(t.includes('Stop')||t.includes('정지')) b.addEventListener('click', markAttempt);
          });
        },50);
        Pronun.mount(mount, {
          getReferenceText: ()=> refTextResolver(q),
          onResult: ()=>{ q.pronunAttempted = true; updateNav(); }
        });
      }catch(e){ console.warn('Pronun.mount', e); }
    }
  }

  function label(t){
    return (t==='choice'?'Choix / 선택': t==='fr_prompt_ko'?'Français → 한국어 / 불→한':'Dictée + Réponse / 받아쓰기 + 대답');
  }
  function safe(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,'&#39;').replace(/"/g,'&quot;').replace(/\n/g,' '); }
  function hintBox(q){
    return `
      <div class="flex flex-wrap gap-2 items-center mb-2">
        <button class="btn btn-outline" onclick="Quiz.showHint(1)">🙏 Aidez-moi (힌트1: 초성)</button>
        <button class="btn btn-outline" onclick="Quiz.showHint(2)">🦺 Au secours (힌트2: 부분뜻)</button>
        <span class="text-xs text-slate-500">H1: ${q.hint1Count||0} · H2: ${q.hint2Count||0}</span>
      </div>
      <div id="hintArea" class="text-sm text-slate-700"></div>
    `;
  }
  function pronunBox(q, ref){
    return `
      <div class="pronun-card mt-3">
        <div class="pronun-title">🎤 Enregistrer & tester / 녹음·발음 평가</div>
        <div class="text-xs text-slate-600 mb-1">Référence (KO): <span class="font-semibold">${ref}</span></div>
        <div id="pronunMount"></div>
      </div>
    `;
  }
  function refTextResolver(q){
    if(q.type==='choice') return q.answer;
    if(q.type==='fr_prompt_ko') return q.ko;
    if(q.type==='dictation') return ($('.input-reply-ko')?.value||'');
    return '';
  }

  // ===== 상호작용 =====
  function selectChoice(val){
    const q=S.qs[S.idx];
    q.userAnswer=val;
    q.isCorrect = (val===q.answer);
    if(!q.isCorrect){ q.pronunAttempted=false; } // 오답이면 녹음 다시
    render();
  }
  function onTextInput(v){
    const q=S.qs[S.idx];
    q.userAnswer=v;
    q.textChecked=false; q.textCorrect=null; q.pronunAttempted=false;
    updateNav();
  }
  function checkText(){
    const q=S.qs[S.idx];
    if(q.type!=='fr_prompt_ko') return;
    const v = (q.userAnswer||'').trim();
    if(!v) return;
    const cands = [q.ko, ...(q.accepted||[])];
    q.textCorrect = cands.some(ans=> strip(v)===strip(ans));
    q.textChecked = true;
    q.isCorrect = q.textCorrect;
    q.pronunAttempted=false;
    render();
  }
  function updateDictee(part,val){
    const q=S.qs[S.idx];
    q.userAnswer[part]=val;
    updateNav();
  }
  function showHint(n){
    const q=S.qs[S.idx]; if(!q||!q.hints) return;
    if(n===1){ q.hint1Count=(q.hint1Count||0)+1; $('#hintArea').textContent = `초성: ${q.hints.choseong||'-'}`; }
    else     { q.hint2Count=(q.hint2Count||0)+1; $('#hintArea').textContent = `Indice (FR): ${q.hints.part||'-'}`; }
    updateNav();
  }

  // 다음 버튼 허용: “녹음 1회 시도” 규칙 포함
  function isNextAllowed(){
    const q=S.qs[S.idx]; if(!q) return false;
    if(q.pronunRequired && !q.pronunAttempted) return false;

    if(q.type==='choice'){
      return !!q.userAnswer;
    }else if(q.type==='fr_prompt_ko'){
      return !!q.userAnswer && q.textChecked===true;
    }else if(q.type==='dictation'){
      return !!q.userAnswer.ko && !!q.userAnswer.replyKo;
    }
    return false;
  }
  function updateNav(){
    $('#btnPrev').disabled = (S.idx<=0);
    const canNext = isNextAllowed();
    $('#btnNext').disabled = !canNext;
    const isLast = (S.idx===S.qs.length-1);
    $('#btnFinish').classList.toggle('hidden', !isLast);
    $('#btnFinish').disabled = false; // 마지막 문제에서 항상 누를 수 있게
  }

  // ===== 제출/저장 =====
  async function finish(){
    const end = Date.now();
    const name = $('#studentName').value?.trim() || 'Élève';
    const payload = {
      studentName: name,
      startTime: new Date(S.start).toISOString(),
      endTime: new Date(end).toISOString(),
      totalTimeSeconds: Math.round((end - S.start)/1000),
      questions: S.qs.map(q=>({
        number:q.number,
        ko: q.type==='fr_prompt_ko' ? q.ko : (q.type==='dictation'? q.ko : q.context),
        fr: q.type==='fr_prompt_ko' ? q.fr : (q.type==='dictation'? q.fr : ''),
        userAnswer: q.type==='dictation' ? JSON.stringify(q.userAnswer) : (q.userAnswer||''),
        isCorrect: !!q.isCorrect,
        listenCount: q.listenCount||0,
        hint1Count: q.hint1Count||0,
        hint2Count: q.hint2Count||0
      }))
    };

    // 로컬 저장 + 전송
    localStorage.setItem('pongdang:lastResults', JSON.stringify(payload));
    try{
      await SendResults.sendResults(payload);
      alert('Résultats envoyés / 결과 전송 완료');
      // 간단 결과 표시
      $('#finalRow').textContent = `Score final : — · Temps total : ${fmtSecs(end - S.start)}`;
    }catch(e){
      alert('Envoi échoué. / 전송 실패');
    }
  }

  // ===== 네임게이트 & 초기화 =====
  function requireName(){
    const v = $('#studentName').value?.trim();
    if(!v){ alert('이름을 먼저 입력해 주세요. / Écris ton nom d’abord.'); return false; }
    S.name = v; return true;
  }

  // ===== 이벤트 바인딩 =====
  $('#btnPrev').addEventListener('click', ()=>{ if(S.idx>0){ S.idx--; render(); } });
  $('#btnNext').addEventListener('click', ()=>{ if(!requireName()) return; if(isNextAllowed() && S.idx<S.qs.length-1){ S.idx++; render(); } });
  $('#btnFinish').addEventListener('click', ()=>{ if(!requireName()) return; finish(); });
  $('#btnFinish2').addEventListener('click', ()=>{ if(!requireName()) return; finish(); });
  window.addEventListener('beforeunload', cleanupAudio);

  // 시작
  S.qs = getQuestions();
  render();

  // 외부에서 쓰는 함수 export
  window.Quiz = {
    playAudio, stopAudio,
    selectChoice, onTextInput, checkText, updateDictee, showHint
  };
})();
