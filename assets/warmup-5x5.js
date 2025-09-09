// assets/warmup-5x5.js
// 5×5 워밍업 (숫자 5개씩 묶어 '노래처럼' 여러 번 듣고 녹음/평가)
// - 그룹 단위(묶음)로: 🔊전체듣기 / 🎙️녹음 / ⏹️정지 / 실시간 인식 / 원문 vs 내 발음 Diff
// - 공개: WU_go('slow'|'normal'|'fast'|'turbo')

(function(){
  'use strict';

  const FN_BASE = (window.PONGDANG_FN_BASE||'/.netlify/functions');
  const SAFE_VOICES = ['alloy','shimmer','verse','nova','fable','echo'];
  const speedMap = { slow:0.7, normal:1.0, fast:1.5, turbo:2.0 };
  let currentSpeed = 'normal';
  let repeatCount = 3; // 한 묶음당 몇 번 반복해서 읽을지(노래처럼)

  // ⬇️ 5개씩 '묶음' (공백으로 끊어 발음 또렷: 특히 '일'이 '이리'로 들리지 않게!)
  const BUNDLES = [
    { key:'natifs_1_5',  label:'Natifs 1–5',  seq:'하나 둘 셋 넷 다섯' },
    { key:'natifs_6_10', label:'Natifs 6–10', seq:'여섯 일곱 여덟 아홉 열' },
    { key:'hanja_1_5',   label:'Hanja 1–5',   seq:'일 이 삼 사 오' },   // '일' 띄어 읽기!
    { key:'hanja_6_10',  label:'Hanja 6–10',  seq:'육 칠 팔 구 십' }
  ];

  // --- Utils ---
  const $ = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc = (s='')=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const vAt = i => SAFE_VOICES[i % SAFE_VOICES.length];

  function base64ToBlob(base64, mime="audio/wav"){
    const bin=atob(base64), len=bin.length, bytes=new Uint8Array(len);
    for(let i=0;i<len;i++) bytes[i]=bin.charCodeAt(i);
    return new Blob([bytes], {type:mime});
  }

  async function ttsPlay(text, voice, rate){
    const res = await fetch(`${FN_BASE}/generate-audio`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ text, voice, speed: rate||1.0 })
    });
    if(!res.ok) throw new Error('TTS '+res.status);
    const { audioData, mimeType } = await res.json();
    const blob = base64ToBlob(audioData, mimeType||'audio/wav');
    const url = URL.createObjectURL(blob);
    try{
      const a = new Audio();
      a.preload='auto'; a.src=url;
      await new Promise(r=>a.addEventListener('canplaythrough', r, {once:true}));
      await a.play();
      await new Promise(r=>a.addEventListener('ended', r, {once:true}));
    } finally {
      setTimeout(()=>URL.revokeObjectURL(url), 500);
    }
  }

  // --- Render ---
  function render(){
    const wrap = $('#stages-wrap'); if(!wrap) return;
    wrap.innerHTML = '';

    BUNDLES.forEach((b,bi)=>{
      const card = document.createElement('div');
      card.className = 'p-4 border rounded-xl bg-white';

      // 그룹 문장(반복용): "하나 둘 셋 넷 다섯 | ..." × repeatCount
      const seqOne = b.seq.trim();
      const seqPlay = Array.from({length:repeatCount}).map(()=>seqOne).join(' | ');
      const refText = seqOne.replace(/\s+/g,''); // 채점용(공백 제거)

      card.innerHTML = `
        <div class="flex items-center justify-between mb-3">
          <div>
            <div class="text-xl font-extrabold">${esc(b.label)}</div>
            <div class="text-sm text-slate-500">5개 묶음 → ${repeatCount}회 반복</div>
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm text-slate-500">반복:
              <select class="rep sel border rounded px-2 py-1 text-sm">
                <option value="2">×2</option>
                <option value="3" selected>×3</option>
                <option value="4">×4</option>
              </select>
            </label>
          </div>
        </div>

        <div class="p-3 rounded-lg bg-slate-50 border text-lg korean-font">${esc(seqOne)}</div>

        <div class="mt-3 flex flex-wrap items-center gap-8">
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-primary play">🔊 전체듣기</button>
            <span class="text-sm text-slate-500">(${esc(currentSpeed)} · ${repeatCount}회)</span>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-secondary btn-rec">🎙️ 녹음</button>
            <button type="button" class="btn btn-secondary btn-stop" disabled>⏹️ Stop</button>
          </div>
        </div>

        <canvas class="vu" style="width:100%;height:48px;border:1px dashed #c7d2fe;border-radius:.5rem;background:#eef2ff;margin-top:.75rem"></canvas>
        <div class="text-sm text-slate-600 mt-2"><b>실시간 인식:</b> <span class="live"></span></div>
        <div class="text-sm diff-line"><b>원문 vs 내 발음:</b> <span class="diff"></span></div>
      `;

      // 반복 선택 변경
      $('.rep', card).addEventListener('change', e=>{
        repeatCount = Math.max(2, Math.min(6, parseInt(e.target.value,10)||3));
        render();
      }, { once:true });

      // 듣기(그룹 전체)
      $('.play', card).addEventListener('click', async (e)=>{
        const btn=e.currentTarget, keep=btn.textContent;
        btn.disabled=true; btn.textContent='…';
        try{
          const text = Array.from({length:repeatCount}).map(()=>seqOne).join(' | ');
          await ttsPlay(text, vAt(bi), speedMap[currentSpeed]||1.0);
        }catch(err){
          alert('오디오 오류. 다시 시도해 주세요.');
          fetch(`${FN_BASE}/log-error`,{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({functionName:'ttsPlay',error:String(err),pageUrl:location.href})}).catch(()=>{});
        }finally{
          btn.disabled=false; btn.textContent=keep;
        }
      });

      // Pronun.mount (그룹 단위)
      if (window.Pronun && typeof window.Pronun.mount==='function'){
        window.Pronun.mount(card, {
          getReferenceText: ()=>refText.repeat(repeatCount), // 반복 길이에 맞춰 비교
          onPartial: ({ transcript, diffHtml })=>{
            $('.live', card).textContent = transcript || '';
            $('.diff', card).innerHTML = diffHtml || '';
          },
          onResult: (_)=>{}
        });
      }

      wrap.appendChild(card);
    });

    // 진행점/완료
    $$('.progress-dot').forEach(d=>d.classList.add('on'));
    $('#finish-wrap')?.classList.remove('hidden');

    // 전송 버튼(워밍업은 요약 알림만)
    $('#btn-send')?.addEventListener('click', ()=>{
      alert('✅ 워밍업 완료! (이 단계는 발음 훈련용 — 결과 요약만 표시합니다)');
    }, { once:true });
  }

  // 공개 함수
  window.WU_go = function(mode){
    currentSpeed = speedMap[mode] ? mode : 'normal';
    render();
  };

  // 초기 (?mode= 있으면 바로 렌더)
  document.addEventListener('DOMContentLoaded', ()=>{
    const m = new URLSearchParams(location.search).get('mode');
    if(m) { currentSpeed = speedMap[m]?m:'normal'; render(); }
  });
})();
