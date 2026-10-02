# LIVE hub check 2026-10-02 (read-only): 4/4 tiers reached the hub, 11 finding(s), 0 write(s) blocked.

Run 36987417081, started 2026-10-02T09:02:28.769Z, 6 min.

- **starter**: tier claim 0, people 0, chart tabs checked 0
- **plus**: tier claim 1, people 6, chart tabs checked 4
- **advanced**: tier claim 2, people 10, chart tabs checked 4
- **pro**: tier claim 3, people 16, chart tabs checked 4

## Findings

- [critical] starter / coverage: Live QA account has no people: seed it, or nothing below is tested.
- [critical] starter / token: LIVE token-death test INCONCLUSIVE: no 401 after killing the token, so the dead token was never exercised.
- [high] starter / research: LIVE: Starter is correctly refused Research, but sees no upgrade message: the search just fails silently.
- [high] starter / console: 1 console error(s) on the LIVE hub.
- [high] starter / assets: LIVE: 3 script/data request(s) returned an HTML page instead (the cause of "Unexpected token '<'"): xhr https://www.geneticmatrix.com/wp-admin/admin-ajax.php -> HTTP 200 text/html; script https://www.geneticmatrix.com/wp-content/themes/geneticmatrix/hub-assets/hub-location.js -> HTTP 301 text/html
- [high] plus / console: 1 console error(s) on the LIVE hub.
- [high] plus / assets: LIVE: 3 script/data request(s) returned an HTML page instead (the cause of "Unexpected token '<'"): xhr https://www.geneticmatrix.com/wp-admin/admin-ajax.php -> HTTP 200 text/html; script https://www.geneticmatrix.com/wp-content/themes/geneticmatrix/hub-assets/hub-location.js -> HTTP 301 text/html
- [high] advanced / console: 1 console error(s) on the LIVE hub.
- [high] advanced / assets: LIVE: 3 script/data request(s) returned an HTML page instead (the cause of "Unexpected token '<'"): xhr https://www.geneticmatrix.com/wp-admin/admin-ajax.php -> HTTP 200 text/html; script https://www.geneticmatrix.com/wp-content/themes/geneticmatrix/hub-assets/hub-location.js -> HTTP 301 text/html
- [high] pro / console: 1 console error(s) on the LIVE hub.
- [high] pro / assets: LIVE: 3 script/data request(s) returned an HTML page instead (the cause of "Unexpected token '<'"): xhr https://www.geneticmatrix.com/wp-admin/admin-ajax.php -> HTTP 200 text/html; script https://www.geneticmatrix.com/wp-content/themes/geneticmatrix/hub-assets/hub-location.js -> HTTP 301 text/html

## Not covered

- starter: type filter not tested (the seed has 0 distinct value(s); needs 2+).
- starter: authority filter not tested (the seed has 0 distinct value(s); needs 2+).
- starter: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.
- plus: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.
- advanced: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.
- pro: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.
