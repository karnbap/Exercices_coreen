// assets/fluency-results.js (v1.2)
// 유창성 전용 결과 뷰어: 총점 600 (Etape1=200, Etape2=200, Etape3=200)
// Etape1 내부: 문제당 균등 배분 후 KO:FR:Pron = 2:1:3 가중 / Etape2·3는 발음만 반영
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
  function scoreKO(ref, hyp){
    const r0=koOnly(ref), h0=koOnly(hyp);
    const r1=koTight(ref), h1=koTight(hyp);
    const sim0=similarity(r0,h0), sim1=similarity(r1,h1);

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
      if (w.length>=4 && R.some(r=>r.length>=4 && (r.includes(w)||w.includes(r)))) hit+=0.6;
    }
    const cov = Math.min(1, hit / R.length);
    const sim = Math.max(cov, similarity(R.join(' '), H.join(' ')));
    return Math.round(sim*100);
  }

  // === Etape2/3 권장: 낮은 발음 점수 문항을 Etape1 번호로 매핑하여 2~3회 반복 권장 ===
  function buildRecommendations(questions){
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

    // Étape1 후보(ko 참조, userAnswer에 한/불 구분이 있거나, 두 입력이 모두 존재)
    const step1 = Q.filter(q=>{
      const ua = q.userAnswer;
      const koAns = (typeof ua==='object'? ua.ko : ua)||'';
      const frAns = (typeof ua==='object'? ua.fr : '');
      return (q.ko && (koAns || frAns));
    });

    // 한글/불어/발음(Etape1용) 점수 산출(표용)
    const rows = step1.map((q,idx)=>{
      const ua = q.userAnswer;
      const koAns = (typeof ua==='object'? ua.ko : ua)||'';
      const frAns = (typeof ua==='object'? ua.fr : '');

      const koS = scoreKO(q.ko||'', koAns||'');
      const frS = scoreFR(q.fr||'', frAns||'');
      const pron = Math.round(Number(q.pronunScore||q.score||0)); // 0..100

      return {
        num: q.number || (idx+1),
        koRef: q.ko||'',
        frRef: q.fr||'',
        koAns, frAns, pron, koS, frS,
        on10: Math.round(((pron*0.5)+(koS*0.3)+(frS*0.2))/10) // 표의 기존 합계(10) 유지용
      };
    });

    // === Étape 분리 ===
    const allQ   = Array.isArray(payload.questions) ? payload.questions : [];
    const step1Q = allQ.filter(q => (q.fr && String(q.fr).trim().length));
    const others = allQ.filter(q => !(q.fr && String(q.fr).trim().length));
    const step3Q = others.slice(-1);
    const step2Q = others.slice(0, -1);

    // === 섹션별 점수(총 600) ===
    // Étape 1: 총 200점 → 문제 수로 균등 분배, 문제 내부 가중 2:1:3 (KO:FR:Pron)
    let s1 = 0;
    if (step1Q.length) {
      const per = 200 / step1Q.length;
      step1Q.forEach(q => {
        const ua = q.userAnswer || {};
        const koS = scoreKO(q.ko || '', String(ua.ko||''));
        const frS = scoreFR(q.fr || '', String(ua.fr||''));
        const prn = Math.round(Number(q.pronunScore||q.score||0));
        const w   = (2*koS + 1*frS + 3*prn) / 6; // 0..100
        s1 += per * (w/100);
      });
    }
    s1 = Math.round(s1);

    // Étape 2: 총 200점 → 문제 수로 균등 분배, 발음만 반영
    let s2 = 0;
    if (step2Q.length) {
      const per = 200 / step2Q.length;
      step2Q.forEach(q => {
        const prn = Math.round(Number(q.pronunScore||q.score||0));
        s2 += per * (prn/100);
      });
    }
    s2 = Math.round(s2);

    // Étape 3: 총 200점 → 문제 수(보통 1)로 균등 분배, 발음만 반영
    let s3 = 0;
    if (step3Q.length) {
      const per = 200 / step3Q.length;
      step3Q.forEach(q => {
        const prn = Math.round(Number(q.pronunScore||q.score||0));
        s3 += per * (prn/100);
      });
    }
    s3 = Math.round(s3);

    const grand600 = s1 + s2 + s3;

    // Etape2/3 권장
    const recos = buildRecommendations(Q);

    app.innerHTML = `
      <section class="bg-white rounded-xl p-6 shadow">
        <h1 class="text-2xl font-bold">유창성 훈련 결과 / <span class="text-amber-600">Résultats d’entraînement</span></h1>
        <p class="mt-1">이름 / Nom : <b>${name}</b></p>
        <p class="mt-1">총 시간 / Temps total : <b>${fmtHMS(tsec)}</b></p>
        <div class="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="sum-box"><div class="sum-title">Étape 1 (KO/FR/Pron 2:1:3)</div><div class="sum-val">${s1}/200</div></div>
          <div class="sum-box"><div class="sum-title">Étape 2 (Prononciation)</div><div class="sum-val">${s2}/200</div></div>
          <div class="sum-box"><div class="sum-title">Étape 3 (Prononciation)</div><div class="sum-val">${s3}/200</div></div>
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
