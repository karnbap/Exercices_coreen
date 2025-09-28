/* scoring.js
 * - 한국어 발음/철자 유사도 기반 점수
 * - 템포(말하기 속도) 페널티 지원
 * - 발음 전용(자모 기반) 채점 지원
 */

(function (global) {
  // ===== 유틸 =====
  const isHangul = (ch) => /[가-힣]/.test(ch);
  const norm = (s) =>
    String(s || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.,!?;:~、。！？；：]/g, '')
      .toLowerCase();

  // 문자열용 Levenshtein
  function levStr(a, b) {
    const s = norm(a), t = norm(b);
    const m = s.length, n = t.length;
    if (!m && !n) return 0;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  }

  function similarity(a, b) {
    const s = norm(a), t = norm(b);
    const L = Math.max(1, Math.max(s.length, t.length));
    const d = levStr(s, t);
    return Math.max(0, 1 - d / L);
  }

  // ===== 템포 페널티 =====
  function tempoPenalty(tempo) {
    if (!tempo) return { penalty: 0, reason: '', praise: '', bucketScore: null, bonus: 0 };
    const { mode, refDurationSec, userDurationSec } = tempo;
    const num = (x) => (Number.isFinite(x) && x > 0 ? Number(x) : 0);
    const ref = num(refDurationSec), usr = num(userDurationSec);
    if (!ref || !usr) return { penalty: 0, reason: '', praise: '', bucketScore: null, bonus: 0 };

    const r = usr / ref; // 1.00=동일, 1.20=20% 느림
    const pct = Math.round((r - 1) * 100);
    if (mode === 'slow') return { penalty: 0, reason: '', praise: '', bucketScore: null, bonus: 0 };

    if (r < 0.85) {
      return {
        penalty: 0,
        reason: `⚡ 빠른 편(무페널티) / Rapide (pas de pénalité)`,
        praise: '속도는 빠르지만 발음이 또박또박하면 아주 좋아요! 🙂',
        bucketScore: 100,
        bonus: 0
      };
    }

    let penalty = 0, reason = '', praise = '', bucketScore = null, bonus = 0;
    if (r <= 1.10) {
      penalty = 0;  bucketScore = 120; bonus = 20;
      reason = '✅ 속도 적절 / Vitesse parfaite (≤10%)';
      praise = '완벽해요! 🎉 (보너스 +20)';
    } else if (r <= 1.40) {
      penalty = 0;  bucketScore = 100;
      reason = `👍 약간 느림(+${pct}%)`;
      praise = '아주 잘했어요! 🙂';
    } else if (r <= 2.00) {
      penalty = 5;  bucketScore = 80;
      reason = `⏱️ +${pct}% 느림`;
      praise = '괜찮아요. 한 번만 더 이어서 말해요!';
    } else if (r <= 3.00) {
      penalty = 10; bucketScore = 70;
      reason = `🐌 많이 느림(+${pct}%)`;
      praise = '약간 느리지만 이해돼요 😉';
    } else if (r <= 4.00) {
      penalty = 20; bucketScore = 60;
      reason = `🐢 매우 느림(+${pct}%)`;
      praise = '조금만 더 하면 더 잘할 것 같아요!';
    } else if (r <= 5.00) {
      penalty = 30; bucketScore = 50;
      reason = `🐢 너무 느림(+${pct}%)`;
      praise = '너무 느리면 대화가 어려워요.';
    } else {
      penalty = 35; bucketScore = 45;
      reason = `🐢 극도로 느림(+${pct}%)`;
      praise = '짧게 끊지 말고 두 문장을 붙여보자!';
    }

    return { penalty, reason, praise, bucketScore, bonus };
  }

  // ===== 발음 전용: 자모 기반 =====
  const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const JUNG= ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  const JONG= ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

  function toJamoSeq(s){
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

  function levJamo(a, b){
    const m=a.length, n=b.length;
    if (!m) return n; if (!n) return m;
    const dp = Array.from({length:m+1},()=>new Array(n+1).fill(0));
    for (let i=0;i<=m;i++) dp[i][0]=i;
    for (let j=0;j<=n;j++) dp[0][j]=j;
    for (let i=1;i<=m;i++){
      for (let j=1;j<=n;j++){
        const cost = a[i-1]===b[j-1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
      }
    }
    return dp[m][n];
  }

  function gradePronun(refRaw, hypRaw, tol=0.10){
    const refJ = toJamoSeq(refRaw), hypJ = toJamoSeq(hypRaw);
    const d = levJamo(refJ, hypJ);
    const rate = refJ.length > 0 ? d / refJ.length : (hypJ.length > 0 ? 1 : 0);
    const jamAcc = 1 - rate;
    const pct = Math.max(0, Math.round(jamAcc*100));

    const createHtml = (text, jamoSeq, jamoLcs) => {
      let html = '';
      let jamoIndex = 0;
      for (const char of [...text.normalize('NFC')]) {
        if (!/[가-힣0-9A-Za-z]/.test(char)) {
          html += `<span>${char}</span>`;
          continue;
        }
        
        let jamoCount = 1;
        if (/[가-힣]/.test(char)) {
          const code = char.codePointAt(0) - 0xAC00;
          jamoCount = (code % 28) ? 3 : 2;
        }
        
        let isCorrect = true;
        for (let i = 0; i < jamoCount; i++) {
          if (jamoIndex + i >= jamoSeq.length || !jamoLcs.has(jamoIndex + i)) {
            isCorrect = false;
            break;
          }
        }
        
        html += isCorrect ? `<span>${char}</span>` : `<span class="diff-incorrect">${char}</span>`;
        jamoIndex += jamoCount;
      }
      return html;
    };

    if (rate <= tol){
      const html = [...refRaw.normalize('NFC')].map(ch=>`<span>${ch}</span>`).join('');
      return { pct: 100, html, html_ref: html, html_hyp: [...hypRaw.normalize('NFC')].map(ch=>`<span>${ch}</span>`).join('') };
    }

    // LCS 기반 빨강 마킹
    const m = refJ.length, n = hypJ.length;
    const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
    for (let i=1;i<=m;i++){
      for (let j=1;j<=n;j++){
        dp[i][j] = refJ[i-1]===hypJ[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
      }
    }

    const lcsRefIndices = new Set();
    let i=m, j=n;
    while (i>0 && j>0){
      if (refJ[i-1]===hypJ[j-1]){ lcsRefIndices.add(i-1); i--; j--; }
      else if (dp[i-1][j] >= dp[i][j-1]) i--; else j--;
    }

    const lcsHypIndices = new Set();
    i=m, j=n;
    while (i>0 && j>0){
        if (refJ[i-1]===hypJ[j-1]){ lcsHypIndices.add(j-1); i--; j--; }
        else if (dp[i-1][j] > dp[i][j-1]) i--; else j--;
    }

    const html_ref = createHtml(refRaw, refJ, lcsRefIndices);
    const html_hyp = createHtml(hypRaw, hypJ, lcsHypIndices);

    return { pct, html: html_ref, html_ref, html_hyp };
  }

  // ===== Scoring 객체 =====
  const Scoring = {
    levStr, levJamo,
    similarity,
    tempoPenalty,
    gradeKO(refText, hypText, opts = {}) {
      const sim = similarity(refText, hypText);
      const weightSim = Number.isFinite(opts.weightSim) ? opts.weightSim : 1.0;
      let base = Math.round(sim * 100 * weightSim);

      const { penalty, reason, praise, bucketScore, bonus } = tempoPenalty(opts.tempo);
      let finalScore = Math.max(0, Math.min(100, base - penalty));

      if (finalScore >= 90 && norm(refText) !== norm(hypText)) {
        finalScore = Math.max(finalScore, 95);
      }

      return {
        score: finalScore,
        baseScore: base,
        tempoPenalty: penalty,
        tempoReason: reason,
        tempoPraise: praise,
        tempoBucketScore: bucketScore,
        tempoBonus: bonus,
        similarity: sim,
        ref: refText,
        hyp: hypText
      };
    },
    gradePronun
  };

  global.Scoring = Scoring;
})(window);
