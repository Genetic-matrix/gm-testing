// MaintVerify capture + compare. Staging only. Never prints the key or the token.
//   node maintverify.js            capture every mode, compare with the stored baselines
// Key: env GM_MAINTVERIFY_SECRET (falls back to the Windows user env, so no app restart is needed).
// Auth (Vladimir, 23 Sep): POST /Token/service {"ApiKey": key} -> token scoped to /MaintVerify.
// Compare rule (MaintVerify.md): JSON modes come back without the baseline's trailing CRLF, so trim
// trailing newlines on both sides, then an exact, case-sensitive string compare.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API = 'https://api.staginggm.com';
if (!/staginggm\.com$/.test(new URL(API).hostname)) { console.error('ABORT: not staging'); process.exit(2); }

function key() {
  if (process.env.GM_MAINTVERIFY_SECRET) return process.env.GM_MAINTVERIFY_SECRET.trim();
  try {
    const out = execSync('reg query HKCU\\Environment /v GM_MAINTVERIFY_SECRET', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/GM_MAINTVERIFY_SECRET\s+REG_\w+\s+(.+)/);
    if (m) return m[1].trim();
  } catch {}
  console.error('GM_MAINTVERIFY_SECRET is not set. Set it in Windows user environment variables (see RUNBOOK).');
  process.exit(2);
}

const BASE_DIR = path.join(__dirname, 'vladimir-baselines-2026-09-23');
const today = new Date().toISOString().slice(0, 10);
const OUT = path.join(__dirname, 'captures', today);
fs.mkdirSync(OUT, { recursive: true });
const MODES = [
  ['natal', 'mode=natal', 'verify_natal.txt'],
  ['topo', 'mode=topo', 'verify_topo.txt'],
  ['calendar', 'mode=calendar', 'verify_calendar.txt'],
  ['calendar_moon', 'mode=calendar&view=calendarMoon', 'verify_calendar_moon.txt'],
  ['cycles', 'mode=cycles', 'verify_cycles.txt'],
  ['panchanga', 'mode=panchanga', 'verify_panchanga.txt'],
  ['chinese', 'mode=chinese', 'verify_chinese.txt'],
];
const trimNl = s => s.replace(/[\r\n]+$/, '');

(async () => {
  const t = await fetch(`${API}/Token/service`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ApiKey: key() }) });
  const tj = await t.json().catch(() => ({}));
  const token = tj.AccessToken || tj.accessToken || tj.access_token || tj.token;
  console.log(`POST /Token/service -> ${t.status}${token ? ' (token received)' : ' (NO token; response keys: ' + Object.keys(tj).join(',') + ')'}`);
  if (!token) process.exit(1);

  const rows = [];
  for (const [name, q, file] of MODES) {
    const t0 = Date.now();
    const r = await fetch(`${API}/MaintVerify?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(path.join(OUT, `verify_${name}.txt`), buf);
    const got = trimNl(buf.toString('utf8'));
    const want = trimNl(fs.readFileSync(path.join(BASE_DIR, file), 'utf8'));
    let res;
    if (r.status !== 200) res = `HTTP ${r.status}: ${got.slice(0, 160)}`;
    else if (got === want) res = 'MATCH';
    else {
      let i = 0; while (i < got.length && got[i] === want[i]) i++;
      res = `DIFFER at char ${i} of ${want.length}: baseline "...${want.slice(Math.max(0, i - 40), i + 60)}" vs staging "...${got.slice(Math.max(0, i - 40), i + 60)}"`;
    }
    rows.push(`| ${name} | ${r.status} | ${Date.now() - t0} ms | ${res} |`);
    console.log(`${name}: ${res.slice(0, 300)}`);
  }
  const md = [`# MaintVerify capture ${today} (staging) vs Vladimir baselines 2026-09-23`, '', '| Mode | HTTP | Time | Result |', '|---|---|---|---|', ...rows, ''].join('\n');
  fs.writeFileSync(path.join(OUT, 'compare.md'), md);
})();
