const puppeteer = require('puppeteer');
const child = require('child_process');
const path = require('path');

(async ()=>{
  // start static server
  const server = child.spawn(process.execPath, [path.join(__dirname,'static-server.js')], { stdio:['ignore','pipe','pipe'], env: process.env });
  server.stdout.on('data', d=>process.stdout.write(d.toString()));
  await new Promise(res=>setTimeout(res, 500));

  const browser = await puppeteer.launch({ args:['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  // block requests to serverless functions to avoid making network calls
  await page.setRequestInterception(true);
  page.on('request', req=>{
    const url = req.url();
    if (url.includes('/.netlify/functions/')) return req.abort();
    return req.continue();
  });

  await page.goto('http://localhost:8080/index.html', { waitUntil:'networkidle2', timeout: 20000 });
  // wait for cards
  await page.waitForSelector('#cards section.card', { timeout: 10000 });
  // expand first card
  const card = await page.$('#cards section.card');
  await page.evaluate(el=>{
    // fake a result to show bars: set dataset and innerHTML
    const lenWrap = el.querySelector('[data-len-compare]');
    if (!lenWrap) return;
    const badge = lenWrap.querySelector('.duration-badge');
    if (badge) badge.textContent = 'TTS: 2.1s · 녹음: 3.4s';
    const tBar = lenWrap.querySelector('.len-bar-tts');
    const rBar = lenWrap.querySelector('.len-bar-rec');
    if (tBar) { tBar.style.left='35%'; tBar.style.width='30%'; tBar.title='TTS: 2.10s'; }
    if (rBar) { rBar.style.left='50%'; rBar.style.width='48%'; rBar.title='녹음: 3.40s'; }
  }, card);

  // small delay to allow fonts/styles
  await page.waitForTimeout(400);
  await card.screenshot({ path: path.join(__dirname,'pw_card_screenshot.png') });

  await browser.close();
  server.kill();
  console.log('screenshot saved to TESTS/pw_card_screenshot.png');
})();
