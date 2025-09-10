// assets/warmup-5x5.js
// 숫자 5×5 워밍업: 묶음(5개) 단위로 듣기/녹음/실시간 비교
// - 기본 반복: ×2 (state.mode.reps)
// - 속도: slow(0.7), normal(1.0), fast(1.5)  ※ 2.0× 미지원
// - 배속 누르면 페이지 상단으로 스크롤 + 하이라이트(flash-on)

(function(){
  'use strict';

  const FN_BASE = (window.PONGDANG_FN_BASE || '/.netlify/functions');
  const SAFE_VOICES = ['alloy','shimmer','verse','nova','fable','echo'];
  const speedMap = { slow:0.7, normal:1.0, fast:1.5 };

  // 상태
  const state = {
    mode: { speed: 1.0, continuous: false, reps: 2 }, // 기본 2회
    name: 'Élève'
  };

  // 5개 묶음(표시용/합성용 분리)
  const BUNDLES = [
    { key:'natifs_1_5',  label:'Natifs 1–5',  disp:'하나 둘 셋 넷 다섯',     tts:'하나둘셋넷다섯', voice:'alloy'   },
    { key:'natifs_6_10', label:'Natifs 6–10', disp:'여섯 일곱 여덟 아홉 열', tts:'여섯일곱여덟아홉열', voice:'shimmer' },
    { key:'hanja_1_5',   label:'Hanja 1–5',   disp:'일 이 삼 사 오',        tts:'일 이 삼 사 오', voice:'verse'   }, // '일' 또렷
    { key:'hanja_6_10',  label:'Hanja 6–10',  disp:'육 칠 팔 구 십',         tts:'육칠팔구십',     voice:'nova'    }
  ];

  // ==== utils ===============================================================
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
    const payload = { text, voice, speed: rate||1.0 };
    try{
      const res = await fetch(`${FN_BASE}/generate-audio`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      if(!res.ok) throw new Error('TTS '+res.status);
      const j = await res.json();
      const b64 = j.audioData || j.audioBase64 || j.audioContent;
      const mime = j.mimeType || 'audio/wav';
      const blob = base64ToBlob(b64, mime);
      const url = URL.createObjectURL(blob);
      const a = new Audio(); a.preload='auto'; a.src=url;
      await new Promise(r=>a.addEventListener('canplaythrough', r, { once:true }));
      await a.play();
      await new Promise(r=>a.addEventListener('ended', r, { once:true }));
      URL.revokeObjectURL(url);
    }catch(e){
      alert('오디오 문제. 다시 시도해 주세요.');
      try{ fetch(`${FN_BASE}/log-error`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({functionName:'generate-audio',error:String(e),pageUrl:location.href})}); }catch(_){}
    }
  }

  function chipsHtml(text){
    return text.split(/\s+/).map(t=>`<span class="chip">${esc(t)}</span>`).join('');
  }

  // ==== render ==============================================================
  function render(){
    const wrap = $('#stages-wrap'); if(!wrap) return;
    wrap.innerHTML = '';

    BUNDLES.forEach((b,bi)=>{
      const card = document.createElement('div');
      card.className = 'p-4 border rounded-xl bg-white';

      const seqDisp = b.disp.trim();
      const refText = b.tts.replace(/\s+/g,''); // 비교 기준
      const ttsFull = Array.from({length:Math.max(1, state.mode.reps)}).map(()=>b.tts).join(' | ');

      card.innerHTML = `
        <div class="flex items-center justify-between mb-3">
          <div class="min-w-0">
            <div class="text-xl font-extrabold truncate">${esc(b.label)}</div>
            <div class="text-xs text-slate-500">
              <b>Paquet de 5 → ×${state.mode.reps}</b> · <b>5개 묶음 → ${state.mode.reps}회 반복</b>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <label class="text-xs text-slate-600 whitespace-nowrap">
              Répétitions / 반복
              <select class="rep sel border rounded px-2 py-1 text-xs align-middle">
                <option value="2" ${state.mode.reps===2?'selected':''}>×2</option>
                <option value="3" ${state.mode.reps===3?'selected':''}>×3</option>
                <option value="4" ${state.mode.reps===4?'selected':''}>×4</option>
              </select>
            </label>
          </div>
        </div>

        <div class="p-3 rounded-lg bg-slate-50 border text-lg korean-font chips-wrap">
          ${chipsHtml(seqDisp)}
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-4">
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-primary play">🔊 Écouter tout / 전체듣기</button>
            <span class="text-xs text-slate-500">(${state.mode.speed}× · ×${state.mode.reps})</span>
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
        state.mode.reps = Math.max(2, Math.min(4, parseInt(e.target.value,10)||2));
        render();
        // 상단으로 스크롤 & 하이라이트
        const wu = $('#warmup-screen');
        if (wu){ window.scrollTo({ top: wu.offsetTop-8, behavior:'smooth' });
          wu.classList.remove('flash-on'); void wu.offsetWidth; wu.classList.add('flash-on'); setTimeout(()=>wu.classList.remove('flash-on'), 900);
        }
      }, { once:true });

      // 듣기(묶음 전체 재생)
      $('.play', card).addEventListener('click', async (e)=>{
        const btn=e.currentTarget, keep=btn.textContent;
        btn.disabled=true; btn.textContent='…';
        try{ await ttsPlay(ttsFull, b.voice || vAt(bi), state.mode.speed); }
        finally{ btn.disabled=false; btn.textContent=keep; }
      });

      // Pronun.mount (🎙️ 버튼/파형/실시간 텍스트/차이표시 연결)
      if (window.Pronun && typeof window.Pronun.mount==='function'){
        window.Pronun.mount(card, {
          getReferenceText: ()=> refText.repeat(Math.max(1,state.mode.reps)),
          selectors: { rec: '.btn-rec', stop: '.btn-stop', canvas: '.vu', live: '.live', diff: '.diff' },
          onPartial: ({ transcript, diffHtml })=>{
            $('.live', card).textContent = transcript || '';
            $('.diff', card).innerHTML = diffHtml || '';
          },
          onResult: (_)=>{}
        });
      } else {
        // 라이브러리 없으면 안내
        $('.btn-rec', card).addEventListener('click',()=>alert('녹음 모듈(pronun-client.js)을 불러오지 못했어요.'));
      }

      wrap.appendChild(card);
    });

    // 완료 섹션 보이기
    $('#finish-wrap')?.classList.remove('hidden');
  }

  // ==== 공개 API ============================================================
  function WU_go(mode){
    if(mode === 'slow')      state.mode = { speed:0.7, continuous:false, reps:2 };
    else if(mode === 'fast') state.mode = { speed:1.5, continuous:true,  reps:2 };
    else                     state.mode = { speed:1.0, continuous:false, reps:2 };

    state.name = ($('#student-name')?.value || state.name || 'Élève');

    // 화면 토글
    $('#mode-picker')?.classList.add('hidden');
    const wu = $('#warmup-screen');
    if(wu) wu.classList.remove('hidden');

    render();

    // 상단으로 스크롤 + 하이라이트
    if (wu){
      window.scrollTo({ top: wu.offsetTop-8, behavior:'smooth' });
      wu.classList.remove('flash-on'); void wu.offsetWidth; wu.classList.add('flash-on');
      setTimeout(()=>wu.classList.remove('flash-on'), 900);
    }
  }
  window.WU_go = WU_go;

  // 쿼리로 바로 진입(?mode=)
  document.addEventListener('DOMContentLoaded', ()=>{
    const m = new URLSearchParams(location.search).get('mode');
    if(m){ WU_go(m); }
  });
})();
