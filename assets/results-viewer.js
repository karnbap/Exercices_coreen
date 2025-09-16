// assets/results-viewer.js
// 결과 화면 통합 뷰어: 로드(session/local/window) → 렌더(점수/시간/오답/발음정확도) → 1회 전송
(function (global) {
  'use strict';

  // ========= 유틸 =========
  const $ = (s, r = document) => r.querySelector(s);

  function escapeHTML(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function fmtHMS(total) {
    total = Math.max(0, Number(total) || 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    return (h ? `${h} h ` : '') + (m ? `${m} min ` : '') + `${s} s`;
  }

  // 간단 체크섬(중복 렌더/전송 방지에 사용)
  function tinyHash(o) {
    try {
      const j = JSON.stringify(o);
      let h = 0;
      for (let i = 0; i < j.length; i++) h = (h * 31 + j.charCodeAt(i)) | 0;
      return String(h >>> 0);
    } catch { return ''; }
  }

  // ========= 데이터 로드 =========
  function loadPayload() {
    // 우선순위: window → sessionStorage → localStorage
    if (global.PONGDANG_RESULTS && typeof global.PONGDANG_RESULTS === 'object') {
      return global.PONGDANG_RESULTS;
    }
    try {
      const s = sessionStorage.getItem('pondant_results');
      if (s) return JSON.parse(s);
    } catch {}
    try {
      const l = localStorage.getItem('pongdang:lastResults');
      if (l) return JSON.parse(l);
    } catch {}
    return null;
  }

  // ========= 서버 전송(1회) =========
  async function postResultsOnce(payload) {
    if (!payload || payload._sent) return payload;

    // results-compat.js 가 있으면 그걸 사용
    if (global.sendResults && typeof global.sendResults === 'function') {
      try {
        await global.sendResults(payload);
        payload._sent = true;
        persistBack(payload);
        return payload;
      } catch {}
    }

    // 직접 POST (동일 스키마)
    try {
      const slim = toSlimPayload(payload);
      await fetch('/.netlify/functions/send-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        mode: 'cors',
        body: JSON.stringify(slim)
      });
      payload._sent = true;
      persistBack(payload);
    } catch {}
    return payload;
  }

  function toSlimPayload(p) {
    const q = Array.isArray(p?.questions) ? p.questions.map(one => {
      const c = { ...one };
      if (c?.recording) delete c.recording;
      if (c?.audio) delete c.audio;
      if (c?.audioBase64) delete c.audioBase64;
      return c;
    }) : [];
    return {
      studentName: p?.studentName || 'Étudiant·e',
      startTime: p?.startTime || p?.startISO || '',
      endTime: p?.endTime || '',
      totalTimeSeconds: Number(p?.totalTimeSeconds || p?.totalSeconds || 0),
      questions: q
    };
  }

  function persistBack(p) {
    try {
      if (sessionStorage.getItem('pondant_results')) {
        sessionStorage.setItem('pondant_results', JSON.stringify(p));
      } else if (localStorage.getItem('pongdang:lastResults')) {
        localStorage.setItem('pongdang:lastResults', JSON.stringify(p));
      } else {
        // 기본은 sessionStorage에 저장
        sessionStorage.setItem('pondant_results', JSON.stringify(p));
      }
    } catch {}
  }

  // ========= 발음 정확도 표 =========
  function renderPronunTable(root, payload){
    const mount = root.querySelector('#pronunTable');
    if (!mount) return;

    const rows = (payload.questions || []).map((q, i) => {
      const scoreVal = Number(q.pronunScore ?? q.pronScore ?? q.lastScore ?? q.score ?? q.pronunciation ?? 0);
      const triesVal = Number(q.evalCount ?? q.pronunEvalCount ?? q.tries ?? 0);
      const label = (q.ko || q.fr || '').toString().slice(0, 40);

      const scoreText = Number.isFinite(scoreVal) ? (Math.round(scoreVal) + '%') : '—';
      const triesText = triesVal ? String(triesVal) : '—';

      return `
        <tr>
          <td class="px-3 py-2 text-slate-600">Q${i+1}</td>
          <td class="px-3 py-2">${scoreText}</td>
          <td class="px-3 py-2">${triesText}</td>
          <td class="px-3 py-2 text-slate-500">${escapeHTML(label)}</td>
        </tr>
      `;
    }).join('');

    mount.innerHTML = `
      <div class="overflow-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="bg-slate-100">
              <th class="px-3 py-2 text-left">#</th>
              <th class="px-3 py-2 text-left">Précision</th>
              <th class="px-3 py-2 text-left">Essais</th>
              <th class="px-3 py-2 text-left">Phrase</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  // ========= 렌더 =========
  function render(payload, opts = {}) {
    const root = $(opts.rootSelector || '#app') || document.body;

    // 상단 헤더 + 총점/시간 + 오답노트 박스 구성
    const name = escapeHTML(payload?.studentName || '-');
   const graded = (payload?.questions || []).filter(q => typeof q?.isCorrect === 'boolean');
    const correct = graded.filter(q => q.isCorrect).length;
    const totalG = graded.length || (payload?.questions?.length || 0);
    const pctFromItems = totalG ? Math.round((100 * correct) / totalG) : 0;
    const final = Number.isFinite(Number(payload?.overall)) ? Number(payload.overall) : pctFromItems;
    const tsec = Number(payload?.totalTimeSeconds || payload?.totalSeconds || 0);


    root.innerHTML = `
      <header class="mb-4 max-w-3xl mx-auto">
        <div class="flex items-center justify-between">
          <div class="text-sm text-slate-500">made by 성일,Pongdang · Lapeace29@gmail.com</div>
          <button id="btnPrint" class="px-3 py-2 rounded bg-blue-700 text-white">인쇄 / Imprimer</button>
        </div>
        <h1 class="mt-3 text-2xl font-bold">결과 / <span class="text-amber-600">Résultats</span></h1>
      </header>

      <section class="bg-white rounded-xl p-5 shadow max-w-3xl mx-auto">
        <p>이름 / Nom : <b>${name}</b></p>
        <p id="finalScore" class="mt-1">Score final : <b class="text-blue-700">${final}%</b></p>
        <p id="totalTime" class="mt-1">Temps total : <b>${fmtHMS(tsec)}</b></p>
      </section>

      <!-- 발음 정확도 표 -->
      <section class="max-w-3xl mx-auto mt-4 card">
        <h3 class="text-lg font-semibold mb-2">Précision de prononciation / 발음 정확도</h3>
        <div id="pronunTable"></div>
      </section>

      <section class="max-w-3xl mx-auto mt-4">
        <h2 class="font-semibold mb-2">오답 노트 / Fautes</h2>
        <ul id="wrongNote" class="space-y-3"></ul>
      </section>

      <footer class="mt-6 text-center text-sm text-slate-500 max-w-3xl mx-auto">
        made by 성일,Pongdang · Lapeace29@gmail.com
        <div class="mt-3 flex gap-2 justify-center">
          <button id="btnBack" class="px-4 py-2 rounded border">이전 연습문제로 / Exercice précédent</button>
          <a href="/index.html" class="px-4 py-2 rounded bg-amber-500 text-white">메인으로 / Accueil</a>
        </div>
      </footer>
    `;

    // 오답만 노트 채우기
    const wrong = (payload?.questions || []).filter(q => q?.isCorrect === false);
    const box = $('#wrongNote');
    if (box) {
      if (!wrong.length) {
        box.innerHTML = `<div class="text-emerald-600">Aucune erreur 🎉</div>`;
      } else {
        const items = wrong.map(q => {
          const num = escapeHTML(q?.number ?? '');
          const ko = escapeHTML(q?.ko ?? '');
          const fr = escapeHTML(q?.fr ?? '');
          const ua = q?.userAnswer;
          const uaKO = typeof ua === 'object' ? escapeHTML(ua?.ko ?? '') : escapeHTML(ua ?? '');
          const uaFR = typeof ua === 'object' ? escapeHTML(ua?.fr ?? '') : '';
          const reg = q?.notes?.register ? `<div class="text-amber-700 text-xs mt-1">말투/Registre: ${escapeHTML(q.notes.register)}</div>` : '';
          return `
            <li class="mb-3 p-3 rounded-lg bg-rose-50 border border-rose-200">
              <div class="font-semibold text-rose-700">Q${num}</div>
              <div class="text-sm text-slate-800">KO: ${ko}</div>
              <div class="text-xs text-slate-500">FR: ${fr}</div>
              <div class="text-sm text-rose-600 mt-1">내 답(한): ${uaKO || '-'}</div>
              ${uaFR ? `<div class="text-xs text-rose-500">Ma réponse (FR): ${uaFR}</div>` : ''}
              ${reg}
            </li>
          `;
        }).join('');
        box.innerHTML = items;
      }
    }

    // 버튼
    $('#btnPrint')?.addEventListener('click', () => window.print());
    $('#btnBack')?.addEventListener('click', () => history.back());

    // 발음 정확도 표 렌더
    renderPronunTable(root, payload);
  }

  // ========= 마운트(자동 전송 포함) =========
  async function mount(rootSelector = '#app', options = {}) {
    let payload = loadPayload();
    if (!payload) {
      const root = $(rootSelector) || document.body;
      root.innerHTML = `
        <div class="bg-white rounded-xl p-6 shadow max-w-3xl mx-auto">
          <p class="text-lg">결과가 없습니다. / Aucun résultat.</p>
          <div class="mt-4 flex gap-2">
            <a href="/index.html" class="px-4 py-2 rounded bg-blue-700 text-white">메인으로 / Accueil</a>
            <button onclick="history.back()" class="px-4 py-2 rounded border">이전으로 / Retour</button>
          </div>
        </div>`;
      return;
    }

    // 중복 렌더/전송 방지(옵션): 체크섬이 같으면 스킵(렌더는 보장)
    const key = 'pongdang:results:hash';
    const curHash = tinyHash(toSlimPayload(payload));
    try {
      const prev = sessionStorage.getItem(key);
      if (options.skipIfSame && prev && prev === curHash) {
        render(payload, { rootSelector });
        return;
      }
      sessionStorage.setItem(key, curHash);
    } catch {}

    // 1회 자동 전송
    payload = await postResultsOnce(payload);

    // 렌더
    render(payload, { rootSelector });
  }

  // ========= auto-run =========
  document.addEventListener('DOMContentLoaded', () => {
    // 자동 마운트: #app 이 있으면 mount
    if (document.getElementById('app')) mount('#app', { skipIfSame: true });
  });

  // ========= export =========
  global.ResultsViewer = { mount, render, fmtHMS };

})(window);
