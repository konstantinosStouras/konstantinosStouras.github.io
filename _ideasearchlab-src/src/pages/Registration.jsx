import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession } from '../context/SessionContext'
import { getContent } from '../data/defaultContent'
import { getRegistration, COUNTRIES } from '../data/formDefaults'
import { markTiming, readTiming, clearTiming } from '../utils/timing'
import RichText from '../components/RichText'
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

  // Timing: stamp when the Registration page first opened (client-side, since
  // the participant doc doesn't exist until submit).
  useEffect(() => { markTiming(sessionId, 'registrationOpenedAt') }, [sessionId])

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

  async function handleSubmit(e) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setError('')
    setLoading(true)
    try {
      const functions = getFunctions(undefined, 'europe-west1')
      const joinSession = httpsCallable(functions, 'joinSession')
      await joinSession({ code: session.code })

      const demographics = {}
      fields.forEach(f => {
        const raw = (form[f.id] ?? '').toString().trim()
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

      const participantRef = doc(db, 'sessions', sessionId, 'participants', user.uid)
      // The next screen doesn't need the demographics/consent write to finish,
      // so don't block navigation on it — fire it and move on immediately so
      // the button doesn't sit on "Joining..." for an extra round-trip. The
      // Firestore SDK still delivers the write after we leave this page.
      updateDoc(participantRef, {
        demographics,
        consentGiven: true,
        consentTimestamp: new Date().toISOString(),
        timing,
      })
        .then(() => clearTiming(sessionId))
        .catch(err => console.error('Profile save failed:', err))

      navigate(`/session/${sessionId}`)
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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
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
