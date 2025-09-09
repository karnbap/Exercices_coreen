/* KO: 철자 엄격(초/중/종성 다르면 ×), 공백·구두점은 무시
   FR: 악센트·구두점 무시, 의미 90%≈(자카드 0.9) 또는 편집거리 15% 이내면 ○
   - opts.altRefs: 대체 정답 배열(이름/il/elle 등 허용)
*/
(function (w) {
  const RX_PUNCT=/[\p{P}\p{S}]/gu, RX_SPACE=/\s+/g, RX_MARKS=/\p{M}/gu, RX_HANGUL=/[가-힣]/g;

  const NFD=s=>String(s||'').normalize('NFD');
  const deacc=s=>NFD(s).replace(RX_MARKS,'');
  const onlyHangul=s=>(String(s||'').match(RX_HANGUL)||[]).join('');
  const trimSpaces=s=>String(s||'').replace(RX_SPACE,' ').trim();

  // Hangul L/V/T 분해
  const S0=0xAC00, Lc=19, Vc=21, Tc=28, N=Vc*Tc, Sc=Lc*N;
  function decomp(ch){
    const cp=ch.codePointAt(0); if(cp<S0||cp>=S0+Sc) return null;
    const i=cp-S0; return {L:Math.floor(i/N), V:Math.floor((i%N)/Tc), T:i%Tc};
  }

  // Levenshtein(메모리 절약형)
  function lev(a,b){
    const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
    const d=new Array(n+1); for(let j=0;j<=n;j++) d[j]=j;
    for(let i=1;i<=m;i++){ let prev=d[0]; d[0]=i;
      for(let j=1;j<=n;j++){ const tmp=d[j];
        d[j]=(a[i-1]===b[j-1])?prev:1+Math.min(prev,d[j-1],d[j]); prev=tmp;
      }
    } return d[n];
  }

  // ---------- 정규화 ----------
  function normKO(s){ // 공백/구두점 제거 + 한글만
    return onlyHangul(String(s||'').replace(RX_PUNCT,'')).replace(/\s+/g,'');
  }
  function normFR(s){ // 악센트/구두점 제거 + 소문자 + 공백정리
    return trimSpaces(deacc(String(s||'').toLowerCase()).replace(RX_PUNCT,''));
  }

  // ---------- KO: 받아쓰기 엄격 ----------
  function gradeKO(ref, ans, opts={}){
    const { allowSubstring=false } = opts;
    const R=normKO(ref), S=normKO(ans);
    if(!S) return {score:0,isCorrect:false,note:'빈 답안'};

    if(allowSubstring && (S.includes(R) || R.includes(S)))
      return {score:100,isCorrect:true,note:'부분 포함(일반 문항)'};

    if(S===R) return {score:100,isCorrect:true,note:'철자 일치'};

    if(S.length!==R.length)
      return {score:0,isCorrect:false,note:'글자 수 다름(공백/부호 제외)'};

    // 글자별로 초/중/종성 비교 — 하나라도 다르면 ×
    let vowelErr=false, consErr=false, batchimErr=false;
    for(let i=0;i<R.length;i++){
      if(R[i]===S[i]) continue;
      const a=decomp(R[i]), b=decomp(S[i]);
      if(a&&b){
        if(a.V!==b.V) vowelErr=true;     // 모음
        if(a.L!==b.L) consErr=true;      // 초성
        if(a.T!==b.T) batchimErr=true;   // 종성
      }else{ consErr=true; } // 비한글 혼입 등
    }
    const bits=[]; if(vowelErr) bits.push('모음 오류'); if(consErr) bits.push('자음 오류'); if(batchimErr) bits.push('받침 오류');
    return {score:0,isCorrect:false,note:bits.length?bits.join('·'):'철자 불일치'};
  }

  // ---------- FR: 의미 위주 ----------
  function gradeFR(ref, ans, opts={}){
    const R=normFR(ref), S=normFR(ans);
    if(!S) return {score:0,isCorrect:false,note:'réponse vide'};

    // 완전일치 먼저
    if(S===R) return {score:100,isCorrect:true,note:'accents/ponctuation ignorés'};

    // 대체 참조문장 허용 (예: 이름 주어/ il / elle)
    const alts = Array.isArray(opts.altRefs)?opts.altRefs:[];
    for(const alt of alts){ const A=normFR(alt); if(S===A) return {score:100,isCorrect:true,note:'variante acceptée'}; }

    // 토큰 기준 의미 유사도(자카드) ≥ 0.90
    const set=t=>new Set(String(t).split(' ').filter(Boolean));
    const a=set(S), b=set(R);
    const inter=[...a].filter(x=>b.has(x)).length;
    const uni=new Set([...a,...b]).size;
    const jacc = inter/Math.max(1,uni);
    if(jacc>=0.90) return {score:95,isCorrect:true,note:'mots essentiels concordants'};

    // 철자 오차 허용(15%)
    const d=lev(R,S), L=Math.max(1,R.length), rate=d/L, ok=rate<=0.15;
    return {score:Math.max(0,Math.round((1-rate)*100)),isCorrect:ok,note:ok?'variantes mineures admises':'écart trop grand'};
  }

  // 말투 가이드(참고용)
  function checkRegister(ans){
    const je=/(저는|전)\b/.test(ans), na=/(나는|난)\b/.test(ans), tr=String(ans||'').trim();
    const yo=/요[.?!]*$/.test(tr), sm=/니다[.?!]*$/.test(tr), hae=/[다]$/.test(tr);
    if(je&&hae) return {ok:false,ko:'저는/전 ↔ -아/어(해체) ❌ → -요/-(스)ㅂ니다',fr:'« je/jeon » → -yo / -seumnida'};
    if(na&&(yo||sm)) return {ok:false,ko:'나는/난 ↔ -요/-(스)ㅂ니다 ❌ → -아/어',fr:'« na/nan » → style familier'};
    return {ok:true};
  }

  w.AnswerJudge={ gradeKO, gradeFR, checkRegister };
})(window);
