// assets/warmup-5x5.js
// 워밍업 5×5 (Natifs 1–10 / Hanja 1–10) + 실시간 발음 UI(Pronun.mount)
// - 공개 API: WU_go(speed)  speed ∈ { 'slow'(0.7), 'normal'(1.0), 'fast'(1.5), 'turbo'(2.0) }

(function(){
  'use strict';

  const FN_BASE = (window.PONGDANG_FN_BASE||'/.netlify/functions');
  const SAFE_VOICES = ['alloy','shimmer','verse','nova','fable','echo'];
  const speedMap = { slow:0.7, normal:1.0, fast:1.5, turbo:2.0 };
  let currentSpeed = 'normal';

  // 4그룹 × 5개 (간단 예시): 숫자 읽기용 짧은 항목
  const BUNDLES = [
    { key:'natifs_1_5',  label:'Natifs 1–5',  items:['하나','둘','셋','넷','다섯'] },
    { key:'natifs_6_10', label:'Natifs 6–10', items:['여섯','일곱','여덟','아홉','열'] },
    { key:'hanja_1_5',   label:'Hanja 1–5',   items:['일','이','삼','사','오'] },
    { key:'hanja_6_10',  label:'Hanja 6–10',  items:['육','칠','팔','구','십'] }
  ];

  // --- Utils ---
  function $(sel, root=document){ return root.querySelector(sel); }
  function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
  function escapeHtml(s=''){ return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

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
    } finally {
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    }
  }

  function vAt(i){ return SAFE_VOICES[i % SAFE_VOICES.length]; }

  // --- Render ---
  function render(){
    const wrap = $('#stages-wrap'); if(!wrap) return;
    wrap.innerHTML = '';
    BUNDLES.forEach((b,bi)=>{
      const card = document.createElement('div');
      card.className = 'p-4 border rounded-xl bg-white';
      card.innerHTML = `
        <div class="flex items-center justify-between mb-3">
          <div class="text-xl font-extrabold">${escapeHtml(b.label)}</div>
          <div class="text-sm text-slate-500">Écouter → 🎙️</div>
        </div>
        <div class="grid md:grid-cols-2 gap-3"></div>
      `;
      const grid = $('div.grid', card);

      b.items.forEach((ko, i)=>{
        const el = document.createElement('div');
        el.className = 'dictation-card p-3 border rounded-lg';
        el.innerHTML = `
          <div class="flex items-center gap-3 mb-2">
            <button type="button" class="btn btn-primary btn-sm play">🔊</button>
            <span class="text-lg korean-font">${escapeHtml(ko)}</span>
          </div>
          <div class="mt-2 space-y-2">
            <div class="flex items-center gap-2">
              <button type="button" class="btn btn-secondary btn-rec">🎙️ 녹음</button>
              <button type="button" class="btn btn-secondary btn-stop" disabled>⏹️ Stop</button>
            </div>
            <canvas class="vu" style="width:100%;height:48px;border:1px dashed #c7d2fe;border-radius:.5rem;background:#eef2ff"></canvas>
            <div class="text-sm text-slate-500"><b>실시간 인식:</b> <span class="live"></span></div>
            <div class="text-sm diff-line"><b>원문 vs 내 발음:</b> <span class="diff"></span></div>
          </div>
        `;
        grid.appendChild(el);

        // 듣기
        $('.play', el).addEventListener('click', async (e)=>{
          const btn = e.currentTarget;
          btn.disabled = true; const label = btn.textContent; btn.textContent = '…';
          try{ await ttsPlay(ko, vAt(bi+i), speedMap[currentSpeed]||1.0); }
          catch(_){ alert('오디오 문제. 다시 시도해 주세요.'); }
          finally{ btn.disabled=false; btn.textContent = label; }
        });

        // Pronun.mount
        const refText = String(ko).replace(/\s+/g,'');
        if (window.Pronun && typeof window.Pronun.mount==='function'){
          window.Pronun.mount(el, {
            getReferenceText: ()=>refText,
            onPartial: ({ transcript, diffHtml })=>{
              $('.live', el).textContent = transcript || '';
              $('.diff', el).innerHTML = diffHtml || '';
            },
            onResult: (_)=>{}
          });
        }
      });

      wrap.appendChild(card);
    });

    // 진척점: 단순 토글
    $all('.progress-dot').forEach(d=>d.classList.remove('on'));
    $all('.progress-dot').forEach((d,idx)=>{ if(idx<=1) d.classList.add('on'); });

    // 완료 섹션 표시
    const finish = $('#finish-wrap'); if(finish){ finish.classList.remove('hidden'); }
    const sendBtn = $('#btn-send');
    if(sendBtn){
      sendBtn.onclick = async ()=>{
        alert('✅ 워밍업 결과가 저장되었습니다. (샘플)\n이 페이지는 듣기·녹음 훈련용이라 점수 전송은 생략했어요.');
      };
    }
  }

  // 공개 함수
  window.WU_go = function(mode){
    currentSpeed = speedMap[mode] ? mode : 'normal';
    render();
  };

  // 초기 렌더 (?mode= 가 아닌 경우엔 설명 화면이 먼저라서 여기선 대기)
  document.addEventListener('DOMContentLoaded', ()=>{
    const m = new URLSearchParams(location.search).get('mode');
    if(m) { currentSpeed = speedMap[m]?m:'normal'; render(); }
  });
})();
