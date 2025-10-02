const fs=require('fs');
const {JSDOM}=require('jsdom');
const path = require('path');
const html='<!doctype html><html><body><div id=cards></div></body></html>';
const dom=new JSDOM(html,{runScripts:'dangerously', resources:'usable'});
global.window=dom.window; global.document=dom.window.document; global.navigator = dom.window.navigator;
// Provide minimal global utilities/stubs expected by pronun-mini-test
global.window.Pronun = { mount: ()=>{} };
global.window.PronunUtils = { NumNormalizer: { refAwareNormalize: (r,t)=>t } };
// provide a minimal SENTENCES array so the script can mount cards
global.window.SENTENCES = [ { ko: '오늘 아침 우리 가족끼리 동네를 산책했는데', voice:'shimmer', speed:1.0 } ];

// load the client script and execute DOMContentLoaded
const scriptPath = path.resolve('assets/pronun-mini-test.js');
const script=fs.readFileSync(scriptPath,'utf8');
dom.window.eval(script);
const ev = new dom.window.Event('DOMContentLoaded'); dom.window.document.dispatchEvent(ev);

// The page's script typically appends cards into a container; ensure we have cards
const cardsContainer = document.querySelector('#cards');
// If the page didn't auto-attach, try calling a global init if present
if (typeof dom.window.initPronun === 'function') dom.window.initPronun(cardsContainer);

const firstCard = document.querySelector('#cards .card');
if(!firstCard){ console.error('no card created'); process.exit(2); }
const db = firstCard.querySelector('.duration-badge');
console.log('duration badge exists?', !!db);
if (db) console.log('duration badge innerHTML:\n', db.innerHTML);

// Try to simulate an onResult call if that function exists on the card
try{
	const fakeResult = { duration: 2.1, score: 0.8 };
	const onResult = firstCard._onResult || dom.window.onResult || null;
	if (typeof onResult === 'function'){
		onResult.call(firstCard, fakeResult);
		console.log('after onResult, dur HTML:\n', db.innerHTML);
	} else {
		console.log('no onResult function stubbed; manual inspection only');
	}
}catch(e){ console.error('onResult simulation failed', e); }
