# GM Testing & Resilience — workspace (START HERE)

Orchestration home for GM's testing/resilience initiative. A **dedicated Claude session** should work
here plus the repos below, instead of piling testing onto a general session.

## Working directories for the testing session
- **This folder** (`GM-Testing/`) — the plan, the component map, routine scripts, findings.
- **gmlaravelweb** — the Laravel API. The drift monitor lives here.
- **gm-web** — the WordPress theme / hub. Frontend flow tests.
- **the chart engine repo** — WHEN Vladimir sends it (for the golden-master).

## Layout
- `GM-Testing-and-Resilience.md` — the living plan: weak spots, coverage + cadence table, the routine, governance.
- `golden-master/` — the known-correct chart corpus (built when the engine repo lands).
- `routine/` — nightly / scheduled test scripts.
- `findings/` — dated findings reports from each run.

## Current state (end of 2026-09-23)

**Built**
- `routine/nightly.js`: per-tier login via `/gm-test-login`, facets and entitlement, filter counts, create through the real form, edit and calc-method sequences, token-death tests (dead-token, stale-nonce). `routine/RUNBOOK.md` is the nightly session's instructions (00:00, 45-min cap, frank report, Joseph draft while John is away).
- `golden-master/maintverify.js`: captures Vladimir's `/MaintVerify` from staging and compares with his 7 baselines (`vladimir-baselines-2026-09-23/`, checksummed). Natal independently verified (`natal-independent-check*.md`), Astro Calendar bodies verified (`calendar/`).
- `findings/LEDGER.md`: F-001 to F-010.
- `gm:drift-check` in gmlaravelweb (pushed 00e0374).
- `handovers/hub-token-fix.md`: the token fix brief (hub session is on it).

**Waiting on**
- Joseph: test-login key by email (then set `GM_TEST_LOGIN_KEY`, first run with creates on, then schedule 00:00); drift-check baselines; new server (Easyspace E5, ordered 23 Sep).
- Vladimir: design-time frame (F-009), wheel start confirmation, live `/Token` still GET, `chinese_astro` (F-002), lock psId 339.
- Hub session: token fix follow-ups, commit the mobile gate (F-010), step 3 nonce via Joseph.

**Rules:** Claude never writes to live. Staging only. Detect and propose. Live freeze on 23 Sep changes until John signs off. Full detail in memory `project-nightly-testing.md`.
