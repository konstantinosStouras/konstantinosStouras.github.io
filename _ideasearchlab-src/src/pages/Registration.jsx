import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, updateDoc, getFunctions, httpsCallable, db } from '../utils/db'
import { platformHandoff, registrationAnswers } from '../utils/simplatform'
import { useAuth } from '../context/AuthContext'
import { useSession } from '../context/SessionContext'
import { getContent } from '../data/defaultContent'
import { getRegistration, COUNTRIES } from '../data/formDefaults'
import { markTiming, readTiming, clearTiming } from '../utils/timing'
import { isPreview } from '../utils/preview'
import { randomRegistrationAnswers } from '../utils/testData'
import RichText from '../components/RichText'
import HeaderControls from '../components/HeaderControls'
import styles from './Registration.module.css'

export default function Registration() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { session } = useSession()
  const c = getContent(session).registration
  // Non-phase pages show [AI] lines when either phase's AI is enabled.
  const aiOn = !!(session?.aiConfig?.individualAI || session?.aiConfig?.groupAI)
  const reg = getRegistration(session)
  const fields = reg.fields
  const consentStatements = reg.consents

  const [form, setForm] = useState({})
  const [consents, setConsents] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Silent registration (platform launches): null = normal form,
  // 'submitting' = auto-submitting invisibly. Consent statements are carried
  // from the platform launch too (the platform's terms cover them — owner
  // decision 2026-08), recorded as consentVia on the participant doc.
  const [auto, setAuto] = useState(null)
  const autoRan = useRef(false)

  // Timing: stamp when the Registration page first opened (client-side, since
  // the participant doc doesn't exist until submit).
  useEffect(() => { markTiming(sessionId, 'registrationOpenedAt') }, [sessionId])

  // TEST ROUND: arrive with random demographics filled in and the consents
  // ticked, so rehearsing the flow doesn't mean retyping the form every time.
  // Preview-only (nothing is saved there), and it never overwrites something
  // the tester already typed.
  const previewFilled = useRef(false)
  useEffect(() => {
    if (!isPreview() || previewFilled.current || fields.length === 0) return
    previewFilled.current = true
    const random = randomRegistrationAnswers(fields, COUNTRIES)
    setForm(prev => ({ ...random, ...prev }))
    setConsents(Object.fromEntries(consentStatements.map((_, i) => [i, true])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.length, consentStatements.length])

  // A student arriving from stouras.com/simulation already registered there —
  // fill this form from the handoff and, when every required field is
  // covered, submit it without showing it (owner decision 2026-08). Falls
  // back to the normal (pre-filled) form if a required field can't be mapped
  // or the silent submit fails.
  useEffect(() => {
    if (!session || autoRan.current) return
    autoRan.current = true
    const h = platformHandoff()
    if (!h) return
    const mapped = registrationAnswers(fields, h.profile)
    setForm(prev => ({ ...mapped, ...prev }))
    const missingRequired = fields.some(f => f.required && !(mapped[f.id] ?? '').toString().trim())
    if (missingRequired) return
    setAuto('submitting')
    completeRegistration(mapped, true).catch(err => {
      console.error('Silent registration failed:', err)
      setAuto(null)
      setError('Something went wrong — please review your details and submit below.')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  function updateField(id, value) {
    setForm(prev => ({ ...prev, [id]: value }))
  }

  function validate() {
    for (const f of fields) {
      const raw = (form[f.id] ?? '').toString().trim()
      if (f.required && !raw) return `Please complete: ${f.label}.`
      if (f.type === 'number' && raw) {
        const n = Number(raw)
        if (isNaN(n) || !Number.isInteger(n)) return `${f.label} must be a whole number.`
        if (f.min != null && n < f.min) return `${f.label} must be at least ${f.min}.`
        if (f.max != null && n > f.max) return `${f.label} must be at most ${f.max}.`
      }
    }
    if (!consentStatements.every((_, i) => consents[i])) {
      return 'Please accept all consent statements to continue.'
    }
    return null
  }

  async function completeRegistration(values, silent) {
    const functions = getFunctions(undefined, 'europe-west1')
    const joinSession = httpsCallable(functions, 'joinSession')
    await joinSession({ code: session.code })

    const demographics = {}
    fields.forEach(f => {
      const raw = (values[f.id] ?? '').toString().trim()
      demographics[f.id] = f.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw
    })

    // Flush the client-side timing marks collected on Welcome + Registration
    // (which ran before this participant doc existed) onto the doc, plus the
    // submit moment. Stored as client epoch ms; durations (welcome read,
    // registration time) are computed within this same clock domain.
    const marks = readTiming(sessionId)
    const timing = {
      welcomeOpenedAt: marks.welcomeOpenedAt ?? null,
      welcomeAgreedAt: marks.welcomeAgreedAt ?? null,
      registrationOpenedAt: marks.registrationOpenedAt ?? null,
      registrationSubmittedAt: Date.now(),
    }

    const payload = {
      demographics,
      consentGiven: true,
      consentTimestamp: new Date().toISOString(),
      timing,
    }
    // The login is a throwaway (synthetic e-mail), so record the student's
    // REAL identity from the platform registration alongside the demographics.
    const h = platformHandoff()
    if (h) {
      payload.platform = {
        name: h.profile.name || '',
        email: h.profile.email || '',
        studentId: h.profile.studentId || '',
        source: 'simulation-platform',
        silentRegistration: !!silent,
      }
      // On a silent submit any consent statements were carried from the
      // platform launch, not ticked here — record HOW consent was given.
      if (silent && consentStatements.length > 0) {
        payload.consentVia = 'simulation-platform'
      }
    }

    const participantRef = doc(db, 'sessions', sessionId, 'participants', user.uid)
    // AWAIT this write. It carries the consent record and the demographics —
    // the study's controls — and it is the ONE write with no second chance:
    // `joinSession` has already created the participant doc, so a re-join
    // takes the "already registered" path straight to the lobby and this form
    // is never shown again. Firing it and navigating away (which is what this
    // did, to save one round-trip on the button) meant a student whose write
    // was still in flight when they reloaded or lost the network — the SDK
    // holds unacked writes in MEMORY, there is no offline persistence here —
    // played the whole session with no consent and no demographics on record,
    // silently. One round-trip is the right price for that.
    await updateDoc(participantRef, payload)
    clearTiming(sessionId)

    navigate(`/session/${sessionId}`)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setError('')
    setLoading(true)
    try {
      await completeRegistration(form, false)
    } catch (err) {
      console.error(err)
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const isValid = validate() === null

  function renderField(f) {
    const value = form[f.id] ?? ''
    if (f.type === 'number') {
      return (
        <input
          className="input-field"
          type="number"
          min={f.min ?? undefined}
          max={f.max ?? undefined}
          step="1"
          value={value}
          onChange={e => updateField(f.id, e.target.value)}
          placeholder="e.g. 3"
        />
      )
    }
    if (f.type === 'text') {
      return (
        <input
          className="input-field"
          type="text"
          value={value}
          onChange={e => updateField(f.id, e.target.value)}
        />
      )
    }
    // select or country
    const options = f.type === 'country' ? COUNTRIES : (f.options || [])
    return (
      <select
        className={`input-field ${styles.select}`}
        value={value}
        onChange={e => updateField(f.id, e.target.value)}
      >
        <option value="">Select...</option>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    )
  }

  // Silent path: the platform data is being submitted invisibly.
  if (auto === 'submitting') {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <span className={styles.wordmark}>Ideation Challenge</span>
          <HeaderControls />
        </header>
        <main className={styles.main}>
          <div className={styles.card}>
            <p style={{ textAlign: 'center', color: 'var(--muted)' }}>Setting up your session...</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <HeaderControls />
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          <RichText html={c.body} aiOn={aiOn} />

          <form onSubmit={handleSubmit} className={styles.form}>
            <h2 className={styles.sectionTitle}>Participant Information</h2>

            <div className={styles.fieldGrid}>
              {fields.map(f => (
                <label key={f.id} className={styles.field}>
                  <span className={styles.label}>
                    {f.label}{f.required && <span className={styles.req}> *</span>}
                  </span>
                  {renderField(f)}
                </label>
              ))}
            </div>

            {consentStatements.length > 0 && (
              <>
                <hr className={styles.divider} />
                <h2 className={styles.sectionTitle}>Consent</h2>
                {consentStatements.map((stmt, i) => (
                  <label key={i} className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={!!consents[i]}
                      onChange={e => setConsents(prev => ({ ...prev, [i]: e.target.checked }))}
                    />
                    <span>{stmt}</span>
                  </label>
                ))}
              </>
            )}

            {error && <p className="error-msg">{error}</p>}

            <div className={styles.submitRow}>
              <button
                className={`btn-primary ${styles.submitBtn}`}
                type="submit"
                disabled={loading || !isValid}
              >
                {loading ? 'Joining...' : 'Submit and Start Challenge'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
