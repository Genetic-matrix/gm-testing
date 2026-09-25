// GM nightly staging pass: chart creation + filters, per tier. DETECT ONLY.
//
// What it does, per QA tier account:
//   1. Logs in through Joseph's staging-only /gm-test-login?account=<tier> (no password is ever typed).
//   2. Loads the hub; records console errors and failed requests.
//   3. Checks the JWT tier matches the account, and that the hub's API base is staging, not live.
//   4. Facets: the locked flags match the tier, and locked facet data is NOT in the /api/people payload.
//   5. Filters: for every unlocked single-value facet, how many people have no value (a derived-data
//      hole), and for the server-side filters (type, authority) the filtered total equals the bucket count.
//   7. Sequences on that person only: edit the birth time (derived data must survive the save), then
//      calc method: non-Pro must be refused off Tropical (403); Pro walks every system and the person must
//      have Type + Profile under each (the "written at save for all 9 systems" check), with a filter
//      count per system. The account's original method is always restored.
//   6. Creates ONE person through the real hub form (the 22 Sep break was a UI path), then confirms it
//      landed in the staging API with Type + Profile present and a chart list. Starter at its 5-person
//      cap must get the upgrade refusal instead, and that counts as a pass.
//
// It never deletes, never touches live, and aborts every write if anything points outside staging.
// Output: findings/<date>/results.json, summary.md and screenshots. The nightly Claude session reads
// those, explores further within the 45-minute cap, and writes the morning report + ledger.
//
// Env:
//   GM_STAGING_BASE      default https://www.staginggm.com
//   GM_HUB_PATH          default /user-hub-tailwind/
//   GM_TEST_LOGIN_KEY    the lock on /gm-test-login (and staging's basic-auth bypass), sent as X-GM-Test-Key
//                        on every request (never logged, never written). No IP lock: John is on Starlink, no fixed IP.
//   GM_NIGHTLY_MAX_MIN   hard wall-clock cap for this script, default 20 (the rest of 45 is Claude's review)
//   GM_NIGHTLY_TIERS     default starter,plus,advanced,pro
//   GM_NIGHTLY_WRITES    default 1; 0 = read-only night (no person created)

const { chromium, webkit } = require('playwright');
// GM_BROWSER=webkit runs the same checks in WebKit (Safari's engine) as an early warning. It is NOT a
// Safari-on-Mac pass: that stays a manual check before any hub change goes live (John, 25 Sep).
const BROWSER = (process.env.GM_BROWSER || 'chromium').toLowerCase();
const fs = require('fs');
const path = require('path');

const BASE = (process.env.GM_STAGING_BASE || 'https://www.staginggm.com').replace(/\/+$/, '');
const HUB_PATH = process.env.GM_HUB_PATH || '/user-hub-tailwind/';
// Key from the process env, or straight from the Windows user env (so a fresh key works without an app restart).
const LOGIN_KEY = (process.env.GM_TEST_LOGIN_KEY || (() => {
  try {
    const out = require('child_process').execSync('reg query HKCU\\Environment /v GM_TEST_LOGIN_KEY', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/GM_TEST_LOGIN_KEY\s+REG_\w+\s+(.+)/);
    return m ? m[1] : '';
  } catch { return ''; }
})()).trim();
// Cloudflare Access service token (optional): once staging moves from basic auth to Cloudflare Access,
// these two headers get the run through Access. Secrets GM_CF_ACCESS_CLIENT_ID / GM_CF_ACCESS_CLIENT_SECRET.
const CF_ID = (process.env.GM_CF_ACCESS_CLIENT_ID || '').trim();
const CF_SECRET = (process.env.GM_CF_ACCESS_CLIENT_SECRET || '').trim();
const AUTH_HEADERS = Object.assign({},
  LOGIN_KEY ? { 'X-GM-Test-Key': LOGIN_KEY } : {},
  CF_ID && CF_SECRET ? { 'CF-Access-Client-Id': CF_ID, 'CF-Access-Client-Secret': CF_SECRET } : {});
const MAX_MS = (Number(process.env.GM_NIGHTLY_MAX_MIN) || 20) * 60 * 1000;
const WRITES = process.env.GM_NIGHTLY_WRITES !== '0';
const TIERS = (process.env.GM_NIGHTLY_TIERS || 'starter,plus,advanced,pro').split(',').map(s => s.trim()).filter(Boolean);
const TIER_LEVEL = { starter: 0, plus: 1, advanced: 2, pro: 3 };
const STARTER_LIMIT = 5; // PeopleController::STARTER_PEOPLE_LIMIT

// Fixed QA birth input. Test data only, not reference data: the check is "was it saved and computed",
// not "is the chart correct" (that is the golden master's job).
const QA_BIRTH = { country: 'United Kingdom', place: 'London', date: '1985-06-15', time: '14:30' };

const started = Date.now();
const today = new Date().toISOString().slice(0, 10);
const OUT = path.join(__dirname, '..', 'findings', today, BROWSER === 'webkit' ? 'webkit' : '');
fs.mkdirSync(OUT, { recursive: true });

// Staging guard. Anything that is not a staginggm.com host is treated as live.
function isStagingHost(url) {
  try { return /(^|\.)staginggm\.com$/i.test(new URL(url).hostname); } catch { return false; }
}
if (!isStagingHost(BASE)) {
  console.error(`ABORT: GM_STAGING_BASE (${BASE}) is not a staginggm.com host. This script never runs against live.`);
  process.exit(2);
}

const results = { date: today, base: BASE, browser: BROWSER, writes: WRITES, tiers: {}, findings: [], notCovered: [] };
function finding(severity, tier, area, summary, detail = {}) {
  results.findings.push({ severity, tier, area: BROWSER === 'webkit' ? `webkit/${area}` : area, summary, ...detail });
}
function timeLeft() { return MAX_MS - (Date.now() - started); }

function decodeJwt(tok) {
  try { return JSON.parse(Buffer.from(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch { return null; }
}

async function api(ctx, method, url, token, body) {
  const res = await ctx.request.fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    data: body ? JSON.stringify(body) : undefined,
    failOnStatusCode: false,
    timeout: 60000,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status(), json };
}

async function runTier(browser, tier) {
  const r = { tier, steps: {} };
  results.tiers[tier] = r;
  const expected = TIER_LEVEL[tier];
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, // new hub is desktop only
    extraHTTPHeaders: AUTH_HEADERS,
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => consoleErrors.push(('pageerror: ' + e.message).slice(0, 300)));
  page.on('response', resp => {
    const s = resp.status();
    if (s >= 400) failedRequests.push({ status: s, url: resp.url().replace(/([?&](token|key|signature)=)[^&]+/gi, '$1***').slice(0, 200) });
  });
  const shot = async name => { try { await page.screenshot({ path: path.join(OUT, `${tier}-${name}.png`), fullPage: false }); } catch {} };

  try {
    // 1. Login
    const login = await page.goto(`${BASE}/gm-test-login?account=${encodeURIComponent(tier)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    r.steps.login = { status: login ? login.status() : null, landed: page.url() };
    if (!login || login.status() >= 400) {
      finding('blocker', tier, 'login', `Test login returned ${login ? login.status() : 'no response'}; the tier could not be tested.`);
      await shot('login');
      return;
    }

    // 2. Hub load
    const t0 = Date.now();
    // Not networkidle: the hub keeps polling, so it never goes idle (first dry run sat 90s).
    await page.goto(BASE + HUB_PATH, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForFunction(() => typeof window.GM_API_BASE !== 'undefined', null, { timeout: 20000 }).catch(() => {});
    r.steps.hubLoadMs = Date.now() - t0;
    await page.waitForTimeout(3000); // let the people list and rail render
    const env = await page.evaluate(() => ({ token: window.GM_TOKEN || '', apiBase: window.GM_API_BASE || '', lvl: window.GM_LVL, writes: window.GM_WRITES }));
    await shot('hub');
    if (!env.token) {
      finding('blocker', tier, 'login', 'Hub loaded with no GM_TOKEN: not logged in, or the WP bootstrap failed.', { landed: page.url() });
      return;
    }
    if (r.steps.hubLoadMs > 15000) finding('medium', tier, 'performance', `Hub took ${Math.round(r.steps.hubLoadMs / 1000)}s to settle.`);

    // 3. Staging + tier checks
    const apiStaging = isStagingHost(env.apiBase);
    r.steps.apiBase = env.apiBase;
    if (!apiStaging) finding('critical', tier, 'environment', `Staging hub API base is not a staginggm.com host: ${env.apiBase}. All writes skipped.`);
    const claims = decodeJwt(env.token) || {};
    r.steps.tierClaim = claims.tier;
    if (Number(claims.tier) !== expected) finding('high', tier, 'entitlement', `JWT tier is ${claims.tier}, expected ${expected} for the ${tier} account.`);
    const tierNow = Number(claims.tier);
    const A = env.apiBase.replace(/\/+$/, '');
    r.steps.apiA = apiStaging ? A : null;

    // 4. Facets and entitlement
    const facets = await api(ctx, 'GET', `${A}/api/facets`, env.token);
    r.steps.facetsStatus = facets.status;
    const facetList = (facets.json && facets.json.data) || [];
    if (facets.status !== 200) finding('high', tier, 'filters', `/api/facets returned ${facets.status}.`);
    for (const f of facetList) {
      const shouldLock = tierNow < f.min_tier;
      if (f.locked !== shouldLock) finding('high', tier, 'entitlement', `Facet "${f.key}" locked=${f.locked}, expected ${shouldLock} (min_tier ${f.min_tier}, tier ${tierNow}).`);
    }

    const people = await api(ctx, 'GET', `${A}/api/people?per_page=500`, env.token);
    r.steps.peopleStatus = people.status;
    const list = (people.json && people.json.data) || [];
    const total = people.json ? people.json.total : null;
    r.steps.peopleTotal = total;
    r.steps.activeSystem = people.json && people.json.active;
    if (people.status !== 200) finding('high', tier, 'people', `/api/people returned ${people.status}.`);
    if (total > 500) results.notCovered.push(`${tier}: ${total} people, only the first 500 were checked.`);

    // Locked facet data must not ride along in the payload.
    for (const f of facetList.filter(f => f.locked)) {
      const leaked = list.filter(p => p[f.key] !== undefined && p[f.key] !== null && !(Array.isArray(p[f.key]) && !p[f.key].length));
      if (leaked.length) finding('high', tier, 'entitlement', `Locked facet "${f.key}" data is present for ${leaked.length} people in /api/people (member could filter from the console).`);
    }

    // 5. Holes + filter totals, unlocked single-value facets only.
    const holes = {};
    for (const f of facetList.filter(f => !f.locked && !f.pending && f.key !== 'channels')) {
      const missing = list.filter(p => p[f.key] === undefined || p[f.key] === null || p[f.key] === '');
      holes[f.key] = missing.length;
      if (missing.length) finding('medium', tier, 'derived-data', `${missing.length} of ${list.length} people have no "${f.key}" for the active calc system.`, { sample: missing.slice(0, 5).map(p => p.id) });
    }
    r.steps.holes = holes;
    for (const key of ['type', 'authority']) {
      const buckets = {};
      for (const p of list) if (p[key]) buckets[p[key]] = (buckets[p[key]] || 0) + 1;
      // type filters on the raw column, so bucket on type_code for that one.
      const src = key === 'type' ? 'type_code' : key;
      const b2 = {};
      for (const p of list) if (p[src]) b2[p[src]] = (b2[p[src]] || 0) + 1;
      for (const [val, n] of Object.entries(key === 'type' ? b2 : buckets).slice(0, 12)) {
        if (timeLeft() < 60000) break;
        const q = await api(ctx, 'GET', `${A}/api/people?per_page=500&${key}=${encodeURIComponent(val)}`, env.token);
        if (q.status !== 200) { finding('high', tier, 'filters', `Filter ${key}=${val} returned ${q.status}.`); continue; }
        if (q.json.total !== n) finding('high', tier, 'filters', `Filter ${key}=${val} returned ${q.json.total}, the full list has ${n}.`);
      }
    }

    // Filter rail renders in the UI.
    const railItems = await page.locator('#chartRail > *').count().catch(() => 0);
    r.steps.railItems = railItems;
    if (list.length && railItems === 0) { finding('high', tier, 'filters', 'Chart filters rail (#chartRail) is empty although the member has people.'); await shot('rail-empty'); }

    // 6. Create through the real form.
    if (!WRITES || !apiStaging) {
      results.notCovered.push(`${tier}: create skipped (${!WRITES ? 'read-only night' : 'API base not staging'}).`);
    } else if (timeLeft() < 120000) {
      results.notCovered.push(`${tier}: create skipped, out of time.`);
    } else {
      const name = `QA Nightly ${today} ${tier}`;
      const atCap = tierNow <= 0 && list.length >= STARTER_LIMIT;
      await page.evaluate(() => window.gmShowView && window.gmShowView('create-person.html'));
      await page.waitForSelector('#cp-person-form', { state: 'visible', timeout: 15000 }).catch(() => {});
      let postStatus = null, postBody = null;
      page.on('response', async resp => {
        if (resp.request().method() === 'POST' && /\/api\/people(\?|$)/.test(resp.url())) {
          postStatus = resp.status();
          try { postBody = await resp.json(); } catch {}
        }
      });
      try {
        await page.fill('#cp-name', name);
        await page.fill('#cp-country', QA_BIRTH.country);
        await page.locator('#cp-country-menu .cp-opt', { hasText: QA_BIRTH.country }).first().dispatchEvent('mousedown', { timeout: 10000 });
        await page.fill('#cp-dob', QA_BIRTH.date);
        await page.fill('#cp-time', QA_BIRTH.time);
        await page.fill('#cp-place', QA_BIRTH.place);
        await page.locator('#cp-place-menu .cp-opt').first().dispatchEvent('mousedown', { timeout: 15000 });
        await page.click('#cp-create-person');
        await page.waitForFunction(() => {
          const t = (document.getElementById('cp-person-msg') || {}).textContent || '';
          return /Created|Could not|limit|Upgrade/i.test(t);
        }, null, { timeout: 60000 }).catch(() => {});
      } catch (e) {
        finding('high', tier, 'create', `Create form could not be driven: ${e.message.split('\n')[0]}`);
      }
      const msg = await page.locator('#cp-person-msg').textContent().catch(() => '');
      r.steps.create = { atCap, postStatus, msg: (msg || '').trim().slice(0, 200) };
      await shot('create');

      if (atCap) {
        if (postStatus !== 402) finding('high', tier, 'entitlement', `Starter at its ${STARTER_LIMIT}-person cap got ${postStatus}, expected 402 upgrade refusal.`, { msg });
      } else if (postStatus !== 201) {
        finding('critical', tier, 'create', `Creating a person through the hub failed: POST /api/people ${postStatus}, message "${(msg || '').trim()}".`);
      } else {
        const id = postBody && postBody.data && postBody.data.id;
        const found = await api(ctx, 'GET', `${A}/api/people?per_page=50&search=${encodeURIComponent(name)}`, env.token);
        const row = ((found.json && found.json.data) || []).find(p => p.id === id);
        r.steps.createdId = id;
        if (!row) finding('critical', tier, 'create', `Person ${id} saved (201) but is not in the staging /api/people list.`);
        else {
          if (!row.type) finding('high', tier, 'derived-data', `New person ${id} has no Type right after save (derived data not written with the person).`);
          if (!row.profile) finding('high', tier, 'derived-data', `New person ${id} has no Profile right after save.`);
        }
        const charts = await api(ctx, 'GET', `${A}/api/people/${id}/charts`, env.token);
        if (charts.status !== 200) finding('high', tier, 'create', `/api/people/${id}/charts returned ${charts.status}.`);
        // The hub opens the chart after create; confirm it did.
        const csVisible = await page.locator('[data-view="chart-space.html"]').isVisible().catch(() => false);
        if (!csVisible) finding('medium', tier, 'create', 'After create the hub did not open the new chart.');
        await page.waitForTimeout(4000);
        await shot('chart-after-create');
      }
    }
    // 7. Sequences on tonight's QA person only: edit, then calc method, then filter.
    if (r.steps.createdId && r.steps.apiA && timeLeft() > 120000) {
      await runSequences(ctx, r, tier, tierNow, r.steps.apiA, env.token, page, shot);
    } else if (WRITES) {
      results.notCovered.push(`${tier}: edit and calc-method sequences skipped (no person created tonight${timeLeft() <= 120000 ? ', or out of time' : ''}).`);
    }
  } catch (e) {
    finding('high', tier, 'runner', `Tier run crashed: ${e.message.split('\n')[0]}`);
    await shot('crash');
  } finally {
    r.consoleErrors = [...new Set(consoleErrors)].slice(0, 30);
    r.failedRequests = failedRequests.slice(0, 30);
    if (r.consoleErrors.length) finding('medium', tier, 'console', `${r.consoleErrors.length} distinct console errors on the hub.`, { sample: r.consoleErrors.slice(0, 5) });
    const serverErrors = failedRequests.filter(f => f.status >= 500);
    if (serverErrors.length) finding('high', tier, 'server', `${serverErrors.length} requests returned 5xx.`, { sample: serverErrors.slice(0, 5) });
    await ctx.close();
  }
}

// Token death, simulated so it does not need an hour's wait. The member standard (John, 23 Sep):
// a member NEVER sees the token die and is NEVER asked to log in again. So after killing the token,
// every API call must end in success; any 401 that is not followed by a successful retry of the same
// call is a member-visible failure. Two scenarios per tier:
//   dead-token:  token replaced with garbage (what an expired token looks like to the API)
//   stale-nonce: dead token AND the refresh nonce made invalid (a hub left open past ~12-24 h)
// Exercised: people list, open a chart, Research search (Research keeps its own token copy).
async function runTokenTests(browser, tier, shot0) {
  const out = {};
  for (const scenario of ['dead-token', 'stale-nonce']) {
    if (timeLeft() < 90000) { results.notCovered.push(`${tier}: token scenario ${scenario} not run, out of time.`); continue; }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: AUTH_HEADERS });
    const page = await ctx.newPage();
    const calls = [];
    page.on('response', resp => { const u = resp.url(); if (/\/api\//.test(u) && !/wp-admin/.test(u)) calls.push({ url: u.split('?')[0], status: resp.status() }); });
    try {
      await page.goto(`${BASE}/gm-test-login?account=${encodeURIComponent(tier)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.goto(BASE + HUB_PATH, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => !!window.GM_TOKEN, null, { timeout: 20000 });
      await page.evaluate(sc => {
        window.GM_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.expired';
        try { localStorage.removeItem('gm_token'); } catch (e) {}
        if (sc === 'stale-nonce') window.GM_REFRESH_NONCE = 'stalenonce0';
      }, scenario);
      calls.length = 0;
      // People list, then a chart, then Research.
      await page.evaluate(() => window.gmShowView && window.gmShowView('my-people.html'));
      await page.waitForTimeout(3000);
      const firstId = await page.evaluate(() => (window.PEOPLE && window.PEOPLE[0] && window.PEOPLE[0].id) || null);
      if (firstId) { await page.evaluate(i => window.gmOpenChart && window.gmOpenChart(i), firstId); await page.waitForTimeout(5000); }
      const notAvail = await page.locator('text=/not available/i').count().catch(() => 0);
      await page.evaluate(() => window.gmShowView && window.gmShowView('research.html'));
      await page.waitForSelector('#gmr-q', { timeout: 10000 }).catch(() => {});
      if (await page.locator('#gmr-q').count()) {
        await page.fill('#gmr-q', 'Einstein');
        await page.click('#gmr-search').catch(() => {});
        await page.waitForTimeout(5000);
      }
      await shot0(`token-${scenario}`, page);
      const failed = [];
      calls.forEach((c, i) => {
        if (c.status === 401 && !calls.slice(i + 1).some(l => l.url === c.url && l.status >= 200 && l.status < 300)) failed.push(c.url.replace(/^https?:\/\/[^/]+/, ''));
      });
      const uniq = [...new Set(failed)];
      out[scenario] = { calls: calls.length, unrecovered401: uniq, chartNotAvailable: notAvail };
      if (!calls.length) finding('medium', tier, 'token', `Token test ${scenario}: no API calls observed, the test did not exercise anything.`);
      else if (uniq.length || notAvail) finding('critical', tier, 'token', `After the token dies (${scenario}), a member sees failures: ${uniq.length} call(s) never recovered (${uniq.slice(0, 4).join(', ')})${notAvail ? ', and "not available" is on screen' : ''}. Member standard: the token must renew invisibly.`);
    } catch (e) {
      finding('high', tier, 'token', `Token test ${scenario} could not run: ${e.message.split('\n')[0]}`);
    } finally { await ctx.close(); }
  }
  return out;
}

// Edit -> calc method -> filter, on the person this run created. Never touches any other record.
async function runSequences(ctx, r, tier, tierNow, A, token, page, shot) {
  const id = r.steps.createdId;
  const seq = r.steps.sequences = {};
  const findRow = async () => {
    const q = await api(ctx, 'GET', `${A}/api/people?per_page=50&search=${encodeURIComponent(`QA Nightly ${today} ${tier}`)}`, token);
    return { status: q.status, active: q.json && q.json.active, row: ((q.json && q.json.data) || []).find(p => p.id === id) };
  };

  // Edit: move the birth time by one hour, with dobUTC recomputed the way the hub does it.
  const before = await findRow();
  const rec = await api(ctx, 'GET', `${A}/api/people/${id}`, token);
  const d = rec.json && rec.json.data;
  if (rec.status !== 200 || !d || !d.dob) {
    finding('high', tier, 'edit', `GET /api/people/${id} returned ${rec.status}; the edit form could not load the person.`);
  } else {
    const [date, time = '12:00:00'] = String(d.dob).split(' ');
    const newTime = `${String((Number(time.slice(0, 2)) + 1) % 24).padStart(2, '0')}:${time.slice(3, 5)}`;
    const utc = await api(ctx, 'GET', `${A}/api/geo/utc?lat=${d.latitude}&lng=${d.longitude}&date=${date}&time=${newTime}`, token);
    const dob = `${date} ${newTime}:00`;
    const put = await api(ctx, 'PUT', `${A}/api/people/${id}`, token, { dob, dobUTC: (utc.json && utc.json.dobUTC) || dob });
    seq.edit = { status: put.status, newTime };
    if (put.status !== 200) finding('critical', tier, 'edit', `Editing person ${id} failed: PUT /api/people/${id} returned ${put.status}.`, { body: JSON.stringify(put.json || '').slice(0, 200) });
    else {
      const after = await findRow();
      if (!after.row) finding('critical', tier, 'edit', `Person ${id} disappeared from /api/people after an edit.`);
      else {
        if (!after.row.type || !after.row.profile) finding('high', tier, 'derived-data', `Person ${id} lost Type or Profile after an edit (derived data not rewritten with the save).`);
        seq.editChangedType = before.row && before.row.type !== after.row.type;
      }
      const again = await api(ctx, 'GET', `${A}/api/people/${id}`, token);
      if (again.json && again.json.data && String(again.json.data.dob).slice(0, 16) !== dob.slice(0, 16)) finding('high', tier, 'edit', `Edit reported 200 but the stored birth time is ${again.json.data.dob}, not ${dob}.`);
    }
  }

  // Calc method.
  const origSystem = (before.active && before.active.system) || 1;
  const sys = await api(ctx, 'GET', `${A}/api/chart-systems`, token);
  const ids = (((sys.json && (sys.json.data || sys.json)) || [])).map(s => s.id).filter(n => n > 0);
  seq.systems = ids;
  if (!ids.length) { finding('medium', tier, 'calc', `/api/chart-systems returned no systems (${sys.status}).`); return; }
  const setSystem = n => api(ctx, 'PUT', `${A}/api/settings`, token, { section: 'astro_system', values: { system: n } });

  if (tierNow < 3) {
    // Non-Pro: Tropical must save, anything else must be refused with 403.
    const keep = await setSystem(1);
    if (keep.status !== 200) finding('high', tier, 'entitlement', `Non-Pro saving Tropical (their only method) returned ${keep.status}, expected 200.`);
    const other = ids.find(n => n !== 1);
    if (other) {
      const no = await setSystem(other);
      seq.gate = no.status;
      if (no.status !== 403) {
        finding('critical', tier, 'entitlement', `Non-Pro switching to calc system ${other} returned ${no.status}, expected 403. The Pro gate is open.`);
        await setSystem(origSystem);
      }
    }
    return;
  }

  // Pro: every system must have tonight's person with Type + Profile, and filters must still add up.
  seq.perSystem = {};
  try {
    for (const n of ids) {
      if (timeLeft() < 90000) { results.notCovered.push(`${tier}: calc systems from ${n} on not checked, out of time.`); break; }
      const put = await setSystem(n);
      if (put.status !== 200) { finding('high', tier, 'calc', `Pro switching to calc system ${n} returned ${put.status}.`); seq.perSystem[n] = `put ${put.status}`; continue; }
      const got = await findRow();
      const ok = got.row && got.row.type && got.row.profile;
      seq.perSystem[n] = got.active && got.active.system === n ? (ok ? 'ok' : 'missing') : `active=${got.active && got.active.system}`;
      if (!got.active || got.active.system !== n) finding('high', tier, 'calc', `After switching to system ${n}, /api/people still reports system ${got.active && got.active.system}.`);
      else if (!ok) finding('high', tier, 'derived-data', `Tonight's person ${id} has no Type/Profile under calc system ${n} (derived data for that system not written at save).`);
      // One filter under this system: the Type bucket for tonight's person.
      if (got.row && got.row.type_code) {
        const all = await api(ctx, 'GET', `${A}/api/people?per_page=500`, token);
        const n1 = ((all.json && all.json.data) || []).filter(p => p.type_code === got.row.type_code).length;
        const f = await api(ctx, 'GET', `${A}/api/people?per_page=500&type=${encodeURIComponent(got.row.type_code)}`, token);
        if (f.status !== 200 || f.json.total !== n1) finding('high', tier, 'filters', `Under calc system ${n}, filter type=${got.row.type_code} returned ${f.json && f.json.total}, the list has ${n1}.`);
      }
    }
  } finally {
    const back = await setSystem(origSystem);
    if (back.status !== 200) finding('high', tier, 'runner', `Could not restore the QA account to calc system ${origSystem} (${back.status}).`);
  }
  // The hub still renders the chart after all that.
  await page.evaluate(i => window.gmOpenChart && window.gmOpenChart(i), id).catch(() => {});
  await page.waitForTimeout(4000);
  await shot('chart-after-sequences');
}

(async () => {
  // Edge on John's Windows laptop, Playwright's own Chromium on GitHub's Linux runners (no Edge there).
  const browser = BROWSER === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch(process.platform === 'win32' ? { channel: 'msedge', headless: true } : { headless: true });
  const guard = setTimeout(() => { finding('medium', '-', 'runner', 'Hit the script time cap; results are partial.'); write(); process.exit(3); }, MAX_MS);
  try {
    for (const tier of TIERS) {
      if (!(tier in TIER_LEVEL)) { finding('low', tier, 'runner', 'Unknown tier name, skipped.'); continue; }
      if (timeLeft() < 90000) { results.notCovered.push(`${tier}: not run, out of time.`); continue; }
      await runTier(browser, tier);
      if (results.tiers[tier] && results.tiers[tier].steps.hubLoadMs !== undefined && !results.findings.some(f => f.tier === tier && f.severity === 'blocker')) {
        results.tiers[tier].steps.token = await runTokenTests(browser, tier, async (name, pg) => { try { await pg.screenshot({ path: path.join(OUT, `${tier}-${name}.png`) }); } catch {} });
      }
    }
  } finally {
    clearTimeout(guard);
    await browser.close();
    write();
  }
})();

function write() {
  const order = { blocker: 0, critical: 1, high: 2, medium: 3, low: 4 };
  results.findings.sort((a, b) => order[a.severity] - order[b.severity]);
  results.durationSec = Math.round((Date.now() - started) / 1000);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const lines = [`# Nightly raw results ${today}${BROWSER === 'webkit' ? ' (WebKit early warning, not a Safari-on-Mac pass)' : ''}`, '', `Base ${BASE}, browser ${BROWSER}, writes ${WRITES ? 'on' : 'off'}, ${results.durationSec}s.`, ''];
  for (const t of Object.values(results.tiers)) {
    lines.push(`- **${t.tier}**: tier claim ${t.steps.tierClaim ?? '?'}, people ${t.steps.peopleTotal ?? '?'}, create ${t.steps.create ? (t.steps.create.postStatus ?? 'no POST') : 'n/a'}`);
  }
  lines.push('', '## Findings', '');
  if (!results.findings.length) lines.push('None.');
  for (const f of results.findings) lines.push(`- [${f.severity}] ${f.tier} / ${f.area}: ${f.summary}`);
  if (results.notCovered.length) { lines.push('', '## Not covered', ''); for (const n of results.notCovered) lines.push(`- ${n}`); }
  fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
