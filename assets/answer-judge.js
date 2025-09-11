// assets/answer-judge.js
// 텍스트 정답 채점기(공통)
// 요구 반영:
// 1) 숫자 ↔ 한글 수사 완전 동치
// 2) 단위(살/명/개/시/분/월/년/권/마리…) 앞 고유어 축약 허용(한/두/세/네/스무 등)
// 3) “정답 형태가 학생 답 안에 부분 포함돼도” 정답 인정(가점)
// 4) 띄어쓰기/문장부호 등 사소한 차이가 문장의 10% 미만이면 정답 처리
// 5) 프랑스어 채점(불필요어 제거·축약 전개·자카드/레벤슈타인 혼합)
// 6) 말투 일치 검사(나는/난 ↔ -요/-(스)ㅂ니다, 저는/전 ↔ -아/어)

(function (w) {
  'use strict';

  const U = w.NumHangul || {}; // 숫자·한글 보정 공용 유틸(있으면 사용)

  // ---------------- 공통 유틸 ----------------
  const RX_PUNCT = /[.,!?;:()[\]{}"“”'’«»…·\-–—/\\]/g;

  const stripDiacritics = (s="") => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const normSpaces = (s="") => s.replace(/\s+/g," ").trim();
  const collapse = (s="") => s.replace(/\s+/g,"");

  function lev(a,b){
    const s=String(a||""), t=String(b||""); const n=s.length, m=t.length;
    if(!n) return m; if(!m) return n;
    const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
    for(let i=0;i<=n;i++) dp[i][0]=i; for(let j=0;j<=m;j++) dp[0][j]=j;
    for(let i=1;i<=n;i++){ for(let j=1;j<=m;j++){
      const cost=s[i-1]===t[j-1]?0:1;
      dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }} return dp[n][m];
  }

  function similarity(a,b){
    const S=String(a||""), T=String(b||"");
    const L=Math.max(1, Math.max(S.length, T.length));
    const d=lev(S,T);
    return Math.max(0, 1 - d/L);
  }

  // ---------------- 한국어 정규화 ----------------
  // koCanon: 공백/문장부호 제거, 로마자 제거
  function koCanon(s){
    if (typeof U.koCanon === 'function') return U.koCanon(s);
    return String(s||"")
      .toLowerCase()
      .replace(/[a-z]+/g,'')     // 라틴 문자 제거(ga teun 같은 표기 금지)
      .replace(RX_PUNCT,' ')
      .replace(/\s+/g,'')
      .trim();
  }

  // 단위 앞 고유어 축약 허용 보정(스무 살/스물한 살/열한 시/한 명 등)
  // U.applyCounterVariants가 있으면 사용, 없으면 흔한 패턴만 보정
  function applyCounterVariantsLocal(x=""){
    if (typeof U.applyCounterVariants === 'function') return U.applyCounterVariants(x);
    let s=String(x||"");
    // 20: 이십 → 스무 (단위 앞)
    s=s.replace(/이십(?=[가-힣])/g,'스무');
    // 1~4: 일/이/삼/사 → 한/두/세/네 (단위 앞)
    s=s.replace(/일(?=[가-힣])/g,'한')
       .replace(/이(?=[가-힣])/g,'두')
       .replace(/삼(?=[가-힣])/g,'세')
       .replace(/사(?=[가-힣])/g,'네');
    // 셋/넷 + 살 → 세/네 살
    s=s.replace(/셋(?=살)/g,'세').replace(/넷(?=살)/g,'네');
    // 11~14 시(열한/열두/열세/열네)
    s=s.replace(/십일(?=[가-힣])/g,'열한')
       .replace(/십이(?=[가-힣])/g,'열두')
       .replace(/십삼(?=[가-힣])/g,'열세')
       .replace(/십사(?=[가-힣])/g,'열네');
    // 21~24 단위 앞: 이십일/이십이/이십삼/이십사 → 스물한/스물두/스물세/스물네
    s=s.replace(/이십일(?=[가-힣])/g,'스물한')
       .replace(/이십이(?=[가-힣])/g,'스물두')
       .replace(/이십삼(?=[가-힣])/g,'스물세')
       .replace(/이십사(?=[가-힣])/g,'스물네');
    return s;
  }

  // 숫자 → 한글 수사 강제 (가능하면 U.forceHangulNumbers 사용)
  // 이후 고유어 축약 허용
  function normalizeForJudgeRaw(s){
    let x = (typeof U.forceHangulNumbers==='function') ? U.forceHangulNumbers(String(s||"")) : String(s||"");
    x = applyCounterVariantsLocal(x);
    return x;
  }

  // 최종 KO 정규화(표준화 후 캐논으로)
  function normalizeForJudge(s){
    return koCanon( normalizeForJudgeRaw(s) );
  }

  // ---------------- KO 채점 ----------------
  function gradeKO(ref, ans, opts = {}){
    // 옵션 기본값
    const allowSubstring = (opts.allowSubstring !== false); // 기본 true
    const R = normalizeForJudge(ref||"");
    const A = normalizeForJudge(ans||"");

    if (!A) return { score:0, isCorrect:false, note:'vide/빈값' };
    if (A === R) return { score:100, isCorrect:true, note:'숫자/단위 보정' };

    // 부분 포함 가점(“정답 형태가 학생 답 안에 부분 포함돼도 정답으로”)
    // A 안에 R 포함 또는 R 안에 A 포함(학생이 더 짧게 말했더라도 핵심이 맞으면 가점)
    let bestScore = 0, bestRate = 1;
    if (allowSubstring && (A.includes(R) || R.includes(A))) {
      bestScore = Math.max(bestScore, 95);
      bestRate  = Math.min(bestRate, 0.05);
    }

    // 일반 점수(레벤슈타인)
    const d = lev(R, A), L = Math.max(1, R.length), rate = d / L;
    const baseScore = Math.max(0, Math.round((1 - rate) * 100));
    if (baseScore > bestScore){ bestScore = baseScore; bestRate = rate; }

    // 문장부호·띄어쓰기 10% 미만이면 정답 처리
    const rawR = koCanon(ref||"");
    const rawA = koCanon(ans||"");
    const diffRate = 1 - similarity(rawR, rawA); // 캐논끼리 차이율
    if (diffRate <= 0.10) bestScore = Math.max(bestScore, 95);

    const ok = (bestRate <= 0.12) || (bestScore >= 90);
    return { score: bestScore, isCorrect: ok, note: ok ? '숫자/단위 보정' : '차이 큼' };
  }

  // ---------------- FR 채점 ----------------
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

  function gradeFR(ref, ans, opts = {}){
    const refLite = squashParentheses(ref||"");
    const { filtered:Af, raw:Ar } = tokenizeFR(ans||"");
    const { filtered:BfFull } = tokenizeFR(ref||"");
    const { filtered:BfLite } = tokenizeFR(refLite||"");

    if(!Af.length) return { score:0, isCorrect:false, note:"vide/빈값" };

    const Anorm = Af.join(" ");
    if(Anorm===normFR(ref||"") || Anorm===normFR(refLite||""))
      return { score:100, isCorrect:true, note:"accents/ponctuation ignorés" };

    const PRON_SUBJ = new Set(["il","elle","ils","elles","on"]);
    const looksLikeWord = tok => /^[a-z]{2,}$/i.test(tok);
    const first = (Ar[0]||"");
    const subjFlex = looksLikeWord(first) || PRON_SUBJ.has(first);

    const jac = (Bf) => {
      const Aset=new Set(Af), Bset=new Set(Bf);
      const inter=[...Aset].filter(x=>Bset.has(x)).length;
      const uni=new Set([...Aset,...Bset]).size;
      let j=inter/Math.max(1,uni);
      if (subjFlex) j = Math.max(j, 0.95);
      return j;
    };

    const j = Math.max(jac(BfFull), jac(BfLite));
    if(j>=0.85) return { score:95, isCorrect:true, note:"variante acceptée (sujet ok)" };

    const d = lev(normFR(refLite), Anorm), L=Math.max(1,normFR(refLite).length), rate=d/L;
    const ok = rate<=0.15;
    return { score:Math.max(0,Math.round((1-rate)*100)), isCorrect:ok, note:ok?"variantes mineures admises":"écart trop grand" };
  }

  // ---------------- 말투(종결) 일치 검사 ----------------
  // 규칙:
  // - “나는/난”을 썼다면 종결은 -아/어(해체)여야 함. -요/-(스)ㅂ니다와 같이 쓰면 ❌
  // - “저는/전”을 썼다면 종결은 -요/-(스)ㅂ니다여야 함. 해체와 같이 쓰면 ❌
  function checkRegister(ans){
    const tr=String(ans||"").trim();
    const hasJe = /(저는|전)\b/.test(tr);
    const hasNa = /(나는|난)\b/.test(tr);

    const yoEnd = /요[.?!]*$/.test(tr);
    const smEnd = /니다[.?!]*$/.test(tr);
    const haeEnd= /[다]$/.test(tr) || /(아|어|해)[.?!]*$/.test(tr);

    if (hasJe && haeEnd) return { ok:false, ko:"저는/전 ↔ -아/어(해체) ❌ → -요/-(스)ㅂ니다", fr:"« je/jeon » → -yo / -seumnida" };
    if (hasNa && (yoEnd || smEnd)) return { ok:false, ko:"나는/난 ↔ -요/-(스)ㅂ니다 ❌ → -아/어", fr:"« na/nan » → style familier" };
    return { ok:true };
  }

  w.AnswerJudge = { gradeKO, gradeFR, checkRegister };
})(window);
