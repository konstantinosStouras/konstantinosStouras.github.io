# Vendored runtime

`index.js`, `sqlite.worker.js`, and `sql-wasm.wasm` are vendored verbatim from
**[phiresky/sql.js-httpvfs](https://github.com/phiresky/sql.js-httpvfs)** v0.8.12
(the `dist/` files), licensed **Apache-2.0**. They provide `createDbWorker`,
which runs SQLite (WASM) in a Web Worker and reads a remote `.db` over HTTP Range
requests via synchronous XHR — no `SharedArrayBuffer`, so no COOP/COEP headers
are required (works on GitHub Pages as-is).

`lit-query.js` is our own code (translates the page's filter state into SQL); it
is not part of the vendored package.

To refresh the vendored files:

```
curl -sSL https://registry.npmjs.org/sql.js-httpvfs/-/sql.js-httpvfs-0.8.12.tgz | tar -xz
cp package/dist/{index.js,sqlite.worker.js,sql-wasm.wasm} lit/sqlite/
```
