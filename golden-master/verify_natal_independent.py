"""Independent check of Vladimir's verify_natal.txt baseline (fixture psId 339).

Recomputes every planet longitude with Swiss Ephemeris (pyswisseph, Moshier ephemeris, no GM code),
in the fixture's own settings (Sidereal, Fagan/Bradley, geocentric), and compares with the baseline.
Then checks the gate/line assignment against the canonical gate ORDER from the gm-translations
api-db dump (gates.json "Angle" = position 1..64 on the wheel). The wheel's starting degree is NOT
in the dump, so it is not assumed: the script derives the single offset the baseline implies from
every activation and reports whether ONE offset explains all of them. The offset value itself must
be confirmed by John/Vladimir against the reference, never taken from memory.

Read-only. Writes one report file next to this script.
"""
import json, math, os, sys
import swisseph as swe

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, 'vladimir-baselines-2026-09-23', 'verify_natal.txt')
GATES = r'C:\Users\JY\Downloads\gm-translations-baseline\api-db\gates.json'
TOL_DEG = 0.01  # 36 arcseconds; Moshier vs JPL files differ far less than this for these bodies

j = json.loads(open(BASE, encoding='utf-8').read().strip())
d = j['data']
ps = j['personSettings'][0]
print('Settings:', ps['astroSystemName'], ps['ayanamshaName'], ps['perSpectiveName'], 'northNode', ps.get('northNode'))


def parse_utc(s):
    # "22 December 1979, 12:15" or "25 September 1979, 17:19:11"
    months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
              'October', 'November', 'December']
    datep, timep = [x.strip() for x in s.split(',')]
    dd, mon, yy = datep.split()
    t = [int(x) for x in timep.split(':')] + [0, 0]
    return int(yy), months.index(mon) + 1, int(dd), t[0] + t[1] / 60 + t[2] / 3600


pers = parse_utc(d['birthTimeUtc'][0])
des = parse_utc(d['designTime'][0])  # assumed UT; checked below via the Sun's 88 degrees of arc
print('Personality UT', pers, ' Design', des)

swe.set_ephe_path(os.path.join(HERE, 'ephe'))  # seas_18.se1 for Chiron (downloaded 23 Sep from github.com/aloistr/swisseph, sha256 in ephe/)
swe.set_sid_mode(swe.SIDM_FAGAN_BRADLEY)
FL = swe.FLG_MOSEPH | swe.FLG_SIDEREAL
IDS = {'Sun': swe.SUN, 'Moon': swe.MOON, 'Mercury': swe.MERCURY, 'Venus': swe.VENUS, 'Mars': swe.MARS,
       'Jupiter': swe.JUPITER, 'Saturn': swe.SATURN, 'Uranus': swe.URANUS, 'Neptune': swe.NEPTUNE,
       'Pluto': swe.PLUTO, 'Mean Apog': swe.MEAN_APOG}


def lon(jd, name):
    n = name.lower()
    if n == 'earth':
        return (lon(jd, 'Sun') + 180) % 360
    if n == 'chiron':
        r = swe.calc_ut(jd, swe.CHIRON, swe.FLG_SWIEPH | swe.FLG_SIDEREAL)
        return r[0][0]
    if 'north node' in n or n in ('nnode', 'north'):
        return swe.calc_ut(jd, swe.TRUE_NODE, FL)[0][0], swe.calc_ut(jd, swe.MEAN_NODE, FL)[0][0]
    if 'south node' in n or n in ('snode', 'south'):
        t, m = lon(jd, 'North Node')
        return (t + 180) % 360, (m + 180) % 360
    for k, v in IDS.items():
        if k.lower() == n:
            return swe.calc_ut(jd, v, FL)[0][0]
    return None


def diff(a, b):
    return (a - b + 540) % 360 - 180


gate_pos = {r['key']['Id']: r['values']['Angle'] for r in json.load(open(GATES, encoding='utf-8'))['rows']}
lines = []
rows = []
offsets = []
for side, t in (('Personality (mind)', pers), ('Design (body)', des)):
    jd = swe.julday(t[0], t[1], t[2], t[3])
    key = 'mindPlanets' if side.startswith('Personality') else 'bodyPlanets'
    for slot in j[key]:
        p = next((x for x in slot if x), None)
        if not p:
            continue
        name, bl = p['Name'], p['longitude']
        mine = lon(jd, name)
        node_note = ''
        if isinstance(mine, tuple):
            dt, dm = abs(diff(mine[0], bl)), abs(diff(mine[1], bl))
            mine, node_note = (mine[0], ' (true node)') if dt <= dm else (mine[1], ' (mean node)')
        if mine is None:
            rows.append((side, name, bl, None, None, 'NOT CHECKED (no independent source here)', p['Gate'], p['Line']))
            continue
        dlt = diff(mine, bl)
        ok = abs(dlt) <= TOL_DEG
        # gate order check: implied wheel start = lon - ((pos-1) + fraction) * 5.625
        pos = gate_pos.get(p['Gate'])
        implied = (bl - ((pos - 1) + p['gatePercent'] / 100) * 5.625) % 360 if pos else None
        if implied is not None:
            offsets.append(implied)
        line_ok = p['Line'] == min(6, int(p['gatePercent'] / 100 * 6) + 1)
        rows.append((side, name + node_note, bl, mine, dlt, 'MATCH' if ok else 'MISMATCH', p['Gate'], p['Line'], line_ok, implied))

# Design time: the Sun should be 88 degrees of arc before the personality Sun.
jp = swe.julday(*pers[:3], pers[3]); jdd = swe.julday(*des[:3], des[3])
arc = diff(swe.calc_ut(jp, swe.SUN, swe.FLG_MOSEPH)[0][0], swe.calc_ut(jdd, swe.SUN, swe.FLG_MOSEPH)[0][0])

out = ['# Independent natal check, fixture psId 339', '',
       f'Settings: {ps["astroSystemName"]}, {ps["ayanamshaName"]}, {ps["perSpectiveName"]}. Swiss Ephemeris {swe.version} (Moshier), tolerance {TOL_DEG} deg.', '',
       f'Design time check: Sun arc between design and personality = {arc:.4f} deg (expected 88).', '',
       '| Side | Body | Baseline lon | Swiss Eph lon | Diff (arcsec) | Result | Gate.Line | Line consistent | Implied wheel start |',
       '|---|---|---|---|---|---|---|---|---|']
bad = 0
for r in rows:
    if r[3] is None:
        out.append(f'| {r[0]} | {r[1]} | {r[2]:.5f} | - | - | {r[5]} | {r[6]}.{r[7]} | - | - |')
        continue
    bad += r[5] != 'MATCH' or not r[8]
    out.append(f'| {r[0]} | {r[1]} | {r[2]:.5f} | {r[3]:.5f} | {r[4]*3600:.1f} | {r[5]} | {r[6]}.{r[7]} | {"yes" if r[8] else "NO"} | {r[9]:.4f} |')
spread = max(abs(diff(o, offsets[0])) for o in offsets) if offsets else None
out += ['', f'Positions checked: {sum(1 for r in rows if r[3] is not None)}, mismatches (position or line): {bad}.',
        f'Gate order: every activation implies a wheel start of {offsets[0]:.4f} deg (sidereal), max spread {spread*3600:.2f} arcsec across {len(offsets)} activations.' if offsets else 'Gate order: not checked.',
        'That start degree is NOT from the reference dump (it holds only the order). Confirm it against the canonical source before calling gates verified.']
open(os.path.join(HERE, 'natal-independent-check.md'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('\n'.join(out))
