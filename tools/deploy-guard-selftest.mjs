#!/usr/bin/env node
/* ==========================================================================
   tools/deploy-guard-selftest.mjs
   Every Firebase project in this repository must refuse a deploy aimed at
   another one.

   WHY, and it is not hypothetical — it has happened twice, to the same
   victim. This repository holds six unrelated Firebase projects and the
   sibling OperationsAcademia.github.io holds a seventh. The Firebase CLI
   resolves the target from, in order: the --project flag, the
   FIREBASE_PROJECT env var, the "active project" it remembers PER DIRECTORY
   in its own global config, and only then the default alias in .firebaserc.
   The remembered one wins over .firebaserc, is invisible in the repository,
   and survives between sessions. So `firebase deploy --only firestore:rules`
   run in one project's folder can publish that folder's rules into another
   project's database and print "Deploy complete!".

   Both times the victim was Answer Arena — once from lab/search-v2, once
   from OperationsAcademia.github.io, whose rules end in a deny-all catch-all
   and name none of Answer Arena's collections, so every read and write in
   that app was refused until its own rules were re-published.

   `check-project.mjs` in each folder is the guard: the CLI exports
   GCLOUD_PROJECT to a predeploy hook, so the target is knowable before
   anything is uploaded. This check makes sure no folder is left without one,
   and that no deployable section of a firebase.json is left un-hooked — a
   guard that covers `firestore` but not `functions` still lets a Functions
   deploy land in the wrong project.

   Offline. No network, no Firebase CLI.

       node tools/deploy-guard-selftest.mjs
   ========================================================================== */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Sections of a firebase.json that DEPLOY something into a project. A hook on
   each is what makes the guard total: `firebase deploy` with no --only runs
   every one of them. `emulators` is local-only and needs none. */
const DEPLOYABLE = ['firestore', 'functions', 'hosting', 'storage', 'database'];
const HOOK = 'check-project.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', '_backups', 'back up', 'dist']);

let pass = 0;
const fails = [];
const ok = (cond, what) => (cond ? pass++ : fails.push(what));

/** Every directory holding a firebase.json — the deployable units. */
function units(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name.charAt(0) === '.' || SKIP_DIRS.has(e.name)) continue;
      units(path.join(dir, e.name), out);
    } else if (e.name === 'firebase.json') {
      out.push(dir);
    }
  }
  return out;
}

const found = units(ROOT);
ok(found.length > 0, 'at least one Firebase project is configured in this repository');

const projects = new Map();

for (const unit of found) {
  const rel = path.relative(ROOT, unit) || '.';

  /* THE PROJECT IT BELONGS TO. Without a default alias the guard has nothing
     to compare against and the CLI has nothing to fall back on. */
  const rcPath = path.join(unit, '.firebaserc');
  ok(existsSync(rcPath), `${rel}: has a .firebaserc naming its project`);
  if (!existsSync(rcPath)) continue;
  let project = '';
  try {
    project = JSON.parse(readFileSync(rcPath, 'utf8')).projects.default || '';
  } catch { /* reported below */ }
  ok(!!project, `${rel}: .firebaserc names a default project`);
  if (!project) continue;

  /* TWO FOLDERS SHARING A PROJECT would make the guard meaningless between
     them — each would happily deploy the other's files. */
  ok(!projects.has(project),
    `${rel}: is the only folder deploying to ${project}` +
    (projects.has(project) ? ` (also ${projects.get(project)})` : ''));
  projects.set(project, rel);

  /* THE GUARD ITSELF, beside the config or in the tools/ directory beside it
     (lab/search-v2 keeps its own there, and keeps working). */
  const guard = [path.join(unit, HOOK), path.join(unit, 'tools', HOOK)]
    .find((p) => existsSync(p));
  ok(!!guard, `${rel}: carries ${HOOK}`);
  if (!guard) continue;

  const src = readFileSync(guard, 'utf8');
  ok(src.includes('GCLOUD_PROJECT'),
    `${rel}: reads the project the CLI is actually deploying to`);
  ok(src.includes('process.exit(1)'),
    `${rel}: exits non-zero on a mismatch, which is what aborts the deploy`);
  /* It must compare against .firebaserc rather than a literal: a hardcoded id
     is a second place for the truth to live, and it would go stale silently. */
  ok(src.includes('.firebaserc'),
    `${rel}: takes the expected project from .firebaserc, not from a literal`);
  ok(!src.includes(`'${project}'`) && !src.includes(`"${project}"`),
    `${rel}: does not hardcode ${project}`);

  /* EVERY DEPLOYABLE SECTION HOOKED. A guard on the rules alone still lets
     `firebase deploy` put this folder's Functions in another project. */
  const cfg = JSON.parse(readFileSync(path.join(unit, 'firebase.json'), 'utf8'));
  const hookRel = path.relative(unit, guard).split(path.sep).join('/');
  for (const section of DEPLOYABLE) {
    if (!cfg[section] || typeof cfg[section] !== 'object') continue;
    const pre = [].concat(cfg[section].predeploy || []);
    ok(pre.some((c) => String(c).includes(hookRel)),
      `${rel}: its ${section} deploy runs the guard first`);
  }

  /* THE RUNTIME THE DEPLOY WOULD ACTUALLY USE. The CLI resolves it as
     `runtimeFromConfig || engines.node` (getRuntimeChoice in firebase-tools)
     — a `runtime` field in firebase.json wins OUTRIGHT over the package's own
     engines. That is how lit's config kept "nodejs20" straight through the
     2026-08-30 engines 20 -> 22 upgrade: the next deploy would have printed
     "Deploy complete!" and shipped Node 20 with engines reading 22, and only
     `firebase functions:list` would ever have said so. Two files stating one
     fact are pinned against each other here, both ways. */
  if (cfg.functions && typeof cfg.functions === 'object') {
    const srcDir = path.join(unit, cfg.functions.source || 'functions');
    const pkgPath = path.join(srcDir, 'package.json');
    ok(existsSync(pkgPath), `${rel}: its functions source carries a package.json`);
    if (existsSync(pkgPath)) {
      let engines = '';
      try {
        engines = (JSON.parse(readFileSync(pkgPath, 'utf8')).engines || {}).node || '';
      } catch { /* reported below */ }
      ok(!!engines, `${rel}: its functions package.json declares engines.node`);
      const pinned = cfg.functions.runtime || '';
      if (pinned && engines) {
        ok(pinned === `nodejs${engines}`,
          `${rel}: firebase.json pins runtime ${pinned} while its package.json` +
          ` says engines.node ${engines} — the config field overrides engines` +
          ` outright, so the deploy would ship ${pinned} whatever the package says`);
      }
    }
  }
}

if (fails.length) {
  console.error(`\n${fails.length} FAILED, ${pass} passed\n`);
  for (const f of fails) console.error('  FAIL  ' + f);
  process.exit(1);
}
console.log(`deploy-guard: ${pass} checks passed across ${found.length} Firebase project(s)`);
