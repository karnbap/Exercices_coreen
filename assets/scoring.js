<script>
/* 공통 점수 집계
   - weights: { ko, fr, pron } 합=1 (과제별로 override 가능)
   - pron.mode:
       - 'missing-as-zero'  : 녹음 안 한 문항은 0점 처리(권장, 회피 방지)
       - 'scale-by-attempt' : 시도율만큼 가중(부분 시도 시 비중 축소)
   - pron.totalItems: 발음 문항 개수 고정(없으면 exercises.length 사용)
*/
(function(w){
  const DEFAULT_PROFILE = {
    weights: { ko: 0.45, fr: 0.35, pron: 0.20 },
    pron: { mode: 'missing-as-zero', totalItems: null },
    ko: { allowSubstring: false }
  };

  function normalizeWeights(w, includePron){
    const m={ ko:w.ko??0, fr:w.fr??0, pron:(includePron? (w.pron??0):0) };
    const s=(m.ko+m.fr+m.pron)||1;
    return { ko:m.ko/s, fr:m.fr/s, pron:m.pron/s };
  }

  function compute({ exercises, exState, profile, pronItemsTotal }){
    const cfg = Object.assign({}, DEFAULT_PROFILE, profile||{});
    const totalQ = exercises.length;

    // KO/FR: 맞은 개수 → 100점 환산
    const koCorrect = exState.filter(s=>s.koCorrect).length;
    const frCorrect = exState.filter(s=>s.frCorrect).length;
    const koScore = Math.round((koCorrect/Math.max(1,totalQ))*100);
    const frScore = Math.round((frCorrect/Math.max(1,totalQ))*100);

    // PRON: 정확도(0~1) 평균 → 100점 환산
    const totalPron = Number.isFinite(pronItemsTotal)? pronItemsTotal
                     : (Number.isFinite(cfg.pron.totalItems)? cfg.pron.totalItems : totalQ);

    const accs = exState.map(s => (s.pronunciation && typeof s.pronunciation.accuracy==='number') ? s.pronunciation.accuracy : null);
    const recCount = accs.filter(v=>typeof v==='number').length;
    const sumAcc = accs.reduce((a,v)=>a+(typeof v==='number'?v:0),0);

    let pronScore = 0;
    if (totalPron>0){
      if ((cfg.pron.mode||'missing-as-zero') === 'scale-by-attempt'){
        const ratio = recCount/Math.max(1,totalPron);
        const avg   = recCount? (sumAcc/recCount) : 0;
        pronScore   = Math.round(avg*100*ratio); // 시도율만큼 가중
      }else{
        // missing-as-zero: 녹음 안 한 건 0으로 채워 평균
        const avgAll = sumAcc/Math.max(1,totalPron);
        pronScore    = Math.round(avgAll*100);
      }
    }

    // 가중합
    const W = normalizeWeights(cfg.weights, totalPron>0);
    const overall = Math.round(koScore*W.ko + frScore*W.fr + pronScore*W.pron);

    return {
      koScore, frScore, pronScore, overall,
      counts: { totalQ, koCorrect, frCorrect, totalPron, recCount },
      weights: W
    };
  }

  w.Scoring = { DEFAULT_PROFILE, compute, normalizeWeights };
})(window);
</script>
