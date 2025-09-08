<script>
/* KO: 철자 엄격(모음/받침), 공백·구두점 관대(≤10%) / FR: 악상·구두점 무시, 15%까진 부분오타 허용 */
(function(w){
  const P=/[\p{P}\p{S}]/gu, W=/\s+/g, M=/\p{M}/gu, H=/[가-힣]/g;
  const nfd=s=>s.normalize('NFD'), deacc=s=>nfd(s).replace(M,''), space=s=>s.replace(W,' ').trim();
  const hangul=s=>String(s).match(H)?.join('')||'';
  const S=0xAC00,Lb=0x1100,Vb=0x1161,Tb=0x11A7,Lc=19,Vc=21,Tc=28,N=Vc*Tc,Sc=Lc*N;
  function decomp(ch){const c=ch.codePointAt(0);if(c<S||c>=S+Sc)return null;const i=c-S;return{L:Math.floor(i/N),V:Math.floor((i%N)/Tc),T:i%Tc};}
  function lev(a,b){const m=a.length,n=b.length;if(!m||!n)return m+n;const d=Array(n+1).fill(0).map((_,j)=>j);
    for(let i=1;i<=m;i++){let p=d[0],t;d[0]=i;for(let j=1;j<=n;j++){t=d[j];d[j]=a[i-1]===b[j-1]?p:1+Math.min(p,d[j-1],d[j]);p=t;}}return d[n];}
  function normKO(s){return space(hangul(s.replace(P,'')));}
  function normFR(s){return space(deacc(String(s)).toLowerCase().replace(P,''));}
  function hasVowelDiff(a,b){const A=[...hangul(a)],B=[...hangul(b)],n=Math.min(A.length,B.length);
    for(let i=0;i<n;i++){const x=decomp(A[i]),y=decomp(B[i]);if(x&&y&&x.V!==y.V)return true;}return false;}
  function checkRegister(ans){
    const je=/(저는|전)\b/.test(ans), na=/(나는|난)\b/.test(ans), tr=ans.trim();
    const yo=/요[.?!]*$/.test(tr), sm=/니다[.?!]*$/.test(tr), hae=/[다]$/.test(tr);
    if(je&&hae) return {ok:false,ko:'저는/전 ↔ -아/어(해체) ❌ → -요/-(스)ㅂ니다',fr:'« je/jeon » → terminaisons -yo / -seumnida'};
    if(na&&(yo||sm))return {ok:false,ko:'나는/난 ↔ -요/-(스)ㅂ니다 ❌ → -아/어',fr:'« na/nan » → style familier (-a/eo)'};
    return {ok:true};
  }
  function gradeKO(ref,ans,{allowSubstring=true}={}){
    const R=normKO(ref), S=normKO(ans);
    if(allowSubstring && S.includes(R)) return {score:100,isCorrect:true,note:'부분 포함 인정'};
    if(hasVowelDiff(R,S)) return {score:0,isCorrect:false,note:'모음 오류(발음에 치명적)'};
    const d=lev(R,S), L=Math.max(1,R.length), rate=d/L, ok=rate<=0.10;
    return {score:Math.max(0,Math.round((1-rate)*100)),isCorrect:ok,note:ok?'경미한 철자/공백 차이':'철자 오류(받침/글자 차이 포함)'};
  }
  function gradeFR(ref,ans){
    const R=normFR(ref), S=normFR(ans); const d=lev(R,S), L=Math.max(1,R.length), ok=d<=Math.ceil(L*0.15);
    return {score:Math.max(0,Math.round((1-d/L)*100)),isCorrect:ok,note:ok?'accent/구두점 무시':'의미 다름 또는 오타 과다'};
  }
  w.AnswerJudge={gradeKO,gradeFR,checkRegister};
})(window);
</script>
