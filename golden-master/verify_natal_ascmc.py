"""Part 3: every angle Swiss Ephemeris returns in ascmc (ASC, MC, ARMC, Vertex, Equatorial Asc, Co-Asc x2,
Polar Asc) versus each "Ascmc" array stored in the natal baseline, for birth and design times. Sidereal FB."""
import json, os, re
import swisseph as swe
HERE = os.path.dirname(os.path.abspath(__file__))
t = open(os.path.join(HERE, 'vladimir-baselines-2026-09-23', 'verify_natal.txt'), encoding='utf-8').read()
arrays = [json.loads('[' + m + ']') for m in re.findall(r'"Ascmc":\[([^\]]*)\]', t)]
swe.set_sid_mode(swe.SIDM_FAGAN_BRADLEY)
NAMES = ['ASC', 'MC', 'ARMC', 'Vertex', 'Equatorial Asc', 'Co-Asc (Koch)', 'Co-Asc (Munkasey)', 'Polar Asc']
mine = {}
for label, tm in (('birth', (1979, 12, 22, 12.25)), ('design', (1979, 9, 25, 17 + 19/60 + 11/3600))):
    mine[label] = swe.houses_ex(swe.julday(*tm), 45.415745, 19.8931066, b'E', swe.FLG_SIDEREAL)[1]
d = lambda a, b: abs((a - b + 540) % 360 - 180)
out = ['# Independent natal check, part 3: chart angles', '', f'{len(arrays)} Ascmc arrays found in the baseline.', '']
seen = set()
for arr in arrays:
    key = tuple(round(x, 6) for x in arr)
    if key in seen: continue
    seen.add(key)
    best = min(mine, key=lambda k: d(mine[k][0], arr[0]))
    out.append(f'**{best} time**')
    for i, nm in enumerate(NAMES):
        if i < len(arr):
            dd = d(mine[best][i], arr[i]) * 3600
            out.append(f'- {nm}: baseline {arr[i]:.5f}, Swiss Eph {mine[best][i]:.5f}, {dd:.1f} arcsec {"MATCH" if dd <= 36 else "MISMATCH"}')
open(os.path.join(HERE, 'natal-independent-check-part3.md'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('\n'.join(out))
