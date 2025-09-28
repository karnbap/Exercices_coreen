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

// ===== 간단 정규화 & 빨간색 Diff 출력 =====
const norm = s => String(s||'').trim().replace(/\s+/g,'');
function htmlDiffOnlyWrong(ref, hyp){
  const a = [...norm(ref)], b = [...norm(hyp)];
  const L = Math.max(a.length, b.length);
  let html = "";
  for (let i=0;i<L;i++){
    const r=a[i]||"", h=b[i]||"";
    if (r===h) html += `<span>${r}</span>`;
    else html += `<span style="color:#dc2626">${r||"∅"}</span>`;
  }
  return html || ref;
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
    if (!window.LiveSTT || typeof LiveSTT.start!=='function') return null;
    const { stop } = LiveSTT.start({
      lang:'ko-KR',
      onPartial(txt){ liveBox.textContent = (txt||'').trim() || '…'; }
    });
    return stop;
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
      const html = htmlDiffOnlyWrong(ref, transcript);
      diffBox.innerHTML = html;

      const pct = Math.round((typeof accuracy==='number' ? (accuracy>1?accuracy:accuracy*100) : 0));
      scoreBox.textContent = `정확도: ${pct}% · 길이: ${duration?.toFixed?.(1)||'?'}s`;
    }
  });

  // 녹음 버튼 훅: 공용 위젯의 버튼을 관찰해 실시간 STT 시작/종료
  const obs = new MutationObserver(()=>{
    const recOn = host.querySelector('.pronun-classic, .pronun-warmup')?.textContent?.includes('녹음 중…');
    if (recOn && !sttStop){ sttStop = startLiveSTT(); liveBox.textContent='…'; }
    if (!recOn && sttStop){ try{ sttStop(); }catch(_){} sttStop=null; }
  });
  obs.observe(host, { childList:true, subtree:true });

  return wrap;
}

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', ()=>{
  const mount = document.getElementById('cards');
  SENTENCES.forEach((s, i)=> mount.appendChild(makeCard(i, s)));

  // finish 버튼은 이름 입력되면 자동 활성 (student-gate가 제어)
  document.getElementById('finish-btn')?.addEventListener('click', ()=>{
    alert('연습 종료! (이 페이지는 결과 전송 없이 미니 테스트용입니다)');
  });
});
