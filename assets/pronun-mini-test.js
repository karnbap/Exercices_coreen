const { spawn } = require('child_process');
const http = require('http');
const puppeteer = require('puppeteer');

function waitForServer(url, timeout=10000, interval=200){
  const start = Date.now();
  return new Promise((resolve,reject)=>{
    (function poll(){
      http.get(url, res => { res.resume(); resolve(); }).on('error', ()=>{
        if (Date.now()-start > timeout) return reject(new Error('timeout'));
        setTimeout(poll, interval);
      });
    })();
  });
}

async function main(){
  const serverProc = spawn(process.execPath, [__dirname + '/static-server.js'], { cwd: process.cwd(), stdio: ['ignore','pipe','pipe'] });
  serverProc.stdout.on('data', d => process.stdout.write('[server] '+d.toString()));
  serverProc.stderr.on('data', d => process.stderr.write('[server-err] '+d.toString()));
  serverProc.on('exit', (c)=> console.log('[server] exited', c));

  const url = 'http://127.0.0.1:8080/assignments/fluent_kobito00.html';
  try{
    await waitForServer('http://127.0.0.1:8080/');
  }catch(e){ console.error('server did not start in time', e); serverProc.kill(); process.exit(2); }

  const possiblePaths = [
    process.env['PROGRAMFILES']+'\\Google\\Chrome\\Application\\chrome.exe',
    process.env['PROGRAMFILES(X86)']+'\\Google\\Chrome\\Application\\chrome.exe',
    process.env['PROGRAMFILES']+'\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env['PROGRAMFILES(X86)']+'\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  const fs = require('fs');
  const launchOptions = { args:['--no-sandbox','--disable-setuid-sandbox'] };
  for (const p of possiblePaths) if (fs.existsSync(p)) { launchOptions.executablePath = p; break; }

  let browser;
  try{
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    console.log('navigating to', url);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForSelector('.card', { timeout: 5000 });

    // Inject a ttsPlay stub and pre-fill localStorage with simulated samples
    await page.evaluate(()=>{
      // simple heuristic: 0.12s per Korean syllable at speed=1.0
      const sylSec = 0.12;
      // pre-fill pronunSpeedSamples from SENTENCES if present
      try{
        const sentences = window.SENTENCES || [];
        const samples = [];
        sentences.forEach(s=>{
          const text = s.ko || '';
    const syll = (text||'').split('').filter(ch=> /[\uAC00-\uD7A3]/.test(ch)).length || (text? text.split('').length : 1);
          const speed = (typeof s.speed === 'number' ? s.speed : 1.0);
          const est = Number((syll * (sylSec / speed)).toFixed(2));
          for (let k=0;k<3;k++){
            const noise = 0.95 + (k*0.03);
            const dur = Number((est * noise).toFixed(2));
            samples.push({ duration: dur, syllables: syll, rate: syll>0 ? Number((dur/syll).toFixed(4)) : null });
          }
        });
        localStorage.setItem('pronunSpeedSamples', JSON.stringify(samples.slice(-150)));
      }catch(e){ /* ignore */ }

      // stub ttsPlay to return a fake Audio with durationEstimateSec
      window.ttsPlay = async function(text, voice='shimmer', speed=1.0){
        const syll = (text||'').split('').filter(ch=>/[\uAC00-\uD7A3]/.test(ch)).length || Math.max(1, (text||'').split('').length);
        const est = Number((syll * (0.12 / (speed || 1))).toFixed(2));
        const a = new Audio();
        a.durationEstimateSec = est;
        a.getBestDurationSec = function(){ return this.durationEstimateSec; };
        a.play = ()=>Promise.resolve();
        a.pause = ()=>{};
        // simulate ended event shortly after
        setTimeout(()=>{ try{ a.measuredPlaySec = a.durationEstimateSec; const ev = new Event('ended'); a.dispatchEvent(ev); }catch(_){ } }, Math.max(50, est*1000));
        return a;
      };
    });

    // Evaluate in page: click listen for each card and wait for duration estimate
    const results = await page.evaluate(async ()=>{
      const cards = Array.from(document.querySelectorAll('.card'));
      const out = [];
      for (let i=0;i<cards.length;i++){
        const card = cards[i];
        const refText = card.querySelector('.text-xl.font-bold')?.textContent?.trim() || '';
        const refSyllables = (refText || '').split('').filter(ch=>/[\uAC00-\uD7A3]/.test(ch)).length || 0;
        const listenBtn = card.querySelector('[data-action="listen"]');
        if (!listenBtn){ out.push({index:i, refText, refSyllables, error:'no-listen'}); continue; }
        try{ listenBtn.click(); }catch(_){ try{ listenBtn.dispatchEvent(new MouseEvent('click')); }catch(_){} }
        const start = Date.now();
        let ttsDuration = null;
        // wait up to 10s for audio to be created and a best-duration to appear
        while (Date.now() - start < 10000){
          try{
            const audio = listenBtn._audio;
            if (audio){
              if (typeof audio.getBestDurationSec === 'function'){
                const best = audio.getBestDurationSec();
                if (best !== null && typeof best === 'number' && isFinite(best)) { ttsDuration = best; break; }
              }
              if (typeof audio.durationEstimateSec === 'number') { ttsDuration = audio.durationEstimateSec; break; }
              if (typeof audio.duration === 'number' && isFinite(audio.duration) && audio.duration>0) { ttsDuration = audio.duration; break; }
            }
          }catch(_){ }
          await new Promise(r=>setTimeout(r,200));
        }
        // compute local avg for this sentence (if available)
        let avgLocal = null;
        try{ if (typeof computeLocalAverageSeconds === 'function') avgLocal = computeLocalAverageSeconds(refSyllables); }catch(_){ }
        // pause audio to avoid overlap
        try{ if (listenBtn._audio && !listenBtn._audio.paused) listenBtn._audio.pause(); }catch(_){ }
        out.push({ index:i, refText, refSyllables, ttsDuration, avgLocal });
        await new Promise(r=>setTimeout(r,250));
      }
      return out;
    });

    console.log('RESULTS:');
    console.log(JSON.stringify(results, null, 2));

    try{ await browser.close(); }catch(_){ }
  }catch(e){ console.error('puppeteer error', e); if (browser) try{ await browser.close(); }catch(_){ } }
  serverProc.kill();
}

main();
