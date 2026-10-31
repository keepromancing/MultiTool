// More: sync with the private repo, backups, imports, phone settings, links, and erase.

import { app } from '../app.js';
import { S, B, save, flush, eraseAll, dirty, anyDirty, hasBook, hasInv, SYNCED, migrateHistory, whoAmI } from '../state.js';
import { esc, ago, todayKey, downloadFile, shareFile, pickFile, clone, $ } from '../util.js';
import { ICON, empty, toast, armed, field, input, opts } from '../ui.js';
import { syncAll, testConnection, configured, isSyncing, FILES, conn, bookConfigured, invConfigured, connConfigured, SETTING, repoLabel, appMode, iosBrowserTab, perm } from '../sync.js';
import { persist, persisted } from '../db.js';

let lastResult = null, persistState = null, showConn = null, setupKind = null;
const NAMES = { book: 'Book', state: 'Follow-ups and logs', inv: 'Inventory items', counts: 'Saved counts and orders', plans: 'Floor plans' };
const CONN_LABEL = { book: 'Book', inv: 'Inventory', train: 'Training (floor plans)' };

function iosWarning() {
  if (!iosBrowserTab()) return '';
  return '<div class="banner warn static"><strong>Add The Sheet to your Home Screen first.</strong>In Safari, tap Share, then Add to Home Screen. Open it from the new icon and set up there. Anything set up in this Safari tab stays here and won’t carry over.</div>';
}

function connRow(which) {
  const c = conn(which), on = connConfigured(which);
  const label = CONN_LABEL[which];
  const keyless = !on && c.owner && c.repo; // e.g. right after restoring a backup: keys aren't in backups
  const p = perm(which) || {};
  const access = !on ? '' : p.lost ? ' · <b class="warn-t">no access</b>' : p.push === false ? ' · view only' : p.push ? ' · can edit' : '';
  let v;
  if (on) v = '<span class="mono">' + esc(repoLabel(c)) + '</span>' + access;
  else if (keyless) v = '<span class="mono">' + esc(repoLabel(c)) + '</span> · <b class="warn-t">needs its key</b>';
  else if (which === 'inv' && bookConfigured() && !S.settings.invShared) v = 'Using the book repo. Connect a shared repo so others can count and order with you.';
  else if (which === 'train') v = 'Not connected. Floor plans stay on this phone until it is.';
  else v = 'Not connected';
  const btnLabel = on ? 'Change' : keyless ? 'Add key' : (which === 'book' ? 'Connect' : which === 'inv' ? 'Connect shared repo' : 'Connect team repo');
  return '<div class="conn-row"><div><b>' + label + '</b><div class="hint">' + v + '</div></div><button class="btn small ghost" data-act="conn-toggle" data-which="' + which + '">' + ICON.key + ' ' + btnLabel + '</button></div>';
}

function setupCard() {
  let h = '<section class="panel"><div class="row-h"><h2 class="sec-h">' + ICON.sync + ' Set up</h2></div>' + iosWarning();
  h += '<p>What is this phone for?</p><div class="chips" role="group">' +
    '<button class="chip" data-act="setup-kind" data-id="inv" aria-pressed="' + (setupKind === 'inv') + '">Counting and ordering</button>' +
    '<button class="chip" data-act="setup-kind" data-id="book" aria-pressed="' + (setupKind === 'book') + '">My full book</button></div>';
  if (setupKind === 'inv') h += '<p class="hint">You’ll get the Count tab: the order sheet, saved counts and order status, shared with everyone else who orders. Ask whoever set it up for the repo name.</p>' + connForm('inv', true) + keyHelp('inv');
  else if (setupKind === 'book') h += '<p class="hint">Connect your private book repo to load the book and inventory, and to back up your edits.</p>' + connForm('book', true) + keyHelp('book');
  return h + '</section>';
}

const knownRepo = (which) => { const c = conn(which); return !!(c.owner && c.repo); };
function syncCard() {
  // A restored backup brings the repo names but not the keys: show the rows so only the keys need pasting.
  const restored = !configured() && (hasBook() || hasInv()) && (knownRepo('book') || knownRepo('inv'));
  if (!configured() && !restored) return setupCard();
  let h = '<section class="panel"><div class="row-h"><h2 class="sec-h">' + ICON.sync + ' Sync</h2></div>' + iosWarning();
  const waiting = SYNCED.filter(dirty);
  h += '<p class="sync-status">' + (S.settings.lastSync ? 'Last synced ' + esc(ago(S.settings.lastSync)) : 'Not synced yet') + '. ' + (waiting.length ? '<b>Changes waiting:</b> ' + esc(waiting.map((k) => NAMES[k]).join(', ')) + '.' : 'Nothing waiting.') + '</p>';
  if (lastResult) h += '<p class="note">' + esc(lastResult) + '</p>';
  else if (S.settings.lastSyncError) h += '<p class="note warn-t">Last sync didn’t finish: ' + esc(S.settings.lastSyncError) + '</p>';
  if (!restored) h += '<p class="hint">It also syncs on its own when the app opens and after you save a count, whenever there’s signal.</p>';
  if (!restored) h += '<div class="row-actions"><button class="btn primary big" data-act="sync-now"' + (isSyncing() ? ' disabled' : '') + '>' + ICON.sync + (isSyncing() ? ' Syncing…' : ' Sync now') + '</button></div>';
  const mode = appMode();
  if (restored) h += '<p class="note">Restored from a backup. Paste the key for each connection to start syncing again.</p>';
  h += '<div class="conns">' + (mode === 'full' ? connRow('book') : '') + connRow('inv') + (mode === 'full' || connConfigured('train') ? connRow('train') : '') + '</div>';
  if (showConn) h += connForm(showConn, false) + keyHelp(showConn);
  const notes = (S.conflicts || []).filter((c) => !c.review);
  if (notes.length) {
    h += '<details class="hist"><summary><span class="hdate">' + notes.length + ' merge note' + (notes.length === 1 ? '' : 's') + '</span><span class="hsum">The same thing changed on the phone and on GitHub. The phone’s version was kept unless a note says otherwise.</span></summary><div class="hbody"><ul class="plain-list">' +
      notes.slice().reverse().map((c) => '<li><b>' + esc(c.file) + '</b> ' + esc(c.path.replace(/^\./, '')) + (c.note ? ' · ' + esc(c.note) : '') + ' · ' + esc(ago(c.at)) + '</li>').join('') + '</ul><button class="btn small ghost" data-act="conflicts-clear">Clear notes</button></div></details>';
  }
  if ((S.conflicts || []).some((c) => c.review)) h += '<p class="note"><button class="link inline" data-act="go" data-id="#count">Inventory changes clashed. Review them on the Count tab.</button></p>';
  return h + '</section>';
}

function connForm(which, first) {
  const c = conn(which), inv = which === 'inv';
  const repoVal = c.owner && c.repo ? c.owner + '/' + c.repo : '';
  const REPO = { book: ['Book repo', 'Your username or organization, a slash, and the repo name. Must be private.'], inv: ['Inventory repo', 'Like team-name/inventory. A github.com link works too.'], train: ['Training repo', 'Like team-name/training. Holds the floor plans. Must be private.'] }[which];
  let h = '<div class="form conn" data-which="' + which + '">';
  h += field('cf-repo-' + which, REPO[0], input('cf-repo-' + which, repoVal, 'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="owner/repo-name"'), REPO[1]);
  h += field('cf-token-' + which, 'Key (fine-grained token)', '<input id="cf-token-' + which + '" type="password" autocomplete="off" spellcheck="false" placeholder="' + (c.token ? 'Saved. Paste a new one to replace it.' : 'github_pat_…') + '">', 'Stays on this phone. It’s left out of backups.');
  if (first && inv) h += field('cf-init', 'Your initials', input('cf-init', S.settings.initials || '', 'data-setting="initials" autocomplete="off" autocapitalize="characters" maxlength="3" placeholder="AB"'), 'Goes on your counts so others know who counted.', 'half');
  h += '<div class="row-actions full"><button class="btn primary" data-act="conn-save" data-which="' + which + '">' + (first ? 'Connect and sync' : 'Test and save') + '</button>' + (!first && connConfigured(which) ? '<button class="btn danger" data-act="conn-forget" data-which="' + which + '">Disconnect</button>' : '') + '</div></div>';
  return h;
}
/* The Training repo belongs to the organization, like inventory. The owner adds it to the key they
   already use for inventory; members use a key with All repositories, which covers it once they're given access. */
function keyHelpTeam() {
  return '<details class="todo-list"><summary>Which key to use</summary><ol class="help-steps">' +
    '<li><b>If you set up the organization:</b> on github.com, open your picture → <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b>, open the key you use for inventory, and add the training repo under <b>Only select repositories</b>. Save, then paste that same key above.</li>' +
    '<li><b>Everyone else:</b> your organization key (the one with <b>All repositories</b>) already covers it once you’ve been given access. Paste that key above.</li>' +
    '<li>The key needs <b>Contents: Read and write</b> to edit floor plans. With view-only access, the maps still load and print.</li></ol>' +
    '<p class="hint">The key stays on this phone and is left out of backups.</p></details>';
}
function keyHelp(which) {
  if (which === 'train') return keyHelpTeam();
  const inv = which === 'inv';
  return '<details class="todo-list"><summary>How to make the key</summary>' +
    (inv ? '' : '<p class="hint">Book repo in an organization you own? Use the key you already have there: open it on the page in step 1, add the book repo under <b>Only select repositories</b>, save, and paste it above. Otherwise:</p>') +
    '<ol class="help-steps">' +
    '<li>On github.com, open your picture → <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b>, and tap <b>Generate new token</b>.</li>' +
    '<li>Name it “The Sheet phone”. Set an expiration you’re comfortable with (a year is fine; you’ll paste a new one when it runs out).</li>' +
    (inv ? '<li><b>Resource owner:</b> pick the organization that owns the inventory repo, not your own account. If it isn’t listed, ask to be added to the organization first.</li>' : '') +
    (inv ? '<li><b>Repository access:</b> All repositories. The key only reaches what the organization has given you, and if you’re given more later, the same key covers it.</li>'
      : '<li><b>Repository access:</b> Only select repositories → your book repo. Nothing else.</li>') +
    '<li><b>Permissions → Repository permissions → Contents:</b> Read and write. Leave everything else as it is.</li>' +
    '<li>Generate, copy the token, and paste it above.</li></ol><p class="hint">' + (inv ? 'The key can only reach what the organization gives you, and only its files. If the organization asks for approval, its owner approves the key before it works.' : 'That key can only touch the one repo.') + ' If the phone is ever lost, delete the token on GitHub and it stops working.</p></details>';
}

function backupCard() {
  const inv = appMode() === 'inv';
  return '<section class="panel"><div class="row-h"><h2 class="sec-h">' + ICON.download + ' Backup</h2></div>' +
    (inv ? '<p>Saved counts and items are already kept in the shared repo. A backup file also holds the count in progress. The GitHub key is left out.</p>'
      : '<p>A backup file holds the book, inventory, saved counts and settings. It never holds the GitHub keys, shift notes, the floor board, message drafts, clash notes or the staffing plan: those are daily, can name people, or have their own file.</p><p class="hint">It does hold trainees as plain text. Keep backup files somewhere private, and delete old ones. On a new phone, import the staffing plan file separately.</p>') +
    '<p class="hint">Last backup file: ' + esc(S.settings.lastExport ? ago(S.settings.lastExport) : 'never') + '.</p>' +
    '<div class="row-actions"><button class="btn" data-act="backup-share">' + ICON.share + ' Save backup</button><button class="btn ghost" data-act="import">' + ICON.upload + ' Import a file</button></div>' +
    (inv ? '' : '<p class="hint">Import takes a backup file, the phone-only staffing plan file, or a book or inventory file.</p>') + '</section>';
}
function phoneCard() {
  const s = S.settings, full = appMode() === 'full';
  const iosApp = /iPad|iPhone|iPod/.test(navigator.userAgent || '') && !iosBrowserTab();
  const ps = iosApp ? 'Kept by the Home Screen app. Deleting the app deletes it.' : persistState == null ? 'Checking…' : persistState ? 'Protected: the phone won’t clear it to save space.' : 'Not protected yet. Installing the app to your home screen usually fixes that.';
  return '<section class="panel"><div class="row-h"><h2 class="sec-h">This phone</h2></div><div class="form">' +
    field('st-name', 'Sign messages as', input('st-name', s.name, 'data-setting="name" autocomplete="name" placeholder="Your name"'), '', 'half') +
    field('st-init', 'Initials', input('st-init', s.initials || '', 'data-setting="initials" autocomplete="off" autocapitalize="characters" maxlength="3" placeholder="' + esc(whoAmI() || 'AB') + '"'), 'On counts and item changes', 'half') +
    field('st-theme', 'Look', '<select id="st-theme" data-setting="theme">' + opts([['auto', 'Match the phone'], ['light', 'Light'], ['dark', 'Dark']], s.theme) + '</select>', '', 'half') +
    (full ? field('st-quick', 'Small screens', '<select id="st-quick" data-setting="quick">' + opts([['true', 'Open to the quick view'], ['false', 'Normal view']], String(s.quick !== false)) + '</select>', 'Like the Flip’s cover screen', 'half') : '') +
    '</div><p class="hint">Storage: ' + esc(ps) + '</p>' + (full ? '<div class="row-actions"><button class="btn small ghost" data-act="go" data-id="#quick">' + ICON.grid + ' Open quick view</button></div>' : '') + '</section>';
}
function linksCard() {
  const links = (B().links || []);
  if (!links.length) return '';
  return '<section class="panel"><div class="row-h"><h2 class="sec-h">' + ICON.link + ' Links</h2></div><ul class="plain-list links">' + links.map((l) => '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a></li>').join('') + '</ul><p class="hint">These open in the browser and need a connection.</p></section>';
}
function aboutCard() {
  const full = appMode() !== 'inv';
  return '<section class="panel"><div class="row-h"><h2 class="sec-h">About</h2></div>' +
    '<p>The Sheet ' + esc(app.version) + '. The app itself holds no work content. ' + (full ? 'The book comes from your private repo, and inventory from the shared inventory repo (or the book repo if there isn’t one); everything else stays on this phone.' : 'The inventory comes from the shared inventory repo; everything else stays on this phone.') + '</p>' +
    (full ? '<ul class="plain-list"><li><b>Synced to the book repo:</b> book, follow-ups, wins, printed log.</li><li><b>Synced to the inventory repo:</b> inventory items, saved counts, order status.</li><li><b>Synced to the training repo:</b> floor plans.</li><li><b>Phone only:</b> today’s ticks, shift notes, floor board, trainees, message drafts, staffing plan, the count in progress, the keys.</li></ul>'
      : '<ul class="plain-list"><li><b>Shared:</b> inventory items, saved counts, order status, with your initials.</li><li><b>Phone only:</b> the count in progress and the key.</li></ul>') +
    '<div class="row-actions"><button class="btn small ghost" data-act="check-update">Check for an app update</button><button class="btn small danger" data-act="erase">' + ICON.trash + ' Erase this phone’s data</button></div></section>';
}

export function render() {
  if (persistState == null) persisted().then((v) => { persistState = !!v; if (app.route.tab === 'more') app.renderView(); });
  return syncCard() + backupCard() + phoneCard() + linksCard() + aboutCard();
}

/* ---------- backup and import ---------- */
/* What a backup file holds. Left out on purpose: today's shift notes (their resident section is keyed
   by room or table), the floor board and break times, remembered staff names, message drafts
   (incident notes included) and clash notes (copies of both sides' values). They're daily, and they
   can name people; a backup file goes to Downloads or wherever it's shared. Keys never go in. */
const BACKUP_KEYS = ['book', 'inv', 'state', 'counts', 'plans', 'count', 'day', 'trainees', 'settings'];
// Older backups may still have these. The staffing plan (priv) comes only from its own phone-only file.
const NEVER_RESTORE = ['shift', 'floor', 'msgs', 'conflicts', 'priv'];
const NO_BACKUP_SETTINGS = ['token', 'invToken', 'trainToken', 'floorNames'];
export function backupJSON() {
  const data = {};
  BACKUP_KEYS.forEach((k) => { data[k] = clone(S[k]); });
  NO_BACKUP_SETTINGS.forEach((k) => { delete data.settings[k]; });
  return JSON.stringify({ type: 'multitool-backup', schema: 1, exported: new Date().toISOString(), app: app.version, data }, null, 1);
}
/* Put a backup's data on this phone. Keys, connections and today's phone-only things stay as they are. */
export function restoreBackupData(data) {
  const keep = { token: S.settings.token, owner: S.settings.owner, repo: S.settings.repo, invToken: S.settings.invToken, invOwner: S.settings.invOwner, invRepo: S.settings.invRepo, trainToken: S.settings.trainToken, trainOwner: S.settings.trainOwner, trainRepo: S.settings.trainRepo, floorNames: S.settings.floorNames };
  Object.keys(data).forEach((k) => { if (k in S && !NEVER_RESTORE.includes(k)) { S[k] = data[k]; save(k); } });
  S.settings = Object.assign({}, S.settings, { token: keep.token || '', owner: S.settings.owner || keep.owner, repo: S.settings.repo || keep.repo, invToken: keep.invToken || '', invOwner: S.settings.invOwner || keep.invOwner || '', invRepo: S.settings.invRepo || keep.invRepo || '', trainToken: keep.trainToken || '', trainOwner: S.settings.trainOwner || keep.trainOwner || '', trainRepo: S.settings.trainRepo || keep.trainRepo || '', setupDone: true });
  if (keep.floorNames) S.settings.floorNames = keep.floorNames; else delete S.settings.floorNames;
  migrateHistory();
  save('settings');
}
async function importFile() {
  const f = await pickFile();
  if (!f) return;
  let j; try { j = JSON.parse(f.text); } catch (e) { toast('That file isn’t JSON.'); return; }
  if (j && j.type === 'multitool-private') {
    S.priv = S.priv || { staffPlan: null, cards: [] };
    if (j.staffPlan) S.priv.staffPlan = j.staffPlan;
    (j.cards || []).forEach((c) => { const i = (S.priv.cards || []).findIndex((x) => x.id === c.id); if (i >= 0) S.priv.cards[i] = c; else (S.priv.cards = S.priv.cards || []).push(c); });
    save('priv'); toast('Imported the phone-only file. It stays on this phone.'); app.render(); return;
  }
  if (j && j.type === 'multitool-backup' && j.data) {
    if (!confirm('Replace everything on this phone with the backup from ' + (j.exported || 'that file').slice(0, 10) + '?')) return;
    restoreBackupData(j.data);
    await flush(); toast('Backup restored.'); app.go(appMode() === 'inv' ? '#count' : '#now'); return;
  }
  if (j && Array.isArray(j.lists) && Array.isArray(j.cards)) {
    if (hasBook() && !confirm('Replace the book on this phone with this file?')) return;
    S.book.local = j; save('book'); toast('Book loaded.'); app.go('#now'); return;
  }
  if (j && Array.isArray(j.versions) && (j.type === 'the-sheet-floorplans' || 'live' in j)) {
    if ((S.plans.local && (S.plans.local.versions || []).length) && !confirm('Replace the floor plans on this phone with this file?')) return;
    const d = clone(j); delete d.type; S.plans.local = d; save('plans'); toast('Floor plans loaded.'); app.go('#book/maps'); return;
  }
  if (j && Array.isArray(j.lines) && Array.isArray(j.cats)) {
    if (hasInv() && !confirm('Replace the inventory on this phone with this file?')) return;
    S.inv.local = j; save('inv'); toast('Inventory loaded.'); app.go('#count'); return;
  }
  toast('Didn’t recognize that file.');
}

async function doSync() {
  lastResult = null; app.renderView();
  try {
    const r = await syncAll();
    const parts = [], F = { book: 'the book', state: 'follow-ups and logs', inv: 'inventory items', counts: 'saved counts', plans: 'floor plans' };
    const nice = (a) => a.map((f) => F[f] || f).join(', ');
    if (r.pulled.length) parts.push('got updates to ' + nice(r.pulled));
    if (r.pushed.length) parts.push('saved ' + nice(r.pushed) + ' to GitHub');
    if (r.review) parts.push(r.review + ' clash' + (r.review === 1 ? '' : 'es') + ' to review on the Count tab');
    if (r.readOnly.length) parts.push(r.readOnly.map((w) => ({ inv: 'inventory', train: 'the floor plans', book: 'the book' })[w] || w).join(' and ') + (r.readOnly.length === 1 ? ' is' : ' are') + ' view only for this key');
    if (r.conflicts - r.review > 0) parts.push((r.conflicts - r.review) + ' merge note' + (r.conflicts - r.review === 1 ? '' : 's'));
    lastResult = parts.length ? 'Synced: ' + parts.join('; ') + '.' : 'Synced. Everything already matched.';
    if (r.errors.length) { lastResult = (parts.length ? lastResult + ' ' : '') + 'Didn’t finish: ' + r.errors.map((e) => e.message).join(' '); toast('Sync didn’t finish.'); }
    else toast('Synced.');
  } catch (e) { lastResult = e.message || String(e); toast('Sync didn’t finish.'); }
  app.render();
}

export const acts = {
  'sync-now': () => doSync(),
  'setup-kind': (el) => { setupKind = el.dataset.id; app.renderView(); },
  'conn-toggle': (el) => { const w = el.dataset.which || 'book'; showConn = showConn === w ? null : w; app.renderView(); },
  'conn-save': async (el) => {
    const which = el.dataset.which || 'book', inv = which === 'inv', K = SETTING[which];
    if (!K) return;
    const parsed = parseRepo($('#cf-repo-' + which).value);
    const prevTok = S.settings[K.token];
    const tok = $('#cf-token-' + which).value.trim() || prevTok;
    if (!parsed || !tok) { toast('Fill in the repo (owner/name) and the key.'); return; }
    const label = el.textContent;
    el.disabled = true; el.textContent = 'Checking…';
    try {
      const info = await testConnection({ owner: parsed.owner, repo: parsed.repo, token: tok });
      if (!info.private) { toast('That repo is public. Make it private on GitHub first; this shouldn’t be public.'); el.disabled = false; el.textContent = label; return; }
      Object.assign(S.settings, { [K.owner]: parsed.owner, [K.repo]: parsed.repo, [K.token]: tok, [K.branch]: info.defaultBranch, setupDone: true });
      if (inv) S.settings.invShared = true;
      S.settings.perm = Object.assign({}, S.settings.perm, { [which]: { push: info.push, at: new Date().toISOString() } });
      save('settings');
      showConn = null; setupKind = null;
      toast(info.push ? 'Connected. Syncing…' : 'Connected, view only. Syncing…');
      await doSync();
      persist().then((v) => { persistState = !!v; });
      if (inv && appMode() === 'inv') app.go('#count');
    } catch (e) { toast(e.message || 'Couldn’t connect.'); el.disabled = false; el.textContent = label; }
  },
  'conn-forget': (el) => {
    if (!armed(el, 'Forget the key?')) return;
    const K = SETTING[el.dataset.which || 'book']; if (!K) return;
    if (el.dataset.which === 'book' || !el.dataset.which) S.settings.token = '';
    else { S.settings[K.token] = ''; S.settings[K.owner] = ''; S.settings[K.repo] = ''; }
    save('settings'); showConn = null; toast('Key removed from this phone. Your data stays.'); app.render();
  },
  'conflicts-clear': () => { S.conflicts = []; save('conflicts'); app.renderView(); },
  'backup-share': async () => { const name = 'the-sheet-backup-' + todayKey() + '.json'; const r = await shareFile(name, backupJSON()); if (r !== 'cancelled') { S.settings.lastExport = new Date().toISOString(); save('settings'); toast(r === 'shared' ? 'Backup shared.' : 'Backup saved to Downloads.'); app.renderView(); } },
  'import': () => importFile(),
  'erase': async (el) => { if (!armed(el, 'Erase everything here?')) return; if (!confirm('Erase everything The Sheet has stored on this phone? Anything not synced or backed up is gone for good.')) return; await eraseAll(); toast('Erased.'); app.go('#now'); },
  'check-update': async () => { try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) { await reg.update(); toast(reg.waiting || reg.installing ? 'Update found. It’s getting ready.' : 'You have the latest version.'); } else toast('Updates work once the app is installed.'); } catch (e) { toast('Couldn’t check. Are you online?'); } }
};
export function onInput(el, ev) {
  if (!el.dataset.setting) return false;
  const k = el.dataset.setting;
  if (k === 'quick') S.settings.quick = el.value === 'true';
  else if (k === 'initials') { S.settings.initials = el.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3); if (el.value !== S.settings.initials && ev.type === 'change') el.value = S.settings.initials; }
  else S.settings[k] = el.value;
  save('settings');
  if (k === 'theme') app.applyTheme();
  return true;
}
/* Accepts owner/repo, a github.com link, or a clone URL. */
export function parseRepo(text) {
  const t = String(text || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/^git@github\.com:/i, '').replace(/\.git$/i, '').replace(/[?#].*$/, '');
  const [owner, repo] = t.split('/').map((x) => (x || '').trim());
  if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { owner, repo };
}
/* From a setup link: #setup=owner/repo (book) or #setup=inv:owner/repo (inventory only). */
export function prefill(owner, repo, which) {
  if (which === 'inv') { if (owner && !S.settings.invOwner) S.settings.invOwner = owner; if (repo && !S.settings.invRepo) S.settings.invRepo = repo; setupKind = 'inv'; }
  else { if (owner && !S.settings.owner) S.settings.owner = owner; if (repo && !S.settings.repo) S.settings.repo = repo; setupKind = 'book'; }
  save('settings');
}
