<!-- /assets/answer-judge.js -->
<script>
/*
KO: 자/모음/받침 하나라도 다르면 오답. 공백/부호 차이는 무시(듣기에 영향 없음).
    allowSubstring=false(받아쓰기)일 때 부분포함 금지.
FR: 악상/구두점/대소문자 무시. 빈 답안은 오답.
    - 의미 유사 허용: 간단 유의어 치환 후 단어집합 Jaccard ≥ 0.90 → 정답
    - 철자 관대: Levenshtein ≤ 15% → 정답
*/
(function (w) {
  const RX_PUNCT=/[\p{P}\p{S}]/gu, RX_SPACE=/\s+/g, RX_MARKS=/\p{M}/gu, RX_HANGUL=/[가-힣]/g;
  const NFD=s=>String(s||'').normalize('NFD');
  const deacc=s=>NFD(s).replace(RX_MARKS,'');
  const trimWs=s=>String(s||'').replace(RX_SPACE,' ').trim();
  const onlyKO=s=>(String(s||'').match(RX_HANGUL)||[]).join('');
  const normKO=s=>onlyKO(String(s).replace(RX_PUNCT,'')).replace(RX_SPACE,'');
  const normFR=s=>trimWs(deacc(String(s).toLowerCase()).replace(RX_PUNCT,''));

  const S=0xAC00, Lc=19, Vc=21, Tc=28, N=Vc*Tc, Sc=Lc*N;
  function decomp(ch){const c=ch.codePointAt(0); if(c<S||c>=S+Sc) return null;
    const i=c-S; return {L:Math.floor(i/N),V:Math.floor((i%N)/Tc),T:i%Tc};}
  function lev(a,b){const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
    const d=new Array(n+1); for(let j=0;j<=n;j++) d[j]=j;
    for(let i=1;i<=m;i++){let p=d[0]; d[0]=i;
      for(let j=1;j<=n;j++){const t=d[j];
        d[j]=(a[i-1]===b[j-1])?p:1+Math.min(p,d[j-1],d[j]); p=t;}}
    return d[n];
  }

  function gradeKO(ref, ans, {allowSubstring=false}={}){
    const R=normKO(ref), S=normKO(ans);
    if(!S) return {score:0,isCorrect:false,note:'빈 답안'};
    if(allowSubstring && S.includes(R) && S.length<=Math.ceil(R.length*1.15))
      return {score:100,isCorrect:true,note:'부분 포함(정답 전체 포함) 인정'};

    if(S===R){
      // 공백/부호 차이율은 참고용으로만 표시
      const keepW=s=>(String(s).match(/[\s\p{P}]+/gu)||[]).join('').replace(RX_SPACE,' ');
      const d=lev(keepW(ref),keepW(ans));
      const L=Math.max(1,keepW(ref).length);
      const pct=Math.round((d/L)*100);
      return {score:100,isCorrect:true,note:pct?`공백/부호 차이(~${pct}%) 허용`:'철자 일치'};
    }

    if(S.length!==R.length) return {score:0,isCorrect:false,note:'한글 글자 수 다름'};
    let diffV=false,diffL=false,diffT=false;
    for(let i=0;i<R.length;i++){
      if(R[i]===S[i]) continue;
      const a=decomp(R[i]), b=decomp(S[i]);
      if(a && b){ if(a.V!==b.V) diffV=true; if(a.L!==b.L) diffL=true; if(a.T!==b.T) diffT=true; }
      else diffL=true;
    }
    const parts=[]; if(diffV) parts.push('모음'); if(diffL) parts.push('초성/자음'); if(diffT) parts.push('받침');
    return {score:0,isCorrect:false,note:parts.length?parts.join('·')+' 오류':'철자 불일치'};
  }

  const FR_DICT=Object.freeze({
    'elle':'il','elles':'il','ils':'il','une':'un',
    'actrice':'acteur','chanteuse':'chanteur','amie':'ami',
    'cest':'est','c\'est':'est','ces':'est',
    'tel':'comme','telle':'comme','tels':'comme','telles':'comme',
    'pareil':'comme','pareille':'comme','semblable':'comme'
  });
  const canonFR=s=>String(s).split(' ').filter(Boolean).map(w=>FR_DICT[w]||w).join(' ');
  const jacc=(a,b)=>{const A=new Set(a.split(' ').filter(Boolean)), B=new Set(b.split(' ').filter(Boolean));
    const inter=[...A].filter(x=>B.has(x)).length; const uni=new Set([...A,...B]).size; return inter/Math.max(1,uni);};

  function gradeFR(ref, ans){
    const R0=normFR(ref), S0=normFR(ans);
    if(!S0) return {score:0,isCorrect:false,note:'réponse vide'};
    const R=canonFR(R0), S=canonFR(S0);
    if(S===R || S.includes(R)) return {score:100,isCorrect:true,note:'accents/ponctuation ignorés'};
    if(jacc(S,R) >= 0.90) return {score:95,isCorrect:true,note:'mots clés/équivalents concordants'};
    const d=lev(S,R), L=Math.max(1,R.length), ok=d<=Math.ceil(L*0.15);
    return {score:Math.max(0,Math.round((1-d/L)*100)),isCorrect:!!ok,note:ok?'variantes mineures admises':'écart trop grand / sens différent'};
  }

  function checkRegister(ans){
    const je=/(저는|전)\b/.test(ans), na=/(나는|난)\b/.test(ans), tr=String(ans||'').trim();
    const yo=/요[.?!]*$/.test(tr), sm=/니다[.?!]*$/.test(tr), hae=/[다]$/.test(tr);
    if(je&&hae) return {ok:false,ko:'저는/전 ↔ 해체 ❌ → -요/-(스)ㅂ니다',fr:'« je/jeon » → -yo / -seumnida'};
    if(na&&(yo||sm)) return {ok:false,ko:'나는/난 ↔ -요/-(스)ㅂ니다 ❌ → -아/어',fr:'« na/nan » → style familier'};
    return {ok:true};
  }

  w.AnswerJudge={gradeKO,gradeFR,checkRegister};
})(window);
</script>
