// assets/pronun-vowel-middleware.js
// Pronun.mount의 onResult를 가로채서 자모 분석 자동 적용 + 하이라이트 자동 출력
(function(){
  function clamp01(x){ return Math.max(0, Math.min(1, x)); }
  function renderInto(container, refHTML, hypHTML, pct, tips){
    const box = container.querySelector('.pronun-display');
    if(!box) return;
    box.innerHTML = `
      <div style="margin-top:6px">
        <div><b>Prononciation / 발음 정확도:</b> ${pct}%</div>
        <div style="margin-top:4px;font-size:14px">
          <div><b>Référence (정확):</b> <span class="korean-font">${refHTML}</span></div>
          <div><b>Élève (전사):</b> <span class="korean-font">${hypHTML}</span></div>
        </div>
        <div style="margin-top:6px;font-size:13px;color:#374151">
          ${tips.map(m=>`• ${m.fr} / ${m.ko}`).join('<br/>')}
        </div>
        <div style="margin-top:6px;font-size:12px;color:#6b7280">
          ⚠️ Fonction en test — les résultats peuvent ne pas être 100% exacts. / 시험 중 기능이에요. 이상하면 알려주세요!
        </div>
      </div>
    `;
  }

  if(!window.Pronun) return;
  const origMount = window.Pronun.mount;
  window.Pronun.mount = function(container, opts={}){
    const userOnResult = opts.onResult;
    const getRef = typeof opts.getReferenceText==='function' ? opts.getReferenceText : ()=>'';

    opts.onResult = (res)=>{
      const refText = getRef() || '';
      const trText = res && res.transcript || '';

      // PronunUtils가 있으면 모음/자음 정밀 분석
      if(window.PronunUtils){
        const diff = window.PronunUtils.analyzePronunciationDiff(refText, trText);
        const adjusted = clamp01((res.accuracy||0) - (diff.penalty||0));
        const pct = Math.round(adjusted*100);

        // 자동 렌더(페이지에 .pronun-display 있으면)
        renderInto(container, diff.highlightRef || refText, diff.highlightHyp || trText, pct, diff.tips||[]);

        // 콜백에도 강화 결과 전달
        const enriched = Object.assign({}, res, {
          accuracy: adjusted,
          highlightRef: diff.highlightRef,
          highlightHyp: diff.highlightHyp,
          friendly: diff.tips
        });
        if (typeof userOnResult === 'function') userOnResult(enriched);
        return;
      }

      // 유틸이 없으면 원본 그대로
      if (typeof userOnResult === 'function') userOnResult(res);
    };

    return origMount.call(window.Pronun, container, opts);
  };
})();
