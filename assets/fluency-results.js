// assets/fluency-results.js (v1.0)
// 유창성 전용 결과 뷰어: 가중 합산(발음5, 한글3, 불어2) + Etape2/3 재권장
(function () {
  'use strict';

  const $ = (s, r=document)=>r.querySelector(s);
  const app = $('#app');

  // === 데이터 로드 (results-compat / results-viewer와 호환 키 모두 지원) ===
  function loadPayload() {
    if (window.PONGDANG_RESULTS) return window.PONGDANG_RESULTS;
    try { const s = sessionStorage.getItem('pongdang_results'); if (s) return JSON.parse(s); } catch{}
    try { const s = sessionStorage.getItem('pondant_results'); if (s) return JSON.parse(s); } catch{}
    try { const l = localStorage.getItem('pongdang:lastResults'); if (l) return JSON.parse(l); } catch{}
    return null;
  }

  // === 공통 유틸 ===
  function esc(s){ return String(s??'').replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
  function fmtHMS(total){
    total = Math.max(0, Number(total)||0);
    const h=Math.floor(total/3600), m=Math.floor((total%3600)/60), s=Math.floor(total%60);
    return (h?`${h} h `:'')+(m?`${m} min `:'')+`${s} s`;
  }
  const koOnly = s=>String(s||'').replace(/[^\uAC00-\uD7A3\s]/g,'').replace(/\s+/g,' ').trim();
  const koTight= s=>koOnly(s).replace(/\s+/g,'');
  const frNorm = s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^\p{Letter}\p{Number}\s-]/gu,' ').replace(/\s+/g,' ').trim();

  // 단순 레벤슈타인 유사도(0..1)
  function similarity(a,b){
    a=String(a||''), b=String(b||''); const m=a.length, n=b.length;
    if(!m && !n) return 1; if(!m||!n) return 0;
    const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
    for(let i=0;i<=m;i++) dp[i][0]=i;
    for(let j=0;j<=n;j++) dp[0][j]=j;
    for(let i=1;i<=m;i++) for(let j=1;j<=n;j++){
      const cost = (a[i-1]===b[j-1])?0:1;
      dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+cost);
    }
    return Math.max(0,1-dp[m][n]/Math.max(m,n));
  }

  // === KO 채점(“의미 바뀌는 띄어쓰기” 제외 관대) ===
  // 규칙: (1) 자모/문장부호 제거 후 유사도 sim0 (2) 공백 제거 유사도 sim1
  //      (3) sim1이 높고 sim0만 약간 낮으면 띄어쓰기 오차로 간주 → 가벼운 감점
  function scoreKO(ref, hyp){
    const r0=koOnly(ref), h0=koOnly(hyp);
    const r1=koTight(ref), h1=koTight(hyp);
    const sim0=similarity(r0,h0), sim1=similarity(r1,h1);

    // 의미 왜곡 후보(큰 형태소 누락/치환) → 낮게
    const strongErr = (r1.length>=4 && sim1<0.65);

    let base = Math.round(sim1*100);
    if (!strongErr && sim1>=0.90 && sim0<0.88) base = Math.max(90, Math.round((sim0*100)+5)); // 띄어쓰기만 틀림 보정
    return Math.max(0, Math.min(100, base));
  }

  // === FR 채점(단어 부분/동의계열 허용: 토큰 교집합 + 부분일치) ===
  function scoreFR(ref, hyp){
    const R = frNorm(ref).split(' ').filter(Boolean);
    const H = frNorm(hyp).split(' ').filter(Boolean);
    if (!R.length || !H.length) return 0;

    const setR = new Set(R);
    let hit = 0;
    for (const w of H){
      if (setR.has(w)) { hit++; continue; }
      // 부분 어근 매칭(3자 이상)
      if (w.length>=4 && R.some(r=>r.length>=4 && (r.includes(w)||w.includes(r)))) hit+=0.6;
    }
    const cov = Math.min(1, hit / R.length);
    // 문장 전체 의미 근사: 토큰 커버리지 70%↑를 상으로 가중
    const sim = Math.max(cov, similarity(R.join(' '), H.join(' ')));
    return Math.round(sim*100);
  }

  // === 가중 합산(발음5/KO3/FR2 → 10점 환산) ===
  function weighted10(pron, ko, fr){
    const P = Number.isFinite(pron)?pron:0;
    const K = Number.isFinite(ko)?ko:0;
    const F = Number.isFinite(fr)?fr:0;
    const total100 = (P*0.5) + (K*0.3) + (F*0.2);
    return Math.round(total100/10); // 0..10
  }

  // === Etape2/3 권장: 낮은 발음 점수 문항을 Etape1 번호로 매핑하여 2~3회 반복 권장 ===
  function buildRecommendations(questions){
    // pronunScore < 75 우선, 없으면 < 85
    const low = questions
      .map((q,i)=>({i, num:q.number||i+1, ko:q.ko||'', sc:Number(q.pronunScore||q.score||0), asr:String(q.asrTranscript||'')}))
      .filter(x=>x.sc>0)
      .sort((a,b)=>a.sc-b.sc);

    const picked = (low.filter(x=>x.sc<75).slice(0,4).length ? low.filter(x=>x.sc<75).slice(0,4)
                     : low.filter(x=>x.sc<85).slice(0,3));

    return picked.map(x=>({
      num: x.num,
      ko : x.ko,
      sc : Math.round(x.sc),
      tip: '이 문장을 2~3번 더 이어서 말해보세요 / Répète 2–3 fois en liant.'
    }));
  }

  // === 렌더 ===
  function render(payload){
    if (!payload){
      app.innerHTML = `
        <section class="bg-white rounded-xl p-6 shadow">
          <p class="text-lg">결과가 없습니다. / Aucun résultat.</p>
          <div class="mt-3 flex gap-2">
            <a href="/assignments/fluency-exercices-kobito.html" class="px-4 py-2 rounded border">이전으로 / Retour</a>
            <a href="/index.html" class="px-4 py-2 rounded bg-blue-700 text-white">처음으로 / Accueil</a>
          </div>
        </section>`;
      return;
    }

    const name = esc(payload.studentName||'—');
    const tsec = Number(payload.totalTimeSeconds||payload.totalSeconds||0);
    const Q = Array.isArray(payload.questions)?payload.questions:[];

    // Etape1 후보(ko 참조, userAnswer에 한/불 구분이 있거나, 두 입력이 모두 존재)
    const step1 = Q.filter(q=>{
      const ua = q.userAnswer;
      const koAns = (typeof ua==='object'? ua.ko : ua)||'';
      const frAns = (typeof ua==='object'? ua.fr : '');
      return (q.ko && (koAns || frAns));
    });

    // 한글/불어 점수 산출
    const rows = step1.map((q,idx)=>{
      const ua = q.userAnswer;
      const koAns = (typeof ua==='object'? ua.ko : ua)||'';
      const frAns = (typeof ua==='object'? ua.fr : '');

      const koS = scoreKO(q.ko||'', koAns||'');
      const frS = scoreFR(q.fr||'', frAns||'');

      const pron = Math.round(Number(q.pronunScore||q.score||0)); // 0..100
      const on10 = weighted10(pron, koS, frS);

      return {
        num: q.number || (idx+1),
        koRef: q.ko||'',
        frRef: q.fr||'',
        koAns, frAns, pron, koS, frS, on10
      };
    });

   const avgPron = rows.length? Math.round(rows.reduce((a,r)=>a+r.pron,0)/rows.length) : 0;
const avgKO   = rows.length? Math.round(rows.reduce((a,r)=>a+r.koS ,0)/rows.length) : 0;
const avgFR   = rows.length? Math.round(rows.reduce((a,r)=>a+r.frS ,0)/rows.length) : 0;

// 총점 체계: KO(200), FR(100), Pron(300) → 총 600
const totKO   = Math.round(avgKO   * 2);   // 0..200
const totFR   = Math.round(avgFR   * 1);   // 0..100
const totPron = Math.round(avgPron * 3);   // 0..300
const grand600 = totKO + totFR + totPron;  // 0..600


    // Etape2/3 권장
    const recos = buildRecommendations(Q);

    app.innerHTML = `
      <section class="bg-white rounded-xl p-6 shadow">
<h1 class="text-2xl font-bold">유창성 훈련 결과 / <span class="text-amber-600">Résultats d’entraînement</span></h1>
        <p class="mt-1">이름 / Nom : <b>${name}</b></p>
        <p class="mt-1">총 시간 / Temps total : <b>${fmtHMS(tsec)}</b></p>
<div class="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
  <div class="sum-box"><div class="sum-title">한글로 바꾸기 점수 / (FR: vers le coréen)</div><div class="sum-val">${totKO}/200</div></div>
  <div class="sum-box"><div class="sum-title">불어로 바꾸기 점수 / (FR: vers le français)</div><div class="sum-val">${totFR}/100</div></div>
  <div class="sum-box"><div class="sum-title">발음 점수 / (FR: Prononciation)</div><div class="sum-val">${totPron}/300</div></div>
  <div class="sum-box"><div class="sum-title">총점 / (FR: Total)</div><div class="sum-val">${grand600}/600</div></div>
</div>

      </section>

      <section class="card mt-4">
        <h2 class="text-lg font-semibold mb-2">Étape 1 — KO/FR 세부 채점</h2>
        <div class="overflow-auto">
          <table class="min-w-full text-sm">
            <thead><tr class="bg-slate-100">
              <th class="px-3 py-2 text-left">#</th>
              <th class="px-3 py-2 text-left">KO 기준</th>
              <th class="px-3 py-2 text-left">내 답(한)</th>
              <th class="px-3 py-2 text-left">FR 기준</th>
              <th class="px-3 py-2 text-left">Ma réponse (FR)</th>
              <th class="px-3 py-2 text-left">발음</th>
              <th class="px-3 py-2 text-left">KO</th>
              <th class="px-3 py-2 text-left">FR</th>
              <th class="px-3 py-2 text-left">합계(10)</th>
            </tr></thead>
            <tbody>
              ${rows.map(r=>`
                <tr>
                  <td class="px-3 py-2">Q${r.num}</td>
                  <td class="px-3 py-2">${esc(r.koRef)}</td>
                  <td class="px-3 py-2">${esc(r.koAns||'-')}</td>
                  <td class="px-3 py-2 text-slate-600">${esc(r.frRef||'-')}</td>
                  <td class="px-3 py-2 text-slate-600">${esc(r.frAns||'-')}</td>
                  <td class="px-3 py-2">${r.pron}</td>
                  <td class="px-3 py-2">${r.koS}</td>
                  <td class="px-3 py-2">${r.frS}</td>
                  <td class="px-3 py-2 font-bold">${r.on10}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>

      </section>

      <section class="card mt-4">
        <h2 class="text-lg font-semibold mb-2">Étapes 2 & 3 — 다시 하기 권장</h2>
        ${recos.length ? `
          <ul class="space-y-2">
            ${recos.map(x=>`
              <li class="p-3 rounded bg-amber-50 border border-amber-200">
                <div class="font-semibold">Q${x.num} · ${esc(x.ko)}</div>
                <div class="text-sm text-slate-600">Précision prononciation: ${x.sc}% — ${esc(x.tip)}</div>
              </li>`).join('')}
          </ul>
        ` : `<div class="text-emerald-700">아주 좋아요! / Très bien ! 🙂</div>`}
        <p class="mt-2 text-xs text-slate-500">낮은 발음 점수 문장을 Étape 1 번호 기준으로 2–3회 더 이어서 말하기.</p>
      </section>
    `;

    $('#btnPrint')?.addEventListener('click', ()=>window.print());
  }

  document.addEventListener('DOMContentLoaded', ()=> render(loadPayload()));
})();
