// assets/answer-judge.js
(function (w) {
  const RX_PUNCT = /[.,!?;:()[\]{}"“”'’«»…·\-–—/\\]/g;

  function stripDiacritics(s = "") { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function normSpaces(s = "") { return s.replace(/\s+/g, " ").trim(); }

  // 불용어 강화(주어/관사/전치사 등) + 소유한정어 추가
  const STOP_FR = new Set([
    "le","la","les","un","une","des","du","de","d","l","au","aux","a","à","en","dans","sur","sous","par","pour","avec","sans","chez",
    "que","qui","dont","ce","cet","cette","ces","se","sa","son","ma","mon","mes",
    "je","tu","il","elle","on","nous","vous","ils","elles","moi","toi","lui","leur","me","te","se",
    "c","qu","j","n","s","t","m","y","ceci","cela"
  ]);

  function preprocessContractionsFR(s = "") {
    // d’aujourd’hui → d aujourd’hui
    s = s.replace(/([cdjlmnstqu])['’]([aeiouyh])/gi, "$1 $2");
    return s;
  }

  function squashParentheses(s=""){ return String(s||"").replace(/\([^)]*\)/g," "); }

  function tokenizeFR(s=""){
    s = preprocessContractionsFR(String(s||"")).toLowerCase();
    s = stripDiacritics(s)
          .replace(/\baujourdhui\b/g,"aujourdhui")
          .replace(/\bd aujourdhui\b/g,"aujourdhui");
    s = s.replace(RX_PUNCT," ");
    s = normSpaces(s);
    const raw = s.split(" ").filter(Boolean);
    const filtered = raw.filter(t => !STOP_FR.has(t));
    return { raw, filtered };
  }

  function normFR(s=""){ return tokenizeFR(s).filtered.join(" "); }
  function normKO(s=""){ return normSpaces(String(s||"").replace(RX_PUNCT," ")); }

  function lev(a,b){
    const s=String(a), t=String(b); const n=s.length, m=t.length;
    if(!n) return m; if(!m) return n;
    const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
    for(let i=0;i<=n;i++) dp[i][0]=i;
    for(let j=0;j<=m;j++) dp[0][j]=j;
    for(let i=1;i<=n;i++){ for(let j=1;j<=m;j++){
      const cost = s[i-1]===t[j-1]?0:1;
      dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }} return dp[n][m];
  }

  function gradeKO(ref, ans, opts = {}) {
    const R = normKO(ref||""), S = normKO(ans||"");
    if(!S) return { score:0, isCorrect:false, note:"vide/빈값" };
    if(S===R) return { score:100, isCorrect:true, note:"공백·구두점 무시" };
    if (opts.allowSubstring && R.includes(S)) return { score:90, isCorrect:true, note:"부분 일치 허용" };
    const d=lev(R,S), L=Math.max(1,R.length), rate=d/L;
    const ok = rate<=0.12;
    return { score:Math.max(0,Math.round((1-rate)*100)), isCorrect:ok, note:ok?"소폭 오차 허용":"차이 큼" };
  }

  function looksLikeProperName(tok){ return /^[a-z]{2,}$/i.test(tok); }

  function gradeFR(ref, ans, opts = {}) {
    // 괄호 속 보충어 제거한 참조 버전도 함께 비교
    const refLite = squashParentheses(ref||"");
    const { filtered:Af } = tokenizeFR(ans||"");
    const { filtered:BfFull } = tokenizeFR(ref||"");
    const { filtered:BfLite } = tokenizeFR(refLite||"");

    if(!Af.length) return { score:0, isCorrect:false, note:"vide/빈값" };
    const Anorm = Af.join(" ");

    // 완전 일치
    if(Anorm===normFR(ref||"") || Anorm===normFR(refLite||"")) {
      return { score:100, isCorrect:true, note:"accents/ponctuation ignorés" };
    }

    // 의미 일치(자카드) — 괄호 제거 버전까지 고려
    const toJac = (Bf) => {
      const Aset=new Set(Af), Bset=new Set(Bf);
      const inter=[...Aset].filter(x=>Bset.has(x)).length;
      const uni=new Set([...Aset,...Bset]).size;
      let jacc=inter/Math.max(1,uni);

      // 고유명사만 추가된 경우(주어 사람 이름) — 정답 처리
      const extra=[...Aset].filter(x=>!Bset.has(x));
      const onlyProper = extra.length>0 && extra.every(looksLikeProperName);
      if(onlyProper) jacc = Math.max(jacc, 0.9);

      return jacc;
    };

    const j1 = toJac(BfFull);
    const j2 = toJac(BfLite);
    const j = Math.max(j1, j2);
    if(j>=0.85) return { score:95, isCorrect:true, note:"variante acceptée / 주어 변형 허용" };

    // 철자 오차 허용(15%)
    const d = lev(normFR(refLite), Anorm), L = Math.max(1, normFR(refLite).length), rate=d/L;
    const ok = rate<=0.15;
    return { score:Math.max(0,Math.round((1-rate)*100)), isCorrect:ok, note:ok?"variantes mineures admises":"écart trop grand" };
  }

  function checkRegister(ans){
    const je=/(저는|전)\b/.test(ans), na=/(나는|난)\b/.test(ans), tr=String(ans||"").trim();
    const yo=/요[.?!]*$/.test(tr), sm=/니다[.?!]*$/.test(tr), hae=/[다]$/.test(tr);
    if(je && hae) return { ok:false, ko:"저는/전 ↔ -아/어(해체) ❌ → -요/-(스)ㅂ니다", fr:"« je/jeon » → -yo / -seumnida" };
    if(na && (yo||sm)) return { ok:false, ko:"나는/난 ↔ -요/-(스)ㅂ니다 ❌ → -아/어", fr:"« na/nan » → style familier" };
    return { ok:true };
  }

  w.AnswerJudge = { gradeKO, gradeFR, checkRegister };
})(window);
