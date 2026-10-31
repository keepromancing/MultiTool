// Printouts. Every page carries a revision stamp, and each print can be logged with where it's posted,
// so the app can tell you when a printed copy has gone out of date.

import { app } from './app.js';
import { S, B, I, L, edit, blocks, tasksOf, card, catName, revOf, roleName } from './state.js';
import { esc, fmt12, toMin, todayKey, fmtRev, fmtShort, joinAnd, uid, $, fmtNum } from './util.js';
import { openSheet, closeSheet, toast, field, input, ICON } from './ui.js';
import * as maps from './views/maps.js';

let stampText = '';
const stamp = () => '<p class="pv-rev">' + esc(stampText) + '</p>';
const blankPrint = (s) => esc(s).replace(/\[([^\]]{1,120})\]/g, '<span class="pv-blank">$1</span>');
const staffLists = (drafts) => B().lists.filter((l) => (drafts || !l.draft) && tasksOf(l.id).length);
const staffCards = (drafts) => B().cards.filter((c) => drafts || !c.draft);

/* What a print target contains, for its label and its revision date. */
export function target(t) {
  const b = B();
  switch (t.kind) {
    case 'book': {
      const lists = staffLists(t.drafts), cards = staffCards(t.drafts);
      const items = [].concat(lists, lists.flatMap((l) => tasksOf(l.id)), cards, b.assignments);
      return { label: 'Full book' + (t.drafts ? ' with drafts' : ''), rev: revOf(items.concat([{ updated: dayRev() }])) };
    }
    case 'list': { const l = b.lists.find((x) => x.id === t.id); if (!l) return null; return { label: l.name, rev: revOf([l].concat(tasksOf(l.id))) }; }
    case 'card': { const c = card(t.id); if (!c) return null; return { label: 'Card: ' + c.title, rev: revOf([c]) }; }
    case 'cards': { const cards = staffCards(false); return { label: 'All cards', rev: revOf(cards) }; }
    case 'sheet': return { label: 'Assignment sheet (blank)', rev: revOf(b.assignments) };
    case 'count': return { label: 'Count sheet (blank)', rev: I().updated || todayKey() };
    case 'maps': return maps.printTarget(t.id);
    default: return null;
  }
}
const dayRev = () => (B().day && B().day.updated) || '';

export function isStale(rec) {
  const t = target({ kind: rec.what, id: rec.ref, drafts: rec.drafts });
  if (!t) return { gone: true };
  return { stale: t.rev > (rec.rev || ''), rev: t.rev };
}

/* ---------- print dialog ---------- */
export function printWhat(t) {
  const info = target(t);
  if (!info) { toast('Nothing to print.'); return; }
  const recent = L().printed.filter((p) => p.where).map((p) => p.where);
  const places = Array.from(new Set(recent)).slice(-6);
  openSheet({
    eyebrow: 'Print', title: info.label,
    body: '<p class="muted" style="margin-top:0">Rev ' + esc(fmtRev(info.rev)) + '. Every page is stamped with it, so you can tell an old copy from a new one.</p>' +
      (t.kind === 'book' ? '<label class="checkline"><input type="checkbox" id="pr-drafts"' + (t.drafts ? ' checked' : '') + '><span>Include drafts, marked DRAFT (for a review copy, not the floor)</span></label>' : '') +
      '<div class="form" style="margin-top:12px">' + field('pr-where', 'Where will it go?', input('pr-where', '', 'list="pr-places" placeholder="Wall, binder, manager…" autocomplete="off"'), 'Optional. Logged in Lead → Printed so you know when it’s out of date.') + '</div>' +
      '<datalist id="pr-places">' + places.map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist>' +
      '<p class="hint">On Android, choose <b>Save as PDF</b> in the print screen to make a PDF you can share.</p>',
    foot: '<button class="btn primary" data-act="print-go" data-kind="' + esc(t.kind) + '" data-id="' + esc(t.id || '') + '">' + ICON.print + ' Print</button>'
  });
}

function go(t) {
  const where = ($('#pr-where') && $('#pr-where').value.trim()) || '';
  if ($('#pr-drafts')) t.drafts = $('#pr-drafts').checked;
  const info = target(t);
  closeSheet();
  if (where) {
    edit('state', (s) => {
      s.printed = s.printed || [];
      s.printed.push({ id: uid('pr'), what: t.kind, ref: t.id || '', drafts: !!t.drafts, label: info.label, where, date: todayKey(), rev: info.rev, updated: todayKey() });
    });
  }
  const root = $('#print-root');
  stampText = (B().title || 'Floor Book') + ' · ' + info.label + ' · Rev ' + fmtRev(info.rev) + ' · Printed ' + fmtRev(todayKey());
  // The revision stamp goes in the page margin (Chrome supports page margin boxes) and under each section heading.
  let st = document.getElementById('print-stamp');
  if (!st) { st = document.createElement('style'); st.id = 'print-stamp'; document.head.appendChild(st); }
  st.textContent = '@page{@bottom-left{content:"' + stampText.replace(/["\\]/g, '') + '";font:8pt monospace;color:#444}}';
  root.innerHTML = build(t, info);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); app.render(); };
  window.addEventListener('afterprint', done);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { window.print(); } catch (e) { toast('This browser can’t print from here.'); done(); }
    if (where) toast('Logged: ' + info.label + ' → ' + where);
  }));
}

/* ---------- builders ---------- */
function build(t, info) {
  switch (t.kind) {
    case 'book': return bookHTML(t.drafts, info);
    case 'list': { const l = B().lists.find((x) => x.id === t.id); return '<section class="pv-sec">' + listHTML(l, true) + '</section>'; }
    case 'card': return '<section class="pv-sec"><div class="pv-cards one">' + cardHTML(card(t.id)) + '</div>' + stamp() + '</section>';
    case 'cards': return cardsHTML(false);
    case 'sheet': return sheetHTML();
    case 'count': return countHTML();
    case 'maps': return maps.printHTML(t.id, stamp);
    default: return '';
  }
}
function whenText(l) {
  if (l.byBlock) return 'Through the day, by time.';
  const names = blocks().filter((b) => (l.blocks || []).indexOf(b.id) >= 0).map((b) => b.name + ' (' + fmt12(b.s) + ')');
  return names.length ? 'When: ' + joinAnd(names) + '.' : '';
}
function items(list, std) {
  return '<ul class="pv-checks">' + list.map((t) => '<li>' + (std ? '<span class="pv-dot"></span>' : '<span class="pv-box"></span>') + '<span>' + blankPrint(t.text) + '</span></li>').join('') + '</ul>';
}
function listHTML(l, solo) {
  if (!l) return '';
  let h = '<h2 class="pv-h">' + esc(l.name) + (l.draft ? ' <span class="pv-draft">Draft</span>' : '') + '</h2>' + stamp();
  const w = whenText(l); if (w) h += '<p class="pv-when">' + esc(w) + (l.role ? ' For: ' + esc(roleName(l.role)) + '.' : '') + '</p>';
  if (l.note) h += '<p class="pv-when">' + esc(l.note) + '</p>';
  if (l.byBlock) {
    blocks().forEach((b) => { const its = tasksOf(l.id).filter((t) => t.block === b.id); if (its.length) h += '<h3 class="pv-h3">' + esc(b.name) + '<span class="mono">' + fmt12(b.s) + '</span></h3>' + items(its, l.standards); });
    const known = new Set(blocks().map((b) => b.id)); const other = tasksOf(l.id).filter((t) => !known.has(t.block));
    if (other.length) h += '<h3 class="pv-h3">Any time</h3>' + items(other, l.standards);
  } else h += items(tasksOf(l.id), l.standards);
  if (!l.standards) h += '<p class="pv-sign">Done by ____________________ &nbsp; Date __________ &nbsp; Checked by ____________</p>';
  return h;
}
function cardHTML(c) {
  if (!c) return '';
  return '<article class="pv-card"><div class="pv-cat">' + esc(catName(c.cat)) + (c.draft ? ' · DRAFT' : '') + '</div><h3 class="pv-ct">' + esc(c.title) + '</h3>' +
    (c.why ? '<p class="pv-why">' + blankPrint(c.why) + '</p>' : '') +
    ((c.steps || []).length ? '<' + (c.numbered ? 'ol' : 'ul') + ' class="pv-steps">' + c.steps.map((s) => '<li>' + blankPrint(s) + '</li>').join('') + '</' + (c.numbered ? 'ol' : 'ul') + '>' : '') +
    ((c.watch || []).length ? '<div class="pv-watch"><b>Watch for:</b> ' + c.watch.map(blankPrint).join(' ') + '</div>' : '') + '</article>';
}
function cardsHTML(drafts) {
  let h = '<section class="pv-sec pv-cards-sec"><h2 class="pv-h">How-to cards</h2>' + stamp();
  B().cats.forEach((cat) => {
    const cs = staffCards(drafts).filter((c) => c.cat === cat.id);
    if (cs.length) h += '<h3 class="pv-h3">' + esc(cat.name) + '</h3><div class="pv-cards">' + cs.map(cardHTML).join('') + '</div>';
  });
  return h + '</section>';
}
function dayHTML() {
  const bl = blocks(); if (!bl.length) return '';
  return '<section class="pv-sec pv-list"><h2 class="pv-h">The day</h2>' + stamp() + '<table class="pv-day"><tbody>' +
    bl.map((b) => '<tr><td class="mono">' + fmt12(b.s) + '</td><th>' + esc(b.name) + '</th><td>' + esc(b.focus || '') + '</td></tr>').join('') + '</tbody></table></section>';
}
function sheetHTML() {
  const a = B().assignments;
  const col = (sh, title) => {
    const rows = a.filter((x) => x.shift === sh);
    if (!rows.length) return '';
    return '<h3 class="pv-h3">' + title + '</h3><table class="pv-asg"><tbody>' + rows.map((x) => '<tr><td class="pv-asg-j">' + esc(x.text) + (x.time ? ' <span class="mono">' + (x.by ? 'by ' : '') + fmt12(toMin(x.time)) + '</span>' : '') + '</td><td class="pv-asg-n"></td></tr>').join('') + '</tbody></table>';
  };
  return '<section class="pv-sec pv-list"><h2 class="pv-h">Daily assignment sheet</h2>' + stamp() + '<p class="pv-when">Date ______________ &nbsp; Lead ______________</p>' +
    '<div class="pv-2col"><div>' + col('am', 'AM') + '</div><div>' + col('pm', 'PM') + '</div></div>' + col('all', 'Everyone, all day') + '</section>';
}
function countHTML() {
  const inv = I();
  const unitW = (u) => u === 'each' ? 'each' : u;
  let h = '<section class="pv-sec"><h2 class="pv-h">' + esc(inv.title || 'Inventory') + ' count</h2>' + stamp() + '<p class="pv-when">Date ______________ &nbsp; Counted by ______________</p>';
  inv.cats.forEach((cat) => {
    const ls = inv.lines.filter((l) => l.cat === cat.id && l.state === 'active');
    if (!ls.length) return;
    h += '<h3 class="pv-band">' + esc(cat.name) + '</h3><table class="pv-count"><thead><tr><th>Item</th><th>Min</th><th>On hand</th><th>Order</th></tr></thead><tbody>' +
      ls.map((l) => '<tr><td>' + esc(l.name) + (l.products.length > 1 ? ' <span class="pv-small">(' + l.products.length + ' products)</span>' : '') + '</td><td class="mono">' + (l.par != null ? esc(fmtNum(l.par) + ' ' + unitW(l.unit)) : '—') + '</td><td></td><td></td></tr>').join('') + '</tbody></table>';
  });
  return h + '</section>';
}
function bookHTML(drafts, info) {
  const b = B();
  const lists = staffLists(drafts);
  let h = '<section class="pv-sec pv-cover"><h1 class="pv-title">' + esc(b.title || 'Floor Book') + '</h1>' +
    (b.subtitle ? '<p class="pv-sub">' + esc(b.subtitle) + '</p>' : '') +
    '<p class="pv-sub">Rev ' + esc(fmtRev(info.rev)) + (drafts ? ' · Review copy with drafts' : '') + '</p>' +
    '<h2 class="pv-h3">Contents</h2><ul class="pv-plain"><li>The day</li>' + lists.map((l) => '<li>' + esc(l.name) + '</li>').join('') + '<li>Daily assignment sheet</li><li>How-to cards</li></ul>' +
    '<p class="pv-sub">If this copy’s rev is older than the newest one, recycle it.</p></section>';
  h += dayHTML();
  lists.forEach((l) => { h += '<section class="pv-sec pv-list">' + listHTML(l) + '</section>'; });
  h += sheetHTML();
  h += cardsHTML(drafts);
  return h;
}

export const acts = {
  'print': (el) => printWhat({ kind: el.dataset.kind, id: el.dataset.id || '', drafts: el.dataset.drafts === '1' }),
  'print-go': (el) => go({ kind: el.dataset.kind, id: el.dataset.id || '' }),
  'printed-del': (el) => { edit('state', (s) => { s.printed = s.printed.filter((p) => p.id !== el.dataset.id); }); app.render(); toast('Removed from the log.'); },
  'printed-reprint': (el) => { const p = L().printed.find((x) => x.id === el.dataset.id); if (p) printWhat({ kind: p.what, id: p.ref, drafts: p.drafts }); }
};
