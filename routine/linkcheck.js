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
const LANGS = ['de', 'es', 'fr', 'it', 'nl', 'pt-pt', 'pt', 'hi'];   // hi = Astro Calendar only (John, 2 Oct)
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
  let cur = url, res = null, status = 0, body = '', error = '', robotsHeader = '';
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
    robotsHeader = res.headers()['x-robots-tag'] || '';
    break;
  }
  const bodyNc = body.replace(/<!--[\s\S]*?-->/g, '');
  const title = (bodyNc.match(/<title[^>]*>([^<]*)</i) || [])[1] || '';
  const h1 = (bodyNc.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  const challenged = (status === 403 || status === 503) && (/cf-chl|challenge-platform|Just a moment/i.test(body) || /__cf_chl/.test(cur));
  if (challenged) { challengedCount++; if (firstChallengeAfter === null) firstChallengeAfter = cache.size; }
  const out = { hops, finalUrl: cur, status, error, challenged, notFound: NOT_FOUND.test(title + ' ' + h1.replace(/<[^>]+>/g, ' ')) };
  if (keepBody) { const o2 = { ...out, body, robotsHeader }; cache.set(url, out); return o2; }
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
// hreflang code -> the language the URL prefix should show (langOf); x-default is skipped.
const HREFLANG_TO_LANG = { en: 'en', de: 'de', es: 'es', fr: 'fr', it: 'it', nl: 'nl', 'pt-pt': 'pt-pt', pt: 'pt-pt', 'pt-PT': 'pt-pt', hi: 'hi' };
const seo = { errors: [], warnings: [], titles: new Map(), checked: 0 };
const attr = (tag, name) => { const m = tag.match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', 'i')); return m ? m[1] : null; };
function seoCheck(page, finalUrl, html, robotsHeader) {
  seo.checked++;
  // Strip HTML comments first: a commented-out <title> in header-tailwind.php fooled the first version (F-019, withdrawn 2 Oct).
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [html.slice(0, 60000)])[0];
  const pageLang = langOf(finalUrl);
  const err = (type, detail) => seo.errors.push({ type, page, detail });
  const warn = (type, detail) => seo.warnings.push({ type, page, detail });
  // noindex: a page in the sitemap must not tell Google to ignore it.
  const robotsMeta = [...head.matchAll(/<meta[^>]+>/gi)].map(m => m[0]).filter(t => /name\s*=\s*["'](robots|googlebot)["']/i.test(t)).map(t => attr(t, 'content') || '').join(' ');
  if (/noindex/i.test(robotsMeta + ' ' + robotsHeader)) err('noindex', `listed in the sitemap but says noindex (${(robotsMeta || robotsHeader).trim()})`);
  // canonical
  const canonTag = [...head.matchAll(/<link[^>]+>/gi)].map(m => m[0]).find(t => /rel\s*=\s*["']canonical["']/i.test(t));
  const canon = canonTag ? attr(canonTag, 'href') : null;
  if (!canon) warn('canonical-missing', 'no canonical tag');
  else {
    let cu; try { cu = new URL(canon, finalUrl).toString(); } catch { cu = canon; }
    if (langOf(cu) !== pageLang) err('canonical-language', `canonical points to another language: ${cu}`);
    else if (/\/celebrity\/(-[^/]*|[^/]*-|[^/]*--[^/]*)\//.test(new URL(cu).pathname)) err('canonical-unclean-slug', `canonical uses an unclean celebrity slug (stray or double hyphen, F-018): ${cu}`);
    else if (norm(cu).replace(/\/$/, '') !== norm(finalUrl).replace(/\/$/, '')) err('canonical-elsewhere', `canonical points to a different page: ${cu}`);
  }
  // hreflang alternates: each must point to a page in that language, and the page should list itself.
  const alts = [...head.matchAll(/<link[^>]+>/gi)].map(m => m[0]).filter(t => /rel\s*=\s*["']alternate["']/i.test(t) && /hreflang/i.test(t)).map(t => ({ code: attr(t, 'hreflang') || '', href: attr(t, 'href') || '' }));
  if (alts.length) {
    let self = false;
    for (const a of alts) {
      if (/x-default/i.test(a.code)) continue;
      const want = HREFLANG_TO_LANG[a.code] || HREFLANG_TO_LANG[a.code.toLowerCase()];
      let au; try { au = new URL(a.href, finalUrl).toString(); } catch { continue; }
      if (want && langOf(au) !== want) err('hreflang-mismatch', `hreflang="${a.code}" points to a ${langOf(au)} page: ${au}`);
      if (norm(au).replace(/\/$/, '') === norm(finalUrl).replace(/\/$/, '')) self = true;
    }
    if (!self) warn('hreflang-no-self', 'hreflang alternates do not include the page itself');
  }
  // <html lang> must match the address language.
  const hl = ((html.match(/<html[^>]*\slang\s*=\s*["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
  if (!hl) warn('html-lang-missing', 'no lang attribute on <html>');
  else { const want = HREFLANG_TO_LANG[hl] || HREFLANG_TO_LANG[hl.split('-')[0]] || hl.split('-')[0]; if (want !== pageLang && !(pageLang === 'pt-pt' && hl.startsWith('pt'))) err('html-lang-mismatch', `<html lang="${hl}"> on a ${pageLang} address`); }
  // title
  const title = ((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
  if (!title) err('title-missing', 'no <title>');
  else { const k = pageLang + '|' + title; if (seo.titles.has(k)) warn('title-duplicate', `same title as ${seo.titles.get(k)}: "${title.slice(0, 80)}"`); else if (seo.titles.size < 300000) seo.titles.set(k, page); }
}

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

    // Spot-check mode: check exactly these addresses (comma-separated), nothing else.
    const probe = (process.env.GM_LINKCHECK_URLS || '').split(',').map(x => x.trim()).filter(Boolean);
    if (probe.length && !results.blockers.length) {
      results.probe = [];
      for (const u of probe) {
        const t = await resolve(norm(u.startsWith('http') ? u : BASE + u), true);
        if (t.body) t.body = t.body.replace(/<!--[\s\S]*?-->/g, '');
        const canon = ((t.body || '').match(/<link[^>]+rel=["']canonical["'][^>]*>/i) || [''])[0].match(/href=["']([^"']+)["']/i);
        const title = (((t.body || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
        results.probe.push({ url: u, status: t.status, hops: t.hops.map(h => `${h.status} -> ${h.to}`), finalUrl: t.finalUrl, notFound: t.notFound, challenged: t.challenged, canonical: canon ? canon[1] : null, title: title.slice(0, 90) });
      }
      const md = ['# Spot check ' + today, '', '| Address | Result | Redirects | Canonical | Title |', '|---|---|---|---|---|',
        ...results.probe.map(r => `| ${r.url} | ${r.challenged ? 'CLOUDFLARE CHALLENGE' : r.notFound ? 'NOT FOUND page' : 'HTTP ' + r.status} | ${r.hops.join(' / ') || 'none'} | ${r.canonical || '-'} | ${r.title.replace(/\|/g, '/')} |`), ''].join('\n');
      fs.writeFileSync(path.join(OUT, 'spotcheck.md'), md);
      console.log(md);
      await browser.close().catch(() => {});
      process.exit(0);
    }
    results.sitemapLog = [];
    const allPages = results.blockers.length ? [] : await sitemapPages(results.sitemapLog);
    results.sitemapUnique = allPages.length;
    const byLang = {}; for (const p of allPages) { const l = langOf(p); byLang[l] = (byLang[l] || 0) + 1; }
    results.sitemapByLang = byLang;
    const plan = coveragePlan(allPages);
    results.coverage = plan.stats;
    const ex = {}; for (const p of allPages) { const g = pageGroup.get(p) || 'core'; (ex[g] = ex[g] || []); if (ex[g].length < 8) ex[g].push(p); }
    results.examples = ex;
    // Celebrity slugs with a stray trailing hyphen (e.g. /celebrity/ali-a-/), counted per celebrity (one slug serves 7 calc pages x 7 languages).
    const badSlugs = new Map();
    for (const p of allPages) {
      const m = new URL(p).pathname.match(/\/celebrity\/([^/]+)\//);
      if (m && /-$/.test(m[1])) { const sl = m[1]; badSlugs.set(sl, (badSlugs.get(sl) || 0) + 1); }
    }
    const fixed = new Set([...badSlugs.keys()].map(x => x.replace(/-+$/, '')));
    const allSlugs = new Set(); for (const p of allPages) { const m = new URL(p).pathname.match(/\/celebrity\/([^/]+)\//); if (m) allSlugs.add(m[1]); }
    const clashes = [...badSlugs.keys()].filter(x => allSlugs.has(x.replace(/-+$/, '')));
    results.trailingHyphenSlugs = { celebrities: badSlugs.size, pages: [...badSlugs.values()].reduce((a, b) => a + b, 0), clashWithExisting: clashes.length, clashExamples: clashes.slice(0, 20), examples: [...badSlugs.keys()].slice(0, 40) };
    fs.writeFileSync(path.join(OUT, 'trailing-hyphen-slugs.txt'), [...badSlugs.keys()].sort().join('\n') + '\n');
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
        seoCheck(p, t.finalUrl, html, t.robotsHeader || '');
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
      : `LIVE link check ${today}: ${results.pages} pages, ${results.links} internal links. ${broken.length} broken, ${wrong.length} wrong-language, ${results.pageProblems.length} page problems, ${seo.errors.length} SEO errors, ${warns} warnings. Control URL detected as broken: yes.`;
    const md = [`# ${head}`, '', `Run ${results.runId}, started ${results.startedAt}, ${results.durationMin} min. Tonight: ${results.coverage ? `${results.coverage.core} core pages in full, ${results.coverage.sample} sampled celebrity/category pages, rotating slice ${results.coverage.slice}; every page covered every ${results.coverage.fullCycleNights} nights.` : ''} Celebrity slugs ending in a hyphen: ${results.trailingHyphenSlugs ? `${results.trailingHyphenSlugs.celebrities} celebrities, ${results.trailingHyphenSlugs.pages} pages, ${results.trailingHyphenSlugs.clashWithExisting} would clash with an existing slug if trimmed` : '?'}. Sitemaps list ${results.sitemapUnique ?? '?'} unique pages: ${Object.entries(results.sitemapByLang || {}).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '',
      '## Broken links', '', ...(broken.length ? broken.map(b => `- ${b.link} -> ${b.finalUrl || ''} (${b.why}) on ${b.pages.length} page(s), e.g. ${b.pages[0]}`) : ['None.']), '',
      '## Wrong language', '', ...(wrong.length ? wrong.map(w => `- ${w.link} on a ${w.pageLang} page ends on ${w.finalUrl} (${w.finalLang}), ${w.pages.length} page(s), e.g. ${w.pages[0]}`) : ['None.']), '',
      '## Pages that do not load', '', ...(results.pageProblems.length ? results.pageProblems.map(x => `- ${x.page}: ${x.why} (${x.finalUrl})`) : ['None.']), '',
      '## Warnings (for a human to judge)', '', ...(warns ? results.warnings.slice(0, 300).map(w => `- ${w.type}: ${w.link || w.page} -> ${w.finalUrl}${w.hops ? ` (${w.hops} hops)` : ''}${w.to !== undefined ? ` (${w.from} to ${w.to})` : ''}`) : ['None.']), '',
      '## SEO', '', `${seo.checked} pages checked. Errors: ${Object.entries(seo.errors.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {})).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}. Warnings: ${Object.entries(seo.warnings.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {})).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`, '',
      ...Object.values(seo.errors.reduce((m, e) => { (m[e.type] = m[e.type] || []).push(e); return m; }, {})).flatMap(list => list.slice(0, 10).map(e => `- ERROR ${e.type}: ${e.page}: ${e.detail}`)), '',
      ...(results.sitemapLog && results.sitemapLog.length ? ['## Sitemaps read', '', ...results.sitemapLog.slice(0, 60).map(x => `- ${x}`), ''] : []),
      ...(results.notCovered.length ? ['## Not covered', '', ...[...new Set(results.notCovered)].slice(0, 50).map(n => `- ${n}`), ''] : [])].join('\n');
    fs.writeFileSync(path.join(OUT, 'summary.md'), md);
    results.seo = { checked: seo.checked, errors: seo.errors.slice(0, 5000), warnings: seo.warnings.slice(0, 5000), errorCount: seo.errors.length, warningCount: seo.warnings.length };
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    console.log(md.slice(0, 4000));
    const hook = (process.env.GM_SITEHEALTH_WEBHOOK || '').trim();
    if (hook && !countOnly) {   // a counting run checks nothing, so it never posts a result
      const lines = [head, ...broken.slice(0, 15).map(b => `• BROKEN ${b.link} (${b.why}), ${b.pages.length} page(s)`), ...wrong.slice(0, 10).map(w => `• WRONG LANGUAGE ${w.link} on ${w.pageLang} pages ends on ${w.finalLang}`)];
      if (broken.length > 15 || wrong.length > 10) lines.push('Full list in gm-testing findings/linkcheck/' + today + '/summary.md');
      await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: lines.join('\n') }) }).catch(() => {});
    }
    process.exitCode = results.blockers.length || broken.length || wrong.length || results.pageProblems.length || seo.errors.length ? 1 : 0;
  }
})();
