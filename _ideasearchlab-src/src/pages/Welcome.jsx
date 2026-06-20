import { useParams, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { getContent } from '../data/defaultContent'
import RichText from '../components/RichText'
import styles from './Welcome.module.css'

export default function Welcome() {
  const { sessionId } = useParams()
  const { session, loading } = useSession()
  const navigate = useNavigate()

  if (loading) {
    return <div className={styles.loading}>Loading session...</div>
  }

  if (!session) {
    return <div className={styles.loading}>Session not found.</div>
  }

  const c = getContent(session).welcome
  // Non-phase pages show [AI] lines when either phase's AI is enabled.
  const aiOn = !!(session?.aiConfig?.individualAI || session?.aiConfig?.groupAI)

  function handleContinue() {
    navigate(`/session/${sessionId}/register`)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          <RichText html={c.body} aiOn={aiOn} />

          <button className={`btn-primary ${styles.continueBtn}`} onClick={handleContinue}>
            I agree and continue
          </button>
        </div>
      </main>
    </div>
  )
}
