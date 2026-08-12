/* Simulation Platform — offline guard for the roster's "Verify from …" buttons.
   No network, no browser: loads catalog.js + admin/verify.js against a tiny
   window shim and checks the two halves still fit together.

   The admin panel renders one Verify button per ACTIVE simulation whose
   catalog entry declares a `verify` block, and dispatches it to the adapter
   named there. Those two files are edited independently (a new simulation is a
   catalog entry + an adapter), so this asserts:
     · every declared adapter exists in window.SIMP_VERIFY, and vice versa;
     · every verifiable simulation has a Firebase web config to read with —
       inline, or the global its config file publishes;
     · the simulations that deliberately collect nothing identifiable still
       declare no verify block (so no button can appear for them).

   Run: node simulation/tools/verify-guard.mjs
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIM = join(HERE, '..');

/* Simulations that must NEVER get a Verify button — nothing identifiable to
   reconcile against. Keep in sync with the catalog's own comment. */
const NO_IDENTITY = {
  'problem-solving': 'writes to a Google Sheet, no participant identity',
  ssc: 'team/firm decisions, no student ID',
  newsvendor: 'hosted cross-origin in another project',
  jagged: 'collects nothing at all'
};

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log('  ok — ' + msg);
  else { fails++; console.log('  FAIL — ' + msg); }
}

/* catalog.js / verify.js are plain browser scripts that assign to window. */
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of [join(SIM, 'catalog.js'), join(SIM, 'admin', 'verify.js')]) {
  vm.runInContext(readFileSync(f, 'utf8'), sandbox, { filename: f });
}
const CATALOG = sandbox.window.SIMP_CATALOG;
const ADAPTERS = sandbox.window.SIMP_VERIFY;

console.log('Simulation Platform — verify-button guard\n');
ok(Array.isArray(CATALOG) && CATALOG.length > 0, 'catalog.js defines SIMP_CATALOG');
ok(ADAPTERS && typeof ADAPTERS === 'object', 'admin/verify.js defines SIMP_VERIFY');

const verifiable = CATALOG.filter(s => s.verify);
ok(verifiable.length > 0, 'at least one simulation declares a verify block');

for (const s of verifiable) {
  const v = s.verify;
  ok(typeof ADAPTERS[v.adapter] === 'function',
     s.key + ': its adapter "' + v.adapter + '" exists in SIMP_VERIFY');
  /* Answer Arena publishes its config as its own file (loaded by the admin
     page as window.ARENA_FIREBASE); the others carry a copy in the catalog. */
  const inline = v.config && v.config.apiKey;
  ok(!!inline || !!v.configGlobal,
     s.key + ': has a Firebase web config (inline or via ' + (v.configGlobal || 'a global') + ')');
  if (inline) {
    ok(!!v.config.projectId && v.config.apiKey.indexOf('PASTE_') !== 0 &&
       v.config.apiKey.indexOf('REPLACE') !== 0,
       s.key + ': its inline config is a real project, not a placeholder');
  }
  ok(typeof v.idNote === 'string' && v.idNote.length > 10,
     s.key + ': documents what the student-ID join reads (idNote → button tooltip)');
  ok(!NO_IDENTITY[s.key],
     s.key + ': is not one of the simulations documented as collecting no identity');
}

/* Reverse direction: an adapter with no catalog entry is dead code (or a key
   typo, which would silently mean "no button"). */
for (const key of Object.keys(ADAPTERS)) {
  ok(verifiable.some(s => s.verify.adapter === key),
     'adapter "' + key + '" is claimed by a catalog entry');
}

for (const [key, why] of Object.entries(NO_IDENTITY)) {
  const s = CATALOG.find(x => x.key === key);
  ok(!s || !s.verify, key + ': still has no verify block (' + why + ')');
}

/* The inline copies must match the app's own config file — that is the drift
   this guard exists for. */
const SOURCES = {
  ideasearchlab: ['_ideasearchlab-src/src/firebase.js'],
  portfoliofit: ['lab/portfoliofit/experiment.js'],
  'search-v2': ['lab/search-v2/firebase-config.js']
};
for (const [key, files] of Object.entries(SOURCES)) {
  const s = CATALOG.find(x => x.key === key);
  if (!s || !s.verify || !s.verify.config) continue;
  const src = files.map(f => readFileSync(join(SIM, '..', f), 'utf8')).join('\n');
  ok(src.includes(s.verify.config.apiKey) && src.includes(s.verify.config.projectId),
     key + ': the catalog’s copy of the web config still matches ' + files.join(', '));
}

console.log('\n' + (fails ? 'GUARD FAILED — ' + fails + ' of ' + checks + ' checks'
                          : 'GUARD OK — ' + checks + ' checks'));
process.exit(fails ? 1 : 0);
