# MaintVerify — guide for another Claude

You are being asked to use the **`GET /MaintVerify`** endpoint of the GmAPI service.
This note tells you what it is, how to call it, and how to check its output. Read it
before making any request.

## What it is

`MaintVerify` runs one of the `GmBenchmark` **`verify`** producers against a fixed
fixture person (default `psId 339`) and returns the result over HTTP. It is a
**post-deploy smoke test**: it proves the compute path + Swiss Ephemeris files +
database are correctly wired on a running server. The output is **deterministic** —
for a given fixture and ephemeris it is byte-stable, so you can compare it against
the checked-in golden baselines in `GmBenchmark/baselines/`.

The endpoint and the console harness share one implementation
(`Gm.Core.Helpers.ChartDiagnostics`), so `GET /MaintVerify?mode=natal` returns the
same chart the console `GmBenchmark.exe verify` prints (see the trailing-newline note
below for the one formatting difference).

It does **not** compare against the baselines itself — the server has no repo. It
returns the computed output; **you** do the comparison.

## Requirements (why it can fail)

- **The service must be reachable** and running the current build.
- **The database and `DATA_FOLDER` ephemeris must be present on that server.** Verify
  needs both. On a box without them the call fails (commonly a 500 / error payload,
  or a `NullReferenceException` fetching the fixture's settings). This is why it only
  works where the real deployment lives, not on an arbitrary dev box.
- **`mode=topo` needs the fixture's elevation set.** The `psId 339` row must have
  `elevation = 80` (metres) for `verify_topo.txt` to reproduce; a different/0 value
  shifts the topocentric longitudes.
- **Auth is required.** `MaintVerify` is JWT-protected (it is in the `Maint` family).
  A request without a valid `Authorization: Bearer <token>` header gets **401**.

## Step 1 — get a JWT

`GET /Token?username=<u>&password=<p>` is anonymous and returns
`{ AccessToken, TokenType: "Bearer", ExpiresIn, ExpiresAtUtc }`. Ask the operator for
credentials — do not guess or hard-code them. Use `AccessToken` as the bearer token.

## Step 2 — call MaintVerify

```
GET /MaintVerify?mode=<mode>&psId=<id>&view=<view>&fromYear=<y>&toYear=<y>
Authorization: Bearer <token>
```

Parameters (all optional):

| Param      | Default              | Applies to        | Notes |
|------------|----------------------|-------------------|-------|
| `mode`     | `natal`              | —                 | One of the modes below. Unknown → **400**. |
| `psId`     | `339`                | chart modes       | Fixture person id. Ignored by `panchanga`/`chinese`. |
| `view`     | mode-specific        | `natal`/`topo`/`calendar` | Override the chart view. Leave unset to reproduce a baseline. |
| `fromYear` | `1882`               | `chinese`         | First year. |
| `toYear`   | `2043`               | `chinese`         | Last year. |

### Modes and their baselines

| `mode`      | Returns        | Content-Type       | Baseline file (in `GmBenchmark/baselines/`) |
|-------------|----------------|--------------------|---------------------------------------------|
| `natal`     | chart JSON     | `application/json` | `verify_natal.txt` |
| `topo`      | chart JSON     | `application/json` | `verify_topo.txt` (needs fixture elevation 80) |
| `calendar`  | chart JSON     | `application/json` | `verify_calendar.txt` (default view `calendarWeek`) |
| `cycles`    | chart JSON     | `application/json` | `verify_cycles.txt` |
| `panchanga` | text listing   | `text/plain`       | `verify_panchanga.txt` |
| `chinese`   | text listing   | `text/plain`       | `verify_chinese.txt` |

(The moon-calendar baseline `verify_calendar_moon.txt` corresponds to
`mode=calendar&view=calendarMoon`.)

## Step 3 — compare against the baseline

Two things to know before you diff:

1. **Encoding is clean over HTTP.** The response body is UTF-8, so the `·` (U+00B7)
   characters some descriptions contain come back as `C2 B7`, matching the baseline
   files' UTF-8. You do **not** have the OEM-codepage gotcha the console harness has —
   save the HTTP body as UTF-8 and it lines up.

2. **The JSON modes omit one trailing newline.** The baselines were written by the
   console via `WriteLine`, which appends a trailing CRLF. The endpoint returns the
   raw string with **no** trailing newline for the JSON modes (`natal`/`topo`/
   `calendar`/`cycles`). So the endpoint body equals the baseline **minus its trailing
   `\r\n`**. Compare after trimming trailing newline on both sides. (`panchanga` and
   `chinese` already end in a trailing CRLF and match the baseline exactly.)

### PowerShell recipe

```powershell
$base = "C:\Projects\GeneticMatrix\GmBenchmark\baselines"
$host = "https://<server>"          # the real deployment
$tok  = (Invoke-RestMethod "$host/Token?username=<u>&password=<p>").AccessToken
$hdr  = @{ Authorization = "Bearer $tok" }

# natal (a JSON mode)
Invoke-WebRequest "$host/MaintVerify?mode=natal" -Headers $hdr -OutFile "$env:TEMP\mv_natal.txt"

$got  = (Get-Content "$env:TEMP\mv_natal.txt" -Raw -Encoding UTF8).TrimEnd("`r","`n")
$want = (Get-Content "$base\verify_natal.txt" -Raw -Encoding UTF8).TrimEnd("`r","`n")
if ($got -ceq $want) { "MATCH" } else { "DIFFER" }   # -ceq = case-sensitive, byte-faithful
```

For a visible diff on a mismatch, write `$got` and `$want` to two temp files and
`git diff --no-index fileA fileB`. Do the whole comparison in **PowerShell**, not a
bash pipe. The chart JSON is a single very long line, so line/token diff tools are
unhelpful — a string equality check (as above) is the reliable signal; only fall back
to `git diff --no-index` to locate *where* it differs.

## Interpreting results

- **200 + body matches baseline** → the deployment reproduces the golden chart. Good.
- **200 + body differs** → the compute path produced different output. Investigate
  before trusting the deployment. Likely causes: an intended chart-math change (then
  the baseline must be re-blessed by the owner, not by you), a wrong ayanamsha/SVP or
  ephemeris version on the server, or (for `topo`) the fixture elevation not being 80.
- **400** → unknown `mode`. Use one of: `natal, topo, calendar, cycles, panchanga, chinese`.
- **401** → missing/expired token. Re-run Step 1.
- **500 / error payload / empty** → usually the server can't reach its DB or
  `DATA_FOLDER`. This is an environment problem, not a chart bug.

## Do / don't

- **Do** report the exact status code and, on a mismatch, *where* the output diverges.
  Do not claim a pass you did not actually observe.
- **Do** treat a baseline mismatch as a signal to investigate, not something to fix by
  editing the baseline. Re-blessing baselines is an owner decision.
- **Don't** hammer the endpoint in a loop — each call computes a real chart (the
  `calendar` mode takes seconds). One call per mode is enough.
- **Don't** invent credentials or a server URL; ask the operator.
