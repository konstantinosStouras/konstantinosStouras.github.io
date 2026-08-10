/*
 * Offline unit tests for _chunked-json.mjs (no network). Run:
 *   node lit/_scraper/chunked-json-selftest.mjs
 */
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chunkPartPath, splitJsonPayloads, writeChunkedJson,
  readChunkedJson, readChunkedJsonSync,
} from './_chunked-json.mjs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };

const dir = mkdtempSync(join(tmpdir(), 'lit-chunks-'));

// part naming
ok(chunkPartPath('/x/papers-wp-arxiv.json', 1) === '/x/papers-wp-arxiv.json', 'part 1 keeps the name');
ok(chunkPartPath('/x/papers-wp-arxiv.json', 2) === '/x/papers-wp-arxiv-2.json', 'part 2 inserts -2');
ok(chunkPartPath('/x/_refs-cache.json', 3) === '/x/_refs-cache-3.json', 'cache part 3');

// payload splitting — arrays
const rows = Array.from({ length: 10 }, (_, i) => ({ id: i, pad: 'x'.repeat(50) }));
const oneArr = splitJsonPayloads(rows, 10 * 1024 * 1024);
ok(oneArr.length === 1 && JSON.stringify(JSON.parse(oneArr[0])) === JSON.stringify(rows), 'small array = single part, byte-faithful');
const manyArr = splitJsonPayloads(rows, 150);
ok(manyArr.length > 1, 'tight cap splits an array');
ok(manyArr.every(p => Buffer.byteLength(p, 'utf8') <= 150 + 2), 'every array part respects the cap');
ok(JSON.stringify(manyArr.flatMap(p => JSON.parse(p))) === JSON.stringify(rows), 'array parts reassemble in order');

// payload splitting — objects
const obj = Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['10.1/x' + i, { r: ['a', 'b'], t: '2026-08-10', v: 2 }]));
const manyObj = splitJsonPayloads(obj, 200);
ok(manyObj.length > 1, 'tight cap splits an object');
const reObj = {};
for (const p of manyObj) Object.assign(reObj, JSON.parse(p));
ok(JSON.stringify(reObj) === JSON.stringify(obj), 'object parts reassemble losslessly');

// JSON.stringify semantics
ok(splitJsonPayloads([1, undefined, 3])[0] === '[1,null,3]', 'undefined array element -> null');
ok(splitJsonPayloads({ a: 1, b: undefined })[0] === '{"a":1}', 'undefined object value drops its key');
ok(splitJsonPayloads([])[0] === '[]' && splitJsonPayloads({})[0] === '{}', 'empty data still writes a valid first part');

// write + read round-trip (array), then shrink and confirm stale parts vanish
const af = join(dir, 'papers-wp-test.json');
const bigRows = Array.from({ length: 200 }, (_, i) => ({ Title: 'Paper ' + i, pad: 'y'.repeat(80) }));
const written = await writeChunkedJson(af, bigRows, 4000);
ok(written.length > 1 && written[0] === af && written[1] === join(dir, 'papers-wp-test-2.json'), 'array write produces ordered parts');
ok(JSON.stringify(await readChunkedJson(af, [])) === JSON.stringify(bigRows), 'async chunked read reassembles the array');
ok(JSON.stringify(readChunkedJsonSync(af, [])) === JSON.stringify(bigRows), 'sync chunked read agrees');
const shrunk = bigRows.slice(0, 3);
const rewritten = await writeChunkedJson(af, shrunk, 4000);
ok(rewritten.length === 1, 'shrunken data writes a single part');
ok(!existsSync(join(dir, 'papers-wp-test-2.json')), 'stale higher parts are deleted');
ok(JSON.stringify(await readChunkedJson(af, [])) === JSON.stringify(shrunk), 'read after shrink sees only live rows');

// write + read round-trip (object cache)
const cf = join(dir, '_refs-cache.json');
const cache = Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['10.1287/x.' + i, { r: ['10.1/y' + i], t: '2026-08-10', v: 2 }]));
await writeChunkedJson(cf, cache, 4000);
ok(existsSync(join(dir, '_refs-cache-2.json')), 'object write chunks under a tight cap');
ok(JSON.stringify(readChunkedJsonSync(cf, {})) === JSON.stringify(cache), 'object cache round-trips');

// backward compatibility: a pre-chunking single file reads unchanged
const legacy = join(dir, 'legacy.json');
writeFileSync(legacy, JSON.stringify({ a: 1 }), 'utf8');
ok(JSON.stringify(await readChunkedJson(legacy, {})) === '{"a":1}', 'legacy single file reads as-is');
ok(JSON.stringify(await readChunkedJson(join(dir, 'missing.json'), { fb: 1 })) === '{"fb":1}', 'missing file returns the fallback');

// an oversized single element still writes (its own part) rather than throwing
const huge = [{ pad: 'z'.repeat(5000) }];
const hugeParts = await writeChunkedJson(join(dir, 'huge.json'), huge, 100);
ok(hugeParts.length === 1 && JSON.stringify(await readChunkedJson(join(dir, 'huge.json'), []))=== JSON.stringify(huge),
  'an element larger than the cap gets its own part');

rmSync(dir, { recursive: true, force: true });
console.log(`\nchunked-json-selftest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
