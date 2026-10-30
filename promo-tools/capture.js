const { chromium } = require('playwright');
const fs = require('fs');
const SITE = 'https://shniorstudio.vercel.app';
const OUT = 'promo';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function revealAll(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 250) { await page.evaluate(y => window.scrollTo(0, y), y); await sleep(120); }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(1500);
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(1500);
}
async function rects(page) {
  return page.evaluate(() => {
    const o = { pageH: document.documentElement.scrollHeight, w: innerWidth };
    for (const id of ['top', 'services', 'work', 'shorts-teaser', 'contact']) {
      const e = document.getElementById(id); if (!e) continue;
      const r = e.getBoundingClientRect(); o[id] = [r.left, r.top + scrollY, r.width, r.height];
    }
    return o;
  });
}

(async () => {
  const browser = await chromium.launch();
  const info = {};
  for (const [tag, vp, dpr, mobile] of [['m', { width: 430, height: 932 }, 2.5, true], ['d', { width: 1440, height: 900 }, 1.5, false]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, locale: 'he-IL' });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('introSeen', '1'); } catch (e) {} });
    const page = await ctx.newPage();
    await page.goto(SITE + '/', { waitUntil: 'networkidle', timeout: 90000 });
    await sleep(4000);
    await revealAll(page);
    await page.screenshot({ path: `${OUT}/${tag}_hero.png` });
    info[tag] = await rects(page);
    await page.screenshot({ path: `${OUT}/${tag}_full.png`, fullPage: true });
    // menu open
    await page.click('#menu-btn'); await sleep(1600);
    await page.screenshot({ path: `${OUT}/${tag}_menu.png` });
    await page.click('#menu-btn').catch(() => {}); await sleep(600);
    // shorts strip, frozen and unclipped
    const strip = await page.$('#shorts-teaser');
    if (strip) {
      await strip.scrollIntoViewIfNeeded(); await sleep(1500);
      await strip.screenshot({ path: `${OUT}/${tag}_shorts_strip.png` });
    }
    // shorts page
    await page.goto(SITE + '/shorts', { waitUntil: 'networkidle', timeout: 90000 }); await sleep(3500);
    await revealAll(page);
    await page.screenshot({ path: `${OUT}/${tag}_shorts_page.png` });
    await page.screenshot({ path: `${OUT}/${tag}_shorts_full.png`, fullPage: true });
    await ctx.close();
  }
  // intro as a frame sequence (real site animation), mobile
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    fs.mkdirSync(`${OUT}/intro`, { recursive: true });
    let n = 0; const t0 = Date.now(); const times = [];
    cdp.on('Page.screencastFrame', async f => {
      fs.writeFileSync(`${OUT}/intro/${String(n).padStart(4, '0')}.jpg`, Buffer.from(f.data, 'base64'));
      times.push(Date.now() - t0); n++;
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1, maxWidth: 1080, maxHeight: 2340 });
    await page.goto(SITE + '/', { waitUntil: 'commit' });
    await sleep(4500);
    await cdp.send('Page.stopScreencast');
    info.introTimes = times;
    await ctx.close();
  }
  // data + thumbnails
  const api = await (await fetch(SITE + '/api/shorts')).json().catch(() => ({ items: [] }));
  fs.writeFileSync(`${OUT}/shorts.json`, JSON.stringify(api));
  const site = await (await fetch('https://shnior-studio-default-rtdb.asia-southeast1.firebasedatabase.app/siteContent/portfolio.json')).json();
  const list = (Array.isArray(site) ? site : Object.values(site || {})).filter(Boolean);
  const ids = [];
  for (const p of list) { const m = String(p.youtubeEmbed || '').match(/(?:embed\/|v=|youtu\.be\/|shorts\/)([\w-]{11})/); if (m) ids.push({ id: m[1], title: p.title || '', cat: p.category || '' }); }
  fs.mkdirSync(`${OUT}/thumbs`, { recursive: true });
  for (const v of ids) {
    for (const q of ['maxresdefault', 'sddefault', 'hqdefault']) {
      const r = await fetch(`https://i.ytimg.com/vi/${v.id}/${q}.jpg`);
      if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > 3000) { fs.writeFileSync(`${OUT}/thumbs/${v.id}.jpg`, b); break; } }
    }
  }
  fs.mkdirSync(`${OUT}/sthumbs`, { recursive: true });
  for (const s of (api.items || []).slice(0, 30)) {
    for (const u of [`https://i.ytimg.com/vi/${s.id}/oardefault.jpg`, `https://i.ytimg.com/vi/${s.id}/oar2.jpg`, s.thumb, `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`]) {
      if (!u) continue; const r = await fetch(u).catch(() => null);
      if (r && r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > 3000) { fs.writeFileSync(`${OUT}/sthumbs/${s.id}.jpg`, b); break; } }
    }
  }
  info.portfolio = ids;
  fs.writeFileSync(`${OUT}/info.json`, JSON.stringify(info, null, 1));
  await browser.close();
})();
