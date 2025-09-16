// assets/pronun-client.js  (v4.5 patched)
// 공용 발음기: Pronun.mount(el, { getReferenceText:()=>string, onResult:(res)=>void, ui:'classic'|'warmup' })
// - 기본값은 classic → 기존 연습문제 영향 없음
// - ui:'warmup' 시 워밍업 스타일(녹음/정지/평가 + VU + LiveSTT 훅) 사용
// - 내부 로직/채점/네트워크 동일
(function (global) {
  'use strict';
  if (global.Pronun && Number(global.Pronun.__v||0) >= 45) return;

  global.PRONUN_UI_DEFAULT = global.PRONUN_UI_DEFAULT || 'classic';

  const CFG = {
    endpoint: (global.PONGDANG_FN_BASE || '/.netlify/functions') + '/analyze-pronunciation',
    minSec: 1.0,   // 최소 발화 길이 (기존 0.8s → 1.0s)
    maxSec: 12,
    canvasW: 240, canvasH: 40,
    passBase: 0.75, passShortRef: 0.80, shortRefLen: 4,
    lowSimil: 0.35, lenRatioGarbage: 2.5,
    garbageWords: [
      '배달의민족','영상편집','자막','광고','구독','좋아요','알림설정','스폰서',
      '후원','협찬','문의','링크','다운로드','설명란','채널','스트리밍','썸네일',
      '유튜브','클릭','이벤트','특가','광고주','제휴','비디오','구매','할인'
    ]
  };

  // ===== Utils =====
  function h(tag, attrs = {}, ...kids) { const el = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else el.setAttribute(k, attrs[k]);
    }
    kids.forEach(k => el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
    return el;
  }
  function pickMime() {
    const M = window.MediaRecorder;
    if (!M || !M.isTypeSupported) return 'audio/webm';
    if (M.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
    if (M.isTypeSupported('audio/webm')) return 'audio/webm';
    if (M.isTypeSupported('audio/mp4')) return 'audio/mp4';
    return 'audio/webm';
  }
  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = rej;
      fr.onload = () => res(String(fr.result || '').split(',')[1] || '');
      fr.readAsDataURL(blob);
    });
  }
  async function postJSON(url, payload) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) { const t = await r.text().catch(()=>''); throw new Error(`HTTP ${r.status} ${t}`); }
    return r.json();
  }
  function normalizeKo(s){
    if(!s) return { raw:'', ko:'' };
    let t = String(s).toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF]/g,'')
      .replace(/[.,!?;:()[\]{}"“”'‘’`~^%$#+=<>…]/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    const onlyKo = t.replace(/[^ㄱ-ㅎ가-힣0-9\s]/g,'').replace(/\s+/g,'').trim();
    return { raw:t, ko:onlyKo };
  }
  function similarity(a, b){
    if(a===b) return 1; const m=a.length,n=b.length; if(!m||!n) return 0;
    const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
    for(let i=0;i<=m;i++) dp[i][0]=i; for(let j=0;j<=n;j++) dp[0][j]=j;
    for(let i=1;i<=m;i++)for(let j=1;j<=n;j++){
      const cost = a[i-1]===b[j-1]?0:1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
    return 1 - (dp[m][n] / Math.max(m,n));
  }
  function localForceHangulNumbers(s){
    let x = String(s||'');
    x = x.replace(/\b1\b/g,'일').replace(/\b2\b/g,'이');
    x = x.replace(/(^|[^0-9])1([^0-9]|$)/g,'$1일$2');
    x = x.replace(/(^|[^0-9])2([^0-9]|$)/g,'$1이$2');
    return x;
  }
  function coerceTowardsRef(refRaw, hypRaw) {
    let out = hypRaw; const ref = refRaw.replace(/\s+/g,''), hyp = hypRaw.replace(/\s+/g,'');
    const RULES = [
      { when: /^일$/,  hyp: /^(하나|한|1|Ⅰ)$/, to:'일' },
      { when: /^이$/,  hyp: /^(둘|두|2|Ⅱ)$/,   to:'이' },
      { when: /^(일일)$/, hyp: /(한일|하닐|한닐|1일|Ⅰ일)/, to:'일일' },
      { when: /^(이일)$/, hyp: /(두일|둘일|2일|Ⅱ일)/,       to:'이일' },
      { when: /사일/,     hyp: /(네일|내일)/,           to:'사일' },
      { when: /한시/,     hyp: /일시/,                  to:'한시' },
      { when: /십유로/,   hyp: /열유로/,                to:'십유로' },
      { when: /삼십분/,   hyp: /서른분/,                to:'삼십분' },
      { when: /세살/,     hyp: /삼살/,                  to:'세살' }
    ];
    for (const r of RULES) if (r.when.test(ref) && r.hyp.test(hyp)) return r.to;
    return out;
  }

  // === Garbage transcript guard ===
  function isGarbageTranscript(refN, hypN, rawTranscript, durSec) {
    const koRef = refN?.ko || ''; const koHyp = hypN?.ko || ''; const raw = String(rawTranscript || '').trim();
    if (!Number.isFinite(durSec) || durSec < CFG.minSec) return { bad:true, reason:'too_short' };
    if (!koHyp || koHyp.length < 2) return { bad:true, reason:'empty_or_tiny' };
    // 한국어 비율 체크
    const rawNoSpace = (hypN.raw || '').replace(/\s+/g,'');
    const koRatio = hypN.ko.length / Math.max(1, rawNoSpace.length);
    if (koRatio < 0.35) return { bad:true, reason:'low_korean_ratio' };
    if (koRef && koHyp.length > Math.max(6, koRef.length * CFG.lenRatioGarbage))
      return { bad:true, reason:'too_long_vs_ref' };
    if (CFG.garbageWords.some(w => raw.includes(w))) return { bad:true, reason:'blacklist' };
    const sim = similarity(koRef, koHyp);
    if (koRef && koRef.length >= CFG.shortRefLen && sim < CFG.lowSimil)
      return { bad:true, reason:'very_low_similarity' };
    return { bad:false };
  }

  // ===== VU, UI ===== (생략: 기존 그대로 유지)

  // ... buildClassicUI / buildWarmupUI / mount 정의 그대로 ...
  // [중략: 원본과 동일, 차이는 evalRec 내부만 아래처럼 수정됨]

async function evalRec(){
  if (evalBusy) return;

  // ⛔ 최소 발화 길이 가드 — 너무 짧으면 평가 자체 중단(+다시 시도 가능)
  if (lastDur < CFG.minSec) {
    ui.msg.textContent = `⏱️ 좀 더 길게 말해 주세요 (≥ ${CFG.minSec}s) / Parlez un peu plus longtemps`;
    // ▶ 다시 시도 가능하도록 버튼 상태 복구
    ui.btnStart.disabled = false;
    ui.btnStop.disabled  = true;
    ui.btnEval.disabled  = true;
    return;
  }

  if (!chunks.length) {
    ui.msg.textContent = '🔁 먼저 녹음하세요 / Enregistrez d’abord';
    ui.btnStart.disabled = false;
    ui.btnStop.disabled  = true;
    ui.btnEval.disabled  = true;
    return;
  }
  const refOrig = String(getRef()||'').trim();
  if (!refOrig){
    ui.msg.textContent = '📝 문장 준비 중 / Phrase non prête';
    ui.btnStart.disabled = false;
    ui.btnStop.disabled  = true;
    ui.btnEval.disabled  = true;
    return;
  }

  evalBusy = true;
  // ... (이하 기존 로직 유지)
}

  // 이하 기존 로직 유지…

      const blob = new Blob(chunks, { type: (mime.split(';')[0]||'audio/webm') });
      const base64 = await blobToBase64(blob);
      ui.msg.textContent = '⏳ Évaluation… / 평가 중…';
let transcript = '', accuracy = null, needsRetry = false;

try {
  const res = await postJSON(CFG.endpoint, {
    referenceText: refOrig,
    options: { strictTranscript: true, disableLM: true },
    audio: {
      base64,
      mimeType: blob.type || 'audio/webm',
      filename: 'rec.webm',
      duration: lastDur
    }
  });
  accuracy = res?.accuracy ?? null;
  transcript = String(res?.transcript || '');
  needsRetry = !!res?.needsRetry;
} catch (e) {
  ui.msg.textContent='⚠️ Analyse indisponible. Réessaie. / 서버 오류';
  evalBusy=false; try{ onResult({ status:'error', reason:'server_error' }); }catch(_){}
  return;
}

// 👉 서버 응답을 받은 "다음"에 빈/초단편 가드
if (!transcript || transcript.replace(/\s+/g,'').length < 2) {
  const out = { status:'retry', transcript:'', accuracy:0, needsRetry:true, duration:lastDur, reason:'too_short_transcript' };
  ui.msg.textContent = '⚠️ 더 또렷하고 길게 말해 주세요 / Parlez plus clairement et un peu plus longtemps';
  try { onResult(out); } catch(_) {}
  evalBusy = false;
  return;
}

transcript = localForceHangulNumbers(transcript);
const refForCoerce = localForceHangulNumbers(refOrig);
transcript = coerceTowardsRef(refForCoerce, transcript);

const refN = normalizeKo(refForCoerce);
const hypN = normalizeKo(transcript);
const g = isGarbageTranscript(refN, hypN, transcript, lastDur);
if (g.bad) {
  const out = { status:'retry', transcript:'', accuracy:0, needsRetry:true, duration:lastDur, reason:g.reason };
  ui.msg.textContent = '⚠️ Parlez plus distinctement. / 또박또박 더 분명하게 말해요.';
  try { onResult(out); } catch(_) {}
  evalBusy=false; return;
}

      const g = isGarbageTranscript(refN, hypN, transcript, lastDur);
      if (g.bad) {
        const out = { status:'retry', transcript:'', accuracy:0, needsRetry:true, duration:lastDur, reason:g.reason };
        ui.msg.textContent = '⚠️ Parlez plus distinctement. / 또박또박 더 분명하게 말해요.';
        try { onResult(out); } catch(_) {}
        evalBusy=false; return;
      }

      // 이하 원본과 동일 (needsRetry 보정, accuracy 보정, out 구성, 콜백, 상태 업데이트)
    }

  // ===== 공개 API =====
  global.Pronun = { mount, __v: 45 };
})(window);
