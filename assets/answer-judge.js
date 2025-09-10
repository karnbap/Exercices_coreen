// assets/answer-judge.js
(function (w) {
  const RX_PUNCT = /[.,!?;:()[\]{}"“”'’«»…·\-–—/\\]/g;

  const stripDiacritics = (s="") => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const normSpaces = (s="") => s.replace(/\s+/g," ").trim();

  const STOP_FR = new Set(["le","la","les","un","une","des","du","de","d","l","au","aux","a","à","en","dans","sur","sous","par","pour","avec","sans","chez",
    "que","qui","dont","ce","cet","cette","ces","se","sa","son","ma","mon","mes",
    "je","tu","il","elle","on","nous","vous","ils","elles","moi","toi","lui","leur","me","te","se",
    "c","qu","j","n","s","t","m","y","ceci","cela"
  ]);

  function preprocessContractionsFR(s=""){ return s.replace(/([cdjlmnstqu])['’]([aeiouyh])/gi,"$1 $2"); }
  function squashParentheses(s=""){ return String(s||"").replace(/\([^)]*\)/g," "); }

  function tokenizeFR(s=""){
    s = preprocessContractionsFR(String(s||"")).toLowerCase();
    s = stripDiacritics(s).replace(/\baujourdhui\b/g,"aujourdhui").replace(/\bd aujourdhui\b/g,"aujourdhui");
    s = s.replace(RX_PUNCT," "); s = normSpaces(s);
    const raw = s.split(" ").filter(Boolean);
    const filtered = raw.filter(t => !STOP_FR.has(t));
    return { raw, filtered };
  }
  const normFR = (s="") => tokenizeFR(s).filtered.join(" ");

  // 숫자 대체 맵
  const __KO_NUM_SINO   = {'0':'영','1':'일','2':'이','3':'삼','4':'사','5':'오','6':'육','7':'칠','8':'팔','9':'구'};
  const __KO_NUM_NATIVE = {'0':'영','1':'하나','2':'둘','3':'셋','4':'넷','5':'다섯','6':'여섯','7':'일곱','8':'여덟','9':'아홉'};

  function koCanon(s){
    return String(s||'')
      .toLowerCase()
      .replace(/[a-z]+/g,'')     // 로마자 표기 강제 제거
      .replace(RX_PUNCT,' ')
      .replace(/\s+/g,'')        // 모든 공백 제거 → 일이삼
      .trim();
  }
  function koNumExpand(s){
    if (!/\d/.test(s)) return [s];
    const rep = (map) => s.replace(/\d/g, d => map[d] || d);
    return [s, rep(__KO_NUM_SINO), rep(__KO_NUM_NATIVE)];
  }

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

  // --- KO 채점 ---
  function gradeKO(ref, ans, opts = {}) {
    const R = koCanon(ref || "");
    const base = koCanon(ans || "");
    if (!base) return { score: 0, isCorrect: false, note: "vide/빈값" };

    const cands = koNumExpand(base);
    let bestScore = 0, bestRate = 1;

    for (const S of cands) {
      if (S === R) return { score: 100, isCorrect: true, note: "숫자/공백 보정" };
      if (opts.allowSubstring && R.includes(S)) { bestScore = Math.max(bestScore, 90); bestRate = Math.min(bestRate, 0.1); continue; }
      const d = lev(R, S), L = Math.max(1, R.length), rate = d / L;
      const score = Math.max(0, Math.round((1 - rate) * 100));
      if (score > bestScore) { bestScore = score; bestRate = rate; }
    }

    const ok = bestRate <= 0.12 || bestScore >= 90;
    return { score: bestScore, isCorrect: ok, note: ok ? "숫자/공백 보정" : "차이 큼" };
  }

  // --- FR 채점 ---
  function gradeFR(ref, ans, opts = {}) {
    const refLite = squashParentheses(ref||"");
    const { filtered:Af, raw:Ar } = tokenizeFR(ans||"");
    const { filtered:BfFull } = tokenizeFR(ref||"");
    const { filtered:BfLite } = tokenizeFR(refLite||"");

    if(!Af.length) return { score:0, isCorrect:false, note:"vide/빈값" };

    const Anorm = Af.join(" ");
    if(Anorm===normFR(ref||"") || Anorm===normFR(refLite||""))
      return { score:100, isCorrect:true, note:"accents/ponctuation ignorés" };

    const PRON_SUBJ = new Set(["il","elle","ils","elles","on"]);
    const looksLikeProperName = tok => /^[a-z]{2,}$/i.test(tok);
    const first = (Ar[0]||"");
    const subjFlex = looksLikeProperName(first) || PRON_SUBJ.has(first);

    const jac = (Bf) => {
      const Aset=new Set(Af), Bset=new Set(Bf);
      const inter=[...Aset].filter(x=>Bset.has(x)).length;
      const uni=new Set([...Aset,...Bset]).size;
      let j=inter/Math.max(1,uni);
      if (subjFlex) j = Math.max(j, 0.95);
      return j;
    };

    const j = Math.max(jac(BfFull), jac(BfLite));
    if(j>=0.85) return { score:95, isCorrect:true, note:"variante acceptée (sujet personne ok)" };

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
