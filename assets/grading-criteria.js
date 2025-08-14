/* assets/grading-criteria.js */
/* 🏆 채점 기준 문구 (Critères de notation) */
/* 이 파일만 수정하면 모든 페이지의 채점 문구가 바뀝니다! */

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
        fr: "Allez, un petit café et on repart ! ☕💪🇰🇷"
    }
};

const comparisonMessage = {
    ko: "여기는 살짝 삐끗 😅 → 이렇게 하면 완벽!",
    fr: "Oups, petit couac 😅 → comme ça, c’est parfait !"
};
