// KO 엄격 / FR 관대 — v2 (모음·받침 오타 ❌, 공백·구두점 무시, "학생답이 더 길고 정답을 온전히 포함"할 때만 예외 ✓)
(function(w){
  const P=/[\p{P}\p{S}]/gu, W=/\s+/g, M=/\p{M}/gu, H=/[가-힣]/g;

  // 유틸
  const nfd = s => String(s||'').normalize('NFD');
  const deacc = s => nfd(s).replace(M,'');
  const stripPunc = s => String(s||'').replace(P,'');
  const onlyHangul = s => (String(s||'').match(H)||[]).join('');

  // KO: 공백/구두점 완전 제거 + 한글만
  const normKO = s => onlyHangul(stripPunc(String(s||'').normalize('NFC'))).replace(W,'');
  // FR: 악상/구두점/대소문자 무시 (공백은 1칸으로)
  const normFR = s => deacc(stripPunc(String(s||'').toLowerCase())).replace(W,' ').trim();

  // 한글 분해(모음 비교)
  const S0=0xAC00, Lc=19, Vc=21, Tc=28, N=Vc*Tc;
  function decomp(ch){
    const c=ch.codePointAt(0);
    if(c<0xAC00 || c>0xD7A3) return null;
    const i=c-S0; return { L:Math.floor(i/N), V:Math.floor((i%N)/Tc), T:i%Tc };
  }
  function hasVowelDiff(a,b){
    const A=[...onlyHangul(a)], B=[...onlyHangul(b)], n=Math.min(A.length,B.length);
    for(let i=0;i<n;i++){ const x=decomp(A[i]), y=decomp(B[i]); if(x&&y&&x.V!==y.V) return true; }
    return false;
  }

  // 말투 체크(저는/전 ↔ -요/-(스)ㅂ니다, 나는/난 ↔ -아/어)
  function checkRegister(ans){
    const je=/(저는|전)\b/.test(ans), na=/(나는|난)\b/.test(ans), tr=String(ans||'').trim();
    const yo=/요[.?!]*$/.test(tr), sm=/니다[.?!]*$/.test(tr), hae=/[다]$/.test(tr);
    if(je&&hae) return {ok:false,ko:'“저는/전”이면 끝을 -요/-(스)ㅂ니다로.',fr:'« je/jeon » → terminaisons -yo / -seumnida'};
    if(na&&(yo||sm)) return {ok:false,ko:'“나는/난”이면 반말(-아/어)로.',fr:'« na/nan » → style familier (-a/eo)'};
    return {ok:true};
  }

  // ✅ KO: 공백/구두점 무시, 학생답이 정답을 "온전히 포함"할 때만 예외 ✓, 모음 다르면 즉시 ❌, 그 외엔 완전 일치만 ✓
  function gradeKO(ref, ans, { allowSubstring=true } = {}){
    const R=normKO(ref), S=normKO(ans);
    if(!R) return {score:0,isCorrect:false,note:'정답이 비어 있음'};

    // 학생답이 더 길고 정답을 그대로 포함할 때만 인정
    if(allowSubstring && S.includes(R)) return {score:100,isCorrect:true,note:'부분 포함 인정'};

    // 모음 하나라도 다르면 발음 문제 → 즉시 오답
    if(hasVowelDiff(R,S)) return {score:0,isCorrect:false,note:'모음 오류(발음 영향)'};

    // 철자(자음/받침 포함) 완전 일치만 정답
    const ok = (S===R);
    return {score: ok?100:0, isCorrect: ok, note: ok?'':'철자 불일치(받침/자음 포함)'};
  }

  // ✅ FR: 악상/구두점 무시 + 의미 근사(자카드 0.8 또는 레벤슈타인 15%) 허용
  function levenshtein(a,b){
    const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
    const dp=Array(n+1).fill(0).map((_,j)=>j);
    for(let i=1;i<=m;i++){
      let prev=dp[0], tmp; dp[0]=i;
      for(let j=1;j<=n;j++){
        tmp=dp[j];
        dp[j]=a[i-1]===b[j-1]?prev:1+Math.min(prev,dp[j-1],dp[j]);
        prev=tmp;
      }
    }
    return dp[n];
  }
  function gradeFR(ref, ans){
    const R=normFR(ref), S=normFR(ans);
    if(!R) return {score:0,isCorrect:false,note:'réf. vide'};
    if(S===R || S.includes(R) || R.includes(S)) return {score:100,isCorrect:true,note:'accents/ponctuation ignorés'};

    const set=t=>new Set(String(t).split(' ').filter(Boolean));
    const a=set(S), b=set(R);
    const inter=[...a].filter(x=>b.has(x)).length;
    const uni=new Set([...a,...b]).size;
    if(inter/Math.max(1,uni) >= 0.8) return {score:95,isCorrect:true,note:'mots clés concordants'};

    const d=levenshtein(S,R), rate=d/Math.max(1,R.length), ok=rate<=0.15;
    return {score:Math.max(0,Math.round((1-rate)*100)), isCorrect:ok, note: ok?'variantes mineures admises':'écart trop grand'};
  }

  w.AnswerJudge = { gradeKO, gradeFR, checkRegister };
})(window);
