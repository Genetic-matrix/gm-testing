// Diagnostic for the staging test login. Never prints the key.
// Expected once Joseph's .htaccess exception is in:
//   real key  -> past basic auth (login redirect or 200, not 401)
//   fake key  -> 401 (the exception must match the exact value, not just the header's presence)
//   no key    -> 401
const { execSync } = require('child_process');
const k = (process.env.GM_TEST_LOGIN_KEY || execSync('reg query HKCU\\Environment /v GM_TEST_LOGIN_KEY', { encoding: 'utf8' })
  .match(/GM_TEST_LOGIN_KEY\s+REG_\w+\s+(.+)/)[1]).trim();
const cases = [
  ['real key', { 'X-GM-Test-Key': k }, s => s !== 401],
  ['fake key', { 'X-GM-Test-Key': 'not-the-key-' + Date.now() }, s => s === 401],
  ['no key', {}, s => s === 401],
];
(async () => {
  let ok = true;
  for (const [lbl, h, pass] of cases) {
    const r = await fetch('https://www.staginggm.com/gm-test-login?account=plus', { headers: h, redirect: 'manual' });
    const t = (await r.text()).split(k).join('***');
    const good = pass(r.status);
    ok = ok && good;
    console.log(`${good ? 'PASS' : 'FAIL'}  ${lbl}: ${r.status} ${r.headers.get('location') || ''} ${r.headers.get('www-authenticate') || ''}`);
    if (!good) console.log('   ' + t.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
  }
  process.exit(ok ? 0 : 1);
})();
