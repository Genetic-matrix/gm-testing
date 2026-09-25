"""Expected chart values for the nightly QA person, computed independently of GM's engine.

Birth input (nightly.js QA_BIRTH): London, 15 Jun 1985, 14:30 local (BST, UT+1) -> 13:30 UT.
The nightly edit moves the birth DATE to 25 Jun 1985 (same 14:30 local), so Profile/Cross must change: a stale save cannot pass. Tropical, geocentric (the QA accounts' default).

Sources: planet positions from Swiss Ephemeris (pyswisseph, Moshier); gate ORDER from the canonical
gm-translations dump gates.json; Profile names from profiles.json; Incarnation Cross from
incarnation_crosses.json (id = personality Sun, personality Earth, design Sun, design Earth gates, 2 digits each).
Wheel start 358.25 deg: implied by the engine in two independent checks (natal sidereal, calendar tropical),
pending Vladimir's confirmation. Type is NOT computed: the dumps do not define motor centers, and reference
data is never filled in from memory.

Writes golden-master/qa-expected.json. Read-only otherwise.
"""
import json, os
import swisseph as swe

HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = r'C:\Users\JY\Downloads\gm-translations-baseline\api-db'
WHEEL = 358.25
load = lambda f: json.load(open(os.path.join(DUMP, f), encoding='utf-8'))['rows']
pos2gate = {r['values']['Angle']: r['key']['Id'] for r in load('gates.json')}
profiles = {r['key']['Id']: r['values']['Name'] for r in load('profiles.json')}
crosses = {r['key']['Id']: r['values']['Name'] for r in load('incarnation_crosses.json')}


def gate_line(lon):
    rel = (lon - WHEEL) % 360
    return pos2gate[int(rel // 5.625) + 1], int((rel % 5.625) // (5.625 / 6)) + 1


def sun(jd):
    return swe.calc_ut(jd, swe.SUN, swe.FLG_MOSEPH)[0][0]


def design_jd(jd_birth):
    target = (sun(jd_birth) - 88) % 360
    lo, hi = jd_birth - 100, jd_birth - 80   # the design moment is about 88-92 days earlier
    for _ in range(80):
        mid = (lo + hi) / 2
        d = (sun(mid) - target + 540) % 360 - 180
        lo, hi = (mid, hi) if d < 0 else (lo, mid)
    return lo


out = {}
for label, (day, ut) in (('created', (15, 13.5)), ('after_edit', (25, 13.5))):
    jb = swe.julday(1985, 6, day, ut)
    jd = design_jd(jb)
    ps, pe = gate_line(sun(jb)), gate_line((sun(jb) + 180) % 360)
    ds, de = gate_line(sun(jd)), gate_line((sun(jd) + 180) % 360)
    prof_id = ps[1] * 10 + ds[1]
    cross_id = '%02d%02d%02d%02d' % (ps[0], pe[0], ds[0], de[0])
    y, m, d, h = swe.revjul(jd)
    out[label] = {
        'birth_ut': f'1985-06-{day:02d} {int(ut):02d}:{int(ut % 1 * 60):02d}',
        'design_ut': f'{y}-{m:02d}-{d:02d} {int(h):02d}:{int(h % 1 * 60):02d}',
        'personality_sun': f'{ps[0]}.{ps[1]}', 'personality_earth': f'{pe[0]}.{pe[1]}',
        'design_sun': f'{ds[0]}.{ds[1]}', 'design_earth': f'{de[0]}.{de[1]}',
        'profile': f'{ps[1]}/{ds[1]}', 'profile_name': profiles.get(prof_id),
        'cross_id': cross_id, 'cross_name': crosses.get(cross_id),
    }
out['_note'] = 'Independent of GM code. Type not verified (motor centers are not in the dumps). Wheel start 358.25 pending Vladimir.'
json.dump(out, open(os.path.join(HERE, 'qa-expected.json'), 'w', encoding='utf-8'), indent=2)
print(json.dumps(out, indent=2))
