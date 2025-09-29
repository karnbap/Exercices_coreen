// assets/pronun-mini-test.js
// 발음 난이도 높은 자모/단어 포함 3문장 + 듣기 + 녹음(실시간) + 평가(오류만 빨간색)
// - 듣기: /.netlify/functions/generate-audio (wav/ogg → Blob URL로 재생)
// - 녹음/평가: 공용 Pronun.mount 사용 (서버 analyze-pronunciation)
// - 실시간 STT: window.LiveSTT가 있으면 부분 자막 표시(옵션)

// ===== 문장 세트 (자음/모음 함정 포함) =====
const SENTENCES = [
  {
    ko: "신짬뽕이랑 찐빵, 어느 쪽이 더 매워?",
    fr: "Shin-jjambbong ou jjin-ppang, lequel est plus piquant ?",
    // ㅆ/ㅉ/ㅃ 된소리, 비음 동화, 비슷한 운율
  },
  {
    ko: "밖에 비가 쏟아져서 우산 좀 빌려 줄래?",
    fr: "Il pleut à verse dehors, tu peux me prêter un parapluie ?",
    // ㅆ/ㅉ/받침 연음(밖에→바께), ㅈ/ㅉ 혼동
  },
  {
    ko: "십유로짜리 초콜릿 세 개만 주세요.",
    fr: "Donnez-moi seulement trois chocolats à dix euros.",
    // 한자어 숫자(십), 단위 연음(유로짜리), 사이시옷
  }
];

// ===== TTS 재생 (Base64 → Blob → ObjectURL) =====
async function ttsPlay(text, voice="shimmer", speed=1.0){
  const res = await fetch('/.netlify/functions/generate-audio', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ text, voice, speed })
  });
  if (!res.ok) throw new Error('TTS failed');
  const data = await res.json();

  const b64 = (data.audioBase64 || data.audioData || '').split(',').pop();
  const bin = atob(b64); const buf = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) buf[i] = bin.charCodeAt(i);
  const blob = new Blob([buf], { type: data.mimeType || 'audio/wav' });
  const url = URL.createObjectURL(blob);

  const a = new Audio(url);
  a.addEventListener('ended', ()=> URL.revokeObjectURL(url), { once:true });
  await a.play().catch(()=>{ try{URL.revokeObjectURL(url);}catch(_){}});

  return data.durationEstimateSec || null;
}




// ===== 카드 렌더 =====
function makeCard(idx, sent){
  const wrap = document.createElement('section');
  wrap.className = 'card';

  wrap.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-sm text-slate-500">Q${idx+1}</div>
        <div class="text-xl font-bold mb-1">${sent.ko}</div>
        <div class="text-slate-600 text-sm mb-2">FR: ${sent.fr}</div>
      </div>
      <button class="btn btn-secondary btn-sm" data-action="listen" data-requires-name>▶ 듣기 / Écouter</button>
    </div>

    <!-- 실시간 비교 -->
    <div class="grid md:grid-cols-2 gap-3">
      <div class="pronun-card">
        <div class="pronun-title">내 발음 / En direct</div>
        <div class="pronun-live" data-live>—</div>
      </div>
    </div>

    <!-- 녹음/평가 -->
    <div class="mt-3" data-pronun></div>
    <div class="text-sm mt-2 text-slate-600">멈춘 뒤 <b>평가</b>를 누르면 <u>원문과 일치하지 않는 부분만</u> 빨간색으로 표시돼요.</div>

    <!-- 결과: 틀린 부분 마킹 -->
    <div class="mt-3 sum-box">
      <div class="sum-title">오류 하이라이트 / Parties non conformes</div>
      <div class="sum-val text-base leading-7" data-diff>—</div>
      <div class="sum-sub mt-1" data-score></div>
    </div>
  `;

  // 듣기
  wrap.querySelector('[data-action="listen"]').addEventListener('click', async (e)=>{
    const btn=e.currentTarget; btn.disabled=true;
    try{ await ttsPlay(sent.ko); } finally { btn.disabled=false; }
  });

  const host = wrap.querySelector('[data-pronun]');
  const liveBox = wrap.querySelector('[data-live]');
  const diffBox = wrap.querySelector('[data-diff]');
  const scoreBox= wrap.querySelector('[data-score]');
  const getRef  = ()=> sent.ko;

   // 🔸 녹음 위젯(host) 바로 아래: [원문] 위 / [실시간] 아래로 한 묶음 배치
  (function placeRefAndLive(){
    const refBox = wrap.querySelector('[data-ref]');
    const refCardOld = refBox?.closest('.pronun-card');
    const liveCardOld = liveBox?.closest('.pronun-card');

    const wrapBox = document.createElement('div');
    wrapBox.className = 'mt-3 space-y-2';

    if (refBox) {
      const refLabel = document.createElement('div');
      refLabel.className = 'pronun-title';
      refLabel.textContent = '원문 / Référence (KO)';
      const refHolder = document.createElement('div');
      refHolder.className = 'p-2 border rounded bg-white text-lg';
      refHolder.appendChild(refBox); // 실제 노드 이동
      wrapBox.appendChild(refLabel);
      wrapBox.appendChild(refHolder);
    }

    if (liveBox) {
      const liveLabel = document.createElement('div');
      liveLabel.className = 'pronun-title';
      liveLabel.textContent = '내 발음 (실시간) / En direct';
      wrapBox.appendChild(liveLabel);
      wrapBox.appendChild(liveBox);
    }

    host.insertAdjacentElement('afterend', wrapBox);

    if (refCardOld) refCardOld.remove();
    if (liveCardOld) liveCardOld.remove();
  })();



  // (옵션) 실시간 STT가 있으면 녹음 시작~정지 사이에 부분 텍스트 표시
  let sttStop = null;
  function startLiveSTT(){
    // 1) 커스텀 LiveSTT 우선
    if (window.LiveSTT && typeof LiveSTT.start==='function'){
      const { stop } = LiveSTT.start({
        lang:'ko-KR',
        onPartial(txt){ liveBox.textContent = (txt||'').trim() || '…'; }
      });
      return stop;
    }
    // 2) 폴백: Web Speech API(Chrome 기반)
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = 'ko-KR';
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (ev)=>{
      let partial = '';
      for (let i=ev.resultIndex; i<ev.results.length; i++){
        partial += ev.results[i][0].transcript || '';
      }
      liveBox.textContent = (partial||'').trim() || '…';
    };
    try { rec.start(); } catch(_) {}
    return ()=>{ try{rec.stop();}catch(_){} };
  }


  Pronun.mount(host, {
    getReferenceText: getRef,
    onResult: ({ status, transcript, accuracy, duration })=>{
      if (status==='retry' || !transcript){
        diffBox.textContent = '—';
        scoreBox.textContent = '다시 한번 또박또박 말해볼까요?';
        return;
      }
      // 최종 비교(정지 후 평가)
        // 발음 채점(공용 scoring.js: 자모 기반, 띄어쓰기/문장부호 무시)
      const ref = sent.ko;
      try {
        const { pct, html } = Scoring.gradePronun(ref, transcript, 0.10); // tol=10%
        diffBox.innerHTML = html;
        scoreBox.textContent = `정확도: ${pct}% · 길이: ${duration?.toFixed?.(1)||'?'}s`;
      } catch (e) {
        console.error('[pronun-mini-test] scoring error', e);
        diffBox.textContent = ref;
        scoreBox.textContent = '채점 오류';
      }

    }
  });

  // 녹음 버튼 훅: 공용 위젯의 버튼을 관찰해 실시간 STT 시작/종료
  // 1) 버튼 라벨 직접 감지(Démarrer/Start/녹음)로 STT on/off
  host.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if (!btn) return;
    const label = (btn.textContent || '').toLowerCase();
    if (/(démarrer|start|녹음|시작)/i.test(label)) {
      if (!sttStop){ sttStop = startLiveSTT(); liveBox.textContent='…'; }
    }
    if (/(stop|arrêter|멈추기|정지)/i.test(label)) {
      if (sttStop){ try{ sttStop(); }catch(_){} sttStop=null; }
    }
  });

  // 2) 보조: 위젯 내부 상태 변화를 감지(문구 변화 외에도 아이콘 변화 등)
  const obs = new MutationObserver(()=>{
    
    const text = host.textContent || '';
    const on = /(녹음 중|recording|en cours d'enregistrement)/i.test(text);
    if (on && !sttStop){ sttStop = startLiveSTT(); liveBox.textContent='…'; }
    if (!on && sttStop){ try{ sttStop(); }catch(_){} sttStop=null; }
      mergeStopAndEvaluate(); // ← 버튼 DOM 바뀔 때마다 정지=평가 병합 재시도

  });
  obs.observe(host, { childList:true, subtree:true });
    mergeStopAndEvaluate();
  setTimeout(mergeStopAndEvaluate, 200);

function mergeStopAndEvaluate(){
  const allBtns = Array.from(host.querySelectorAll('button'));
  const normTxt = s => (s||'').replace(/\s+/g,' ').trim().toLowerCase();
  const findInc = (...needles) => allBtns.find(b => {
    const t = normTxt(b.textContent);
    return needles.some(n => t.includes(n));
  });

  const stopBtn = findInc('stop','arrêter','멈추기','정지');
  const evalBtn = findInc('évaluer','평가','evaluate');
  if (!stopBtn || !evalBtn) return;

  if (!stopBtn.dataset.merged) {
    // 평가 버튼 숨김
    evalBtn.style.display = 'none';

    // 라벨/크기/스타일
    stopBtn.textContent = '멈추고 평가 / Arrêter & Évaluer';
    stopBtn.classList.add('pd-bigbtn'); // 스타일 주입용 클래스
    stopBtn.dataset.merged = '1';

    // 클릭: 원래 Stop 동작 + 평가 강제 실행(여러 번 재시도)
    stopBtn.addEventListener('click', () => {
      const tryEval = (attempt=0)=>{
        try { evalBtn.click(); } catch(_) {}
        // onResult가 안 뜨면 100ms 간격으로 최대 8번 재시도
        if (attempt < 8) setTimeout(()=>tryEval(attempt+1), 100);
      };
      // Stop 핸들러가 끝날 시간을 주고 시작
      setTimeout(()=>tryEval(0), 120);
    }, { once:false });
  }
}



    mergeStopAndEvaluate();

  return wrap;
}
// ===== 페이지 전용 스타일 주입(그래프 제거 + 텍스트 크게) =====
(function injectPronunStyles(){
  const css = `
/* 파형/그래프 제거 */
.pronun-card canvas,
.pronun-graph,
.pronun-visualizer,
.pd-wave,
.wave,
.waveform { display:none !important; height:0 !important; }

/* 내 발음(실시간) 박스 강화 */
.pronun-live {
  display:block;
  font-size:1.8rem;
  line-height:2.2rem;
  padding:16px 18px;
  min-height:96px;
  background:#fff;
  border:2px solid #e2e8f0;
  border-radius:14px;
  box-shadow:0 1px 0 rgba(0,0,0,.02);
}
@media (min-width:768px){
  .pronun-live{ font-size:2.1rem; line-height:2.6rem; min-height:110px; }
}

/* 녹음 시작/정지/평가 버튼 크게 & 꾸미기 */
[data-pronun] button,
.pd-bigbtn {
  font-size:1.05rem !important;
  padding:12px 18px !important;
  border-radius:12px !important;
}
.pd-bigbtn{
  background:#0ea5e9 !important; /* sky-500 */
  color:#fff !important;
  border:none !important;
  box-shadow:0 6px 14px rgba(14,165,233,.22);
}
.pd-bigbtn:hover{ filter:brightness(1.05); }

/* 틀린 발음 부분 하이라이트 */
[data-diff] {
  font-weight:500;
  color:#333;
}
[data-diff] ins {
  background-color:rgba(239,68,68,.2);
  text-decoration:none;
}
[data-diff] del {
  background-color:rgba(239,68,68,.4);
  text-decoration:none;
}
`;
  const tag = document.createElement('style');
  tag.setAttribute('data-pronun-mini-style','1');
  tag.textContent = css;
  document.head.appendChild(tag);
})();

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', ()=>{
  const mount = document.getElementById('cards');
  SENTENCES.forEach((s, i)=> mount.appendChild(makeCard(i, s)));

  // finish 버튼은 이름 입력되면 자동 활성 (student-gate가 제어)
  document.getElementById('finish-btn')?.addEventListener('click', ()=>{
    alert('연습 종료! (이 페이지는 결과 전송 없이 미니 테스트용입니다)');
  });
});

// Removed 'Previous Exercise' button
const prevExerciseButton = document.querySelector('.btn-prev-exercise');
if (prevExerciseButton) {
  prevExerciseButton.remove();
}

// Translate all instructions to Korean/French
const instructions = document.querySelectorAll('.instruction');
instructions.forEach(inst => {
  inst.innerHTML = `
    <p>지시사항: ${inst.dataset.instructionKo}</p>
    <p>Instructions: ${inst.dataset.instructionFr}</p>
  `;
});

// Update instruction text to include Korean/French
const evaluationInstruction = document.querySelector('.evaluation-instruction');
if (evaluationInstruction) {
  evaluationInstruction.innerHTML = `
    <p>멈춘 뒤 <b>평가</b>를 누르면 <u>원문과 일치하지 않는 부분만</u> 빨간색으로 표시돼요.</p>
    <p>Après avoir arrêté, cliquez sur <b>Évaluer</b> pour afficher en rouge les parties non conformes.</p>
  `;
}

// Update record button text to include Korean/French
const recordButton = document.querySelector('button[data-action="record"]');
if (recordButton) {
  recordButton.innerHTML = `
    <span>녹음 시작 / Démarrer l'enregistrement</span>
  `;
}

// Integrate result submission
async function submitResults(results) {
  const response = await fetch('/.netlify/functions/send-results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results)
  });
  if (!response.ok) {
    console.error('Failed to submit results:', response.statusText);
  }
}

// Update listen button to toggle between play and pause
const listenButton = document.querySelector('button[data-action="listen"]');
if (listenButton) {
  let isPlaying = false;
  listenButton.addEventListener('click', async () => {
    if (isPlaying) {
      console.warn('Audio is already playing. Preventing duplicate clicks.');
      return;
    }
    isPlaying = true;
    listenButton.textContent = '일시정지 / Pause';
    try {
      await ttsPlay(sent.ko);
    } finally {
      isPlaying = false;
      listenButton.textContent = '듣기 / Écouter';
    }
  });
}
