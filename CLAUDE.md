# Working on The Sheet

- Plain HTML, CSS and ES modules. No build step, no dependencies.
- This repo is public and holds no content. No work-specific names, people, places, items or data, in code, tests or commit messages. That includes hint and placeholder text: use generic examples (main room, patio, table 12), never the real rooms or systems. Content lives in private repos that the app syncs with. Test data in `tests/fixtures` is made up; keep it that way.
- Never push to `main`: it publishes straight to every phone. Push a branch and open a pull request; Mitch merges it. (If a pull request can't be opened from the session, give Mitch the `pull/new/<branch>` link.)
- Before pushing, run `node tests/run-all.mjs`. Everything must pass. See `tests/README.md` for what it covers and doesn't.
- To release: bump `VERSION` in `sw.js` and `app.version` in `js/main.js` so installed phones offer the update. Add any new app file to `SHELL` in `sw.js`.
- Accessibility target is WCAG 2.2 AA (details in `README.md`). Icon-only buttons need an `aria-label`. A new text or background color pairing goes in `tests/a11y/contrast.py`.
- A change to sync or merging gets a new scenario in `tests/sync.test.mjs`. Losing someone's count or edit is the worst bug this app can have. Anything that awaits GitHub must not overwrite what the phone changed in the meantime (see the snapshots in `syncOne`).
- Every value read from a synced file goes into the page through `esc()`, numbers included: the shared files can be edited by hand. `tests/count.test.mjs` checks the Count screens and `tests/maps.test.mjs` the floor plans; extend them when a screen starts showing shared data.
