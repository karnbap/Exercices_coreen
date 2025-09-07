// assets/pronun-utils.js
// 한글 음절 정렬 + 모음/자음 차이 하이라이트 + 가중 감점 계산
(function (global) {
  const SBase=0xAC00,LBase=0x1100,VBase=0x1161,TBase=0x11A7,LCount=19,VCount=21,TCount=28,NCount=VCount*TCount,SCount=LCount*NCount;

  function decomposeSyl(ch){
    const code=ch.codePointAt(0);
    if(code<SBase || code>=SBase+SCount) return null;
    const SIndex=code-SBase;
    const LIndex=Math.floor(SIndex/NCount);
    const VIndex=Math.floor((SIndex%NCount)/TCount);
    const TIndex=SIndex%TCount;
    return {ch,LIndex,VIndex,TIndex};
  }

  function alignSyllables(aStr,bStr){
    const a=[...aStr], b=[...bStr];
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

    // 가중 감점: 모음>자음>삽입/삭제
    const penalty = Math.min(0.3, vErr*0.08 + cErr*0.04 + (ins+del)*0.02);

    const friendly=[];
    if(vErr){ friendly.push({fr:`Quelques voyelles ont changé (ex: "요" ↔ "유"). Regarde le jaune.`, ko:`모음이 달라요(예: "요"↔"유"). 노란색 부분을 봐요.`}); }
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

  // --- 2차 채점(Whisper) 유틸: 녹음 base64 → 전사 → 자모 기반 점수 ---
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

  // 전역 노출(기존 객체와 병합)
  global.PronunUtils = Object.assign({}, global.PronunUtils || {}, {
    analyzePronunciationDiff,
    scoreRecordingWithWhisper
  });
})(window);
