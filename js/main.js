// The Sheet: boot, routing, the app shell and global event handling.

import { app } from './app.js';
import { S, load, rollDay, onChange, anyDirty, hasBook, isTicked, dirty, flush } from './state.js';
import { $, esc, ago, debounce } from './util.js';
import { ICON, closeSheet, isSheetOpen, toast } from './ui.js';
import { configured, appMode, autoSync, onAutoSync, isSyncing, iosBrowserTab } from './sync.js';
import * as now from './views/now.js';
import * as book from './views/book.js';
import * as count from './views/count.js';
import * as lead from './views/lead.js';
import * as more from './views/more.js';
import * as quick from './views/quick.js';
import * as cards from './cardsheet.js';
import * as shift from './shift.js';
import * as msgs from './msgs.js';
import * as print from './print.js';
import * as maps from './views/maps.js';

app.version = '1.5.0';
const VIEWS = { now, book, count, lead, more, quick };
const TABS = [['now', 'Now', ICON.now], ['book', 'Book', ICON.book], ['count', 'Count', ICON.count], ['lead', 'Lead', ICON.lead], ['more', 'More', ICON.more]];
const INV_TABS = ['count', 'more'];
const tabsNow = () => (appMode() === 'inv' ? TABS.filter((t) => INV_TABS.includes(t[0])) : TABS);
[now, book, count, lead, more, quick, cards, shift, msgs, print, maps].forEach((m) => app.register(m));

let booted = false;
/* ---------- routing ---------- */
function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (h.startsWith('setup=')) {
    let v = h.slice(6), which = 'book';
    if (v.startsWith('inv:')) { which = 'inv'; v = v.slice(4); }
    const [owner, repo] = v.split('/'); more.prefill(owner, repo, which);
    history.replaceState(null, '', '#more'); return { tab: 'more', sub: '', id: '' };
  }
  const [tab, sub, ...rest] = h.split('/');
  const mode = appMode();
  if (mode === 'inv' && !INV_TABS.includes(tab)) return { tab: 'count', sub: tab === 'count' ? sub || '' : '', id: '' };
  return { tab: VIEWS[tab] ? tab : 'now', sub: sub || '', id: rest.join('/') };
}
const smallScreen = () => window.matchMedia('(max-width: 520px) and (max-height: 560px)').matches;

/* ---------- shell ---------- */
function statusChip() {
  if (!configured()) return '<button class="status" data-act="tab" data-id="more"><span class="dot off"></span>Not connected</button>';
  if (isSyncing()) return '<button class="status" data-act="tab" data-id="more"><span class="dot wait"></span>Syncing…</button>';
  if (S.settings.lastSyncError && navigator.onLine !== false) return '<button class="status" data-act="tab" data-id="more"><span class="dot bad"></span>Sync problem</button>';
  if (anyDirty()) return '<button class="status" data-act="tab" data-id="more"><span class="dot wait"></span>Changes to sync</button>';
  return '<button class="status" data-act="tab" data-id="more"><span class="dot ok"></span>' + esc(S.settings.lastSync ? 'Synced ' + ago(S.settings.lastSync) : 'Connected') + '</button>';
}
function renderHeader() {
  const t = $('#top-in'); if (!t) return;
  const d = new Date();
  t.innerHTML = '<div class="brand"><span class="brand-name">The Sheet</span><span class="brand-sub mono">' + esc(d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })) + '</span></div>' + statusChip();
}
function leadDot() {
  try { return lead.staleCount() > 0 || S.floor.people.some((p) => /overdue/.test(lead.floorSummary())); } catch (e) { return false; }
}
function renderNav() {
  const n = $('#nav-in'); if (!n) return;
  const cur = app.route.tab === 'quick' ? 'now' : app.route.tab;
  n.classList.toggle('two', appMode() === 'inv');
  n.innerHTML = tabsNow().map(([id, label, icon]) => '<button class="nav-b' + (cur === id ? ' on' : '') + '" data-act="tab" data-id="' + id + '" aria-current="' + (cur === id ? 'page' : 'false') + '">' + icon + '<span>' + label + '</span>' + (id === 'lead' && leadDot() ? '<i class="nav-dot"></i>' : '') + '</button>').join('');
}
/* Each screen gets a heading for screen readers and its own page title (WCAG 2.4.2, 1.3.1). */
const SUB_NAMES = { count: { order: 'Order', history: 'History', items: 'Items' }, book: { cards: 'Cards', sheet: 'Assignment sheet', day: 'The day', list: 'Checklist', maps: 'Floor plans', map: 'Floor plan' }, lead: { floor: 'Floor', msgs: 'Messages', train: 'Training', wins: 'Wins', printed: 'Printed copies' } };
function screenName() {
  const r = app.route, tab = (TABS.find((t) => t[0] === r.tab) || [])[1] || (r.tab === 'quick' ? 'Quick view' : 'The Sheet');
  const sub = SUB_NAMES[r.tab] && SUB_NAMES[r.tab][r.sub];
  return sub ? tab + ': ' + sub : tab;
}
app.renderView = () => {
  const v = $('#view'); if (!v) return;
  const mod = VIEWS[app.route.tab] || now;
  const name = screenName();
  document.title = name + ' · The Sheet';
  try { v.innerHTML = '<h1 class="sr" id="screen-h" tabindex="-1">' + esc(name) + '</h1>' + mod.render(app.route); }
  catch (e) { console.error(e); v.innerHTML = '<p class="empty">Something went wrong drawing this screen: ' + esc(e.message) + '. Your data is safe. <button class="link inline" data-act="tab" data-id="now">Go to Now</button></p>'; }
  document.body.classList.toggle('editing', !!app.ui.editing);
  document.body.classList.toggle('quick', app.route.tab === 'quick');
};
app.render = () => { renderHeader(); renderNav(); app.renderView(); };
app.applyTheme = () => {
  const t = S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
};

function route() {
  const prev = app.route;
  app.route = parseHash();
  if (app.route.tab === 'now' && app.route.sub === 'note') {
    history.replaceState(null, '', '#now'); app.route.sub = ''; app.ui.leftQuick = true;
    setTimeout(() => { if (hasBook()) shift.openNotes('notes'); }, 60);
  }
  if (app.route.tab === 'now' && !app.route.sub && S.settings.quick !== false && smallScreen() && !app.ui.leftQuick && appMode() === 'full') app.route = { tab: 'quick', sub: '', id: '' };
  if (prev.tab !== app.route.tab) { app.ui.editing = app.route.tab === 'book' ? app.ui.editing : false; if (app.route.tab === 'now') now.resetNow(); }
  if (isSheetOpen()) closeSheet(true);
  app.render();
  if (prev.tab !== app.route.tab || prev.sub !== app.route.sub || prev.id !== app.route.id) {
    window.scrollTo(0, 0);
    // Tell screen-reader users where they landed (not on first load).
    if (booted) { const hd = $('#screen-h'); if (hd) { try { hd.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }
  }
}

/* ---------- events ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (act === 'tab' || act === 'go') {
    ev.preventDefault(); app.ui.leftQuick = true;
    const h = act === 'tab' ? '#' + el.dataset.id : el.dataset.id;
    const nav = () => { if (location.hash === h) { app.route = parseHash(); app.render(); window.scrollTo(0, 0); } else location.hash = h; };
    if (isSheetOpen()) closeSheet().then(nav); else nav();
    return;
  }
  if (act === 'sheet-close') { closeSheet(); return; }
  if (act === 'quick-note') { shift.openNotes('notes'); return; }
  if (act === 'update-reload') { applyUpdate(); return; }
  const fn = app.acts[act];
  if (!fn) return;
  ev.preventDefault();
  try { const r = fn(el, ev); if (r && r.catch) r.catch((e) => { console.error(e); toast(e.message || 'Something went wrong.'); }); }
  catch (e) { console.error(e); toast(e.message || 'Something went wrong.'); }
  if (act === 'tick') { book.refreshListSummary(); if (app.route.tab === 'quick') app.renderView(); }
});
const onField = (ev) => {
  const el = ev.target;
  if (!(el instanceof HTMLElement) || !el.matches('input,select,textarea')) return;
  for (const fn of app.inputs) { try { if (fn(el, ev)) return; } catch (e) { console.error(e); } }
};
document.addEventListener('input', onField);
document.addEventListener('change', onField);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey && ev.target && ev.target.id === 'note-text') { ev.preventDefault(); app.acts['note-add'](); }
  if (ev.key === 'Enter' && ev.target && ev.target.classList && ev.target.classList.contains('qty')) { ev.target.blur(); }
  if (ev.key === 'Escape' && isSheetOpen()) closeSheet();
});
window.addEventListener('hashchange', route);
window.addEventListener('resize', debounce(() => {
  if (S.settings.quick === false) return;
  if (app.route.tab === 'quick' && !smallScreen()) { app.ui.leftQuick = false; location.hash = '#now'; }
  else if (app.route.tab === 'now' && smallScreen() && !isSheetOpen()) { app.ui.leftQuick = false; app.route = { tab: 'quick', sub: '', id: '' }; app.render(); }
}, 250));

/* Keep the Now screen live without interrupting typing. */
let lastMin = -1;
setInterval(() => {
  const m = new Date().getMinutes(); if (m === lastMin) return; lastMin = m;
  rollDay();
  const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches('input,textarea,select');
  if ((app.route.tab === 'now' || app.route.tab === 'quick' || (app.route.tab === 'lead' && app.route.sub === 'floor')) && !isSheetOpen() && !typing) app.renderView();
  renderHeader();
}, 15000);
/* Going to the background (another app, a locked screen) or closing: save anything still waiting,
   now. iOS can close a backgrounded app without warning, and saves normally wait a moment. */
function saveNow() {
  try { count.flushEdits(); } catch (e) { console.error(e); }
  flush().catch((e) => { S.storageError = String(e && e.message || e); });
}
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { saveNow(); return; } if (document.visibilityState === 'visible') { rollDay(); if (!isSheetOpen()) app.render(); autoSync('open'); } });
window.addEventListener('online', () => { renderHeader(); autoSync('online', 1500); });
window.addEventListener('offline', renderHeader);

/* After a quiet sync: redraw if something came in, unless someone's mid-typing. */
const typingNow = () => { const a = document.activeElement; return !!(a && a.matches && a.matches('input,textarea,select')); };
onAutoSync((report) => {
  renderHeader();
  if (!report) return;
  const changed = report.pulled.length || report.review || report.errors.length;
  if (changed && !typingNow() && !isSheetOpen()) app.renderView();
  if (report.review) toast(report.review + ' inventory change' + (report.review === 1 ? '' : 's') + ' clashed. Review on the Count tab.', 4000);
});

let headerQueued = false;
onChange((key) => {
  if (key === 'error') { toast('Couldn’t save to this phone’s storage: ' + (S.storageError || 'unknown error')); return; }
  // Inventory item edits sync on their own a little after the last change.
  if ((key === 'inv' || key === 'counts') && !isSyncing() && dirty(key)) autoSync('save', 20000);
  if (headerQueued) return; headerQueued = true;
  requestAnimationFrame(() => { headerQueued = false; renderHeader(); renderNav(); });
});

/* An iPhone using the app in a Safari tab: nudge to the home-screen app, where data is kept. */
function iosBanner() {
  if (!iosBrowserTab() || app.route.tab === 'more') return;
  const b = $('#banner-root'); if (!b || b.innerHTML) return;
  b.innerHTML = '<div class="wrap"><button class="banner warn" data-act="tab" data-id="more"><strong>You’re in Safari.</strong>Add The Sheet to your Home Screen (Share → Add to Home Screen) and use it from there, so your data is kept.</button></div>';
}

/* ---------- offline app updates ---------- */
let swReg = null;
function showUpdate() {
  const b = $('#banner-root'); if (!b) return;
  b.innerHTML = '<div class="wrap"><button class="banner update" data-act="update-reload"><strong>App update ready.</strong>Tap to reload. Your data stays put.</button></div>';
}
function applyUpdate() {
  if (swReg && swReg.waiting) swReg.waiting.postMessage('skip-waiting'); else location.reload();
}
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('./sw.js');
    if (swReg.waiting && navigator.serviceWorker.controller) showUpdate();
    swReg.addEventListener('updatefound', () => {
      const nw = swReg.installing; if (!nw) return;
      nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(); });
    });
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || !hadController) return; reloaded = true; location.reload(); });
    setInterval(() => { if (navigator.onLine) swReg.update().catch(() => {}); }, 60 * 60 * 1000);
  } catch (e) { console.warn('Service worker not registered', e); }
}

/* ---------- boot ---------- */
(async function boot() {
  await load();
  app.applyTheme();
  app.route = parseHash();
  if (!location.hash) { const m = appMode(); if (m === 'none') location.replace('#more'); else if (m === 'inv') location.replace('#count'); }
  route();
  booted = true;
  iosBanner();
  registerSW();
  autoSync('open', 1200);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', app.applyTheme);
})();
