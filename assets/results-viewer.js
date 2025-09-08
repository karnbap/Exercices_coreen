<script>
/* 공용 결과 뷰어: sessionStorage('pondant_results') → 화면 렌더링 */
window.ResultsViewer = {
  mount(rootId='app'){
    const el = document.getElementById(rootId);
    const data = JSON.parse(sessionStorage.getItem('pondant_results')||'null');
    if(!data){ el.innerHTML = `
      <div class="bg-white rounded-xl p-6 shadow">
        <p class="text-lg">결과가 없습니다. / Aucun résultat.</p>
        <div class="mt-4 flex gap-2">
          <a href="/index.html" class="px-4 py-2 rounded bg-blue-700 text-white">메인으로 / Accueil</a>
          <button onclick="history.back()" class="px-4 py-2 rounded border">이전으로 / Retour</button>
        </div>
      </div>`; return;
    }
    const n = data.questions.length||1;
    const avg = x => Math.round((x/n)||0);
    const ko = avg(data.totals?.ko||0), fr = avg(data.totals?.fr||0), pr = avg(data.totals?.pron||0);
    const total = Math.round((ko+fr+pr)/3);
    el.innerHTML = `
<header class="mb-4 max-w-3xl mx-auto">
  <div class="flex items-center justify-between">
    <div class="text-sm text-slate-500">made by 성일,Pongdang · Lapeace29@gmail.com</div>
    <button onclick="window.print()" class="px-3 py-2 rounded bg-blue-700 text-white">인쇄 / Imprimer</button>
  </div>
  <h1 class="mt-3 text-2xl font-bold">결과 / <span class="text-amber-600">Résultats</span></h1>
</header>

<section class="bg-white rounded-xl p-5 shadow max-w-3xl mx-auto">
  <p>이름 / Nom : <b>${data.studentName||'-'}</b></p>
  <p class="mt-1">총점 / Total : <b class="text-blue-700">${total}/100</b></p>
  <p class="mt-1 text-sm">KO 받아쓰기 ${ko}/100 · FR 번역 ${fr}/100 · 발음 ${pr}/100</p>
</section>

<section class="mt-4 space-y-3 max-w-3xl mx-auto">
  ${data.questions.map(q=>`
  <article class="bg-white rounded-xl p-4 shadow">
    <div class="flex justify-between items-center">
      <b>#${q.number}</b>
      <span class="${q.isCorrect?'text-green-600':'text-rose-600'} font-semibold">
        ${q.isCorrect?'정답 / Correct':'오답 / Faux'}
      </span>
    </div>
    <div class="mt-2">
      <p><b>정답(한)</b> ${q.ko}</p>
      <p><b>내 답(한)</b> ${q.userAnswer?.ko||'-'}</p>
      <p class="text-sm text-slate-500">메모(한): ${q.notes?.ko||'-'}</p>
    </div>
    <div class="mt-2">
      <p><b>Traduction (FR)</b> ${q.fr}</p>
      <p><b>Ma réponse (FR)</b> ${q.userAnswer?.fr||'-'}</p>
      <p class="text-sm text-slate-500">Note (FR): ${q.notes?.fr||'-'}</p>
      ${q.notes?.register?`<p class="text-amber-700 text-sm mt-1">말투/Registre: ${q.notes.register}</p>`:''}
    </div>
    <p class="mt-2 text-sm">점수: KO ${q.scores?.ko||0}/100 · FR ${q.scores?.fr||0}/100 · 발음 ${q.scores?.pron||0}/100</p>
  </article>`).join('')}
</section>

<footer class="mt-6 text-center text-sm text-slate-500 max-w-3xl mx-auto">
  made by 성일,Pongdang · Lapeace29@gmail.com
  <div class="mt-3 flex gap-2 justify-center">
    <button onclick="history.back()" class="px-4 py-2 rounded border">이전 연습문제로 / Exercice précédent</button>
    <a href="/index.html" class="px-4 py-2 rounded bg-amber-500 text-white">메인으로 / Accueil</a>
  </div>
</footer>`;
  }
}
</script>
