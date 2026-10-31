// The Book: checklists, how-to cards, the assignment sheet and the shape of the day. Editable in place.

import { app } from '../app.js';
import { S, B, save, tasksOf, blocks, isTicked, card, allCards, catName, roleName, hasBook, revOf } from '../state.js';
import { esc, fmt12, toMin, joinAnd, withBlanks, hasBlank, copyText, dayLabel, fmtRev, $ } from '../util.js';
import { ICON, chip, seg, empty, openSheet, closeSheet, toast, armed } from '../ui.js';
import { taskRow, stdRow, countText, howBtn } from './now.js';
import * as maps from './maps.js';

let q = '', cat = 'all', sheetShift = 'am';

const SUBS = [['lists', 'Checklists'], ['cards', 'Cards'], ['sheet', 'Sheet'], ['day', 'Day'], ['maps', 'Maps']];

function topBar(sub) {
  return '<div class="view-top">' + seg('go-sub', SUBS, sub) +
    '<div class="view-acts"><button class="pill-b' + (app.ui.editing ? ' on' : '') + '" data-act="edit-toggle" aria-pressed="' + app.ui.editing + '">' + ICON.pencil + (app.ui.editing ? ' Done' : ' Edit') + '</button>' +
    '<button class="pill-b" data-act="print-menu">' + ICON.print + ' Print</button></div></div>';
}
export function whenText(l) {
  if (l.byBlock) return 'Through the day, by time.';
  const names = blocks().filter((b) => (l.blocks || []).indexOf(b.id) >= 0).map((b) => b.name + ' (' + fmt12(b.s) + ')');
  return names.length ? joinAnd(names) : 'Not tied to a time of day.';
}

/* ---------- checklists ---------- */
function listsView() {
  const ls = B().lists;
  let h = '';
  B().roles.forEach((r) => {
    const mine = ls.filter((l) => l.role === r.id);
    if (!mine.length) return;
    h += '<h2 class="sec-h">' + esc(r.name) + '</h2><ul class="card-list">' + mine.map((l) => {
      const its = tasksOf(l.id), done = its.filter((t) => isTicked(t.id)).length;
      return '<li><button class="card-row" data-act="go" data-id="#book/list/' + esc(l.id) + '"><span class="cat">' + esc(l.byBlock ? 'By time' : whenText(l)) + (l.draft ? ' · Draft' : '') + '</span><span class="c-title">' + esc(l.name) + '</span>' +
        '<span class="c-why">' + (l.standards ? its.length + ' standards' : its.length + ' items' + (done ? ' · ' + done + ' done today' : '')) + '</span></button></li>';
    }).join('') + '</ul>';
  });
  const orphan = ls.filter((l) => !B().roles.some((r) => r.id === l.role));
  if (orphan.length) h += '<h2 class="sec-h">Other</h2><ul class="card-list">' + orphan.map((l) => '<li><button class="card-row" data-act="go" data-id="#book/list/' + esc(l.id) + '"><span class="c-title">' + esc(l.name) + '</span></button></li>').join('') + '</ul>';
  if (!ls.length) h += empty('No checklists yet.');
  if (app.ui.editing) h += '<div class="edit-row"><button class="btn small" data-act="list-new">' + ICON.plus + ' New checklist</button></div>';
  return h;
}
function listView(id) {
  const l = B().lists.find((x) => x.id === id);
  if (!l) return empty('That checklist isn’t in the book anymore. <button class="link inline" data-act="go" data-id="#book/lists">All checklists</button>');
  const its = tasksOf(l.id), done = its.filter((t) => isTicked(t.id)).length;
  let h = '<button class="back" data-act="go" data-id="#book/lists">' + ICON.chevL + ' Checklists</button>';
  h += '<h2 class="list-h">' + esc(l.name) + (l.draft ? ' <span class="badge">Draft</span>' : '') + '</h2><p class="when-line">' + esc(whenText(l)) + ' · ' + esc(roleName(l.role)) + '</p>';
  if (l.note) h += '<p class="note">' + withBlanks(l.note) + '</p>';
  if (!l.standards) {
    h += '<div class="sum"><div class="sum-n" id="sum-n">' + done + '<span>/' + its.length + '</span></div><div class="sum-t">Done today<span>Ticks reset at midnight. They stay on this phone.</span></div><div class="sum-bar"><span id="sum-bar" style="width:' + (its.length ? done / its.length * 100 : 0).toFixed(1) + '%"></span></div></div>';
  }
  h += '<div class="row-actions">' + (l.standards ? '' : '<button class="btn small ghost" data-act="list-clear" data-id="' + esc(l.id) + '">Clear ticks</button><button class="btn small ghost" data-act="list-copy" data-id="' + esc(l.id) + '">' + ICON.copy + ' Status</button>') +
    '<button class="btn small ghost" data-act="print" data-kind="list" data-id="' + esc(l.id) + '">' + ICON.print + ' Print</button>' +
    (app.ui.editing ? '<button class="btn small" data-act="list-edit" data-id="' + esc(l.id) + '">' + ICON.pencil + ' List</button>' : '') + '</div>';
  const row = l.standards ? stdRow : taskRow;
  if (l.byBlock) {
    const known = new Set();
    blocks().forEach((b) => {
      known.add(b.id);
      const g = its.filter((t) => t.block === b.id);
      if (!g.length && !app.ui.editing) return;
      h += '<div class="row-h"><h3 class="sec-h">' + esc(b.name) + ' <span class="mono small">' + fmt12(b.s) + '</span></h3><span class="mono cnt" data-cnt="' + esc(l.id) + '">' + (l.standards ? '' : countText(g)) + '</span></div>';
      h += g.length ? '<ul class="tasks">' + g.map(row).join('') + '</ul>' : '';
      if (app.ui.editing) h += '<div class="edit-row"><button class="btn small" data-act="task-add" data-list="' + esc(l.id) + '" data-block="' + esc(b.id) + '">' + ICON.plus + ' Add to ' + esc(b.name) + '</button></div>';
    });
    const other = its.filter((t) => !known.has(t.block));
    if (other.length) h += '<div class="row-h"><h3 class="sec-h">Any time</h3><span class="mono cnt" data-cnt="' + esc(l.id) + '">' + countText(other) + '</span></div><ul class="tasks">' + other.map(row).join('') + '</ul>';
  } else {
    h += its.length ? '<div class="row-h sr"><span data-cnt="' + esc(l.id) + '"></span></div><ul class="tasks">' + its.map(row).join('') + '</ul>' : empty('No items yet.');
    if (app.ui.editing) h += '<div class="edit-row"><button class="btn small" data-act="task-add" data-list="' + esc(l.id) + '">' + ICON.plus + ' Add item</button></div>';
  }
  return h;
}
function listStatusText(l) {
  const its = tasksOf(l.id), left = its.filter((t) => !isTicked(t.id));
  const out = [l.name + ' · ' + dayLabel() + ' · ' + (its.length - left.length) + '/' + its.length];
  if (left.length) { out.push('', 'Not done:'); left.forEach((t) => out.push('• ' + t.text)); } else out.push('', 'All done ✓');
  const n = String(S.settings.name || '').trim(); if (n) out.push('', '— ' + n);
  return out.join('\n');
}

/* ---------- cards ---------- */
function cardsView() {
  let h = '<div class="search"><label class="sr" for="card-q">Search cards</label><input id="card-q" type="search" data-search="cards" placeholder="Search cards" value="' + esc(q) + '" autocomplete="off"></div>';
  h += '<div class="chips">' + chip('card-cat', 'all', 'All', cat === 'all') + B().cats.map((c) => chip('card-cat', c.id, c.name, cat === c.id)).join('') + chip('card-cat', 'draft', 'Drafts', cat === 'draft') + '</div>';
  h += '<ul class="card-list" id="card-list">' + cardRows() + '</ul>';
  if (app.ui.editing) h += '<div class="edit-row"><button class="btn small" data-act="card-new" data-cat="' + esc(cat !== 'all' && cat !== 'draft' ? cat : '') + '">' + ICON.plus + ' New card</button></div>';
  return h;
}
function cardRows() {
  const needle = q.trim().toLowerCase();
  const cs = allCards().filter((c) => (cat === 'all' || (cat === 'draft' ? c.draft : c.cat === cat)) &&
    (!needle || [c.title, c.why].concat(c.steps || [], c.watch || []).join(' ').toLowerCase().indexOf(needle) >= 0));
  if (!cs.length) return '<li>' + empty('No cards match.', true) + '</li>';
  return cs.map((c) => '<li><button class="card-row" data-act="open-card" data-id="' + esc(c.id) + '"><span class="cat">' + esc(catName(c.cat)) + (c.draft ? ' · Draft' : '') + (c.private ? ' · Phone only' : '') + ([c.why].concat(c.steps || []).some(hasBlank) ? ' · Has blanks' : '') + '</span><span class="c-title">' + esc(c.title) + '</span>' + (c.why ? '<span class="c-why">' + esc(c.why) + '</span>' : '') + '</button></li>').join('');
}

/* ---------- assignment sheet ---------- */
function sheetView() {
  const items = B().assignments.filter((a) => a.shift === sheetShift);
  let h = '<p class="muted">The jobs on the daily assignment sheet. Pick yours on the Now screen, or print a blank sheet for the lead to fill in.</p>';
  h += seg('sheet-shift', [['am', 'AM'], ['pm', 'PM'], ['all', 'Everyone']], sheetShift);
  h += items.length ? '<ul class="tasks">' + items.map((a) => '<li class="task"><span class="stdrow"><span class="std-mark"></span><span class="t-text">' + withBlanks(a.text) + (a.time ? '<span class="t-meta"><span class="when mono">' + (a.by ? 'by ' : '') + fmt12(toMin(a.time)) + '</span></span>' : '') + '</span></span>' + howBtn(a.card) + (app.ui.editing ? '<button class="icon-b" data-act="asg-edit" data-id="' + esc(a.id) + '" aria-label="Edit">' + ICON.pencil + '</button>' : '') + '</li>').join('') + '</ul>' : empty('No jobs here yet.', true);
  h += '<div class="row-actions">' + (app.ui.editing ? '<button class="btn small" data-act="asg-new" data-shift="' + sheetShift + '">' + ICON.plus + ' Add job</button>' : '') + '<button class="btn small ghost" data-act="pick">Pick my jobs</button><button class="btn small ghost" data-act="print" data-kind="sheet">' + ICON.print + ' Blank sheet</button></div>';
  return h;
}

/* ---------- the day ---------- */
function dayView() {
  const bl = blocks();
  let h = '<p class="muted">The shape of the day. The Now screen follows it.</p>';
  h += bl.length ? '<ol class="day-list">' + bl.map((b) => '<li><span class="mono day-t">' + fmt12(b.s) + '</span><div><b>' + esc(b.name) + '</b>' + (b.focus ? '<p>' + esc(b.focus) + '</p>' : '') + '</div></li>').join('') + '</ol>' : empty('No time blocks yet.');
  h += '<p class="hint">PM shift starts at ' + fmt12(toMin((B().day || {}).pmStart) || 780) + '. Day ends at ' + fmt12(toMin((B().day || {}).end) || 1260) + '.</p>';
  if (app.ui.editing) h += '<div class="edit-row"><button class="btn small" data-act="blocks-edit">' + ICON.pencil + ' Edit the day</button></div>';
  return h;
}

export function render(route) {
  if (!hasBook()) return empty('No book loaded yet. <button class="link inline" data-act="tab" data-id="more">Set up</button>');
  const sub = route.sub || 'lists';
  if (sub === 'list') return listView(route.id);
  if (sub === 'map') return maps.roomView(route.id);
  let h = topBar(sub);
  if (sub === 'maps') return h + maps.mapsView();
  if (sub === 'cards') h += cardsView();
  else if (sub === 'sheet') h += sheetView();
  else if (sub === 'day') h += dayView();
  else h += listsView();
  h += '<p class="foot-note mono">' + esc(B().title || 'Book') + ' · rev ' + esc(fmtRev(revOf(B().cards.concat(B().tasks, B().lists, B().assignments)))) + '</p>';
  return h;
}

function printMenu() {
  const lists = B().lists.filter((l) => !l.draft && tasksOf(l.id).length);
  openSheet({
    eyebrow: 'Print', title: 'What to print',
    body: '<ul class="tmpl-list">' +
      '<li><button class="tmpl" data-act="print" data-kind="book"><span class="tmpl-t">Full book</span><span class="tmpl-b">Cover, the day, every checklist, a blank assignment sheet and all finished cards. Drafts and phone-only cards stay out.</span></button></li>' +
      '<li><button class="tmpl" data-act="print" data-kind="cards"><span class="tmpl-t">All cards</span><span class="tmpl-b">Two columns, grouped by category.</span></button></li>' +
      '<li><button class="tmpl" data-act="print" data-kind="sheet"><span class="tmpl-t">Blank assignment sheet</span><span class="tmpl-b">AM, PM and all-day jobs with a line for a name.</span></button></li>' +
      '<li><button class="tmpl" data-act="print" data-kind="count"><span class="tmpl-t">Blank count sheet</span><span class="tmpl-b">Every active inventory line with its minimum, for counting on paper.</span></button></li>' +
      (maps.findV(maps.liveId()) ? '<li><button class="tmpl" data-act="print" data-kind="maps" data-id="' + esc(maps.liveId()) + '"><span class="tmpl-t">Floor plans</span><span class="tmpl-b">Every room in the layout in use, one per page, with the date it went into use.</span></button></li>' : '') +
      '</ul><h3 class="sub-h">One checklist</h3><div class="chips">' + lists.map((l) => '<button class="chip" data-act="print" data-kind="list" data-id="' + esc(l.id) + '">' + esc(l.short || l.name) + '</button>').join('') + '</div>'
  });
}

export const acts = {
  'go-sub': (el) => app.go('#book/' + el.dataset.id),
  'edit-toggle': () => { app.ui.editing = !app.ui.editing; app.renderView(); toast(app.ui.editing ? 'Editing. Tap the pencil on anything to change it.' : 'Done editing.'); },
  'card-cat': (el) => { cat = el.dataset.id; app.renderView(); },
  'sheet-shift': (el) => { sheetShift = el.dataset.id; app.renderView(); },
  'print-menu': () => printMenu(),
  'list-clear': (el) => { if (!armed(el, 'Clear all ticks?')) return; const ids = tasksOf(el.dataset.id).map((t) => t.id); S.day.ticks = S.day.ticks.filter((x) => ids.indexOf(x) < 0); save('day'); app.renderView(); toast('Ticks cleared.'); },
  'list-copy': async (el) => { const l = B().lists.find((x) => x.id === el.dataset.id); if (l && await copyText(listStatusText(l))) toast('Status copied.'); }
};
export function onInput(el) {
  if (el.dataset.search !== 'cards') return false;
  q = el.value; const ul = $('#card-list'); if (ul) ul.innerHTML = cardRows(); return true;
}
export function refreshListSummary() {
  const n = $('#sum-n'); if (!n || app.route.sub !== 'list') return;
  const its = tasksOf(app.route.id), done = its.filter((t) => isTicked(t.id)).length;
  n.innerHTML = done + '<span>/' + its.length + '</span>';
  const bar = $('#sum-bar'); if (bar) bar.style.width = (its.length ? done / its.length * 100 : 0).toFixed(1) + '%';
}
