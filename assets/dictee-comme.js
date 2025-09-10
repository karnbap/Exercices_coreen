/* Dictée “Comme en coréen” — 페이지 전용 JS (재사용 가능)
   - TTS: /.netlify/functions/generate-audio
   - 결과 전송: /.netlify/functions/send-results
   - 발음: Pronun.mount (pronun-*.js)
   - 실시간 STT: LiveSTT.mount / attach
*/
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // StudentGate 초기화
  (window.StudentGate || { init(){}, requireBeforeInteraction(){}, getName(){return''}, setName(){} }).init();
  StudentGate.requireBeforeInteraction(document);

  const $name = $('#student-name');
  const syncName = () => { if ($name) $name.value = StudentGate.getName() || ''; };
  document.addEventListener('student-ready', syncName);

  if ($name) {
    $name.addEventListener('change', (e) => {
      const v = String(e.target.value || '').trim();
      if (v) StudentGate.setName(v);
    });
  }

  const SAFE_VOICES = ['alloy','shimmer','verse','nova','fable','echo'];
  const vAt = (i) => SAFE_VOICES[i % SAFE_VOICES.length];

  // 문제 세트
  const exercises = [
    { sentence:"혜진이는 천사 같아요.",         translation:"Hyejin est comme un ange.",                              hint1:"ㅎㅈㅇㄴ ㅊㅅ ㄱㅇㅇ", hint2:"천사=ange",          voice:vAt(0)},
    { sentence:"오늘 이 소식은 꿈 같아요.",       translation:"Cette nouvelle d'aujourd'hui est comme un rêve.",       hint1:"ㅇㄴ ㅇ ㅅㅅㅇ ㄲ ㄱㅇㅇ", hint2:"꿈=rêve",           voice:vAt(1)},
    { sentence:"민수의 친구는 가족 같아요.",     translation:"L'ami de Minsu est comme de la famille.",               hint1:"ㅁㅅㅇ ㅊㄱㄴ ㄱㅈ ㄱㅇㅇ", hint2:"가족=famille",     voice:vAt(2)},
    { sentence:"우리 아빠 마음은 바다처럼 넓어요.", translation:"Le cœur de mon père est large comme la mer.",          hint1:"ㅇㄹ ㅇㅃ ㅁㅇㅇ ㅂㄷㅊㄹ ㄴㄹㅇㅇ", hint2:"바다=mer", voice:vAt(3)},
    { sentence:"그 친구는 소처럼 많이 먹어요.",    translation:"Cet(te) ami(e) mange beaucoup, comme une vache.",      hint1:"ㄱ ㅊㄱㄴ ㅅㅊㄹ ㅁㅇ ㅁㅇㅇ", hint2:"소=vache",       voice:vAt(4)},
    { sentence:"저 남자는 바람처럼 달려요.",       translation:"Cet homme court comme le vent.",                       hint1:"ㅈ ㄴㅈㄴ ㅂㄹㅊㄹ ㄷㄹㅇ", hint2:"바람=vent",        voice:vAt(5)},
    { sentence:"민지는 가수처럼 노래를 잘해요.",    translation:"Minji chante bien comme une chanteuse.",               hint1:"ㅁㅈㄴ ㄱㅅㅊㄹ ㄴㄹㄹ ㅈㅎㅇ", hint2:"가수=chanteur", voice:vAt(0)},
    { sentence:"준호는 로봇처럼 걸어요.",          translation:"Junho marche comme un robot.",                         hint1:"ㅈㅎㄴ ㄹㅂㅊㄹ ㄱㄹㅇ", hint2:"로봇=robot",        voice:vAt(1)},
    { sentence:"저는 친구랑 같이 갔어요.",         translation:"Je suis allé(e) avec mon ami(e).",                     hint1:"ㅈㄴ ㅊㄱㄹ ㄱㅊ  ㄱㅆㅇㅇ", hint2:"같이=ensemble", voice:vAt(2)},
    { sentence:"그 아이는 별처럼 춤을 춰요.",      translation:"Cet enfant danse comme une étoile.",                   hint1:"ㄱ ㅇㅇㄴ ㅂㅊㄹ ㅊㅇ ㅊㅇ", hint2:"별=étoile",      voice:vAt(3)},
    { sentence:"오늘은 어제 같아요.",              translation:"Aujourd'hui est comme hier.",                          hint1:"ㅇㄴㅇ ㅇㅈ ㄱㅇㅇ", hint2:"어제=hier",           voice:vAt(4)},
    { sentence:"그 사람은 배우 같아요.",           translation:"Cette personne est comme un(e) acteur/actrice.",       hint1:"ㄱ ㅅㄹㅇ ㅂㅇ ㄱㅇㅇ", hint2:"배우=acteur",       voice:vAt(5)},
    { sentence:"제 손은 얼음 같아요.",             translation:"Ma main est comme de la glace (froide).",              hint1:"ㅈ ㅅㅇ ㅇㅇ ㄱㅇㅇ", hint2:"얼음=glace",         voice:vAt(0)},
    { sentence:"그 가수의 목소리는 설탕 같아요.",   translation:"La voix de ce chanteur est douce comme le sucre.",     hint1:"ㄱ ㄱㅅㅇ ㅁㅅㄹㄴ ㅅㅌ ㄱㅇㅇ", hint2:"설탕=sucre",   voice:vAt(1)},
    { sentence:"그 아이는 인형 같아요.",           translation:"Cet enfant est comme une poupée.",                     hint1:"ㄱ ㅇㅇㄴ ㅇㅎ ㄱㅇㅇ", hint2:"인형=poupée",       voice:vAt(2)},
    { sentence:"그 사람은 물처럼 돈을 써요.",       translation:"Cette personne dépense de l'argent comme de l'eau.",   hint1:"ㄱ ㅅㄹㅇ ㅁㅊㄹ ㄷㄴ ㅆㅇ", hint2:"물=eau",        voice:vAt(3)},
    { sentence:"그 친구는 거북이처럼 느려요.",      translation:"Cet(te) ami(e) est lent(e) comme une tortue.",         hint1:"ㄱ ㅊㄱㄴ ㄱㅂㅇㅊㄹ ㄴㄹㅇ", hint2:"거북이=tortue",  voice:vAt(4)},
    { sentence:"민수는 전문가처럼 말해요.",         translation:"Minsu parle comme un expert.",                          hint1:"ㅁㅅㄴ ㅈㅁㄱㅊㄹ ㅁㅎㅇ", hint2:"전문가=expert",   voice:vAt(5)},
    { sentence:"우리 아기는 아기처럼 잘 자요.",     translation:"Notre bébé dort comme un bébé.",                        hint1:"ㅇㄹ ㅇㄱㄴ ㅇㄱㅊㄹ ㅈ  ㅈㅇ", hint2:"아기=bébé",  voice:vAt(0)},
    { sentence:"그 남자는 영화배우처럼 잘생겼어요.", translation:"Cet homme est beau comme un acteur de cinéma.",       hint1:"ㄱ ㄴㅈㄴ ㅇㅎㅂㅇㅊㄹ ㅈㅅㄱㅆㅇㅇ", hint2:"영화배우=acteur", voice:vAt(1)}
  ];

  // 상태
  const exState = exercises.map(() => ({
    listenCount:0, hint1Count:0, hint2Count:0, attempts:0,
    koCorrect:false, frCorrect:false, pronunciation:null
  }));

  function escapeHtml(s=''){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function base64ToBlob(base64, mime="audio/wav"){
    const bin = atob(base64); const len = bin.length; const bytes = new Uint8Array(len);
    for(let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], {type:mime});
  }

  const audioCache = new Map();
  async function playAudio(text, voice, btn, idx){
    try{
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      const key = `${voice}|${text}`;
      const playBlob = async (blob) => {
        const url = URL.createObjectURL(blob);
        const a = new Audio(); a.preload='auto'; a.src=url;
        await new Promise(res => a.addEventListener('canplaythrough', res, { once:true }));
        a.addEventListener('ended', () => URL.revokeObjectURL(url), { once:true });
        exState[idx].listenCount++;
        await a.play();
      };
      if (audioCache.has(key)) return playBlob(audioCache.get(key));
      const res = await fetch('/.netlify/functions/generate-audio', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ text, voice })
      });
      if(!res.ok) throw new Error('TTS '+res.status);
      const { audioData, mimeType } = await res.json();
      const blob = base64ToBlob(audioData, mimeType||'audio/wav');
      audioCache.set(key, blob);
      await playBlob(blob);
    }catch(e){
      console.error(e); alert('Problème audio. Réessaie.');
      fetch('/.netlify/functions/log-error',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ functionName:'getAudio', error:String(e), pageUrl:location.href })}).catch(()=>{});
    }finally{
      btn.disabled=false; btn.textContent='🔊';
    }
  }

  function styleHint(raw){
    const hasJeoneun=/(저는|전)/.test(raw), hasNaneun=/(나는|난)/.test(raw);
    const politeEnd=/(요|니다)[\s.]*$/.test(raw);
    if(hasJeoneun && !politeEnd) return "“저는/전”을 썼으면 문장 끝을 -요/-(스)ㅂ니다로.";
    if(hasNaneun && politeEnd)  return "“나는/난”을 썼으면 반말(-아/어)로 끝내요.";
    return '';
  }

  function gradeBoth(index){
    if(!window.AnswerJudge){ alert('채점 모듈 로딩 실패'); return; }
    const card=$$('.dictation-card')[index];
    const koInput=card.querySelector('.input-ko');
    const frInput=card.querySelector('.input-fr');
    const feedback=card.querySelector('.feedback-display');
    const rawKO=koInput.value||'', rawFR=frInput.value||'';
    const koRes=AnswerJudge.gradeKO(exercises[index].sentence, rawKO, { allowSubstring:false });
    const frRes=AnswerJudge.gradeFR(exercises[index].translation, rawFR);
    exState[index].attempts++; exState[index].koCorrect=koRes.isCorrect; exState[index].frCorrect=frRes.isCorrect;

    const romanWarn=/[A-Za-z]/.test(rawKO) ? "한글 발음 표기 로마자는 쓰지 마세요.(ga, teun 등)" : "";
    const styleMsg=styleHint(rawKO);
    const tags=[]; if(romanWarn) tags.push(`⚠️ ${romanWarn}`); if(styleMsg) tags.push(`💡 ${styleMsg}`);
    if(koRes.note) tags.push(`KO: ${koRes.note}`); if(frRes.note) tags.push(`FR: ${frRes.note}`);
    const koPill=koRes.isCorrect?`<span class="pill pill-green">KO ✓</span>`:`<span class="pill pill-red">KO ✗</span>`;
    const frPill=frRes.isCorrect?`<span class="pill pill-green">FR ✓</span>`:`<span class="pill pill-red">FR ✗</span>`;
    const ok=koRes.isCorrect && frRes.isCorrect;

    feedback.innerHTML = ok ? `
      <div class="feedback correct">
        <strong class="text-lg">🎉 Super ! 잘했어요!</strong>
        <div class="mt-1 flex gap-2">${koPill}${frPill}</div>
        <p class="korean-font mt-1"><strong>정답(한):</strong> ${exercises[index].sentence}</p>
        <p><strong>Traduction (FR):</strong> ${exercises[index].translation}</p>
        ${tags.length?`<p class="small-muted mt-1">${tags.join(' · ')}</p>`:''}
      </div>
    ` : `
      <div class="feedback incorrect">
        <strong class="text-lg">👍 거의 맞았어요! 한 번만 더! / Presque réussi·e ! Réessaie 😉</strong>
        <div class="mt-1 flex gap-2">${koPill}${frPill}</div>
        <p class="korean-font mt-1"><strong>내 답(한):</strong> ${escapeHtml(rawKO)}</p>
        <p><strong>Ma réponse (FR):</strong> ${escapeHtml(rawFR)}</p>
        <p class="korean-font"><strong>정답(한):</strong> ${exercises[index].sentence}</p>
        <p><strong>Traduction (FR):</strong> ${exercises[index].translation}</p>
        ${tags.length?`<p class="small-muted mt-1">${tags.join(' · ')}</p>`:''}
      </div>`;
  }

  function renderExercises(){
    const $wrap = $('#dictation-exercises');
    $wrap.innerHTML='';
    exercises.forEach((ex,i)=>{
      const el=document.createElement('div'); el.className='dictation-card';
      el.innerHTML=`
        <div class="flex items-center gap-4">
          <span class="text-2xl font-bold text-indigo-500">${i+1}</span>
          <button type="button" class="btn btn-primary play-btn" data-voice="${ex.voice}" data-text="${ex.sentence}" aria-label="Lire l'audio ${i+1}">🔊</button>
          <div class="text-sm text-slate-500">Écouter / 듣기 → KO(한글) → FR(불어) → 🎙️녹음</div>
        </div>
        <div class="mt-3 ml-12 grid gap-3">
          <input type="text" class="input-ko korean-font text-lg p-2 border-2 border-slate-300 rounded-lg w-full focus:border-indigo-500" placeholder="Écrivez ici (한글로)"/>
          <input type="text" class="input-fr text-lg p-2 border-2 border-slate-300 rounded-lg w-full focus:border-indigo-500" placeholder="Traduction en français / 불어로 번역"/>
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-hint hint1-btn">🙏 Aidez-moi (초성)</button>
            <button type="button" class="btn btn-hint hint2-btn">🦺 Au secours (단어)</button>
            <button type="button" class="btn btn-secondary check-btn">Vérifier (정답 확인)</button>
          </div>
          <div class="hint-display"></div>
          <div class="feedback-display"></div>

          <div class="mt-1 flex gap-2 items-center">
            <button type="button" class="btn btn-secondary btn-rec">🎙️ Enregistrer / 녹음</button>
            <button type="button" class="btn btn-secondary btn-stop" disabled>⏹️ Stop</button>
            <span class="small-muted">정지하면 자동 평가돼요.</span>
          </div>
          <canvas class="vu"></canvas>
          <div class="pronun-live mt-2 text-sm p-2 rounded border bg-white"></div>
          <div class="pronun-display small-muted"></div>
        </div>`;
      $wrap.appendChild(el);
    });

    $$('.play-btn').forEach((btn,i)=>{
      btn.addEventListener('click', e=>{
        const b=e.currentTarget; playAudio(b.dataset.text, b.dataset.voice, b, i);
      });
    });

    $$('.hint1-btn').forEach((btn,i)=>btn.addEventListener('click',()=>{
      $$('.hint-display')[i].innerHTML =
        `<p class="text-sm text-amber-700 korean-font"><strong>🙏 Aidez-moi (초성):</strong> ${exercises[i].hint1}</p>`;
      exState[i].hint1Count++; btn.disabled=true;
    }));
    $$('.hint2-btn').forEach((btn,i)=>btn.addEventListener('click',()=>{
      const box=$$('.hint-display')[i];
      const prev=box.querySelector('p')?.outerHTML || '';
      box.innerHTML = prev + `<p class="text-sm text-amber-700 korean-font mt-1"><strong>🦺 Au secours (단어):</strong> ${exercises[i].hint2}</p>`;
      exState[i].hint2Count++; btn.disabled=true;
    }));
    $$('.check-btn').forEach((btn,i)=>btn.addEventListener('click',()=>gradeBoth(i)));
    $$('.input-ko,.input-fr').forEach((inp,i)=>inp.addEventListener('keydown',e=>{ if(e.key==='Enter') gradeBoth(i); }));

    // 발음 채점 연결
    if (window.Pronun && typeof Pronun.mount === 'function') {
      $$('.dictation-card').forEach((cardEl, i) => {
        Pronun.mount(cardEl, {
          getReferenceText: ()=>exercises[i].sentence.replace(/\s+/g,''),
          isKoCorrect: ()=>exState[i].koCorrect,
          onResult: ({ accuracy, transcript, friendly }) => {
            exState[i].pronunciation = { accuracy, transcript: transcript||'', friendly: friendly||[] };
          }
        });
      });
    }

    // ✅ 실시간 STT 연결
    if (window.LiveSTT) {
      $$('.dictation-card').forEach((cardEl) => {
        const api = window.LiveSTT;
        const opts = {
          root: cardEl,
          startSel: '.btn-rec',
          stopSel:  '.btn-stop',
          outSel:   '.pronun-live',
          lang:     'ko-KR'
        };
        if (typeof api.mount === 'function')      api.mount(opts);
        else if (typeof api.attach === 'function') api.attach(opts);
      });
    }
  }

  $('#restart-btn')?.addEventListener('click',()=>{
    $$('.input-ko,.input-fr').forEach(i=>i.value='');
    $$('.hint-display,.feedback-display,.pronun-display').forEach(d=>d.innerHTML='');
    $$('.btn-hint').forEach(b=>b.disabled=false);
    exState.forEach(s=>Object.assign(s,{listenCount:0,hint1Count:0,hint2Count:0,attempts:0,koCorrect:false,frCorrect:false,pronunciation:null}));
  });

  $('#finish-btn')?.addEventListener('click', async ()=>{
    const name=(StudentGate?.getName?.()||$('#student-name')?.value||'').trim()||'N/A';
    const totalQ=exercises.length;
    const koCorrectCount=exState.filter(s=>s.koCorrect).length;
    const frCorrectCount=exState.filter(s=>s.frCorrect).length;
    const koScore=Math.round((koCorrectCount/Math.max(1,totalQ))*100);
    const frScore=Math.round((frCorrectCount/Math.max(1,totalQ))*100);
    const pronItems=exState.map(s=>s.pronunciation?.accuracy).filter(x=>typeof x==='number'&&isFinite(x));
    const pronScore=Math.round((pronItems.reduce((a,b)=>a+b,0)/Math.max(1,pronItems.length))*100);
    const overall=Math.round((koScore+frScore)/2);
    const gm=(window.Grading?.getGradingMessage)?window.Grading.getGradingMessage(overall):null;

    alert(`${gm ? gm.emoji+' '+gm.fr+' / '+gm.ko+'\n' : ''}`
      + `총점: ${overall}/100 (KO+FR)\n한글 받아쓰기: ${koScore}/100\n불어 번역: ${frScore}/100\n발음: ${isFinite(pronScore)?pronScore:0}/100`);

    try{
      const payload = {
        studentName:name,
        startTime: window._startTime || new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalTimeSeconds: Math.round(((Date.now())-(window._startMs||Date.now()))/1000),
        assignmentTitle:"Dictée – Comme en coréen",
        assignmentTopic:"같아요 / 같은 / 처럼 / 같이",
        assignmentSummary:["Nom + 처럼/같이","~와/과 같다","동사 + 처럼/같이"],
        gradingMessage:gm,
        categoryScores:{ ko:koScore, fr:frScore, pron:pronScore, overall },
        questions: exercises.map((ex,i)=>{
          const card=$$('.dictation-card')[i];
          return {
            number:i+1, ko:ex.sentence, fr:ex.translation,
            userAnswer: card.querySelector('.input-ko').value||'',
            userAnswerFr: card.querySelector('.input-fr').value||'',
            isCorrect: exState[i].koCorrect && exState[i].frCorrect,
            isCorrectKo: exState[i].koCorrect, isCorrectFr: exState[i].frCorrect,
            listenCount: exState[i].listenCount, hint1Count: exState[i].hint1Count, hint2Count: exState[i].hint2Count,
            pronunciation: exState[i].pronunciation || null,
            recording: null
          };
        })
      };
      const resp=await fetch('/.netlify/functions/send-results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const j=await resp.json().catch(()=>({}));
      if(!resp.ok||j.ok===false){
        alert("⚠️ 전송 실패 / Envoi échoué.");
        fetch('/.netlify/functions/log-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({functionName:'send-results',error:`HTTP ${resp.status} ${resp.statusText} | ${JSON.stringify(j)}`,pageUrl:location.href})});
      }else{
        alert("✅ 결과가 메일로 전송됐어요 ! / Résultats envoyés par e-mail !");
      }
    }catch(err){
      fetch('/.netlify/functions/log-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({functionName:'finish-send-results',error:String(err),pageUrl:location.href})});
    }
  });

  // 시작 타임 기록 + 렌더
  window._startTime=new Date().toISOString(); window._startMs=Date.now();
  document.addEventListener('DOMContentLoaded', renderExercises);
})();
