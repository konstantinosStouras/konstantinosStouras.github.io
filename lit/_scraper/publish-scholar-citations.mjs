// Publish only verified Scholar data on top of the latest remote master.
// An isolated index preserves the user's checkout, branch and staged changes.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LOCAL = path.join(ROOT, '.local-pop');
const DATA = 'lit/data/scholar-citations.json';
const INSTALL_FILES = [
  'lit/.gitignore', 'lit/_scraper/POP-CITATIONS.md',
  'lit/_scraper/pop-citations.mjs', 'lit/_scraper/pop-citations-selftest.mjs',
  'lit/_scraper/scholar-citations-selftest.mjs',
  'lit/_scraper/publish-scholar-citations.mjs', 'lit/_scraper/publish-scholar-selftest.mjs',
  'lit/_scraper/scholar-review-progress.json',
];
const normalizeDOI = value => String(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim().toLowerCase();
const json = text => JSON.parse(text.replace(/^\uFEFF/, ''));

export function mergeForPublication(published, local, known, today) {
  const result = { ...published };
  for (const [doi, entry] of Object.entries(local)) {
    if (!known.has(doi) || normalizeDOI(doi) !== doi || !Number.isSafeInteger(entry.count) || entry.count < 0 ||
        !/^\d+$/.test(entry.cluster) || typeof entry.cluster !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.checked) || entry.checked > today ||
        !entry.title || (entry.count === 0 && entry.method === 'publish-or-perish-doi-match') ||
        !['browser-verified', 'browser-verified-versions', 'publish-or-perish-doi-match'].includes(entry.method)) {
      throw new Error(`Invalid or unverified observation: ${doi}`);
    }
    const old = result[doi];
    if (old) {
      if (old.cluster !== entry.cluster) throw new Error(`Cluster conflict requires review: ${doi}`);
      if (old.checked === entry.checked && old.count !== entry.count) throw new Error(`Same-date count conflict requires review: ${doi}`);
      if (old.checked >= entry.checked) continue;
    }
    result[doi] = entry;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

export function installRenderer(remoteHTML, localHTML) {
  if (remoteHTML.includes('const scholarCitationsReady =')) return remoteHTML;
  const loader = localHTML.match(/\/\/ Verified Scholar observations[\s\S]+?\.catch\(function\(\) \{ scholarCitations = \{\}; \}\);/);
  const hook = localHTML.match(/function citedByTagHTML\(p\) \{\n([\s\S]*?)  if \(!\(Number\(p\['CitedBy'\]\) > 0\)\)/);
  if (!loader || !hook) throw new Error('Local renderer integration is missing');
  function insertOnce(text, anchor, replacement) {
    if (text.split(anchor).length !== 2) throw new Error(`Remote renderer anchor changed: ${anchor}`);
    return text.replace(anchor, replacement);
  }
  let output = insertOnce(remoteHTML, "const DATA_BASE = './data/';", "const DATA_BASE = './data/';\n\n" + loader[0]);
  output = insertOnce(output, 'async function loadData() {', 'async function loadData() {\n  await scholarCitationsReady;');
  output = insertOnce(output, 'function citedByTagHTML(p) {\n', 'function citedByTagHTML(p) {\n' + hook[1]);
  return output;
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true, ...options });
}
function remoteFile(base, name, optional = false) {
  if (optional) {
    try { git(['cat-file', '-e', `${base}:${name}`], { stdio: 'pipe' }); }
    catch { return null; }
  }
  return git(['show', `${base}:${name}`]);
}

function validateSnapshot(html, data, papersText) {
  const preview = path.join(LOCAL, 'publish-preview');
  fs.mkdirSync(preview, { recursive: true });
  fs.writeFileSync(path.join(preview, 'index.html'), html);
  fs.writeFileSync(path.join(preview, 'scholar-citations.json'), data);
  fs.writeFileSync(path.join(preview, 'papers-ms.json'), papersText);
  let scripts = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|application\/ld\+json|application\/json/i.test(match[1]) || !match[2].trim()) continue;
    new vm.Script(match[2]); scripts++;
  }
  const output = execFileSync(process.execPath, [path.join(ROOT, '_scraper/scholar-citations-selftest.mjs')], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, LIT_TEST_HTML: path.join(preview, 'index.html'), LIT_TEST_CITATIONS: path.join(preview, 'scholar-citations.json'), LIT_TEST_PAPERS: path.join(preview, 'papers-ms.json') },
  });
  console.log(output.trim(), `Parsed ${scripts} inline scripts in the publication snapshot.`);
}

async function main() {
  const install = process.argv.includes('--install');
  const push = process.argv.includes('--push');
  if (process.argv.slice(2).some(arg => !['--install', '--push'].includes(arg))) throw new Error('Supported flags: --install --push');
  fs.mkdirSync(LOCAL, { recursive: true });
  if (fs.existsSync(path.join(LOCAL, 'run.lock'))) throw new Error('Wait for the active citation collection run before publishing.');
  const lock = path.join(LOCAL, 'publish.lock');
  fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  const indexFile = path.join(LOCAL, `publish-index-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  try {
    const origin = git(['remote', 'get-url', '--push', 'origin']).trim();
    if (origin !== 'https://github.com/konstantinosStouras/konstantinosStouras.github.io.git') throw new Error('Unexpected publication repository.');
    const local = json(fs.readFileSync(path.join(ROOT, 'data/scholar-citations.json'), 'utf8'));
    for (let attempt = 0; attempt < 3; attempt++) {
      git(['fetch', 'origin', 'master']);
      const base = git(['rev-parse', 'origin/master']).trim();
      const papersText = remoteFile(base, 'lit/data/papers-ms.json');
      const known = new Set(json(papersText).map(p => normalizeDOI(p.DOI)));
      const prior = remoteFile(base, DATA, true);
      const merged = mergeForPublication(prior ? json(prior) : {}, local, known, new Date().toISOString().slice(0, 10));
      const data = JSON.stringify(merged, null, 2) + '\n';
      let html = remoteFile(base, 'lit/index.html');
      if (install) html = installRenderer(html, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replaceAll('\r\n', '\n'));
      if (!html.includes('const scholarCitationsReady =')) throw new Error('Scholar renderer is not installed on the published branch.');
      validateSnapshot(html, data, papersText);
      const contents = new Map([[DATA, data]]);
      if (install) {
        contents.set('lit/index.html', html);
        for (const name of INSTALL_FILES) {
          const content = fs.readFileSync(path.join(ROOT, name.slice(4)), 'utf8').replaceAll('\r\n', '\n');
          if (name === 'lit/.gitignore') {
            const existing = remoteFile(base, name, true) || '';
            contents.set(name, existing.includes('.local-pop/') ? existing : existing + '\n' + content);
          } else contents.set(name, content);
        }
      }
      git(['read-tree', base], { env });
      for (const [name, content] of contents) {
        const blob = git(['hash-object', '-w', '--stdin'], { input: content }).trim();
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${name}`], { env });
      }
      const tree = git(['write-tree'], { env }).trim();
      if (tree === git(['rev-parse', `${base}^{tree}`]).trim()) { console.log('No unpublished citation changes.'); return; }
      const files = git(['diff-tree', '--no-commit-id', '--name-only', '-r', base, tree]).trim().split('\n');
      if (files.some(name => !contents.has(name))) throw new Error('Unexpected file in publication tree.');
      git(['diff', '--check', base, tree]);
      const plan = { base, tree, files, verifiedCounts: Object.keys(merged).length, preparedAt: new Date().toISOString() };
      fs.writeFileSync(path.join(LOCAL, 'publish-plan.json'), JSON.stringify(plan, null, 2) + '\n');
      console.log(JSON.stringify(plan));
      if (!push) return;
      const commit = git(['commit-tree', tree, '-p', base], { input: install ? 'Publish verified Google Scholar citation counts in Lit\n' : 'lit: refresh verified Google Scholar citation counts\n' }).trim();
      try { git(['push', 'origin', `${commit}:refs/heads/master`]); }
      catch (error) {
        // Rebuild on the latest remote parent; never force-push or reset the user's branch.
        git(['fetch', 'origin', 'master']);
        let accepted = false;
        try { git(['merge-base', '--is-ancestor', commit, 'origin/master'], { stdio: 'pipe' }); accepted = true; } catch {}
        // Handles an uncertain push response after the server accepted the commit.
        if (!accepted) {
          if (git(['rev-parse', 'origin/master']).trim() !== base && attempt < 2) continue;
          throw error;
        }
      }
      fs.writeFileSync(path.join(LOCAL, 'last-publish.json'), JSON.stringify({ ...plan, commit, publishedAt: new Date().toISOString() }, null, 2) + '\n');
      console.log(`Published ${commit}`);
      return;
    }
    throw new Error('Remote changed repeatedly; retry publishing on the next scheduled run.');
  } finally {
    if (fs.existsSync(indexFile)) fs.unlinkSync(indexFile);
    fs.unlinkSync(lock);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
