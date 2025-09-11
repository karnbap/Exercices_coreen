/* scoring.js
 * - 한국어 발음/철자 유사도 기반 점수
 * - (신규) 템포(말하기 속도) 페널티 옵션 지원
 *
 * 사용법:
 *   Scoring.gradeKO(refText, hypText, {
 *     tempo: { mode:'slow'|'normal'|'fast', refDurationSec:number, userDurationSec:number }
 *   })
 */

(function (global) {
  const isHangul = (ch) => /[가-힣]/.test(ch);
  const norm = (s) =>
    String(s || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.,!?;:~、。！？；：]/g, '')
      .toLowerCase();

  // 간단 Levenshtein
  function lev(a, b) {
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
    const d = lev(s, t);
    return Math.max(0, 1 - d / L);
  }

  // === (신규) 템포 페널티 ===
  // - slow(0.7×): 페널티 없음 (학습 안정)
  // - normal(1.0×), fast(1.5×): 기준 오디오보다 "느리면" 감점
  //   ratio = userDuration / refDuration
  //   정상 범위(±10%) 이내 0점, 이탈 정도에 따라 구간 감점
  function tempoPenalty(tempo) {
    if (!tempo) return { penalty: 0, reason: '' };
    const { mode, refDurationSec, userDurationSec } = tempo;
    const safeNum = (x) => (isFinite(x) && x > 0 ? x : 0);
    const ref = safeNum(refDurationSec);
    const usr = safeNum(userDurationSec);
    if (!ref || !usr) return { penalty: 0, reason: '' };

    // 느린 정도를 비율로 계산
    const ratio = usr / ref; // 1.00 = 동일, 1.20 = 20% 더 느림
    const pct = Math.round((ratio - 1) * 100); // +20 → 20% 느림, -10 → 10% 빠름

    // slow 모드(0.7×)는 페널티 없음
    if (mode === 'slow') return { penalty: 0, reason: '' };

    let penalty = 0;
    let reason = '';

    // 과도하게 빠른 경우(=과속)도 소폭 감점(발음 뭉개짐 방지)
    if (ratio < 0.85) {
      penalty = mode === 'fast' ? 8 : 5;
      reason = `⚠️ 너무 빠름(${Math.abs(pct)}% 빠름) → -${penalty}점 / Trop rapide (${Math.abs(pct)}%)`;
      return { penalty, reason };
    }

    // 기준 ±10% 이내 → 0점
    if (ratio <= 1.10) {
      return { penalty: 0, reason: '✅ 속도 적절 / Vitesse correcte (±10%)' };
    }

    // 느림에 대한 구간 페널티
    if (mode === 'normal') {
      if (ratio <= 1.25) { penalty = 5;  reason = `🎯 기준(1.0×)보다 ${pct}% 느림 → -5점`; }
      else if (ratio <= 1.50) { penalty = 10; reason = `⏱️ ${pct}% 느림 → -10점`; }
      else if (ratio <= 2.00) { penalty = 20; reason = `🐌 ${pct}% 느림 → -20점`; }
      else { penalty = 30; reason = `🐢 매우 느림(${pct}% 느림) → -30점`; }
    } else if (mode === 'fast') {
      if (ratio <= 1.25) { penalty = 10; reason = `🎯 기준(1.5×)보다 ${pct}% 느림 → -10점`; }
      else if (ratio <= 1.50) { penalty = 20; reason = `⏱️ ${pct}% 느림 → -20점`; }
      else { penalty = 35; reason = `🐢 매우 느림(${pct}% 느림) → -35점`; }
    }

    // 이중 표기(FR/KO)
    if (reason) {
      const fr = reason.replace('느림', 'plus lente').replace('매우', 'très');
      reason += ` / ${fr}`;
    }
    return { penalty, reason };
  }

  function clamp01(x) { return Math.min(1, Math.max(0, x)); }

  const Scoring = {
    /**
     * @param {string} refText - 기준 문장
     * @param {string} hypText - 학습자 문장(ASR 결과 등)
     * @param {object} [opts]
     *   - tempo?: { mode:'slow'|'normal'|'fast', refDurationSec:number, userDurationSec:number }
     *   - weightSim?: number (기본 1.0)
     */
    gradeKO(refText, hypText, opts = {}) {
      const sim = similarity(refText, hypText); // 0..1
      const weightSim = Number.isFinite(opts.weightSim) ? opts.weightSim : 1.0;

      // 기본 점수(문자 유사도 기반 0..100)
      let base = Math.round(sim * 100 * weightSim);

      // 템포 페널티 적용
      const { penalty, reason } = tempoPenalty(opts.tempo);
      let finalScore = Math.max(0, Math.min(100, base - penalty));

      // 사소한 문장부호/띄어쓰기(10% 미만)는 정답 처리: 유사도 높을 때 보정
      if (finalScore >= 90 && norm(refText) !== norm(hypText)) {
        finalScore = Math.max(finalScore, 95);
      }

      return {
        score: finalScore,
        baseScore: base,
        tempoPenalty: penalty,
        tempoReason: reason,
        similarity: sim,
        ref: refText,
        hyp: hypText
      };
    }
  };

  global.Scoring = Scoring;
})(window);
