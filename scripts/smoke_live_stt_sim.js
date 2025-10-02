const fs = require('fs');
const { JSDOM } = require('jsdom');
const path = require('path');

const html = `<!doctype html><html><body><div class="card" id="card1"><div class="status-line"></div></div></body></html>`;
const dom = new JSDOM(html, { runScripts: 'dangerously', resources:'usable' });
global.window = dom.window; global.document = dom.window.document;

// load target script
const scriptPath = path.resolve('assets/live-stt.js');
const script = fs.readFileSync(scriptPath, 'utf8');
dom.window.eval(script);

dom.window.document.addEventListener('DOMContentLoaded', ()=>{});

// Wait a tick to let script init
setTimeout(()=>{
  const card = dom.window.document.getElementById('card1');
  console.log('Card exists?', !!card);

  // Scenario 1: two final chunks without spaces at boundary
  const s1 = [ { transcript:'오늘', isFinal:true }, { transcript:'아침', isFinal:true } ];
  const r1 = dom.window.LiveSTT.simulate(card, s1);
  console.log('S1 result:', r1);

  // Scenario 2: zero-width space inside chunk
  const s2 = [ { transcript:'오늘\u200B아침', isFinal:true } ];
  const r2 = dom.window.LiveSTT.simulate(card, s2);
  console.log('S2 result:', r2);

  // Scenario 3: interim chunk then final
  const s3 = [ { transcript:'오늘', isFinal:false }, { transcript:'아침에', isFinal:true } ];
  const r3 = dom.window.LiveSTT.simulate(card, s3);
  console.log('S3 result:', r3);

  process.exit(0);
}, 200);
