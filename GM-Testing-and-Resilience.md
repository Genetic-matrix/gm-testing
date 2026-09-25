# GM Testing & Resilience

**Purpose.** Stop finding breakage weeks later, by accident. Catch regressions at the moment they happen, name the source, and never let a change reach a client untested. Build the foundations once so we can build fast without it blowing up at scale.

**Status.** DRAFT v1, 2026-09-23. Most of what follows is PLANNED, marked per item. Nothing here overstates what exists today.

**Owners.** Claude (builds and runs the testing; never writes live). Joseph (infra, deploys, backups, environments). Vladimir (engine correctness). John (approves, populates test data, signs off).

---

## Principles

1. **Catch at the change, not late.** A regression caught at the commit has one thing to blame. One found in three weeks has thirty.
2. **Fail loud, not silent.** Synchronous atomic writes, golden-master diffs, coverage monitors that should always read zero.
3. **Detect and propose.** Automated testing finds and reports; a human approves every change. Claude never writes to live.
4. **Staging first, recoverability always.** Every change proven on staging; backups and point-in-time recovery verified so nothing is unrecoverable.
5. **Least privilege, contained blast radius.** Access scoped so a mistake, or a compromised session, cannot delete everything or exfiltrate.

---

## Where we are weak (risk register)

- **No automated regression coverage, frontend or engine.** Regressions are found by John or a client, often weeks later, and by then many changes have shipped so the source is hard to trace. This is the core gap.
- **Frontend changes ship without a render/flow check.** 2026-09-22 a filter change silently broke chart creation (an audit class not present on live). PHP-lint passed, because it was a runtime path, not a syntax error. A 30-second "create a chart" check would have caught it.
- **Cherry-picked deploys, no true staging mirror.** We copy scoped files by hand; staging has drifted from live; unrelated workstreams ride the same branch. This is how audit code reached live inside a facets file. (ENV RESET planned: dedicated test box + staging as a true live mirror.)
- **Batch-generated derived data leaves silent holes.** Facet data is filled by a batch keyed on a flag, not written atomically with the person, so any skipped, failed or lagged record is an invisible gap. This is how ~816k records went blank. Fix = synchronous atomic write on every write path; monitor as backstop. **Heavy backfills are banned (John, 24 Sep):** derived data is written with the person at save; a gap is fixed at its cause, never by a mass backfill. `gm:drift-check` exists to catch gaps, not to justify refilling them.
- **Tier-gated behaviour only tested on whatever tier we happen to be logged into.** Pro-lock, Starter caps, greyed facets, upgrade prompts, calc-method gating all branch by tier and slip through untested.
- **Token / session sleep.** Charts grey after the token life (~1h) on a long-open hub. Fixed before; nothing guards the fix from regressing.
- **Single-human dependency on the engine and the save path.** Vladimir owns `/ClientPersonSave` and the engine; his availability gates everything, and his changes regress other things undetected because there is no golden-master under them.
- **Recoverability is not a verified routine.** The 2026-09-22 delete of 919 records was recovered only because a nightly backup happened to exist. That was luck, not a control.

---

## Where regressions likely hide (latent-bug candidates)

Risk areas, not confirmed bugs. The first sanitising sweep goes looking here for breakage that is *already* present.

- **Sequence / interaction breaks:** a change to X quietly breaks Y under a specific order of actions (yesterday's filter → create). Nothing exercises the combinations.
- **Engine edge cases with no golden-master:** odd dates, DST folds and gaps, high latitudes, pre-1970 births, the pet and plant chart types, the 9 calc systems, the design (88 degree) calc.
- **Deploy coupling:** unrelated code shipped together by a cherry-pick, activating on live when its supporting infra is not there.
- **Stale cache / token / session states:** hub served from stale localStorage or opcache; token expiry; the ~1h chart sleep.
- **Derived-data drift on any un-instrumented write path:** old-hub creates, imports, direct API writes, and every new system (topo) that adds rows.
- **Fixed once, regressed silently:** anything fixed months ago with no test guarding it can come back on the next unrelated change, and nobody would know until a customer does.

---

## What gets tested — coverage, cadence, status

| Layer | What it checks | Cadence | Status |
|---|---|---|---|
| PHP syntax | `php -l` on every changed `.php` | on push (GitHub Actions) | ACTIVE |
| Existing CI guards | nav-drift, i18n, chart-fit, hub-chrome | on push / PR | ACTIVE |
| Pre-deploy smoke | create a chart on staging before any live copy | every deploy | ACTIVE (manual, to automate). Did not catch the 22 Sep create-chart break: either skipped on that deploy or not covering that path. Not a working control until confirmed |
| Derived-data integrity | `gm:drift-check`: count people missing `gm_person_data` for ANY calc system, or flagged stale; alert on non-zero. Read-only | hourly | BUILT (gmlaravelweb), not scheduled until a clean baseline is watched; Slack alert needs `GM_MONITOR_WEBHOOK` set |
| Hub UI + flows | create, open chart, filters, tags, settings, search, per tier. Desktop only (new hub on mobile is stopped) | nightly + on hub deploy | BUILT (`routine/nightly.js`); waits only for Joseph's test-login key |
| Safari on Mac | real Safari pass on every hub change; Playwright WebKit and Chromium emulation do not count | every hub deploy, before live | ACTIVE rule, manual (whoever on the team has a Mac, one-screen script + screenshot); otherwise ship behind a kill-switch with a never-blank fallback |
| 7-language render | hub, reports, emails rendered in EN, FR, IT, ES, NL, DE, PT; any English bleed-through is a blocker | nightly + before any launch | PLANNED (the i18n CI guard covers keys only, not rendered output) |
| Tier / entitlement | what each tier actually sees (facets, caps, calc, prompts) | nightly, per tier | BUILT in nightly.js: facet lock flags, locked data not in payload, Starter 5-person cap, non-Pro calc-method 403 |
| Token / session | token death must be invisible: dead-token and stale-nonce scenarios per tier (people list, chart, Research); every 401 must self-recover, never a re-login (John, 23 Sep) | nightly + CI guard + live synthetic monitor (Joseph) | BUILT in nightly.js (runs once the test login exists); CI guard and fix with the hub session (F-004/005/006); live monitor NEEDED |
| Chart engine | golden-master corpus of known-correct charts, diffed | pre-deploy gate + nightly | STARTED: `/MaintVerify` (7 modes, fixture psId 339) captured from staging and compared nightly (`golden-master/maintverify.js`); natal independently verified vs Swiss Ephemeris; Astro Calendar bodies verified (18/18). Edge-case corpus still to build |
| Chart API / endpoints | contract tests (ClientPersonSave, render, people, facets), black-box through the staging tier logins: response shape, status, values match the hub; sequences (create, edit, switch calc, filter); every test create has `gm_person_data` for all 9 systems | pre-deploy + nightly | PLANNED (black-box needs test-login + confirmation that staging does not write to the live engine; full contract tests need repo) |
| Backups / recoverability | a backup exists and restores | daily | NEEDED |

---

## The routine (the "sanitising" loop)

- Runs when everyone is idle or asleep: a scheduled pass that logs in per tier, exercises the flows, runs the golden-master and the monitors, and hunts the latent-bug candidates above.
- **Detect and propose.** It produces a ranked findings report each morning. It changes nothing on its own.
- **Cost-bounded.** Each pass is real compute spend, so a scoped nightly run plus on-demand, never a continuous loop. Hard cap 45 minutes per night (John, 23 Sep).
- **Fixes happen in separate sessions, never in the test run.** One session per fix (or tight cluster), one commit each, deployed to staging after John's sign-off.
- **Findings ledger** (`GM-Testing/findings/LEDGER.md`): one row per finding with ID, first seen, tier, repro steps, status (open / fix committed `<sha>` / cleared `<date>` / reopened). Fix sessions record their commit; every nightly run retests each "fix committed" row and moves it to cleared or reopened. A cleared finding becomes a permanent step in the script, so it cannot quietly regress.
- **First area: chart creation and filters** (the 22 Sep break), across all 4 tiers.
- **First pass is a discovery sweep**, looking for regressions already present in the current code, not only new ones.
- Status: PLANNED, gated on the self-login harness.

---

## Golden-master corpus

_To be populated when Vladimir sends the chart engine repo (John, 23 Sep 2026)._

On repo access, build the corpus of known-correct charts and inline it here:
- **Coverage list** — every chart type, all 9 calc systems, the design (88 degree) calc, and the edge cases: DST folds and gaps, high latitudes, pre-1970 births, the pet and plant types.
- **Count per bucket**, so coverage is visible at a glance and gaps are obvious.
- **Baseline verification note** — each output checked against known-correct reference before it is frozen. Never snapshot a latent bug and call it golden.

Until then this section is a placeholder and the golden-master row in the table above stays PLANNED.

**First anchor (23 Sep):** Vladimir's `/MaintVerify` (staging `https://api.staginggm.com/`, fixture psId 339, 6 modes) and his 7 `verify_*.txt` baselines, stored with checksums in `golden-master/vladimir-baselines-2026-09-23/`. Chinese is externally validated, topo and cycles cross-checked; natal was independently checked here: 30 of 30 positions (Chiron included) match Swiss Ephemeris within 1 arcsecond, all lines consistent, Profile and Incarnation Cross match the canonical dump (`natal-independent-check.md`). Open: the gate wheel start the engine uses (one value, applied to sidereal longitudes) must be confirmed against the canonical source. One fixture only: the edge-case corpus above is still to build.

## Release gate: red team (John, 25 Sep, NON-NEGOTIABLE)

- **Nothing launches with an open VALID red-team finding unless John accepts it in writing.** Applies to the new app, every hub change, reports, public pages, published figures and campaigns.
- Before each launch a separate agent attacks it as hostile experts and users would: ranked by damage, verdict and fix per item. Scope always includes a picture-vs-text check (images, captions, alt text against the copy) and every figure checked against its source.
- **The test suites are red-teamed too:** what would they NOT catch (silent no-ops, controls that cannot fail, figures never compared to a source, screens never checked picture-vs-text). Every suite carries at least one check that must be NONZERO, because a zero-control passes a run that wrote nothing. `nightly.js` has these guards (25 Sep): facets returned, people present, filter queries actually run, at least one tier reached the hub.
- Launch checklist = nightly green on staging + red-team pass with no open VALID finding + real Safari-on-Mac pass for hub changes + John's written acceptance of anything left open.

## Environments & safe access

- **Never write to live. Ever.** Claude works on staging only. Live changes are a human copying reviewed files.
- **Environment, decided 24 Sep (John):** a new dual-Xeon server, same spec as live, is installed. Test and staging run on it; live runs alone on its own server. **Staging is a mirror of live and no developer writes to it directly.** Developers work on test, push test to staging, and only staging deploys to live. The nightly run tests staging, so what it passes is what goes live. **Chart engine APIs (24 Sep):** live, staging and test GmAPI all stay on the one existing Windows server in the live data centre (no second Windows box, John's call). Required isolation: separate IIS app pools with CPU/memory caps on staging and test, separate databases, no heavy staging/test jobs in member hours, app-pool-only restarts. API load is light and heavy jobs (backfills, topocentric diff, bulk recalcs) run on Beast, not on this box, so the residual risk is mainly a bad deploy or an IIS-wide restart.
- **Restore a real test / staging environment.** Today it is a cherry-pick "staging/test" hybrid that has drifted from live. We want a dedicated test box and staging as a true live mirror. (ENV RESET, targeted week of 28 Sep.)
- **Backups + PITR verified** before we lean on staging for anything destructive.
- **Access map, green / amber / red.** Green = UI, data, plumbing (Claude owns). Amber = writes, entitlements (Claude with review). Red = engine core (golden-master + review). The full component map is a separate deliverable.
- **Self-login harness.** Staging-only, IP-allowlisted endpoint plus per-tier test accounts, so testing runs unattended without a human logging Claude in. Requested from Joseph 2026-09-23.

---

## Enablers (what unblocks all of this)

1. **Self-login harness + per-tier test accounts** — requested from Joseph.
2. **Repo access to the chart engine / API** — for the golden-master, the contract tests, and the component map.
3. **A real test/staging environment + verified backups** — ENV RESET. **PRIORITY (John, 23 Sep):** the current test server is slow, low capacity and a mess, and is being replaced ASAP. Staging becomes a mirror copy of live, because anything else is not a proper testing platform. Until then, nightly findings are tagged "confirm on the mirror", since some will be staging mess rather than real bugs. **Mirror = functionality, not members** (John, 23 Sep; MemberMouse likely caps staging at ~100 users): same deployed code, same stack and plugin versions, same config shape, same reference and content tables, same engine version; members are only John's account plus the QA accounts. Scale and live-data bugs are covered separately: one QA account seeded with a large person list, and `gm:drift-check` run read-only on live by Joseph. Two further gaps, both closed without more MemberMouse accounts:
   - **Real-shaped records.** Copy a sample of real people (birth records, names scrubbed) into one QA account. MemberMouse caps members, not the people under a member, so thousands of odd legacy records (old-hub creates, imports, missing coordinates, unusual dates and time zones, special characters, partial calc systems) can live there.
   - **Rehearse data changes on a live-size copy.** Periodically restore the live backup onto a throwaway server (outbound mail and payments disabled) and rehearse migrations and backfills there. The same restore proves the backups work.
   - Mirror the caching and front-end layers too (CDN, Cloudflare, opcache), not only the code.
   - **Chain: live → staging → test** (John, 23 Sep). Test is a faithful copy of staging, made by the same refresh script, so development starts from exactly what staging runs. Some drift on test is tolerated (John, 23 Sep); it is reset from staging on demand, e.g. when it gets messy or before testing something that must match live, never on a timer that wipes work in progress. Staging only ever receives finished, reviewed changes. Test needs its own MemberMouse license (ask MemberMouse for a second staging license). Both can live on one server if it has the headroom.
4. **The golden-master corpus**, with its baseline verified against known-correct reference before it is frozen (never snapshot a latent bug and call it correct).

---

## Change log

- **2026-09-23 v1** — first draft (Claude), from the "build the foundations before we sprint again" decision.
- **2026-09-24 v1.3** — environment decided: new server (same spec as live) for test + staging, live alone; no direct developer writes to staging; path is test to staging to live.
- **2026-09-23 v1.2** — status rows updated end of day: hub flows, tiers, token test built; MaintVerify capture + natal and Astro Calendar independent checks; findings F-001 to F-010 in the ledger; staging outage (F-007) and live freeze.
- **2026-09-23 v1.1** — derived-data row corrected to BUILT (`gm:drift-check` committed); Safari-on-Mac and 7-language rows added; hub flows marked desktop only; pre-deploy smoke flagged after the 22 Sep miss.
