// Sync with private GitHub repos through the GitHub API, using fine-grained keys.
// Each "part" of the app lives in its own repo, and access is managed on GitHub, not in the app:
//   book: book.json and state.json (one person's book, follow-ups and logs)
//   inv:  inventory.json and counts.json (shared between the people who count and order)
//   train: floorplans.json (training material for the team; later the new-hire cards)
// Every sync asks GitHub what this key can do with each repo. Write access: normal. Read-only:
// the part still loads but nothing is pushed, and the screens go view-only. No access: that part
// stops syncing and says so. So adding or removing someone is a change on GitHub only.
// Until a shared inventory repo has been connected, inventory and counts sync to the book repo.
// Sync runs when you tap Sync, and quietly on its own when the app opens or a count is saved.

import { S, save, flush, migrateHistory, whoAmI, SYNCED, dirty, hasBook, hasInv } from './state.js';
import { mergeDoc, getAtPath, dropGone } from './merge.js';
import { clone, same } from './util.js';

const API = 'https://api.github.com';
export const FILES = { book: 'book.json', state: 'state.json', inv: 'inventory.json', counts: 'counts.json', plans: 'floorplans.json' };
const INV_KEYS = ['inv', 'counts'];
const TRAIN_KEYS = ['plans'];
export const CONNS = ['book', 'inv', 'train'];

/* ---------- connections ---------- */
export function conn(which) {
  const s = S.settings;
  if (which === 'inv') return { owner: s.invOwner, repo: s.invRepo, token: s.invToken, branch: s.invBranch || 'main' };
  if (which === 'train') return { owner: s.trainOwner, repo: s.trainRepo, token: s.trainToken, branch: s.trainBranch || 'main' };
  return { owner: s.owner, repo: s.repo, token: s.token, branch: s.branch || 'main' };
}
/* The settings that hold each connection. */
export const SETTING = { book: { owner: 'owner', repo: 'repo', token: 'token', branch: 'branch' }, inv: { owner: 'invOwner', repo: 'invRepo', token: 'invToken', branch: 'invBranch' }, train: { owner: 'trainOwner', repo: 'trainRepo', token: 'trainToken', branch: 'trainBranch' } };
const ok = (c) => !!(c && c.owner && c.repo && c.token);
export const bookConfigured = () => ok(conn('book'));
export const invConfigured = () => ok(conn('inv'));
export const trainConfigured = () => ok(conn('train'));
export const connConfigured = (which) => ok(conn(which));
export const configured = () => bookConfigured() || invConfigured();
/* full: the whole app (a book is loaded or connected). inv: count and order only. none: not set up. */
export function appMode() {
  if (bookConfigured() || hasBook()) return 'full';
  if (invConfigured() || hasInv()) return 'inv';
  return 'none';
}
/* An iPhone running the app in a Safari tab instead of from the home screen. Data there is
   separate from the installed app's and Safari may clear it, so setup belongs in the installed app. */
export function iosBrowserTab() {
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  const standalone = navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  return !standalone;
}
const repoId = (c) => (String(c.owner) + '/' + String(c.repo)).toLowerCase();
export const repoLabel = (c) => c.owner + '/' + c.repo;

/* Which connection a synced file goes to right now ('book' | 'inv'), or null if none.
   Once a shared inventory repo has been connected, inventory never falls back to the book repo,
   even if the shared connection is removed: the book repo's copy would be stale. */
export function connOf(key) {
  if (TRAIN_KEYS.includes(key)) return trainConfigured() ? 'train' : null;
  if (INV_KEYS.includes(key)) {
    if (invConfigured()) return 'inv';
    return !S.settings.invShared && bookConfigured() ? 'book' : null;
  }
  return bookConfigured() ? 'book' : null;
}
export const target = (key) => { const w = connOf(key); return w ? conn(w) : null; };

/* What this phone's key may do, as GitHub last said: { push, id, at }. Unknown counts as writable. */
export const perm = (which) => (S.settings.perm && S.settings.perm[which]) || null;
export function canWrite(key) {
  const w = connOf(key);
  if (!w) return true; // not connected: edits stay on the phone, as before
  const p = perm(w);
  return !p || p.push !== false;
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class SyncError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function gh(method, path, body, c) {
  let res;
  try {
    res = await fetch(API + '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + path, {
      method,
      cache: 'no-store',
      headers: Object.assign({ Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new SyncError(navigator.onLine === false ? 'No connection. Everything is saved on this phone; it syncs when you’re back online.' : 'Couldn’t reach GitHub. Check the connection and try again.', 0);
  }
  if (res.status === 401) throw new SyncError('GitHub didn’t accept the key for ' + repoLabel(c) + '. It may have expired. Make a new one and paste it in More → Sync.', 401);
  if (res.status === 403) {
    const left = res.headers.get('x-ratelimit-remaining');
    throw new SyncError(left === '0' ? 'GitHub says to slow down. Try again in a few minutes.' : 'The key for ' + repoLabel(c) + ' works but isn’t allowed to do this. It needs Contents: read and write on that repo. If the repo belongs to an organization, its owner may still need to approve the key.', 403);
  }
  return res;
}

/* Ask GitHub about the repo: is it there for this key, can the key write, what's its id.
   The id stays the same if the repo or its organization is renamed. */
async function repoMeta(c) {
  const res = await gh('GET', '', null, c);
  if (res.status === 404) throw new SyncError('Can’t see ' + repoLabel(c) + '. Either the name is wrong, the key wasn’t made for it (for an organization’s repo, the key’s owner has to be the organization), or your access was removed.', 404);
  if (!res.ok) throw new SyncError('GitHub error ' + res.status + ' checking ' + repoLabel(c) + '.', res.status);
  const j = await res.json();
  return { id: j.id != null ? String(j.id) : null, push: !(j.permissions && j.permissions.push === false), branch: j.default_branch || c.branch || 'main', private: typeof j.private === 'boolean' ? j.private : null };
}

async function getFile(path, c) {
  const res = await gh('GET', '/contents/' + path + '?ref=' + encodeURIComponent(c.branch || 'main'), null, c);
  if (res.status === 404) return null; // the repo was checked first, so this means "no such file yet"

  if (res.status === 409) return null; // empty repo with no commits yet
  if (!res.ok) throw new SyncError('GitHub error ' + res.status + ' reading ' + path + '.', res.status);
  const j = await res.json();
  let text;
  if (j.content && j.encoding === 'base64') text = b64decode(j.content);
  else {
    // Files over 1 MB come back without content; fetch the raw blob.
    const raw = await gh('GET', '/git/blobs/' + j.sha, null, c);
    if (!raw.ok) throw new SyncError('Couldn’t read ' + path + ' (' + raw.status + ').', raw.status);
    const rj = await raw.json(); text = b64decode(rj.content);
  }
  try { return { sha: j.sha, json: JSON.parse(text) }; } catch (e) { throw new SyncError(path + ' on GitHub isn’t valid JSON, so it wasn’t loaded. Fix it there and sync again.', 0); }
}

async function putFile(path, json, sha, message, c) {
  const body = { message, content: b64encode(JSON.stringify(json, null, 1) + '\n'), branch: c.branch || 'main' };
  if (sha) body.sha = sha;
  const res = await gh('PUT', '/contents/' + path, body, c);
  if (res.status === 409 || res.status === 422) return { conflict: true };
  if (!res.ok) throw new SyncError('GitHub error ' + res.status + ' saving ' + path + '.', res.status);
  const j = await res.json();
  return { sha: j.content && j.content.sha };
}

/* Find the object with this id anywhere in a document (for "who changed it"). */
function findById(node, id) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const x of node) { const f = findById(x, id); if (f) return f; } return null; }
  if (node.id === id) return node;
  for (const k of Object.keys(node)) { const f = findById(node[k], id); if (f) return f; }
  return null;
}
function whoChanged(doc, path) {
  const ids = (path.match(/\[([^\]]+)\]/g) || []).map((x) => x.slice(1, -1));
  for (let i = ids.length - 1; i >= 0; i--) { const o = findById(doc, ids[i]); if (o && o.by) return String(o.by); }
  return '';
}

/* Keep a record of changes both sides made, so nothing is dropped without a trace. */
function noteConflicts(key, path, conflicts, review, remoteJson, report) {
  if (!conflicts.length) return;
  report.conflicts += conflicts.length;
  if (review) report.review += conflicts.length;
  const at = new Date().toISOString();
  S.conflicts = (S.conflicts || []).concat(conflicts.map((cf) => Object.assign({ id: 'cf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key, file: path, at, review, who: whoChanged(remoteJson, cf.path) }, cf))).slice(-50);
  save('conflicts');
}

/* A clash card is about the phone's value at the time. Once that value has changed again (a newer
   change came in, or it was changed here), the card is out of date: acting on it could undo the newer
   change, so it goes. */
function dropStaleClashes() {
  const list = S.conflicts || [];
  const keep = list.filter((cf) => {
    if (!cf.review || cf.note || !S[cf.key] || !S[cf.key].local) return true;
    return same(getAtPath(S[cf.key].local, cf.path), cf.ours);
  });
  if (keep.length !== list.length) { S.conflicts = keep; save('conflicts'); }
}

/* One file: pull, merge, push if this phone has anything new and is allowed to. */
async function syncOne(key, report, meta, attempt = 0) {
  const c = target(key);
  if (!c) return;
  const path = FILES[key];
  const slot = S[key];
  const rid = meta && meta.id ? 'id:' + meta.id : repoId(c);
  // Older versions didn't record which repo a file came from; it was always the book repo.
  if (slot.src == null && slot.sha && bookConfigured()) slot.src = repoId(conn('book'));
  // Earlier 1.1 builds recorded owner/repo; switch to the id without starting over.
  if (slot.src && slot.src === repoId(c) && rid.startsWith('id:')) slot.src = rid;
  // A different repo than last time: nothing on the phone has been synced with it yet.
  const fresh = slot.src !== rid;
  if (fresh) { slot.base = null; slot.sha = null; slot.src = rid; }
  // View only, or the repo has gone public: read, but send nothing.
  const writable = !meta || (meta.push && meta.private !== false);
  const remote = await getFile(path, c);
  const who = whoAmI();
  const msg = (verb) => verb + ' ' + path + (who ? ' (' + who + ')' : '');
  if (!writable) {
    // Take GitHub's copy, and keep anything changed on this phone on top of it, unsent: it goes up if
    // sending becomes possible again. Where both changed the same thing, GitHub's version wins here, so
    // a later send can't quietly undo someone else's change.
    if (remote && remote.sha !== slot.sha) {
      report.pulled.push(key);
      const m = mergeDoc(slot.base, slot.local, remote.json, { prefer: 'remote', note: 'Couldn’t send this phone’s version, so GitHub’s was kept' });
      slot.local = m.doc; slot.base = clone(remote.json); slot.sha = remote.sha;
      noteConflicts(key, path, m.conflicts, false, remote.json, report);
    }
    if (remote) slot.syncedAt = new Date().toISOString();
    return;
  }
  if (!remote) {
    if (slot.local) {
      dropGone(slot.local);
      const sent = clone(slot.local);
      const r = await putFile(path, sent, null, msg('Add'), c);
      if (r.conflict) { if (attempt < 1) return syncOne(key, report, meta, attempt + 1); throw new SyncError(path + ' changed while syncing. Try again.', 409); }
      // GitHub now has exactly what was sent. Anything changed on the phone while it was sending stays, for next time.
      slot.base = sent; slot.sha = r.sha; slot.syncedAt = new Date().toISOString(); report.pushed.push(key);
      if (!same(slot.local, sent)) report.again = true;
    }
    return;
  }
  if (!slot.local) {
    slot.local = clone(remote.json); slot.base = clone(remote.json); slot.sha = remote.sha; slot.syncedAt = new Date().toISOString();
    report.pulled.push(key); return;
  }
  const localChanged = !same(slot.local, slot.base);
  if (remote.sha === slot.sha && !localChanged) { slot.syncedAt = new Date().toISOString(); return; }
  // Anything with a deletion marker stays deleted, even if it came back onto this phone another way.
  dropGone(slot.local);
  let next = slot.local, conflicts = [];
  if (remote.sha !== slot.sha) {
    // First sync with this repo (a new phone, a restored backup, a newly connected repo): GitHub's
    // copy is the shared truth, so it wins any differences. Things only this phone has are kept.
    const m = mergeDoc(slot.base, slot.local, remote.json, fresh ? { prefer: 'remote' } : undefined);
    next = m.doc; conflicts = m.conflicts;
    if (!same(remote.json, slot.base)) report.pulled.push(key);
  }
  if (same(next, remote.json)) {
    slot.local = clone(remote.json); slot.base = clone(remote.json); slot.sha = remote.sha;
  } else {
    // Snapshots: exactly what GitHub will hold, and the phone's copy it was made from. Saving a count
    // or editing an item while this is on its way changes the phone's copy, and that must not be lost.
    const sent = clone(next), had = clone(slot.local);
    const r = await putFile(path, sent, remote.sha, msg('Update'), c);
    if (r.conflict) { if (attempt < 1) return syncOne(key, report, meta, attempt + 1); throw new SyncError(path + ' changed while syncing. Try again.', 409); }
    slot.base = clone(sent); slot.sha = r.sha; report.pushed.push(key);
    if (same(slot.local, had)) slot.local = clone(sent);
    else {
      // Changed here while sending: put those changes on top of what was sent; they go next time.
      const m = mergeDoc(had, slot.local, sent);
      slot.local = m.doc; conflicts = conflicts.concat(m.conflicts);
      report.again = true;
    }
  }
  slot.syncedAt = new Date().toISOString();
  noteConflicts(key, path, conflicts, INV_KEYS.includes(key) && !fresh, remote.json, report);
}

let running = null;
/* Sync every file that has a connection. One file failing doesn't stop the others. */
export function syncAll() {
  if (running) return running;
  running = (async () => {
    const report = { pulled: [], pushed: [], conflicts: 0, review: 0, errors: [], readOnly: [] };
    const addErr = (e) => { if (!report.errors.some((x) => x.message === e.message)) report.errors.push(e); };
    try {
      if (invConfigured()) S.settings.invShared = true;
      // Check each connection once: reachable? writable? Then sync its files.
      const metas = {};
      for (const w of CONNS) {
        if (!Object.keys(FILES).some((k) => connOf(k) === w)) continue;
        try {
          const m = await repoMeta(conn(w));
          metas[w] = m;
          S.settings.perm = Object.assign({}, S.settings.perm, { [w]: { push: m.push, id: m.id, at: new Date().toISOString() } });
          if (!m.push) report.readOnly.push(w);
          // These repos must stay private. If one has been made public, keep reading it but send nothing.
          if (m.private === false) addErr(new SyncError(repoLabel(conn(w)) + ' is public on GitHub, so nothing is being sent to it. Make it private again in its settings; until then, changes stay on this phone.', 0));
        } catch (e) {
          addErr(e);
          if (e.status === 404 || e.status === 401) S.settings.perm = Object.assign({}, S.settings.perm, { [w]: { push: false, lost: true, at: new Date().toISOString() } });
        }
      }
      for (const key of Object.keys(FILES)) {
        const w = connOf(key);
        if (!w || !metas[w]) continue;
        try { await syncOne(key, report, metas[w]); }
        catch (e) { addErr(e); }
        save(key);
      }
      if (migrateHistory()) {
        for (const key of ['state', 'counts']) { const w = connOf(key); if (w && metas[w]) { try { await syncOne(key, report, metas[w]); } catch (e) { addErr(e); } } }
      }
      dropStaleClashes();
      if (!report.errors.length) { S.settings.lastSync = new Date().toISOString(); S.settings.lastSyncError = ''; }
      else S.settings.lastSyncError = report.errors[0].message || 'Sync didn’t finish.';
      save('settings');
      await flush();
      // Something was saved or edited while this sync was sending: send it shortly, without waiting for a tap.
      if (report.again) autoSync('save', 1500);
      return report;
    } finally { running = null; }
  })();
  return running;
}
export const isSyncing = () => !!running;

/* Quiet sync: when the app opens, comes back to the front, regains signal, or after a save.
   Skips when offline or not connected. Never shows a toast; problems show on the status chip. */
let lastAuto = 0, autoTimer = null;
const autoListeners = [];
export const onAutoSync = (fn) => { autoListeners.push(fn); };
export function autoSync(reason, delay = 0) {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    if (!configured() || navigator.onLine === false) return;
    if (running) { if (reason === 'save') running.finally(() => autoSync('save', 1000)); return; }
    const nowT = Date.now();
    if (reason === 'open' && nowT - lastAuto < 2 * 60 * 1000 && !SYNCED.some(dirty)) return;
    if (reason === 'online' && !SYNCED.some(dirty)) return;
    lastAuto = nowT;
    let report = null;
    try { report = await syncAll(); } catch (e) { console.warn(e); }
    autoListeners.forEach((fn) => { try { fn(report, reason); } catch (e) { console.error(e); } });
  }, delay);
}

/* Check a key before saving it: is the repo reachable, private, and writable? */
export async function testConnection(cfg) {
  const res = await gh('GET', '', null, cfg);
  if (res.status === 404) throw new SyncError('Repo not found. Check the owner and repo name, and that the key includes that repo. For an organization’s repo, the key’s owner has to be the organization.', 404);
  if (!res.ok) throw new SyncError('GitHub error ' + res.status + '.', res.status);
  const j = await res.json();
  return { private: !!j.private, push: !!(j.permissions && j.permissions.push), fullName: j.full_name, defaultBranch: j.default_branch || 'main' };
}
