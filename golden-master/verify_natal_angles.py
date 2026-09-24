"""Part 2 of the independent natal check: ascendant, Equal houses, signs, nakshatra number/pada, aspect angles.
Swiss Ephemeris (Moshier), sidereal Fagan/Bradley, birthplace coordinates as stored in the baseline.
Checks arithmetic and astronomy only; no names or orb rules are assumed."""
import json, os
import swisseph as swe
HERE = os.path.dirname(os.path.abspath(__file__))
j = json.loads(open(os.path.join(HERE, 'vladimir-baselines-2026-09-23', 'verify_natal.txt'), encoding='utf-8').read().strip())
swe.set_sid_mode(swe.SIDM_FAGAN_BRADLEY)
LAT, LON = 45.415745, 19.8931066
d = lambda a, b: (a - b + 540) % 360 - 180
out, bad = [], 0
def check(label, base, mine, tol=0.01):
    global bad
    ok = abs(d(mine, base)) <= tol
    bad += not ok
    out.append(f'| {label} | {base:.5f} | {mine:.5f} | {d(mine, base)*3600:.1f} | {"MATCH" if ok else "MISMATCH"} |')
for label, key, t in (('Ascendant (personality)', 'ascendant', (1979, 12, 22, 12.25)), ('Ascendant (design)', 'ascendantBody', (1979, 9, 25, 17 + 19/60 + 11/3600))):
    jd = swe.julday(*t)
    cusps, ascmc = swe.houses_ex(jd, LAT, LON, b'E', swe.FLG_SIDEREAL)
    check(label, j['data'][key][0]['AscLong'], ascmc[0])
asc = j['data']['ascendant'][0]['AscLong']
sign_bad = house_bad = nak_bad = 0; n = 0
SIGNS = None
for side in ('mindPlanets', 'bodyPlanets'):
    for slot in j[side]:
        p = next((x for x in slot if x), None)
        if not p: continue
        n += 1; L = p['longitude']
        deg_in = L % 30
        if (p['zodiacDegree'], p['zodiacMinutes']) != (int(deg_in), int((deg_in % 1) * 60)): sign_bad += 1
        elif int(L // 30) != p['zodiacId']: sign_bad += 1  # zodiacId is 0-based (Aries = 0)
        if side == 'mindPlanets' and p['house'] != int(((L - asc) % 360) // 30) + 1: house_bad += 1
        nk = p['Nakshatra']; span = 360 / 27
        if (nk['id'], nk['pada']) != (int(L // span) + 1, int((L % span) // (span / 4)) + 1): nak_bad += 1
asp_bad = 0
for a in j['aspects'][0] if isinstance(j['aspects'][0], list) else j['aspects']:
    if not isinstance(a, dict): continue
    ang = abs(d(a['planet1']['Longitude'], a['planet2']['Longitude']))
    if abs(ang - a['angle']) > 1e-6: asp_bad += 1
res = ['# Independent natal check, part 2', '', '| Item | Baseline | Swiss Eph | Diff (arcsec) | Result |', '|---|---|---|---|---|'] + out + ['',
       f'Signs/degrees: {n - sign_bad}/{n} consistent. Houses (Equal, personality asc): {"all" if not house_bad else house_bad} {"consistent" if not house_bad else "INCONSISTENT"}. Nakshatra number and pada: {n - nak_bad}/{n} consistent.',
       f'Aspect angles: {"all consistent with the planet positions" if not asp_bad else f"{asp_bad} INCONSISTENT"} (orb rules and aspect names are GM choices, not checked).']
open(os.path.join(HERE, 'natal-independent-check-part2.md'), 'w', encoding='utf-8').write('\n'.join(res) + '\n')
print('\n'.join(res))
