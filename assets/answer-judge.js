// assets/answer-judge.js
(function (w) {
  const RX_PUNCT = /[.,!?;:()[\]{}"“”'’«»…·\-–—/\\]/g;

  const stripDiacritics = (s="") => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const normSpaces = (s="") => s.replace(/\s+/g," ").trim();

  // FR 불용어(주요 대명사/관사/전치사 + 소유형용사)
  const STOP_FR = new Set([
    "le","la","les","un","une","des","du","de","d","l","au","aux","a","à","en","dans","sur","sous","par","pour","avec","sans","chez",
    "que","qui","dont","ce","cet","cette","ces","se","sa","son","ma","mon","mes",
    "je","tu","il","elle","on","nous","vous","ils","elles","moi","toi","lui","leur","me","te","se",
    "c","qu","j","n","s","t","m","y","ceci","cela"
  ]);

  function preprocessContractionsFR(s=""){
    // d’aujourd’hui → d aujourd’hui
    return s.replace(/([cdjlmnstqu])['’]([aeiouyh])/gi,"$1 $2");
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
  const normFR = (s="") => tokenizeFR(s).filtered.join(" ");
  const normKO = (s="") => normSpaces(String(s||"").replace(RX_PUNCT," "));

  function lev(a,b){
    const s=String(a), t=String(b); const n=s.length, m=t.length;
    if(!n) return m; if(!m) return n;
    const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
    for(let i=0;i<=n;i++) dp[i][0]=i; for(let j=0;j<=m;j++) dp[0][j]=j;
    for(let i=1;i<=n;i++){ for(let j=1;j<=m;j++){
      const cost=s[i-1]===t[j-1]?0:1;
      dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }} return dp[n][m];
  }

  // --- KO 채점(받아쓰기) ---
  function gradeKO(ref, ans, opts = {}) {
    const R = normKO(ref||""), S = normKO(ans||"");
    if(!S) return { score:0, isCorrect:false, note:"vide/빈값" };
    if(S===R) return { score:100, isCorrect:true, note:"공백·구두점 무시" };
    if(opts.allowSubstring && R.includes(S)) return { score:90, isCorrect:true, note:"부분 일치 허용" };
    const d=lev(R,S), L=Math.max(1,R.length), rate=d/L;
    const ok = rate<=0.12;
    return { score:Math.max(0,Math.round((1-rate)*100)), isCorrect:ok, note:ok?"소폭 오차 허용":"차이 큼" };
  }

  const PRON_SUBJ = new Set(["il","elle","ils","elles","on"]);
  const looksLikeProperName = tok => /^[a-z]{2,}$/i.test(tok);

  // --- FR 채점(의미 일치+주어 유연성) ---
  function gradeFR(ref, ans, opts = {}) {
    const refLite = squashParentheses(ref||""); // 괄호 설명 제거 버전
    const { filtered:Af, raw:Ar } = tokenizeFR(ans||"");
    const { filtered:BfFull } = tokenizeFR(ref||"");
    const { filtered:BfLite } = tokenizeFR(refLite||"");

    if(!Af.length) return { score:0, isCorrect:false, note:"vide/빈값" };

    const Anorm = Af.join(" ");
    if(Anorm===normFR(ref||"") || Anorm===normFR(refLite||""))
      return { score:100, isCorrect:true, note:"accents/ponctuation ignorés" };

    // 주어 유연성: 답이 사람 이름/성별대명사로 시작하거나, 참조가 그 반대여도 정답 처리
    const subjFlex = (() => {
      const first = (Ar[0]||"");
      const ansHasProperAsSubject = looksLikeProperName(first);
      const ansHasPronSubject = PRON_SUBJ.has(first);
      // 참조 쪽은 불용어 제거 때문에 주어 정보가 빠질 수 있어 jaccard에서 보정
      return ansHasProperAsSubject || ansHasPronSubject;
    })();

    const jac = (Bf) => {
      const Aset=new Set(Af), Bset=new Set(Bf);
      const inter=[...Aset].filter(x=>Bset.has(x)).length;
      const uni=new Set([...Aset,...Bset]).size;
      let j=inter/Math.max(1,uni);
      // 사람 주어만 다른 경우 점수 보정
      if (subjFlex) j = Math.max(j, 0.95);
      return j;
    };

    const j = Math.max(jac(BfFull), jac(BfLite));
    if(j>=0.85) return { score:95, isCorrect:true, note:"variante acceptée (sujet personne ok)" };

    // 철자 오차(≤15%)
    const d = lev(normFR(refLite), Anorm), L=Math.max(1,normFR(refLite).length), rate=d/L;
    const ok = rate<=0.15;
    return { score:Math.max(0,Math.round((1-rate)*100)), isCorrect:ok, note:ok?"variantes mineures admises":"écart trop grand" };
  }

  function checkRegister(ans){
    const je=/(저는|전)\b/.test(ans), na=/(나는|난)\b/.test(ans);
    const tr=String(ans||"").trim();
    const yo=/요[.?!]*$/.test(tr), sm=/니다[.?!]*$/.test(tr), hae=/[다]$/.test(tr);
    if(je && hae) return { ok:false, ko:"저는/전 ↔ -아/어(해체) ❌ → -요/-(스)ㅂ니다", fr:"« je/jeon » → -yo / -seumnida" };
    if(na && (yo||sm)) return { ok:false, ko:"나는/난 ↔ -요/-(스)ㅂ니다 ❌ → -아/어", fr:"« na/nan » → style familier" };
    return { ok:true };
  }

  w.AnswerJudge = { gradeKO, gradeFR, checkRegister };
})(window);
