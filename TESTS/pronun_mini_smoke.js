// Quick jsdom smoke test for assets/pronun-mini-test.js
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');

const file = path.resolve(__dirname, '../assets/pronun-mini-test.js');
const code = fs.readFileSync(file,'utf8');

// Minimal global mocks
const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, { runScripts: 'outside-only' });
const { window } = dom;
global.window = window;
global.document = window.document;
global.location = { href: 'http://localhost/' };
global.fetch = async function(){ return { ok:true, json:async ()=>({}), arrayBuffer:async()=>new ArrayBuffer(0) }; };

// Mock Pronun mount object used by pronun-mini-test.js
global.Pronun = {
  mount: function(opts){
    // return a fake widget which calls onResult when asked
    return { 
      start:()=>{}, stop:()=>{},
      simulateResult: (result)=>{ opts.onResult(result); }
    };
  }
};

// Minimal Scoring mock (if not provided by the project)
try{ require('../assets/scoring.js'); }catch(e){
  global.Scoring = { gradePronun: (ref,hyp,opts)=>({pct: 78, highlights: {refHtml: ref, hypHtml: hyp}}) };
}

// Provide a minimal CSS class consumer
const root = document.getElementById('root');
root.innerHTML = '<div id="cards"></div>';

// Execute the pronun-mini-test.js code in the jsdom context
try{
  const script = new dom.window.Function('window','document','fetch','Pronun','Scoring', code + '\nreturn typeof makeCard === "function" ? makeCard : null;');
  const makeCard = script(window, document, fetch, Pronun, global.Scoring);
  if(!makeCard) throw new Error('makeCard not exported');

  // Create a sample sentence object mimicking the SENTENCES entry
  const sent = { ko: '저는 동네에 살아요.', fr: '', hint1: '저는 / 동네', hideText:false };
  const card = makeCard(sent, 0);
  document.getElementById('cards').appendChild(card);

  // Check for hint buttons
  const hintBtn1 = card.querySelector('.hint-help1');
  const hintBtn2 = card.querySelector('.hint-help2');
  console.log('hint1 exists?', !!hintBtn1, 'text=', hintBtn1 && hintBtn1.textContent.trim());
  console.log('hint2 exists?', !!hintBtn2, 'text=', hintBtn2 && hintBtn2.textContent.trim());

  // Check durationsEl
  const durationsEl = card.querySelector('.duration-badge') || card.querySelector('[data-durations]');
  console.log('durationsEl found?', !!durationsEl);

  // Test hint2 blanking: simulate click and check displayed blank
  hintBtn2 && hintBtn2.click();
  const hd = card.querySelector('[data-hint-display]') || card.querySelector('.hint-display');
  console.log('hint display after hint2 click:', hd && hd.textContent.slice(0,40));

  console.log('smoke test passed');
  process.exit(0);
}catch(e){
  console.error('smoke test failed:', e && e.stack || e);
  process.exit(2);
}
