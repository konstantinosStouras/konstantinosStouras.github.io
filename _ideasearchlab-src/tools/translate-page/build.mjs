/**
 * Builds the translate-page harness: the admin Data Analytics page on its own,
 * with every Firebase import resolved to ./stubs. Used by ../translate-page-guard.mjs;
 * runnable alone to inspect the bundle:
 *
 *   node _ideasearchlab-src/tools/translate-page/build.mjs [outDir]
 *
 * The bundle goes to the OS temp dir by default — it is a test fixture, never
 * something to commit or deploy.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../../src')
const STUBS = join(HERE, 'stubs')
const SRC_FIREBASE = join(SRC, 'firebase.js')

const PACKAGE_STUBS = {
  'firebase/app': join(STUBS, 'firebase-app.js'),
  'firebase/auth': join(STUBS, 'firebase-auth.js'),
  'firebase/firestore': join(STUBS, 'firebase-firestore.js'),
  'firebase/functions': join(STUBS, 'firebase-functions.js'),
}

// Resolve every Firebase import (the SDK packages AND the app's own src/firebase.js,
// which would call initializeApp against the live project) to a stub.
function stubFirebase() {
  return {
    name: 'harness-stub-firebase',
    enforce: 'pre',
    resolveId(source, importer) {
      if (PACKAGE_STUBS[source]) return PACKAGE_STUBS[source]
      if (/^firebase(\/|$)/.test(source)) {
        this.error(`harness: unexpected Firebase import "${source}" from ${importer} — add a stub for it`)
      }
      if (importer && source.startsWith('.') && /firebase(\.js)?$/.test(source)) {
        const abs = resolve(dirname(importer), source)
        if (abs === SRC_FIREBASE || `${abs}.js` === SRC_FIREBASE) return join(STUBS, 'firebase.js')
      }
      return null
    },
  }
}

export async function buildHarness(outDir = join(tmpdir(), 'isl-translate-page-harness')) {
  // Resolve vite + the React plugin from the app's own node_modules.
  const { build } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  await build({
    configFile: false,
    root: HERE,
    base: '/',
    logLevel: 'error',
    plugins: [react(), stubFirebase()],
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      target: 'es2020',
      reportCompressedSize: false,
      chunkSizeWarningLimit: 100000,
    },
  })
  return outDir
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const out = await buildHarness(process.argv[2])
  console.log('built', out)
}
