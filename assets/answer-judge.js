// assets/answer-judge.js
(function (w) {
  // ---------- 공통 유틸 ----------
  const RX_PUNCT = /[.,!?;:()[\]{}"“”'’«»…·\-–—/\\]/g;

  function stripDiacritics(s = "") {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function normSpaces(s = "") {
    return s.replace(/\s+/g, " ").trim();
  }

  // 프랑스어: 축약(아포스트로피) 풀기 + 소문자 + 악센트 제거 + 불용어 제거
  const STOP_FR = new Set([
    // 관사/전치사/축약
    "le","la","les","un","une","des","du","de","d","l","au","aux","a","à","en","dans","sur","sous","par","pour","avec","sans","chez",
    "que","qui","dont","ce","cet","cette","ces","se","sa","son",
    // 인칭/지시
    "je","tu","il","elle","on","nous","vous","ils","elles","moi","toi","lui","leur","me","te","se",
    // 기타 축약 흔한 것들
    "c","qu","j","n","s","t","m","y"
  ]);

  function preprocessContractionsFR(s = "") {
    // d’aujourd’hui → d aujourd’hui (먼저 공백 삽입)
    s = s.replace(/([cdjlmnstqu])['’]([aeiouyh])/gi, "$1 $2");
    return s;
  }

  function normFR(s = "") {
    s = preprocessContractionsFR(String(s || ""));
    // 소문자 + 악센트 제거 (아포스트로피는 위에서 처리해서 제거해도 영향 없음)
    s = stripDiacritics(s.toLowerCase());
    // 특수 처리: d aujourdhui ↔ aujourd hui 동치
    s = s.replace(/\baujourdhui\b/g, "aujourdhui").replace(/\bd aujourdhui\b/g, "aujourdhui");
    // 문장부호 제거 후 토큰화
    s = s.replace(RX_PUNCT, " ");
    s = normSpaces(s);
    const tokens = s.split(" ").filter(Boolean).filter(t => !STOP_FR.has(t));
    return tokens.join(" ");
  }

  // KO 정규화 (기존 동작과 동일—간단 버전)
  function normKO(s = "") {
    // 공백/구두점 느슨히
    return normSpaces(String(s || "").replace(RX_PUNCT, " "));
  }

  // Levenshtein
  function lev(a, b) {
    const s = String(a), t = String(b);
    const n = s.length, m = t.length;
    if (!n) return m; if (!m) return n;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[n][m];
  }

  // ---------- 채점기 ----------
  function gradeKO(ref, ans, opts = {}) {
    const R = normKO(ref || "");
    const S = normKO(ans || "");
    if (!S) return { score: 0, isCorrect: false, note: "vide/빈값" };
    if (S === R) return { score: 100, isCorrect: true, note: "공백·구두점 무시" };

    // 부분허용 옵션
    if (opts.allowSubstring) {
      if (R.includes(S)) return { score: 90, isCorrect: true, note: "부분 일치 허용" };
    }
    // 철자 오차(공백/마침표 등) 조금 허용
    const d = lev(R, S), L = Math.max(1, R.length), rate = d / L;
    const ok = rate <= 0.12;
    return { score: Math.max(0, Math.round((1 - rate) * 100)), isCorrect: ok, note: ok ? "소폭 오차 허용" : "차이 큼" };
  }

  function gradeFR(ref, ans, opts = {}) {
    const R = normFR(ref || "");
    const S = normFR(ans || "");
    if (!S) return { score: 0, isCorrect: false, note: "vide/빈값" };

    // 완전 일치
    if (S === R) return { score: 100, isCorrect: true, note: "accents/ponctuation ignorés" };

    // (선택) 대체 참조 허용
    const alts = Array.isArray(opts.altRefs) ? opts.altRefs : [];
    for (const alt of alts) {
      if (normFR(alt) === S) return { score: 100, isCorrect: true, note: "variante acceptée" };
    }

    // 의미 중심 유사도 (불용어 제외 후 자카드)
    const set = (t) => new Set(String(t).split(" ").filter(Boolean));
    const A = set(S), B = set(R);
    const inter = [...A].filter(x => B.has(x)).length;
    const uni = new Set([...A, ...B]).size;
    const jacc = inter / Math.max(1, uni);

    if (jacc >= 0.85) {
      return { score: 95, isCorrect: true, note: "mots essentiels concordants (variante ok)" };
    }

    // 철자 오차(15%)까지 완화
    const d = lev(R, S), L = Math.max(1, R.length), rate = d / L;
    const ok = rate <= 0.15;
    return {
      score: Math.max(0, Math.round((1 - rate) * 100)),
      isCorrect: ok,
      note: ok ? "variantes mineures admises" : "écart trop grand"
    };
  }

  // 말투 가이드(참고)
  function checkRegister(ans) {
    const je = /(저는|전)\b/.test(ans), na = /(나는|난)\b/.test(ans), tr = String(ans || "").trim();
    const yo = /요[.?!]*$/.test(tr), sm = /니다[.?!]*$/.test(tr), hae = /[다]$/.test(tr);
    if (je && hae) return { ok: false, ko: "저는/전 ↔ -아/어(해체) ❌ → -요/-(스)ㅂ니다", fr: "« je/jeon » → -yo / -seumnida" };
    if (na && (yo || sm)) return { ok: false, ko: "나는/난 ↔ -요/-(스)ㅂ니다 ❌ → -아/어", fr: "« na/nan » → style familier" };
    return { ok: true };
  }

  w.AnswerJudge = { gradeKO, gradeFR, checkRegister };
})(window);
