// assets/pronun-vowel-middleware.js
// Pronun.mount의 onResult를 가로채서
// 1) 자모 기반 하이라이트/가중 감점 적용
// 2) 85% 미만(또는 모음/자음 교란 감지) + 녹음 base64 있으면 Whisper 2차 채점→더 높은 점수 채택
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
          ${(tips||[]).map(m=>`• ${m.fr} / ${m.ko}`).join('<br/>')}
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

    opts.onResult = async (res)=>{
      const refText = getRef() || '';
      const trText = (res && (res.transcript || res.text)) || '';
      let baseAcc = res && typeof res.accuracy==='number' ? res.accuracy : 0;

      // 1차: 자모 분석으로 보정
      let view = { refHTML: refText, hypHTML: trText, pct: Math.round(baseAcc*100), tips: [] };
      if (window.PronunUtils){
        const diff1 = window.PronunUtils.analyzePronunciationDiff(refText, trText);
        baseAcc = clamp01(baseAcc - (diff1.penalty || 0));
        view = {
          refHTML: diff1.highlightRef || refText,
          hypHTML: diff1.highlightHyp || trText,
          pct: Math.round(baseAcc*100),
          tips: diff1.tips || []
        };
      }

      // 2차 조건: 정확도 < 85% 또는 모음/자음 교란 메시지 포함
      const needWhisper = (baseAcc < 0.85) || ((view.tips||[]).some(m => /모음|자음/.test(m.ko||'')));

      // 녹음 base64 후보들(모듈 구현에 따라 키가 다를 수 있어 여러 키 지원)
      const b64 = res?.audioBase64 || res?.recordingBase64 || (res?.recording && res.recording.base64) || null;

      let usedWhisper = false;
      if(needWhisper && b64 && window.PronunUtils && typeof window.PronunUtils.scoreRecordingWithWhisper==='function'){
        try{
          const w = await window.PronunUtils.scoreRecordingWithWhisper(b64, refText);
          const wAcc = (w.score||0)/100;
          if (wAcc > baseAcc) {
            usedWhisper = true;
            baseAcc = wAcc;
            view = {
              refHTML: (w.diff && w.diff.highlightRef) || view.refHTML,
              hypHTML: (w.diff && w.diff.highlightHyp) || (w.text || trText),
              pct: Math.round(baseAcc*100),
              tips: (w.diff && w.diff.tips) || view.tips
            };
          }
        }catch(_){}
      }

      // 화면 반영
      renderInto(container, view.refHTML, view.hypHTML, view.pct, view.tips);

      // 콜백으로 최종 결과 전달
      const enriched = Object.assign({}, res, {
        accuracy: baseAcc,
        highlightRef: view.refHTML,
        highlightHyp: view.hypHTML,
        friendly: view.tips,
        stt: Object.assign(
          { primary: res?.model || 'gpt-4o-mini-transcribe' },
          usedWhisper ? { fallback: 'whisper-1', usedFallback: true } : {}
        )
      });
      if (typeof userOnResult === 'function') userOnResult(enriched);
    };

    return origMount.call(window.Pronun, container, opts);
  };
})();
