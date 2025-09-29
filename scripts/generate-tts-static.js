// scripts/generate-tts-static.js
// Usage: node scripts/generate-tts-static.js [--endpoint <url>] [--dry]
// By default, it will POST to '/.netlify/functions/generate-audio' on localhost:8888
// If --dry is passed, it will only list sentences and computed slugs without requesting audio.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// lightweight argv parsing
const rawArgs = process.argv.slice(2);
const argv = {};
for (let i=0;i<rawArgs.length;i++){
  const a = rawArgs[i];
  if (a === '--dry') argv.dry = true;
  if (a === '--endpoint' && rawArgs[i+1]) { argv.endpoint = rawArgs[i+1]; i++; }
}
const endpoint = argv.endpoint || process.env.GENERATE_AUDIO_ENDPOINT || 'http://localhost:8888/.netlify/functions/generate-audio';
const dry = !!argv.dry;

function sha1Hex(s){ return crypto.createHash('sha1').update(String(s||'')).digest('hex'); }

// Attempt to collect sentences from common places: export SENTENCES in assets or scan assignments
function gatherSentences(){
  const candidates = [];
  // try to load SENTENCES from assets if present
  const assetsFile = path.resolve(__dirname, '..', 'assets', 'pronun-mini-test.js');
  if (fs.existsSync(assetsFile)){
    const txt = fs.readFileSync(assetsFile,'utf8');
    const m = txt.match(/const\s+SENTENCES\s*=\s*(\[([\s\S]*?)\]);/m);
    if (m){
      try{ const arr = eval(m[1]); if (Array.isArray(arr)) { arr.forEach(it => { if (it && it.ko) candidates.push(it.ko); }); }
      }catch(e){}
    }
  }
  // fallback: scan assignment HTML files for likely sentences
  const assignDir = path.resolve(__dirname, '..', 'assignments');
  if (fs.existsSync(assignDir)){
    const files = fs.readdirSync(assignDir).filter(f=>f.endsWith('.html'));
    for (const f of files){
      const txt = fs.readFileSync(path.join(assignDir,f),'utf8');
      // naive: look for lines with Korean letters and quotes
      const re = /["'`]([^"'`]*[\uAC00-\uD7A3][^"'`]*)["'`]/g;
      let mm; while((mm = re.exec(txt))){ const s = mm[1].trim(); if (s.length>3 && /[\uAC00-\uD7A3]/.test(s)) candidates.push(s); }
    }
  }
  // uniq
  return Array.from(new Set(candidates)).slice(0,1000);
}

(async function main(){
  let sentences = gatherSentences();
  // Safety: limit to first N sentences for small sample runs
  sentences = sentences.slice(0, 3);
  if (!sentences.length){ console.error('No sentences found to generate.'); process.exit(1); }
  console.log('Found', sentences.length, 'sentences (showing up to 40):');
  sentences.slice(0,40).forEach((s,i)=> console.log(i+1, s));

  if (dry){
    console.log('\nDry run complete. No network calls made.');
    return;
  }

  const outDir = path.resolve(__dirname, '..', 'assets', 'audio');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive:true });

  for (const s of sentences){
    const slug = sha1Hex(`${s}|shimmer|1.0`);
    const outPath = path.join(outDir, slug + '.mp3');
    if (fs.existsSync(outPath)) { console.log('Exists:', outPath); continue; }
    console.log('Would request TTS for:', s.slice(0,60));
    if (dry) continue;
    console.log('Requesting TTS for:', s.slice(0,60));
    try{
      const resp = await fetch(endpoint, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ text:s, voice:'shimmer', speed:1.0 }) });
      if (!resp.ok){ console.error('TTS request failed', resp.status); continue; }
      const data = await resp.json();
      const b64 = (data.audioBase64 || data.audioData || '').split(',').pop();
      const buf = Buffer.from(b64, 'base64');
      fs.writeFileSync(outPath, buf);
      console.log('Wrote', outPath);
    }catch(e){ console.error('Error requesting TTS', e); }
  }

  console.log('\nDone. Review /assets/audio and git-add as needed.');
})();
