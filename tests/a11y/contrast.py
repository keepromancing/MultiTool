# Contrast of every text/background pair the app uses, in light and dark themes (WCAG 1.4.3 / 1.4.11).
# Reads the color tokens from app.css. Add a pair to PAIRS whenever a new color combination is used.
# Usage: python3 contrast.py [-v]   (-v lists every pair, not just failures)
import re, sys, os
css = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'app.css')).read()
def tokens(block):
    return dict(re.findall(r'--([\w-]+):\s*(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}|rgba?\([^)]*\))', block))
light = tokens(css[css.index(':root{'):css.index('}', css.index(':root{'))])
dark_start = css.index(':root[data-theme="dark"]{')
dark = dict(light); dark.update(tokens(css[dark_start:css.index('}', dark_start)]))
def rgb(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c*2 for c in h)
    return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4))
def lum(c):
    f = lambda v: v/12.92 if v <= 0.03928 else ((v+0.055)/1.055)**2.4
    r, g, b = map(f, c); return 0.2126*r + 0.7152*g + 0.0722*b
def ratio(a, b):
    la, lb = lum(rgb(a)), lum(rgb(b)); hi, lo = max(la, lb), min(la, lb); return (hi+0.05)/(lo+0.05)
# (foreground, background, minimum, where it's used)
PAIRS = [
 ('ink','bg',4.5,'body text'), ('ink','surface',4.5,'panels'), ('ink','sunk',4.5,'inputs'),
 ('muted','bg',4.5,'hints on page'), ('muted','surface',4.5,'hints in panels'), ('muted','sunk',4.5,'placeholders/sunk'),
 ('lamp','surface',4.5,'lamp text / links?'), ('lamp','lamp-soft',4.5,'Low pill, notes'), ('on-lamp','lamp',4.5,'buttons on lamp'),
 ('go','go-soft',4.5,'OK pill / placed tag'), ('go','surface',4.5,'go text'), ('surface','go',4.5,'pill.ok'),
 ('stop','stop-soft',4.5,'Out pill'), ('stop','surface',4.5,'warn-t text'), ('stop','bg',4.5,'warn-t on page'), ('surface','stop',4.5,'pill.late'),
 ('plenty','plenty-soft',4.5,'Plenty pill'), ('none','none-soft',4.5,'tags'), ('band-ink','band',4.5,'blue bands'), ('band-ink','band-2',4.5,'grey bands'),
 ('marker','marker-soft',4.5,'clash panel'), ('ink','marker-soft',4.5,'clash text'), ('muted','marker-soft',4.5,'clash hint'), ('muted','lamp-soft',4.5,'hint in note'),
 ('ink','lamp-soft',4.5,'note text'), ('ink','go-soft',4.5,'text on go-soft'),
 ('hero-ink','hero-bg',4.5,'hero text'), ('hero-dim','hero-bg',4.5,'hero secondary'), ('hero-lamp','hero-bg',4.5,'hero lamp text'),
 ('focus','bg',3,'focus ring vs page'), ('focus','surface',3,'focus ring vs panel'),
 ('field-line','surface',3,'input borders'), ('field-line','sunk',3,'input borders on sunk'), ('field-line','bg',3,'field borders on page'), ('lamp','bg',3,'active tab bar'),
 ('band-text','surface',4.5,'.mini b, add-line'), ('band-text','bg',4.5,'band text on page'), ('band-text','sunk',4.5,'band text on sunk'), ('marker','surface',4.5,'star, order qty'), ('marker','bg',4.5,'marker on page'),
 ('bg','marker',4.5,'To order count'), ('bg','stop',4.5,'armed button'), ('#1C1205','hero-lamp',4.5,'Now button'),
 ('lamp','bg',4.5,'lamp labels on page'), ('go','bg',4.5,'go text on page'), ('ink','none-soft',4.5,'count chips'), ('bg','ink',4.5,'primary buttons'),
 ('muted','none-soft',4.5,'muted on tags'), ('plenty','surface',4.5,'plenty text'),
 ('ink','plenty-soft',4.5,'table numbers on maps'), ('band-text','surface',3,'table outlines on maps'), ('band-text','plenty-soft',3,'table outlines against their fill'), ('none','surface',3,'counter outlines on maps'),
 ('focus','plenty-soft',3,'selected table on maps'), ('ink','sunk',3,'walls against the map edge'), ('stop','surface',3,'closed-for-work hatching'),
]
fails = 0
for name, T in (('light', light), ('dark', dark)):
    print(f'== {name}')
    for fg, bg, need, where in PAIRS:
        F = fg if fg.startswith('#') else T.get(fg, ''); G = bg if bg.startswith('#') else T.get(bg, '')
        if not F.startswith('#') or not G.startswith('#'): print(f'  ?   {fg} on {bg}'); continue
        r = ratio(F, G)
        mark = 'ok  ' if r >= need else 'FAIL'; fails += r < need
        if r < need or '-v' in sys.argv: print(f'  {mark} {r:5.2f} (need {need}) {fg} {F} on {bg} {G}  [{where}]')
print('contrast failures:', fails)
sys.exit(1 if fails else 0)
