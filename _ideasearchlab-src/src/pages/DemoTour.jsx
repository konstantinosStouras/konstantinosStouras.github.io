import { useState, useEffect, Component } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSession, useAIModelLabel } from '../context/SessionContext'
import HeaderControls from '../components/HeaderControls'
import styles from './DemoTour.module.css'

/**
 * DemoTour
 *
 * A self-contained, auto-playing walkthrough that shows a brand-new participant
 * how the whole challenge works — BEFORE they register — using lightweight mock
 * panels (no Firestore, no real session data). It sits between Welcome and
 * Registration (`/session/:sessionId/tour`) and can be skipped at any time.
 *
 * The script adapts to the session's configuration:
 *   - Individual / Group phases are only shown when active.
 *   - The "brainstorm with the AI" scenes appear only for the phase(s) whose AI
 *     is enabled (aiConfig.individualAI / aiConfig.groupAI).
 *   - The number of ideas to carry forward and votes are read from the session
 *     config so the captions match what participants will actually see.
 *
 * Deliberately it never reveals the actual task brief (it only points at where
 * to read it) and only flashes the survey's structure, not its questions.
 */

// ── A tiny typewriter: types `text` out on mount, char by char. ──────────────
function useTypewriter(text, { speed = 34, startDelay = 350, active = true } = {}) {
  const [out, setOut] = useState(active ? '' : text)
  const [done, setDone] = useState(!active)
  useEffect(() => {
    if (!active) { setOut(text); setDone(true); return }
    setOut(''); setDone(false)
    let i = 0
    let interval
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1
        setOut(text.slice(0, i))
        if (i >= text.length) { clearInterval(interval); setDone(true) }
      }, speed)
    }, startDelay)
    return () => { clearTimeout(start); clearInterval(interval) }
  }, [text, speed, startDelay, active])
  return { out, done }
}

function Typed({ text, speed, startDelay, caret = true }) {
  const { out, done } = useTypewriter(text, { speed, startDelay })
  return (
    <span>
      {out}
      {caret && !done && <span className={styles.caret} />}
    </span>
  )
}

// Demo ideas — the first is the user's suggested example (a water-flying
// scooter); the rest fit the smart-materials / wearables brief.
const DEMO_IDEAS = [
  { title: 'Aqua-Glide Hover Scooter', desc: 'A personal water scooter that skims the surface and lifts into a short hover-flight just above the waves.' },
  { title: 'SolarSkin Jacket', desc: 'A jacket whose fabric shifts colour with body heat and trickle-charges your phone in sunlight.' },
  { title: 'PulseGrip Bands', desc: 'Wristbands that change colour to show your live heart-rate zone during a workout.' },
  { title: 'ThermoTrail Boots', desc: 'Hiking boots that reveal a warming pattern as your feet reach temperature.' },
]

// ── Mock building blocks ─────────────────────────────────────────────────────
// Format a phase duration (seconds, as configured by the admin) as m:ss for the
// mock timer; returns null when the phase is left on manual (no countdown).
function fmtClock(totalSeconds) {
  const s = Number(totalSeconds)
  if (!Number.isFinite(s) || s <= 0) return null
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function MockTimer({ clock }) {
  return <span className={styles.mockTimer}>⏱ {clock}</span>
}

function IdeaCard({ idea, selected, rank, tag }) {
  return (
    <div className={`${styles.ideaCard} ${selected ? styles.ideaSelected : ''}`}>
      {rank != null && <span className={styles.rankBadge}>#{rank}</span>}
      <div className={styles.ideaHead}>
        <span className={styles.ideaTitle}>{idea.title}</span>
        {tag && <span className={styles.ideaTag}>{tag}</span>}
        {selected && <span className={styles.ideaCheck}>✓</span>}
      </div>
      <p className={styles.ideaDesc}>{idea.desc}</p>
    </div>
  )
}

function MockPhaseChrome({ title, children, right, clock }) {
  return (
    <div className={styles.workspace}>
      <div className={styles.wsTop}>
        <h3 className={styles.wsTitle}>{title}</h3>
        <div className={styles.wsRight}>
          {clock && <MockTimer clock={clock} />}
          {right}
        </div>
      </div>
      {children}
    </div>
  )
}

// ── Scenes ───────────────────────────────────────────────────────────────────
function SceneJoin() {
  return (
    <div className={styles.centerStage}>
      <div className={styles.miniCard}>
        <div className={styles.miniIcon}>◈</div>
        <h3 className={styles.miniTitle}>Join a Session</h3>
        <div className={`input-field ${styles.codeBox}`}>
          <Typed text="DEMO-2026" speed={140} />
        </div>
        <button className={`btn-primary ${styles.fullBtn}`}>Join Session</button>
      </div>
    </div>
  )
}

function SceneWelcome() {
  return (
    <div className={styles.centerStage}>
      <div className={styles.miniCard} style={{ textAlign: 'left', maxWidth: 460 }}>
        <h3 className={styles.miniTitle}>Welcome to the Ideation Challenge 💡</h3>
        <span className={styles.skelLine} style={{ width: '92%' }} />
        <span className={styles.skelLine} style={{ width: '80%' }} />
        <span className={styles.skelLine} style={{ width: '88%' }} />
        <div className={styles.phaseRow}><b>Phase 1</b> — Individual Ideation</div>
        <div className={styles.phaseRow}><b>Phase 2</b> — Group Ideation</div>
        <div className={styles.phaseRow}><b>Phase 3</b> — Voting &amp; Final Selection</div>
        <button className={`btn-primary ${styles.agreeBtn}`}>I agree and continue</button>
      </div>
    </div>
  )
}

function SceneTaskBrief({ clock }) {
  return (
    <MockPhaseChrome title="Individual Phase" clock={clock}>
      <div className={`${styles.briefBar} ${styles.pulse}`}>
        <span>▸ Task Brief — tap to read what to design</span>
        <span className={styles.briefHint}>read the task here</span>
      </div>
      <div className={styles.emptyIdeas}>Your ideas will appear here.</div>
    </MockPhaseChrome>
  )
}

function SceneAddIdea({ clock }) {
  const idea = DEMO_IDEAS[0]
  const { out: desc, done } = useTypewriter(idea.desc, { speed: 18, startDelay: 1500 })
  return (
    <MockPhaseChrome title="Individual Phase" clock={clock}>
      <div className={styles.addForm}>
        <div className={styles.fieldLabel}>Idea title</div>
        <div className={`input-field ${styles.addInput}`}>
          <Typed text={idea.title} speed={55} startDelay={300} />
        </div>
        <div className={styles.fieldLabel}>Description</div>
        <div className={`input-field ${styles.addArea}`}>
          {desc}{!done && <span className={styles.caret} />}
        </div>
        <button className={`btn-primary ${styles.addBtn} ${done ? styles.addBtnReady : ''}`}>+ Add idea</button>
      </div>
    </MockPhaseChrome>
  )
}

function SceneMoreIdeas({ clock }) {
  const [count, setCount] = useState(1)
  useEffect(() => {
    const timers = [1, 2, 3].map((n, i) =>
      setTimeout(() => setCount(c => Math.max(c, n + 1)), 700 + i * 900)
    )
    return () => timers.forEach(clearTimeout)
  }, [])
  return (
    <MockPhaseChrome title="Individual Phase" clock={clock} right={<span className={styles.countPill}>{count} / 5 ideas</span>}>
      <div className={styles.ideaList}>
        {DEMO_IDEAS.slice(0, count).map((idea, i) => (
          <div key={idea.title} className={styles.fadeIn} style={{ animationDelay: `${i * 0.05}s` }}>
            <IdeaCard idea={idea} />
          </div>
        ))}
      </div>
    </MockPhaseChrome>
  )
}

function SceneSelect({ ideasCarried, clock }) {
  const [selCount, setSelCount] = useState(0)
  useEffect(() => {
    const timers = []
    for (let n = 1; n <= ideasCarried; n++) {
      timers.push(setTimeout(() => setSelCount(c => Math.max(c, n)), 600 + (n - 1) * 850))
    }
    return () => timers.forEach(clearTimeout)
  }, [ideasCarried])
  return (
    <MockPhaseChrome
      title="Individual Phase"
      clock={clock}
      right={<span className={styles.countPill}>Selected: {selCount} / {ideasCarried}</span>}
    >
      <div className={styles.selHint}>Double-click your best {ideasCarried} ideas to carry them forward ↓</div>
      <div className={styles.ideaList}>
        {DEMO_IDEAS.map((idea, i) => (
          <IdeaCard key={idea.title} idea={idea} selected={i < selCount} />
        ))}
      </div>
    </MockPhaseChrome>
  )
}

function SceneAI({ phase, aiModel }) {
  const userMsg = phase === 'group'
    ? 'Can we combine the hover scooter with the heart-rate bands?'
    : 'How could I make the flying water scooter safer?'
  const aiMsg = phase === 'group'
    ? 'Nice synthesis — a safety wearable that pairs with the scooter could auto-slow it when your heart-rate spikes. Want help naming it?'
    : 'Great question! A rescue mode could add a high-visibility colour-shifting hull and a stabilised low hover for choppy water. Want a few more safety angles?'
  const { out: typedUser, done: userDone } = useTypewriter(userMsg, { speed: 26, startDelay: 500 })
  const { out: typedAi } = useTypewriter(aiMsg, { speed: 16, startDelay: 500 + userMsg.length * 26 + 900 })
  return (
    <div className={styles.aiStage}>
      <div className={styles.aiPanelLeft}>
        <div className={styles.aiLeftLabel}>{phase === 'group' ? 'Group ideas' : 'Your ideas'}</div>
        {DEMO_IDEAS.slice(0, 2).map(idea => <IdeaCard key={idea.title} idea={idea} />)}
      </div>
      <div className={styles.aiChat}>
        <div className={styles.aiHeader}>
          <span className={styles.aiDot} /> AI Assistant
          <span className={styles.aiScope}>{phase === 'group' ? 'shared with your group' : 'private — only you'}</span>
        </div>
        <div className={styles.aiBody}>
          <div className={`${styles.bubble} ${styles.bubbleMe}`}>{typedUser}{!userDone && <span className={styles.caret} />}</div>
          {typedAi && <div className={`${styles.bubble} ${styles.bubbleAi}`}>{typedAi}</div>}
        </div>
        <div className={`input-field ${styles.aiInput}`}>{aiModel ? `Ask ${aiModel}…` : 'Ask the AI…'}</div>
      </div>
    </div>
  )
}

function SceneGroup() {
  const chat = [
    { who: 'p2', me: false, text: 'Love the Aqua-Glide — could we add an auto-balance mode for beginners?' },
    { who: 'You', me: true, text: 'Yes! And pair it with the heart-rate bands for safety.' },
    { who: 'p3', me: false, text: 'Agreed. Let’s add that as a new group idea.' },
  ]
  return (
    <div className={styles.groupStage}>
      <div className={styles.groupCol}>
        <div className={styles.colLabel}>Ideas from your group</div>
        <IdeaCard idea={DEMO_IDEAS[0]} tag="p1" />
        <IdeaCard idea={DEMO_IDEAS[2]} tag="p2" />
        <IdeaCard idea={DEMO_IDEAS[3]} tag="You" />
      </div>
      <div className={styles.groupCol}>
        <div className={styles.colLabel}>Add group ideas</div>
        <div className={styles.addGroupBox}>
          <div className={`input-field ${styles.addInputSm}`}>New idea title…</div>
          <div className={`input-field ${styles.addAreaSm}`}>Describe it together…</div>
          <button className={`btn-primary ${styles.addBtnSm}`}>+ Add</button>
        </div>
      </div>
      <div className={styles.groupCol}>
        <div className={styles.colLabel}>Group chat <span className={styles.anonTag}>anonymous</span></div>
        <div className={styles.chatBox}>
          {chat.map((m, i) => (
            <div key={i} className={`${styles.chatRow} ${m.me ? styles.chatRowMe : ''} ${styles.fadeIn}`} style={{ animationDelay: `${i * 0.5}s` }}>
              {!m.me && <span className={styles.chatWho}>{m.who}</span>}
              <span className={`${styles.chatBubble} ${m.me ? styles.chatBubbleMe : ''}`}>{m.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SceneVoting({ votes, clock }) {
  const [voted, setVoted] = useState(0)
  useEffect(() => {
    const timers = []
    for (let n = 1; n <= votes; n++) {
      timers.push(setTimeout(() => setVoted(c => Math.max(c, n)), 700 + (n - 1) * 900))
    }
    return () => timers.forEach(clearTimeout)
  }, [votes])
  return (
    <MockPhaseChrome
      title="Group Voting"
      clock={clock}
      right={<span className={styles.countPill}>Votes: {voted} / {votes}</span>}
    >
      <div className={styles.consensus}>🤝 Agree as a group — everyone votes for the same {votes} ideas.</div>
      <div className={styles.ideaList}>
        {DEMO_IDEAS.map((idea, i) => (
          <IdeaCard key={idea.title} idea={idea} selected={i < voted} />
        ))}
      </div>
    </MockPhaseChrome>
  )
}

function SceneFinal({ votes }) {
  return (
    <div className={styles.centerStage}>
      <div className={styles.finalWrap}>
        <h3 className={styles.finalTitle}>🏆 Your group&rsquo;s final {votes} ideas</h3>
        {DEMO_IDEAS.slice(0, votes).map((idea, i) => (
          <div key={idea.title} className={styles.fadeIn} style={{ animationDelay: `${i * 0.15}s` }}>
            <IdeaCard idea={idea} rank={i + 1} />
          </div>
        ))}
        <p className={styles.finalNote}>The most-voted ideas are submitted as your group&rsquo;s entry.</p>
      </div>
    </div>
  )
}

function SceneSurvey() {
  return (
    <div className={styles.surveyStage}>
      <h3 className={styles.surveyTitle}>Post-play Survey</h3>
      <div className={styles.surveyScroll}>
        <div className={styles.surveyScrollInner}>
          {['Your Experience', 'Creativity', 'Reflection', 'About the products'].map((sec, s) => (
            <div key={sec} className={styles.surveySection}>
              <div className={styles.surveySecHead}>{sec}</div>
              {[0, 1].map(q => (
                <div key={q} className={styles.surveyQ}>
                  <span className={styles.skelLine} style={{ width: `${60 + ((q + s) % 3) * 12}%` }} />
                  <div className={styles.boxScaleMini}>
                    {[1, 2, 3, 4, 5].map(n => <span key={n} className={styles.scaleBoxMini}>{n}</span>)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.surveyFade} />
    </div>
  )
}

function SceneEnd() {
  return (
    <div className={styles.centerStage}>
      <div className={styles.endCard}>
        <div className={styles.endIcon}>🚀</div>
        <h3 className={styles.endTitle}>You’re ready!</h3>
        <p className={styles.endText}>You now know how the Ideation Challenge works. Click Start to register and begin.</p>
      </div>
    </div>
  )
}

// Guards the dynamic scene: if any single scene throws while rendering, show a
// quiet placeholder instead of blanking the whole app (the tour keeps
// auto-advancing, and Skip/Start below still work). Resets when the scene
// changes so one bad scene never poisons the rest of the tour.
class SceneBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err) { console.error('Demo scene failed to render:', err) }
  componentDidUpdate(prev) {
    if (prev.sceneKey !== this.props.sceneKey && this.state.failed) this.setState({ failed: false })
  }
  render() {
    if (this.state.failed) {
      return <div className={styles.centerStage}><div className={styles.miniCard}>Preview of this step is unavailable — continuing…</div></div>
    }
    return this.props.children
  }
}

// ── Tour driver ──────────────────────────────────────────────────────────────
export default function DemoTour() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { session } = useSession()
  const aiModelLabel = useAIModelLabel()

  const pc = session?.phaseConfig || {}
  const ai = session?.aiConfig || {}
  const individualActive = pc.individualPhaseActive !== false
  const groupActive = pc.groupPhaseActive !== false
  const ideasCarried = pc.ideasCarriedToGroup || 3
  const votes = Math.max(1, Math.min(3, ideasCarried))
  // Mock timers mirror the admin-allocated phase durations (seconds → m:ss).
  const indivClock = fmtClock(pc.individualPhaseDuration)
  const groupClock = fmtClock(pc.groupPhaseDuration)
  // Friendly model name without the long provider prefix for the input hint.
  const aiModel = (aiModelLabel || '').replace(/^[^’']*(?:’s|'s)\s*/, '') || aiModelLabel || ''

  // Build the scene list to match this session's configuration.
  const steps = []
  steps.push({ id: 'join', caption: 'Your instructor gives you a session code — type it in and join.', dur: 5200, Comp: SceneJoin, props: {} })
  steps.push({ id: 'welcome', caption: 'You’ll see what the challenge is about and the phases ahead, then agree to take part.', dur: 5600, Comp: SceneWelcome, props: {} })
  if (individualActive) {
    steps.push({ id: 'brief', caption: 'When a phase begins, the full task is in the Task Brief — open it to read exactly what to design.', dur: 5600, Comp: SceneTaskBrief, props: { clock: indivClock } })
    steps.push({ id: 'add', caption: 'Add an idea: give it a short title and a description, then click Add.', dur: 7200, Comp: SceneAddIdea, props: { clock: indivClock } })
    steps.push({ id: 'more', caption: 'Keep going — capture as many ideas as you can while the timer runs.', dur: 5200, Comp: SceneMoreIdeas, props: { clock: indivClock } })
    if (ai.individualAI) {
      steps.push({ id: 'ai-ind', caption: 'If enabled, a private AI assistant helps you brainstorm and refine. Only you can see this chat.', dur: 8000, Comp: SceneAI, props: { phase: 'individual', aiModel } })
    }
    steps.push({ id: 'select', caption: `Pick your best ${ideasCarried} ideas (double-click) — these carry into the group phase.`, dur: 6200, Comp: SceneSelect, props: { ideasCarried, clock: indivClock } })
  }
  if (groupActive) {
    steps.push({ id: 'group', caption: 'Now you team up: see everyone’s carried ideas, add new group ideas, and chat. Everyone stays anonymous (p1, p2, p3) — your name is never shown to peers.', dur: 8000, Comp: SceneGroup, props: {} })
    if (ai.groupAI) {
      steps.push({ id: 'ai-grp', caption: 'If enabled, the group shares one AI assistant — everyone sees the same conversation.', dur: 8000, Comp: SceneAI, props: { phase: 'group', aiModel } })
    }
    steps.push({ id: 'vote', caption: `Each member votes for ${votes} ideas. Talk it through — it matters that the group agrees on the same ones.`, dur: 6600, Comp: SceneVoting, props: { votes, clock: groupClock } })
    steps.push({ id: 'final', caption: 'The most-voted ideas become your group’s final selection.', dur: 5600, Comp: SceneFinal, props: { votes } })
  }
  steps.push({ id: 'survey', caption: 'Finally, a short survey about your experience — just a few minutes to wrap up.', dur: 5600, Comp: SceneSurvey, props: {} })
  steps.push({ id: 'end', caption: 'That’s the whole flow. Ready? Continue to register and join your session.', dur: 100000, Comp: SceneEnd, props: {} })

  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const lastIndex = steps.length - 1
  const safeIndex = Math.min(index, lastIndex)
  const step = steps[safeIndex]

  function finish() { navigate(`/session/${sessionId}/register`) }
  const next = () => setIndex(i => Math.min(i + 1, lastIndex))
  const prev = () => setIndex(i => Math.max(i - 1, 0))

  // Auto-advance: each step lingers for its `dur`, unless paused or on the last
  // step. Keyed on id/dur (not the freshly-rebuilt step object) so unrelated
  // re-renders don't restart the timer.
  useEffect(() => {
    if (paused || safeIndex >= lastIndex) return
    const t = setTimeout(() => setIndex(i => Math.min(i + 1, lastIndex)), step.dur)
    return () => clearTimeout(t)
  }, [safeIndex, paused, lastIndex, step.id, step.dur])

  const StepComp = step.Comp
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <div className={styles.headerMid}>A quick tour of how it works</div>
        <HeaderControls />
      </header>

      <div className={styles.body}>
        <div className={styles.progressTrack}>
          {steps.map((s, i) => (
            <button
              key={s.id}
              className={`${styles.dot} ${i === safeIndex ? styles.dotActive : ''} ${i < safeIndex ? styles.dotDone : ''}`}
              onClick={() => setIndex(i)}
              aria-label={`Step ${i + 1}`}
            />
          ))}
        </div>

        <div className={styles.stageWrap}>
          <div className={styles.stage} key={step.id}>
            <SceneBoundary sceneKey={step.id}>
              <StepComp {...step.props} />
            </SceneBoundary>
          </div>
          <div className={styles.coachmark} key={`cap-${step.id}`}>
            <span className={styles.stepNum}>Step {safeIndex + 1} / {steps.length}</span>
            <p className={styles.caption}>{step.caption}</p>
          </div>
        </div>

        <div className={styles.controls}>
          <button className={styles.skipBtn} onClick={finish}>Skip tour</button>
          <div className={styles.controlsMid}>
            <button className={styles.navBtn} onClick={prev} disabled={safeIndex === 0}>‹ Back</button>
            <button className={styles.playBtn} onClick={() => setPaused(p => !p)}>
              {paused ? '▶ Play' : '❚❚ Pause'}
            </button>
            {safeIndex < lastIndex
              ? <button className={styles.navBtn} onClick={next}>Next ›</button>
              : <button className={`btn-primary ${styles.startBtn}`} onClick={finish}>Start →</button>}
          </div>
          {safeIndex < lastIndex
            ? <button className={`btn-primary ${styles.startBtn}`} onClick={finish}>Start now</button>
            : <span className={styles.controlsSpacer} />}
        </div>
      </div>
    </div>
  )
}
