// chunk-db.mjs — split a lit.db into < 100 MB parts for GitHub Pages, which
// rejects any single file over 100 MB. sql.js-httpvfs `serverMode: "chunked"`
// then reads sub-ranges within each chunk file (Pages honors Range), so the
// client still fetches only the pages a query touches — chunking is purely to
// clear the per-file limit, not a change in access pattern.
//
//   node lit/_scraper/chunk-db.mjs <lit.db> <outDir> [chunkBytes]
//
// Emits <outDir>/lit.db.000, .001, … (zero-padded to suffixLength) plus
// <outDir>/lit-db.json (the manifest the page reads to configure the loader:
// serverChunkSize, databaseLengthBytes, suffixLength, chunks, base, sha).
// The chunk size is floored to a multiple of the 8192 SQLite page size so a
// page (and thus every Range read) never straddles a chunk boundary.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const PAGE = 8192;

// Split dbPath into <outDir>/lit.db.NNN chunks + lit-db.json manifest.
// Returns the manifest. chunkBytes is floored to a multiple of PAGE (so a page
// never straddles a chunk) and capped well under GitHub's 100 MB per-file limit.
export function chunkDb(dbPath, outDir, chunkBytes) {
  let serverChunkSize = chunkBytes ? parseInt(chunkBytes, 10) : 40 * 1024 * 1024;
  serverChunkSize = Math.floor(serverChunkSize / PAGE) * PAGE;
  if (serverChunkSize < PAGE) serverChunkSize = PAGE;
  const CAP = Math.floor(90 * 1024 * 1024 / PAGE) * PAGE;
  if (serverChunkSize > CAP) serverChunkSize = CAP;

  const size = fs.statSync(dbPath).size;
  const chunks = Math.max(1, Math.ceil(size / serverChunkSize));
  const suffixLength = Math.max(3, String(chunks - 1).length);
  const base = 'lit.db.';

  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (/^lit\.db\.\d+$/.test(f)) fs.rmSync(path.join(outDir, f));

  const fd = fs.openSync(dbPath, 'r');
  const buf = Buffer.alloc(serverChunkSize);
  for (let i = 0; i < chunks; i++) {
    const off = i * serverChunkSize;
    const len = Math.min(serverChunkSize, size - off);
    fs.readSync(fd, buf, 0, len, off);
    fs.writeFileSync(path.join(outDir, base + String(i).padStart(suffixLength, '0')), buf.subarray(0, len));
  }
  fs.closeSync(fd);

  const sha = fs.existsSync(dbPath + '.sha') ? fs.readFileSync(dbPath + '.sha', 'utf8').trim() : '';
  const manifest = { serverChunkSize, databaseLengthBytes: size, suffixLength, chunks, base, sha };
  fs.writeFileSync(path.join(outDir, 'lit-db.json'), JSON.stringify(manifest) + '\n');
  return manifest;
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  const [dbPath, outDir, chunkArg] = process.argv.slice(2);
  if (!dbPath || !outDir) { console.error('usage: node chunk-db.mjs <lit.db> <outDir> [chunkBytes]'); process.exit(1); }
  const m = chunkDb(dbPath, outDir, chunkArg);
  console.log(`chunked ${dbPath} (${(m.databaseLengthBytes / 1e6).toFixed(0)} MB) → ${m.chunks} × ≤${(m.serverChunkSize / 1e6).toFixed(0)} MB in ${outDir}/  (suffixLength ${m.suffixLength})`);
}
