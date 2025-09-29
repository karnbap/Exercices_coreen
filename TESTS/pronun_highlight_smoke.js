// Quick smoke test replicating generateDualHtml behavior for highlights
const fs = require('fs');

// replicate toJamoSeqLocal
function toJamoSeqLocal(s){
  const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const JUNG= ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  const JONG= ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const t = String(s||'').normalize('NFC').replace(/\s+/g,'').replace(/[^0-9A-Za-z가-힣]/g,'');
  const out = [];
  for (const ch of t){
    const code = ch.codePointAt(0);
    if (code>=0xAC00 && code<=0xD7A3){
      const i = code - 0xAC00;
      const cho = Math.floor(i / 588);
      const jung = Math.floor((i % 588) / 28);
      const jong = i % 28;
      out.push(CHO[cho], JUNG[jung]);
      if (JONG[jong]) out.push(JONG[jong]);
    } else out.push(ch);
  }
  return out;
}

function jamoCount(ch){
  if (!ch) return 1;
  if (/[가-힣]/.test(ch)){
    const code = ch.codePointAt(0);
    const i = code - 0xAC00;
    if (i < 0 || i > (0xD7A3 - 0xAC00)) return 1;
    const jong = i % 28; return jong === 0 ? 2 : 3;
  }
  return 1;
}

function generateDualHtml(refRaw, hypRaw){
  const normRef = refRaw; const normHyp = hypRaw;
  const refJ = toJamoSeqLocal(normRef);
  const hypJ = toJamoSeqLocal(normHyp);
  const m = refJ.length, n = hypJ.length;
  const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
  for (let i=1;i<=m;i++) for (let j=1;j<=n;j++) dp[i][j] = refJ[i-1]===hypJ[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
  let i=m, j=n; const keepRef = new Array(m).fill(false); const keepHyp = new Array(n).fill(false);
  while (i>0 && j>0){ if (refJ[i-1]===hypJ[j-1]){ keepRef[i-1]=true; keepHyp[j-1]=true; i--; j--; } else if (dp[i-1][j] >= dp[i][j-1]) i--; else j--; }

  function buildHtmlFromKeep(rawOriginal, keepArr, normSource){
    const raw = String(rawOriginal).normalize('NFC');
    const norm = String(normSource || raw).normalize('NFC');
    const rawChars = [...raw];
    const normChars = [...norm];

    // build mapping similar to patched function
    const normCharToRaw = new Array(normChars.length).fill(-1);
    let iNorm=0, iRaw=0;
    while (iNorm < normChars.length && iRaw < rawChars.length){
      if (normChars[iNorm] === rawChars[iRaw]){ normCharToRaw[iNorm]=iRaw; iNorm++; iRaw++; continue; }
      let found=-1;
      for (let k=1;k<=2 && (iRaw+k)<rawChars.length;k++){ if (normChars[iNorm]===rawChars[iRaw+k]){ found=iRaw+k; break;} }
      if (found!==-1){ normCharToRaw[iNorm]=found; iNorm++; iRaw=found+1; continue; }
      found=-1;
      for (let k=1;k<=2 && (iNorm+k)<normChars.length;k++){ if (normChars[iNorm+k]===rawChars[iRaw]){ found=iNorm+k; break;} }
      if (found!==-1){ normCharToRaw[iNorm]=iRaw; iNorm++; continue; }
      normCharToRaw[iNorm]=iRaw; iNorm++;
    }
    if (iNorm < normChars.length){
      const remainingNorm = normChars.length - iNorm;
      const remainingRaw = Math.max(1, rawChars.length - iRaw);
      const base = Math.floor(remainingNorm / remainingRaw);
      let extras = remainingNorm % remainingRaw;
      let r = iRaw;
      for (let k=0;k<remainingNorm;k++){
        normCharToRaw[iNorm + k] = Math.min(rawChars.length-1, r);
        const assigned = base + (extras>0 ? 1 : 0);
        if (assigned>0){ if (extras>0) extras--; if (((k+1) % (base + 1)) === 0) r = Math.min(rawChars.length-1, r+1); } else { r = Math.min(rawChars.length-1, r+1); }
      }
    }

    const normJamoToRawChar = [];
    for (let ci=0, jPos=0; ci<normChars.length; ci++){
      const cnt = jamoCount(normChars[ci]);
      for (let k=0;k<cnt;k++) normJamoToRawChar[jPos++] = normCharToRaw[ci];
    }
    const rawCharToNormJamoPositions = Array.from({length: rawChars.length}, ()=>[]);
    for (let j=0;j<normJamoToRawChar.length;j++){ const rawIdx = normJamoToRawChar[j]; if (typeof rawIdx==='number' && rawIdx>=0 && rawIdx<rawChars.length) rawCharToNormJamoPositions[rawIdx].push(j); }

    const htmlParts=[];
    for (let ri=0; ri<rawChars.length; ri++){
      const ch = rawChars[ri];
      const positions = rawCharToNormJamoPositions[ri];
      let ok=true;
      if (positions.length===0){ ok = normChars.includes(ch); }
      else { let kept=0; for (const p of positions) if (keepArr[p]) kept++; ok = (kept / positions.length) >= 0.5; }
      htmlParts.push(ok ? `<span>${ch}</span>` : `<span style="color:#dc2626">${ch}</span>`);
    }
    return htmlParts.join('');
  }

  const refHtml = buildHtmlFromKeep(refRaw, keepRef, normRef);
  const hypHtml = buildHtmlFromKeep(hypRaw, keepHyp, normHyp);
  return {refHtml, hypHtml, keepRefLen: keepRef.filter(Boolean).length, keepHypLen: keepHyp.filter(Boolean).length};
}

// test cases from attachments
const tests = [
  '십유로짜리초콜릿세개만주세요',
  '신짬뽕이랑찐빵,어느쪽이더매워?',
  '밖에비가쏟아져서우산좀빌려줄래?'
];

for (const t of tests){
  const out = generateDualHtml(t, t);
  console.log('===', t);
  console.log('refHtml:', out.refHtml);
  console.log('hypHtml:', out.hypHtml);
  // Debug: show internal mapping summary for inspection
  console.log('--- debug info ---');
  // Recompute internals similarly to function to display mappings
  const raw = String(t).normalize('NFC');
  const norm = String(t).normalize('NFC');
  const cleanNorm = norm.replace(/\s+/g,'').replace(/[^0-9A-Za-z가-힣]/g,'');
  const rawChars = [...raw];
  const normChars = [...cleanNorm];
  console.log('rawChars:', rawChars.join('|'));
  console.log('normChars:', normChars.join('|'));
  // compute normCharToRaw and rawCharToNormJamoPositions like the function
  const normCharToRaw = new Array(normChars.length).fill(-1);
  let iNorm=0, iRaw=0;
  while (iNorm < normChars.length && iRaw < rawChars.length){
    if (normChars[iNorm] === rawChars[iRaw]){ normCharToRaw[iNorm]=iRaw; iNorm++; iRaw++; continue; }
    let found=-1;
    for (let k=1;k<=2 && (iRaw+k)<rawChars.length;k++){ if (normChars[iNorm]===rawChars[iRaw+k]){ found=iRaw+k; break; } }
    if (found!==-1){ normCharToRaw[iNorm]=found; iNorm++; iRaw=found+1; continue; }
    found=-1;
    for (let k=1;k<=2 && (iNorm+k)<normChars.length;k++){ if (normChars[iNorm+k]===rawChars[iRaw]){ found=iNorm+k; break; } }
    if (found!==-1){ normCharToRaw[iNorm]=iRaw; iNorm++; continue; }
    normCharToRaw[iNorm]=iRaw; iNorm++;
  }
  if (iNorm < normChars.length){
    const remainingNorm = normChars.length - iNorm;
    const remainingRaw = Math.max(1, rawChars.length - iRaw);
    const base = Math.floor(remainingNorm / remainingRaw);
    let extras = remainingNorm % remainingRaw;
    let r = iRaw;
    for (let k=0;k<remainingNorm;k++){
      normCharToRaw[iNorm + k] = Math.min(rawChars.length-1, r);
      const assigned = base + (extras>0 ? 1 : 0);
      if (assigned>0){ if (extras>0) extras--; if (((k+1) % (base + 1)) === 0) r = Math.min(rawChars.length-1, r+1); } else { r = Math.min(rawChars.length-1, r+1); }
    }
  }
  const normJamoToRawChar = [];
  function jamoCount(ch){ if (!ch) return 1; if (/[가-힣]/.test(ch)){ const code = ch.codePointAt(0); const i = code - 0xAC00; if (i < 0 || i > (0xD7A3 - 0xAC00)) return 1; const jong = i % 28; return jong === 0 ? 2 : 3; } return 1; }
  for (let ci=0, jPos=0; ci<normChars.length; ci++){ const cnt = jamoCount(normChars[ci]); for (let k=0;k<cnt;k++) normJamoToRawChar[jPos++] = normCharToRaw[ci]; }
  const rawCharToNormJamoPositions = Array.from({length: rawChars.length}, ()=>[]);
  for (let j=0;j<normJamoToRawChar.length;j++){ const rawIdx = normJamoToRawChar[j]; if (typeof rawIdx==='number' && rawIdx>=0 && rawIdx<rawChars.length) rawCharToNormJamoPositions[rawIdx].push(j); }
  for (let ri=0; ri<rawChars.length; ri++) if (/[^0-9A-Za-z가-힣]/.test(rawChars[ri])) rawCharToNormJamoPositions[ri]=[];
  console.log('rawCharToNormJamoPositions:', rawCharToNormJamoPositions.map(a=>a.length).join('|'));
  console.log('--- end debug ---');
}
