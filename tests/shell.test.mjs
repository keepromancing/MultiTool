// Boots the whole app (js/main.js) with a fake page, then visits every screen and checks each one
// draws without an error. Runs three phones: full app, count-only, and not set up.
import path from 'node:path';
import { makePhone, outDir, checker } from './lib/phone.mjs';
import { fullPhone, invPhone } from './lib/fixtures.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ME = fileURLToPath(import.meta.url);

/* The parent runs one child process per phone, because main.js can only boot once per process. */
if (!process.argv[2]) {
  const out = outDir();
  let bad = 0;
  for (const mode of ['full', 'inv', 'none']) {
    console.log('\n== ' + mode);
    const r = spawnSync(process.execPath, [ME, mode], { stdio: 'inherit', env: Object.assign({}, process.env, { THE_SHEET_TEST_OUT: out }) });
    if (r.status !== 0) bad++;
  }
  process.exit(bad ? 1 : 0);
}

const mode = process.argv[2];
const T = checker();
const els = {};
const mk = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', classList: { s: new Set(), toggle(c, on) { if (on === false) this.s.delete(c); else this.s.add(c); }, add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); } }, setAttribute() {}, removeAttribute() {}, focus() {}, querySelector: () => null });
const handlers = {};
globalThis.window = globalThis;
globalThis.document = {
  querySelector: (s) => (s.startsWith('#') ? mk(s.slice(1)) : null), querySelectorAll: () => [], getElementById: (id) => mk(id),
  createElement: () => mk('x' + Math.random()), body: mk('body'), documentElement: mk('html'), activeElement: null, contains: () => false,
  visibilityState: 'visible', title: '', addEventListener: (t, f) => { (handlers['doc:' + t] = handlers['doc:' + t] || []).push(f); }
};
globalThis.addEventListener = (t, f) => { (handlers['win:' + t] = handlers['win:' + t] || []).push(f); };
globalThis.scrollTo = () => {};
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
let hash = '';
globalThis.location = { get hash() { return hash; }, set hash(h) { hash = h.startsWith('#') ? h : '#' + h; (handlers['win:hashchange'] || []).forEach((f) => f()); }, replace(h) { hash = h; }, reload() {} };
globalThis.history = { replaceState: (a, b, h) => { hash = h; }, pushState() {}, back() {} };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test', platform: 'Linux', maxTouchPoints: 0, onLine: false, storage: null } });
globalThis.fetch = async () => { throw new TypeError('offline'); };

const name = { full: 'F', inv: 'I', none: 'N' }[mode];
const dir = makePhone(name, outDir());
globalThis['__mem_' + name] = mode === 'full' ? fullPhone() : mode === 'inv' ? invPhone() : {};

const errors = [];
const origErr = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ')); };
await import(path.join(dir, 'js/main.js'));
await new Promise((r) => setTimeout(r, 300));
const { appMode } = await import(path.join(dir, 'js/sync.js'));
T.check(appMode() === mode, 'mode is ' + appMode());
const tabs = (mk('nav-in').innerHTML.match(/data-id="(\w+)"/g) || []).map((x) => x.slice(9, -1));
T.check(mode === 'inv' ? tabs.join() === 'count,more' : tabs.length === 5, 'tabs: ' + tabs.join(', '));
for (const h of ['#now', '#book', '#book/cards', '#book/sheet', '#book/day', '#count', '#count/order', '#count/history', '#count/items', '#lead', '#lead/floor', '#lead/msgs', '#lead/train', '#lead/wins', '#lead/printed', '#more', '#quick', '#book/maps', '#book/map/v-now/r-main']) {
  location.hash = h;
  await new Promise((r) => setTimeout(r, 10));
  const v = mk('view').innerHTML;
  const where = (/class="nav-b on"[^>]*data-id="(\w+)"/.exec(mk('nav-in').innerHTML) || [])[1];
  const broke = /Something went wrong/.test(v);
  T.check(v.length > 50 && !broke, h.padEnd(15) + ' → ' + where + (broke ? ': ' + v.slice(0, 200) : ''));
  T.check(/<h1 class="sr" id="screen-h"/.test(v) && / · The Sheet$/.test(document.title), '   has a page heading and title (' + document.title + ')');
}
if (mode === 'inv') T.check(!/data-id="(now|book|lead)"/.test(mk('nav-in').innerHTML), 'count-only phone never shows Now, Book or Lead');
T.check(/Not connected|Synced|Changes|Sync problem|Connected|Syncing/.test(mk('top-in').innerHTML), 'status chip shows');
console.error = origErr;
T.check(!errors.length, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
T.done();
