// Phone storage built from the sample data in tests/fixtures (all made up), for tests that
// need a phone that's already set up without running a sync first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const fixture = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
export const fixtureText = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');

const slot = (doc, src) => ({ base: JSON.parse(JSON.stringify(doc)), local: JSON.parse(JSON.stringify(doc)), sha: 'fixture', src, syncedAt: '2026-01-15T12:00:00Z' });
const iso = (daysAgo, h = 12) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const day = (s) => { const d = new Date(s); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* Saved counts: one received, one placed, one not placed yet, so every order state shows. */
function history() {
  const e = (id, daysAgo, by, status) => {
    const savedAt = iso(daysAgo);
    const h = { id, date: day(savedAt), savedAt, by, counts: { 'p-cups': 1, 'p-coffee': 0 }, orders: {}, orderCount: 2, text: 'Sample order\n• Paper cups: 1 case', updated: day(savedAt) };
    if (status) h.order = Object.assign({ status }, status !== 'saved' ? { placedAt: iso(daysAgo, 14), placedBy: 'BB' } : {}, status === 'received' ? { receivedAt: iso(daysAgo - 1, 9), receivedBy: 'AA' } : {});
    return h;
  };
  return { schema: 1, updated: day(iso(1)), history: [e('h1', 9, 'AA', 'received'), e('h2', 4, 'BB', 'placed'), e('h3', 1, 'AA', 'saved')] };
}

/* The full app: book, inventory, follow-ups, saved counts, a count in progress, one clash, and the
   phone-only parts (picked jobs, ticks, floor board, a trainee, shift notes), so every button draws. */
export function fullPhone({ clash = true } = {}) {
  const state = fixture('state.json'); delete state.invHistory;
  state.wins = [{ id: 'w1', text: 'Patio set up early', date: day(iso(2)), updated: day(iso(2)) }];
  const today = day(new Date().toISOString());
  return {
    day: { date: today, ticks: ['t1'], mine: ['a1', 'a4'] },
    floor: { date: today, people: [
      { id: 'fp1', name: 'Sam', station: 'Dining room', in: '07:00', out: '15:00', breaks: [{ type: 'rest', start: '09:30', end: '09:40' }] },
      { id: 'fp2', name: 'Riley', station: 'Patio', in: '11:00', out: '19:00', breaks: [] }] },
    trainees: [{ id: 'tr1', name: 'Jordan', start: day(iso(3)), signoffs: { 'k-calls': day(iso(2)) } }],
    shift: { key: today + '|AM', notes: [{ id: 'n1', t: '10:15', tag: '86', text: 'Out of oat milk' }], f: {}, sentAt: null },
    book: slot(fixture('book.json'), 'owner/book'),
    state: slot(state, 'owner/book'),
    inv: slot(fixture('inventory.json'), 'team/inventory'),
    counts: slot(history(), 'team/inventory'),
    plans: slot(fixture('floorplans.json'), 'team/training'),
    count: { id: 'c1', started: iso(0, 9), counts: { 'p-cups': 2, 'p-lids': 0, 'p-napkins': 0.5 }, orders: {} },
    conflicts: clash ? [{ id: 'cf1', key: 'inv', file: 'inventory.json', at: iso(0, 10), review: true, who: 'BB', path: '.lines[ln-lids].par', kept: 'phone', ours: 3, theirs: 5 }] : [],
    settings: { owner: 'owner', repo: 'book', branch: 'main', token: 'tok', invOwner: 'team', invRepo: 'inventory', invBranch: 'main', invToken: 'tok2', invShared: true, trainOwner: 'team', trainRepo: 'training', trainBranch: 'main', trainToken: 'tok3', name: 'Alex', initials: 'AA', role: 'floor', theme: 'auto', quick: true, setupDone: true, created: '2026-01-01T00:00:00Z', lastSync: iso(0, 11), perm: { book: { push: true }, inv: { push: true }, train: { push: true } } }
  };
}

/* Count-only phone (someone who only counts and orders). */
export function invPhone() {
  const f = fullPhone({ clash: false });
  return { inv: f.inv, counts: f.counts, count: f.count, settings: { invOwner: 'team', invRepo: 'inventory', invBranch: 'main', invToken: 'tok2', invShared: true, initials: 'BB', setupDone: true, created: '2026-01-01T00:00:00Z', lastSync: iso(0, 11), perm: { inv: { push: true } } } };
}
