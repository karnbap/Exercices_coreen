// 간단 테스트 스크립트: refAwareNormalize 동작 확인용
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, 'analyze-pronunciation.js');
const src = fs.readFileSync(file,'utf8');

// Extract helper functions by eval in sandboxed function
const sandbox = {};
(function(){
  // expose minimal helpers used by refAwareNormalize
  function digitsToSinoInText(s){
    const SINO = ['','일','이','삼','사','오','육','칠','팔','구'];
    const NUM_UNITS = [ ['억',100000000], ['만',10000], ['천',1000], ['백',100], ['십',10], ['',1] ];
    function clampInt(n,min,max){ n=parseInt(n,10); if(!Number.isFinite(n)) n=0; return Math.max(min, Math.min(max, n)); }
    function numToSino(n){ n=clampInt(n,0,99999999); if(!n) return '영'; let out='', rest=n; for(const [u,v] of NUM_UNITS){ const q=Math.floor(rest/v); rest%=v; if(!q) continue; if(v===10 && q===1) out+='십'; else out+=SINO[q]+u; } return out; }
    return String(s||'').replace(/\d+/g,m=>numToSino(m));
  }
  function applyCounterVariants(s){
    let x=String(s||'');
    x=x.replace(/십일(?=[가-힣])/g,'열한')
       .replace(/십이(?=[가-힣])/g,'열두')
       .replace(/십삼(?=[가-힣])/g,'열세')
       .replace(/십사(?=[가-힣])/g,'열네')
       .replace(/이십일(?=[가-힣])/g,'스물한')
       .replace(/이십이(?=[가-힣])/g,'스물두')
       .replace(/이십삼(?=[가-힣])/g,'스물세')
       .replace(/이십사(?=[가-힣])/g,'스물네')
       .replace(/이십(?=[가-힣])/g,'스무')
       .replace(/일(?=[가-힣])/g,'한')
       .replace(/이(?=[가-힣])/g,'두')
       .replace(/삼(?=[가-힣])/g,'세')
       .replace(/사(?=[가-힣])/g,'네');
    x = x.replace(/셋(?=살)/g,'세').replace(/넷(?=살)/g,'네');
    return x;
  }

  sandbox.digitsToSinoInText = digitsToSinoInText;
  sandbox.applyCounterVariants = applyCounterVariants;

  // define refAwareNormalize same as in function file
  sandbox.refAwareNormalize = function(refText, txt){
    let t = String(txt || '');
    try { t = sandbox.digitsToSinoInText(t); } catch(e){}
    try { t = sandbox.applyCounterVariants(t); } catch(e){}
    return String(t||'');
  };
})();

// Sample cases
const cases = [
  {ref:'십유로짜리 초콜릿 세 개만 주세요.', hyp:'10유로짜리 초콜릿 3개만 주세요.'},
  {ref:'스물한 명이 참석합니다.', hyp:'21명이 참석합니다.'},
  {ref:'한 시 반에 만나요.', hyp:'1시 30분에 만나요.'}
];
for(const c of cases){
  console.log('REF:', c.ref);
  console.log('HYP:', c.hyp);
  console.log('normRef:', sandbox.refAwareNormalize(c.ref, c.ref));
  console.log('normHyp:', sandbox.refAwareNormalize(c.ref, c.hyp));
  console.log('---');
}
