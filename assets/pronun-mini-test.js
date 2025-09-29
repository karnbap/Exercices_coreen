// assets/pronun-mini-test.js
// 발음 난이도 높은 자모/단어 포함 3문장 + 듣기 + 녹음(실시간) + 평가(오류만 빨간색)
// - 듣기: /.netlify/functions/generate-audio (wav/ogg → Blob URL로 재생)
// - 녹음/평가: 공용 Pronun.mount 사용 (서버 analyze-pronunciation)
// - 실시간 STT: window.LiveSTT가 있으면 부분 자막 표시(옵션)

// ===== 문장 세트: Etape1 (짧은 문장) + Etape2 (긴 문장, 자연스러운 TTS) =====
const SENTENCES = [
  // Etape 1: 각 카드에서 문장을 숨기고 '듣고 따라하기' 안내를 표시합니다.
  { ko: "오늘 아침 우리 가족끼리 마을을 산책했는데", fr: "", hideText:true, voice:'shimmer', speed:1.05, hint1:"오늘 아침 / 가족 / 산책", hint2:"ㅇㅇ ㅁㅊ / ㄱㅈ / ㅅㅊ" },
  { ko: "그때 제 딸이 제가 배고프냐고 물어봤어요.", fr: "", hideText:true, voice:'shimmer', speed:1.05, hint1:"딸 / 배고프냐고 / 물어봤어요", hint2:"ㄸㅏㄹ / ㅂㄱㅍㄴㅇ / ㅁㄹㅇㅂㅇ" },
  { ko: "제가 그렇다고 대답하고", fr: "", hideText:true, voice:'shimmer', speed:1.05, hint1:"그렇다 / 대답", hint2:"ㄱㄹㅎㄱㄷ / ㄷㄷ" },
  { ko: "딸한테 빵 좀 사 달라고 했더니", fr: "", hideText:true, voice:'shimmer', speed:1.05, hint1:"빵 / 사 달라고 / 딸한테", hint2:"ㅂㅂ / ㅅ ㄷㄹㄱ / ㄸㄹㅎㅌ" },
  { ko: "딸이 돈이 없다고 했어요.", fr: "", hideText:true, voice:'shimmer', speed:1.05, hint1:"돈 / 없다고 / 했어요", hint2:"ㄷㄴ / ㅇㅂㄷㄱ / ㅎㅅㅇ" },
  { ko: "그래서 제가 딸에게 엄마한테 돈이 있냐고", fr: "", hideText:true, voice:'shimmer', speed:1.05, hint1:"엄마 / 돈이 있냐고 / 딸에게", hint2:"ㅇㅁㅁ / ㄷㄴㅇ ㅇㅈㄱ / ㄸㄹㅇㄱ" },
  { ko: "물어보자고 했는데 다행히 아내가 돈이 있어서", fr: "", hideText:true, voice:'shimmer', speed:1.05, hint1:"물어보자고 / 다행히 / 아내", hint2:"ㅁㄹㅂㅈㄱ / ㄷㅎㅎ / ㅇㄴ" },
  { ko: "아내가 저희한테 저한테 빵을 사줬어요.", fr: "", hideText:true, voice:'shimmer', speed:1.05, hint1:"아내 / 빵을 사줬어요 / 저희한테", hint2:"ㅇㄴ / ㅂㅇ ㅅㅈㅇㅇ / ㅈㅎㅎㅌ" },
  { ko: "아내가 최고예요!", fr: "", hideText:true, voice:'shimmer', speed:1.05, hint1:"최고 / 예요", hint2:"ㅊㄱ / ㅇㅇ" },

  // Etape 2: 더 긴 문장들, 더 자연스러운 TTS(voice:'natural', 속도 약간 느리게)
  { ko: "오늘 아침 우리 가족끼리 마을을 산책했는데 그때 제 딸이 제가 배고프냐고 물어봤어요.", fr: "", hideText:false, voice:'natural', speed:0.98, hint1:"오늘 아침 / 가족 / 배고프냐고", hint2:"오늘/아침 / 가족 / 배고프냐" },
  { ko: "제가 그렇다고 대답하고 딸한테 빵 좀 사 달라고 했더니 딸이 돈이 없다고 했어요.", fr: "", hideText:false, voice:'natural', speed:0.98, hint1:"대답하고 / 빵 좀 사 달라고 / 돈이 없다고", hint2:"대답 / 빵 / 돈" },
  { ko: "그래서 제가 딸에게 엄마한테 돈이 있냐고 물어보자고 했는데 다행히 아내가 돈이 있어서 아내가 저희한테 저한테 빵을 사줬어요. 아내가 최고예요!", fr: "", hideText:false, voice:'natural', speed:0.98, hint1:"엄마한테 돈 / 아내가 빵 사줬어요 / 최고예요", hint2:"엄마/돈 / 아내/빵 / 최고" }
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
  a.addEventListener('ended', ()=>{ try{ URL.revokeObjectURL(url); }catch(_){} }, { once:true });
  // start playback and return the audio element immediately so callers can
  // control pause/resume UI without awaiting the entire play duration.
  a.play().catch(()=>{ try{ URL.revokeObjectURL(url); }catch(_){} });
  a.durationEstimateSec = data.durationEstimateSec || null;
  return a;
}




// ===== 카드 렌더 =====
function makeCard(idx, sent){
  const wrap = document.createElement('section');
  wrap.className = 'card';

  wrap.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div class="q-badge">문제 ${idx+1} / Question ${idx+1}</div>
      <div>
        <div class="text-xl font-bold mb-1">${sent.hideText ? '' : sent.ko}</div>
        <div class="text-slate-600 text-sm mb-2">${sent.hideText ? '<em>잘 듣고 따라하세요 / Écoutez et répétez</em>' : 'FR: ' + sent.fr}</div>
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
    <div class="text-sm mt-2 text-slate-600" data-card-eval-instruction>
      <p>멈춘 뒤 <b>평가</b>를 누르면 <u>원문과 일치하지 않는 부분만</u> 빨간색으로 표시돼요.</p>
      <p>Après avoir arrêté, cliquez sur <b>Évaluer</b> pour afficher en rouge les parties non conformes.</p>
    </div>

    <!-- 결과: 원문 + 사용자가 말한 문장(틀린 부분만 빨간색) -->
    <div class="mt-3 sum-box">
      <div class="sum-title">틀린 부분 / Parties non conformes</div>
      <div class="sum-val text-base leading-7">
        <div class="ref-line"><strong>원래 문장 / Phrase originale :</strong> <span class="ref-bubble" data-ref-display>—</span></div>
        <div class="hyp-line mt-1"><strong>내 발음 / Ma prononciation :</strong> <span class="hyp-bubble" data-hyp-display>—</span></div>
        <div class="sum-stats mt-2" aria-live="polite">
          <div class="accuracy" data-accuracy><svg class="stat-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 7v5l3 1" stroke="#065f46" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="#065f46" stroke-width="1.6" fill="rgba(6,95,70,0.06)"/></svg> 정확도: —</div>
          <div class="len-compare" data-len-compare>
            <div class="len-labels" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
              <button class="badge accuracy-badge" data-accuracy><svg class="stat-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 7v5l3 1" stroke="#065f46" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="#065f46" stroke-width="1.6" fill="rgba(6,95,70,0.06)"/></svg> 정확도: —</button>
              <button class="badge duration-badge" data-durations>TTS: — · 녹음: —</button>
            </div>
            <div class="len-abs" aria-hidden="true">
              <div class="len-center" aria-hidden="true"></div>
              <div class="len-bar len-bar-tts" style="left:50%;width:0%" title="TTS: ?s"></div>
              <div class="len-bar len-bar-rec" style="left:50%;width:0%" title="녹음: ?s"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="sum-sub mt-1" data-score></div>
    </div>
  `;

    // 듣기: 재생 중에는 버튼을 일시정지로 바꿔 중복 클릭 방지
  wrap.querySelector('[data-action="listen"]').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    // If audio is already stored and not ended, toggle pause/resume
    const existing = btn._audio;
    if (existing && !existing.ended){
      if (!existing.paused){
        existing.pause();
        btn.innerHTML = '▶ 듣기 / Écouter';
        return;
      } else {
        existing.play().catch(()=>{});
        btn.innerHTML = '⏸ 일시정지 / Pause';
        return;
      }
    }

    // Otherwise start new playback and store the audio element on the button
    btn.innerHTML = '⏸ 일시정지 / Pause';
    try{
      // honor sent.voice and sent.speed if provided
      const voice = sent.voice || 'shimmer';
      const speed = typeof sent.speed === 'number' ? sent.speed : 1.0;
      const audioEl = await ttsPlay(sent.ko, voice, speed);
      btn._audio = audioEl;
      // when playback ends, restore label
      audioEl.addEventListener('ended', ()=>{ btn.innerHTML = '듣기 / Écouter'; btn._audio = null; }, { once:true });
    } catch(err) {
      console.error('TTS play error', err);
      btn.innerHTML = '듣기 / Écouter';
    }
  });

  const host = wrap.querySelector('[data-pronun]');
  const liveBox = wrap.querySelector('[data-live]');
  const refDisplay = wrap.querySelector('[data-ref-display]');
  const hypDisplay = wrap.querySelector('[data-hyp-display]');
  const scoreBox= wrap.querySelector('[data-score]');
  // durationsEl: element to show TTS/record durations; avoid ReferenceError in onResult
  const durationsEl = wrap.querySelector('.duration-badge') || wrap.querySelector('.durations') || wrap.querySelector('[data-durations]');
  const getRef  = ()=> sent.ko;

  // 로컬: ref/hyp 둘 줄 표시를 위한 Jamo 기반 정렬+하이라이트 생성기
  function generateDualHtml(refRaw, hypRaw){
    // 내부 복사: scoring.js의 toJamoSeq/LCS 로직(간단화)
    function toJamoSeqLocal(s){
      const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
      const JUNG= ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
      const JONG= ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
      const t = String(s||'').normalize('NFC').replace(/\s+/g,'').replace(/[^0-9A-Za-z가-힣]/g,'');
      const out = [];
      for (const ch of t){
        const code = ch.codePointAt(0);
        if (code>=0xAC00 && code<=0xD7A3){
          const i = code - 0xAC00;
          const cho = Math.floor(i / 588);
          const jung = Math.floor((i % 588) / 28);
          const jong = i % 28;
          out.push(CHO[cho], JUNG[jung]);
          if (JONG[jong]) out.push(JONG[jong]);
        } else out.push(ch);
      }
      return out;
    }

    // For better matching with normalization rules (numbers etc.), create
    // a normalized string for scoring but keep the original for display.
    // Use the same normalization as scoring so highlights align with gradePronun
    const normRefRaw = normalizeForScoring(refRaw, refRaw);
    const normHypRaw = normalizeForScoring(refRaw, hypRaw);

    const refJ = toJamoSeqLocal(normRefRaw);
    const hypJ = toJamoSeqLocal(normHypRaw);
    const m = refJ.length, n = hypJ.length;
    const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
    for (let i=1;i<=m;i++){
      for (let j=1;j<=n;j++){
        dp[i][j] = refJ[i-1]===hypJ[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
      }
    }
    let i=m, j=n; const keepRef = new Array(m).fill(false); const keepHyp = new Array(n).fill(false);
    while (i>0 && j>0){
      if (refJ[i-1]===hypJ[j-1]){ keepRef[i-1]=true; keepHyp[j-1]=true; i--; j--; }
      else if (dp[i-1][j] >= dp[i][j-1]) i--; else j--;
    }

  // helper: map keep flags (computed on normalized jamo arrays) back to
  // the original raw string for display. We walk the original string and
  // compute how many jamo units each visible char corresponds to in the
  // normalized jamo sequence. Then we consult the keepArr (which was
  // computed on the normalized jamo sequence) by mapping indices.
    function buildHtmlFromKeep(rawOriginal, keepArr, normSource){
      // Map normalized jamo positions (keepArr indices) back to original
      // characters robustly. We align normalized characters to original
      // characters with a greedy char-match lookahead, then expand char->jamo
      // positions to know which jamo slots belong to which original char.
  const raw = String(rawOriginal).normalize('NFC');
  // Use the same cleaning as toJamoSeqLocal so punctuation/spaces are
  // removed when building normalized jamo sequences for alignment.
  const norm = String(normSource || raw).normalize('NFC');
  const cleanNorm = norm.replace(/\s+/g,'').replace(/[^0-9A-Za-z가-힣]/g,'');
  const rawChars = [...raw];
  const normChars = [...cleanNorm];

      function jamoCount(ch){
        // Keep this consistent with toJamoSeqLocal: Hangul syllable => 2 or 3
        if (!ch) return 1;
        if (/[가-힣]/.test(ch)){
          const code = ch.codePointAt(0);
          const i = code - 0xAC00;
          if (i < 0 || i > (0xD7A3 - 0xAC00)) return 1;
          const jong = i % 28;
          return jong === 0 ? 2 : 3;
        }
        return 1;
      }

      // Greedy alignment but keep distribution conservative: align identical
      // characters first, try small lookahead, and if leftover normalized
      // chars remain, distribute them evenly across remaining raw chars so
      // the last raw char doesn't collect a disproportionate number of jamo
      // positions.
      const normCharToRaw = new Array(normChars.length).fill(-1);
      let iNorm = 0, iRaw = 0;
      // First pass: direct equal-char matches
      while (iNorm < normChars.length && iRaw < rawChars.length){
        if (normChars[iNorm] === rawChars[iRaw]){ normCharToRaw[iNorm] = iRaw; iNorm++; iRaw++; continue; }
        // lookahead in raw (small window)
        let found = -1;
        for (let k=1;k<=2 && (iRaw+k)<rawChars.length;k++){
          if (normChars[iNorm] === rawChars[iRaw+k]){ found = iRaw+k; break; }
        }
        if (found !== -1){ normCharToRaw[iNorm] = found; iNorm++; iRaw = found+1; continue; }
        // lookahead in norm for a match to current raw
        found = -1;
        for (let k=1;k<=2 && (iNorm+k)<normChars.length;k++){
          if (normChars[iNorm+k] === rawChars[iRaw]){ found = iNorm+k; break; }
        }
        if (found !== -1){ normCharToRaw[iNorm] = iRaw; iNorm++; continue; }
        // fallback: map current norm char to current raw and advance norm
        normCharToRaw[iNorm] = iRaw; iNorm++;
      }
      // Distribute any remaining norm chars evenly across remaining raw chars
      if (iNorm < normChars.length){
        const remainingNorm = normChars.length - iNorm;
        const remainingRaw = Math.max(1, rawChars.length - iRaw);
        // Spread indexes so each raw char receives roughly even share
        // Compute base share and extras
        const base = Math.floor(remainingNorm / remainingRaw);
        let extras = remainingNorm % remainingRaw;
        let r = iRaw;
        for (let k=0;k<remainingNorm;k++){
          normCharToRaw[iNorm + k] = Math.min(rawChars.length-1, r);
          // after assigning base (+maybe one extra) jamos to r, advance r
          const assigned = base + (extras>0 ? 1 : 0);
          if (assigned>0){
            // reduce extras if consumed
            if (extras>0) extras--;
            // compute when to advance: move to next raw after assigned
            // positions have been filled for this raw char
            if (((k+1) % (base + 1)) === 0) r = Math.min(rawChars.length-1, r+1);
          } else {
            r = Math.min(rawChars.length-1, r+1);
          }
        }
      }

      // Build mapping from norm-jamo-index -> rawCharIndex
      const normJamoToRawChar = [];
      for (let ci=0, jPos=0; ci<normChars.length; ci++){
        const cnt = jamoCount(normChars[ci]);
        for (let k=0;k<cnt;k++){ normJamoToRawChar[jPos++] = normCharToRaw[ci]; }
      }

      // For each raw char, gather its corresponding norm-jamo positions
      const rawCharToNormJamoPositions = Array.from({length: rawChars.length}, ()=>[]);
      for (let j=0;j<normJamoToRawChar.length;j++){
        const rawIdx = normJamoToRawChar[j];
        if (typeof rawIdx === 'number' && rawIdx >=0 && rawIdx < rawChars.length){
          rawCharToNormJamoPositions[rawIdx].push(j);
        }
      }
      // If a raw character is punctuation/non-Korean (e.g. ',', '?') then
      // ignore any mapped jamo positions so it's treated permissively.
      for (let ri=0; ri<rawChars.length; ri++){
        const ch = rawChars[ri];
        if (/[^0-9A-Za-z가-힣]/.test(ch)) rawCharToNormJamoPositions[ri] = [];
      }

      // Decide OK per raw char using majority rule on mapped jamo positions.
      // If a char has no mapped positions, fall back to a loose direct-char
      // comparison against the normalized source.
      const htmlParts = [];
      for (let ri=0; ri<rawChars.length; ri++){
        const ch = rawChars[ri];
        const positions = rawCharToNormJamoPositions[ri];
        let ok = true;
        if (positions.length === 0){
          // No mapping info: treat punctuation/symbols as OK (don't mark
          // punctuation red). Otherwise, consider OK if the visible char is
          // present in the cleaned normalized source.
          if (/[^0-9A-Za-z가-힣]/.test(ch)) {
            ok = true;
          } else {
            ok = normChars.includes(ch);
          }
        } else {
          // majority rule: if >=50% of this char's jamo slots are kept,
          // consider the visible char as correctly pronounced.
          let kept = 0;
          for (const p of positions) if (keepArr[p]) kept++;
          ok = (kept / positions.length) >= 0.5;
        }
        htmlParts.push(ok ? `<span>${ch}</span>` : `<span style=\"color:#dc2626\">${ch}</span>`);
      }
      return htmlParts.join('');
    }

    // Build HTML mapping back to the original visible strings. For the
    // reference line we map keepRef (which was computed from normRefRaw)
    // back to refRaw. For the hypothesis we map keepHyp (from normHypRaw)
    // back to hypRaw.
    const refHtml = buildHtmlFromKeep(refRaw, keepRef, normRefRaw);
    const hypHtml = buildHtmlFromKeep(hypRaw, keepHyp, normHypRaw);
    return { refHtml, hypHtml };
  }

  // 이 테스트 전용: 채점용 정규화 (원문 참조 기반 우선, 없으면 NumHangul 폴백)
  function normalizeForScoring(refText, txt){
    try{
      const r = String(refText||'');
      let t = String(txt||'');
      if (window.PronunUtils?.NumNormalizer?.refAwareNormalize) {
        return window.PronunUtils.NumNormalizer.refAwareNormalize(r, t);
      }
      if (window.NumHangul?.digitsToSinoInText) t = window.NumHangul.digitsToSinoInText(t);
      if (window.NumHangul?.forceHangulNumbers) t = window.NumHangul.forceHangulNumbers(t);
      // 마지막 정리: 공백/구두점 제거는 Scoring 내부에서도 하므로 여기서는 보존
      return t;
    }catch(e){ return String(txt||''); }
  }

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
        // show raw interim text (don't apply normalization/auto-corrections here)
        onPartial(txt){ liveBox.textContent = (txt===undefined || txt===null) ? '…' : String(txt).trim() || '…'; }
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
      // Build the interim text from the newest result chunk(s).
      // Use the transcript field provided by Web Speech API (transcriptRaw is non-standard).
      try{
        const parts = [];
        for (let i = ev.resultIndex; i < ev.results.length; i++){
          const res = ev.results[i];
          if (!res || !res[0]) continue;
          parts.push(res[0].transcript || '');
        }
        const partial = parts.join('');
        liveBox.textContent = (partial||'').trim() || '…';
      }catch(_){ liveBox.textContent = '…'; }
    };
    try { rec.start(); } catch(_) {}
    return ()=>{ try{rec.stop();}catch(_){} };
  }


  Pronun.mount(host, {
    getReferenceText: getRef,
  onResult: ({ status, transcript, transcriptRaw, accuracy, duration })=>{
      if (status==='retry' || !transcript){
        if (refDisplay) refDisplay.textContent = '—';
        if (hypDisplay) hypDisplay.textContent = '—';
        scoreBox.textContent = '다시 한번 또박또박 말해볼까요? / Réessayez, s\'il vous plaît.';
        return;
      }
      // 최종 비교(정지 후 평가)
        // 발음 채점(공용 scoring.js: 자모 기반, 띄어쓰기/문장부호 무시)
      const ref = sent.ko;
      try {
        // Prefer raw transcript when available to avoid server/client auto-corrections
        const finalHypRaw = (typeof transcriptRaw === 'string' && transcriptRaw.trim().length) ? transcriptRaw : transcript;
        // 이 테스트 모델 한정: 채점은 ref-aware 정규화된 복사본으로만 수행(원문 UI는 변경하지 않음)
        const normRef = normalizeForScoring(ref, ref);
        const normHyp = normalizeForScoring(ref, finalHypRaw);
        const { pct } = Scoring.gradePronun(normRef, normHyp, 0.10); // tol=10%
        const { refHtml, hypHtml } = generateDualHtml(ref, finalHypRaw);
  if (refDisplay) refDisplay.innerHTML = refHtml;
  if (hypDisplay) hypDisplay.innerHTML = hypHtml;
  // Update liveBox to show the final transcript used for scoring so
  // students see the same text in real-time and in results.
  try{ if (liveBox) liveBox.textContent = (finalHypRaw||'').trim() || '…'; }catch(_){ }
    // show accuracy prominently and durations (TTS vs my recording)
    const accuracyBadge = host.querySelector('.accuracy-badge');
    const durationBadge = host.querySelector('.duration-badge');
  if (accuracyBadge) accuracyBadge.innerHTML = `<svg class="stat-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 7v5l3 1" stroke="#065f46" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="#065f46" stroke-width="1.6" fill="rgba(6,95,70,0.06)"/></svg> 정확도: ${pct}%`;
        // try to find tts duration from listen button _audio (stored when played)
        let ttsDur = null;
        try{
          const listenBtn = wrap.querySelector('[data-action="listen"]');
          const audioObj = listenBtn?listenBtn._audio:null;
          if (audioObj && typeof audioObj.durationEstimateSec === 'number') ttsDur = audioObj.durationEstimateSec;
        }catch(_){ ttsDur = null; }
        const myRec = duration ? `${duration.toFixed(1)}s` : '?s';
        const ttsStr = ttsDur ? `${ttsDur.toFixed(1)}s` : 'TTS ?s';
        if (durationsEl) durationsEl.textContent = `TTS: ${ttsStr} · 내 녹음: ${myRec}`;
        // update len-compare area
        try{
          const lenWrap = host.querySelector('[data-len-compare]');
          if (lenWrap){
            const t = Number(ttsDur || 0); const r = Number(duration || 0);
            // update badges
            if (durationBadge) durationBadge.textContent = `TTS: ${ttsDur?ttsDur.toFixed(1)+'s':'?s'} · 녹음: ${duration?duration.toFixed(1)+'s':'?s'}`;
            // compute absolute difference bars from center: center is 50%
            const absDiff = Math.abs((t || 0) - (r || 0));
            const maxRange = Math.max(0.1, t, r, absDiff);
            // lengths expressed as percentage of maxRange (cap to 48% each side)
            const tPct = Math.min(48, Math.round(((t || 0) / maxRange) * 48));
            const rPct = Math.min(48, Math.round(((r || 0) / maxRange) * 48));
            const tBar = lenWrap.querySelector('.len-bar-tts');
            const rBar = lenWrap.querySelector('.len-bar-rec');
            if (tBar){
              // if TTS shorter than rec, extend left; otherwise right
              if (t <= r){ tBar.style.left = `${50 - tPct}%`; tBar.style.width = `${tPct}%`; }
              else { tBar.style.left = '50%'; tBar.style.width = `${tPct}%`; }
              tBar.title = `TTS: ${ttsDur?ttsDur.toFixed(2)+'s':'?s'}`;
            }
            if (rBar){
              if (r <= t){ rBar.style.left = `${50 - rPct}%`; rBar.style.width = `${rPct}%`; }
              else { rBar.style.left = '50%'; rBar.style.width = `${rPct}%`; }
              rBar.title = `녹음: ${duration?duration.toFixed(2)+'s':'?s'}`;
            }
          }
        }catch(_){ }
        // persist durations & highlight HTML on the card element for send-results
        try{
          const cardEl = wrap;
          if (cardEl) {
            if (typeof duration === 'number') cardEl.dataset.recDuration = String(Number(duration.toFixed(2)));
            if (typeof ttsDur === 'number') cardEl.dataset.ttsDuration = String(Number((ttsDur||0).toFixed(2)));
            // store generated highlight HTML (safe-ish: server sanitizes too)
              const refHtmlNode = refDisplay; const hypHtmlNode = hypDisplay;
              cardEl.dataset.refHtml = refHtmlNode ? refHtmlNode.innerHTML : '';
              cardEl.dataset.hypHtml = hypHtmlNode ? hypHtmlNode.innerHTML : '';
          }
        }catch(_){ }
        // also update compact score box
        scoreBox.textContent = `${pct}% · 길이: ${duration?.toFixed?.(1)||'?'}s`;
      } catch (e) {
        console.error('[pronun-mini-test] scoring error', e);
        if (refDisplay) refDisplay.textContent = ref;
        if (hypDisplay) hypDisplay.textContent = transcript || '—';
        scoreBox.textContent = '채점 오류 / Erreur de notation';
      }

    }
  });

  // Hint buttons will be injected just under the listen button (moved)
  try{
    // find the listen button and insert a hint container right after it
    const listenBtn = wrap.querySelector('[data-action="listen"]');
    const hintWrap = document.createElement('div');
    hintWrap.style.marginTop = '8px';
    hintWrap.innerHTML = `<button class="btn btn-ghost btn-sm" data-hint="1">도움받기1</button> <button class="btn btn-ghost btn-sm" data-hint="2">도움받기2</button> <span data-hint-display style="margin-left:12px;color:#334155"></span>`;
    if (listenBtn && listenBtn.parentNode) {
      listenBtn.parentNode.insertBefore(hintWrap, listenBtn.nextSibling);
    } else {
      wrap.appendChild(hintWrap);
    }
    const hintDisplay = hintWrap.querySelector('[data-hint-display]');

    // 도움받기1: 간단 힌트 텍스트 토글
    hintWrap.querySelector('[data-hint="1"]').addEventListener('click', (e)=>{
      if (!sent.hint1) { hintDisplay.textContent = ''; return; }
      hintDisplay.textContent = (hintDisplay.textContent === sent.hint1) ? '' : sent.hint1;
    });

    // 도움받기2: 문장에서 일부 단어를 빈칸으로 대체해 보여준다
    hintWrap.querySelector('[data-hint="2"]').addEventListener('click', (e)=>{
      if (!sent.hint2 && !sent.ko) { hintDisplay.textContent = ''; return; }
      // If currently showing the blanked hint, clear it
      if (hintDisplay.dataset.blankShown === '1') { hintDisplay.textContent = ''; hintDisplay.dataset.blankShown = '0'; return; }
      const src = sent.hint2 || sent.ko || '';
      // split into words (prefer spaces, fallback to syllables)
      const words = src.split(/(\s+)/).filter(Boolean);
      if (words.length === 0) { hintDisplay.textContent = ''; hintDisplay.dataset.blankShown='0'; return; }
      // choose up to 1-2 words to blank based on length
      const candidateIdx = [];
      for (let i=0;i<words.length;i++){
        if (/\s+/.test(words[i])) continue; // skip pure whitespace
        if (words[i].length >= 2) candidateIdx.push(i);
      }
      // if no good candidate, blank a middle character from last word
      let blanked = words.slice();
      if (candidateIdx.length === 0){
        const widx = Math.max(0, words.length-1);
        const w = words[widx];
        const pos = Math.floor(w.length/2);
        blanked[widx] = w.substring(0,pos) + '▢' + w.substring(pos+1);
      } else {
        // pick 1 or 2 random indices
        const nBlank = candidateIdx.length >= 3 ? 2 : 1;
        const shuffled = candidateIdx.sort(()=>0.5-Math.random());
        const pick = shuffled.slice(0,nBlank);
        pick.forEach(pi => {
          const w = blanked[pi];
          // replace middle portion with underscore boxes proportional to length
          const Keep = Math.max(1, Math.floor(w.length/3));
          const start = Math.floor((w.length - Keep)/2);
          const end = start + Keep;
          const blanks = '▢'.repeat(Math.max(1, end-start));
          blanked[pi] = w.substring(0,start) + blanks + w.substring(end);
        });
      }
      hintDisplay.textContent = blanked.join('');
      hintDisplay.dataset.blankShown = '1';
    });
  }catch(_){/*ignore*/}

  // After Pronun widget mounts, ensure its record button is bilingual
  try {
    const localRecord = host.querySelector('button[data-action="record"]');
    if (localRecord) {
      localRecord.innerHTML = `<span>녹음 시작 / Démarrer l'enregistrement</span>`;
    }
  } catch(_){ }

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

/* 내 발음(실시간) 박스 강화 (크기 10% 축소) */
.pronun-live {
  display:block;
  font-size:1.62rem; /* 기존 1.8rem -> 10% 작게 */
  line-height:1.98rem; /* 기존 2.2rem -> 10% 작게 */
  padding:14px 16px; /* 기존 16px 18px -> 10% 작게 */
  min-height:86px; /* 기존 96px -> ~10% 작게 */
  background:#fff;
  border:2px solid #e2e8f0;
  border-radius:14px;
  box-shadow:0 1px 0 rgba(0,0,0,.02);
}
@media (min-width:768px){
  .pronun-live{ font-size:1.89rem; line-height:2.34rem; min-height:99px; }
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
/* 결과 영역: 레이블은 작게, 문장 텍스트는 더 크게 보여줌 */
.sum-box .ref-line strong,
.sum-box .hyp-line strong{
  font-size:0.78rem;
  font-weight:600;
  color:#475569; /* slate-600 */
  display:inline-block;
  width:160px;
}
.sum-box .ref-line span,
.sum-box .hyp-line span{
  font-size:1.25rem; /* 큰 문장 텍스트 */
  line-height:1.6rem;
  color:#111827;
}
.sum-box .hyp-line span{ font-size:1.38rem; /* 사용자 문장은 더 강조 */ }

/* Ensure the reference and hypothesis lines are on separate rows and align */
.sum-box .ref-line, .sum-box .hyp-line{
  display:flex;
  align-items:flex-start;
  gap:12px;
  padding:6px 0;
}
.sum-box .ref-line span, .sum-box .hyp-line span{ display:inline-block; max-width:calc(100% - 170px); word-break:keep-all; }

/* Card border and question badge */
.card{
  position:relative;
  border: 2px solid #0ea5e9; /* sky-500 */
  box-shadow: 0 6px 20px rgba(14,165,233,0.08);
  border-radius:12px;
  padding:18px;
  padding-top:56px; /* extra space for absolute badge; increased to avoid overlap */
  margin-bottom:18px;
}
.card .q-badge{
  position:absolute;
  top:12px;
  left:12px;
  z-index:6;
  display:inline-block;
  background:linear-gradient(90deg,#0ea5e9,#06b6d4);
  color:#fff;
  font-weight:800;
  font-size:0.95rem;
  padding:8px 12px;
  border-radius:10px;
  box-shadow:0 6px 14px rgba(14,165,233,.18);
}
/* optional semantic colors */
.card .q-badge.warning{ background:linear-gradient(90deg,#f59e0b,#f97316); }
.card .q-badge.danger{ background:linear-gradient(90deg,#ef4444,#dc2626); }

.q-number{ font-weight:800; font-size:0.95rem; color:#0f172a; }

/* result emphasis */
.sum-box{ background: #ffffff; border: 1px solid #e6eef6; padding:12px; border-radius:10px; }
.sum-box .sum-title{ font-weight:700; color:#0f172a; margin-bottom:8px; }
.sum-box .ref-line strong, .sum-box .hyp-line strong{ width:180px; }
.sum-box .accuracy{ color:#065f46; font-size:1.02rem; font-weight:700; }
.sum-box .durations{ color:#334155; font-size:1.02rem; }
.sum-box .hyp-line span{ font-size:1.18rem; /* 사용자 문장은 약간 덜 강조 */ }
/* ref/hyp bubbles (chip style) */
.ref-bubble, .hyp-bubble{
  display:inline-block;
  padding:8px 12px;
  border-radius:999px;
  background:#f8fafc;
  border:1px solid #e6eef6;
  color:#0f172a;
  font-size:1.05rem;
}
.ref-bubble{ background:linear-gradient(90deg,#ffffff,#f1f5f9); }
.hyp-bubble{ background:linear-gradient(90deg,#fff7f7,#fff); border-color:#fee2e2; color:#7f1d1d }
.stat-icon{ vertical-align:middle; margin-right:8px; }

/* length comparison bars */
.len-compare .len-bar-bg{ position:relative; height:12px; background:#eef2ff; border-radius:8px; overflow:hidden }
.len-compare .len-bar-tts{ position:absolute; left:0; top:0; bottom:0; background:linear-gradient(90deg,#e0f2fe,#bae6fd); }
.len-compare .len-bar-rec{ position:absolute; left:0; top:0; bottom:0; background:linear-gradient(90deg,#fde68a,#fca5a5); opacity:0.9; mix-blend-mode:normal }
.len-compare .len-bar-rec{ background:linear-gradient(90deg,#fde68a,#fca5a5); z-index:2; }
.len-bar[title]{ cursor:default; }

/* Absolute-difference centered bars */
.len-abs{ position:relative; height:18px; background:transparent; }
.len-center{ position:absolute; left:50%; top:0; bottom:0; width:2px; background:#e2e8f0; transform:translateX(-50%); }
.len-bar{ position:absolute; top:3px; height:12px; border-radius:6px; transform-origin:left center; }
.len-bar-tts{ background:linear-gradient(90deg,#bfdbfe,#93c5fd); z-index:1; }
.len-bar-rec{ background:linear-gradient(90deg,#fde68a,#fca5a5); z-index:2; }
.len-bar[title]{ cursor:default; }

/* Badges for accuracy/duration */
.badge{ border:1px solid #e6eef6; background:#fff; padding:6px 10px; border-radius:999px; font-weight:600; color:#0f172a; box-shadow:0 4px 10px rgba(2,6,23,0.04); cursor:default; }
.accuracy-badge svg{ vertical-align:middle; margin-right:6px; }
.duration-badge{ font-size:0.95rem; color:#475569 }

/* Tooltip: simple hover title fallback is used; add slight transition for width changes */
.len-bar{ transition: width 220ms ease; }
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

  // Apply finish button class if available
  const finishButton = document.getElementById('finish-btn');
  if (finishButton) finishButton.classList.add('finish-gold');

  // Top banner asking for name (KO/FR)
  if (!document.getElementById('pronun-name-banner')){
    const b = document.createElement('div');
    b.id = 'pronun-name-banner';
    b.style.cssText = 'background:linear-gradient(90deg,#f0f9ff,#eef2ff);padding:8px 14px;border-bottom:1px solid #e6eef6;text-align:center;font-weight:700;color:#0f172a';
    b.innerHTML = '연습 시작 전에 꼭 이름을 입력해주세요. / Entrez votre nom avant de commencer.';
    document.body.insertAdjacentElement('afterbegin', b);
  }

  // Helper to enable/disable controls that require a name
  window.enableNameRequiredControls = function(){
    const name = (localStorage.getItem('pronunStudentName')||'').trim();
    Array.from(document.querySelectorAll('[data-requires-name]')).forEach(btn=>{
      try{ btn.disabled = !name; }catch(_){/*ignore*/}
    });
    const b = document.getElementById('pronun-name-banner');
    if (b) b.style.display = name ? 'none' : 'block';
  };

  // initial check
  try{ enableNameRequiredControls(); }catch(_){/*ignore*/}

  // Intercept clicks on controls requiring a name to show modal if missing
  document.body.addEventListener('click', (e)=>{
    const btn = e.target.closest && e.target.closest('[data-requires-name]');
    if (!btn) return;
    const name = (localStorage.getItem('pronunStudentName')||'').trim();
    if (!name){
      e.preventDefault();
      const modal = document.getElementById('pronun-student-modal');
      if (modal) modal.style.display='flex';
      return false;
    }
  }, true);

  // finish 버튼 동작은 파일 후반에서 통합적으로 설정합니다.

  // Remove any "Previous Exercise" buttons/links if present
  try {
    const prevSelectors = ['.btn-prev-exercise', '#prev-exercise', 'a.prev-exercise', 'button.prev-exercise'];
    prevSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.remove());
    });
    // Also try to remove anchors with matching text
    Array.from(document.querySelectorAll('a,button,span')).forEach(el=>{
      const t = (el.textContent||'').trim().toLowerCase();
      if (t.includes('previous exercise') || t.includes('이전 연습') || t.includes('exercice précédent')) {
        try{ el.remove(); }catch(_){/*ignore*/}
      }
    });
  } catch(_){/*ignore*/}

});

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

// Simple modal for student name input (injected once)
(function injectStudentModal(){
  if (document.getElementById('pronun-student-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'pronun-student-modal';
  modal.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.4);z-index:9999';
  modal.innerHTML = `
    <div style="background:#fff;padding:18px;border-radius:12px;max-width:420px;width:90%;box-shadow:0 10px 30px rgba(2,6,23,.25)">
      <div style="font-weight:700;margin-bottom:8px">학생 이름 / Nom de l'élève</div>
      <input id="pronun-student-name" placeholder="이름을 입력하세요 / Entrez le nom" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:10px" />
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="pronun-student-cancel" style="padding:8px 12px;border-radius:8px">취소 / Annuler</button>
        <button id="pronun-student-ok" style="background:#0ea5e9;color:#fff;padding:8px 12px;border-radius:8px">확인 / Confirmer</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const nameInput = modal.querySelector('#pronun-student-name');
  modal.querySelector('#pronun-student-cancel').addEventListener('click', ()=>{ modal.style.display='none'; });
  modal.querySelector('#pronun-student-ok').addEventListener('click', ()=>{
    const v = (nameInput.value||'').trim();
    if (!v) { alert('이름을 입력하세요 / Entrez le nom'); return; }
    try{ localStorage.setItem('pronunStudentName', v); }catch(_){ }
    modal.style.display='none';
    // enable controls once name is set
    try{ enableNameRequiredControls(); }catch(_){ }
  });
})();

// Generic result modal / error modal used for success & retry UI
(function injectResultModal(){
  if (document.getElementById('pronun-result-modal')) return;
  const m = document.createElement('div');
  m.id = 'pronun-result-modal';
  m.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:10000';
  m.innerHTML = `
    <div style="background:#fff;padding:18px;border-radius:12px;max-width:640px;width:94%;box-shadow:0 14px 40px rgba(2,6,23,.28)">
      <div id="pronun-result-body" style="font-size:16px;color:#0f172a"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
        <button id="pronun-result-secondary" style="padding:8px 12px;border-radius:8px;border:1px solid #e5e7eb;background:#fff">닫기 / Fermer</button>
        <button id="pronun-result-primary" style="padding:8px 12px;border-radius:8px;background:#0ea5e9;color:#fff">확인 / OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(m);
  m.querySelector('#pronun-result-secondary').addEventListener('click', ()=>{ m.style.display='none'; });
  // primary handler set dynamically by caller
})();

// (removed earlier duplicate finish-button handler to avoid premature access)

// Normalize text helper (matches server-side canon rules loosely)
function normalizeTextForCompare(s){
  return String(s||'')
    .replace(/[.,!?;:~、。！？；："'()\[\]{}<>]/g,'')
    .replace(/\s+/g,'')
    .toLowerCase();
}

// Collect results from the page into a payload the server expects
function collectResults(){
  const studentNameInput = document.querySelector('#student-name');
  let studentName = studentNameInput?.value?.trim() || '';
  if (!studentName) {
    studentName = window.prompt('학생 이름을 입력하세요 / Entrez le nom de l\'élève', '');
    if (!studentName) studentName = 'Student';
  }

  const cards = Array.from(document.querySelectorAll('#cards .card'));
  const questions = cards.map((card, idx) => {
    const number = idx + 1;
    const koEl = card.querySelector('.text-xl.font-bold');
    const frEl = card.querySelector('.text-slate-600');
    const ko = koEl?.textContent?.trim() || '';
    const fr = (frEl?.textContent||'').replace(/^FR:\s*/i,'').trim();

  const diffEl = card.querySelector('[data-diff]');
  const diffHtml = diffEl?.innerHTML?.trim() || '';
    const scoreEl = card.querySelector('[data-score]');
    const scoreText = scoreEl?.textContent || '';
    const pctMatch = scoreText.match(/(\d{1,3})%/);
    const pronunciationAccuracy = pctMatch ? (Number(pctMatch[1]) / 100) : null;

    // If diff HTML contains <del> or <ins> it's considered incorrect
    const isCorrect = !!(diffHtml && !(/<del|<ins/i.test(diffHtml)));

    // durations and highlight HTML (saved by onResult)
    const ttsDuration = card.dataset.ttsDuration ? Number(card.dataset.ttsDuration) : null;
    const recDuration = card.dataset.recDuration ? Number(card.dataset.recDuration) : null;
    const refHtml = card.dataset.refHtml || '';
    const hypHtml = card.dataset.hypHtml || '';

    return {
      number,
      ko,
      fr,
      isCorrect,
      isCorrectKo: isCorrect, // simple heuristic
      isCorrectFr: false,
      pronunciation: { accuracy: pronunciationAccuracy, recDuration, ttsDuration },
      refHtml,
      hypHtml,
      listenCount: 0,
      hint1Count: 0,
      hint2Count: 0
    };
  });

  const payload = {
    studentName,
    assignmentTitle: document.title || 'Pronunciation mini-test',
    assignmentTopic: '',
    startTime: window.__pronunStartTime || new Date().toISOString(),
    endTime: new Date().toISOString(),
    totalTimeSeconds: 0,
    questions
  };
  return payload;
}

// Unified finish button handler: require student name, show bilingual popup,
// send results (request HTML view) and open returned HTML in a new tab.
const finishButton = document.getElementById('finish-btn');
if (finishButton) {
  finishButton.addEventListener('click', async () => {
    // Ensure we have a student name via modal
    const modal = document.getElementById('pronun-student-modal');
    const nameInput = document.getElementById('pronun-student-name');
    // show modal
    if (modal) modal.style.display = 'flex';

    const studentName = await new Promise(resolve => {
      const ok = document.getElementById('pronun-student-ok');
      const cancel = document.getElementById('pronun-student-cancel');
      // If modal/buttons are missing for any reason, fall back to prompt
      if (!modal || !ok || !cancel || !nameInput) {
        try{ if (modal) modal.style.display='none'; }catch(_){ }
        const v = window.prompt('학생 이름을 입력하세요 / Entrez le nom de l\'élève', '');
        resolve(v === null ? null : (String(v||'').trim()));
        return;
      }

      const cleanup = () => {
        try{ ok.removeEventListener('click', onOk); }catch(_){ }
        try{ cancel.removeEventListener('click', onCancel); }catch(_){ }
      };
      const onOk = () => { cleanup(); try{ modal.style.display='none'; }catch(_){}; resolve((nameInput.value||'').trim()); };
      const onCancel = () => { cleanup(); try{ modal.style.display='none'; }catch(_){}; resolve(null); };
      ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel);
    });

    if (studentName === null) return; // user cancelled

    const payload = collectResults();
    payload.studentName = studentName || payload.studentName || 'Student';

    // Disable finish button and show spinner
    try {
      finishButton.disabled = true;
      const origLabel = finishButton.innerHTML;
      finishButton.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px"><svg class=\"spin\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" stroke=\"rgba(255,255,255,0.9)\" stroke-width=\"3\" fill=\"none\"></circle></svg> 전송 중... / Envoi...</span>`;

      // try-send with retry dialog on failure
      const trySend = async (attempt=1, maxAttempts=3) => {
        try {
          const resp = await fetch('/.netlify/functions/send-results?html=1', {
            method:'POST', headers:{'Content-Type':'application/json', 'X-Return-HTML':'1'},
            body: JSON.stringify(payload)
          });
          if (!resp.ok) throw new Error(`send failed ${resp.status}`);
          const html = await resp.text();
          // success modal
          const modal = document.getElementById('pronun-result-modal');
          const body = document.getElementById('pronun-result-body');
          const primary = document.getElementById('pronun-result-primary');
          const secondary = document.getElementById('pronun-result-secondary');
          const thankKo = '<div style="font-size:18px;font-weight:700">수고하셨습니다! 고생하셨습니다!</div>';
          const thankFr = '<div style="margin-top:6px;color:#475569">Bravo ! Bon travail !</div>';
          body.innerHTML = thankKo + thankFr + (html ? '<div style="margin-top:12px;color:#0f172a">결과가 준비되었습니다. 결과 보기 버튼을 눌러 새 탭에서 확인하세요.</div>' : '<div style="margin-top:12px;color:#64748b">결과 페이지로 이동합니다.</div>');
          primary.textContent = '결과 보기 / Voir résultats';
          secondary.textContent = '닫기 / Fermer';
          primary.onclick = () => {
            if (html) {
              const blob = new Blob([html], { type:'text/html' });
              const url = URL.createObjectURL(blob);
              window.open(url, '_blank');
            } else {
              window.location.href = '/results.html';
            }
            document.getElementById('pronun-result-modal').style.display = 'none';
          };
          modal.style.display = 'flex';
          return true;
        } catch (err) {
          console.error('send-results error attempt', attempt, err);
          if (attempt >= 3) {
            const modal = document.getElementById('pronun-result-modal');
            const body = document.getElementById('pronun-result-body');
            const primary = document.getElementById('pronun-result-primary');
            const secondary = document.getElementById('pronun-result-secondary');
            body.innerHTML = `<div style="font-weight:700;color:#dc2626">전송 실패</div><div style=\"margin-top:8px;color:#475569\">서버에 결과를 전송하지 못했습니다.<br/>네트워크 상태 또는 이메일 설정을 확인하세요.</div><div style=\"margin-top:8px;color:#64748b\">${esc(String(err))}</div>`;
            primary.textContent = '다시 시도 / Réessayer';
            secondary.textContent = '취소 / Annuler';
            primary.onclick = async () => { modal.style.display='none'; await trySend(1, maxAttempts); };
            secondary.onclick = () => { modal.style.display='none'; };
            modal.style.display = 'flex';
            return false;
          } else {
            // wait and retry with backoff
            await new Promise(r => setTimeout(r, 600 * attempt));
            return await trySend(attempt+1, maxAttempts);
          }
        }
      };

      await trySend(1,3);
    } finally {
      finishButton.disabled = false;
      // restore label if still in DOM
      try { finishButton.innerHTML = finishButton.innerHTML.includes('전송 중') ? '끝내기 / Terminer' : finishButton.innerHTML; } catch(_){ }
    }
  });
}

// For any top-level listen button present (outside cards), provide same
// toggle behavior. This keeps behavior consistent if the template uses a
// single global listen control.
Array.from(document.querySelectorAll('button[data-action="listen"]')).forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    const existing = btn._audio;
    if (existing && !existing.ended){
      if (!existing.paused){ existing.pause(); btn.textContent = '▶ 듣기 / Écouter'; return; }
      existing.play().catch(()=>{}); btn.textContent = '⏸ 일시정지 / Pause'; return;
    }
    btn.textContent = '⏸ 일시정지 / Pause';
    try{
      const audioEl = await ttsPlay((window.currentListenText||'') || document.title || '');
      btn._audio = audioEl;
      audioEl.addEventListener('ended', ()=>{ btn.textContent = '듣기 / Écouter'; btn._audio = null; }, { once:true });
    } catch(e){ console.error('TTS play error', e); btn.textContent = '듣기 / Écouter'; }
  });
});
