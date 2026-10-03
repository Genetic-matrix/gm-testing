// Nightly READ-ONLY check of the LIVE hub, logged in as the live QA accounts (John, 2 Oct 2026).
// Red-teamed 2 Oct; every fix below is marked RT<n>.
//
// SAFETY (RT1, RT2, RT4): deny by default. On ANY host, every request that is not GET/HEAD/OPTIONS is
// aborted and reported, except an exact allowlist that changes no member data: the login form post,
// admin-ajax with action gm_hub_refresh_token / gm_hub_version / gm_hub_logout_url / _ajaxTooltip, and
// /api/auth/wp-bootstrap and /api/auth/refresh. Analytics and ad pixels are aborted so QA sessions do
// not pollute live analytics. Direct API calls go through a GET-only wrapper that also carries the key.
//
// Env (GitHub secrets): GM_LIVE_QA_<TIER>_USER / GM_LIVE_QA_<TIER>_PASSWORD for STARTER PLUS ADVANCED PRO,
// GM_CRAWL_KEY (Cloudflare skip, live hosts only). GM_LIVEHUB_MAX_MIN default 25.
// Passwords are typed by this script from the environment; never logged, never written.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.geneticmatrix.com';
const LOGIN = BASE + '/login/';
const HUB = BASE + '/user-home/';   // live hub address (John, 2 Oct)
const KEY = (process.env.GM_CRAWL_KEY || '').trim();
const LIVE_HOST = /(^|\.)geneticmatrix\.com$/i;
const ANALYTICS = /(google-analytics|googletagmanager|doubleclick|facebook\.(com|net)|hotjar|clarity\.ms|bing\.com|tiktok|pinterest|linkedin|cookieyes|plausible|segment)/i;
// SignUser is GM's own login handler (the /login/ form posts it), seen on the first live run 2 Oct.
const AJAX_ALLOW = /(^|&)action=(SignUser|gm_hub_refresh_token|gm_hub_version|gm_hub_logout_url|_ajaxTooltip)(&|$)/;
const TIERS = { starter: 0, plus: 1, advanced: 2, pro: 3 };
const EXPECTED_MIN_TIER = { type_full: 0, profile: 0, authority: 0, cross: 3, definition: 3, determination: 3, environment: 3, motivation: 3, trajectory: 3, view: 3, variable: 3, channels: 3 };
const KNOWN_CONSOLE = [/CookieYes|website URL has changed/i, /blockedbyclient|ERR_BLOCKED_BY_CLIENT/i];
const MAX_MS = (Number(process.env.GM_LIVEHUB_MAX_MIN) || 25) * 60000;
const started = Date.now();
const today = new Date().toISOString().slice(0, 10);
const OUT = path.join(__dirname, '..', 'findings', 'livehub', today);
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = { date: today, startedAt: new Date(started).toISOString(), runId: process.env.GITHUB_RUN_ID || 'local', tiers: {}, findings: [], blockedWrites: [], notCovered: [] };
const finding = (severity, tier, area, summary, extra = {}) => results.findings.push({ severity, tier, area, summary, ...extra });
const secretsOf = t => [process.env[`GM_LIVE_QA_${t.toUpperCase()}_USER`], process.env[`GM_LIVE_QA_${t.toUpperCase()}_PASSWORD`]].filter(Boolean);
function redact(s) {
  let out = String(s).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, 'JWT***').replace(/([?&](token|key|signature|nonce|pwd|password)=)[^&\s]+/gi, '$1***');
  for (const v of [KEY, ...Object.keys(TIERS).flatMap(secretsOf)]) if (v) out = out.split(v).join('***');
  return out;
}
let credentialsFailed = false;   // RT3: one bad login stops all tiers, so the QA accounts are never locked out

async function guard(ctx, tier) {
  await ctx.route('**/*', route => {
    const rq = route.request();
    let u; try { u = new URL(rq.url()); } catch { return route.abort(); }
    if (ANALYTICS.test(u.hostname)) return route.abort('blockedbyclient');
    const m = rq.method();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(m)) {
      const isLogin = LIVE_HOST.test(u.hostname) && (/^\/login\/?$/.test(u.pathname) || /\/wp-login\.php$/.test(u.pathname));
      const isAjaxOk = LIVE_HOST.test(u.hostname) && /\/admin-ajax\.php$/.test(u.pathname) && AJAX_ALLOW.test(rq.postData() || '');
      const isAuth = LIVE_HOST.test(u.hostname) && /\/api\/auth\/(wp-bootstrap|refresh)$/.test(u.pathname);
      // Cloudflare's own scripts (bot detection, RUM beacon) post to /cdn-cgi/; they carry no GM data.
      const isCloudflare = LIVE_HOST.test(u.hostname) && /^\/cdn-cgi\//.test(u.pathname);
      if (!(isLogin || isAjaxOk || isAuth || isCloudflare)) {
        const action = ((rq.postData() || '').match(/(^|&)action=([\w-]+)/) || [])[2];
        results.blockedWrites.push({ tier, method: m, url: redact(u.origin + u.pathname), action: action || '' });
        return route.abort('blockedbyclient');
      }
    }
    if (KEY && LIVE_HOST.test(u.hostname)) return route.continue({ headers: { ...rq.headers(), 'X-GM-Crawl-Key': KEY } });
    return route.continue();
  });
}

// RT2: direct API calls do not pass through ctx.route, so this wrapper is GET-only and carries the key itself.
function apiGetter(ctx, base, token) {
  return async p => {
    const res = await ctx.request.get(base + p, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(KEY ? { 'X-GM-Crawl-Key': KEY } : {}) }, failOnStatusCode: false, timeout: 45000 });
    let j = null; try { j = await res.json(); } catch {}
    return { s: res.status(), j };
  };
}

// RT7: look INSIDE the chart. The chart is an <object>; fetch its data URL (GET) and require real SVG/HTML.
async function chartOk(ctx, page) {
  const st = await page.evaluate(() => {
    const card = document.getElementById('cs-card') || document.getElementById('cs-content');
    if (!card) return { ok: false, why: 'no chart card' };
    const obj = card.querySelector('object[data], iframe[src], img[src]');
    const svg = card.querySelector('svg');
    const err = /not available|something went wrong|error loading/i.test(card.innerText || '');
    let inner = null;
    try { const d = obj && (obj.contentDocument || (obj.contentWindow && obj.contentWindow.document)); if (d) inner = { nodes: d.querySelectorAll('*').length, text: (d.body ? d.body.innerText : '').slice(0, 200) }; } catch (e) {}
    return { src: obj ? (obj.getAttribute('data') || obj.getAttribute('src')) : null, svgNodes: svg ? svg.querySelectorAll('*').length : 0, err, inner };
  }).catch(e => ({ why: e.message }));
  if (st.why) return st;
  if (st.err) return { ok: false, why: 'error text on screen' };
  if (st.inner) {
    if (/not available|error|exception/i.test(st.inner.text)) return { ok: false, why: `chart frame says: ${st.inner.text.slice(0, 80)}` };
    if (st.inner.nodes > 50) return { ok: true };
  }
  if (st.svgNodes > 50) return { ok: true };
  if (!st.src) return { ok: false, why: 'no chart element with a source' };
  const url = new URL(st.src, BASE).toString();
  const r = await ctx.request.get(url, { headers: KEY && LIVE_HOST.test(new URL(url).hostname) ? { 'X-GM-Crawl-Key': KEY } : {}, failOnStatusCode: false, timeout: 45000 }).catch(() => null);
  if (!r) return { ok: false, why: 'chart source did not load' };
  const body = await r.text().catch(() => '');
  const ct = (r.headers()['content-type'] || '');
  if (r.status() !== 200) return { ok: false, why: `chart source HTTP ${r.status()}` };
  if (/not available|exception|fatal error/i.test(body.slice(0, 3000))) return { ok: false, why: 'chart source returned an error page' };
  if (!/svg|html|image/i.test(ct) || body.length < 2000) return { ok: false, why: `chart source looks empty (${ct}, ${body.length} bytes)` };
  return { ok: true };
}

async function login(page, user, pass) {
  await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // RT12: scope to the form that holds the password field.
  const form = page.locator('form:has(input[type="password"])').first();
  if (!(await form.count())) return { blocker: 'login form not found on /login/' };
  if (await page.locator('iframe[src*="captcha"], iframe[src*="turnstile"], .g-recaptcha, .cf-turnstile').count()) return { blocker: 'the login page shows a CAPTCHA; Joseph must exempt the crawl key (this check never solves CAPTCHAs)' };
  const userBox = form.locator('input[type="email"]:visible, input[name*="user" i]:visible, input[name*="log" i]:visible, input[name*="email" i]:visible').first();
  if (!(await userBox.count())) return { blocker: 'no visible username field in the login form' };
  await userBox.fill(user);
  await form.locator('input[type="password"]').first().fill(pass);
  await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), form.locator('input[type="password"]').first().press('Enter')]);
  await sleep(4000);
  const txt = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 3000) : '').catch(() => '');
  if (/incorrect|invalid (user|password|login)|wrong password|unknown (user|email)|too many/i.test(txt) && /\/login/.test(page.url())) return { badCreds: true };
  return {};
}

async function runTier(browser, tier) {
  const [user, pass] = secretsOf(tier);
  const r = results.tiers[tier] = { tier };
  if (credentialsFailed) { results.notCovered.push(`${tier}: skipped after a failed login on another tier (lockout protection).`); return; }
  if (!user || !pass) { finding('blocker', tier, 'setup', `Secrets GM_LIVE_QA_${tier.toUpperCase()}_USER / _PASSWORD are not set: tier not tested.`); return; }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guard(ctx, tier);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(redact(m.text()).slice(0, 300)); });
  page.on('pageerror', e => consoleErrors.push(redact('pageerror: ' + e.message).slice(0, 300)));
  const htmlInsteadOfCode = [];
  page.on('response', rs => {
    const type = rs.request().resourceType();
    const ct = (rs.headers()['content-type'] || '').toLowerCase();
    if (!['script', 'xhr', 'fetch'].includes(type) || !ct.includes('text/html')) return;
    // Name the admin-ajax action, so a by-design HTML reply can be told apart from a broken one.
    const act = ((rs.request().postData() || '') + '&' + (rs.url().split('?')[1] || '')).match(/(?:^|&)action=([\w-]+)/);
    htmlInsteadOfCode.push(`${type} ${redact(rs.url().split('?')[0])}${act ? ` (action=${act[1]})` : ''} -> HTTP ${rs.status()} text/html`);
  });
  let tokenTestFrom = Infinity;   // console 401s after this point are the token test's own doing
  const shot = async n => { try { await page.screenshot({ path: path.join(OUT, `${tier}-${n}.png`) }); } catch {} };   // RT5: failures only
  try {
    const lg = await login(page, user, pass);
    if (lg.badCreds) { credentialsFailed = true; finding('blocker', tier, 'login', 'Live login refused the QA credentials. All further tiers skipped so the accounts are not locked out. Check the secrets.'); await shot('login'); return; }
    if (lg.blocker) { finding('blocker', tier, 'login', lg.blocker); await shot('login'); return; }
    await page.goto(HUB, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForFunction(() => !!window.GM_TOKEN, null, { timeout: 30000 }).catch(() => {});
    const env = await page.evaluate(() => ({ token: window.GM_TOKEN || '', api: window.GM_API_BASE || '', fns: { show: typeof window.gmShowView, open: typeof window.gmOpenChart } }));
    if (!env.token) { finding('blocker', tier, 'login', 'Logged in but the hub has no token: login failed or the hub bootstrap failed on live.', { url: redact(page.url()) }); await shot('hub'); return; }
    if (!LIVE_HOST.test(new URL(env.api).hostname)) { finding('critical', tier, 'environment', `Live hub API base is not a geneticmatrix.com host: ${env.api}`); return; }
    if (env.fns.show !== 'function' || env.fns.open !== 'function') finding('critical', tier, 'coverage', `Hub functions missing (gmShowView: ${env.fns.show}, gmOpenChart: ${env.fns.open}): chart and view checks would test nothing.`);
    let claims = {}; try { claims = JSON.parse(Buffer.from(env.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); } catch {}
    r.tierClaim = claims.tier;
    if (Number(claims.tier) !== TIERS[tier]) finding('critical', tier, 'entitlement', `Live JWT tier is ${claims.tier}, expected ${TIERS[tier]} for the ${tier} QA account.`);
    const t = Number(claims.tier);
    const get = apiGetter(ctx, env.api.replace(/\/+$/, ''), env.token);

    const fac = await get('/api/facets');
    const facets = (fac.j && fac.j.data) || [];
    if (fac.s !== 200 || !facets.length) finding('critical', tier, 'filters', `/api/facets returned ${fac.s} with ${facets.length} facets.`);
    const keys = new Set(facets.map(f => f.key));
    for (const k of Object.keys(EXPECTED_MIN_TIER)) if (facets.length && !keys.has(k)) finding('critical', tier, 'entitlement', `LIVE: expected facet "${k}" is missing from /api/facets.`);   // RT8
    for (const f of facets) {
      if (!(f.key in EXPECTED_MIN_TIER)) finding('medium', tier, 'entitlement', `Facet "${f.key}" is not in the expected tier map.`);
      else if (f.locked !== (t < EXPECTED_MIN_TIER[f.key])) finding('critical', tier, 'entitlement', `LIVE: facet "${f.key}" locked=${f.locked} for tier ${t}, expected ${t < EXPECTED_MIN_TIER[f.key]}.`);
    }
    const ppl = await get('/api/people?per_page=500');
    const list = (ppl.j && ppl.j.data) || [];
    r.people = list.length;
    if (ppl.s !== 200) finding('critical', tier, 'people', `/api/people returned ${ppl.s} on live.`);
    else if (!list.length) finding('critical', tier, 'coverage', 'Live QA account has no people: seed it, or nothing below is tested.');
    for (const f of facets.filter(f => f.locked)) {
      const leaked = list.filter(p => p[f.key] != null && !(Array.isArray(p[f.key]) && !p[f.key].length)).length;
      if (leaked) finding('critical', tier, 'entitlement', `LIVE: locked facet "${f.key}" data is in /api/people for ${leaked} people.`);
    }
    // RT9: a filter only counts as tested if the seed has 2+ values and the filtered total is below the full list.
    for (const key of ['type', 'authority']) {
      const src = key === 'type' ? 'type_code' : key;
      const vals = [...new Set(list.map(p => p[src]).filter(Boolean))].slice(0, 6);
      if (vals.length < 2) { results.notCovered.push(`${tier}: ${key} filter not tested (the seed has ${vals.length} distinct value(s); needs 2+).`); continue; }
      for (const v of vals) {
        const q = await get(`/api/people?per_page=500&${key}=${encodeURIComponent(v)}`);
        const n = list.filter(p => p[src] === v).length;
        const total = q.j && q.j.total;
        if (q.s !== 200 || total !== n) finding('critical', tier, 'filters', `LIVE: filter ${key}=${v} returned ${total} (HTTP ${q.s}), list has ${n}.`);
        else if (total >= list.length) finding('critical', tier, 'filters', `LIVE: filter ${key}=${v} returned the whole list (${total}): filtering is not applied.`);
      }
    }

    // Charts: open up to 3, switch tabs, look inside each (RT7).
    const ids = list.slice(0, 3).map(p => p.id);
    for (const id of ids) { await page.evaluate(i => { window.gmShowView('chart-space.html'); window.gmOpenChart(i); }, id).catch(() => {}); await sleep(5000); }
    const tabs = page.locator('#chartTabs > *');
    const nTabs = await tabs.count();
    if (ids.length && nTabs < ids.length) finding('critical', tier, 'chart', `Opened ${ids.length} charts on live but only ${nTabs} tabs exist.`);
    for (let i = 0; i < nTabs; i++) {
      await tabs.nth(i).click().catch(() => {}); await sleep(2500);
      const st = await chartOk(ctx, page);
      if (!st.ok) { finding('critical', tier, 'chart', `LIVE chart tab ${i + 1} is blank or broken: ${st.why}.`); await shot(`chart-tab-${i + 1}`); }
    }
    r.chartsChecked = nTabs;

    // RT11: Research must actually run the search (response watched) and show the result.
    await page.evaluate(() => window.gmShowView('research.html')).catch(() => {});
    if (await page.waitForSelector('#gmr-q', { timeout: 10000 }).catch(() => null)) {
      const resp = page.waitForResponse(rs => /\/api\/research\/celebs/.test(rs.url()) && /Einstein/i.test(decodeURIComponent(rs.url())), { timeout: 20000 }).catch(() => null);
      await page.fill('#gmr-q', 'Einstein');
      await page.click('#gmr-search');
      const rr = await resp;
      await sleep(2000);
      const hit = await page.evaluate(() => /Einstein/i.test((document.getElementById('gm-research-root') || {}).innerText || ''));
      // Celebrity pages are Plus and above (reference-gm-membership-tiers): Starter must be refused AND told why.
      if (t < 1) {
        const nudge = await page.evaluate(() => /upgrade|plus|plans?/i.test((document.getElementById('gm-research-root') || document.body).innerText || ''));
        if (rr && rr.status() !== 402 && rr.status() !== 403) finding('critical', tier, 'entitlement', `LIVE: Starter Research search returned HTTP ${rr.status()}, expected a refusal (Research is Plus and above).`);
        else if (!nudge) { finding('high', tier, 'research', 'LIVE: Starter is correctly refused Research, but sees no upgrade message: the search just fails silently.'); await shot('research'); }
      } else {
        if (!rr) finding('critical', tier, 'research', 'LIVE Research search sent no search request for "Einstein".');
        else if (rr.status() !== 200) finding('critical', tier, 'research', `LIVE Research search returned HTTP ${rr.status()}.`);
        else if (!hit) finding('critical', tier, 'research', 'LIVE Research search ran but shows no result for "Einstein".');
        if (!rr || !hit) await shot('research');
      }
    } else finding('critical', tier, 'research', 'LIVE Research view did not open (#gmr-q not found).');

    // RT10: token death must show the full chain: a 401, a refresh that returns a token, a 2xx retry of that call.
    const seq = [];
    page.on('response', async rs => {
      const u = rs.url();
      if (/\/api\//.test(u)) seq.push({ kind: 'api', u: u.split('?')[0], s: rs.status() });
      else if (/admin-ajax\.php/.test(u) && /gm_hub_refresh_token/.test(rs.request().postData() || '')) {
        let tok = false; try { tok = !!((await rs.json()) || {}).data?.access_token; } catch {}
        seq.push({ kind: 'refresh', s: rs.status(), tok });
      }
    });
    tokenTestFrom = consoleErrors.length;
    await page.evaluate(() => { window.GM_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.expired'; try { localStorage.removeItem('gm_token'); } catch (e) {} });
    await page.evaluate(() => window.gmShowView('my-people.html')).catch(() => {}); await sleep(3000);
    if (ids[0]) { await page.evaluate(i => window.gmOpenChart(i), ids[0]).catch(() => {}); await sleep(5000); }
    const first401 = seq.findIndex(x => x.kind === 'api' && x.s === 401);
    const ref = first401 >= 0 ? seq.slice(first401).find(x => x.kind === 'refresh') : null;
    const retried = first401 >= 0 ? seq.slice(first401 + 1).some(x => x.kind === 'api' && x.u === seq[first401].u && x.s >= 200 && x.s < 300) : false;
    const otherBad = seq.filter(x => x.kind === 'api' && (x.s === 403 || x.s >= 500));
    if (first401 < 0) finding('critical', tier, 'token', 'LIVE token-death test INCONCLUSIVE: no 401 after killing the token, so the dead token was never exercised.');
    else if (!ref || !ref.tok) finding('critical', tier, 'token', `LIVE: after a 401 the token refresh ${ref ? `returned no token (HTTP ${ref.s})` : 'never ran'}. Members would see broken controls.`);
    else if (!retried) finding('critical', tier, 'token', `LIVE: token refreshed but ${seq[first401].u.replace(/^https?:\/\/[^/]+/, '')} was not retried successfully.`);
    if (otherBad.length) finding('critical', tier, 'token', `LIVE: ${otherBad.length} API call(s) returned 403/5xx during the token test.`);
    results.notCovered.push(`${tier}: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.`);
  } catch (e) {
    finding('critical', tier, 'runner', 'Tier run crashed: ' + redact(e.message.split('\n')[0]));   // RT6
    await shot('crash');
  } finally {
    const own401 = (m, i) => i >= tokenTestFrom && /status of 401/.test(m);
    const unknown = [...new Set(consoleErrors.filter((m, i) => !own401(m, i)))].filter(m => !KNOWN_CONSOLE.some(re => re.test(m)) && !(TIERS[tier] < 1 && /status of 402/.test(m)));
    if (unknown.length) finding('high', tier, 'console', `${unknown.length} console error(s) on the LIVE hub.`, { sample: unknown.slice(0, 5) });
    if (htmlInsteadOfCode.length) finding('high', tier, 'assets', `LIVE: ${htmlInsteadOfCode.length} script/data request(s) returned an HTML page instead (the cause of "Unexpected token '<'"): ${[...new Set(htmlInsteadOfCode)].slice(0, 4).join('; ')}`);
    await ctx.close();
  }
}

(async () => {
  let browser;
  const cap = setTimeout(() => { finding('critical', '-', 'runner', 'Hit the time cap; results are partial.'); write(); process.exit(3); }, MAX_MS);
  try {
    if (!KEY) finding('blocker', '-', 'setup', 'GM_CRAWL_KEY is not set: Cloudflare will challenge the check.');
    browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge', headless: true } : { headless: true });
    for (const tier of Object.keys(TIERS)) await runTier(browser, tier);
  } catch (e) { finding('blocker', '-', 'runner', 'Run could not start: ' + redact(e.message.split('\n')[0])); }
  finally { clearTimeout(cap); if (browser) await browser.close().catch(() => {}); write(); }
})();

function write() {
  const reached = Object.values(results.tiers).filter(t => t.tierClaim !== undefined).length;
  if (!reached && !results.findings.some(f => f.severity === 'blocker')) finding('blocker', '-', 'coverage', 'No tier reached the live hub: nothing was tested.');
  if (results.blockedWrites.length) finding('critical', '-', 'read-only guard', `The live hub tried ${results.blockedWrites.length} write request(s) during a read-only session; all were blocked.`, { sample: results.blockedWrites.slice(0, 8) });
  const order = { blocker: 0, critical: 1, high: 2, medium: 3, low: 4 };
  results.findings.sort((a, b) => order[a.severity] - order[b.severity]);
  results.durationMin = Math.round((Date.now() - started) / 60000);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const head = `LIVE hub check ${today} (read-only): ${reached}/4 tiers reached the hub, ${results.findings.length} finding(s), ${results.blockedWrites.length} write(s) blocked.`;
  const md = [`# ${head}`, '', `Run ${results.runId}, started ${results.startedAt}, ${results.durationMin} min.`, '',
    ...Object.values(results.tiers).map(t => `- **${t.tier}**: tier claim ${t.tierClaim ?? '?'}, people ${t.people ?? '?'}, chart tabs checked ${t.chartsChecked ?? 0}`), '',
    '## Findings', '', ...(results.findings.length ? results.findings.map(f => `- [${f.severity}] ${f.tier} / ${f.area}: ${f.summary}`) : ['None.']), '',
    ...(results.notCovered.length ? ['## Not covered', '', ...results.notCovered.map(n => `- ${n}`), ''] : [])].join('\n');
  fs.writeFileSync(path.join(OUT, 'summary.md'), md);
  console.log(md);
  // RT6: blocker, critical or high fails the run, and so does anything not covered.
  process.exitCode = results.findings.some(f => ['blocker', 'critical', 'high'].includes(f.severity)) || results.notCovered.some(n => !/stale-nonce/.test(n)) ? 1 : 0;
}
