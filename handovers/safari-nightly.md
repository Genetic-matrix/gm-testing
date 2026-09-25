# Handover: real-Safari nightly (approved by John, 25 Sep 2026)

From GM1 - Hub Replacement - 1. John: every hub test includes Safari on a Mac; the new hub has never been run in Safari.

## What
A second job in `.github/workflows/nightly.yml` on a GitHub **macOS** runner, driving **real Safari** through `safaridriver` (`sudo safaridriver --enable`, then WebDriver via Selenium or WebdriverIO). Playwright WebKit does not count. Keep the run near 10 minutes (about $20 to $25 a month of Mac minutes).

## Paths (desktop 1440x900, one tier account to start)
1. My People loads; a filter changes the list.
2. Open three charts, switch tabs: no blank chart (pane pool; WebKit tears down `display:none` objects, the hub uses `visibility:hidden`).
3. Change Chart and View dropdowns: the chart redraws.
4. Interactive (hand): click a chart point, the left panel opens.
5. Export PDF and JPG download.
6. Create Chart for a test person, its chart opens, then delete it.
7. Research: search a celebrity, open the page.
8. Settings: change one, save, reload, it stayed.
9. Dark theme on and off.
10. Messages panel opens; Logout works.
11. Chart size: `[data-cs-zoom="1"]` twice, reload, still enlarged (`localStorage.gm_hub_chart_zoom`), `[data-cs-zoom="0"]` back to fit.

Screenshot on every failure; same frank report format as the Chromium nightly.

## Blockers
- `safaridriver` cannot send the `X-GM-Test-Key` header. Asked Joseph (DM, 25 Sep): on STAGING ONLY, `/gm-test-login` also accepts the key as a cookie `gm_test_key` (same PHP check, still 404 on live). Set the cookie on the staging domain before the first navigation.
- Joseph is moving staging from basic auth to Cloudflare Access. Safari cannot send the service-token headers either, so the runner needs the same cookie route or an Access bypass.

## Rules
Detect and report only, never write live. Joseph messages by DM only, not #v-stech. Memory: `project_gm_testing_resilience.md` (25 Sep entry), `feedback_every_test_includes_safari.md`.
