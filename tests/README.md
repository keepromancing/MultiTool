# Tests

Run everything from the repo folder:

```
node tests/run-all.mjs
```

Needs Node 20 or newer. The two accessibility scripts need Python 3, and the markup check also needs `lxml` (`pip install lxml`); without them those steps are skipped, not failed. Nothing to install for the Node tests, and nothing is written into the repo (scratch files go to the system temp folder).

All data here is made up (`fixtures/`). This repo is public, so keep it that way: no real names, places, items or notes.

## What's covered

| File | What it checks |
|---|---|
| `sync.test.mjs` | Several phones syncing against a fake GitHub: moving from 1.0 data, connecting a shared inventory repo, a count-only iPhone, offline counts from two phones, order status (placed, received, replaced), edits to different and to the same field (the "Keep mine / Use theirs" prompt), bad keys, auto-sync, restoring a backup on a new phone, view-only access, access removed and given back, a renamed organization, an old backup meeting newer shared data, disconnecting, a count saved and an item edited while a sync is still sending (the fake can hold GitHub's answer), a clash prompt that has gone out of date, access dropping to view only while a count waits to go, a data repo made public, and a deleted saved count staying deleted (an old phone or backup can't bring it back; deleting it while another phone marks it placed keeps it, with a note), and floor plans in the Training repo (they go there and nowhere else, two people moving different tables both count, a view-only key reads but never sends). `run-all` runs it in three time zones (UTC and the two furthest from it) to catch date bugs. |
| `count.test.mjs` | Order amounts: one changed by hand keeps its unit (it isn't read as cases once a per-case number appears), and an emptied order box goes back to the suggestion. Also draws every Count screen from shared files containing markup and checks it shows as text. |
| `background.test.mjs` | Anything waiting to be saved (a count, an item edit) is saved the moment the app goes to the background or closes, not after the usual short wait. iOS can close a backgrounded app without warning. |
| `backup.test.mjs` | A backup file leaves out the keys, shift notes (resident section included), the floor board and break times, remembered staff names, message drafts, clash notes and the staffing plan; restoring an older backup that still has them doesn't bring them back or replace the phone's own. |
| `maps.test.mjs` | Floor plans drawn from a hand-edited file with markup and junk numbers (shown as text, sizes capped), adding and numbering tables, moving them with the arrow buttons, drafts that keep room and table ids, going live (two taps; the old layout's printouts go out of date), deleting a version, view-only access, and printing one room per page. |
| `offline.test.mjs` | Every file the app loads (page, styles, fonts, icons, every module) is in the offline cache list and exists, each font has its license, and the only outside address anywhere in the app or its security rules is GitHub's API. |
| `shell.test.mjs` | Boots the whole app three ways (full, count-only, not set up) and visits every screen: each draws without an error, has a page heading and its own page title, and a count-only phone never shows Now, Book or Lead. |
| `confirm.test.mjs` | Tap-twice deletes have no time limit, are announced to screen readers, and are cancelled by tapping anywhere else. |
| `a11y/render.mjs` + `a11y/markup.py` | Draws every screen and the main sheets with sample data, then checks the markup: every field labeled, every button named (including icon-only ones), one page heading, no skipped heading levels, no clickable non-buttons, no duplicate ids. |
| `a11y/contrast.py` | Every text color on every background it's used on, light and dark, against WCAG AA (4.5:1 for text, 3:1 for borders and focus). Add a line to `PAIRS` whenever a new color combination is used. |

Each test was checked by breaking the app on purpose (dropping new items in the merge, fading the hint text, removing button labels) and confirming the test failed. Do the same for a new test before trusting it.

## What isn't covered

These run in Node with a fake page and a fake GitHub, not in a browser:

- **Real browsers:** installing the app, the offline cache, browser storage limits, and Safari on iPhone. Check those on a real phone.
- **Real GitHub:** the fake answers the calls the app makes (repo info, read and write a file, refuse a stale write, view-only and no-access keys) the way GitHub's docs describe. If GitHub behaves differently, these tests won't know.
- **Screen readers:** the markup check catches missing labels and structure, but a pass with TalkBack (Android) and VoiceOver (iPhone) is still the real test.
- **Printouts.**

## Adding to them

- A change to sync or merging: add a numbered scenario to `sync.test.mjs`.
- A new screen or sheet: add its route to `shell.test.mjs`, and open it in `a11y/render.mjs`.
- A floor plan feature: `maps.test.mjs` (and a sync scenario if it changes what's synced).
- New sample data goes in `fixtures/` (shared files) or `lib/fixtures.mjs` (phone-only things like picked jobs and the floor board).
