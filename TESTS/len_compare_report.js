const fs = require('fs');
const { JSDOM } = require('jsdom');
const path = require('path');

// Read CSS injected in assets/pronun-mini-test.js
const asset = fs.readFileSync(path.join(__dirname,'..','assets','pronun-mini-test.js'),'utf8');
let cssMatch = asset.match(/const css = `([\s\S]*?)`;/);
const css = cssMatch ? cssMatch[1] : null;

const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="root"></div></body></html>`);
const document = dom.window.document;

// inject extracted CSS if available
if (css){
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
}

// Build len-compare DOM (same markup used in client)
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

// simulate an update (tts 2.1, rec 3.4)
const ttsDur = 2.1, recDur = 3.4;
const tBar = lenCompare.querySelector('.len-bar-tts');
const rBar = lenCompare.querySelector('.len-bar-rec');
const durationBadge = lenCompare.querySelector('.duration-badge');
const t = Number(ttsDur || 0); const r = Number(recDur || 0);
const absDiff = Math.abs((t || 0) - (r || 0));
const maxRange = Math.max(0.1, t, r, absDiff);
const tPct = Math.min(48, Math.round(((t || 0) / maxRange) * 48));
const rPct = Math.min(48, Math.round(((r || 0) / maxRange) * 48));
if (durationBadge) durationBadge.textContent = `TTS: ${ttsDur?ttsDur.toFixed(1)+'s':'?s'} · 녹음: ${recDur?recDur.toFixed(1)+'s':'?s'}`;
if (tBar){ if (t <= r){ tBar.style.left = `${50 - tPct}%`; tBar.style.width = `${tPct}%`; } else { tBar.style.left = '50%'; tBar.style.width = `${tPct}%`; } tBar.title = `TTS: ${ttsDur?ttsDur.toFixed(2)+'s':'?s'}`; }
if (rBar){ if (r <= t){ rBar.style.left = `${50 - rPct}%`; rBar.style.width = `${rPct}%`; } else { rBar.style.left = '50%'; rBar.style.width = `${rPct}%`; } rBar.title = `녹음: ${recDur?recDur.toFixed(2)+'s':'?s'}`; }

// Append to document for serialization
document.getElementById('root').appendChild(lenCompare);

// Extract relevant CSS snippets by selector
function extractRule(sel){
  if (!css) return null;
  const re = new RegExp(`([\\s\\S]*?${sel.replace(/[-\\/\\^$*+?.()|[\]{}]/g,'\\$&')[0]}[\\s\\S]*?)`);
  // fallback: search occurrences of selector name
  const idx = css.indexOf(sel);
  if (idx === -1) return null;
  // get a chunk around idx
  const start = Math.max(0, idx-120);
  const end = Math.min(css.length, idx+300);
  return css.slice(start,end);
}

const selectors = ['.len-abs','.len-center','.len-bar','.len-bar-tts','.len-bar-rec','.badge','.accuracy-badge','.duration-badge'];
const cssSnips = {};
for (const s of selectors) cssSnips[s] = extractRule(s);

// Output report
const report = {
  timestamp: new Date().toISOString(),
  outerHTML: lenCompare.outerHTML,
  tBar: { left: tBar.style.left, width: tBar.style.width, title: tBar.title },
  rBar: { left: rBar.style.left, width: rBar.style.width, title: rBar.title },
  badges: { duration: durationBadge.textContent },
  cssSnips
};

// write to file for snapshot tests
try{
  const outPath = path.join(__dirname, 'len_compare_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote', outPath);
}catch(e){ console.warn('Could not write report file', e); }

console.log(JSON.stringify(report, null, 2));
