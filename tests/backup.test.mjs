// Backup files: what a phone's "Save backup" writes must leave out anything daily or that can name
// people (shift notes with their resident section, the floor board and break times, remembered staff
// names, message drafts, clash notes), the staffing plan (it has its own phone-only file) and never the keys. Restoring an older backup that still has
// those parts must not bring them back.
import path from 'node:path';
import { makePhone, outDir, checker } from './lib/phone.mjs';
import { fullPhone } from './lib/fixtures.mjs';

const T = checker();
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }), body: { appendChild() {}, classList: { add() {}, remove() {} } }, contains: () => false, addEventListener() {} };
globalThis.addEventListener = () => {};
globalThis.location = { hash: '' };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test', platform: 'Linux', maxTouchPoints: 0, onLine: false, storage: null } });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

const seed = fullPhone();
seed.msgs = { incident: { what: 'MARKER-DRAFT spill by table 4' } };
seed.settings.floorNames = ['Riley', 'Sam'];
seed.shift.notes.push({ id: 'n2', t: '11:00', tag: 'resident', text: 'MARKER-RESIDENT room 12 asked for more water' });
seed.priv = { staffPlan: { note: 'MARKER-STAFFPLAN', days: [] }, cards: [{ id: 'pc1', title: 'MARKER-PRIVCARD', body: '' }] };

const dir = makePhone('Bk', outDir());
globalThis.__mem_Bk = seed;
const st = await import(path.join(dir, 'js/state.js'));
const more = await import(path.join(dir, 'js/views/more.js'));
await st.load();

console.log('\n1. What a backup holds');
T.check(typeof more.backupJSON === 'function', 'backup writer is reachable');
const text = typeof more.backupJSON === 'function' ? more.backupJSON() : '';
const b = text ? JSON.parse(text) : { data: {} };
for (const k of ['shift', 'floor', 'msgs', 'conflicts', 'priv']) T.check(!!text && !(k in b.data), 'leaves out ' + k);
T.check(!!text && !/MARKER-STAFFPLAN|MARKER-PRIVCARD/.test(text), 'no staffing plan or phone-only card text');
T.check(!!text && !/MARKER-RESIDENT|Out of oat milk/.test(text), 'no shift note text anywhere, resident notes included');
T.check(!!text && !/MARKER-DRAFT/.test(text), 'no message draft text');
T.check(!!text && !/\bRiley\b|\bSam\b/.test(text), 'no floor board or remembered staff names');
T.check(b.data.settings && !('token' in b.data.settings) && !('invToken' in b.data.settings) && !('trainToken' in b.data.settings) && !('floorNames' in b.data.settings), 'settings without keys (book, inventory, training) or staff names');
for (const k of ['book', 'inv', 'state', 'counts', 'plans', 'count', 'trainees']) T.check(k in b.data, 'keeps ' + k);

console.log('\n2. Restoring an older backup that still has the left-out parts');
T.check(typeof more.restoreBackupData === 'function', 'restore is reachable');
if (typeof more.restoreBackupData === 'function') {
  const old = JSON.parse(JSON.stringify(seed));
  old.shift.notes = [{ id: 'old', t: '08:00', tag: 'resident', text: 'MARKER-OLD resident note' }];
  old.floor.people = [{ id: 'x', name: 'Oldname', breaks: [] }];
  old.msgs = { incident: { what: 'MARKER-OLDDRAFT' } };
  old.settings.floorNames = ['Oldname'];
  old.priv = { staffPlan: { note: 'MARKER-OLDPLAN', days: [] }, cards: [] };
  st.S.shift.notes = [{ id: 'now', t: '12:00', tag: 'next', text: 'Today' }];
  st.S.settings.floorNames = ['Riley'];
  old.book.local.title = 'Restored book';
  more.restoreBackupData(old);
  T.check(st.S.book.local.title === 'Restored book', 'the book comes back');
  T.check(st.S.shift.notes.length === 1 && st.S.shift.notes[0].text === 'Today', 'today\'s shift notes stay; the old ones don\'t come back');
  T.check(!st.S.floor.people.some((p) => p.name === 'Oldname'), 'the old floor board doesn\'t come back');
  T.check(!JSON.stringify(st.S.msgs).includes('MARKER-OLDDRAFT'), 'old message drafts don\'t come back');
  T.check(JSON.stringify(st.S.settings.floorNames) === '["Riley"]', 'old remembered names don\'t come back');
  T.check(!JSON.stringify(st.S.priv).includes('MARKER-OLDPLAN') && JSON.stringify(st.S.priv).includes('MARKER-STAFFPLAN'), 'an old backup\'s staffing plan doesn\'t replace the phone\'s own');
}
T.done();
