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
      pronunRequired:true, pronunAttempted
