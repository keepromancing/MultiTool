# The Sheet

(Formerly MultiTool.) An offline, installable shift tool: checklists, how-to cards, an assignment sheet, an inventory count with ordering, shift notes, a floor board with breaks, follow-ups, and plain-text messages for team chat.

**This repository holds no data.** It's an empty app. Content comes from private repositories that the app reads and writes through the GitHub API, with fine-grained tokens stored only on the phone. Phone-only things (shift notes, the floor board, trainees, message drafts, the staffing plan, the count in progress) never sync. A backup file, saved by hand, holds the synced parts plus trainees and the count in progress; it never holds the keys, shift notes, the floor board, message drafts, clash notes or the staffing plan (which comes only from its own phone-only file).

## Connections

- **Book** (one person): `book.json` and `state.json`: checklists, cards, the day, follow-ups, wins, the printed-copies log.
- **Inventory** (shared by everyone who counts and orders): `inventory.json` (lines and products) and `counts.json` (saved counts and order status). If no inventory connection is set, these two files sync to the book repo instead.
- **Training** (a team repo): `floorplans.json`, the floor plans. It has no fallback: until it's connected, floor plans stay on the phone.

A phone with only an inventory connection runs in **count-only mode**: just the Count and More tabs.

Setup links: `#setup=owner/repo` prefills the book connection, `#setup=inv:owner/repo` the inventory one. On an iPhone, add the app to the Home Screen first and set up inside the installed app: its storage is separate from Safari's, and Safari may clear a tab's data after a week without a visit.

## Access

Access is managed on GitHub, not in the app. Each part of the app lives in its own private repo in the organization, and people get to parts through teams:

- Set the organization's base permission to **No permission**, so members see only what a team gives them.
- One team per job (for example, a team with **Write** on the inventory repo). Add **Read** for anyone who should only look.
- Keys for the organization use **All repositories**. A key only reaches what its owner has been given, so a new grant needs no new key.

Every sync asks GitHub what the key may do with each repo. Write: normal. Read: the part loads but nothing is sent, and the Count and floor plan screens go view-only. No access (removed from the team, or the key revoked or expired): that part stops syncing and says so. What's already on a phone stays there; removing access stops future syncing, it can't wipe a phone.

If a phone has unsent changes when its access drops to view only (say a count saved offline), they stay on the phone, unsent, and go up if write access comes back. Where someone else changed the same thing meanwhile, GitHub's version wins, so the late send can't undo it.

The data repos must stay private. If one is made public on GitHub, phones keep reading it but send nothing to it, and the sync status says why; changes wait on the phone until it's private again.

Synced files are tied to the repo's id, so renaming the repo or the organization doesn't restart anything. On a phone's first sync with a repo (a new phone, a restored backup), GitHub's copy wins any differences and anything only the phone has is added.

Adding a new part means a new repo, a new connection in `js/sync.js` and its screens; access to it then works the same way.

## Tests

`node tests/run-all.mjs` runs everything: sync between several phones against a fake GitHub, every screen drawing, and the accessibility checks. Node 20+, plus Python 3 with `lxml` for two of the accessibility checks. Details, and what the tests can't cover, in `tests/README.md`.

## Accessibility

Target: WCAG 2.2 level AA. Checked on 10/29/26 (1.4.0), by script (`tests/a11y`) and by reading the code, not yet with a screen reader on a phone:

- **Contrast (1.4.3, 1.4.11):** every text color on every background it's used on, in light and dark, is at least 4.5:1; form-field borders, the focus ring and the selected-tab mark are at least 3:1. `--band-text` is the blue for text, because `--band` is too dark for text in dark mode.
- **Names and labels (1.1.1, 1.3.1, 3.3.2, 4.1.2):** every field has a label; every button has a name, including icon-only ones; count steppers say which item they change ("Plus one, Coffee Lids"); decorative icons are hidden from screen readers.
- **Structure (1.3.1, 2.4.2, 2.4.6):** each screen has one page heading and its own page title, with no skipped heading levels. When the screen changes, focus moves to its heading so screen readers say where you are.
- **Sheets (2.4.3):** dialogs are modal; the page behind them is inert while one is open, and focus returns afterwards.
- **No time limits (2.2.1):** tap-twice deletes stay armed until you tap again or tap anything else, and the prompt is announced.
- **Errors (3.3.1):** a number the app can't read is marked invalid for screen readers, shown by more than color, and explained in words.
- **Targets and focus (2.5.8, 2.4.7, 2.4.11):** everything tappable is at least 24×24 px (most are 40 px or more); focus is always outlined and scrolls clear of the fixed header and tab bar.
- **Also:** smallest text is 12 px; motion is off when the phone asks for reduced motion; pinch zoom is never blocked.

Still to do: a pass with TalkBack (Android) and VoiceOver (iPhone); the printed cards are separate work.

## Sync

- Works offline after the first load (service worker). Data lives in IndexedDB on the phone.
- GitHub's API is the only outside address the app contacts. Everything else, fonts included, ships with the app; the page's security rules allow nothing else, and `tests/offline.test.mjs` checks it.
- Syncs when you tap Sync, and quietly on its own when the app opens, comes back to the front or regains signal, after a count is saved, and about 20 seconds after an item edit.
- Merges three ways (last-synced copy, phone, GitHub), item by item. Saved counts are new records, so two people's counts never collide. Bookkeeping fields (`updated`, `by`) never count as a clash.
- A deleted saved count stays deleted. The shared file keeps a marker (the count's id and when it was deleted, nothing else), so an old phone or an old backup that still has the count can't bring it back. If one phone deletes a count while another changes it (marks it placed, say), the count is kept and a note says so, so an order isn't lost.
- Saving a count or editing an item while a sync is sending is safe: the change stays on the phone and goes up in a quiet sync right after.
- If two phones change the same inventory field between syncs, the phone's value stays and a "Keep mine / Use theirs" prompt appears on the Count tab. Once that value changes again (someone settles on something newer), the prompt goes away, so an old prompt can't undo a newer change. For the book, the phone wins and a merge note is kept under More → Sync.
- Everything from the shared files is shown as text, never as page markup, since anyone with access can edit them (even by hand on github.com).
- Saved counts with something to order carry a status: not placed → placed → received, with initials and dates, so two people never place the same order. An unplaced order is replaced when anyone saves a newer count with its own order.

## Floor plans

Book → Maps. Each room has walls, tables, bar seats, counters and labels (entrance, kitchen, window), drawn on a grid of squares. The whole floor is kept as versions:

- **In use:** the layout everyone works from. Changing it directly is allowed (for fixing a mistake), with a warning that older printouts are now out of date.
- **Drafts:** a copy of the whole floor for drawing the next layout ahead of a remodel. Nothing changes for anyone until someone taps "Use this one now". Then the old layout is kept as "not in use", with the dates it was in use.
- Rooms and tables keep their ids in every version, so a table is the same table before and after it moves. A room can be marked closed for work, with a note.

Tables move by dragging, or with the arrow buttons (no dragging needed, WCAG 2.5.7); every table and every corner of the walls can also be picked from a list of buttons. Printouts put each room on its own page with the version's name and the date it went into use, and a version going out of use makes its printed copies show as out of date under Lead → Printed. Deleting a version leaves a deletion marker (its id only); rooms and tables never get one, because they live on in other versions.

## Ordering

Anything counted below its minimum goes on the order with a suggested amount: what's short, in the line's unit, or in cases when the product to order has a per-case number. An amount changed by hand stays until the count is saved, but it belongs to the unit it was shown in: if the unit changes (a per-case number is added, or a different product is picked to order), the suggestion comes back rather than reading the old number in the new unit. Emptying an order box also brings the suggestion back; 0 means don't order it.

## Printing

Prints a revision stamp on every page and keeps a log of where printed copies went, so stale copies are easy to spot.

## Building

Internal names stay as they were (the IndexedDB name `multitool`, backup type `multitool-backup`, private-file type `multitool-private`) so older backup files still import.

No build step: plain HTML, CSS and ES modules. To release a change, bump `VERSION` in `sw.js` (and `app.version` in `js/main.js`) so installed copies pick it up.

Fonts (in `fonts/`): Atkinson Hyperlegible, IBM Plex Mono and Sofia Sans Extra Condensed, all under the SIL Open Font License (license files alongside). They were made from the google/fonts repository's files, cut down to Latin and Latin-extended letters, and saved as WOFF2.
