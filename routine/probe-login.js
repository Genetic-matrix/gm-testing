// One-off diagnostic: what does /gm-test-login return? Never prints the key.
const { execSync } = require('child_process');
const out = execSync('reg query HKCU\\Environment /v GM_TEST_LOGIN_KEY', { encoding: 'utf8' });
const k = out.match(/GM_TEST_LOGIN_KEY\s+REG_\w+\s+(.+)/)[1].trim();
(async () => {
  for (const [lbl, h] of [['with key', { 'X-GM-Test-Key': k }], ['no key', {}]]) {
    const r = await fetch('https://www.staginggm.com/gm-test-login?account=plus', { headers: h, redirect: 'manual' });
    const t = (await r.text()).split(k).join('***');
    console.log('==', lbl, r.status, r.headers.get('location') || '', r.headers.get('content-type'), r.headers.get('www-authenticate') || '');
    console.log(t.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 700));
  }
})();
