// Floor plans: drawing them safely from a hand-edited file, and the changes people make (adding and
// moving tables, drafts, going live, deleting a draft, view-only access, printing). Made-up data only.
import path from 'node:path';
import { makePhone, checker } from './lib/phone.mjs';
import { fullPhone, fixture } from './lib/fixtures.mjs';

const T = checker();
const check = T.check;

/* ---------- browser stubs ---------- */
const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {}, setAttribute() {}, removeAttribute() {}, remove() {}, querySelector: () => null, closest: () => null, appendChild() {}, innerHTML: '', textContent: '', value: '' });
globalThis.window = globalThis;
globalThis.document = { querySelector: (s) => (String(s).startsWith('#') ? el() : null), querySelectorAll: () => [], getElementById: () => el(), createElement: el, body: el(), activeElement: null, contains: () => false, addEventListener() {} };
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test', platform: 'Linux', maxTouchPoints: 0, onLine: false, storage: null } });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.location = { hash: '' };
globalThis.history = { pushState() {}, replaceState() {}, back() {}, state: null };
globalThis.fetch = async () => { throw new TypeError('offline'); };

async function phone(name, mem) {
  const dir = makePhone(name);
  globalThis['__mem_' + name] = mem;
  const st = await import(path.join(dir, 'js/state.js'));
  const app = (await import(path.join(dir, 'js/app.js'))).app;
  const maps = await import(path.join(dir, 'js/views/maps.js'));
  const print = await import(path.join(dir, 'js/print.js'));
  app.register(maps);
  app.go = (h) => { const [tab, sub, ...rest] = h.replace(/^#/, '').split('/'); app.route = { tab, sub: sub || '', id: rest.join('/') }; };
  await st.load();
  const fake = (data, value) => ({ dataset: data, value, disabled: false, innerHTML: '', textContent: '', classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null });
  return {
    st, S: st.S, app, maps, print,
    act: (a, data = {}) => app.acts[a](fake(data, '')),
    sure: (a, data = {}) => app.acts[a](fake(Object.assign({ armed: '1' }, data), '')), // the second tap of a tap-twice button
    at: (h) => app.go(h)
  };
}
const room = (P, vId, rId) => P.S.plans.local.versions.find((v) => v.id === vId).rooms.find((r) => r.id === rId);
const item = (P, vId, rId, id) => room(P, vId, rId).items.find((i) => i.id === id);

console.log('\n1. A floor plans file with markup and junk numbers in it');
const bad = fixture('floorplans.json');
const v0 = bad.versions[0], r0 = v0.rooms[0];
v0.name = '<img src=x onerror=alert(1)>Layout'; v0.note = '<script>alert(2)</script>'; v0.wentLive = '<b>x</b>';
r0.name = '<i>Main</i> room'; r0.closed = true; r0.closedNote = '<u>soon</u>'; r0.w = '<b>wide</b>'; r0.h = 1e9;
r0.walls = [[0, 0], ['<b>', 5], [30, 'x'], null, 'junk', [0, 16]];
r0.items[0].label = '<svg onload=alert(3)>'; r0.items[0].x = '"><script>'; r0.items[0].w = -5;
r0.items[1].kind = '<b>sofa</b>'; r0.items[1].shape = '"round';
r0.items.push(null, 'junk', { id: '"><b>', label: '&<>"\'', x: NaN, y: Infinity });
bad.versions.push(null, 'junk', { id: 7 });
const X = await phone('MapX', Object.assign(fullPhone({ clash: false }), { plans: { base: null, local: bad, sha: null } }));
X.at('#book/maps');
let html = X.maps.mapsView() + X.maps.roomView('v-now/r-main');
X.app.ui.editing = true; X.at('#book/map/v-now/r-main'); X.act('map-sel', { id: r0.items[0].id });
html += X.maps.roomView('v-now/r-main');
X.act('map-walls'); X.act('map-corner', { id: '1' }); html += X.maps.roomView('v-now/r-main'); X.act('map-walls');
X.app.ui.editing = false;
html += X.maps.printHTML('v-now', () => '');
check(!/<(img|script|i|u|b)[ >]/i.test(html.replace(/<b class="warn-t">/g, '')) && !/<svg onload/i.test(html), 'no markup from the file gets into the page');
check(/&lt;img src=x onerror=alert\(1\)&gt;Layout/.test(html) && /&lt;svg onload=alert\(3\)&gt;/.test(html) && /&amp;&lt;&gt;&quot;&#39;/.test(html), 'names and labels show as plain text');
check(!/NaN|Infinity|undefined/.test(html), 'no broken numbers drawn (junk positions and sizes fall back to sensible ones)');
check(!/viewBox="[^"]*e\+/.test(html), 'a huge room size is capped');

console.log('\n2. Starting the floor plans, adding and moving tables');
const A = await phone('MapA', Object.assign(fullPhone({ clash: false }), { plans: { base: null, local: null, sha: null } }));
A.act('map-start');
const vA = A.S.plans.local.live, rA = A.S.plans.local.versions[0].rooms[0].id;
check(!!vA && A.app.route.sub === 'map' && A.app.route.id === vA + '/' + rA, 'starts a layout in use with one room, and opens it');
A.act('map-add', { kind: 'table' }); A.act('map-add', { kind: 'table' }); A.act('map-add', { kind: 'seat' }); A.act('map-add', { kind: 'label' });
const its = room(A, vA, rA).items;
check(its.map((i) => i.label).join() === '1,2,S1,Entrance', 'new tables are numbered in order (1, 2), seats S1, labels Entrance');
const t1 = its[0].id;
A.act('map-sel', { id: t1 });
const x0 = item(A, vA, rA, t1).x;
A.act('map-nudge', { dx: '0.5', dy: '0' }); A.act('map-nudge', { dx: '0.5', dy: '0' });
check(item(A, vA, rA, t1).x === x0 + 1, 'the arrow buttons move the picked table (no dragging needed)');
A.act('map-size', { d: 'w+' }); A.act('map-turn');
check(item(A, vA, rA, t1).h === 4.5 && item(A, vA, rA, t1).w === 3, 'wider, then turned: 4.5 deep, 3 wide');

console.log('\n3. Drafts, going live, and permanent ids');
A.act('map-draft', { id: vA });
const draft = A.S.plans.local.versions.find((v) => v.id !== vA);
check(!!draft && A.maps.statusOf(draft) === 'draft' && A.S.plans.local.live === vA, 'a new draft copies the whole floor; the layout in use stays in use');
const dRoom = draft.rooms[0];
check(dRoom.id === rA && dRoom.items.map((i) => i.id).join() === its.map((i) => i.id).join(), 'rooms and tables keep their ids in the draft');
A.at('#book/map/' + draft.id + '/' + rA); A.act('map-sel', { id: t1 }); A.act('map-nudge', { dx: '0', dy: '2' });
check(item(A, draft.id, rA, t1).y === item(A, vA, rA, t1).y + 2, 'moving a table in the draft doesn’t move it in the layout in use');
A.act('map-live', { id: draft.id });
check(A.S.plans.local.live === vA, 'going live needs a second tap');
A.sure('map-live', { id: draft.id });
const old = A.S.plans.local.versions.find((v) => v.id === vA), now = A.S.plans.local.versions.find((v) => v.id === draft.id);
check(A.S.plans.local.live === draft.id && /^\d{4}-/.test(now.wentLive) && old.retired === now.wentLive, 'the draft is now in use, and the old one is marked as used until today');
check(A.maps.statusOf(old) === 'old' && A.maps.printTarget(vA).rev === old.retired, 'copies printed of the old layout show as out of date');
A.sure('map-ver-del', { id: draft.id });
check(A.S.plans.local.versions.some((v) => v.id === draft.id), 'the layout in use can’t be deleted');
A.sure('map-ver-del', { id: vA });
check(!A.S.plans.local.versions.some((v) => v.id === vA) && A.S.plans.local.gone && A.S.plans.local.gone[vA], 'an old version can be deleted, and leaves a deletion marker so it can’t come back');
check(Object.keys(A.S.plans.local.gone).length === 1, 'deleting a version marks only the version, not its rooms or tables (they live on in other versions)');

console.log('\n4. View only');
const V = await phone('MapV', Object.assign(fullPhone({ clash: false }), {}));
V.S.settings.perm = Object.assign({}, V.S.settings.perm, { train: { push: false } });
const before = JSON.stringify(V.S.plans.local);
V.app.ui.editing = true; V.at('#book/map/v-now/r-main');
V.act('map-add', { kind: 'table' }); V.act('map-draft', { id: 'v-now' }); V.sure('map-live', { id: 'v-next' });
check(JSON.stringify(V.S.plans.local) === before, 'with view-only access nothing changes');
const vh = V.maps.roomView('v-now/r-main') + V.maps.mapsView();
check(!/data-act="map-(add|edit|draft|live|nudge)"/.test(vh) && /View only/.test(vh), 'and no editing buttons show');

console.log('\n5. Printing');
const P = await phone('MapP', fullPhone({ clash: false }));
const t = P.print.target({ kind: 'maps', id: 'v-next' });
check(t && /After the remodel/.test(t.label) && t.rev === '2026-01-12', 'a printout is labeled with the version and its last change');
const ph = P.maps.printHTML('v-next', () => '<p>stamp</p>');
check((ph.match(/class="pv-sec pv-map"/g) || []).length === 2 && /Closed for work/.test(ph), 'one page per room, closed rooms marked');

T.done();
