// Floor plans. Each room has walls, tables, bar seats, counters and labels (entrance, kitchen, window).
// The whole floor is kept as versions: the one in use, drafts drawn ahead of a remodel, and old ones.
// A draft goes into use only when someone says so. Rooms and tables keep their ids in every version,
// so a table is the same table before and after it moves.
// Synced to the Training repo as floorplans.json. Everything read from it is shown as text, and every
// number is checked before it's drawn: the file can be edited by hand.

import { app } from '../app.js';
import { P, edit, whoAmI } from '../state.js';
import { esc, uid, todayKey, clone, fmtRev, $ } from '../util.js';
import { ICON, empty, openSheet, closeSheet, toast, armed, field, input, textarea, opts } from '../ui.js';
import { markGone } from '../merge.js';
import { canWrite, connOf } from '../sync.js';

/* ---------- reading the file safely ---------- */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d, lo, hi) => { const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const r2 = (n) => Math.round(n * 100) / 100;
const N = (n) => esc(String(r2(n)));
const snap = (n) => Math.round(n * 2) / 2;
const str = (v) => (v == null || typeof v === 'object' ? '' : String(v));
const isDay = (k) => /^\d{4}-\d\d-\d\d/.test(str(k));
const day = (k) => (isDay(k) ? fmtRev(str(k).slice(0, 10)) : '');
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export const KIND = { table: 'Table', seat: 'Bar seat', counter: 'Counter', label: 'Label' };
const DEF = { table: { w: 4, h: 3 }, seat: { w: 2, h: 2 }, counter: { w: 12, h: 2 }, label: { w: 7, h: 2 } };
export const STATUS = { live: 'In use', draft: 'Draft', old: 'Not in use' };

export const versions = () => (Array.isArray(P().versions) ? P().versions.filter((v) => isObj(v) && typeof v.id === 'string') : []);
export const findV = (id) => versions().find((v) => v.id === id) || null;
export const liveId = () => str(P().live);
export function statusOf(v) { if (!v) return 'draft'; if (v.id === liveId()) return 'live'; return isDay(v.wentLive) ? 'old' : 'draft'; }
export const roomsOf = (v) => (v && Array.isArray(v.rooms) ? v.rooms.filter((r) => isObj(r) && typeof r.id === 'string') : []);
const itemsOf = (r) => (r && Array.isArray(r.items) ? r.items.filter((i) => isObj(i) && typeof i.id === 'string') : []);
const dims = (r) => ({ w: num(r.w, 40, 4, 200), h: num(r.h, 30, 4, 200) });
function wallsOf(r) {
  const d = dims(r);
  const pts = Array.isArray(r.walls) ? r.walls.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [num(p[0], 0, -10, 210), num(p[1], 0, -10, 210)]) : [];
  return pts.length >= 3 ? pts : [[0, 0], [d.w, 0], [d.w, d.h], [0, d.h]];
}
function box(it) {
  const k = KIND[it.kind] ? it.kind : 'table';
  return { k, x: num(it.x, 0, -10, 210), y: num(it.y, 0, -10, 210), w: num(it.w, DEF[k].w, 0.5, 200), h: num(it.h, DEF[k].h, 0.5, 200), round: it.shape === 'round', label: str(it.label) };
}
const isSeating = (it) => { const k = box(it).k; return k === 'table' || k === 'seat'; };
const nameOf = (it) => box(it).label || KIND[box(it).k];
const seatingLabels = (r) => itemsOf(r).filter(isSeating).map((it) => box(it).label).filter(Boolean).sort(natural);
function mapLabel(r) {
  const t = seatingLabels(r);
  return str(r.name || 'Room') + ' floor plan' + (r.closed ? ', closed for work' : '') + (t.length ? ': ' + t.length + (t.length === 1 ? ' table or seat' : ' tables and seats') : ': no tables yet');
}
function verLine(v) {
  const st = statusOf(v), bits = [];
  if (st === 'live') bits.push(isDay(v.wentLive) ? 'In use since ' + day(v.wentLive) : 'In use');
  else if (st === 'old') bits.push('In use ' + day(v.wentLive) + (isDay(v.retired) ? ' to ' + day(v.retired) : ''));
  else bits.push('Draft' + (isDay(v.made) ? ', started ' + day(v.made) : '') + (str(v.by) ? ' by ' + str(v.by) : ''));
  if (isDay(v.updated)) bits.push('last changed ' + day(v.updated));
  return bits.join(' · ');
}
/* The version to show on the Maps screen: the one picked, else the one in use. */
let viewV = null;
function curV() { const vs = versions(); return findV(viewV) || findV(liveId()) || vs[0] || null; }
const routeIds = () => { const [v, r] = str(app.route.id).split('/'); return { v: v || '', r: r || '' }; };

/* ---------- drawing ---------- */
let svgN = 0;
export function roomSVG(r, o = {}) {
  const { w, h } = dims(r), pad = 1.5, walls = wallsOf(r);
  const pts = walls.map((p) => N(p[0]) + ',' + N(p[1])).join(' ');
  const hid = 'hatch' + (++svgN);
  // Frame the room's size, plus any wall or table that sits outside it.
  let x0 = 0, y0 = 0, x1 = w, y1 = h;
  walls.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
  itemsOf(r).forEach((it) => { const b = box(it); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
  let s = '<svg class="map' + (o.small ? ' small' : '') + (o.edit ? ' editing' : '') + '"' + (o.edit ? ' id="map-svg"' : '') +
    ' viewBox="' + N(x0 - pad) + ' ' + N(y0 - pad) + ' ' + N(x1 - x0 + pad * 2) + ' ' + N(y1 - y0 + pad * 2) + '"' +
    (o.small ? ' aria-hidden="true" focusable="false"' : ' role="img" aria-label="' + esc(mapLabel(r)) + '"') + '>';
  if (r.closed) s += '<defs><pattern id="' + hid + '" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="m-hatch" x="0" y="0" width="0.45" height="1.6"/></pattern></defs>';
  s += '<polygon class="m-room" points="' + pts + '"/>';
  if (o.edit) { // the grid goes over the floor, under the tables
    let minor = '', major = '';
    for (let x = 0; x <= w; x++) (x % 5 ? (minor += 'M' + x + ' 0V' + N(h)) : (major += 'M' + x + ' 0V' + N(h)));
    for (let y = 0; y <= h; y++) (y % 5 ? (minor += 'M0 ' + y + 'H' + N(w)) : (major += 'M0 ' + y + 'H' + N(w)));
    s += '<path class="m-grid" d="' + minor + '"/><path class="m-grid major" d="' + major + '"/>';
  }
  itemsOf(r).forEach((it) => {
    const b = box(it);
    s += '<g class="m-it k-' + b.k + (o.sel === it.id ? ' sel' : '') + '"' + (o.edit && !o.walls ? ' data-map-item="' + esc(it.id) + '"' : '') + ' transform="translate(' + N(b.x) + ' ' + N(b.y) + ')">';
    if (b.k !== 'label' || o.edit) s += b.round ? '<ellipse class="m-shape" cx="' + N(b.w / 2) + '" cy="' + N(b.h / 2) + '" rx="' + N(b.w / 2) + '" ry="' + N(b.h / 2) + '"/>' : '<rect class="m-shape" width="' + N(b.w) + '" height="' + N(b.h) + '" rx="0.35"/>';
    if (b.label && !o.small) {
      const fs = b.k === 'label' ? Math.max(0.9, Math.min(2, b.h * 0.6)) : Math.max(0.9, Math.min(2.4, Math.min(b.w, b.h) * 0.55));
      s += '<text class="m-t" x="' + N(b.w / 2) + '" y="' + N(b.h / 2) + '" font-size="' + N(fs) + '">' + esc(b.label) + '</text>';
    }
    s += '</g>';
  });
  if (r.closed) {
    s += '<polygon class="m-closed" points="' + pts + '" fill="url(#' + hid + ')"/>';
    if (!o.small) { const tw = Math.min(w * 0.8, 17); s += '<g class="m-closed-tag"><rect x="' + N(w / 2 - tw / 2) + '" y="' + N(h / 2 - 1.6) + '" width="' + N(tw) + '" height="3.2" rx="0.5"/><text x="' + N(w / 2) + '" y="' + N(h / 2) + '" font-size="1.7">Closed for work</text></g>'; }
  }
  if (o.walls) walls.forEach((p, i) => { s += '<circle class="m-corner' + (o.corner === i ? ' sel' : '') + '" data-map-corner="' + i + '" cx="' + N(p[0]) + '" cy="' + N(p[1]) + '" r="0.9"/>'; });
  return s + '</svg>';
}

/* ---------- the Maps screen: versions and their rooms ---------- */
const ORDER = { live: 0, draft: 1, old: 2 };
function versionChips(cur) {
  const vs = versions().slice().sort((a, b) => (ORDER[statusOf(a)] - ORDER[statusOf(b)]) || str(b.made).localeCompare(str(a.made)));
  if (vs.length < 2) return '';
  return '<div class="chips" role="group" aria-label="Versions of the floor">' + vs.map((v) => '<button class="chip" data-act="map-ver" data-id="' + esc(v.id) + '" aria-pressed="' + (v === cur) + '">' + esc(str(v.name) || 'Untitled') + ' · ' + STATUS[statusOf(v)] + '</button>').join('') + '</div>';
}
export function mapsView() {
  const ro = !canWrite('plans'), ed = app.ui.editing && !ro;
  let h = '';
  if (!connOf('plans')) h += '<p class="note">Floor plans are kept on this phone only for now. Connect the Training repo in <button class="link inline" data-act="tab" data-id="more">More → Sync</button> to share them and keep them safe.</p>';
  else if (ro) h += '<p class="note">View only. Your access to the training repo can’t change the maps, but you can look and print.</p>';
  const v = curV();
  if (!v) return h + empty('No floor plans yet.') + (ro ? '' : '<div class="row-actions"><button class="btn primary" data-act="map-start">' + ICON.plus + ' Start the floor plans</button></div>');
  const st = statusOf(v);
  h += versionChips(v);
  h += '<h2 class="list-h">' + esc(str(v.name) || 'Untitled') + ' <span class="badge">' + STATUS[st] + '</span></h2><p class="when-line">' + esc(verLine(v)) + '</p>';
  if (str(v.note)) h += '<p class="note">' + esc(v.note) + '</p>';
  h += '<div class="row-actions"><button class="btn small ghost" data-act="print" data-kind="maps" data-id="' + esc(v.id) + '">' + ICON.print + ' Print</button>' +
    (ro ? '' : '<button class="btn small ghost" data-act="map-draft" data-id="' + esc(v.id) + '">' + ICON.copy + ' New draft from this</button>') +
    (!ro && st !== 'live' ? '<button class="btn small" data-act="map-live" data-id="' + esc(v.id) + '">' + ICON.check + (st === 'old' ? ' Use this one again' : ' Use this one now') + '</button>' : '') +
    (ed ? '<button class="btn small ghost" data-act="map-ver-edit" data-id="' + esc(v.id) + '">' + ICON.pencil + ' Name and note</button>' : '') +
    (ed && st !== 'live' ? '<button class="btn small danger" data-act="map-ver-del" data-id="' + esc(v.id) + '">' + ICON.trash + ' Delete this version</button>' : '') + '</div>';
  if (st === 'draft') h += '<p class="hint">A draft is for drawing the next layout ahead of time. Nothing changes for anyone until you tap “Use this one now”.</p>';
  const rooms = roomsOf(v);
  h += rooms.length ? '<ul class="room-list">' + rooms.map((r) => {
    const n = seatingLabels(r).length;
    return '<li><button class="room-card" data-act="go" data-id="#book/map/' + esc(v.id) + '/' + esc(r.id) + '">' + roomSVG(r, { small: true }) +
      '<span class="room-n">' + esc(str(r.name) || 'Room') + '</span><span class="hint">' + n + (n === 1 ? ' table or seat' : ' tables and seats') + (r.closed ? ' · <b class="warn-t">Closed for work</b>' : '') + '</span></button></li>';
  }).join('') + '</ul>' : empty('No rooms in this version yet.');
  if (ed) h += '<div class="edit-row"><button class="btn small" data-act="map-room-add" data-id="' + esc(v.id) + '">' + ICON.plus + ' Add a room</button></div>';
  return h;
}

/* ---------- one room ---------- */
let sel = null, corner = null, wallMode = false, lastRoom = '';
export function roomView(routeId) {
  const [vId, rId] = str(routeId).split('/');
  const v = findV(vId), r = v ? roomsOf(v).find((x) => x.id === rId) : null;
  if (routeId !== lastRoom) { sel = null; corner = null; wallMode = false; lastRoom = routeId; }
  let h = '<button class="back" data-act="go" data-id="#book/maps">' + ICON.chevL + ' Floor plans</button>';
  if (!r) return h + empty('That room isn’t in this version of the floor anymore.');
  const st = statusOf(v), ro = !canWrite('plans'), ed = app.ui.editing && !ro;
  if (sel && !itemsOf(r).some((it) => it.id === sel)) sel = null;
  h += '<h2 class="list-h">' + esc(str(r.name) || 'Room') + (r.closed ? ' <span class="badge">Closed for work</span>' : '') + '</h2>';
  h += '<p class="when-line">' + esc(str(v.name) || 'Untitled') + ' · ' + STATUS[st] + '</p>';
  if (r.closed && str(r.closedNote)) h += '<p class="note">' + esc(r.closedNote) + '</p>';
  h += '<div class="row-actions">' + (ro ? '' : '<button class="btn small' + (ed ? '' : ' ghost') + '" data-act="map-edit" aria-pressed="' + ed + '">' + ICON.pencil + (ed ? ' Done' : ' Edit') + '</button>') +
    '<button class="btn small ghost" data-act="print" data-kind="maps" data-id="' + esc(v.id) + '">' + ICON.print + ' Print</button></div>';
  if (ed && st === 'live') h += '<p class="note">You’re changing the layout in use. Copies printed before today will show as out of date. To plan a remodel, make a draft instead.</p>';
  if (ed && st === 'old') h += '<p class="note">This version isn’t in use anymore.</p>';
  h += '<div class="map-wrap">' + roomSVG(r, { edit: ed, sel, walls: ed && wallMode, corner }) + '</div>';
  const t = seatingLabels(r);
  if (!ed) return h + '<p class="hint">' + (t.length ? 'Tables and seats: ' + esc(t.join(', ')) : 'No tables yet.') + '</p>';
  h += '<div class="map-tools" role="group" aria-label="Add to the room">' +
    '<button class="btn small" data-act="map-add" data-kind="table">' + ICON.plus + ' Table</button>' +
    '<button class="btn small" data-act="map-add" data-kind="table" data-shape="round">' + ICON.plus + ' Round table</button>' +
    '<button class="btn small" data-act="map-add" data-kind="seat">' + ICON.plus + ' Bar seat</button>' +
    '<button class="btn small" data-act="map-add" data-kind="counter">' + ICON.plus + ' Counter</button>' +
    '<button class="btn small" data-act="map-add" data-kind="label">' + ICON.plus + ' Label</button></div>';
  h += '<div class="row-actions"><button class="btn small ghost" data-act="map-walls" aria-pressed="' + wallMode + '">' + (wallMode ? 'Done with walls' : 'Move walls') + '</button><button class="btn small ghost" data-act="map-room-edit">' + ICON.pencil + ' Room</button></div>';
  if (wallMode) return h + wallPanel(r);
  const its = itemsOf(r).slice().sort((a, b) => natural(nameOf(a), nameOf(b)));
  if (its.length) h += '<div class="chips map-items" role="group" aria-label="Pick something to change">' + its.map((it) => '<button class="chip" data-act="map-sel" data-id="' + esc(it.id) + '" aria-pressed="' + (sel === it.id) + '">' + esc(nameOf(it)) + '</button>').join('') + '</div>';
  else h += '<p class="hint">Add tables with the buttons above, then drag them into place or use the arrows.</p>';
  const it = sel && itemsOf(r).find((x) => x.id === sel);
  if (it) h += itemPanel(it);
  else if (its.length) h += '<p class="hint">Tap a table on the map or in the list. Drag it, or use the arrows to move it.</p>';
  return h;
}
const nudgeBtns = () => '<div class="nudge" role="group" aria-label="Move">' +
  '<button class="icon-b" data-act="map-nudge" data-dx="-0.5" data-dy="0" aria-label="Move left">' + ICON.chevL + '</button>' +
  '<button class="icon-b" data-act="map-nudge" data-dx="0" data-dy="-0.5" aria-label="Move up">' + ICON.up + '</button>' +
  '<button class="icon-b" data-act="map-nudge" data-dx="0" data-dy="0.5" aria-label="Move down">' + ICON.down + '</button>' +
  '<button class="icon-b" data-act="map-nudge" data-dx="0.5" data-dy="0" aria-label="Move right">' + ICON.chevR + '</button></div>';
function itemPanel(it) {
  const b = box(it);
  return '<section class="panel map-panel" aria-label="' + esc('Changing ' + nameOf(it)) + '"><div class="row-h"><h3 class="sub-h">' + esc(nameOf(it)) + '</h3><button class="icon-b" data-act="map-desel" aria-label="Done with this one">' + ICON.close + '</button></div>' +
    '<div class="form">' + field('mf-label', 'Name on the map', input('mf-label', b.label, 'data-map-f="label" autocomplete="off" maxlength="24"'), b.k === 'label' ? 'Like Entrance, Kitchen or Window' : 'Like 12, B3 or PDR', 'half') +
    field('mf-kind', 'What it is', '<select id="mf-kind" data-map-f="kind">' + opts(Object.entries(KIND), b.k) + '</select>', '', 'half') +
    field('mf-shape', 'Shape', '<select id="mf-shape" data-map-f="shape">' + opts([['rect', 'Square corners'], ['round', 'Round']], b.round ? 'round' : 'rect') + '</select>', '', 'half') + '</div>' +
    nudgeBtns() +
    '<div class="row-actions"><button class="btn small ghost" data-act="map-size" data-d="w+">Wider</button><button class="btn small ghost" data-act="map-size" data-d="w-">Narrower</button><button class="btn small ghost" data-act="map-size" data-d="h+">Taller</button><button class="btn small ghost" data-act="map-size" data-d="h-">Shorter</button></div>' +
    '<div class="row-actions"><button class="btn small ghost" data-act="map-turn">Turn</button><button class="btn small ghost" data-act="map-dup">' + ICON.copy + ' Copy</button><button class="btn small danger" data-act="map-del">' + ICON.trash + ' Remove</button></div>' +
    '<p class="hint mono">At ' + N(b.x) + ', ' + N(b.y) + ' · ' + N(b.w) + ' × ' + N(b.h) + ' squares</p></section>';
}
function wallPanel(r) {
  const n = wallsOf(r).length;
  const list = '<div class="chips map-items" role="group" aria-label="Pick a corner of the room">' + wallsOf(r).map((p, i) => '<button class="chip" data-act="map-corner" data-id="' + i + '" aria-pressed="' + (corner === i) + '">Corner ' + (i + 1) + '</button>').join('') + '</div>';
  if (corner == null || corner >= n) return list + '<p class="hint">Tap a corner (the circles on the map, or one above) to move it. Drag it, or use the arrows. Corners go around the room in order.</p>';
  return list + '<section class="panel map-panel" aria-label="Changing a corner"><div class="row-h"><h3 class="sub-h">Corner ' + (corner + 1) + ' of ' + n + '</h3><button class="icon-b" data-act="map-desel" aria-label="Done with this corner">' + ICON.close + '</button></div>' +
    nudgeBtns() + '<div class="row-actions"><button class="btn small ghost" data-act="map-corner-add">' + ICON.plus + ' Add a corner after this one</button>' +
    (n > 3 ? '<button class="btn small danger" data-act="map-corner-del">' + ICON.trash + ' Remove this corner</button>' : '') + '</div></section>';
}

/* ---------- printing ---------- */
export function printTarget(vId) {
  const v = findV(vId);
  if (!v) return null;
  const rev = [str(v.updated), str(v.retired)].concat(roomsOf(v).map((r) => str(r.updated))).filter(isDay).sort().pop() || todayKey();
  return { label: 'Floor plans: ' + (str(v.name) || 'Untitled'), rev: rev.slice(0, 10) };
}
export function printHTML(vId, stamp) {
  const v = findV(vId);
  if (!v) return '';
  return roomsOf(v).map((r) => {
    const t = seatingLabels(r);
    return '<section class="pv-sec pv-map"><h2 class="pv-h">' + esc(str(r.name) || 'Room') + (r.closed ? ' <span class="pv-draft">Closed for work</span>' : '') + '</h2>' + stamp() +
      '<p class="pv-when">' + esc((str(v.name) || 'Untitled') + ' · ' + verLine(v)) + '</p>' +
      (r.closed && str(r.closedNote) ? '<p class="pv-when">' + esc(r.closedNote) + '</p>' : '') +
      roomSVG(r) + (t.length ? '<p class="pv-when">Tables and seats: ' + esc(t.join(', ')) + '</p>' : '') + '</section>';
  }).join('');
}

/* ---------- changes ---------- */
function editV(vId, fn) {
  edit('plans', (d) => {
    if (!Array.isArray(d.versions)) d.versions = [];
    const v = d.versions.find((x) => isObj(x) && x.id === vId);
    if (!v) return;
    fn(v, d); v.updated = todayKey();
  });
}
function editR(fn) {
  const { v: vId, r: rId } = routeIds();
  editV(vId, (v, d) => {
    if (!Array.isArray(v.rooms)) v.rooms = [];
    const r = v.rooms.find((x) => isObj(x) && x.id === rId);
    if (!r) return;
    if (!Array.isArray(r.items)) r.items = [];
    fn(r, v, d); r.updated = todayKey();
  });
}
function editItem(id, fn) { editR((r) => { const it = r.items.find((x) => isObj(x) && x.id === id); if (it) fn(it, r); }); }
function curRoom() { const { v, r } = routeIds(); const vv = findV(v); return vv ? roomsOf(vv).find((x) => x.id === r) || null : null; }
const newVersion = (name) => ({ id: uid('v'), name, note: '', made: todayKey(), by: whoAmI() || '', updated: todayKey(), rooms: [] });
const newRoom = (name) => ({ id: uid('r'), name, w: 40, h: 30, walls: [[0, 0], [40, 0], [40, 30], [0, 30]], closed: false, closedNote: '', items: [], updated: todayKey() });
/* The next free table number in a room (after the highest one used). */
function nextLabel(r, kind) {
  if (kind === 'counter') return 'Bar';
  if (kind === 'label') return 'Entrance';
  const pre = kind === 'seat' ? 'S' : '';
  let max = 0;
  itemsOf(r).forEach((it) => { const m = new RegExp('^' + pre + '(\\d+)$').exec(box(it).label); if (m) max = Math.max(max, +m[1]); });
  return pre + (max + 1);
}
const ro = () => { if (canWrite('plans')) return false; toast('View only: your access to the training repo can’t change the maps.'); return true; };
const redraw = () => app.renderView();

function versionSheet(v, isNew) {
  openSheet({
    eyebrow: isNew ? 'New draft' : 'Floor plans', title: isNew ? 'Name the draft' : 'Name and note',
    body: '<div class="form">' + field('mv-name', 'Name', input('mv-name', str(v.name), 'autocomplete="off" maxlength="60"'), 'Like “Phase 1: patio closed” or “After the remodel”') +
      field('mv-note', 'Note', textarea('mv-note', str(v.note), 3), 'Optional. What changes, and when.') + '</div>',
    foot: '<button class="btn primary" data-act="map-ver-save" data-id="' + esc(v.id) + '">Save</button>'
  });
}
function roomSheet(r) {
  const d = dims(r);
  openSheet({
    eyebrow: 'Room', title: str(r.name) || 'Room',
    body: '<div class="form">' + field('mr-name', 'Name', input('mr-name', str(r.name), 'autocomplete="off" maxlength="40"')) +
      field('mr-w', 'Width', input('mr-w', d.w, 'type="number" inputmode="decimal" min="4" max="200" step="1"'), 'In squares on the map', 'half') +
      field('mr-h', 'Depth', input('mr-h', d.h, 'type="number" inputmode="decimal" min="4" max="200" step="1"'), 'In squares on the map', 'half') + '</div>' +
      '<label class="checkline"><input type="checkbox" id="mr-closed"' + (r.closed ? ' checked' : '') + '><span>Closed for work</span></label>' +
      '<div class="form">' + field('mr-cnote', 'About the closure', input('mr-cnote', str(r.closedNote), 'autocomplete="off" maxlength="120"'), 'Optional. Like “Until Nov 20. Seat patio guests in the main room.”') + '</div>' +
      '<div class="row-actions"><button class="btn small ghost" data-act="map-walls-reset">Make the walls a plain rectangle</button><button class="btn small danger" data-act="map-room-del">' + ICON.trash + ' Delete this room</button></div>',
    foot: '<button class="btn primary" data-act="map-room-save">Save</button>'
  });
}

export const acts = {
  'map-start': () => {
    if (ro()) return;
    let vId = '', rId = '';
    edit('plans', (d) => { const v = newVersion('Current layout'); const r = newRoom('Main room'); v.rooms.push(r); v.wentLive = todayKey(); if (!Array.isArray(d.versions)) d.versions = []; d.versions.push(v); d.live = v.id; vId = v.id; rId = r.id; });
    app.ui.editing = true; app.go('#book/map/' + vId + '/' + rId); toast('Started. Name the room, then add tables.');
  },
  'map-ver': (el) => { viewV = el.dataset.id; redraw(); },
  'map-draft': (el) => {
    if (ro()) return;
    const src = findV(el.dataset.id); if (!src) return;
    const v = Object.assign(clone(src), newVersion('Next layout'), { rooms: clone(src.rooms || []), note: '' });
    delete v.wentLive; delete v.retired;
    edit('plans', (d) => { if (!Array.isArray(d.versions)) d.versions = []; d.versions.push(v); });
    viewV = v.id; redraw(); versionSheet(v, true);
  },
  'map-ver-edit': (el) => { const v = findV(el.dataset.id); if (v) versionSheet(v, false); },
  'map-ver-save': (el) => {
    const name = ($('#mv-name').value || '').trim() || 'Untitled', note = ($('#mv-note').value || '').trim();
    editV(el.dataset.id, (v) => { v.name = name; v.note = note; });
    closeSheet(); redraw();
  },
  'map-live': (el) => {
    if (ro()) return;
    const v = findV(el.dataset.id); if (!v) return;
    if (!armed(el, statusOf(v) === 'old' ? 'Go back to this layout?' : 'Use this layout now?')) return;
    edit('plans', (d) => {
      const today = todayKey();
      (d.versions || []).forEach((x) => { if (isObj(x) && x.id === d.live && x.id !== v.id) x.retired = today; });
      const nv = (d.versions || []).find((x) => isObj(x) && x.id === v.id);
      if (nv) { nv.wentLive = today; delete nv.retired; nv.updated = today; }
      d.live = v.id;
    });
    viewV = v.id; redraw(); toast('Now in use. Print new copies for the floor.', 3200);
  },
  'map-ver-del': (el) => {
    if (ro()) return;
    const v = findV(el.dataset.id); if (!v || statusOf(v) === 'live') return;
    if (!armed(el, 'Delete this version?')) return;
    edit('plans', (d) => { d.versions = (d.versions || []).filter((x) => !(isObj(x) && x.id === v.id)); markGone(d, v.id); });
    viewV = null; redraw(); toast('Version deleted.');
  },
  'map-room-add': (el) => {
    if (ro()) return;
    const r = newRoom('New room');
    editV(el.dataset.id, (v) => { if (!Array.isArray(v.rooms)) v.rooms = []; v.rooms.push(r); });
    app.ui.editing = true; app.go('#book/map/' + el.dataset.id + '/' + r.id);
    setTimeout(() => { const cur = curRoom(); if (cur && cur.id === r.id) roomSheet(cur); }, 80);
  },
  'map-edit': () => { if (ro()) return; app.ui.editing = !app.ui.editing; sel = null; corner = null; wallMode = false; redraw(); if (app.ui.editing) toast('Tap a table to change it, or drag it.'); },
  'map-room-edit': () => { const r = curRoom(); if (r) roomSheet(r); },
  'map-room-save': () => {
    const name = ($('#mr-name').value || '').trim() || 'Room';
    const w = num($('#mr-w').value, null, 4, 200), h = num($('#mr-h').value, null, 4, 200);
    const closed = !!$('#mr-closed').checked, note = ($('#mr-cnote').value || '').trim();
    editR((r) => {
      const was = dims(r), plain = same4(wallsOf(r), was);
      r.name = name; r.closed = closed; r.closedNote = note;
      if (w != null) r.w = w; if (h != null) r.h = h;
      if (plain) r.walls = rect(dims(r)); // plain rectangular walls follow the room's size
    });
    closeSheet(); redraw();
  },
  'map-walls-reset': () => { editR((r) => { r.walls = rect(dims(r)); }); closeSheet(); redraw(); toast('Walls reset.'); },
  'map-room-del': (el) => {
    if (ro()) return;
    if (!armed(el, 'Delete this room?')) return;
    const { v: vId, r: rId } = routeIds();
    editV(vId, (v) => { v.rooms = (v.rooms || []).filter((x) => !(isObj(x) && x.id === rId)); });
    closeSheet().then(() => app.go('#book/maps')); toast('Room deleted from this version.');
  },
  'map-add': (el) => {
    if (ro()) return;
    const r = curRoom(); if (!r) return;
    const kind = KIND[el.dataset.kind] ? el.dataset.kind : 'table', shape = el.dataset.shape === 'round' || kind === 'seat' ? 'round' : 'rect';
    const d = dims(r), size = kind === 'table' && shape === 'round' ? { w: 4, h: 4 } : DEF[kind];
    const n = itemsOf(r).length % 6;
    const it = { id: uid(kind === 'table' || kind === 'seat' ? 't' : 'm'), kind, shape, label: nextLabel(r, kind), x: snap(d.w / 2 - size.w / 2 + n), y: snap(d.h / 2 - size.h / 2 + n), w: size.w, h: size.h };
    editR((rr) => { rr.items.push(it); });
    sel = it.id; redraw();
  },
  'map-sel': (el) => { sel = el.dataset.id; redraw(); },
  'map-desel': () => { sel = null; corner = null; redraw(); },
  'map-nudge': (el) => {
    if (ro()) return;
    const dx = num(el.dataset.dx, 0, -5, 5), dy = num(el.dataset.dy, 0, -5, 5);
    if (wallMode && corner != null) editR((r) => { const w = wallsOf(r); if (!w[corner]) return; w[corner] = [snap(w[corner][0] + dx), snap(w[corner][1] + dy)]; r.walls = w; });
    else if (sel) editItem(sel, (it) => { const b = box(it); it.x = snap(b.x + dx); it.y = snap(b.y + dy); });
    redraw();
  },
  'map-size': (el) => {
    if (ro() || !sel) return;
    const d = el.dataset.d || '';
    editItem(sel, (it) => { const b = box(it), k = d[0] === 'w' ? 'w' : 'h'; it[k] = Math.max(1, Math.min(200, snap(b[k] + (d[1] === '+' ? 0.5 : -0.5)))); if (k === 'w') it.h = b.h; else it.w = b.w; });
    redraw();
  },
  'map-turn': () => { if (ro() || !sel) return; editItem(sel, (it) => { const b = box(it); it.w = b.h; it.h = b.w; }); redraw(); },
  'map-dup': () => {
    if (ro() || !sel) return;
    const r = curRoom(); const src = r && itemsOf(r).find((x) => x.id === sel); if (!src) return;
    const b = box(src);
    const it = Object.assign(clone(src), { id: uid(isSeating(src) ? 't' : 'm'), x: snap(b.x + 1), y: snap(b.y + 1), label: /^\D*\d+$/.test(b.label) || !b.label ? nextLabel(r, b.k) : b.label });
    editR((rr) => { rr.items.push(it); });
    sel = it.id; redraw();
  },
  'map-del': (el) => {
    if (ro() || !sel) return;
    if (!armed(el, 'Remove it?')) return;
    const id = sel;
    editR((r) => { r.items = r.items.filter((x) => !(isObj(x) && x.id === id)); });
    sel = null; redraw(); toast('Removed from this version.');
  },
  'map-corner': (el) => { corner = Math.max(0, Math.floor(num(el.dataset.id, 0, 0, 999))); redraw(); },
  'map-walls': () => { wallMode = !wallMode; corner = null; sel = null; redraw(); },
  'map-corner-add': () => {
    if (ro() || corner == null) return;
    editR((r) => { const w = wallsOf(r), a = w[corner], b = w[(corner + 1) % w.length]; if (!a || !b) return; w.splice(corner + 1, 0, [snap((a[0] + b[0]) / 2), snap((a[1] + b[1]) / 2)]); r.walls = w; });
    corner += 1; redraw();
  },
  'map-corner-del': (el) => {
    if (ro() || corner == null) return;
    if (!armed(el, 'Remove this corner?')) return;
    editR((r) => { const w = wallsOf(r); if (w.length <= 3) return; w.splice(corner, 1); r.walls = w; });
    corner = null; redraw();
  }
};
const rect = (d) => [[0, 0], [d.w, 0], [d.w, d.h], [0, d.h]];
const same4 = (w, d) => w.length === 4 && JSON.stringify(w) === JSON.stringify(rect(d));

export function onInput(el, ev) {
  const f = el.dataset && el.dataset.mapF;
  if (!f || !sel) return false;
  if (!canWrite('plans')) return true;
  if (f === 'label') {
    const v = String(el.value || '').slice(0, 24);
    editItem(sel, (it) => { it.label = v; });
    if (ev && ev.type === 'change') redraw();
    else { const t = document.querySelector('#map-svg [data-map-item="' + (window.CSS && CSS.escape ? CSS.escape(sel) : sel) + '"] text'); if (t) t.textContent = v; }
    return true;
  }
  if (f === 'kind' && KIND[el.value]) { editItem(sel, (it) => { it.kind = el.value; }); redraw(); return true; }
  if (f === 'shape') { editItem(sel, (it) => { it.shape = el.value === 'round' ? 'round' : 'rect'; }); redraw(); return true; }
  return false;
}

/* ---------- dragging on the map (the arrow buttons do the same without dragging) ---------- */
let drag = null;
function svgPoint(svg, ev) {
  const vb = svg.viewBox.baseVal, rc = svg.getBoundingClientRect();
  return { x: vb.x + (ev.clientX - rc.left) * vb.width / rc.width, y: vb.y + (ev.clientY - rc.top) * vb.height / rc.height };
}
function onDown(ev) {
  const svg = ev.target && ev.target.closest && ev.target.closest('svg.map.editing');
  if (!svg || !canWrite('plans')) return;
  const g = ev.target.closest('[data-map-item]'), c = ev.target.closest('[data-map-corner]');
  if (!g && !c) return;
  ev.preventDefault();
  const r = curRoom(); if (!r) return;
  const p = svgPoint(svg, ev);
  if (g) { const it = itemsOf(r).find((x) => x.id === g.dataset.mapItem); if (!it) return; const b = box(it); drag = { svg, el: g, item: it.id, ox: b.x, oy: b.y, start: p, pid: ev.pointerId, moved: false, dx: 0, dy: 0 }; }
  else { const i = +c.dataset.mapCorner, w = wallsOf(r); if (!w[i]) return; drag = { svg, el: c, corner: i, walls: w, start: p, pid: ev.pointerId, moved: false, dx: 0, dy: 0, poly: svg.querySelector('.m-room') }; }
  try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
}
function onMove(ev) {
  if (!drag || ev.pointerId !== drag.pid) return;
  const p = svgPoint(drag.svg, ev), rx = p.x - drag.start.x, ry = p.y - drag.start.y;
  if (!drag.moved && Math.hypot(rx, ry) < 0.35) return;
  drag.moved = true; drag.dx = snap(rx); drag.dy = snap(ry);
  if (drag.item) drag.el.setAttribute('transform', 'translate(' + r2(drag.ox + drag.dx) + ' ' + r2(drag.oy + drag.dy) + ')');
  else {
    const w = drag.walls.map((q, i) => (i === drag.corner ? [q[0] + drag.dx, q[1] + drag.dy] : q));
    drag.el.setAttribute('cx', r2(w[drag.corner][0])); drag.el.setAttribute('cy', r2(w[drag.corner][1]));
    if (drag.poly) drag.poly.setAttribute('points', w.map((q) => r2(q[0]) + ',' + r2(q[1])).join(' '));
  }
}
function onUp(ev) {
  if (!drag || ev.pointerId !== drag.pid) return;
  const d = drag; drag = null;
  if (ev.type === 'pointercancel') { redraw(); return; }
  if (d.item) {
    if (d.moved) editItem(d.item, (it) => { it.x = snap(d.ox + d.dx); it.y = snap(d.oy + d.dy); });
    sel = d.item;
  } else {
    if (d.moved) editR((r) => { const w = wallsOf(r); if (!w[d.corner]) return; w[d.corner] = [snap(w[d.corner][0] + d.dx), snap(w[d.corner][1] + d.dy)]; r.walls = w; });
    corner = d.corner;
  }
  redraw();
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('pointerdown', onDown);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}
