const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = `<!doctype html><html><head></head><body><div id="root"></div></body></html>`;
const dom = new JSDOM(html, { pretendToBeVisual: true });
const document = dom.window.document;

// Create a minimal len-compare DOM as produced by makeCard
const lenCompare = document.createElement('div');
lenCompare.setAttribute('data-len-compare','');
lenCompare.innerHTML = `
  <div class="len-labels" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
    <button class="badge accuracy-badge" data-accuracy>정확도: —</button>
    <button class="badge duration-badge" data-durations>TTS: — · 녹음: —</button>
  </div>
  <div class="len-abs" aria-hidden="true">
    <div class="len-center" aria-hidden="true"></div>
    <div class="len-bar len-bar-tts" style="left:50%;width:0%" title="TTS: ?s"></div>
    <div class="len-bar len-bar-rec" style="left:50%;width:0%" title="녹음: ?s"></div>
  </div>
`;

// Simulate update logic: set ttsDur=1.8, recDur=2.9
const ttsDur = 1.8; const recDur = 2.9;
const durationBadge = lenCompare.querySelector('.duration-badge');
const tBar = lenCompare.querySelector('.len-bar-tts');
const rBar = lenCompare.querySelector('.len-bar-rec');

// run the same logic as client
const t = Number(ttsDur || 0); const r = Number(recDur || 0);
const absDiff = Math.abs((t || 0) - (r || 0));
const maxRange = Math.max(0.1, t, r, absDiff);
const tPct = Math.min(48, Math.round(((t || 0) / maxRange) * 48));
const rPct = Math.min(48, Math.round(((r || 0) / maxRange) * 48));
if (durationBadge) durationBadge.textContent = `TTS: ${ttsDur?ttsDur.toFixed(1)+'s':'?s'} · 녹음: ${recDur?recDur.toFixed(1)+'s':'?s'}`;
if (tBar){ if (t <= r){ tBar.style.left = `${50 - tPct}%`; tBar.style.width = `${tPct}%`; } else { tBar.style.left = '50%'; tBar.style.width = `${tPct}%`; } tBar.title = `TTS: ${ttsDur?ttsDur.toFixed(2)+'s':'?s'}`; }
if (rBar){ if (r <= t){ rBar.style.left = `${50 - rPct}%`; rBar.style.width = `${rPct}%`; } else { rBar.style.left = '50%'; rBar.style.width = `${rPct}%`; } rBar.title = `녹음: ${recDur?recDur.toFixed(2)+'s':'?s'}`; }

// Output results
console.log('durationBadge.text:', durationBadge.textContent);
console.log('tBar.left,width,title:', tBar.style.left, tBar.style.width, tBar.title);
console.log('rBar.left,width,title:', rBar.style.left, rBar.style.width, rBar.title);

// Basic assertions
if (!tBar.title.includes('TTS')) process.exit(2);
if (!rBar.title.includes('녹음')) process.exit(3);
console.log('DOM smoke test passed');
