// Diagnostic for the staging test login. Never prints the key.
// Expected once Joseph's .htaccess exception is in:
//   real key  -> past basic auth (login redirect or 200, not 401)
//   fake key  -> 401 (the exception must match the exact value, not just the header's presence)
//   no key    -> 401
const { execSync } = require('child_process');
const k = (process.env.GM_TEST_LOGIN_KEY || execSync('reg query HKCU\\Environment /v GM_TEST_LOGIN_KEY', { encoding: 'utf8' })
  .match(/GM_TEST_LOGIN_KEY\s+REG_\w+\s+(.+)/)[1]).trim();
function envOrUser(name) {
  if (process.env[name]) return process.env[name].trim();
  try {
    const out = require('child_process').execSync(`reg query HKCU\Environment /v ${name}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(new RegExp(name + '\s+REG_\w+\s+(.+)'));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}
const CFI = envOrUser('GM_CF_ACCESS_CLIENT_ID'), CFS = envOrUser('GM_CF_ACCESS_CLIENT_SECRET');
const cf = CFI && CFS ? { 'CF-Access-Client-Id': CFI, 'CF-Access-Client-Secret': CFS } : {};
// Blocked = 401 (basic auth) or a redirect to the Cloudflare Access login. Anything else got through.
const blocked = (s, loc) => s === 401 || /cloudflareaccess\.com/i.test(loc || '');
const cases = [
  ['real key', { ...cf, 'X-GM-Test-Key': k }, (s, loc) => !blocked(s, loc)],
  ['fake key', { ...cf, 'X-GM-Test-Key': 'not-the-key-' + Date.now() }, (s, loc) => blocked(s, loc)],
  ['no key', { ...cf }, (s, loc) => blocked(s, loc)],
];
(async () => {
  let ok = true;
  for (const [lbl, h, pass] of cases) {
    const r = await fetch('https://www.staginggm.com/gm-test-login?account=plus', { headers: h, redirect: 'manual' });
    let t = (await r.text()).split(k).join('***'); if (CFS) t = t.split(CFS).join('***');
    const good = pass(r.status, r.headers.get('location'));
    ok = ok && good;
    console.log(`${good ? 'PASS' : 'FAIL'}  ${lbl}: ${r.status} ${(r.headers.get('location') || '').split('?')[0]} ${r.headers.get('www-authenticate') || ''}  (Cloudflare token sent: ${Object.keys(cf).length ? 'yes' : 'no'})`);
    if (!good) console.log('   ' + t.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
  }
  process.exit(ok ? 0 : 1);
})();
