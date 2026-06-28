/**
 * pyodideRunner.js
 *
 * Runs user-supplied Python in the browser via Pyodide (CPython compiled to
 * WebAssembly), streams stdout+stderr, and harvests every open matplotlib
 * figure as a base64 PNG data URL. Used by the admin Data Analytics page so the
 * regression code can be edited and "compiled" entirely client-side — no server.
 *
 * Versions are pinned to real published Pyodide releases (verified on the npm
 * registry; jsDelivr mirrors every Pyodide GitHub release at
 * https://cdn.jsdelivr.net/pyodide/v<VERSION>/full/). Pyodide moved off the old
 * 0.x scheme to large numeric tags (… 0.29.4 → 314.0.0 → 314.0.1). We try the
 * current tag first and fall back to recent same-API releases if a CDN asset is
 * ever unavailable, so the page degrades gracefully instead of dying outright.
 *
 * numpy / pandas / scipy / statsmodels / matplotlib all ship in the Pyodide
 * package set (loadPackage); a micropip fallback covers any that are missing.
 *
 * Contract:
 *   runPython(code, { dataCsv, onStdout }) -> { ok, stdout, images:[dataURL], error }
 *   - dataCsv is exposed to Python as the global string DATA_CSV.
 */

// Current tag first, then recent fallbacks (identical loadPyodide/loadPackage/
// setStdout/runPythonAsync API across all of these).
const PYODIDE_VERSIONS = ['314.0.1', '0.29.4', '0.28.3']

const REQUIRED_PACKAGES = ['numpy', 'pandas', 'scipy', 'statsmodels', 'matplotlib']

const scriptUrl = v => `https://cdn.jsdelivr.net/pyodide/v${v}/full/pyodide.js`
const baseUrl = v => `https://cdn.jsdelivr.net/pyodide/v${v}/full/`

let _pyodidePromise = null

/** Inject a CDN <script> once per URL; resolve when globalThis.loadPyodide is ready. */
function injectScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-pyodide-src="${url}"]`)
    if (existing) {
      // Trust a cached tag only if the global it should define is actually
      // present. A previous failed attempt may have deleted globalThis.loadPyodide,
      // leaving a resolved-but-stale tag that would otherwise short-circuit to a
      // no-op and wedge every retry. In that case drop it and re-inject fresh.
      if (existing.dataset.loaded === '1' && typeof globalThis.loadPyodide === 'function') return resolve()
      if (existing.dataset.loaded === '1') {
        existing.remove()
      } else {
        existing.addEventListener('load', () => resolve())
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)))
        return
      }
    }
    const s = document.createElement('script')
    s.src = url
    s.async = true
    s.crossOrigin = 'anonymous'
    s.dataset.pyodideSrc = url
    s.onload = () => { s.dataset.loaded = '1'; resolve() }
    s.onerror = () => reject(new Error(`Failed to load ${url} (CDN / network / CSP?)`))
    document.head.appendChild(s)
  })
}

/**
 * Load the Pyodide runtime exactly once (shared across calls) and ensure the
 * scientific packages are present. Tries each candidate version until one works.
 */
export async function getPyodide(onStatus) {
  if (_pyodidePromise) return _pyodidePromise

  _pyodidePromise = (async () => {
    let lastErr = null
    for (const v of PYODIDE_VERSIONS) {
      try {
        if (onStatus) onStatus(`Loading Python runtime (Pyodide v${v})…`)
        await injectScript(scriptUrl(v))
        // indexURL must match the injected pyodide.js version or asset fetches 404.
        const pyodide = await globalThis.loadPyodide({ indexURL: baseUrl(v) })
        if (onStatus) onStatus('Loading data-science packages (pandas, statsmodels, matplotlib)…')
        await ensurePackages(pyodide)
        if (onStatus) onStatus('')
        return pyodide
      } catch (err) {
        lastErr = err
        // Clear the global so the next candidate's script can redefine it, and
        // drop this version's (possibly resolved-but-now-stale) script tag so a
        // later retry re-executes it instead of short-circuiting to a no-op.
        try { delete globalThis.loadPyodide } catch (_) { /* non-configurable; ignore */ }
        document.querySelector(`script[data-pyodide-src="${scriptUrl(v)}"]`)?.remove()
      }
    }
    throw lastErr || new Error('Pyodide failed to load from all candidate versions.')
  })()

  // Don't cache a rejection forever — let a later call retry.
  _pyodidePromise.catch(() => { _pyodidePromise = null })
  return _pyodidePromise
}

async function ensurePackages(pyodide) {
  try {
    await pyodide.loadPackage(REQUIRED_PACKAGES)
    return
  } catch (_) {
    // Isolate the missing one(s) and micropip them.
  }
  const fallback = []
  for (const name of REQUIRED_PACKAGES) {
    try { await pyodide.loadPackage(name) } catch (_) { fallback.push(name) }
  }
  if (fallback.length) {
    await pyodide.loadPackage('micropip')
    const micropip = pyodide.pyimport('micropip')
    for (const name of fallback) await micropip.install(name)
  }
}

// Force a non-interactive backend BEFORE any plotting (recent Pyodide defaults
// matplotlib to interactive "webagg", which has no savefig-able offscreen canvas).
const MPL_BACKEND_SNIPPET = `
import os as __os
__os.environ.setdefault("MPLBACKEND", "Agg")
try:
    import matplotlib
    matplotlib.use("Agg", force=True)
except Exception:
    pass
`

// Appended AFTER the user code: harvest every open figure as a PNG data URL,
// then close them so memory doesn't accumulate across runs in the long-lived
// runtime. Hard-left-margined so it is always valid top-level Python.
const FIGURE_HARVEST_SNIPPET = `
def __collect_figures():
    import io, base64
    try:
        import matplotlib
        import matplotlib.pyplot as plt
    except Exception:
        return []
    out = []
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
        buf.seek(0)
        out.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"))
        buf.close()
    plt.close("all")
    return out

__pyo_images = __collect_figures()
`

/**
 * Run user Python with CSV injected, stdout/stderr streamed, figures harvested.
 * @param {string} code
 * @param {{dataCsv?:string, onStdout?:(line:string)=>void, onStatus?:(s:string)=>void}} opts
 * @returns {Promise<{ok:boolean, stdout:string, images:string[], error:string|null}>}
 */
export async function runPython(code, { dataCsv = '', onStdout, onStatus } = {}) {
  const pyodide = await getPyodide(onStatus)

  const collected = []
  const emit = chunk => {
    const text = String(chunk)
    collected.push(text)
    if (typeof onStdout === 'function') {
      for (const part of text.split('\n')) onStdout(part)
    }
  }

  pyodide.setStdout({ batched: emit })
  pyodide.setStderr({ batched: emit })
  pyodide.globals.set('DATA_CSV', dataCsv)

  let ok = true
  let error = null
  let images = []
  try {
    await pyodide.runPythonAsync(`${MPL_BACKEND_SNIPPET}\n${code}\n${FIGURE_HARVEST_SNIPPET}`)
    const pyImages = pyodide.globals.get('__pyo_images')
    if (pyImages) {
      try { images = pyImages.toJs() } finally { pyImages.destroy() }
    }
  } catch (e) {
    ok = false
    error = e && e.message ? e.message : String(e)
    emit(error)
  } finally {
    // No-arg form restores Pyodide's default streams (an empty object would
    // install a do-nothing handler instead of truly resetting).
    pyodide.setStdout()
    pyodide.setStderr()
    try {
      pyodide.runPython("for __n in ('DATA_CSV','__pyo_images'):\n    globals().pop(__n, None)\n")
    } catch (_) { /* ignore cleanup errors */ }
  }

  return { ok, stdout: collected.join('\n'), images, error }
}

export { PYODIDE_VERSIONS, REQUIRED_PACKAGES }
