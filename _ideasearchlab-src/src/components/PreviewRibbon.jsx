import { isPreview } from '../utils/preview'

// A constant, unmissable reminder that this tab is a throwaway test sandbox and
// nothing is being saved. Rendered once (App) and only when ?preview=1&key=… is
// active, so it never appears in a real session.
export default function PreviewRibbon() {
  if (!isPreview()) return null
  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: '#b26a00', color: '#fff', textAlign: 'center',
        padding: '7px 14px', fontSize: 13, letterSpacing: '0.01em',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.18)', pointerEvents: 'none',
      }}
    >
      <span aria-hidden="true">🧪 </span>
      <strong>Test mode</strong> — this is a private sandbox. Nothing you do here is saved.
    </div>
  )
}
