# LIVE hub check 2026-10-02 (read-only): 4/4 tiers reached the hub, 7 finding(s), 0 write(s) blocked.

Run 36986680050, started 2026-10-02T08:54:38.234Z, 6 min.

- **starter**: tier claim 0, people 0, chart tabs checked 0
- **plus**: tier claim 1, people 6, chart tabs checked 4
- **advanced**: tier claim 2, people 10, chart tabs checked 4
- **pro**: tier claim 3, people 16, chart tabs checked 4

## Findings

- [critical] starter / coverage: Live QA account has no people: seed it, or nothing below is tested.
- [critical] starter / research: LIVE Research search returned HTTP 402.
- [critical] starter / token: LIVE token-death test INCONCLUSIVE: no 401 after killing the token, so the dead token was never exercised.
- [high] starter / console: 2 console error(s) on the LIVE hub.
- [high] plus / console: 2 console error(s) on the LIVE hub.
- [high] advanced / console: 2 console error(s) on the LIVE hub.
- [high] pro / console: 2 console error(s) on the LIVE hub.

## Not covered

- starter: type filter not tested (the seed has 0 distinct value(s); needs 2+).
- starter: authority filter not tested (the seed has 0 distinct value(s); needs 2+).
- starter: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.
- plus: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.
- advanced: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.
- pro: stale-nonce renewal (hub open 12-24 h) not tested on live; covered on staging.
