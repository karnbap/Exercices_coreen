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
  // - normal/fast: 기준 오디오보다 "느리면" 감점 + 칭찬/조언 문구(praise) 제공
  //   ratio = userDuration / refDuration
function tempoPenalty(tempo) {
  if (!tempo) return { penalty: 0, reason: '', praise: '', bucketScore: null, bonus: 0 };
  const { mode, refDurationSec, userDurationSec } = tempo;
  const num = (x) => (Number.isFinite(x) && x > 0 ? Number(x) : 0);
  const ref = num(refDurationSec), usr = num(userDurationSec);
  if (!ref || !usr) return { penalty: 0, reason: '', praise: '', bucketScore: null, bonus: 0 };

  const r = usr / ref;                    // 1.00=동일, 1.20=20% 느림
  const pct = Math.round((r - 1) * 100);
  if (mode === 'slow') return { penalty: 0, reason: '', praise: '', bucketScore: null, bonus: 0 };

  // 빠른 속도: 발음만 정확하면 감점 없음
  if (r < 0.85) {
    return {
      penalty: 0,
      reason: `⚡ 빠른 편(무페널티) / Rapide (pas de pénalité)`,
      praise: '속도는 빠르지만 발음이 또박또박하면 아주 좋아요! / Rapide mais clair, excellent 🙂',
      bucketScore: 100,
      bonus: 0
    };
  }

  



  let penalty = 0, reason = '', praise = '', bucketScore = null, bonus = 0;

  // ✅ 요청하신 구간/멘트/점수 매핑
  if (r <= 1.10) {
    penalty = 0;  bucketScore = 120; bonus = 20;
    reason = '✅ 속도 적절 / Vitesse parfaite (≤10%)';
    praise = '완벽해요! / Parfait ! 🎉 (보너스 +20)';
  } else if (r <= 1.40) {
    penalty = 0;  bucketScore = 100;
    reason = `👍 약간 느림(+${pct}%) / Légèrement plus lent`;
    praise = '아주 잘했어요! / Très bien ! 🙂';
  } else if (r <= 2.00) {
    penalty = 5;  bucketScore = 80;
    reason = `⏱️ +${pct}% 느림 / Plus lent`;
    praise = '괜찮아요. 한 번만 더 이어서 말해요! / Correct, encore une fois !';
  } else if (r <= 3.00) {
    penalty = 10; bucketScore = 70;
    reason = `🐌 많이 느림(+${pct}%) / Assez lent`;
    praise = '약간 느리지만 이해돼요. 호흡만 조금 더! / Compréhensible, colle un peu le débit 😉';
  } else if (r <= 4.00) {
    penalty = 20; bucketScore = 60;
    reason = `🐢 매우 느림(+${pct}%) / Très lent`;
    praise = '조금만 더 하면 더 잘할 것 같아요!! / Tu y es presque !! 💪';
  } else if (r <= 5.00) {
    penalty = 30; bucketScore = 50;
    reason = `🐢 너무 느림(+${pct}%) / Trop lent`;
    praise = '너무 느리면 대화가 어려워요. 3번만 반복하면 1단계 ↑ / Répète 3 fois, tu montes ! 🚀';
  } else {
    penalty = 35; bucketScore = 45;
    reason = `🐢 극도로 느림(+${pct}%) / Extrêmement lent`;
    praise = '짧게 끊지 말고 두 문장을 붙여보자! / Essaie de lier sans coupure 😉';
  }

  return { penalty, reason, praise, bucketScore, bonus };
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
      const { penalty, reason, praise, bucketScore, bonus } = tempoPenalty(opts.tempo);
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
  tempoPraise: praise,           // ⬅ 추가
  tempoBucketScore: bucketScore, // ⬅ 추가
  tempoBonus: bonus,             // ⬅ 추가
  similarity: sim,
  ref: refText,
  hyp: hypText
};


    }
  };

  global.Scoring = Scoring;
})(window);
