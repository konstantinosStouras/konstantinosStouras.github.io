/**
 * phase-restore-guard.mjs — offline test (no network, no deps).
 *
 *   node _ideasearchlab-src/tools/phase-restore-guard.mjs
 *
 * Refreshing a phase page must never flash the INSTRUCTIONS screen (with its
 * Start button) at a participant who is already past it.
 *
 * Owner report 2026-08: refreshing on the "Your ideas are submitted" summary
 * showed the "Individual Ideation Phase" instructions with a Start button for a
 * moment first. Cause: `started` and `done` are both restored FROM the
 * participant document, and until its first `onSnapshot` lands they are both
 * false — which is exactly the state that renders the instructions. So the page
 * confidently drew a screen it had no evidence for.
 *
 * The fix is an ordering, and an ordering is what this pins:
 *   1. the participant listener sets `participantLoaded` BEFORE bailing on a
 *      missing document (else a participant with no doc waits forever), and
 *   2. the `!participantLoaded` early return comes BEFORE the `!started`
 *      instructions branch (else the gate is dead code).
 *
 * It is a source check rather than a browser one on purpose: reproducing it at
 * runtime needs a participant who submitted in a PREVIOUS page load, and the
 * preview sandbox's store lives in memory for the lifetime of the tab — a
 * reload wipes the very document whose absence is the bug.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'pages')

let failures = 0
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); return }
  failures++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

for (const file of ['IndividualPhase.jsx', 'GroupPhase.jsx']) {
  console.log(`\n${file}`)
  const src = readFileSync(join(SRC, file), 'utf8')

  const at = needle => src.indexOf(needle)
  const loaded = at('setParticipantLoaded(true)')
  const exists = at('if (!snap.exists()) return')
  const gate = at('if (!participantLoaded) {')
  const started = at('if (!started) {')

  check('declares the participantLoaded state', at('const [participantLoaded, setParticipantLoaded]') >= 0)
  check('the listener marks the first snapshot', loaded >= 0)
  check('…before bailing on a missing document', loaded >= 0 && exists > loaded,
    `setParticipantLoaded@${loaded}, snap.exists@${exists}`)
  check('renders a loading state while the participant is unknown', gate >= 0)
  check('…and that gate precedes the instructions branch', gate >= 0 && started > gate,
    `gate@${gate}, instructions@${started}`)
}

console.log(failures
  ? `\n${failures} check(s) FAILED`
  : '\nPHASE-RESTORE GUARD OK — no instructions screen before the participant document has arrived.')
process.exit(failures ? 1 : 0)
