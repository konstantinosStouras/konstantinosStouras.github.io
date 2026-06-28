/**
 * webrRunner.js
 *
 * Runs user-supplied R in the browser via WebR (R compiled to WebAssembly),
 * streams console output, and returns base graphics as PNG data URLs. Used by
 * the admin Data Analytics page so the R regression code can be edited and
 * "compiled" entirely client-side — no server, no Rscript install.
 *
 * Version pinned to a real published webr release (verified on the npm
 * registry; jsDelivr serves the ESM entry at
 * https://cdn.jsdelivr.net/npm/webr@<VERSION>/dist/webr.mjs). We try the current
 * version first, then recent same-API fallbacks, so a transient CDN gap degrades
 * gracefully instead of killing the R tab.
 *
 * Base R (stats + graphics) is enough for the analysis — lm(), summary(),
 * pairwise.t.test(), barplot()/plot()/arrows()/segments() all work with no
 * package install. Graphics capture needs OffscreenCanvas (standard in modern
 * browsers); without it, captureGraphics yields no images.
 *
 * Contract:
 *   runR(code, { dataCsv, onOutput }) -> { ok, output, images:[dataURL], error }
 *   - dataCsv is written to the virtual FS at /tmp/data.csv (read via read.csv).
 */

const WEBR_VERSIONS = ['0.6.0', '0.5.9', '0.4.4']

let _webRPromise = null

const esmUrl = v => `https://cdn.jsdelivr.net/npm/webr@${v}/dist/webr.mjs`
const baseUrl = v => `https://cdn.jsdelivr.net/npm/webr@${v}/dist/`

/** Import + init WebR exactly once; share the ready instance across runs. */
export function getWebR(onStatus) {
  if (_webRPromise) return _webRPromise

  _webRPromise = (async () => {
    let lastErr = null
    for (const v of WEBR_VERSIONS) {
      let webR
      try {
        if (onStatus) onStatus(`Loading R runtime (WebR v${v})… this is a large one-time download.`)
        const mod = await import(/* @vite-ignore */ esmUrl(v))
        const WebR = mod.WebR || (mod.default && mod.default.WebR)
        if (!WebR) throw new Error('WebR export not found in module')
        webR = new WebR({ baseUrl: baseUrl(v) })
        await webR.init()
        if (onStatus) onStatus('')
        return webR
      } catch (err) {
        lastErr = err
        // Tear down a half-initialised instance so a failed attempt doesn't leak a worker.
        if (webR && typeof webR.close === 'function') { try { webR.close() } catch (_) { /* ignore */ } }
      }
    }
    throw lastErr || new Error('WebR failed to load from all candidate versions.')
  })()

  _webRPromise.catch(() => { _webRPromise = null })
  return _webRPromise
}

/** Convert a captureR ImageBitmap to a PNG data URL via a canvas. */
async function bitmapToPngDataUrl(bitmap) {
  const w = bitmap.width
  const h = bitmap.height
  if (typeof OffscreenCanvas !== 'undefined') {
    const off = new OffscreenCanvas(w, h)
    off.getContext('2d').drawImage(bitmap, 0, 0)
    const blob = await off.convertToBlob({ type: 'image/png' })
    return await blobToDataUrl(blob)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  return canvas.toDataURL('image/png')
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
}

/** Buffer text into whole lines and emit each via onOutput. */
function makeLineStreamer(onOutput) {
  let buffer = ''
  return {
    push(text) {
      if (text == null) return
      buffer += text
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (typeof onOutput === 'function') onOutput(line)
      }
    },
    flush() {
      if (buffer.length) {
        if (typeof onOutput === 'function') onOutput(buffer)
        buffer = ''
      }
    },
  }
}

/**
 * Run user R with an optional CSV mounted at /tmp/data.csv, streaming output and
 * returning base-graphics images as PNG data URLs.
 * @param {string} code
 * @param {{dataCsv?:string, onOutput?:(line:string)=>void, onStatus?:(s:string)=>void, csvPath?:string}} opts
 * @returns {Promise<{ok:boolean, output:string, images:string[], error:string|null}>}
 */
export async function runR(code, { dataCsv, onOutput, onStatus, csvPath = '/tmp/data.csv' } = {}) {
  const lines = []
  const streamer = makeLineStreamer(line => {
    lines.push(line)
    if (typeof onOutput === 'function') onOutput(line)
  })

  let webR
  let shelter
  const images = []
  try {
    webR = await getWebR(onStatus)

    if (typeof dataCsv === 'string') {
      const dir = csvPath.slice(0, csvPath.lastIndexOf('/')) || '/'
      if (dir && dir !== '/') {
        try { await webR.FS.mkdir(dir) } catch (_) { /* already exists */ }
      }
      await webR.FS.writeFile(csvPath, new TextEncoder().encode(dataCsv))
    }

    shelter = await new webR.Shelter()
    const capture = await shelter.captureR(code, {
      withAutoprint: true,
      captureGraphics: true,
    })

    for (const evt of capture.output || []) {
      if (evt && (evt.type === 'stdout' || evt.type === 'stderr')) {
        streamer.push(evt.data + '\n')
      }
    }
    streamer.flush()

    if (Array.isArray(capture.images)) {
      for (const bmp of capture.images) {
        images.push(await bitmapToPngDataUrl(bmp))
        if (typeof bmp.close === 'function') bmp.close()
      }
    }
    return { ok: true, output: lines.join('\n'), images, error: null }
  } catch (err) {
    streamer.flush()
    return { ok: false, output: lines.join('\n'), images, error: err && err.message ? err.message : String(err) }
  } finally {
    if (shelter) {
      try { await shelter.purge() } catch (_) { /* ignore teardown errors */ }
    }
  }
}

export { WEBR_VERSIONS }
