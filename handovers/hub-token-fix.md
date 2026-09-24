# Handover: hub token fix (start here)

Written 23 Sep 2026 16:05 by the Testing & Resilience session, for a fresh Opus 5.5 session. Read this whole page before touching code. Earlier work on this in "Hub Replacement - 1" is superseded by this page.

## Before you start

- **Start this session in `C:\Users\JY\Downloads`** (the old hub session's folder), so it loads the hub memory: about 30 `project_hub_*` / `feedback_*` notes on deploys, live API, filters, tier gating, the mobile gate, and staging mirroring live. Read `project_hub_active.md`, `project_deploy_path_to_live.md`, `project_hub_live_api_2026-09-07.md` and `feedback_staging_must_mirror_live.md` first.
- **Read the hub docs** in `C:\Users\JY\Working\Website-Dev\gm-web\docs\`: `WIRING-MAP.md`, `PRODUCTION-WIRING.md`, `live-promote-spec.md`.
- **Work in progress, uncommitted, from the old session** (`gm-web`, as of 16:06): about 100 lines in `hub-assets/hub-token.js`, `gm-hub-token.php` and `functions.php`, including a token-cache bust on MemberMouse membership/status changes. Run `git -C C:\Users\JY\Working\Website-Dev\gm-web diff` and review it before anything else. Build on it or rework it deliberately; do not discard it blind, and do not commit it unreviewed. It does not yet remove the nonce.
- Make sure "Hub Replacement - 1" is stopped before you edit, so two sessions are not changing the same files.

## The standard (John, 23 Sep)

"I never want a client experiencing this on live." A member must never see the hub token die: no error, no "Chart is not available", no dead dropdown or search, and never a request to log in again. Invisible, or it does not count.

## What is wrong (code-confirmed, theme `gm-web/wp-content/themes/geneticmatrix`, at commit 09819c2f)

Full rows in `GM-Testing/findings/LEDGER.md`.

- **F-004** `hub-assets/hub-research.js:19` copies `window.GM_TOKEN` once at load; its 4 fetches (lines ~125, 184, 603, 701) never renew. Research search dies when the token rolls.
- **F-005** `hub-assets/hub-token.js` only renews after a call has already failed (401), and `gm_hub_refresh_token_ajax` in `gm-hub-token.php` requires the page nonce (`check_ajax_referer`). A WordPress nonce dies 12 to 24 h after page load, so on a hub left open that long every renewal is refused, silently: the helper gets no token, retries with the dead one, and the member sees "not available".
- **F-006** 41 API call sites in 10 files send `window.GM_TOKEN` with plain `fetch` and no renew-and-retry: hub-inline-1.js 17, hub-inline-0.js 7, template-user-hub-tailwind.php 6, hub-research.js 4, hub-chart-builder.js 2, one each in hub-support-contact.js, hub-location.js, hub-inline-2.js, hub-education.js, hub-chart-styles.js. Find them: `grep -rnE "Bearer .*window\.GM_TOKEN|Bearer ' \+ TOKEN" gm-web/wp-content/themes/geneticmatrix`. Only hub-data.js, hub-chart-cascade.js, nav.js and part of hub-inline-1.js use `GmHubToken`.

Not causes (already checked): the WordPress token cache (`gm_hub_bootstrap_token`, at most 10 min, dropped 2 min before expiry) is fine. Laravel JWT life is 30 days by default (`config/hub.php` `jwt_ttl` 43200).

## The fix, in order, one commit per step

1. **One path for every call.** Route all 41 call sites plus Research through `window.GmHubToken.authedFetch` (in `hub-token.js`). No module keeps its own copy of the token. Keep each call's existing headers and body.
2. **Renew before expiry.** A timer in `hub-token.js` renews ahead of the token's `exp`, so no call ever meets a 401. Keep the 401 renew-and-retry as the backstop. Renewal failures must not be silent: log them to the console with a clear message.
3. **No page nonce on the renew endpoint**, the same way Logout was fixed (`gm_hub_logout_url_ajax` in `gm-hub-token.php` explains why). The WordPress session cookie is the real auth. **This is an auth change: get Joseph's OK before it ships**, even to staging.
4. **CI guard** that fails on any `window.GM_TOKEN` used directly in a fetch header outside `hub-token.js`, same style as the existing chart-fit guard in the theme's CI.

## Rules

- **Staging only. Live freeze** (John, 16:02): nothing from 23 Sep goes to live without John's sign-off, and every hub change also needs a real Safari-on-Mac pass before live.
- **The new hub is desktop only.** Do not build or test mobile layouts.
- **No audit code, anywhere.** The audit project is shelved permanently (John: "it is a cancer"). Do not add, restore or call anything audit.
- Any new visible text goes through `gm_t()` with keys, in all 7 languages. No English bleed-through.
- Your CLAUDE.md rules apply in full: PHP single-quote escaping, no em dashes, ask before long autonomous runs.

## Done means the test passes, not that you say so

You do not mark this done. `GM-Testing/routine/nightly.js`, function `runTokenTests`, runs two scenarios on all 4 tiers:
- **dead-token**: token swapped for an expired one;
- **stale-nonce**: dead token plus an invalid refresh nonce (a hub left open all day).

For each, it opens the people list, a chart and a Research search. It passes only if every 401 recovers by itself and "not available" never appears. It needs Joseph's `/gm-test-login`, not built yet. When you commit a step, set its ledger row to `fix committed <sha>`. Only the nightly run sets `cleared`.

## Related, not yours unless John says

- gmlaravelweb `GeneticMatrixLookupService::token()` logs into GmAPI `/Token` with GET. Vladimir briefly made staging `/Token` POST-only and staging broke (F-007); GET is re-enabled. The POST switch in gmlaravelweb must be committed and live before GmAPI goes POST-only on live.
- A live alert for token-failure spikes is Joseph's infra.
