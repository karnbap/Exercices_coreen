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

const norm = (s)=> String(s||'')
  .normalize('NFC')
  .toLowerCase()
  .replace(/\s+/g,'')
  .replace(/[^0-9A-Za-z가-힣]/g,'');


function htmlDiffOnlyWrong(refRaw, hypRaw){
  const ref = [...norm(refRaw)], hyp = [...norm(hypRaw)];
  const m = ref.length, n = hyp.length;
  // LCS 테이블
  const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
  for (let i=1;i<=m;i++){
    for (let j=1;j<=n;j++){
      dp[i][j] = ref[i-1]===hyp[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }
  // LCS 역추적 → ref 기준으로 일치/불일치 마킹
  let i=m, j=n, keep = new Array(m).fill(false);
  while (i>0 && j>0){
    if (ref[i-1]===hyp[j-1]){ keep[i-1]=true; i--; j--; }
    else if (dp[i-1][j] >= dp[i][j-1]) i--; else j--;
  }
  // 원문 출력 시, 빨간색은 refRaw의 원문 글자 단위로(공백/문장부호 포함) 맞춰줌
  // refRaw를 NFC로 토큰화하여 매핑
  const tokens = [...refRaw.normalize('NFC')];
  // ref와 tokens의 글자수 차이가 있을 수 있어 보수적으로 진행
  let k = 0;
  let html = '';
  for (let t=0; t<tokens.length; t++){
    const ch = tokens[t];
    // 한글/영문/숫자만 카운트 대상
    const isCore = /\p{Letter}|\p{Number}|\p{Script=Hangul}/u.test(ch);
    if (isCore){
      const ok = keep[k]===true;
      html += ok ? `<span>${ch}</span>` : `<span style="color:#dc2626">${ch}</span>`;
      k++;
    } else {
      // 문장부호/공백은 비교 대상 아님: 그대로 정상 색상
      html += `<span>${ch}</span>`;
    }
  }
  return html;
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
        <div class="pronun-title">원문 / Référence (KO)</div>
        <div class="p-2 border rounded bg-white text-lg" data-ref>${sent.ko}</div>
      </div>
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

  // 녹음 위젯 장착 (공용) — stop 후 “평가” 클릭 가능
  const host = wrap.querySelector('[data-pronun]');
  const liveBox = wrap.querySelector('[data-live]');
  const diffBox = wrap.querySelector('[data-diff]');
  const scoreBox= wrap.querySelector('[data-score]');
  const getRef  = ()=> sent.ko;

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
      const ref = sent.ko;
      const html = (()=>{    try { return htmlDiffOnlyWrong(ref, transcript); }    catch(e){ console.error('[diff]', e); return `<span>${ref}</span>`; }  })();
      diffBox.innerHTML = html;

      const acc = (typeof accuracy==='number' ? accuracy : 0); const pct = Math.round((acc > 1 ? acc : acc * 100));
      scoreBox.textContent = `정확도: ${pct}% · 길이: ${duration?.toFixed?.(1)||'?'}s`;
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
  });
  obs.observe(host, { childList:true, subtree:true });
    mergeStopAndEvaluate();
  setTimeout(mergeStopAndEvaluate, 200);

    // Stop + 평가 버튼 합치기
  function mergeStopAndEvaluate(){
    const allBtns = Array.from(host.querySelectorAll('button'));
    const findByText = (re) => allBtns.find(b => re.test((b.textContent||'').trim().toLowerCase()));
    const stopBtn = findByText(/^(stop|arrêter|멈추기|정지)$/i);
    const evalBtn = findByText(/^(évaluer|평가|evaluate)$/i);
    if (!stopBtn || !evalBtn) return;

    if (!stopBtn.dataset.merged) {
      // 평가 버튼 숨김
      evalBtn.style.display = 'none';
      // Stop 버튼 라벨 교체
      stopBtn.textContent = '멈추고 평가 / Arrêter & Évaluer';
      stopBtn.dataset.merged = '1';

      // 클릭 시: 원래 Stop 동작 → 아주 짧은 대기 → 평가 버튼 강제 클릭
      stopBtn.addEventListener('click', () => {
        setTimeout(() => { try { evalBtn.click(); } catch(_) {} }, 60);
      }, { once:false });
    }
  }

    mergeStopAndEvaluate();

  return wrap;
}
// ===== 페이지 전용 스타일 주입(그래프 제거 + 텍스트 크게) =====
(function injectPronunStyles(){
  const css = `
  /* 파형/그래프 계열 통째로 숨김 (여러 위젯 버전 대응) */
  .pronun-card canvas,
  .pronun-graph,
  .pronun-visualizer,
  .pd-wave,
  .wave,
  .waveform { display:none !important; height:0 !important; }
  /* 실시간 텍스트 크게 + 여백 */
  .pronun-live { font-size:1.6rem; line-height:1.9rem; padding:14px 16px; min-height:80px; }
  @media (min-width:768px){ .pronun-live{ font-size:2rem; line-height:2.4rem; min-height:100px; } }
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
