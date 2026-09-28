# Datasets on the Beast (test corpus)

Catalogue for OPEN-ITEMS H42. Written by the topocentric session, 28 Sep 2026.

**Standing rule (John, 28 Sep 2026):** nothing on the Beast is deleted or overwritten. Every record set and every geo/topo diff output stays as a permanent test corpus for mass testing. A run that needs fresh data saves it next to the old set, with its import date in the name. Any cleanup for disk space is asked of John first.

Machine: the Beast (ssh alias `beast`, Tailscale 100.81.88.113). Database `gm_site` on the local MySQL 8.0. Files are in `C:\Users\user\`. Record counts are exact where a count query was run, and approximate (InnoDB `table_rows`) otherwise.

## Source records

| Dataset | Location | Records | Imported / created | Notes |
|---|---|---|---|---|
| Members | `gm_persons` (ps_id below 899,999,900) | 1,312,811 exact | copy of live, table created 18 Sep 2026 | Live members and their saved people. Reruns write results, not birth data. |
| Simulated births: pilot | `gm_persons`, tag `SIM-PILOT` (ps_id 899,999,900 and up) | 20 exact | 27 Sep 2026 | The engine pilot for simulated rows. |
| Simulated births: world | `gm_persons`, tag `SIM-WORLD` (ps_id 900,000,001 to 900,400,000) | 400,000 exact | 27 Sep 2026 | Weighted by country population (GeoNames, c. 2019). Built by `topocentric-pages/sim/gen_sets.py` with a fixed seed. Never copy these rows to live. |
| Simulated births: southern hemisphere | `gm_persons`, tag `SIM-SOUTH` (901,000,001 and up) | 400,000 exact | 28 Sep 2026 | Southern hemisphere only. |
| Simulated births: member birth hours | `gm_persons`, tag `SIM-HOURS` (902,000,001 and up) | 400,000 exact | 28 Sep 2026 | Paired with WORLD. Local birth hour follows real member birth hours. |
| Members, earlier copy | `gm_persons_1` | about 1.27M | 25 Aug 2026 | Previous copy. |
| Celebrities | `clb_profile` | 96,179 exact | copy of live 25 Sep 2026; celeb batch 5 applied 26 Sep | Cleanup batches 1 to 5 applied. |
| Celebrities, earlier copies | `clb_profile_1` (Jul 2026), `clb_profile_bck` (25 Sep), `clb_profile_geo` (22 Sep) | 92,214 / 95,736 / 95,736 | as dated | |
| Celebrity backups before cleanup batches | `clb_profile_bak_celebfix4_20260925`, `clb_profile_bak_celebfix5_20260926` | 30 / 2,358 | 25 / 26 Sep 2026 | The rollback for batches 4 and 5. |
| Cleanup exclusions (members) | `diff_excluded` | about 84k | 23 Sep 2026 | Records flagged by the September cleanup (place, time, DST, impossible date). |

## Engine results (geo = perspective 1, topo = perspective 3, 9 systems)

| Dataset | Location | Size | Dates | Notes |
|---|---|---|---|---|
| Member and simulated results | `gm_person_data`, `gm_person_planets`, `gm_person_centers`, `gm_person_channels` | about 2.69 billion planet rows | members rerun 25 to 27 Sep 2026 on the fixed engine; simulated rows from 27 Sep onward | People with results: geo 2,512,831, topo 2,269,343 (28 Sep, SIM-HOURS still running). |
| Member results before the rerun | `gm_person_planets_geo`, `gm_person_centers_geo` (24 Sep), `gm_person_data_b` (21 Sep), `gm_person_data_old` (26 Aug to 1 Sep) | about 88M, 11.2M, 11.8M and 11.8M rows | as dated | Earlier engine versions. Useful for regression tests. |
| Celebrity results | `clb_data`, `clb_planets`, `clb_centers`, `clb_channels` | about 124M planet rows | 25 to 26 Sep 2026 on the fixed engine; batch 5 celebs recalculated 26 Sep | |
| Celebrity results before the rerun | `clb_data_geo`, `clb_channels_geo` | 0.83M / 2.8M rows | 22 Sep 2026 | |

**Warning:** an engine rerun overwrites the rows for the people it recalculates. Snapshot the result tables with a dated name before any rerun, per the standing rule.

## Exports and diff outputs (files in `C:\Users\user\`)

| File(s) | Contents | Date |
|---|---|---|
| `m_pr.tsv`, `m_data.tsv`, `m_ce.tsv`, `m_pl.tsv` | Member export for the diff (1.2M people, 66M planet rows) | 27 Sep 2026 |
| `m_accept_out.txt`, `m_diff_out.txt`, `m_diff_out2.txt`, `m_diff_out3.txt` | Member acceptance test and diffs (v3 is the published one) | 27 Sep 2026 |
| `cd_*.tsv`, `celeb_diff.py` outputs | Celebrity export and diffs | 26 Sep 2026 |
| `s_*.tsv`, `sim_world_out.txt` | SIM-WORLD export and diff | 28 Sep 2026 |
| `sleep_rows.jsonl`, `sleep_summary.json`, `sleep_diff_out.txt` | 20,000 member sleep charts, geo and topo, from the engine | 28 Sep 2026 |
| `sim_WORLD.sql`, `sim_SOUTH.sql`, `sim_HOURS.sql`, `sim_PILOT.sql` | Load files for the simulated births | 26 to 28 Sep 2026 |
| `mexp.tsv`, `mexp.tsv.gz`, `review_utc_*.csv`, `review2_utc_*.csv`, `corrections_utc*.csv`, `utcfix*_members_2026-09-27.sql` | Member UTC check: 394 + 459 corrections sent to Vladimir; about 24k for review | 27 Sep 2026 |
| `dm_rows.json`, `sleep88.py`, `dm_check.py` | Engine 88-degree tests for the natal Design and the sleep Design | 25 and 28 Sep 2026 |
| `diffrun.log` | Log of every pass and check on the Beast | ongoing |

Copies of the diff outputs, scripts and summaries are in `topocentric-pages/diffs/` on GM1, under git.

Exports from here on are saved with their date in the file name, so a new run never overwrites an old one.
