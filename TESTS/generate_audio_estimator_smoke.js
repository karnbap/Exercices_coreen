// Smoke test for estimateDurationSec logic from generate-audio.js
function stripSSML(s){return String(s).replace(/<break[^>]*time="(\d+)ms"[^>]*>/gi, '[$BR:$1]').replace(/<[^>]+>/g,'');}
function countBreakMs(ssml){const ms = Array.from(String(ssml).matchAll(/<break[^>]*time="(\d+)ms"[^>]*>/gi)).map(m=>parseInt(m[1]||'0',10)).filter(Number.isFinite);return ms.length?ms.reduce((a,b)=>a+b,0):0}
function countHangulSyllables(s){return (String(s).match(/[\uAC00-\uD7A3]/g) || []).length;}
function estimateDurationSec({ text='', ssml='', speed=1.0, repeats=1 } = {}){
  const hasSSML = !!ssml;
  const clean = hasSSML ? stripSSML(ssml) : String(text||'');
  const brMs  = hasSSML ? countBreakMs(ssml) : 0;
  let syllables = countHangulSyllables(clean);
  if (syllables === 0) {
    const wc = (clean.trim().split(/\s+/).filter(Boolean).length || 0);
    const cc = clean.replace(/\s+/g,'').length;
    syllables = Math.max(1, Math.round(Math.max(wc*2, cc/3)));
  }
  const BASE_SPS = 4.2; const NUM_SLOW = 0.9;
  const looksNumeric = /[0-9]|[일이삼사오육칠팔구십백천만억]/.test(clean);
  const sps = (looksNumeric ? BASE_SPS*NUM_SLOW : BASE_SPS) * (Number(speed)||1);
  const speechSec = syllables / Math.max(0.1, sps);
  const brSec     = brMs / 1000;
  const totalOne  = speechSec + brSec;
  const rep = Math.max(1, Number(repeats)||1);
  return Math.max(0.2, totalOne * rep);
}

const cases = [
  {text:'오늘 아침 우리 가족끼리 마을을 산책했는데', speed:1.0},
  {text:'십유로짜리초콜릿세개만주세요', speed:1.0},
  {text:'12345', speed:1.0},
  {text:'The quick brown fox jumps over the lazy dog', speed:1.0}
];
for (const c of cases){
  console.log(c.text, '=>', estimateDurationSec({text:c.text,speed:c.speed}).toFixed(2)+'s');
}
