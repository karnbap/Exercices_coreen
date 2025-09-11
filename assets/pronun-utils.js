// assets/pronun-utils.js
(function (global) {
  // ====== ① 한글 음절 분해/정렬 (기존 로직 유지) ======
  const SBase=0xAC00,LBase=0x1100,VBase=0x1161,TBase=0x11A7,LCount=19,VCount=21,TCount=28,NCount=VCount*TCount,SCount=LCount*NCount;

  function decomposeSyl(ch){
    const code=ch.codePointAt(0);
    if(code<SBase || code>=SBase+SCount) return null;
    const SIndex=code-SBase;
    const LIndex=Math.floor(SIndex/NCount);
    const VIndex=Math.floor((SIndex%NCount)/TCount);
    const TIndex=SIndex%TCount;
    // 표기용
    const Ls=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    const Vs=['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
    const Ts=['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    return {ch,LIndex,VIndex,TIndex,L:Ls[LIndex],V:Vs[VIndex],T:Ts[TIndex]||''};
  }

  function alignSyllables(aStr,bStr){
    const a=[...String(aStr||'')], b=[...String(bStr||'')];
    const m=a.length,n=b.length;
    const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
    const bt=Array.from({length:m+1},()=>Array(n+1).fill(0)); // 0 diag,1 up,2 left
    for(let i=0;i<=m;i++) dp[i][0]=i, bt[i][0]=1;
    for(let j=0;j<=n;j++) dp[0][j]=j, bt[0][j]=2;
    for(let i=1;i<=m;i++){
      for(let j=1;j<=n;j++){
        const cost=(a[i-1]===b[j-1])?0:1;
        const d=dp[i-1][j-1]+cost, u=dp[i-1][j]+1, l=dp[i][j-1]+1;
        if(d<=u && d<=l){ dp[i][j]=d; bt[i][j]=0; }
        else if(u<=l){ dp[i][j]=u; bt[i][j]=1; }
        else { dp[i][j]=l; bt[i][j]=2; }
      }
    }
    const pairs=[]; let i=m,j=n;
    while(i>0||j>0){ const t=bt[i][j];
      if(t===0){ pairs.push([i-1,j-1]); i--; j--; }
      else if(t===1){ pairs.push([i-1,-1]); i--; }
      else { pairs.push([-1,j-1]); j--; }
    }
    return pairs.reverse();
  }

  function analyzePronunciationDiff(refRaw,hypRaw){
    const ref=(refRaw||'').replace(/[^\uAC00-\uD7A3]/g,'');
    const hyp=(hypRaw||'').replace(/[^\uAC00-\uD7A3]/g,'');
    const pairs=alignSyllables(ref,hyp);
    let vErr=0,cErr=0,ins=0,del=0;
    const refMarks=[],hypMarks=[];
    let yoVsYu=false;

    pairs.forEach(([ai,bi])=>{
      const r=ai>=0?ref[ai]:null, h=bi>=0?hyp[bi]:null;
      if(r && h){
        const R=decomposeSyl(r), H=decomposeSyl(h);
        if(R && H){
          const vMis=R.VIndex!==H.VIndex;
          const lMis=R.LIndex!==H.LIndex;
          const tMis=R.TIndex!==H.TIndex;

          if(vMis && !lMis && !tMis){
            vErr++;
            // 요(ㅛ) ↔ 유(ㅠ) 특수 감지
            if ((R.V==='ㅛ' && H.V==='ㅠ') || (R.V==='ㅠ' && H.V==='ㅛ')) yoVsYu = true;

            refMarks.push(`<span style="background:#fde68a">${r}</span>`);
            hypMarks.push(`<span style="background:#fde68a">${h}</span>`);
          }else if(vMis || lMis || tMis){
            cErr++;
            refMarks.push(`<span style="background:#fee2e2">${r}</span>`);
            hypMarks.push(`<span style="background:#e0e7ff">${h}</span>`);
          }else{
            refMarks.push(r); hypMarks.push(h);
          }
        }else{
          refMarks.push(r); hypMarks.push(h);
        }
      }else if(r && !h){
        del++; refMarks.push(`<span style="text-decoration:underline dotted #ef4444">${r}</span>`);
      }else if(!r && h){
        ins++; hypMarks.push(`<span style="text-decoration:underline dotted #3b82f6">${h}</span>`);
      }
    });

    // 가중 감점: 모음>자음>삽입/삭제 (최대 0.30)
    const penalty = Math.min(0.3, vErr*0.08 + cErr*0.04 + (ins+del)*0.02);

    const friendly=[];
    if(vErr){ friendly.push({fr:`Quelques voyelles ont changé (ex: “요” ↔ “유”). Regarde en jaune.`, ko:`모음이 달라요(예: “요”↔“유”). 노란색을 봐요.`}); }
    if(yoVsYu){ friendly.push({fr:`Fin de politesse: dites “-yo” (pas “-yu”).`, ko:`종결어미: “-유”가 아니라 “-요”로 발음해요.`}); }
    if(cErr){ friendly.push({fr:`Certaines consonnes ont changé (rouge/bleu).`, ko:`자음이 달라요(빨강/파랑).`}); }
    if(ins||del){ friendly.push({fr:`Un son ajouté/supprimé (souligné en pointillés).`, ko:`소리가 추가/빠짐(점선 밑줄).`}); }
    if(!friendly.length){ friendly.push({fr:`Très bien ! Presque pareil 😄`, ko:`아주 좋아요! 거의 똑같아요 😄`}); }

    return {
      penalty,
      highlightRef: refMarks.join(''),
      highlightHyp: hypMarks.join(''),
      tips: friendly
    };
  }

  // 2차 채점(Whisper) 유틸
  async function scoreRecordingWithWhisper(recBase64, refKo){
    try{
      const r = await fetch('/.netlify/functions/transcribe-whisper', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ base64: recBase64, mimeType:'audio/webm', filename:'rec.webm' })
      });
      const j = await r.json().catch(()=>({}));
      const text = j && j.text ? j.text : '';
      const diff = analyzePronunciationDiff(refKo, text || '');
      const adjusted = Math.max(0, Math.min(1, 1 - (diff.penalty || 0)));
      const same = (refKo||'').replace(/\s/g,'') === (text||'').replace(/\s/g,'');
      const score = same ? 100 : Math.min(99, Math.round(adjusted * 100));
      return { text, score, diff };
    }catch(e){
      return {
        text:'',
        score:0,
        diff:{ penalty:1, highlightRef:refKo, highlightHyp:'', tips:[{fr:'Erreur STT (Whisper)', ko:'음성 인식 오류(Whisper)'}] }
      };
    }
  }

  // ====== ② 숫자 → 한글 수사 강제 + 단위 앞 고유어 축약 (신규 추가) ======
  const SINO = ['','일','이','삼','사','오','육','칠','팔','구'];
  const NUM_UNITS = [
    ['억',  100000000],
    ['만',      10000],
    ['천',        1000],
    ['백',         100],
    ['십',          10],
    ['',             1]
  ];
  function _clampInt(n, min, max){
    n = parseInt(n,10); if(!Number.isFinite(n)) n = 0;
    return Math.max(min, Math.min(max, n));
  }
  // 0..99,999,999 → 한자어 수사
  function numToSino(n){
    n = _clampInt(n, 0, 99999999);
    if(!n) return '영';
    let out=''; let rest=n;
    for(const [u,v] of NUM_UNITS){
      const q = Math.floor(rest / v); rest %= v;
      if(!q) continue;
      if(v===10 && q===1) out+='십';
      else out += SINO[q] + u;
    }
    return out;
  }
  function digitsToSinoInText(s){
    return String(s||'').replace(/\d+/g, (m)=> numToSino(m));
  }
  // 임의의 '한글 단위' 앞에서 고유어 축약 허용 + 10대/20대 특수형
  function applyGenericCounterVariants(s){
    let x=String(s||'');
    x = x
      .replace(/십일(?=[가-힣])/g,'열한')
      .replace(/십이(?=[가-힣])/g, '열두')
      .replace(/십삼(?=[가-힣])/g, '열세')
      .replace(/십사(?=[가-힣])/g, '열네')

      .replace(/이십일(?=[가-힣])/g,'스물한')
      .replace(/이십이(?=[가-힣])/g, '스물두')
      .replace(/이십삼(?=[가-힣])/g, '스물세')
      .replace(/이십사(?=[가-힣])/g, '스물네')
      .replace(/이십(?=[가-힣])/g,    '스무')

      .replace(/일(?=[가-힣])/g,'한')
      .replace(/이(?=[가-힣])/g,'두')
      .replace(/삼(?=[가-힣])/g,'세')
      .replace(/사(?=[가-힣])/g,'네');

    // 자주 틀리는 축약 보정
    x = x.replace(/셋(?=살)/g,'세').replace(/넷(?=살)/g,'네');
    return x;
  }
  // 화면/채점 모두에서 사용하는 “한글 수사 강제”
  function forceHangulNumbers(s){
    const base = digitsToSinoInText(String(s||'').replace(/[A-Za-z]+/g,''));
    return applyGenericCounterVariants(base);
  }

  // 보조 정규화/유사도(원하는 페이지에서 활용 가능)
  function koCanonSimple(s){
    return String(s||'')
      .trim()
      .replace(/\s+/g,' ')
      .replace(/[.,!?;:~、。！？；：]/g,'')
      .toLowerCase();
  }
  function lev(a,b){
    const s=String(a||''), t=String(b||'');
    const m=s.length, n=t.length;
    if(!m && !n) return 0;
    const dp=Array.from({length:m+1},()=>new Array(n+1).fill(0));
    for(let i=0;i<=m;i++) dp[i][0]=i;
    for(let j=0;j<=n;j++) dp[0][j]=j;
    for(let i=1;i<=m;i++){
      for(let j=1;j<=n;j++){
        const c = s[i-1]===t[j-1]?0:1;
        dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+c);
      }
    }
    return dp[m][n];
  }
  function similarity(a,b){
    const A=koCanonSimple(a), B=koCanonSimple(b);
    const L=Math.max(1, Math.max(A.length, B.length));
    return Math.max(0, 1 - lev(A,B)/L);
  }

  // ====== ③ 글로벌 네임스페이스에 추가/병합 ======
  // (1) 새 숫자 유틸은 NumHangul로 노출
  global.NumHangul = Object.assign({}, global.NumHangul || {}, {
    numToSino,
    digitsToSinoInText,
    applyGenericCounterVariants,
    forceHangulNumbers,
    koCanon: koCanonSimple,
    similarity
  });

  // (2) 기존 PronunUtils 유지 + 숫자 강제 유틸도 함께 제공
  global.PronunUtils = Object.assign({}, global.PronunUtils || {}, {
    analyzePronunciationDiff,
    scoreRecordingWithWhisper,
    // 편의 제공: 다른 파일에서 쉽게 접근하도록
    forceHangulNumbers: forceHangulNumbers
  });
})(window);
