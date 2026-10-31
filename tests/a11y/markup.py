# Markup checks on the screens render.mjs drew (WCAG 1.1.1, 1.3.1, 2.4.6, 2.5.3, 3.3.2, 4.1.2).
# Usage: python3 markup.py <folder from render.mjs>. Needs lxml (pip install lxml).
import sys, glob, os, re, collections
try:
    from lxml import html
except ImportError:
    print('skipped: lxml is not installed (pip install lxml)'); sys.exit(2)

d = sys.argv[1]
issues = collections.defaultdict(list)

def text_of(el):
    t = ''.join(el.itertext())
    return re.sub(r'\s+', ' ', t).strip()

def acc_name(el, doc):
    if el.get('aria-label', '').strip(): return el.get('aria-label').strip()
    if el.get('aria-labelledby'):
        ids = el.get('aria-labelledby').split()
        return ' '.join(text_of(doc.get_element_by_id(i)) for i in ids if doc.xpath('//*[@id="%s"]' % i))
    if el.tag in ('input', 'select', 'textarea'):
        i = el.get('id')
        if i:
            labs = doc.xpath('//label[@for="%s"]' % i)
            if labs: return text_of(labs[0])
        anc = el.xpath('ancestor::label')
        if anc: return text_of(anc[0])
        if el.get('title'): return el.get('title')
        return ''
    t = text_of(el)
    if t: return t
    if el.get('title'): return el.get('title')
    return ''

for f in sorted(glob.glob(os.path.join(d, '*.html'))):
    name = os.path.basename(f)[:-5]
    doc = html.fromstring(open(f).read())
    ids = collections.Counter(e.get('id') for e in doc.xpath('//*[@id]'))
    for i, n in ids.items():
        if n > 1: issues['duplicate id'].append(f'{name}: #{i} x{n}')
    for el in doc.xpath('//input[not(@type="hidden")]|//select|//textarea'):
        n = acc_name(el, doc)
        if not n: issues['field without a label'].append(f'{name}: <{el.tag} id={el.get("id")} data={ {k: v for k, v in el.attrib.items() if k.startswith("data-")} }>')
        if el.tag == 'input' and el.get('type') == 'radio' and not el.xpath('ancestor::label') and not n:
            issues['radio without label'].append(name)
    for el in doc.xpath('//button|//a[@href]|//*[@role="button"]'):
        n = acc_name(el, doc)
        if not n: issues['button/link without a name'].append(f'{name}: {html.tostring(el)[:140]}')
    for el in doc.xpath('//img'):
        if el.get('alt') is None: issues['img without alt'].append(name)
    for el in doc.xpath('//svg'):
        meaningful = el.get('role') == 'img' and (el.get('aria-label') or '').strip()  # a picture with a text alternative, like a floor plan
        if el.get('aria-hidden') != 'true' and not meaningful and not el.xpath('ancestor::*[@aria-hidden="true"]'):
            issues['svg not hidden (decorative icons should be aria-hidden)'].append(name); break
    # visible label text should be inside the accessible name (2.5.3)
    for el in doc.xpath('//button[@aria-label]'):
        vis = text_of(el)
        if vis and len(vis) > 1 and vis.lower() not in el.get('aria-label').lower(): issues['aria-label hides visible text (2.5.3)'].append(f'{name}: "{vis}" vs "{el.get("aria-label")}"')
    heads = [int(h.tag[1]) for h in doc.xpath('//h1|//h2|//h3|//h4|//h5|//h6')]
    if heads and not name.startswith('sheet') and name != '_shell' and 1 not in heads: issues['no h1 on screen (page heading)'].append(name)
    # clickable non-buttons
    # (an aria-hidden backdrop is fine: it's a mouse/touch shortcut, and the sheet has a real Close button)
    for el in doc.xpath('//*[@data-act][not(self::button)][not(self::a)][not(self::input)][not(self::select)][not(@role)][not(@aria-hidden="true")]'):
        issues['click target that isn\'t a button'].append(f'{name}: <{el.tag} class="{el.get("class")}" data-act={el.get("data-act")}>')
    for el in doc.xpath('//*[@aria-pressed]'):
        if el.tag != 'button': issues['aria-pressed on non-button'].append(name)
    skips = [(a, b) for a, b in zip(heads, heads[1:]) if b > a + 1]
    if skips: issues['skipped heading level'].append(f'{name}: {skips[:3]}')
    if not name.startswith('sheet') and name != '_shell' and heads.count(1) > 1: issues['more than one h1'].append(name)

for k, v in issues.items():
    uniq = list(dict.fromkeys(v))
    print(f'== {k}: {len(uniq)}')
    for x in uniq[:12]: print('   ', x)
print(f'{len(glob.glob(os.path.join(d, "*.html")))} screens checked, {len(issues)} kinds of problem')
sys.exit(1 if issues else 0)
