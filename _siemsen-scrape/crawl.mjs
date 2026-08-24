// One-off crawl of omlist.edutool.org school pages: for each school in
// schools.json, read the department rows (name + the external link to the
// university's own department page) and write results.json beside it.
// Runs on the GitHub Actions runners because this task's build environment
// has no egress to the site. Underscore directory, so Jekyll never serves it.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

// Each department renders as a `dept-row` div holding an <h6> with the
// department name and a `department-sources` div whose first <a> is the
// link to the department on the university's own website.
export function parseDepartments(html) {
  const out = [];
  for (const chunk of html.split(/class="[^"]*\bdept-row\b/).slice(1)) {
    const h = chunk.match(/<h6[^>]*>([\s\S]*?)<\/h6>/);
    if (!h) continue;
    const name = decode(h[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    const links = [];
    const src = chunk.match(/class="department-sources[\s\S]*?<\/div>/);
    if (src) for (const m of src[0].matchAll(/<a\s[^>]*href="([^"]+)"/g)) links.push(decode(m[1]));
    out.push({ name, links });
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const here = new URL('.', import.meta.url);
  const schools = JSON.parse(readFileSync(new URL('schools.json', here), 'utf8'));
  const results = [];
  for (const s of schools) {
    const row = { slug: s.slug, uni: s.uni, url: s.url, status: 0, departments: [] };
    try {
      const res = await fetch(s.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) siemsen-scrape/1.0 (one-off; kstouras@gmail.com)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      row.status = res.status;
      if (res.ok) row.departments = parseDepartments(await res.text());
    } catch (e) {
      row.error = String(e && e.message || e);
    }
    results.push(row);
    console.log(`${row.status} ${s.slug} -> ${row.departments.length} dept(s)`);
    await sleep(400);
  }
  writeFileSync(new URL('results.json', here), JSON.stringify(results, null, 1));
  const bad = results.filter((r) => r.status !== 200);
  console.log(`done: ${results.length} pages, ${bad.length} non-200`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
