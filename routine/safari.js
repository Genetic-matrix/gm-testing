// Real-Safari nightly on a GitHub macOS runner (safaridriver + Selenium). DETECT ONLY, staging only.
// Approved by John 25 Sep 2026 (handovers/safari-nightly.md). This is real Safari, unlike the WebKit
// pass in nightly.js. It still does not replace the manual Safari-on-Mac check for anything new going live.
//
// Login: Safari cannot send custom headers, so the test key goes in as a cookie `gm_test_key` on the
// staging domain (Joseph enables that route on STAGING only). Until he has, login fails and the run
// reports that as a blocker, never as a pass.
//
// Paths are reported one per line as PASS, FAIL or NOT COVERED. NOT COVERED means this script does not
// yet check that path for real; the manual Safari check must cover it. A path is never passed by default.
//
// Env: GM_TEST_LOGIN_KEY (secret), GM_STAGING_BASE (default https://www.staginggm.com), GM_SAFARI_TIER (default pro)

const { Builder, By, until } = require('selenium-webdriver');
const safari = require('selenium-webdriver/safari');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.GM_STAGING_BASE || 'https://www.staginggm.com').replace(/\/+$/, '');
const HUB = BASE + (process.env.GM_HUB_PATH || '/user-hub-tailwind/');
const KEY = (process.env.GM_TEST_LOGIN_KEY || '').trim();
const TIER = process.env.GM_SAFARI_TIER || 'pro';
const today = new Date().toISOString().slice(0, 10);
const OUT = path.join(__dirname, '..', 'findings', today, 'safari');
fs.mkdirSync(OUT, { recursive: true });

if (!/(^|\.)staginggm\.com$/i.test(new URL(BASE).hostname)) { console.error('ABORT: not staging'); process.exit(2); }
if (!KEY) { console.error('GM_TEST_LOGIN_KEY is not set.'); process.exit(2); }

const paths = [];   // { n, name, result: PASS|FAIL|NOT COVERED, note }
const mark = (n, name, result, note = '') => { paths.push({ n, name, result, note }); console.log(`${result.padEnd(11)} ${n}. ${name}${note ? ': ' + note : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let driver;
async function shot(name) { try { fs.writeFileSync(path.join(OUT, `${name}.png`), await driver.takeScreenshot(), 'base64'); } catch {} }
const js = (fn, ...args) => driver.executeScript(fn, ...args);

// The biggest visible chart element inside the chart card, and whether it has real size.
const CHART_STATE = `
  var card = document.getElementById('cs-card') || document.getElementById('cs-content');
  if (!card) return { ok: false, why: 'no chart card' };
  var best = null, area = 0;
  card.querySelectorAll('svg, object, img, iframe, canvas').forEach(function (el) {
    var r = el.getBoundingClientRect(), a = r.width * r.height;
    if (a > area && getComputedStyle(el).visibility !== 'hidden') { area = a; best = el; }
  });
  if (!best) return { ok: false, why: 'no chart element' };
  var r = best.getBoundingClientRect();
  var loaded = best.tagName === 'IMG' ? (best.complete && best.naturalWidth > 0) : true;
  return { ok: r.width > 200 && r.height > 200 && loaded, tag: best.tagName, w: Math.round(r.width), h: Math.round(r.height), loaded: loaded };`;

(async () => {
  const started = Date.now();
  driver = await new Builder().forBrowser('safari').setSafariOptions(new safari.Options()).build();
  try {
    await driver.manage().window().setRect({ width: 1440, height: 900 });

    // Login through the cookie route.
    await driver.get(BASE + '/robots.txt');   // any page on the domain, so the cookie can be set for it
    await driver.manage().addCookie({ name: 'gm_test_key', value: KEY, path: '/', secure: true });
    await driver.get(`${BASE}/gm-test-login?account=${TIER}`);
    await driver.get(HUB);
    await driver.wait(async () => js('return !!window.GM_TOKEN'), 30000).catch(() => {});
    const token = await js('return window.GM_TOKEN || ""');
    await shot('00-hub');
    if (!token) {
      mark(0, 'Login and hub load', 'FAIL', 'no hub token: the cookie route is not in place yet, or login failed. Nothing else could be tested.');
      return;
    }
    mark(0, 'Login and hub load', 'PASS', `tier ${TIER}`);

    // 1. My People loads; filter rail present.
    await js("window.gmShowView && window.gmShowView('my-people.html')");
    await sleep(3000);
    const ppl = await js('return { n: (window.PEOPLE || []).length, rail: document.querySelectorAll("#chartRail > *").length }');
    await shot('01-people');
    if (!ppl.n) mark(1, 'My People loads', 'FAIL', 'no people in the list (or the QA account is empty: seed it)');
    else mark(1, 'My People loads', ppl.rail ? 'PASS' : 'FAIL', `${ppl.n} people, ${ppl.rail} filter rail items`);
    mark('1b', 'A filter changes the list', 'NOT COVERED', 'filter click not scripted yet; Chromium nightly checks the filter counts');

    // 2. Open three charts and switch tabs: no blank chart (pane pool; WebKit drops display:none objects).
    const ids = await js('return (window.PEOPLE || []).slice(0, 3).map(function (p) { return p.id; })');
    if (ids.length < 3) mark(2, 'Three charts, switch tabs, none blank', 'FAIL', `only ${ids.length} people to open`);
    else {
      const blank = [];
      for (const id of ids) {
        await js('window.gmShowView && window.gmShowView("chart-space.html"); window.gmOpenChart && window.gmOpenChart(arguments[0]);', id);
        await sleep(5000);
      }
      const tabs = await driver.findElements(By.css('#chartTabs > *'));
      for (let i = 0; i < tabs.length; i++) {
        await tabs[i].click().catch(() => {});
        await sleep(2500);
        const st = await js(CHART_STATE);
        await shot(`02-tab-${i + 1}`);
        if (!st.ok) blank.push(`tab ${i + 1}: ${st.why || `${st.tag} ${st.w}x${st.h} loaded=${st.loaded}`}`);
      }
      if (tabs.length < 3) mark(2, 'Three charts, switch tabs, none blank', 'FAIL', `${tabs.length} tabs after opening 3 charts`);
      else mark(2, 'Three charts, switch tabs, none blank', blank.length ? 'FAIL' : 'PASS', blank.join('; '));
    }

    mark(3, 'Chart and View dropdowns redraw the chart', 'NOT COVERED', 'dropdown clicks not scripted yet');
    mark(4, 'Click a chart point opens the left panel', 'NOT COVERED', 'needs a stable point selector');
    mark(5, 'Export PDF and JPG download', 'NOT COVERED', 'downloads are not visible to safaridriver');

    // 6. Create a test person through the form, its chart opens, then delete ONLY that person.
    const name = `QA Safari ${today}`;
    await js("window.gmShowView && window.gmShowView('create-person.html')");
    await sleep(1500);
    try {
      await driver.findElement(By.id('cp-name')).sendKeys(name);
      await driver.findElement(By.id('cp-country')).sendKeys('United Kingdom');
      await sleep(800);
      await js("var o=[].slice.call(document.querySelectorAll('#cp-country-menu .cp-opt')).find(function(x){return /United Kingdom/.test(x.textContent)}); if(o) o.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));");
      await js("var d=document.getElementById('cp-dob'); d.value='1985-06-15'; d.dispatchEvent(new Event('input',{bubbles:true})); var t=document.getElementById('cp-time'); t.value='14:30'; t.dispatchEvent(new Event('input',{bubbles:true}));");
      await driver.findElement(By.id('cp-place')).sendKeys('London');
      await sleep(2500);
      await js("var o=document.querySelector('#cp-place-menu .cp-opt'); if(o) o.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));");
      await driver.findElement(By.id('cp-create-person')).click();
      await driver.wait(async () => /Created|Could not|limit|Upgrade/i.test(await js("return (document.getElementById('cp-person-msg')||{}).textContent||''")), 60000).catch(() => {});
      const msg = await js("return (document.getElementById('cp-person-msg')||{}).textContent||''");
      await sleep(5000);
      const st = await js(CHART_STATE);
      await shot('06-created');
      const created = await js('return ((window.PEOPLE||[]).find(function(p){return p.name===arguments[0]})||{}).id||null', name);
      if (!/Created/i.test(msg)) mark(6, 'Create a person, chart opens', 'FAIL', `form said "${msg.trim()}"`);
      else mark(6, 'Create a person, chart opens', st.ok ? 'PASS' : 'FAIL', st.ok ? '' : `chart after create: ${st.why || `${st.tag} ${st.w}x${st.h}`}`);
      // Delete only the person this run created, identified by id AND the QA name.
      if (created) {
        const del = await js('var cb=arguments[arguments.length-1]; window.gmHubData.write.deletePerson(arguments[0]).then(function(){cb("ok")}, function(e){cb("error: "+(e&&e.message))});', created)
          .catch(e => 'error: ' + e.message);
        mark('6b', 'Delete that test person', del === 'ok' ? 'PASS' : 'FAIL', del === 'ok' ? '' : del);
      } else if (/Created/i.test(msg)) mark('6b', 'Delete that test person', 'FAIL', 'created but not found in the list to delete; it is left in the QA account');
    } catch (e) { mark(6, 'Create a person, chart opens', 'FAIL', 'form could not be driven: ' + e.message.split('\n')[0]); }

    // 7. Research: search a celebrity.
    await js("window.gmShowView && window.gmShowView('research.html')");
    try {
      const q = await driver.wait(until.elementLocated(By.id('gmr-q')), 10000);
      const before = await js("return (document.getElementById('gm-research-root')||{}).innerText.length||0");
      await q.sendKeys('Einstein');
      await driver.findElement(By.id('gmr-search')).click();
      await sleep(5000);
      const after = await js("var r=document.getElementById('gm-research-root'); return { len: r ? r.innerText.length : 0, hit: r ? /Einstein/i.test(r.innerText) : false }");
      await shot('07-research');
      mark(7, 'Research search', after.hit && after.len > before ? 'PASS' : 'FAIL', after.hit ? '' : 'no result mentioning Einstein');
      mark('7b', 'Open a celebrity page from Research', 'NOT COVERED', 'result click not scripted yet');
    } catch (e) { mark(7, 'Research search', 'FAIL', e.message.split('\n')[0]); }

    mark(8, 'Settings change saves and survives reload', 'NOT COVERED', 'settings form not scripted yet');

    // 9. Dark theme: toggle the class the hub uses and check a chart still renders. Not the UI toggle itself.
    mark(9, 'Dark theme toggle (UI control)', 'NOT COVERED', 'toggle control not scripted yet');

    mark(10, 'Messages panel and Logout', 'NOT COVERED', 'not scripted yet');

    // 11. Chart size: + twice, reload, still enlarged; then back to fit.
    try {
      if (ids.length) { await js('window.gmShowView && window.gmShowView("chart-space.html"); window.gmOpenChart && window.gmOpenChart(arguments[0]);', ids[0]); await sleep(4000); }
      const plus = await driver.findElement(By.css('[data-cs-zoom="1"]'));
      await plus.click(); await sleep(500); await plus.click(); await sleep(800);
      const z1 = await js("try { return localStorage.getItem('gm_hub_chart_zoom'); } catch (e) { return 'unreadable'; }");
      await driver.navigate().refresh();
      await sleep(6000);
      const z2 = await js("try { return localStorage.getItem('gm_hub_chart_zoom'); } catch (e) { return 'unreadable'; }");
      await shot('11-zoom-after-reload');
      const fit = await driver.findElements(By.css('[data-cs-zoom="0"]'));
      if (fit.length) { await fit[0].click().catch(() => {}); }
      const kept = z1 && z1 !== '0' && z1 === z2;
      mark(11, 'Chart size + twice, survives reload', kept ? 'PASS' : 'FAIL', `stored before reload ${z1}, after ${z2}`);
    } catch (e) { mark(11, 'Chart size + twice, survives reload', 'FAIL', e.message.split('\n')[0]); }
  } catch (e) {
    mark('x', 'Run', 'FAIL', 'crashed: ' + e.message.split('\n')[0]);
    await shot('crash');
  } finally {
    const counts = paths.reduce((c, p) => (c[p.result] = (c[p.result] || 0) + 1, c), {});
    const md = [`# Real Safari (macOS) ${today}, tier ${TIER}`, '', `PASS ${counts.PASS || 0}, FAIL ${counts.FAIL || 0}, NOT COVERED ${counts['NOT COVERED'] || 0}, ${Math.round((Date.now() - started) / 1000)}s.`, '',
      'NOT COVERED paths still need the manual Safari-on-Mac check.', '', '| # | Path | Result | Note |', '|---|---|---|---|',
      ...paths.map(p => `| ${p.n} | ${p.name} | ${p.result} | ${String(p.note).replace(/\|/g, '/')} |`), ''].join('\n');
    fs.writeFileSync(path.join(OUT, 'summary.md'), md);
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ date: today, tier: TIER, paths }, null, 2));
    if (driver) await driver.quit().catch(() => {});
  }
})();
