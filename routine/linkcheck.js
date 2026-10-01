// Nightly LIVE link check (John, 1 Oct 2026): every page in the live sitemaps, every internal link on them.
// READ ONLY: GET requests and page loads only. Never submits, never logs in, never writes.
//
// Per page: loads with real content (a WordPress 404 can come back as 200 or 301, so the body is checked).
// Per internal link: redirects followed hop by hop, final URL recorded. Flags:
//   BROKEN        final page is a 4xx/5xx or a not-found page, or the link points at staging/test (401 for members)
//   WRONG-LANG    a link on a page in one language ends on a page in another (never send users to a foreign page)
//   WARN chain    more than one redirect hop
//   WARN section  a link that leaves its section (e.g. a Learn Hub link landing on a sales page)
// Nonzero control: a known-bad URL must be reported BROKEN every run, or the run itself is a blocker.
//
// Env:
//   GM_LIVE_BASE         default https://www.geneticmatrix.com
//   GM_CRAWL_KEY         secret header X-GM-Crawl-Key, sent ONLY to geneticmatrix.com hosts, for Joseph's
//                        Cloudflare skip rule. Without it Cloudflare challenges the browser (403).
//   GM_SITEHEALTH_WEBHOOK optional Slack incoming webhook (a bot in one channel), for the daily summary
//   GM_LINKCHECK_MAX_MIN time cap, default 300
//   GM_LINKCHECK_MAX_PAGES optional cap for test runs
//   GM_LINKCHECK_HEADED  1 = visible browser (local tests only)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.GM_LIVE_BASE || 'https://www.geneticmatrix.com').replace(/\/+$/, '');
const KEY = (process.env.GM_CRAWL_KEY || '').trim();
const MAX_MS = (Number(process.env.GM_LINKCHECK_MAX_MIN) || 300) * 60000;
const MAX_PAGES = Number(process.env.GM_LINKCHECK_MAX_PAGES) || Infinity;
const DELAY_MS = 400;                      // throttle between requests (bursts got 429s)
const LANGS = ['de', 'es', 'fr', 'it', 'nl', 'pt-pt', 'pt'];
const LIVE_HOST = /(^|\.)geneticmatrix\.com$/i;
const NON_LIVE_HOST = /(^|\.)(staginggm\.com|gmtxdev\.com)$/i;
const NOT_FOUND = /page not found|404 not found|nothing (was )?found|oops! that page can.?t be found|page you requested could not be found/i;
const CONTROL_BAD = BASE + '/gm-linkcheck-control-do-not-create/';

const started = Date.now();
const today = new Date().toISOString().slice(0, 10);
const OUT = path.join(__dirname, '..', 'findings', 'linkcheck', today);
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const timeLeft = () => MAX_MS - (Date.now() - started);

function langOf(u) {
  const segs = new URL(u).pathname.split('/').filter(Boolean);
  if (segs[0] === 'learn-hub' && LANGS.includes(segs[1])) return segs[1];
  return LANGS.includes(segs[0]) ? segs[0] : 'en';
}
function sectionOf(u) { const s = new URL(u).pathname.split('/').filter(Boolean); return s[0] && !LANGS.includes(s[0]) ? s[0] : (s[1] || ''); }
const norm = u => { const x = new URL(u); x.hash = ''; return x.toString(); };

let ctx, req;
const cache = new Map();   // url -> { hops, finalUrl, status, notFound, error }

// Follow redirects one hop at a time so the chain is recorded. GET, never POST.
async function resolve(url) {
  if (cache.has(url)) return cache.get(url);
  const hops = [];
  let cur = url, res = null, status = 0, body = '', error = '';
  for (let i = 0; i < 6; i++) {
    await sleep(DELAY_MS);
    const host = new URL(cur).hostname;
    const headers = KEY && LIVE_HOST.test(host) ? { 'X-GM-Crawl-Key': KEY } : {};
    let attempt = 0;
    while (true) {
      try { res = await req.get(cur, { headers, maxRedirects: 0, failOnStatusCode: false, timeout: 45000 }); }
      catch (e) { error = e.message.split('\n')[0]; res = null; }
      if (res && res.status() === 429 && attempt < 3) { attempt++; await sleep(15000 * attempt); continue; }
      break;
    }
    if (!res) break;
    status = res.status();
    const loc = res.headers()['location'];
    if (status >= 300 && status < 400 && loc) { const next = new URL(loc, cur).toString(); hops.push({ from: cur, status, to: next }); cur = next; continue; }
    if (LIVE_HOST.test(new URL(cur).hostname)) body = await res.text().catch(() => '');
    break;
  }
  const title = (body.match(/<title[^>]*>([^<]*)</i) || [])[1] || '';
  const h1 = (body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  const challenged = status === 403 && /cf-chl|challenge-platform|Just a moment/i.test(body);
  const out = { hops, finalUrl: cur, status, error, challenged, notFound: NOT_FOUND.test(title + ' ' + h1.replace(/<[^>]+>/g, ' ')) };
  cache.set(url, out);
  return out;
}

async function sitemapPages() {
  const seen = new Set(), pages = [];
  const queue = [BASE + '/sitemap_index.xml'];
  while (queue.length) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    await sleep(DELAY_MS);
    const r = await req.get(u, { headers: KEY ? { 'X-GM-Crawl-Key': KEY } : {}, failOnStatusCode: false, timeout: 60000 }).catch(() => null);
    const body = r ? await r.text() : '';
    if (!r || r.status() !== 200) { pages.sitemapError = `${u}: ${r ? r.status() : 'no response'}${/cf-chl|Just a moment/i.test(body) ? ' (Cloudflare challenge)' : ''}`; continue; }
    for (const m of body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) (/\.xml(\?|$)/.test(m[1]) ? queue : pages).push(m[1].replace(/&amp;/g, '&'));
  }
  const uniq = [...new Set(pages)];
  uniq.sitemapError = pages.sitemapError;
  return uniq;
}

(async () => {
  const results = { date: today, startedAt: new Date(started).toISOString(), runId: process.env.GITHUB_RUN_ID || 'local', base: BASE, pages: 0, links: 0, broken: [], wrongLang: [], warnings: [], pageProblems: [], notCovered: [], blockers: [] };
  let browser;
  try {
    browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge', headless: process.env.GM_LINKCHECK_HEADED !== '1' } : { headless: true });
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (KEY) await ctx.route('**/*', route => {   // the key goes to live hosts only, never to third parties
      let host = ''; try { host = new URL(route.request().url()).hostname; } catch {}
      if (LIVE_HOST.test(host)) route.continue({ headers: { ...route.request().headers(), 'X-GM-Crawl-Key': KEY } });
      else route.continue();
    });
    req = ctx.request;

    // Nonzero control first: if the checker cannot see a broken page, nothing else it says counts.
    const ctl = await resolve(CONTROL_BAD);
    results.control = { url: CONTROL_BAD, status: ctl.status, notFound: ctl.notFound, challenged: ctl.challenged };
    if (ctl.challenged) results.blockers.push('Cloudflare challenged the checker (403): no page could be checked. Needs the X-GM-Crawl-Key skip rule on live.');
    else if (!(ctl.status >= 400 || ctl.notFound)) results.blockers.push(`Control URL ${CONTROL_BAD} did NOT read as broken (status ${ctl.status}): the not-found detection is not working, so this run proves nothing.`);

    const pages = results.blockers.length ? [] : (await sitemapPages()).slice(0, MAX_PAGES);
    if (!results.blockers.length && !pages.length) results.blockers.push(`No pages found in the sitemaps${pages.sitemapError ? ': ' + pages.sitemapError : ''}.`);
    const page = await ctx.newPage();
    for (const p of pages) {
      if (timeLeft() < 120000) { results.notCovered.push(`Out of time after ${results.pages} of ${pages.length} pages.`); break; }
      await sleep(DELAY_MS);
      const r = await page.goto(p, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => null);
      results.pages++;
      const status = r ? r.status() : 0;
      const finalUrl = page.url();
      const text = await page.evaluate(() => (document.title + ' ' + ((document.querySelector('h1') || {}).innerText || '') + ' ' + (document.body ? document.body.innerText.length : 0))).catch(() => '');
      if (!r || status >= 400 || NOT_FOUND.test(text)) { results.pageProblems.push({ page: p, status, finalUrl, why: !r ? 'no response' : status >= 400 ? `HTTP ${status}` : 'not-found page' }); continue; }
      if (norm(finalUrl) !== norm(p)) results.warnings.push({ type: 'sitemap-redirect', page: p, finalUrl });
      const hrefs = await page.$$eval('a[href]', as => as.map(a => a.href)).catch(() => []);
      const pageLang = langOf(p), pageSection = sectionOf(p);
      for (const h of [...new Set(hrefs)]) {
        let u; try { u = new URL(h); } catch { continue; }
        if (!/^https?:$/.test(u.protocol)) continue;
        if (NON_LIVE_HOST.test(u.hostname)) { results.broken.push({ page: p, link: h, why: `links to non-live host ${u.hostname} (members get 401 or a login page)` }); continue; }
        if (!LIVE_HOST.test(u.hostname)) continue;   // external sites are out of scope
        results.links++;
        const t = await resolve(norm(h));
        if (t.challenged) { results.notCovered.push(`Cloudflare challenged ${h}`); continue; }
        if (t.error || t.status >= 400 || t.notFound) { results.broken.push({ page: p, link: h, finalUrl: t.finalUrl, status: t.status, why: t.error || (t.notFound ? 'ends on a not-found page' : `HTTP ${t.status}`) }); continue; }
        const finalLang = langOf(t.finalUrl);
        if (finalLang !== pageLang && langOf(h) === pageLang) results.wrongLang.push({ page: p, pageLang, link: h, finalUrl: t.finalUrl, finalLang });
        if (t.hops.length > 1) results.warnings.push({ type: 'chain', page: p, link: h, hops: t.hops.length, finalUrl: t.finalUrl });
        if (t.hops.length && sectionOf(h) && sectionOf(t.finalUrl) !== sectionOf(h)) results.warnings.push({ type: 'section', page: p, link: h, finalUrl: t.finalUrl, from: sectionOf(h), to: sectionOf(t.finalUrl) });
      }
    }
  } catch (e) {
    results.blockers.push('Run crashed: ' + e.message.split('\n')[0]);
  } finally {
    if (browser) await browser.close().catch(() => {});
    results.durationMin = Math.round((Date.now() - started) / 60000);
    // One line per broken link target, with the pages that carry it, so the list is fixable, not noisy.
    const group = (arr, key) => Object.values(arr.reduce((m, x) => { const k = x[key]; (m[k] = m[k] || { ...x, pages: [] }).pages.push(x.page); return m; }, {}));
    const broken = group(results.broken, 'link'), wrong = group(results.wrongLang, 'link');
    const warns = results.warnings.length;
    const head = results.blockers.length
      ? `LIVE link check ${today}: BLOCKED. ${results.blockers.join(' ')}`
      : `LIVE link check ${today}: ${results.pages} pages, ${results.links} internal links. ${broken.length} broken, ${wrong.length} wrong-language, ${results.pageProblems.length} page problems, ${warns} warnings. Control URL detected as broken: yes.`;
    const md = [`# ${head}`, '', `Run ${results.runId}, started ${results.startedAt}, ${results.durationMin} min.`, '',
      '## Broken links', '', ...(broken.length ? broken.map(b => `- ${b.link} -> ${b.finalUrl || ''} (${b.why}) on ${b.pages.length} page(s), e.g. ${b.pages[0]}`) : ['None.']), '',
      '## Wrong language', '', ...(wrong.length ? wrong.map(w => `- ${w.link} on a ${w.pageLang} page ends on ${w.finalUrl} (${w.finalLang}), ${w.pages.length} page(s), e.g. ${w.pages[0]}`) : ['None.']), '',
      '## Pages that do not load', '', ...(results.pageProblems.length ? results.pageProblems.map(x => `- ${x.page}: ${x.why} (${x.finalUrl})`) : ['None.']), '',
      '## Warnings (for a human to judge)', '', ...(warns ? results.warnings.slice(0, 300).map(w => `- ${w.type}: ${w.link || w.page} -> ${w.finalUrl}${w.hops ? ` (${w.hops} hops)` : ''}${w.to !== undefined ? ` (${w.from} to ${w.to})` : ''}`) : ['None.']), '',
      ...(results.notCovered.length ? ['## Not covered', '', ...[...new Set(results.notCovered)].slice(0, 50).map(n => `- ${n}`), ''] : [])].join('\n');
    fs.writeFileSync(path.join(OUT, 'summary.md'), md);
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    console.log(md.slice(0, 4000));
    const hook = (process.env.GM_SITEHEALTH_WEBHOOK || '').trim();
    if (hook) {
      const lines = [head, ...broken.slice(0, 15).map(b => `• BROKEN ${b.link} (${b.why}), ${b.pages.length} page(s)`), ...wrong.slice(0, 10).map(w => `• WRONG LANGUAGE ${w.link} on ${w.pageLang} pages ends on ${w.finalLang}`)];
      if (broken.length > 15 || wrong.length > 10) lines.push('Full list in gm-testing findings/linkcheck/' + today + '/summary.md');
      await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: lines.join('\n') }) }).catch(() => {});
    }
    process.exitCode = results.blockers.length || broken.length || wrong.length || results.pageProblems.length ? 1 : 0;
  }
})();
