/* assets/send-results.js  — v2.1 (shared)
 * - One-click only: 중복 클릭/중복 전송 방지 (in-flight, 최근 해시, 서버 dedupe 헤더)
 * - Fancy finish effect: 무지개 보더 + 성공/에러 상태 반짝
 * - Backward compatible: window.sendResults(payload) 그대로 제공
 * - Optional helper: SendResults.attachToButton('#btnFinish', getPayload)
 */
;(function (w, d) {
  'use strict';
  if (w.SendResults?.__v >= 21) return;

  const FN_BASE   = w.PONGDANG_FN_BASE || '/.netlify/functions';
  const ENDPOINT  = `${FN_BASE}/send-results`;
  const LS_KEY    = 'pongdang:lastResults';
  const HASH_KEY  = 'pongdang:lastSubmitHash';
  const TTL_MS    = 5 * 60 * 1000; // 같은 페이로드 5분 내 재전송 방지

  // ---------- tiny utils ----------
  const $ = (s, r=d)=>r.querySelector(s);
  const now = ()=>Date.now();
  function djb2(str){ let h=5381, i=str.length; while(i) h=((h<<5)+h) ^ str.charCodeAt(--i); return (h>>>0).toString(36); }
  function shallowHashPayload(p){
    // 전송 중복 판별에 충분한 특징만(학생/제목/문항수/종료시각 초단위)
    const snap = {
      n: p?.studentName || '',
      t: p?.assignmentTitle || '',
      q: Array.isArray(p?.questions) ? p.questions.length : 0,
      e: p?.endTime ? Math.floor(new Date(p.endTime).getTime()/1000) : 0,
      o: p?.overall ?? null
    };
    return djb2(JSON.stringify(snap));
  }
  function readLastHash(){
    try { const j = JSON.parse(localStorage.getItem(HASH_KEY)||'null'); return j; } catch { return null; }
  }
  function writeLastHash(hash){
    try { localStorage.setItem(HASH_KEY, JSON.stringify({ hash, t: now() })); } catch {}
  }
  function recentSameHash(hash){
    const j = readLastHash();
    return j && j.hash === hash && (now() - (j.t||0) < TTL_MS);
  }

  // ---------- button cosmetics (once) ----------
  let styleInjected = false;
  function injectStyleOnce(){
    if (styleInjected) return;
    styleInjected = true;
    const st = d.createElement('style');
    st.textContent = `
      .finish-btn {
        position: relative; overflow: hidden;
        border-radius: 12px; padding: .65rem 1.1rem;
        font-weight: 800; color: #fff; background: #4f46e5;
        box-shadow: 0 6px 14px rgba(15, 23, 42, .15);
        transition: transform .15s ease, box-shadow .2s ease, background .2s ease;
      }
      .finish-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 18px rgba(15, 23, 42, .18); }
      .finish-btn[disabled]{ opacity:.7; cursor: not-allowed; transform:none; }

      /* rainbow border */
      .finish-btn::before{
        content:""; position:absolute; inset:0; border-radius:14px; padding:2px;
        background: linear-gradient(120deg,#ff0080,#ff8c00,#40e0d0,#8a2be2,#ff0080);
        background-size:300% 300%; animation:sr-border 4s linear infinite;
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor; mask-composite: exclude;
        pointer-events:none;
      }
      @keyframes sr-border { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }

      /* shine sweep */
      .finish-btn .sweep{
        position:absolute; inset:-40% -10%; transform: skewX(-20deg) translateX(-120%);
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent);
        animation: none; pointer-events:none;
      }
      .finish-btn.sending .sweep{ animation: sweep 1.35s ease-out forwards; }
      @keyframes sweep { to{ transform: skewX(-20deg) translateX(160%); } }

      /* states */
      .finish-btn.sending{ background:#6366f1; }
      .finish-btn.sent   { background:#22c55e; }
      .finish-btn.error  { background:#ef4444; }

      /* confetti-ish glow */
      .finish-btn.sparkle {
        animation: sparkle 900ms ease-out 1;
        box-shadow: 0 0 0 rgba(34,197,94,0);
      }
      @keyframes sparkle {
        0%   { box-shadow: 0 0 0 rgba(34,197,94,0);   transform:translateY(0); }
        45%  { box-shadow: 0 0 22px rgba(34,197,94,.70); transform:translateY(-1px);}
        100% { box-shadow: 0 0 0 rgba(34,197,94,0);   transform:translateY(0); }
      }

      /* tiny spinner */
      .finish-spinner{
        display:inline-block; width:1.05em; height:1.05em; vertical-align:-0.15em; margin-right:.45em;
        border-radius:9999px; border:2px solid rgba(255,255,255,.55); border-top-color:rgba(255,255,255,0);
        animation:spin .8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;
    d.head.appendChild(st);
  }

  function enhanceButton(btn){
    if (!btn || btn.__enhanced) return btn;
    injectStyleOnce();
    btn.__enhanced = true;
    btn.classList.add('finish-btn');
    // default labels 저장
    btn._label = btn._label || btn.textContent.trim() || 'Terminer';
    btn._labelSending = btn.getAttribute('data-label-sending') || 'Envoi…';
    btn._labelSent    = btn.getAttribute('data-label-sent')    || 'Envoyé';
    btn._labelError   = btn.getAttribute('data-label-error')   || 'Erreur';
    // sweep layer
    const sw = d.createElement('div'); sw.className = 'sweep'; btn.appendChild(sw);
    return btn;
  }
  function setBtnState(btn, state){
    if (!btn) return;
    btn.classList.remove('sending','sent','error','sparkle');
    if (state==='sending'){
      btn.disabled = true;
      btn.classList.add('sending');
      btn.innerHTML = `<span class="finish-spinner"></span>${btn._labelSending}<div class="sweep"></div>`;
    } else if (state==='sent'){
      btn.disabled = true;
      btn.classList.add('sent','sparkle');
      btn.textContent = `✅ ${btn._labelSent}`;
    } else if (state==='error'){
      btn.disabled = false;
      btn.classList.add('error');
      btn.textContent = `⚠ ${btn._labelError}`;
      // 에러 표시 2초 후 평상복귀
      setTimeout(()=>{ btn.classList.remove('error'); btn.textContent = btn._label; }, 2000);
    } else { // ready
      btn.disabled = false;
      btn.textContent = btn._label;
    }
  }

  // ---------- core send (with dedupe) ----------
  let inflight = false;

  async function coreSend(payload, opts={}){
    // payload는 호출쪽에서 만든 것을 그대로 전송
    const hash = shallowHashPayload(payload);

    // ① 최근 동일 페이로드면 차단
    if (recentSameHash(hash)) {
      return { ok:true, skipped:true, reason:'duplicate-within-ttl' };
    }
    // ② in-flight 중복 차단
    if (inflight) return { ok:false, skipped:true, reason:'inflight' };

    inflight = true;
    try {
      const r = await fetch(ENDPOINT, {
        method:'POST',
        headers: {
          'Content-Type':'application/json',
          // ③ 서버측 idem 헤더(분 단위 버킷) — 서버가 지원하면 안전하게 중복 거부
          'X-Dedupe-ID': `${hash}-${Math.floor(now()/60000)}`,
          'Cache-Control':'no-store'
        },
        body: JSON.stringify(payload)
      });
      const text = await r.text().catch(()=> '');
      let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
      if (!r.ok || (j && j.ok===false)) {
        return { ok:false, status:r.status, body:text, json:j||null };
      }
      writeLastHash(hash);
      return { ok:true, json:j||null, body:text };
    } finally {
      inflight = false;
    }
  }

  // ---------- public helpers ----------
  async function sendResults(payload){
    // 레거시 호환: 전송만
    return await coreSend(payload);
  }

  function attachToButton(target, getPayload, hooks={}){
    const btn = typeof target==='string' ? $(target) : target;
    if (!btn) return null;
    enhanceButton(btn);
    setBtnState(btn,'ready');

    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      if (btn.disabled) return;

      // 사용자가 두들겨도 1회만
      setBtnState(btn,'sending');

      let payload = null;
      try {
        payload = typeof getPayload === 'function' ? await getPayload() : null;
        // fallback: 저장된 결과 사용
        if (!payload) { try { payload = JSON.parse(localStorage.getItem(LS_KEY)||''); } catch {} }
        if (!payload) throw new Error('NO_PAYLOAD');
      } catch (_) {
        setBtnState(btn,'error');
        hooks.onError?.({ reason:'payload_error' });
        return;
      }

      const resp = await coreSend(payload);
      if (resp.ok) {
        setBtnState(btn,'sent');
        hooks.onSuccess?.(resp);
      } else if (resp.skipped && resp.reason==='duplicate-within-ttl') {
        // 이미 보낸 것 — 성공으로 간주
        setBtnState(btn,'sent');
        hooks.onSuccess?.(resp);
      } else {
        setBtnState(btn,'error');
        hooks.onError?.(resp);
      }
    });

    return btn;
  }

  // ---------- auto enhance (optional) ----------
  d.addEventListener('DOMContentLoaded', ()=>{
    const btn = $('#btnFinish');
    if (btn) enhanceButton(btn);
  });

  // ---------- export ----------
  w.SendResults = { attachToButton, sendResults, enhanceButton, __v:21 };
  // 레거시 글로벌 함수 유지
  w.sendResults = sendResults;

})(window, document);
