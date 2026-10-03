# LIVE hub check 2026-10-03 (read-only): 4/4 tiers reached the hub, 6 finding(s), 0 write(s) blocked.

Run 37101122416, started 2026-10-03T05:51:02.707Z, 6 min.

- **starter**: tier claim 0, people 0, chart tabs checked 0
- **plus**: tier claim 1, people 6, chart tabs checked 4
- **advanced**: tier claim 2, people 10, chart tabs checked 4
- **pro**: tier claim 3, people 16, chart tabs checked 4

## Findings

- [critical] starter / coverage: Live QA account has no people: seed it, or nothing below is tested.
- [critical] starter / runner: Tier run crashed: page.click: Timeout 30000ms exceeded.
- [high] starter / assets: LIVE: 1 script/data request(s) returned an HTML page instead (the cause of "Unexpected token '<'"): xhr https://www.geneticmatrix.com/wp-admin/admin-ajax.php -> HTTP 200 text/html
- [high] plus / assets: LIVE: 1 script/data request(s) returned an HTML page instead (the cause of "Unexpected token '<'"): xhr https://www.geneticmatrix.com/wp-admin/admin-ajax.php -> HTTP 200 text/html
- [high] advanced / assets: LIVE: 1 script/data request(s) returned an HTML page instead (the cause of "Unexpected token '<'"): xhr https://www.geneticmatrix.com/wp-admin/admin-ajax.php -> HTTP 200 text/html
- [high] pro / assets: LIVE: 1 script/data request(s) returned an HTML page instead (the cause of "Unexpected token '<'"): xhr https://www.geneticmatrix.com/wp-admin/admin-ajax.php -> HTTP 200 text/html

## Not covered

- starter: type filter not tested (the seed has 0 distinct value(s); needs 2+).
- starter: authority filter not tested (the seed has 0 distinct value(s); needs 2+).
- plus: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.
- advanced: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.
- pro: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.
