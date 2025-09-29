// TESTS/grade_pronun_strict_smoke.js
// Simple smoke tests for stricter gradePronun behavior
const { readFileSync } = require('fs');

// We'll require the browser-like scoring module by loading the file and evaluating it in a Node vm
const vm = require('vm');
const path = require('path');
const scoringSrc = readFileSync(path.join(__dirname,'..','assets','scoring.js'),'utf8');
const sandbox = { window: {}, global: {} };
vm.createContext(sandbox);
vm.runInContext(scoringSrc, sandbox);
const Scoring = sandbox.window.Scoring || sandbox.global.Scoring;

const cases = [
  { ref: '안녕하세요', hyp: '안녕하세요', expect100: true, note:'exact match' },
  { ref: '안녕하세요', hyp: '안녕하세욤', expect100: false, note:'minor typo' },
  { ref: '오늘 아침에 커피 마셨어요', hyp: '오늘아침에커피마셨어요', expect100: true, note:'normalized equal (spaces removed)' },
  { ref: '요리해 주세요', hyp: '요리해 주세오', expect100: false, note:'vowel mismatch' },
  { ref: '십유로짜리초콜릿세개만주세요', hyp: '십유로짜리초콜릿세개만주세요', expect100: true, note:'long exact match' }
];

const results = cases.map(c=>{
  const out = Scoring.gradePronun(c.ref, c.hyp, 0.1);
  return { ref:c.ref, hyp:c.hyp, pct: out.pct, htmlSnippet: (out.html||'').slice(0,120), pass: (out.pct===100)===c.expect100, note:c.note };
});

console.log(JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
