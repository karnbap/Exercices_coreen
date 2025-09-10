// assets/warmup-5x5.js
// 5×5 묶음 워밍업: 그룹(5개) 단위로 듣기/녹음/실시간 인식/비교
// - 기본 반복 ×2 (Répétitions par défaut)
// - UI 이중언어 표기
// - Pronun.mount 셀렉터 명시로 🎙️ 버튼 미동작 이슈 방지

(function () {
  'use strict';

  const FN_BASE = (window.PONGDANG_FN_BASE || '/.netlify/functions');
  const SAFE_VOICES = ['alloy','shimmer','verse','nova','fable','echo'];
  const speedMap = { slow:0.7, normal:1.0, fast:1.5, turbo:2.0 };
  let currentSpeed = 'normal';
  let repeatCount = 2; // ✅ 기본 2회

  // 표시용(disp)과 TTS용(tts)을 분리: 화면은 칩으로 보기 좋게, 소리는 노래처럼 연속
  const BUNDLES = [
    { key:'natifs_1_5',  label:'Natifs 1–5',  disp:'하나 둘 셋 넷 다섯',     tts:'하나둘셋넷다섯', voice:'alloy'   },
    { key:'natifs_6_10', label:'Natifs 6–10', disp:'여섯 일곱 여덟 아홉 열', tts:'여섯일곱여덟아홉열', voice:'shimmer' },
    // '일' 모호성 방지: 띄어 읽기 유지
    { key:'hanja_1_5',   label:'Hanja 1–5',   disp:'일 이 삼 사 오',        tts:'일 이 삼 사 오', voice:'verse'   },
    { key:'hanja_6_10',  label:'Hanja 6–10',  disp:'육 칠 팔 구 십',         tts:'육칠팔구십',     voice:'nova'    },
  ];

  // ---------- Utils ----------
  const $  = (s,r=document)=>r.querySelector(s);
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
      setTimeout(()=>URL.revokeObjectURL(url), 400);
    }
  }

  function chipsHtml(text){ // 칩 UI로 줄바꿈 가독성
    return text.split(/\s+/).map(t=>`<span class="chip">${esc(t)}</span>`).join('');
  }

  // ---------- Render ----------
  function render(){
    const wrap = $('#stages-wrap'); if(!wrap) return;
    wrap.innerHTML = '';

    BUNDLES.forEach((b,bi)=>{
      const card = document.createElement('div');
      card.className = 'p-4 border rounded-xl bg-white';

      const seqDisp = b.disp.trim();
      const seqTTS  = b.tts.trim();
      const seqRef  = seqTTS.replace(/\s+/g,''); // 채점 비교 기준(공백 제거)
      const ttsFull = Array.from({length:repeatCount}).map(()=>seqTTS).join(' | ');

      card.innerHTML = `
        <div class="flex items-center justify-between mb-3">
          <div class="min-w-0">
            <div class="text-xl font-extrabold truncate">${esc(b.label)}</div>
            <div class="text-xs text-slate-500">
              <b>Paquet de 5 → ×${repeatCount}</b> · <b>5개 묶음 → ${repeatCount}회 반복</b>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <label class="text-xs text-slate-600 whitespace-nowrap">
              Répétitions / 반복
              <select class="rep sel border rounded px-2 py-1 text-xs align-middle">
                <option value="2" ${repeatCount===2?'selected':''}>×2</option>
                <option value="3" ${repeatCount===3?'selected':''}>×3</option>
                <option value="4" ${repeatCount===4?'selected':''}>×4</option>
              </select>
            </label>
          </div>
        </div>

        <!-- 칩 UI (가독성) -->
        <div class="p-3 rounded-lg bg-slate-50 border text-lg korean-font chips-wrap">
          ${chipsHtml(seqDisp)}
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-4">
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-primary play">🔊 Écouter tout / 전체듣기</button>
            <span class="text-xs text-slate-500">(${esc(currentSpeed)} · ×${repeatCount})</span>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-secondary btn-rec">🎙️ Enregistrer / 녹음</button>
            <button type="button" class="btn btn-secondary btn-stop" disabled>⏹️ Stop</button>
          </div>
        </div>

        <canvas class="vu" style="width:100%;height:44px;border:1px dashed #c7d2fe;border-radius:.5rem;background:#eef2ff;margin-top:.6rem"></canvas>
        <div class="text-sm text-slate-600 mt-2">
          <b>Reconnaissance en direct / 실시간 인식:</b> <span class="live"></span>
        </div>
        <div class="text-sm diff-line">
          <b>Référence vs ma prononciation / 원문 vs 내 발음:</b> <span class="diff"></span>
        </div>
      `;

      // 반복 선택
      $('.rep', card).addEventListener('change', (e)=>{
        repeatCount = Math.max(2, Math.min(4, parseInt(e.target.value,10)||2));
        render();
      }, { once:true });

      // 듣기(그룹 전체)
      $('.play', card).addEventListener('click', async (e)=>{
        const btn=e.currentTarget, keep=btn.textContent;
        btn.disabled=true; btn.textContent='…';
        try{
          await ttsPlay(ttsFull, b.voice || vAt(bi), speedMap[currentSpeed]||1.0);
        }catch(err){
          alert('오디오 오류. 다시 시도해 주세요.');
          fetch(`${FN_BASE}/log-error`,{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({functionName:'ttsPlay',error:String(err),pageUrl:location.href})}).catch(()=>{});
        }finally{
          btn.disabled=false; btn.textContent=keep;
        }
      });

      // 🎙️ Pronun.mount — 셀렉터를 명시해서 버튼 미동작 방지
      if (window.Pronun && typeof window.Pronun.mount==='function'){
        window.Pronun.mount(card, {
          getReferenceText: ()=> seqRef.repeat(repeatCount),
          selectors: { rec: '.btn-rec', stop: '.btn-stop', canvas: '.vu', live: '.live', diff: '.diff' },
          onPartial: ({ transcript, diffHtml })=>{
            $('.live', card).textContent = transcript || '';
            $('.diff', card).innerHTML = diffHtml || '';
          },
          onResult: (_)=>{}
        });
      }

      // 칩 너비가 너무 길어지면 자동 줄바꿈 (CSS로 처리되지만 컨테이너 최대폭 보장)
      wrap.appendChild(card);
    });

    // 진행점/완료
    $$('.progress-dot').forEach(d=>d.classList.add('on'));
    $('#finish-wrap')?.classList.remove('hidden');

    $('#btn-send')?.addEventListener('click', ()=>{
      alert('✅ 워밍업 완료! (발음 훈련: 요약만 표시)');
    }, { once:true });
  }

  // 공개 함수
  window.WU_go = function(mode){
    currentSpeed = speedMap[mode] ? mode : 'normal';
    render();
  };

  document.addEventListener('DOMContentLoaded', ()=>{
    const m = new URLSearchParams(location.search).get('mode');
    if(m) { currentSpeed = speedMap[m]?m:'normal'; render(); }
  });
})();
