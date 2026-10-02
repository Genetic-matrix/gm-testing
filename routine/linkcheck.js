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
const DELAY_MS = 250;                      // per-worker pause between requests
const WORKERS = Number(process.env.GM_LINKCHECK_WORKERS) || 4;   // parallel fetchers (39k pages do not fit one-at-a-time)
let challengedCount = 0, firstChallengeAfter = null;
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
async function resolve(url, keepBody) {
  if (cache.has(url) && !keepBody) return cache.get(url);
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
    if (status >= 300 && status < 400 && !loc) break;
    break;
  }
  const title = (body.match(/<title[^>]*>([^<]*)</i) || [])[1] || '';
  const h1 = (body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  const challenged = (status === 403 || status === 503) && (/cf-chl|challenge-platform|Just a moment/i.test(body) || /__cf_chl/.test(cur));
  if (challenged) { challengedCount++; if (firstChallengeAfter === null) firstChallengeAfter = cache.size; }
  const out = { hops, finalUrl: cur, status, error, challenged, notFound: NOT_FOUND.test(title + ' ' + h1.replace(/<[^>]+>/g, ' ')) };
  if (keepBody) { const o2 = { ...out, body }; cache.set(url, out); return o2; }
  cache.set(url, out);
  return out;
}

function groupOf(sitemapUrl) {
  const f = sitemapUrl.split('/').pop();
  if (/celebrit/i.test(f)) return 'celeb';
  if (/categor/i.test(f)) return 'category';
  if (/calendar/i.test(f)) return 'calendar';
  return 'core';
}
// Deterministic shuffle seeded by the date, so a night's sample is reproducible from its date.
function seeded(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const SAMPLE_PER_GROUP_LANG = Number(process.env.GM_LINKCHECK_SAMPLE) || 150;
const SLICE = Number(process.env.GM_LINKCHECK_SLICE) || 40000;
function coveragePlan(all) {
  const core = [], heavy = [], byGL = {};
  for (const p of all) {
    const g = pageGroup.get(p) || 'core';
    if (g === 'core' || g === 'calendar') core.push(p);
    else { heavy.push(p); const k = g + ':' + langOf(p); (byGL[k] = byGL[k] || []).push(p); }
  }
  const day = Math.floor(Date.parse(today) / 86400000);
  const rnd = seeded(day);
  const sample = [];
  for (const k of Object.keys(byGL).sort()) {
    const arr = byGL[k];
    for (let i = 0; i < Math.min(SAMPLE_PER_GROUP_LANG, arr.length); i++) sample.push(arr[Math.floor(rnd() * arr.length)]);
  }
  const slices = Math.max(1, Math.ceil(heavy.length / SLICE));
  const k = day % slices;
  const slice = heavy.slice(k * SLICE, (k + 1) * SLICE);
  const pages = [...new Set([...core, ...sample, ...slice])];
  return { pages, stats: { core: core.length, sample: new Set(sample).size, slice: `${k + 1} of ${slices} (${slice.length} pages)`, fullCycleNights: slices, planned: pages.length } };
}

// Find the sitemaps the way search engines do: robots.txt "Sitemap:" lines first, then the usual WordPress
// addresses. Every fetch is logged, so a run that finds nothing says exactly why.
const pageGroup = new Map();   // url -> 'celeb' | 'category' | 'calendar' | 'core', from the sitemap it came from
async function sitemapPages(log) {
  const H = KEY ? { 'X-GM-Crawl-Key': KEY } : {};
  const get = async u => {
    await sleep(DELAY_MS);
    const r = await req.get(u, { headers: H, failOnStatusCode: false, timeout: 60000 }).catch(e => ({ err: e.message.split('\n')[0] }));
    if (r.err) { log.push(`${u}: ${r.err}`); return null; }
    const body = await r.text().catch(() => '');
    log.push(`${u}: ${r.status()} ${(r.headers()['content-type'] || '').split(';')[0]} ${body.length} bytes${/cf-chl|Just a moment/i.test(body) ? ' (Cloudflare challenge)' : ''}${r.status() === 200 && !/<loc>/i.test(body) && !/^Sitemap:/im.test(body) ? ' (no <loc> entries) starts: ' + body.slice(0, 80).replace(/\s+/g, ' ') : ''}`);
    return r.status() === 200 ? body : null;
  };
  const queue = [];
  const robots = await get(BASE + '/robots.txt');
  if (robots) for (const m of robots.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) queue.push(m[1]);
  queue.push(BASE + '/sitemap_index.xml', BASE + '/sitemap.xml', BASE + '/wp-sitemap.xml');
  const seen = new Set(), pages = [];
  while (queue.length && seen.size < 500) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    const body = await get(u);
    if (!body) continue;
    let nLoc = 0, nAlt = 0;
    for (const m of body.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)/gi)) {
      const loc = m[1].replace(/&amp;/g, '&');
      if (/\.xml(\.gz)?(\?|$)/i.test(loc)) queue.push(loc); else { pages.push(loc); nLoc++; if (!pageGroup.has(loc)) pageGroup.set(loc, groupOf(u)); }
    }
    // Other languages are often listed as hreflang alternates inside each <url>, not as their own <loc>.
    for (const m of body.matchAll(/<xhtml:link[^>]*\shref=["']([^"']+)["']/gi)) { const a = m[1].replace(/&amp;/g, '&'); pages.push(a); nAlt++; if (!pageGroup.has(a)) pageGroup.set(a, groupOf(u)); }
    if (nLoc || nAlt) log.push(`  ${u.split('/').pop()}: ${nLoc} <loc>, ${nAlt} alternates`);
  }
  return [...new Set(pages)];
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

    results.sitemapLog = [];
    const allPages = results.blockers.length ? [] : await sitemapPages(results.sitemapLog);
    results.sitemapUnique = allPages.length;
    const byLang = {}; for (const p of allPages) { const l = langOf(p); byLang[l] = (byLang[l] || 0) + 1; }
    results.sitemapByLang = byLang;
    const plan = coveragePlan(allPages);
    results.coverage = plan.stats;
    const ex = {}; for (const p of allPages) { const g = pageGroup.get(p) || 'core'; (ex[g] = ex[g] || []); if (ex[g].length < 8) ex[g].push(p); }
    results.examples = ex;
    const pages = process.env.GM_LINKCHECK_SITEMAP_ONLY === '1' ? [] : plan.pages.slice(0, MAX_PAGES);
    if (!results.blockers.length && !allPages.length) results.blockers.push(`No pages found in the sitemaps. Tried: ${results.sitemapLog.join(' | ')}`);
    const htmlOf = new Map();
    // Fetch a page with a plain GET (the same hop-by-hop resolve as links), keeping its HTML for link parsing.
    const fetchPage = async p => {
      return resolve(norm(p), true);
    };
    let idx = 0, stop = false;
    const worker = async () => {
      while (!stop && idx < pages.length) {
        if (timeLeft() < 120000) { stop = true; results.notCovered.push(`Out of time after ${results.pages} of ${pages.length} pages.`); break; }
        const p = pages[idx++];
        const t = await fetchPage(p);
        if (t.challenged) {
          // A challenge means Cloudflare is blocking the checker, not that the page is broken: stop and report it.
          if (challengedCount >= 5) { stop = true; results.blockers.push(`Cloudflare started challenging the checker after ${results.pages} pages (403 challenge). The X-GM-Crawl-Key rule must also skip rate limiting and bot scoring.`); }
          continue;
        }
        results.pages++;
        if (t.error || t.status >= 400 || t.notFound) { results.pageProblems.push({ page: p, status: t.status, finalUrl: t.finalUrl, why: t.error || (t.notFound ? 'not-found page' : `HTTP ${t.status}`) }); continue; }
        if (norm(t.finalUrl) !== norm(p)) results.warnings.push({ type: 'sitemap-redirect', page: p, finalUrl: t.finalUrl });
        const html = t.body || '';
        const hrefs = [...html.matchAll(/<a\s[^>]*href=["']([^"'#][^"']*)["']/gi)].map(m => { try { return new URL(m[1].replace(/&amp;/g, '&'), t.finalUrl).toString(); } catch { return null; } }).filter(Boolean);
        const pageLang = langOf(p);
        for (const h of [...new Set(hrefs)]) {
          let u; try { u = new URL(h); } catch { continue; }
          if (!/^https?:$/.test(u.protocol)) continue;
          if (NON_LIVE_HOST.test(u.hostname)) { results.broken.push({ page: p, link: h, why: `links to non-live host ${u.hostname} (members get 401 or a login page)` }); continue; }
          if (!LIVE_HOST.test(u.hostname)) continue;
          if (/\/wp-login\.php|loginSocial=|\/wp-admin\/|\/feed\/?$|\/cdn-cgi\//.test(u.pathname + u.search)) continue;   // logins, admin, feeds, Cloudflare: not content links
          results.links++;
          const r2 = await resolve(norm(h));
          if (r2.challenged) continue;
          const offSite = !LIVE_HOST.test(new URL(r2.finalUrl).hostname);
          if (offSite) continue;   // a link that redirects to another site is out of scope
          if (r2.error || r2.status >= 400 || r2.notFound) { results.broken.push({ page: p, link: h, finalUrl: r2.finalUrl, status: r2.status, why: r2.error || (r2.notFound ? 'ends on a not-found page' : `HTTP ${r2.status}`) }); continue; }
          const finalLang = langOf(r2.finalUrl);
          if (finalLang !== pageLang && langOf(h) === pageLang) results.wrongLang.push({ page: p, pageLang, link: h, finalUrl: r2.finalUrl, finalLang });
          if (r2.hops.length > 1) results.warnings.push({ type: 'chain', page: p, link: h, hops: r2.hops.length, finalUrl: r2.finalUrl });
          if (r2.hops.length && sectionOf(h) && sectionOf(r2.finalUrl) !== sectionOf(h)) results.warnings.push({ type: 'section', page: p, link: h, finalUrl: r2.finalUrl, from: sectionOf(h), to: sectionOf(r2.finalUrl) });
        }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
  } catch (e) {
    results.blockers.push('Run crashed: ' + e.message.split('\n')[0]);
  } finally {
    if (browser) await browser.close().catch(() => {});
    results.durationMin = Math.round((Date.now() - started) / 60000);
    // One line per broken link target, with the pages that carry it, so the list is fixable, not noisy.
    const group = (arr, key) => Object.values(arr.reduce((m, x) => { const k = x[key]; (m[k] = m[k] || { ...x, pages: [] }).pages.push(x.page); return m; }, {}));
    const broken = group(results.broken, 'link'), wrong = group(results.wrongLang, 'link');
    const warns = results.warnings.length;
    const countOnly = process.env.GM_LINKCHECK_SITEMAP_ONLY === '1';
    const head = countOnly
      ? `LIVE sitemap COUNT ONLY ${today} (no pages checked): sitemaps list ${results.sitemapUnique} unique pages.`
      : results.blockers.length
      ? `LIVE link check ${today}: BLOCKED. ${results.blockers.join(' ')}`
      : `LIVE link check ${today}: ${results.pages} pages, ${results.links} internal links. ${broken.length} broken, ${wrong.length} wrong-language, ${results.pageProblems.length} page problems, ${warns} warnings. Control URL detected as broken: yes.`;
    const md = [`# ${head}`, '', `Run ${results.runId}, started ${results.startedAt}, ${results.durationMin} min. Tonight: ${results.coverage ? `${results.coverage.core} core pages in full, ${results.coverage.sample} sampled celebrity/category pages, rotating slice ${results.coverage.slice}; every page covered every ${results.coverage.fullCycleNights} nights.` : ''} Sitemaps list ${results.sitemapUnique ?? '?'} unique pages: ${Object.entries(results.sitemapByLang || {}).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '',
      '## Broken links', '', ...(broken.length ? broken.map(b => `- ${b.link} -> ${b.finalUrl || ''} (${b.why}) on ${b.pages.length} page(s), e.g. ${b.pages[0]}`) : ['None.']), '',
      '## Wrong language', '', ...(wrong.length ? wrong.map(w => `- ${w.link} on a ${w.pageLang} page ends on ${w.finalUrl} (${w.finalLang}), ${w.pages.length} page(s), e.g. ${w.pages[0]}`) : ['None.']), '',
      '## Pages that do not load', '', ...(results.pageProblems.length ? results.pageProblems.map(x => `- ${x.page}: ${x.why} (${x.finalUrl})`) : ['None.']), '',
      '## Warnings (for a human to judge)', '', ...(warns ? results.warnings.slice(0, 300).map(w => `- ${w.type}: ${w.link || w.page} -> ${w.finalUrl}${w.hops ? ` (${w.hops} hops)` : ''}${w.to !== undefined ? ` (${w.from} to ${w.to})` : ''}`) : ['None.']), '',
      ...(results.sitemapLog && results.sitemapLog.length ? ['## Sitemaps read', '', ...results.sitemapLog.slice(0, 60).map(x => `- ${x}`), ''] : []),
      ...(results.notCovered.length ? ['## Not covered', '', ...[...new Set(results.notCovered)].slice(0, 50).map(n => `- ${n}`), ''] : [])].join('\n');
    fs.writeFileSync(path.join(OUT, 'summary.md'), md);
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    console.log(md.slice(0, 4000));
    const hook = (process.env.GM_SITEHEALTH_WEBHOOK || '').trim();
    if (hook && !countOnly) {   // a counting run checks nothing, so it never posts a result
      const lines = [head, ...broken.slice(0, 15).map(b => `• BROKEN ${b.link} (${b.why}), ${b.pages.length} page(s)`), ...wrong.slice(0, 10).map(w => `• WRONG LANGUAGE ${w.link} on ${w.pageLang} pages ends on ${w.finalLang}`)];
      if (broken.length > 15 || wrong.length > 10) lines.push('Full list in gm-testing findings/linkcheck/' + today + '/summary.md');
      await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: lines.join('\n') }) }).catch(() => {});
    }
    process.exitCode = results.blockers.length || broken.length || wrong.length || results.pageProblems.length ? 1 : 0;
  }
})();
