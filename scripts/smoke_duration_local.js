const fs=require('fs');
const {JSDOM}=require('jsdom');
const html='<!doctype html><html><body><div id=cards></div></body></html>';
const dom=new JSDOM(html,{runScripts:'dangerously', resources:'usable'});
global.window=dom.window;global.document=dom.window.document;
// provide a minimal SENTENCES array so the script can mount cards
global.window.SENTENCES = [ { ko: '오늘 아침 우리 가족끼리 동네를 산책했는데', voice:'shimmer', speed:1.0 } ];
const script=fs.readFileSync('assets/pronun-mini-test.js','utf8');
dom.window.eval(script);
const ev = new dom.window.Event('DOMContentLoaded'); dom.window.document.dispatchEvent(ev);
const firstCard = document.querySelector('#cards .card'); if(!firstCard){ console.error('no card'); process.exit(2); }
const db = firstCard.querySelector('.duration-badge'); console.log('duration badge exists?', !!db);
console.log('duration badge innerHTML:\n', db ? db.innerHTML : '');
