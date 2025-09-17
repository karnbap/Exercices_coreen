/* /assets/quiz-numbers.js (final)
 * Nombres 종합 퀴즈: 선택(5) → 불→한(10) → 받아쓰기(5)
 * - 이름 체크, Sticky 5×5, 힌트(1~5 숨김), 오답 흔들림
 * - 발음 녹음/평가(warmup UI), 오디오 base64→Blob→URL (Blob URL로 안정 재생)
 * - 규칙: 발음 녹음 먼저. (모든 문항: 발음 2회 평가했으면 다음 문제로 고고)
 * - Q1에서 ← 누르면 numbers-warmup.html로 이동
 * - 끝내기: 결과 전송 + 요약 화면 표시 + 문항별 발음 테이블
 * - 학생 화면엔 H1/H2(힌트 카운트) 숨김: <span class="hint-metrics">…</span> (CSS에서 display:none)
 *   ※ 선생님 메일에는 카운트 포함(전송 데이터 유지)
 */

(function () {
  'use strict';

  const FN_BASE = (window.PONGDANG_FN_BASE || '/.netlify/functions');

  const S = {
    start: Date.now(),
    name: '',
    idx: 0,
    qs: [],
    audio: { el: null, url: null, btn: null, fetching: false, lock: false, ac: null },
  };

  // ===== Utils =====
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const strip = s => String(s || '').replace(/\s/g, '');
  // 한글 비교용(공백/구두점/라틴문자 제거 + 소문자화)
  const norm = s => String(s || '')
    .toLowerCase()
    .replace(/[.,!?…·/\\_\-:;'"(){}\[\]`~]/g, '')
    .replace(/\s+/g, '')
    .replace(/[a-z]/gi, ''); // 라틴 문자 삭제(ga teun 등 금지 규칙)

  const esc = s => String(s || '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const base64ToBlob = (b64, mime = 'audio/mpeg') => {
    const clean = b64.includes(',') ? b64.split(',')[1] : b64;
    const bin = atob(clean); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };

  // ===== Audio (TTS) =====
  async function playAudio(text, voice = 'alloy', opts = {}) {
    const btn = opts._btn || null;
    if (S.audio.lock || S.audio.fetching) {
      if (S.audio.el && S.audio.btn === btn) {
        try {
          if (!S.audio.el.paused) { S.audio.el.pause(); markBtn(btn, false); }
          else { await S.audio.el.play(); markBtn(btn, true); }
        } catch (_) {}
      }
      return;
    }
    S.audio.lock = true; setTimeout(() => S.audio.lock = false, 220);

    try {
      cleanupAudio();
      S.audio.fetching = true;
      const ac = new AbortController(); S.audio.ac = ac;
      const res = await fetch(`${FN_BASE}/generate-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ text, voice, speed: (opts.speed ?? 1.0) }),
        signal: ac.signal
      });
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      const data = await res.json();

      let srcUrl = null;
      if (data.audioBase64 || data.audioContent) {
        const blob = base64ToBlob(data.audioBase64 || data.audioContent, data.mimeType || 'audio/mpeg');
        srcUrl = URL.createObjectURL(blob);
      } else if (data.audioUrl) { srcUrl = data.audioUrl; }
      else { throw new Error('Invalid TTS response'); }

      const audio = new Audio(srcUrl);
      S.audio.el = audio; S.audio.url = srcUrl; S.audio.btn = btn;

      audio.addEventListener('playing', () => markBtn(btn, true));
      audio.addEventListener('pause', () => markBtn(btn, false));
      audio.addEventListener('ended', () => {   markBtn(btn, false);   try { if (S.audio?.url) URL.revokeObjectURL(S.audio.url); } catch (_) {}   S.audio = { el: null, url: null, btn: null, fetching: false, lock: false, ac: null }; });
      audio.addEventListener('error', () => markBtn(btn, false));

      const q = S.qs[S.idx]; if (q) q.listenCount = (q.listenCount || 0) + 1;
      await audio.play();
    } catch (e) {
      console.error(e);
      alert('오디오 재생 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      S.audio.fetching = false;
    }
  }
function stopAudio() {
  try { S.audio?.ac?.abort(); } catch (_) {}
  if (!S.audio?.el) { markBtn(S.audio?.btn, false); return; }
  try { S.audio.el.pause(); S.audio.el.currentTime = 0; } catch (_) {}
  markBtn(S.audio.btn, false);
}

  function cleanupAudio() {
    try { if (S.audio.el) S.audio.el.pause(); } catch (_) {}
    if (S.audio.url) { URL.revokeObjectURL(S.audio.url); }
    S.audio = { el: null, url: null, btn: null, fetching: false, lock: false, ac: null };
  }
  function markBtn(btn, playing) {
    if (!btn) return;
    btn.classList.toggle('playing', playing);
    btn.textContent = playing ? 'Pause (일시정지)' : 'Écouter (듣기)';
  }

  // ===== Questions =====
  function getQuestions() {
    // 1–5 선택(개념)
    const choiceData = [
      { context: "Pour la date '1일', on dit :", options: ["일일", "하나일"], answer: "일일", hints: { choseong: "ㅇㅇ", part: "date: ‘~일’ (Hanja)" } },
      { context: "Pour l'heure '1시', on dit :", options: ["한 시", "일 시"], answer: "한 시", hints: { choseong: "ㅎ ㅅ", part: "heure: natif + 시" } },
      { context: "Pour l'âge '3살', on dit :", options: ["세 살", "삼 살"], answer: "세 살", hints: { choseong: "ㅅ ㅅ", part: "âge: natif + 살" } },
      { context: "Pour l'argent '10 euro', on dit :", options: ["십 유로", "열 유로"], answer: "십 유로", hints: { choseong: "ㅅ ㅇㄹ", part: "argent: Hanja + 유로" } },
      { context: "Pour 30 minutes (30분), on dit :", options: ["삼십 분", "서른 분"], answer: "삼십 분", hints: { choseong: "ㅅㅅ ㅂ", part: "minutes: Hanja + 분" } },
    ];

    // 6–15 불→한
    const frKo = [
      { fr: "Quelle heure est-il ?", audio: "몇 시예요?", frGuide: "Ex. Il est 3 h.", ko: "세 시예요.", accepted: ["3시예요", "세시예요", "지금은 세 시예요.", "세 시입니다."], voice: "alloy", hints: { choseong: "ㅅ ㅅㅇㅇ", part: "‘~시예요’(c’est ~h)" } },
      { fr: "Quel jour du mois ?", audio: "며칠이에요?", frGuide: "Ex. Le 10.", ko: "십일이에요.", accepted: ["10일이에요", "오늘은 십일이에요", "오늘 십일이에요"], voice: "shimmer", hints: { choseong: "ㅅㅇㅇㅇ", part: "date: Hanja + 일" } },
      { fr: "Combien ça coûte ?", audio: "얼마예요?", frGuide: "Ex. 10 euros.", ko: "십 유로예요.", accepted: ["10유로예요", "십유로예요", "열 유로예요"], voice: "alloy", hints: { choseong: "ㅅ ㅇㄹㅇㅇ", part: "prix: Hanja + 유로" } },
      { fr: "Combien de personnes ?", audio: "몇 명이에요?", frGuide: "Ex. Huit.", ko: "여덟 명이에요.", accepted: ["8명이에요", "여덟명이에요"], voice: "nova", hints: { choseong: "ㅇㄷ  ㅁㅇㅇㅇ", part: "compter personnes: natif + 명" } },
      { fr: "Combien de minutes ?", audio: "몇 분이에요?", frGuide: "Ex. 30.", ko: "삼십 분이에요.", accepted: ["30분이에요", "서른 분이에요"], voice: "echo", hints: { choseong: "ㅅㅅ ㅂㅇㅇㅇ", part: "minutes: Hanja + 분" } },

      { fr: "À quelle heure est le rendez-vous ?", audio: "약속이 몇 시예요?", frGuide: "Ex. 4 h.", ko: "네 시예요.", accepted: ["4시예요", "네시예요"], voice: "fable", hints: { choseong: "ㄴ ㅅㅇㅇ", part: "heure: natif + 시" } },
      { fr: "Quel jour du mois ?", audio: "며칠이에요?", frGuide: "Ex. 15.", ko: "십오일이에요.", accepted: ["15일이에요"], voice: "alloy", hints: { choseong: "ㅅㅇㅇㅇㅇ", part: "date: Hanja + 일" } },
      { fr: "Combien ça coûte ?", audio: "얼마예요?", frGuide: "Ex. 12 euros.", ko: "십이 유로예요.", accepted: ["12유로예요", "십이유로예요"], voice: "shimmer", hints: { choseong: "ㅅㅇ ㅇㄹㅇㅇ", part: "prix: Hanja + 유로" } },
      { fr: "Combien de tasses de café ?", audio: "커피 몇 잔이에요?", frGuide: "Ex. Trois.", ko: "세 잔이에요.", accepted: ["3잔이에요", "세잔이에요"], voice: "alloy", hints: { choseong: "ㅅ  ㅈㅇㅇㅇ", part: "compter tasses: natif + 잔" } },
      { fr: "Combien de secondes ?", audio: "몇 초예요?", frGuide: "Ex. Dix secondes.", ko: "십 초예요.", accepted: ["10초예요", "십초예요"], voice: "nova", hints: { choseong: "ㅅ ㅊㅇㅇ", part: "secondes: Hanja + 초" } },
    ];

    // 16–20 받아쓰기
    const dictee = [
      { ko: "지금 몇 시예요?", fr: "Quelle heure est-il ?", guide: "Ex. Il est 3 h.", voice: "shimmer", hints: { choseong: "ㅈㄱ  ㅁ ㅅㅇㅇ?", part: "‘몇 시’ → heure" } },
      { ko: "오늘 며칠이에요?", fr: "Quel jour du mois est-on ?", guide: "Ex. Le 10.", voice: "nova", hints: { choseong: "ㅇㄴ  ㅁㅊㄹㅇㅇ?", part: "‘며칠’ → date (jour)" } },
      { ko: "얼마예요?", fr: "Combien ça coûte ?", guide: "Ex. 12 euros.", voice: "alloy", hints: { choseong: "ㅇㄹㅁ ㅇㅇ?", part: "prix" } },
      { ko: "몇 명이에요?", fr: "Combien de personnes ?", guide: "Ex. Huit.", voice: "echo", hints: { choseong: "ㅁ  ㅁㅇㅇㅇ?", part: "compter personnes" } },
      { ko: "지금 몇 시 몇 분이에요?", fr: "Quelle heure et quelle minute est-il ?", guide: "Ex. 2 h 30.", voice: "fable", hints: { choseong: "ㅈㄱ  ㅁ ㅅ  ㅁ ㅂㄴㅇㅇ?", part: "heure + minutes" } },
    ];

    const choice = choiceData.map((q, i) => ({
      number: i + 1, type: 'choice', context: q.context, options: q.options, answer: q.answer,
      hints: q.hints, userAnswer: null, isCorrect: null,
      listenCount: 0, hint1Count: 0, hint2Count: 0,
      pronunRequired: true, pronunAttempted: false, pronunPassed: false,
      pronunFails: 0, pronunAttempts: 0, lastPronunScore: null
    }));

    const fr_prompt_ko = frKo.map((q, i) => ({
      number: choice.length + i + 1, type: 'fr_prompt_ko',
      fr: q.fr, audioText: q.audio, frGuide: q.frGuide, ko: q.ko,
      accepted: q.accepted || [], voice: q.voice || 'alloy', hints: q.hints,
      userAnswer: "", textChecked: false, textCorrect: null, isCorrect: null,
      listenCount: 0, hint1Count: 0, hint2Count: 0,
      pronunRequired: true, pronunAttempted: false, pronunPassed: false,
      pronunFails: 0, pronunAttempts: 0, lastPronunScore: null
    }));

    const dictation = dictee.map((q, i) => ({
      number: choice.length + fr_prompt_ko.length + i + 1, type: 'dictation',
      ko: q.ko, fr: q.fr, frAnswerGuide: q.guide, voice: q.voice, hints: q.hints,
      userAnswer: { ko: "", replyKo: "" }, isCorrect: null,
      listenCount: 0, hint1Count: 0, hint2Count: 0,
      pronunRequired: true, pronunAttempted: false, pronunPassed: false,
      pronunFails: 0, pronunAttempts: 0, lastPronunScore: null
    }));

    return [...choice, ...fr_prompt_ko, ...dictation];
  }

  // ===== Render =====
  function render() {
    const q = S.qs[S.idx]; if (!q) return;

    // Sticky 5x5: Q1~Q5에는 숨김
    $('#sticky55')?.classList.toggle('hidden', q.number < 6);

    $('#progressText').textContent = `Question ${q.number} / ${S.qs.length}`;
    const prog = Math.max(0, Math.min(100, Math.round((S.idx / S.qs.length) * 100)));
    $('#progressBar').style.width = `${prog}%`;

    const host = $('#qArea');
    host.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    host.appendChild(card);

    const head = document.createElement('div');
    head.className = 'flex items-center gap-2 mb-1';
    head.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-800 text-white">${label(q.type)}</span><span class="text-sm text-slate-500">Q${q.number}/${S.qs.length}</span>`;
    card.appendChild(head);

    if (q.type === 'choice') {
      const h2 = document.createElement('h2');
      h2.className = 'text-lg font-semibold mb-1';
      h2.textContent = q.context;
      card.appendChild(h2);

      const p = document.createElement('p');
      p.className = 'text-sm text-slate-600 mb-2';
      p.textContent = 'Choisissez la bonne réponse. / 알맞은 답을 고르세요.';
      card.appendChild(p);

      const wrap = document.createElement('div');
      wrap.className = 'choices';
      card.appendChild(wrap);

      const fb = document.createElement('div');
      fb.id = 'qFeedback';
      fb.className = 'feedback';
      card.appendChild(fb);

      q.options.forEach((labelOpt) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'choice-btn';
        b.textContent = labelOpt;
        b.addEventListener('click', () => {
          q.userAnswer = labelOpt;
          q.isCorrect = (labelOpt === q.answer);

          $$('.choice-btn', card).forEach(x => x.classList.remove('is-correct', 'is-wrong'));
          if (q.isCorrect) {
            b.classList.add('is-correct');
            // ✅ 정답 피드백(축하 + 발음 유도)
            fb.className = 'feedback good';
            fb.textContent = '🎉 Bravo ! Maintenant, place à la prononciation 😄 / 축하해요! 이제 발음 연습할 시간!';
            q.pronunAttempted = false; // 정답 후 발음 시도 요구
          } else {
            b.classList.add('is-wrong');
            fb.className = 'feedback bad';
            fb.textContent = "❌ Mauvaise réponse. Relis bien et choisis de nouveau. / 오답이에요. 다시 골라주세요.";
            card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
            q.pronunAttempted = false;
          }
          updateNav();
          renderPronunIfNeeded(card, q);
        });
        wrap.appendChild(b);
      });

      renderPronunIfNeeded(card, q);
    }

    if (q.type === 'fr_prompt_ko') {
      const h2 = document.createElement('h2');
      h2.className = 'text-lg font-semibold mb-1';
      h2.textContent = q.fr;
      card.appendChild(h2);

      const controls = document.createElement('div');
      controls.className = 'flex gap-2 mb-2';
      controls.innerHTML = `
        <button class="btn btn-primary flex-1" id="btnListen">Écouter (듣기)</button>
        <button class="btn" id="btnStop">■ Stop</button>
      `;
      card.appendChild(controls);
      $('#btnListen', controls).addEventListener('click', e => playAudio(q.audioText, q.voice, { _btn: e.currentTarget }));
      $('#btnStop', controls).addEventListener('click', stopAudio);

      // 힌트(1~5 숨김)
      card.insertAdjacentHTML('beforeend', hintBox(q));

      // 입력 라벨 + 강조 입력칸 + 한/불 안내
      const lab = document.createElement('label');
      lab.className = 'block mb-1 font-semibold';
      lab.textContent = 'Réponse en coréen (한국어):';
      card.appendChild(lab);

      const fieldWrap = document.createElement('div');
      fieldWrap.className = 'flex flex-col gap-1';
      fieldWrap.innerHTML = `
        <input id="inpKO"
               class="input-field flex-1 border-2 border-blue-500 focus:border-blue-600 rounded-lg p-2"
               value="${esc(q.userAnswer || '')}"
               placeholder="여기에 한국어로 입력하세요 / Écris en coréen ici">
        <div class="text-xs text-slate-500">Ex (FR): ${esc(q.frGuide || '')}</div>
      `;
      card.appendChild(fieldWrap);

      const checkBtn = document.createElement('button');
      checkBtn.className = 'btn btn-primary mt-2';
      checkBtn.textContent = 'Vérifier / 정답 확인';
      checkBtn.addEventListener('click', checkText);
      card.appendChild(checkBtn);

      $('#inpKO', fieldWrap).addEventListener('input', (e) => onTextInput(e.target.value));

      if (q.textChecked) {
        const ok = q.textCorrect === true;
        const res = document.createElement('div');
        res.className = `mt-3 ${ok ? 'text-emerald-700' : 'text-rose-700'} font-semibold`;
        res.innerHTML = ok
          ? '✅ Correct ! 맞았습니다!'
          : `❌ Incorrect. 틀렸습니다. <span class="ml-2 text-slate-700">Réponse (KO) / 정답: <b>${esc(q.ko)}</b></span>`;
        card.appendChild(res);
        renderPronun(card, q); // 발음 시도 필요
      }
    }

    if (q.type === 'dictation') {
      const h2 = document.createElement('h2');
      h2.className = 'text-lg font-semibold mb-1';
      h2.textContent = 'Dictée + Réponse / 받아쓰기 + 대답';
      card.appendChild(h2);

      const controls = document.createElement('div');
      controls.className = 'flex gap-2 mb-2';
      controls.innerHTML = `
        <button class="btn btn-primary flex-1" id="btnListen">Écouter (듣기)</button>
        <button class="btn" id="btnStop">■ Stop</button>
      `;
      card.appendChild(controls);
      $('#btnListen', controls).addEventListener('click', e => playAudio(q.ko, q.voice, { _btn: e.currentTarget }));
      $('#btnStop', controls).addEventListener('click', stopAudio);

      card.insertAdjacentHTML('beforeend', hintBox(q));

      const box = document.createElement('div');
      box.className = 'space-y-2';
      box.innerHTML = `
        <div>
          <label class="block mb-1 font-semibold">1) Dictée (받아쓰기)</label>
          <input class="input-field" id="dicKO" value="${esc(q.userAnswer.ko || '')}" placeholder="">
          <div class="text-xs text-slate-500 mt-1">Écoutez et écrivez tel quel / 그대로 적기</div>
        </div>
        <div>
          <label class="block mb-1 font-semibold">2) Réponse (한국어 대답)</label>
          <input class="input-field input-reply-ko" id="dicReply" value="${esc(q.userAnswer.replyKo || '')}"
                 placeholder="여기에 한국어로 입력하세요 / Écris en coréen ici">
          <div class="text-xs text-slate-500 mt-1">Ex (FR): ${esc(q.frAnswerGuide || '')}</div>
        </div>
      `;
      card.appendChild(box);
      $('#dicKO', box).addEventListener('input', e => updateDictee('ko', e.target.value));
      $('#dicReply', box).addEventListener('input', e => updateDictee('replyKo', e.target.value));

      renderPronun(card, q);
    }

    updateNav();
  }

  function label(t) {
    return (t === 'choice' ? 'Choix / 선택'
      : t === 'fr_prompt_ko' ? 'Français → 한국어 / 불→한'
      : 'Dictée + Réponse / 받아쓰기 + 대답');
  }

  // 힌트(1~5 숨김)
  function hintBox(q) {
    if (q.number <= 5) return '';
    return `
      <div class="flex flex-wrap gap-2 items-center mb-2">
        <button class="btn btn-outline" onclick="Quiz.showHint(1)">🙏 Aidez-moi (도움1: 초성)</button>
        <button class="btn btn-outline" onclick="Quiz.showHint(2)">🦺 Au secours (도움2: 부분뜻)</button>
        <span class="hint-metrics text-xs text-slate-500">H1: ${q.hint1Count || 0} · H2: ${q.hint2Count || 0}</span>
      </div>
      <div id="hintArea" class="text-sm text-slate-700"></div>
    `;
  }

  // 발음 위젯
function renderPronunIfNeeded(card, q) {
  if (q.type === 'choice' && q.userAnswer === q.answer) {
    renderPronun(card, q, q.answer);
  } else if (q.type === 'fr_prompt_ko' && q.textChecked === true) {
    renderPronun(card, q, q.ko);
  } else if (q.type === 'dictation') {
    // dictation은 학생의 대답(replyKo)을 기준으로 평가해야 함 → ref 생략하여 resolver가 input 값을 사용
    renderPronun(card, q);
  }

}

 function renderPronun(card, q, ref) {
  // 이미 그렸으면 재마운트 금지
  if (card.__pronMounted) return;
  card.__pronMounted = true;

  const wrap = document.createElement('div');
  wrap.className = 'pronun-card mt-3';
  const refText = esc(ref || refTextResolver(q));
  wrap.innerHTML = `
    <div class="pronun-title">🎤 Enregistrer & tester / 녹음·발음 평가</div>
    <div class="text-xs text-slate-600 mb-1">Référence (KO): <span class="font-semibold">${refText}</span></div>
    <div id="pronunMount"></div>
  `;
  card.appendChild(wrap);

  const mount = wrap.querySelector('#pronunMount');

 // 🔧 Pronun이 아직 로드 전이면 재시도 루프(최대 5초)
if (!window.Pronun) {
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (window.Pronun && mount && !mount.__mounted) {
      clearInterval(timer);
      doMount();
    }
    if (tries >= 20) clearInterval(timer); // 20×250ms = 5s
  }, 250);
  return;
}
doMount();


  function doMount(){
    if (!mount || mount.__mounted) return;
    mount.__mounted = true;
    try {
Pronun.mount(mount, {
  ui: 'warmup',
  getReferenceText: () => refTextResolver(q, ref),
  onResult: (res) => {
    const score = (res && typeof res.score === 'number') ? res.score : null;
    const passed = !!(res && (res.passed || res.ok || (typeof score === 'number' && score >= 0.8)));

    q.pronunAttempts = (q.pronunAttempts || 0) + 1;
    q.lastPronunScore = score;
    if (passed) q.pronunPassed = true;
    else q.pronunFails = (q.pronunFails || 0) + 1;

    q.pronunAttempted = true;
    q.pronunAttemptsOk = (q.pronunAttempts >= 2); // 2회 이상 시도 허용 규칙
    updateNav();
  }
});



    } catch(e){ console.warn('Pronun mount fail:', e); }
  }
}

  function refTextResolver(q, refOverride) {
    if (refOverride) return String(refOverride || '');
    if (q.type === 'choice') return q.answer;
    if (q.type === 'fr_prompt_ko') return q.ko;
    if (q.type === 'dictation') {     const reply = $('.input-reply-ko')?.value || '';     return reply || q.ko; // 입력 전엔 원문으로 안내, 입력하면 학생 답 기준   }
    return '';
  }

  // ===== Interactions =====
  function onTextInput(v) {
    const q = S.qs[S.idx];
    q.userAnswer = v;
    q.textChecked = false; q.textCorrect = null;
    q.pronunAttempted = false; q.pronunPassed = false;
    q.pronunFails = 0; q.pronunAttempts = 0; q.lastPronunScore = null;
    updateNav();
  }
  function checkText() {
    const q = S.qs[S.idx];
    if (q.type !== 'fr_prompt_ko') return;
    const v = (q.userAnswer || '').trim();
    if (!v) return;
    const cands = [q.ko, ...(q.accepted || [])];
    q.textCorrect = cands.some(ans => {
      const u = norm(v);
      const a = norm(ans);
      return (u === a) || u.includes(a);
    });
    q.textChecked = true;
    q.isCorrect = q.textCorrect;
    q.pronunAttempted = false; q.pronunPassed = false;
    q.pronunFails = 0; q.pronunAttempts = 0; q.lastPronunScore = null;
    render();
  }
  function updateDictee(part, val) {
  const q = S.qs[S.idx];
  q.userAnswer[part] = val;

  // 둘 다 입력됐을 때 채점
  const hasBoth = !!q.userAnswer.ko && !!q.userAnswer.replyKo;
  if (hasBoth) {
    // 규칙: “정답 형태가 학생 답 안에 부분 포함돼도 정답”
    const ok = norm(q.userAnswer.ko).includes(norm(q.ko));
    q.isCorrect = !!ok;
  } else {
    q.isCorrect = false; // 아직 미완성 → 오답 처리(총점 100% 방지)
  }

  updateNav();
}

  function showHint(n) {
    const q = S.qs[S.idx]; if (!q || !q.hints) return;
    if (n === 1) { q.hint1Count = (q.hint1Count || 0) + 1; $('#hintArea').textContent = `초성: ${q.hints.choseong || '-'}`; }
    else { q.hint2Count = (q.hint2Count || 0) + 1; $('#hintArea').textContent = `Indice (FR): ${q.hints.part || '-'}`; }
    updateNav();
  }

  // 다음 허용 규칙 (발음 2회 평가했고)
// ===== Interactions =====
function isNextAllowed() {
  const q = S.qs[S.idx]; 
  if (!q) return false;

  const attempts = q.pronunAttempts || 0;
  const passed   = q.pronunPassed === true;

  // 규칙: 발음 평가를 최소 2회 했으면 점수와 상관없이 통과
  const pronunOK = passed || attempts >= 2;

  // 발음 필수인데 아직 조건 못 채우면 false
  if (q.pronunRequired && !pronunOK) return false;

  // 발음 조건 충족 시 → 다른 답 조건은 무시하고 바로 true
  if (pronunOK) return true;

  // (폴백: 아직 발음 안했으면 기존 조건 적용)
  if (q.type === 'choice') {
    return !!q.userAnswer && q.userAnswer === q.answer;
  } else if (q.type === 'fr_prompt_ko') {
    return !!q.userAnswer && q.textChecked === true;
  } else if (q.type === 'dictation') {
    return !!q.userAnswer.ko && !!q.userAnswer.replyKo;
  }
  return false;
}


  function updateNav() {
    // Q1에서도 ← 사용 가능(웜업 이동용)
    $('#btnPrev').disabled = false;

    const canNext = isNextAllowed();
    const isLast = (S.idx === S.qs.length - 1);

    // 다음 버튼: 마지막 문항에서는 숨김
    const nextBtn = $('#btnNext');
    if (nextBtn) {
      nextBtn.disabled = !canNext || isLast;
      nextBtn.style.display = isLast ? 'none' : '';
    }

    // 끝내기 버튼
    const finishBtn = $('#btnFinish');
    if (finishBtn) {
      finishBtn.classList.toggle('hidden', !isLast);
      finishBtn.disabled = !isLast ? true : false;
    }
  }

  // ===== Finish & Summary =====
  async function finish() {
    const end = Date.now();
    // 받아쓰기 중 isCorrect 누락된 문항 보완 채점(부분 포함 허용)
S.qs.forEach(q => {
  if (q.type === 'dictation' && (q.isCorrect == null)) {
    const ua = (q.userAnswer && q.userAnswer.ko) ? q.userAnswer.ko : '';
    q.isCorrect = norm(ua).includes(norm(q.ko));
  }
});

const name = document.querySelector('#student-name')?.value?.trim() || 'Élève';

    // 메일/로그 요약에 유용: 과제명 & 전체 점수 포함
    const rawTitle = (document.title || 'Exercices').trim();
    const assignmentTitle = rawTitle.replace(/\s*\|\s*.*$/, '').trim(); // "Coréen — Nombres"만 남도록
    const correct = S.qs.filter(q => q.isCorrect === true).length;
    const total = S.qs.length;
    const overall = total ? Math.round((100 * correct) / total) : 0;

    const payload = {
      studentName: name,
      assignmentTitle,
      overall,
      startTime: new Date(S.start).toISOString(),
      endTime: new Date(end).toISOString(),
      totalTimeSeconds: Math.round((end - S.start) / 1000),
      questions: S.qs.map(q => ({
        number: q.number,
        type: q.type,
        ko: q.type === 'fr_prompt_ko' ? q.ko : (q.type === 'dictation' ? q.ko : q.context),
        fr: q.type === 'fr_prompt_ko' ? q.fr : (q.type === 'dictation' ? q.fr : ''),
        userAnswer: q.type === 'dictation' ? JSON.stringify(q.userAnswer) : (q.userAnswer || ''),
        isCorrect: !!q.isCorrect,
        listenCount: q.listenCount || 0,
        hint1Count: q.hint1Count || 0,
        hint2Count: q.hint2Count || 0,
        pronunAttempted: !!q.pronunAttempted,
        pronunPassed: !!q.pronunPassed,
        pronunFails: q.pronunFails || 0,
        pronunAttempts: q.pronunAttempts || 0,
        lastPronunScore: q.lastPronunScore
      }))
    };

    // 결과 저장(요약/결과 페이지용)
    try { localStorage.setItem('pongdang:lastResults', JSON.stringify(payload)); } catch (_) {}

    // 전송 (SendResults 네임스페이스/전역/폴백POST 모두 지원)
    try {
      const callSend = (window.SendResults && window.SendResults.sendResults)
        ? window.SendResults.sendResults
        : (window.sendResults || null);

      if (typeof callSend === 'function') {
        await callSend(payload);
      } else {
        const slim = {
          studentName: payload.studentName,
          assignmentTitle: payload.assignmentTitle,
          overall: payload.overall,
          startTime: payload.startTime,
          endTime: payload.endTime,
          totalTimeSeconds: payload.totalTimeSeconds,
          questions: payload.questions.map(q => {
            const c = { ...q };
            delete c.audio; delete c.audioBase64; delete c.recording; delete c.logs;
            return c;
          })
        };
        await fetch('/.netlify/functions/send-results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slim)
        });
      }
    } catch (e) { console.warn('send fail', e); }

    renderSummary(payload);
  }

  function renderSummary(p) {
    const total = p.questions.length;
    const correct = p.questions.filter(q => q.isCorrect).length;
    const pct = total ? Math.round((100 * correct) / total) : 0;
    const wrong = p.questions.filter(q => q.isCorrect === false);

    const host = $('#qArea');
    host.innerHTML = `
      <div class="card">
        <h2 class="text-xl font-semibold mb-2">Bilan / 총정리</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div class="sum-box">
            <div class="sum-title">Score</div>
            <div class="sum-val">${pct}%</div>
            <div class="sum-sub">${correct} / ${total}</div>
          </div>
          <div class="sum-box">
            <div class="sum-title">Prononciation</div>
            <div class="sum-val">${p.questions.filter(q => q.pronunAttempted).length}</div>
            <div class="sum-sub">녹음 시도 문항 수</div>
          </div>
          <div class="sum-box">
            <div class="sum-title">Temps</div>
            <div class="sum-val">${Math.max(0, p.totalTimeSeconds | 0)}s</div>
            <div class="sum-sub">총 소요</div>
          </div>
        </div>

        ${
          wrong.length ? `
          <div class="soft-divider"></div>
          <h3 class="font-semibold mb-1">À revoir / 다시 보기</h3>
          <ol class="list-decimal pl-5 space-y-2">
            ${wrong.map(q => {
              const ua = (q.type === 'dictation') ? JSON.parse(q.userAnswer || '{}')?.ko || '' : (q.userAnswer || '');
              const ko = q.ko || '';
              const fr = q.fr || '';
              return `
                <li>
                  <div class="text-sm"><b>Q${q.number}</b> ${fr ? `<span class="text-slate-500">(${esc(fr)})</span>` : ''}</div>
                  <div class="text-sm">🧩 <span class="text-slate-600">정답</span> : <b>${esc(ko)}</b></div>
                  <div class="text-sm">🤔 <span class="text-slate-600">내 답</span> : ${esc(ua || '—')}</div>
                </li>`;
            }).join('')}
          </ol>` : `
          <div class="pronun-card mt-2">모든 문항을 맞췄습니다. 아주 좋아요! ✨</div>`
        }

        <div class="soft-divider mt-4"></div>
        <h3 class="font-semibold mb-1">Prononciation par question / 문항별 발음 정확도</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm border border-slate-200 rounded-md">
            <thead class="bg-slate-50">
              <tr>
                <th class="px-2 py-1 text-left">Q#</th>
                <th class="px-2 py-1 text-left">Référence (KO)</th>
                <th class="px-2 py-1 text-left">Tentatives / 시도</th>
                <th class="px-2 py-1 text-left">Dernier score / 마지막 점수</th>
                <th class="px-2 py-1 text-left">Passé ?</th>
              </tr>
            </thead>
            <tbody>
              ${p.questions.map(q => {
                const ref = q.ko || '';
                const tries = q.pronunAttempts || 0;
                const last = (typeof q.lastPronunScore === 'number')
                  ? Math.round(q.lastPronunScore * 100) + '%'
                  : '—';
                const ok = q.pronunPassed ? '✅' : (tries ? '❌' : '—');
                return `
                  <tr class="border-t">
                    <td class="px-2 py-1">Q${q.number}</td>
                    <td class="px-2 py-1">${esc(ref)}</td>
                    <td class="px-2 py-1">${tries}</td>
                    <td class="px-2 py-1">${last}</td>
                    <td class="px-2 py-1">${ok}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>

        <div class="mt-4 flex justify-end">
          <a class="btn btn-primary" href="../index.html">Fermer / 닫기</a>
        </div>
      </div>
    `;

    // 네비 비활성화
    $('#btnPrev').disabled = true;
    $('#btnNext').disabled = true;
    $('#btnFinish').disabled = true;
  }

  function requireName() {
const v = document.querySelector('#student-name')?.value?.trim();
    if (!v) {
      alert('이름을 먼저 입력해 주세요. / Écris ton nom d’abord.');
      return false;
    }
    S.name = v; return true;
  }

  // ===== Nav events =====
  $('#btnPrev').addEventListener('click', () => {
    // 첫 문제에서 ← 누르면 웜업으로 이동
    if (S.idx <= 0) {
      window.location.href = 'numbers-warmup.html';
      return;
    }
    S.idx--; render();
  });

$('#btnNext').addEventListener('click', () => {
  if (!requireName()) return;

  // 통일 규칙: 발음 평가는 최소 2회 (점수 무관)
  if (!isNextAllowed()) {
    alert(
      "👉 Enregistrez et évaluez votre prononciation au moins 2 fois.\n" +
      "👉 발음을 최소 2회 녹음·평가해 주세요."
    );
    return;
  }

  if (S.idx < S.qs.length - 1) { S.idx++; render(); }
});

  $('#btnFinish').addEventListener('click', () => { if (!requireName()) return; finish(); });
  window.addEventListener('beforeunload', cleanupAudio);

  // ===== Start =====
  S.qs = getQuestions();
  render();

  // Expose (전역에서 힌트/입력 제어)
  window.Quiz = { playAudio, stopAudio, onTextInput, checkText, updateDictee, showHint };

})();
