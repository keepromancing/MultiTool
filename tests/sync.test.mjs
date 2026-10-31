// Sync tests: several phones sync against a fake GitHub, in Node (no browser needed).
// Phone A: the book owner. It starts with data from version 1.0 (one repo), then connects a
// shared inventory repo. Phone B: a coworker on an iPhone who only counts and orders.
// All names and data are made up (tests/fixtures).
import path from 'node:path';
import crypto from 'node:crypto';
import { makePhone, outDir, checker } from './lib/phone.mjs';
import { fixtureText } from './lib/fixtures.mjs';

const OUT = outDir();
const T = checker();
const check = T.check;

/* ---------- browser stubs (shared by both phones) ---------- */
const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {}, setAttribute() {}, remove() {}, querySelector: () => null, appendChild() {}, innerHTML: '', textContent: '' });
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: el, body: el(), activeElement: null, contains: () => false, addEventListener() {} };
globalThis.addEventListener = () => {};
let ua = 'Mozilla/5.0 (Linux; Android 14; SM-F741U) Chrome/130 Mobile Safari/537.36';
let standalone = true;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get userAgent() { return ua; }, platform: 'Linux armv8l', maxTouchPoints: 5, onLine: true, get standalone() { return standalone; }, storage: null } });
globalThis.matchMedia = (q) => ({ matches: q.includes('standalone') ? standalone : false, addEventListener() {} });
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.location = { hash: '' };

/* ---------- fake GitHub ---------- */
const GH = { repos: {}, tokens: {}, calls: [] };
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
let nextId = 1000;
function addRepo(full, priv = true) { GH.repos[full.toLowerCase()] = { full, priv, files: {}, id: nextId++ }; }
function renameRepo(from, to) { const r = GH.repos[from.toLowerCase()]; delete GH.repos[from.toLowerCase()]; r.full = to; GH.repos[to.toLowerCase()] = r; for (const t of Object.keys(GH.tokens)) GH.tokens[t] = GH.tokens[t].map((x) => (x === from.toLowerCase() ? to.toLowerCase() : x)); }
const readOnly = new Set();
function putRaw(full, p, text) { GH.repos[full.toLowerCase()].files[p] = { text, sha: sha(text + Math.random()) }; }
const readJSON = (full, p) => { const f = GH.repos[full.toLowerCase()].files[p]; return f ? JSON.parse(f.text) : null; };
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const m = /^\/repos\/([^/]+)\/([^/]+)(.*)$/.exec(decodeURIComponent(u.pathname));
  const res = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body });
  if (!m) return res(404, {});
  const full = (m[1] + '/' + m[2]).toLowerCase(), rest = m[3];
  const tok = (opts.headers && opts.headers.Authorization || '').replace('Bearer ', '');
  GH.calls.push((opts.method || 'GET') + ' ' + full + rest);
  if (GH.offline) throw new TypeError('Failed to fetch');
  const repo = GH.repos[full];
  if (!repo || !(GH.tokens[tok] || []).includes(full)) return res(404, { message: 'Not Found' });
  const canPush = !readOnly.has(tok);
  if (rest === '') return res(200, { id: repo.id, full_name: repo.full, private: repo.priv, permissions: { push: canPush, pull: true }, default_branch: 'main' });
  if (opts.method === 'PUT' && !canPush) return res(403, { message: 'Resource not accessible by personal access token' });
  const cm = /^\/contents\/(.+)$/.exec(rest);
  if (!cm) return res(404, {});
  const p = cm[1];
  if ((opts.method || 'GET') === 'GET') {
    if (!Object.keys(repo.files).length) return res(404, { message: 'This repository is empty.' });
    const f = repo.files[p];
    if (!f) return res(404, { message: 'Not Found' });
    return res(200, { sha: f.sha, encoding: 'base64', content: Buffer.from(f.text).toString('base64') });
  }
  if (opts.method === 'PUT') {
    const body = JSON.parse(opts.body);
    const f = repo.files[p];
    if (f && !body.sha) return res(422, { message: 'sha wasn’t supplied' });
    if (f && body.sha !== f.sha) return res(409, { message: 'conflict' });
    if (!f && body.sha) return res(422, {});
    const text = Buffer.from(body.content, 'base64').toString('utf8');
    const ns = sha(text + Date.now() + Math.random());
    repo.files[p] = { text, sha: ns, message: body.message };
    if (GH.hold) await GH.hold(p); // the write has landed, but the answer is slow (weak signal)
    return res(200, { content: { sha: ns } });
  }
  return res(405, {});
};

/* ---------- a phone ---------- */
async function boot(name, preload) {
  const dir = makePhone(name, OUT);
  globalThis['__mem_' + name] = preload || {};
  const st = await import(path.join(dir, 'js/state.js'));
  const sy = await import(path.join(dir, 'js/sync.js'));
  const app = (await import(path.join(dir, 'js/app.js'))).app;
  const count = await import(path.join(dir, 'js/views/count.js'));
  const more = await import(path.join(dir, 'js/views/more.js'));
  app.register(count); app.register(more);
  app.route = { tab: 'count', sub: '', id: '' };
  await st.load();
  return { name, st, sy, app, count, more, S: st.S, act: (a, data = {}) => app.acts[a]({ dataset: data, disabled: false, innerHTML: '', classList: { add() {}, remove() {} } }) };
}
const settle = () => new Promise((r) => setTimeout(r, 400));

/* ---------- the world before 1.1 ---------- */
addRepo('owner/book');
addRepo('team/inventory');
for (const f of ['book.json', 'inventory.json', 'state.json']) putRaw('owner/book', f, fixtureText(f));
GH.tokens['tok-a-book'] = ['owner/book'];
GH.tokens['tok-a-inv'] = ['team/inventory'];
GH.tokens['tok-b-inv'] = ['team/inventory'];

const mb = GH.repos['owner/book'].files;
const slot = (f) => ({ base: JSON.parse(mb[f].text), local: JSON.parse(mb[f].text), sha: mb[f].sha, syncedAt: '2026-10-21T19:00:00Z' });
const oldState = slot('state.json');
const inv0 = JSON.parse(mb['inventory.json'].text);
const L1 = inv0.lines.find((l) => l.state === 'active' && l.products.length === 1);
const L2 = inv0.lines.filter((l) => l.state === 'active' && l.products.length === 1)[1];
oldState.local.invHistory = [{ id: 'h-old-1', date: '2026-10-27', savedAt: '2026-10-27T15:00:00Z', by: 'Alex', counts: { [L1.products[0].id]: 2 }, orders: {}, orderCount: 0, text: 'old count', updated: '2026-10-27' }];
const preA = {
  book: slot('book.json'), inv: slot('inventory.json'), state: oldState,
  settings: { owner: 'owner', repo: 'book', branch: 'main', token: 'tok-a-book', name: 'Alex', role: 'floor', theme: 'auto', quick: true, setupDone: true, created: '2026-10-21T00:00:00Z', lastSync: '2026-10-21T19:00:00Z' }
};

console.log('\n1. Phone A updates from 1.0 (old data, book repo only)');
const A = await boot('A', preA);
check(A.sy.appMode() === 'full', 'full mode');
check(!('invHistory' in A.S.state.local), 'saved counts moved out of state.json data');
check(A.S.counts.local && A.S.counts.local.history.length === 1 && A.S.counts.local.history[0].id === 'h-old-1', 'old saved count now in counts');
let r = await A.sy.syncAll();
check(!r.errors.length, 'sync ok: ' + (r.errors.map((e) => e.message).join(' ') || 'no errors'));
check(readJSON('owner/book', 'counts.json').history.length === 1, 'without a shared repo, counts.json goes to the book repo');
check(!('invHistory' in readJSON('owner/book', 'state.json')), 'state.json on GitHub no longer has invHistory');
check(r.conflicts === 0, 'no merge notes (' + r.conflicts + ')');

console.log('\n2. Phone A connects the shared inventory repo (empty)');
Object.assign(A.S.settings, { invOwner: 'team', invRepo: 'inventory', invToken: 'tok-a-inv', invBranch: 'main', initials: 'AA' });
check((await A.sy.testConnection(A.sy.conn('inv'))).private, 'connection test passes');
r = await A.sy.syncAll();
check(!r.errors.length, 'sync ok: ' + (r.errors.map((e) => e.message).join(' ') || 'no errors'));
check(readJSON('team/inventory', 'inventory.json').lines.length === inv0.lines.length, 'inventory.json pushed to shared repo (' + inv0.lines.length + ' lines)');
check(readJSON('team/inventory', 'counts.json').history.length === 1, 'counts.json pushed to shared repo');
check(!GH.repos['team/inventory'].files['book.json'] && !GH.repos['team/inventory'].files['state.json'], 'book and follow-ups did NOT go to the shared repo');
check(/\(AA\)/.test(GH.repos['team/inventory'].files['counts.json'].message), 'commit message carries initials');

console.log('\n3. Phone B sets up on an iPhone');
ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1'; standalone = false;
const B = await boot('B', {});
check(B.sy.iosBrowserTab() === true, 'Safari tab detected → warning shows');
check(/Add The Sheet to your Home Screen/.test(B.more.render()), 'More screen shows the Home Screen warning in Safari');
standalone = true;
check(B.sy.iosBrowserTab() === false, 'installed home-screen app → no warning');
check(B.sy.appMode() === 'none', 'fresh phone is not set up');
check(B.more.parseRepo('https://github.com/team/inventory.git').repo === 'inventory', 'pasted link parses');
B.more.prefill('team', 'inventory', 'inv');
const setupHtml = B.more.render();
check(/Counting and ordering/.test(setupHtml) && /Inventory repo/.test(setupHtml) && /team\/inventory/.test(setupHtml), 'setup screen offers inventory-only, prefilled');
check(/Resource owner/.test(setupHtml), 'key steps tell them to pick the organization');
Object.assign(B.S.settings, { invOwner: 'team', invRepo: 'inventory', invToken: 'tok-b-inv', invBranch: 'main', initials: 'BB' });
r = await B.sy.syncAll();
check(!r.errors.length, 'sync ok: ' + (r.errors.map((e) => e.message).join(' ') || 'no errors'));
check(B.sy.appMode() === 'inv', 'inventory-only mode');
check(B.S.inv.local.lines.length === inv0.lines.length && B.S.counts.local.history.length === 1, 'got inventory and saved counts');
check(!B.S.book.local && !B.S.state.local, 'got no book, follow-ups or logs');
const bMore = B.more.render();
check(!/>Book</.test(bMore) && /Inventory/.test(bMore), 'More shows only the inventory connection');

console.log('\n4. Both count offline, save, then sync');
GH.offline = true;
A.S.count.counts[L1.products[0].id] = 0; A.S.count.counts[L2.products[0].id] = 1;
A.act('count-save');
B.S.count.counts[L1.products[0].id] = L1.par != null ? L1.par : 1; // at its minimum: B's count has nothing to order
B.act('count-save');
await settle();
check(A.S.counts.local.history.some((h) => h.by === 'AA'), 'A’s count saved with AA');
check(B.S.counts.local.history.some((h) => h.by === 'BB'), 'B’s count saved with BB');
GH.offline = false;
r = await A.sy.syncAll(); check(!r.errors.length, 'A synced');
r = await B.sy.syncAll(); check(!r.errors.length && r.conflicts === 0, 'B synced, no clashes');
r = await A.sy.syncAll(); check(!r.errors.length, 'A synced again');
const ids = (P) => P.S.counts.local.history.map((h) => h.id).sort().join(',');
check(A.S.counts.local.history.length === 3 && ids(A) === ids(B), 'both phones have all 3 saved counts');

console.log('\n5. Order status');
const withOrder = A.S.counts.local.history.filter((h) => h.orderCount > 0).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
console.log('     (saved counts with something to order: ' + withOrder.length + ')');
const latest = withOrder[0];
check(A.S.counts.local.history.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0].orderCount === 0, '(setup: the newest count has nothing to order, so it mustn’t replace the one that does)');
check(latest.orderCount > 0 && latest.order && latest.order.status === 'saved', 'newest count with an order starts “not placed”');
check(/A saved order hasn’t been placed/.test(B.count.render({ sub: 'order' })), 'B’s Order tab shows the unplaced order');
B.act('ord-placed', { id: latest.id });
await B.sy.syncAll(); await A.sy.syncAll();
const aLatest = A.S.counts.local.history.find((h) => h.id === latest.id);
check(aLatest.order.status === 'placed' && aLatest.order.placedBy === 'BB', 'A sees it placed by BB');
const aOrder = A.count.render({ sub: 'order' });
check(/An order is on its way/.test(aOrder) && /Placed .* by BB/.test(aOrder), 'A’s Order tab says it’s on its way, placed by BB');
A.act('ord-received', { id: latest.id });
await A.sy.syncAll(); await B.sy.syncAll();
check(B.S.counts.local.history.find((h) => h.id === latest.id).order.status === 'received', 'received syncs back to B');
check(!/A saved order|on its way/.test(B.count.render({ sub: 'order' })), 'no open-order banner once received');
// Two unplaced orders: the older one is replaced by the newer one.
A.S.count.counts[L1.products[0].id] = 0; A.act('count-save'); await settle();
const firstOpen = A.S.counts.local.history.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
await new Promise((r) => setTimeout(r, 15));
A.S.count.counts[L1.products[0].id] = 0; A.act('count-save'); await settle();
check(A.count.orderState(firstOpen) === 'replaced', 'an older unplaced order shows as replaced by a newer one');
check((A.count.render({ sub: 'order' }).match(/A saved order hasn’t been placed/g) || []).length === 1, 'only the newest unplaced order is flagged');
await A.sy.syncAll(); await B.sy.syncAll();

console.log('\n6. Same line, different fields: no clash');
A.S.settings.initials = 'AA';
const editLine = (P, id, fn) => P.st.edit('inv', (inv) => { const l = inv.lines.find((x) => x.id === id); fn(l); l.updated = P.st.S.settings.initials === 'AA' ? '2026-10-29' : '2026-10-30'; l.by = P.st.whoAmI(); });
editLine(A, L1.id, (l) => { l.note = 'top shelf'; });
editLine(B, L1.id, (l) => { l.name = l.name + ' (16 oz)'; });
await A.sy.syncAll(); r = await B.sy.syncAll(); await A.sy.syncAll();
const aL1 = A.S.inv.local.lines.find((l) => l.id === L1.id), bL1 = B.S.inv.local.lines.find((l) => l.id === L1.id);
check(r.conflicts === 0, 'no clash from bookkeeping fields (updated/by)');
check(aL1.note === 'top shelf' && /\(16 oz\)$/.test(aL1.name) && JSON.stringify(aL1) === JSON.stringify(bL1), 'both edits kept on both phones');

console.log('\n7. Same field on both phones: clash, then “use theirs”');
editLine(A, L2.id, (l) => { l.par = 4; });
editLine(B, L2.id, (l) => { l.par = 6; });
await A.sy.syncAll(); r = await B.sy.syncAll();
check(r.review === 1, 'B gets one clash to review');
const clash = B.S.conflicts.find((c) => c.review);
check(clash && clash.ours === 6 && clash.theirs === 4 && clash.who === 'AA', 'clash shows yours 6, AA’s 4');
const bCount = B.count.render({ sub: 'count' });
check(/1 change clashed/.test(bCount) && new RegExp(L2.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': minimum').test(bCount) && /Use AA’s/.test(bCount), 'Count tab shows the clash with the item name and buttons');
check(B.S.inv.local.lines.find((l) => l.id === L2.id).par === 6, 'B’s value kept until they choose');
B.act('clash-theirs', { id: clash.id });
check(B.S.inv.local.lines.find((l) => l.id === L2.id).par === 4, 'use theirs → 4');
check(!B.S.conflicts.some((c) => c.review), 'clash cleared');
await B.sy.syncAll(); await A.sy.syncAll();
check(A.S.inv.local.lines.find((l) => l.id === L2.id).par === 4 && readJSON('team/inventory', 'inventory.json').lines.find((l) => l.id === L2.id).par === 4, 'everyone ends at 4');
check(!A.S.conflicts.some((c) => c.review), 'A has no clash');

console.log('\n8. Errors stay contained');
B.S.settings.invToken = 'expired';
r = await B.sy.syncAll();
check(r.errors.length === 1 && /Can’t see team\/inventory|Repo not found/.test(r.errors[0].message), 'bad key → clear message: ' + (r.errors[0] && r.errors[0].message));
check(!!B.S.settings.lastSyncError, 'status chip will show a sync problem');
B.S.settings.invToken = 'tok-b-inv';
r = await B.sy.syncAll();
check(!r.errors.length && !B.S.settings.lastSyncError, 'fixed key → problem clears');
GH.tokens['tok-a-inv'] = [];
r = await A.sy.syncAll();
check(r.errors.length && readJSON('owner/book', 'book.json') !== null, 'inventory key failing doesn’t stop the book from syncing');
GH.tokens['tok-a-inv'] = ['team/inventory'];

console.log('\n9. Auto-sync');
const before = GH.calls.length;
B.sy.autoSync('save', 0); await settle();
check(GH.calls.length > before, 'autoSync runs when online');
navigator.onLine = false;
const before2 = GH.calls.length;
B.sy.autoSync('save', 0); await settle();
check(GH.calls.length === before2, 'autoSync skips when offline');
navigator.onLine = true;

console.log('\n10. Moving to a new address: restore a backup on an empty phone');
await A.st.flush();
const backup = JSON.parse(JSON.stringify(globalThis.__mem_A)); delete backup.settings.token; delete backup.settings.invToken; delete backup.conflicts;
const C = await boot('C', backup);
check(C.sy.appMode() === 'full' && !C.sy.configured(), 'restored phone has the book but no keys');
const cMore = C.more.render();
check(/Restored from a backup/.test(cMore) && (cMore.match(/needs its key/g) || []).length === 2 && !/Sync now/.test(cMore), 'More asks only for the two keys, no Sync button');
Object.assign(C.S.settings, { token: 'tok-a-book', invToken: 'tok-a-inv' });
r = await C.sy.syncAll();
check(!r.errors.length && r.conflicts === 0, 'keys pasted → syncs cleanly with no clashes');
check(C.S.counts.local.history.length === A.S.counts.local.history.length, 'saved counts match the old phone');

console.log('\n11. View-only access (someone who should only look)');
GH.tokens['tok-viewer'] = ['team/inventory']; readOnly.add('tok-viewer');
const L = await boot('L', {});
Object.assign(L.S.settings, { invOwner: 'team', invRepo: 'inventory', invToken: 'tok-viewer', invBranch: 'main', initials: 'VV' });
let putsBefore = GH.calls.filter((c) => c.startsWith('PUT')).length;
r = await L.sy.syncAll();
check(!r.errors.length && r.readOnly.includes('inv'), 'syncs, reported as view only');
check(L.S.inv.local && L.S.counts.local.history.length === A.S.counts.local.history.length, 'gets items and saved counts');
check(L.sy.canWrite('counts') === false && L.sy.canWrite('inv') === false, 'app knows it can’t write');
const lOrder = L.count.render({ sub: 'order' });
check(/View only/.test(lOrder) && !/data-act="count-save"/.test(lOrder) && !/Mark placed|Mark received/.test(lOrder), 'Order tab: view-only note, no Save count, no order buttons');
check(!/data-act="item-add"/.test(L.count.render({ sub: 'items' })) && !/hist-del/.test(L.count.render({ sub: 'history' })), 'no add-line or delete buttons');
L.S.count.counts[L1.products[0].id] = 3; L.act('count-save');
check(!L.S.counts.local.history.some((h) => h.by === 'VV'), 'Save count refuses');
L.st.edit('inv', (inv) => { inv.lines[0].note = 'viewer scribble'; });
r = await L.sy.syncAll();
check(GH.calls.filter((c) => c.startsWith('PUT')).length === putsBefore, 'never sends anything to GitHub');
readOnly.delete('tok-viewer');
r = await L.sy.syncAll();
check(L.sy.canWrite('counts') === true && !/View only/.test(L.count.render({ sub: 'order' })), 'given write access on GitHub → editable on next sync, no new key');

console.log('\n12. Access removed, then given back');
GH.tokens['tok-b-inv'] = [];
r = await B.sy.syncAll();
check(r.errors.length === 1 && /access was removed/.test(r.errors[0].message), 'clear message: ' + (r.errors[0] && r.errors[0].message.slice(0, 80)) + '…');
check(/can’t reach the shared inventory anymore/.test(B.count.render({ sub: 'count' })) && B.sy.canWrite('counts') === false, 'Count tab says access is gone and goes view only');
check(/no access/.test(B.more.render()), 'More shows “no access”');
GH.tokens['tok-b-inv'] = ['team/inventory'];
r = await B.sy.syncAll();
check(!r.errors.length && B.sy.canWrite('counts') && !/can’t reach/.test(B.count.render({ sub: 'count' })), 'access back → normal again');

console.log('\n13. Organization renamed (same repo id)');
renameRepo('team/inventory', 'renamed-team/inventory');
for (const P of [A, B]) P.S.settings.invOwner = 'renamed-team';
const cfBefore = A.S.conflicts.length + B.S.conflicts.length;
r = await A.sy.syncAll(); const r2 = await B.sy.syncAll();
check(!r.errors.length && !r2.errors.length && A.S.conflicts.length + B.S.conflicts.length === cfBefore, 'both sync after the rename with no clashes or resets');
check(String(A.S.inv.src).startsWith('id:'), 'files are tied to the repo id, not its name');

console.log('\n14. Old backup connected to a repo with newer data');
const staleInv = JSON.parse(JSON.stringify(A.S.inv.local)); staleInv.lines.find((l) => l.id === L2.id).par = 9;
const extra = { id: 'h-only-on-old-phone', date: '2026-10-28', savedAt: '2026-10-28T12:00:00Z', by: 'AA', counts: {}, orders: {}, orderCount: 0, text: 'x', updated: '2026-10-28' };
const staleCounts = JSON.parse(JSON.stringify(A.S.counts.local)); staleCounts.history.push(extra);
const D = await boot('D', { inv: { base: staleInv, local: staleInv, sha: 'old', src: 'owner/book' }, counts: { base: null, local: staleCounts, sha: null, src: 'owner/book' }, settings: { invOwner: 'renamed-team', invRepo: 'inventory', invToken: 'tok-a-inv', initials: 'AA' } });
r = await D.sy.syncAll();
check(!r.errors.length && r.review === 0, 'no clash prompts');
check(D.S.inv.local.lines.find((l) => l.id === L2.id).par === 4, 'shared value wins over the stale backup (4, not 9)');
check(D.S.counts.local.history.some((h) => h.id === 'h-only-on-old-phone') && readJSON('renamed-team/inventory', 'counts.json').history.some((h) => h.id === 'h-only-on-old-phone'), 'a saved count only the old phone had is kept and shared');

console.log('\n15. Shared inventory disconnected');
const mbInvBefore = GH.repos['owner/book'].files['inventory.json'].sha;
A.S.settings.invToken = ''; A.S.settings.invOwner = ''; A.S.settings.invRepo = '';
A.st.edit('inv', (inv) => { inv.lines[0].note = 'after disconnect'; });
r = await A.sy.syncAll();
check(GH.repos['owner/book'].files['inventory.json'].sha === mbInvBefore, 'inventory does not fall back to the old book repo');
check(/Not connected/.test(A.more.render()), 'More shows inventory as not connected');

/* Two fresh count-only phones on the (renamed) shared repo for the scenarios below. */
const SHARED = 'renamed-team/inventory';
GH.tokens['tok-e'] = [SHARED]; GH.tokens['tok-f'] = [SHARED];
const invOnly = (tok, ini) => ({ settings: { invOwner: 'renamed-team', invRepo: 'inventory', invToken: tok, invBranch: 'main', initials: ini, setupDone: true, created: '2026-10-30T00:00:00Z' } });
const E = await boot('E', invOnly('tok-e', 'EE'));
const F = await boot('F', invOnly('tok-f', 'FF'));
await E.sy.syncAll(); await F.sy.syncAll();
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const newest = (P) => P.S.counts.local.history.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
const lineIn = (doc, id) => doc.lines.find((l) => l.id === id);
const puts = () => GH.calls.filter((c) => c.startsWith('PUT')).length;
/* Start a sync and hold GitHub's answer to one file's write until finish() is called. */
async function syncHolding(P, file) {
  let release = null;
  GH.hold = (p) => (p === file ? new Promise((res) => { release = res; }) : null);
  const done = P.sy.syncAll();
  for (let i = 0; i < 400 && !release; i++) await wait(5);
  GH.hold = null;
  return { held: !!release, finish: () => { if (release) release(); return done; } };
}

console.log('\n16. Changes made while a sync is sending');
E.st.edit('inv', (inv) => { lineIn(inv, L1.id).note = 'before the sync'; });
let s = await syncHolding(E, 'inventory.json');
check(s.held, '(setup: an item change is on its way to GitHub)');
E.st.edit('inv', (inv) => { lineIn(inv, L2.id).note = 'while sending'; });
await s.finish();
check(lineIn(E.S.inv.local, L2.id).note === 'while sending' && E.st.dirty('inv'), 'an item change made while sending stays, marked as waiting to go');
await wait(2200);
check(lineIn(readJSON(SHARED, 'inventory.json'), L2.id).note === 'while sending', '…and goes to GitHub on its own right after');
F.st.edit('inv', (inv) => { lineIn(inv, L2.id).name += ' (big)'; });
await F.sy.syncAll(); await E.sy.syncAll();
check(lineIn(E.S.inv.local, L2.id).note === 'while sending' && / \(big\)$/.test(lineIn(E.S.inv.local, L2.id).name), 'after the other phone edits the same line, both changes are there');
GH.offline = true;
F.S.count.counts[L1.products[0].id] = 0; F.act('count-save');
E.S.count.counts[L1.products[0].id] = 1; E.act('count-save');
await wait(700);
GH.offline = false;
await F.sy.syncAll();
s = await syncHolding(E, 'counts.json');
check(s.held, '(setup: E’s counts, merged with F’s, are on their way)');
E.S.count.counts[L1.products[0].id] = 2; E.act('count-save');
const late = newest(E).id;
await s.finish();
check(E.S.counts.local.history.some((h) => h.id === late), 'a count saved while sending is still on the phone');
await wait(2200); await F.sy.syncAll();
check(readJSON(SHARED, 'counts.json').history.some((h) => h.id === late) && F.S.counts.local.history.some((h) => h.id === late), '…and reaches GitHub and the other phone');

console.log('\n17. A clash card that has gone out of date');
const setPar = (P, v) => P.st.edit('inv', (inv) => { lineIn(inv, L2.id).par = v; });
setPar(E, 5); setPar(F, 6);
await E.sy.syncAll(); r = await F.sy.syncAll();
const oldClash = F.S.conflicts.find((c) => c.review) || {};
check(r.review === 1 && oldClash.ours === 6 && oldClash.theirs === 5, '(setup: F has a clash to review, 6 vs EE’s 5)');
await E.sy.syncAll(); setPar(E, 8); await E.sy.syncAll(); // EE sees 6, settles on 8
await F.sy.syncAll();
check(lineIn(F.S.inv.local, L2.id).par === 8 && !F.S.conflicts.some((c) => c.id === oldClash.id), 'once a newer value arrives, the old clash card goes away');
F.act('clash-theirs', { id: oldClash.id }); // a tap on the old card, still on screen
await wait(1200); await F.sy.syncAll(); await E.sy.syncAll();
check([lineIn(E.S.inv.local, L2.id).par, lineIn(F.S.inv.local, L2.id).par, lineIn(readJSON(SHARED, 'inventory.json'), L2.id).par].join() === '8,8,8', 'the newer 8 isn’t undone by the old card');

console.log('\n18. Access changes to view only while a count waits to go');
GH.offline = true;
F.S.count.counts[L1.products[0].id] = 0; F.act('count-save');
await wait(700);
const waiting = newest(F).id;
setPar(F, 11); // and an item change made offline
GH.offline = false;
E.S.count.counts[L1.products[0].id] = 3; E.act('count-save'); setPar(E, 12);
await wait(700); await E.sy.syncAll();
const sharedSince = newest(E).id;
readOnly.add('tok-f');
const putsBefore18 = puts();
r = await F.sy.syncAll();
check(r.readOnly.includes('inv') && puts() === putsBefore18, '(setup: synced view only, nothing sent)');
check(F.S.counts.local.history.some((h) => h.id === waiting) && F.st.dirty('counts'), 'the count saved on the phone is kept, waiting to go');
check(F.S.counts.local.history.some((h) => h.id === sharedSince), 'it still gets everyone else’s new counts');
check(lineIn(F.S.inv.local, L2.id).par === 12, 'where both changed the same thing, GitHub’s version wins, so sending later can’t undo it');
readOnly.delete('tok-f');
r = await F.sy.syncAll();
check(!r.errors.length && readJSON(SHARED, 'counts.json').history.some((h) => h.id === waiting) && lineIn(readJSON(SHARED, 'inventory.json'), L2.id).par === 12, 'write access back → the waiting count goes to GitHub, and the 12 stays');

console.log('\n19. The shared repo is made public by mistake');
GH.repos[SHARED].priv = false;
E.S.count.counts[L1.products[0].id] = 1; E.act('count-save');
const pending = newest(E).id;
const putsBefore19 = puts();
r = await E.sy.syncAll(); await wait(700);
check(r.errors.some((e) => /public/.test(e.message)), 'sync says the repo is public: ' + ((r.errors[0] && r.errors[0].message) || 'no message'));
check(puts() === putsBefore19 && !readJSON(SHARED, 'counts.json').history.some((h) => h.id === pending), 'nothing is sent to a public repo');
check(E.S.counts.local.history.some((h) => h.id === pending), 'the count waits on the phone');
GH.repos[SHARED].priv = true;
r = await E.sy.syncAll();
check(!r.errors.length && readJSON(SHARED, 'counts.json').history.some((h) => h.id === pending), 'private again → it goes');

console.log('\n20. A deleted saved count stays deleted');
GH.tokens['tok-g'] = [SHARED];
await wait(1200); await E.sy.syncAll(); await F.sy.syncAll();
const hasCount = (doc, id) => !!doc && (doc.history || []).some((h) => h.id === id);
const shared = () => readJSON(SHARED, 'counts.json');
const oldCopy = JSON.parse(JSON.stringify(E.S.counts.local)); // what an old phone or an old backup still has
const [X, Y, Z, W] = E.S.counts.local.history.slice(0, 4).map((h) => h.id);
check(W && hasCount(F.S.counts.local, X), '(setup: both phones have the same saved counts)');
E.act('hist-del', { id: X, armed: '1' });
await wait(1000); await E.sy.syncAll(); await F.sy.syncAll();
check(!hasCount(shared(), X) && !hasCount(F.S.counts.local, X), 'deleted on one phone → gone from GitHub and the other phone');
const marks = shared().gone || {};
check(Object.keys(marks).join() === X && /^\d{4}-\d\d-\d\dT/.test(marks[X]), 'GitHub keeps only a marker: the count’s id and when it was deleted');
const G = await boot('G', Object.assign(invOnly('tok-g', 'GG'), { counts: { base: null, local: oldCopy, sha: null, src: null } }));
r = await G.sy.syncAll();
check(!r.errors.length && !hasCount(G.S.counts.local, X) && !hasCount(shared(), X), 'an old phone or old backup that still has it doesn’t bring it back');
check(hasCount(G.S.counts.local, Y) && hasCount(shared(), Y), '…and the counts it should have are all there');
E.S.counts.local.history.push(oldCopy.history.find((h) => h.id === X)); E.st.save('counts');
await E.sy.syncAll();
check(!hasCount(E.S.counts.local, X) && !hasCount(shared(), X), 'if it turns up on a phone again some other way, it isn’t sent back');
GH.offline = true;
E.act('hist-del', { id: Y, armed: '1' });
F.act('ord-placed', { id: Y });
await wait(1000); GH.offline = false;
await F.sy.syncAll(); r = await E.sy.syncAll();
const yOnGH = (shared().history || []).find((h) => h.id === Y);
check(hasCount(E.S.counts.local, Y) && yOnGH && yOnGH.order && yOnGH.order.status === 'placed', 'deleted on one phone while the other marked it placed: kept, so the order isn’t lost');
check(E.S.conflicts.some((c) => /Deleted on the phone/.test(c.note || '') && String(c.path).includes(Y)), '…with a note saying so');
await E.sy.syncAll(); await F.sy.syncAll(); await G.sy.syncAll();
check([E, F, G].every((P) => hasCount(P.S.counts.local, Y)) && hasCount(shared(), Y), '…and it stays on every phone afterwards');
GH.offline = true;
E.act('hist-del', { id: Z, armed: '1' });
await wait(5); // a moment apart, so the two deletion times differ
F.act('hist-del', { id: Z, armed: '1' });
await wait(1000); GH.offline = false;
const cfF = F.S.conflicts.length;
await E.sy.syncAll(); r = await F.sy.syncAll();
check(r.conflicts === 0 && F.S.conflicts.length === cfF, 'both phones delete the same count: no clash');
await E.sy.syncAll(); await G.sy.syncAll();
check([E, F, G].every((P) => !hasCount(P.S.counts.local, Z)) && !hasCount(shared(), Z), '…and it’s gone everywhere');
check(hasCount(shared(), W) && hasCount(G.S.counts.local, W), 'counts nobody deleted are untouched');

console.log('\n21. Floor plans in the Training repo');
addRepo('team/training');
GH.tokens['tok-e-train'] = ['team/training']; GH.tokens['tok-f-train'] = ['team/training']; GH.tokens['tok-v-train'] = ['team/training'];
readOnly.add('tok-v-train');
const trainOf = (P, tok) => Object.assign(P.S.settings, { trainOwner: 'team', trainRepo: 'training', trainToken: tok, trainBranch: 'main' });
const plansOnGH = () => readJSON('team/training', 'floorplans.json');
trainOf(E, 'tok-e-train');
E.st.edit('plans', (d) => Object.assign(d, JSON.parse(fixtureText('floorplans.json'))));
r = await E.sy.syncAll();
check(!r.errors.length && plansOnGH() && plansOnGH().versions.length === 3, 'floor plans go to the Training repo');
check(!GH.repos[SHARED].files['floorplans.json'] && !GH.repos['owner/book'].files['floorplans.json'], '…and to no other repo');
trainOf(F, 'tok-f-train');
await F.sy.syncAll();
check(F.S.plans.local && F.S.plans.local.live === 'v-now' && F.S.plans.local.versions.length === 3, 'another phone with access gets them');
const moveTable = (P, id, y) => P.st.edit('plans', (d) => { d.versions.find((v) => v.id === 'v-next').rooms.find((x) => x.id === 'r-main').items.find((i) => i.id === id).y = y; });
const tableYOnGH = (id) => plansOnGH().versions.find((v) => v.id === 'v-next').rooms.find((x) => x.id === 'r-main').items.find((i) => i.id === id).y;
moveTable(E, 't-1', 12); moveTable(F, 't-2', 13);
await E.sy.syncAll(); r = await F.sy.syncAll(); await E.sy.syncAll();
check(tableYOnGH('t-1') === 12 && tableYOnGH('t-2') === 13 && r.conflicts === 0, 'two people moving different tables in the same room: both moves kept, no clash');
const Vw = await boot('Vw', { settings: { trainOwner: 'team', trainRepo: 'training', trainToken: 'tok-v-train', trainBranch: 'main', initials: 'VV', setupDone: true } });
r = await Vw.sy.syncAll();
check(r.readOnly.includes('train') && Vw.S.plans.local && Vw.S.plans.local.versions.length === 3 && !Vw.sy.canWrite('plans'), 'a view-only key loads the floor plans but can’t change them');
const putsV = puts();
Vw.st.edit('plans', (d) => { d.live = 'v-next'; });
await Vw.sy.syncAll();
check(puts() === putsV && plansOnGH().live === 'v-now', 'nothing changed on a view-only phone is sent');

T.done();
