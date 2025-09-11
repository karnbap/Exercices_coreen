// /assets/live-stt.js
// 브라우저 실시간 받아쓰기(ko-KR) 표시 + 최종 텍스트 고정 + 이벤트 전파
// - LiveSTT.init() 호출만 하면 현재 페이지의 카드들에 자동 연결
// - 카드 구조 가정: .btn-rec-start / .btn-rec-stop / .pronun-live (있으면 표시)
// - 이벤트: 'livestt:final'({ detail:{ text, card } })

(function (w) {
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function ensureBox(card){
    let box = card.querySelector('.pronun-live');
    if (!box) {
      box = document.createElement('div');
      box.className = 'pronun-live mt-2 text-sm p-2 rounded border bg-white';
      // status-line 바로 아래에 삽입
      const anchor = card.querySelector('.status-line') || card.firstElementChild || card;
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }
    box.classList.remove('hidden'); // 숨김 방지
    return box;
  }

  function render(box, finalText, interim){
    const merged = String(finalText||'') + String(interim||'');
    const safe = escapeHtml(merged);
    box.innerHTML = `<div><b>En direct / 실시간:</b> ${safe}</div>`;
  }

  function attachOneCard(card) {
    if (!SR) return;

    const startBtn = card.querySelector('.btn-rec-start, .btn-rec');
    const stopBtn  = card.querySelector('.btn-rec-stop, .btn-stop');
    if (!startBtn || !stopBtn) return;

    const box = ensureBox(card);

    let rec = null, started = false, finalText = '';
    function make() {
      const r = new SR();
      r.lang = 'ko-KR';
      r.interimResults = true;
      r.continuous = true;
      r.maxAlternatives = 1;

      r.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          if (res.isFinal) finalText += res[0].transcript;
          else interim += res[0].transcript;
        }
        render(box, finalText, interim);

        // 최종 덩어리 하나가 확정되면 이벤트도 쏴 준다
        if (interim === '') {
          card.dispatchEvent(new CustomEvent('livestt:final', {
            detail: { text: String(finalText||'').trim(), card }, bubbles: true
          }));
        }
      };
      r.onerror = () => {};
      r.onend = () => { started = false; };
      return r;
    }

    // 시작
    startBtn.addEventListener('click', () => {
      if (!SR) { box.innerHTML = '🗣️ En direct indisponible / 실시간 미지원'; return; }
      try {
        finalText = '';
        box.innerHTML = '<div class="opacity-60">🎧 Reconnaissance… / 실시간 인식 중…</div>';
        if (!rec) rec = make();
        if (!started) { rec.start(); started = true; }
      } catch (e) {}
    });

    // 정지
    stopBtn.addEventListener('click', () => {
      try { if (rec) rec.stop(); } catch(e) {}
      // 마지막 결과 고정
      const safe = escapeHtml(String(finalText||'').trim());
      if (safe) box.innerHTML = `<div><b>En direct / 실시간 (final):</b> ${safe}</div>`;
    });
  }

  function init(rootSel) {
    if (!SR) return;
    // 기본: 전체 문서에서 워밍업 카드나 퀴즈 카드를 탐색
    const roots = rootSel ? document.querySelectorAll(rootSel) : [document];
    roots.forEach(root => {
      root.querySelectorAll('[data-card="warmup"], .quiz-card, .dictation-card, .p-4.bg-white.rounded-lg.border')
        .forEach(attachOneCard);
    });
  }

  w.LiveSTT = { init, supported: !!SR };
  document.addEventListener('DOMContentLoaded', () => { try { init(); } catch(_){} });
})(window);
