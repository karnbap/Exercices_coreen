/* assets/grading-criteria.js */
/* 🏆 채점 기준 문구 (Critères de notation)
   이 파일만 수정하면 모든 페이지의 채점 문구가 바뀝니다! */
;(function (global) {
  const gradingMessages = {
    perfect: { // 100%
      ko: "완벽 그 자체! 👑🎉 천재 인증!",
      fr: "Parfait absolu ! 👑🎉 Génie confirmé !"
    },
    excellent: { // 80% 이상
      ko: "아주 잘했어요! 👍 이 정도면 거의 마스터!",
      fr: "Très bien joué ! 👍 Presque un maître !"
    },
    good: { // 60% 이상
      ko: "꽤 잘했어요! 😎 조금만 더 가면 최고!",
      fr: "Pas mal du tout ! 😎 Encore un petit effort et c’est le top !"
    },
    effort: { // 59% 이하
      ko: "자, 커피 한 잔 하고 다시 가자! ☕💪",
      fr: "Allez, un petit café et on repart ! ☕"
    }
  };

  const comparisonMessage = {
    ko: "여기는 살짝 삐끗 😅 → 이렇게 하면 완벽!",
    fr: "Oups, petit couac 😅 → comme ça, c’est parfait !"
  };

  // ✅ 점수 기반 메시지 + 점수 수치 함께 반환
function getGradingMessage(score){
  // ✅ 특별 케이스: 90점 이상이면 "Parfait absolu!"
  if (score >= 90) {
    return {
      emoji: "👑🎉",
      fr: "Parfait absolu ! Génie confirmé !",
      ko: "완벽 그 자체! 천재 인증!"
    };
  }

  // 🔽 기존 구간별 메시지 로직 유지
  if (score >= 80) return { emoji:"🌟", fr:"Très bien !", ko:"아주 좋아요!" };
  if (score >= 60) return { emoji:"👍", fr:"Bien joué", ko:"잘했어요" };
  if (score >= 40) return { emoji:"🙂", fr:"Peut mieux faire", ko:"더 노력해요" };
  return { emoji:"💪", fr:"Continue d’essayer", ko:"계속 도전해요" };
}

window.Grading = { getGradingMessage };


  // 선택: 페이지에 바로 붙일 예쁜 배너 HTML
  function formatFinalBanner(score) {
    const m = getGradingMessage(score);
    return `
      <div style="margin-top:12px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:18px;font-weight:700">${m.emoji} ${m.fr}</div>
        <div style="font-size:16px;color:#374151;margin-top:4px">${m.ko}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:6px">Score: ${m.score}/100</div>
      </div>
    `;
  }

  global.Grading = {
    getGradingMessage,
    comparisonMessage,
    gradingMessages,
    formatFinalBanner
  };
})(window);
