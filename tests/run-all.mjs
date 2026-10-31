// Runs every test: node tests/run-all.mjs
// Node 20 or newer. The two Python checks run if python3 is installed; the markup check also
// needs lxml (pip install lxml) and is skipped without it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'the-sheet-test-'));
const env = (extra) => Object.assign({}, process.env, { THE_SHEET_TEST_OUT: out }, extra || {});
const results = [];

function step(label, cmd, args, opts = {}) {
  console.log('\n\n######## ' + label);
  const r = spawnSync(cmd, args, Object.assign({ stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', env: env(opts.env), encoding: 'utf8' }, {}));
  if (r.error && r.error.code === 'ENOENT') { results.push([label, 'skipped (' + cmd + ' not found)']); return null; }
  const status = r.status === 0 ? 'passed' : r.status === 2 ? 'skipped' : 'FAILED';
  results.push([label, status]);
  return r;
}

const node = process.execPath;
// Sync runs in three time zones, including the two furthest from UTC, to catch date bugs.
for (const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) step('Sync, ' + tz, node, [path.join(HERE, 'sync.test.mjs')], { env: { TZ: tz } });
step('Order amounts, shared text', node, [path.join(HERE, 'count.test.mjs')]);
step('Saves when the app goes to the background', node, [path.join(HERE, 'background.test.mjs')]);
step('Backups leave out daily and personal data', node, [path.join(HERE, 'backup.test.mjs')]);
step('Offline files; nothing loaded from outside', node, [path.join(HERE, 'offline.test.mjs')]);
step('Floor plans', node, [path.join(HERE, 'maps.test.mjs')]);
step('Every screen draws', node, [path.join(HERE, 'shell.test.mjs')]);
step('Tap-twice confirm', node, [path.join(HERE, 'confirm.test.mjs')]);
const r = step('Draw screens for the markup check', node, [path.join(HERE, 'a11y', 'render.mjs')], { capture: true });
const drawn = r && r.status === 0 ? r.stdout.trim().split('\n').pop() : null;
if (drawn) step('Markup (labels, names, headings)', 'python3', [path.join(HERE, 'a11y', 'markup.py'), drawn]);
step('Color contrast', 'python3', [path.join(HERE, 'a11y', 'contrast.py')]);

console.log('\n\n######## Summary');
for (const [label, status] of results) console.log((status === 'FAILED' ? '  ✗ ' : status.startsWith('skipped') ? '  – ' : '  ✓ ') + label.padEnd(44) + status);
const failed = results.some(([, s]) => s === 'FAILED');
if (failed) console.log('\nScratch files kept for a look: ' + out);
else fs.rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
