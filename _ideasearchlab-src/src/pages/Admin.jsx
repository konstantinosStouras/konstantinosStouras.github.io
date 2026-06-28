import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, addDoc, serverTimestamp, onSnapshot,
  deleteDoc, doc, updateDoc, setDoc, deleteField, query, where, getDocs
} from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { db, auth, functions } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { DEFAULT_CONTENT, CONTENT_SCHEMA, getContent, getEffectiveDefaults } from '../data/defaultContent'
import { DEFAULT_REGISTRATION, DEFAULT_SURVEY_QUESTIONS, getRegistration, getSurveyQuestions } from '../data/formDefaults'
import RichTextEditor from '../components/RichTextEditor'
import { RegistrationBuilder, SurveyBuilder } from '../components/FormBuilder'
import styles from './Admin.module.css'

const ADMIN_EMAIL = 'admin@admin.com'

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

// Deep clone the default copy so each session gets an independent, editable copy.
function cloneDefaultContent() {
  return JSON.parse(JSON.stringify(DEFAULT_CONTENT))
}

const DEFAULT_CONFIG = {
  phaseConfig: {
    individualPhaseActive: true,
    groupPhaseActive: true,
    phaseOrder: 'individual_first',
    maxIdeasIndividual: 5,
    ideasCarriedToGroup: 3,
    individualPhaseDuration: 600,
    groupPhaseDuration: 900,
    votingDuration: 300,
    groupSize: 3,
  },
  aiConfig: {
    individualAI: false,
    groupAI: false,
    // null = defer to the global AI Settings model (a hardcoded value here
    // would silently override the admin's choice on every new session)
    model: null,
    temperature: null,
    maxTokens: null,
    systemPrompt: null,
    personality: null,
    contextWindow: null,
  },
  contentConfig: cloneDefaultContent(),
  registrationConfig: JSON.parse(JSON.stringify(DEFAULT_REGISTRATION)),
  surveyConfig: { questions: JSON.parse(JSON.stringify(DEFAULT_SURVEY_QUESTIONS)) },
}

// A fresh config with an independent copy of the defaults, so resetting the
// form after create/edit never shares object references with prior state.
// Admin-saved defaults (settings/contentDefaults) merge over the built-in
// copy when provided: per-page text plus the registrationForm /
// surveyQuestions builder defaults.
function freshConfig(customDefaults) {
  return {
    phaseConfig: { ...DEFAULT_CONFIG.phaseConfig, ...(customDefaults?.ideaParameters || {}), ...(customDefaults?.phaseTimers || {}) },
    aiConfig: { ...DEFAULT_CONFIG.aiConfig },
    contentConfig: getEffectiveDefaults(customDefaults),
    registrationConfig: customDefaults?.registrationForm
      ? JSON.parse(JSON.stringify(customDefaults.registrationForm))
      : JSON.parse(JSON.stringify(DEFAULT_REGISTRATION)),
    surveyConfig: customDefaults?.surveyQuestions
      ? JSON.parse(JSON.stringify(customDefaults.surveyQuestions))
      : { questions: JSON.parse(JSON.stringify(DEFAULT_SURVEY_QUESTIONS)) },
  }
}

// The two structured builders that support admin-saved defaults, keyed by
// their field name inside the settings/contentDefaults doc.
const BUILDER_DEFAULTS = {
  registrationForm: {
    configKey: 'registrationConfig',
    builtin: () => JSON.parse(JSON.stringify(DEFAULT_REGISTRATION)),
  },
  surveyQuestions: {
    configKey: 'surveyConfig',
    builtin: () => ({ questions: JSON.parse(JSON.stringify(DEFAULT_SURVEY_QUESTIONS)) }),
  },
}

export default function Admin() {
  const { user } = useAuth()
  const { dark, toggle } = useTheme()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState([])
  const [participantsBySession, setParticipantsBySession] = useState({})
  const [authUsers, setAuthUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState(null)
  const [userSearch, setUserSearch] = useState('')
  const [expandedUser, setExpandedUser] = useState(null)
  const [removeUserConfirm, setRemoveUserConfirm] = useState(null) // user pending account removal
  const [removingUserUid, setRemovingUserUid] = useState(null)
  const [creating, setCreating] = useState(false)
  const [lastCreatedCode, setLastCreatedCode] = useState(null)
  const [newName, setNewName] = useState('')      // optional human-friendly session name
  const [newCode, setNewCode] = useState('')      // optional custom Session ID (blank = auto)
  const [createError, setCreateError] = useState('')
  const [editingSession, setEditingSession] = useState(null)
  const [config, setConfig] = useState(freshConfig)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [closeConfirm, setCloseConfirm] = useState(null)
  const [bulkConfirm, setBulkConfirm] = useState(null) // 'active' | 'completed' | 'users'
  const [bulkBusy, setBulkBusy] = useState(false)
  const [customDefaults, setCustomDefaults] = useState(null)
  const [defaultFeedback, setDefaultFeedback] = useState(null) // { key, text }
  const editingRef = useRef(null)
  const defaultsSeededRef = useRef(false)

  useEffect(() => { editingRef.current = editingSession }, [editingSession])

  // Admin-saved page-content defaults (settings/contentDefaults). The first
  // snapshot seeds the create form (unless a session edit is in progress);
  // later updates only feed the reset/save-default actions.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'contentDefaults'),
      snap => {
        const data = snap.exists() ? snap.data() : null
        setCustomDefaults(data)
        if (!defaultsSeededRef.current) {
          defaultsSeededRef.current = true
          if (data && !editingRef.current) {
            setConfig(c => ({
              ...c,
              phaseConfig: (data.ideaParameters || data.phaseTimers)
                ? { ...c.phaseConfig, ...(data.ideaParameters || {}), ...(data.phaseTimers || {}) }
                : c.phaseConfig,
              contentConfig: getEffectiveDefaults(data),
              registrationConfig: data.registrationForm
                ? JSON.parse(JSON.stringify(data.registrationForm))
                : c.registrationConfig,
              surveyConfig: data.surveyQuestions
                ? JSON.parse(JSON.stringify(data.surveyQuestions))
                : c.surveyConfig,
            }))
          }
        }
      },
      err => console.warn('contentDefaults listener:', err.message)
    )
    return unsub
  }, [])

  useEffect(() => {
    if (!user) return
    const q = query(collection(db, 'sessions'), where('instructorId', '==', user.uid))
    const unsub = onSnapshot(q, snap => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [user])

  useEffect(() => {
    if (sessions.length === 0) return
    const unsubs = sessions.map(s =>
      onSnapshot(collection(db, 'sessions', s.id, 'participants'), snap => {
        setParticipantsBySession(prev => ({
          ...prev,
          [s.id]: snap.docs.map(d => ({ id: d.id, ...d.data() })),
        }))
      })
    )
    return () => unsubs.forEach(u => u())
  }, [sessions])

  // Registered accounts come from Firebase Auth via an admin-only callable —
  // the only authoritative "who signed up" source (the client SDK can't list
  // Auth users). Which sessions each one joined is cross-referenced below from
  // the participant docs already loaded. If the function isn't deployed yet,
  // the panel degrades to showing just the users who have joined a session.
  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    setUsersError(null)
    try {
      const res = await httpsCallable(functions, 'listRegisteredUsers')()
      setAuthUsers(res.data?.users || [])
    } catch (err) {
      console.warn('listRegisteredUsers failed:', err.message)
      setUsersError(err.message || 'Could not load registered users.')
    } finally {
      setUsersLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  function setPhase(key, value) {
    setConfig(c => ({ ...c, phaseConfig: { ...c.phaseConfig, [key]: value } }))
  }

  function setAI(key, value) {
    setConfig(c => ({ ...c, aiConfig: { ...c.aiConfig, [key]: value } }))
  }

  // Update one editable copy field on one page (e.g. welcome.pageTitle).
  function setContentField(groupKey, fieldKey, value) {
    setConfig(c => ({
      ...c,
      contentConfig: {
        ...c.contentConfig,
        [groupKey]: { ...c.contentConfig[groupKey], [fieldKey]: value },
      },
    }))
  }

  function setRegistrationConfig(rc) {
    setConfig(c => ({ ...c, registrationConfig: rc }))
  }
  function setSurveyConfig(sc) {
    setConfig(c => ({ ...c, surveyConfig: sc }))
  }

  // Restore one page's copy to the current defaults (admin-saved if present,
  // built-in otherwise).
  function resetContentGroup(groupKey) {
    setConfig(c => ({
      ...c,
      contentConfig: {
        ...c.contentConfig,
        [groupKey]: getEffectiveDefaults(customDefaults)[groupKey],
      },
    }))
  }

  function flashDefaultFeedback(groupKey, text) {
    setDefaultFeedback({ key: groupKey, text })
    setTimeout(() => setDefaultFeedback(null), 3000)
  }

  // Persist one page's current text as the default for future sessions
  // (stored in settings/contentDefaults, merged over the built-ins).
  async function saveContentGroupAsDefault(groupKey) {
    try {
      await setDoc(
        doc(db, 'settings', 'contentDefaults'),
        { [groupKey]: config.contentConfig[groupKey] },
        { merge: true }
      )
      flashDefaultFeedback(groupKey, 'Saved — new sessions will start with this text.')
    } catch (err) {
      console.error('Could not save default:', err)
      flashDefaultFeedback(groupKey, 'Could not save (check Firestore rules).')
    }
  }

  // Same three actions for the structured builders (registration form and
  // survey questions), stored under their own keys in the same doc.
  async function saveBuilderAsDefault(key) {
    try {
      await setDoc(
        doc(db, 'settings', 'contentDefaults'),
        { [key]: config[BUILDER_DEFAULTS[key].configKey] },
        { merge: true }
      )
      flashDefaultFeedback(key, 'Saved — new sessions will start with this.')
    } catch (err) {
      console.error('Could not save default:', err)
      flashDefaultFeedback(key, 'Could not save (check Firestore rules).')
    }
  }

  function resetBuilder(key) {
    const { configKey, builtin } = BUILDER_DEFAULTS[key]
    const custom = customDefaults?.[key]
    setConfig(c => ({
      ...c,
      [configKey]: custom ? JSON.parse(JSON.stringify(custom)) : builtin(),
    }))
  }

  async function restoreBuilderBuiltin(key) {
    try {
      await setDoc(
        doc(db, 'settings', 'contentDefaults'),
        { [key]: deleteField() },
        { merge: true }
      )
      const { configKey, builtin } = BUILDER_DEFAULTS[key]
      setConfig(c => ({ ...c, [configKey]: builtin() }))
      flashDefaultFeedback(key, 'Built-in default restored.')
    } catch (err) {
      console.error('Could not restore built-in default:', err)
      flashDefaultFeedback(key, 'Could not restore (check Firestore rules).')
    }
  }

  // Remove the admin-saved default for one page and put the built-in text
  // back into the editor.
  async function restoreBuiltinDefault(groupKey) {
    try {
      await setDoc(
        doc(db, 'settings', 'contentDefaults'),
        { [groupKey]: deleteField() },
        { merge: true }
      )
      setConfig(c => ({
        ...c,
        contentConfig: {
          ...c.contentConfig,
          [groupKey]: JSON.parse(JSON.stringify(DEFAULT_CONTENT[groupKey])),
        },
      }))
      flashDefaultFeedback(groupKey, 'Built-in default restored.')
    } catch (err) {
      console.error('Could not restore built-in default:', err)
      flashDefaultFeedback(groupKey, 'Could not restore (check Firestore rules).')
    }
  }

  // "Save" for a content page: commit the current text. When editing a session
  // it writes to that session immediately; in create mode the text is already
  // captured and will be used when the session is created.
  async function saveContentGroup(groupKey) {
    try {
      if (editingSession) {
        await updateDoc(doc(db, 'sessions', editingSession.id), {
          contentConfig: config.contentConfig,
        })
        flashDefaultFeedback(groupKey, 'Saved to this session.')
      } else {
        flashDefaultFeedback(groupKey, 'Saved — used when you create the session.')
      }
    } catch (err) {
      console.error('Could not save:', err)
      flashDefaultFeedback(groupKey, 'Could not save (check Firestore rules).')
    }
  }

  // "Save" for the registration / survey builders (same Save semantics).
  async function saveBuilder(key) {
    const { configKey } = BUILDER_DEFAULTS[key]
    try {
      if (editingSession) {
        await updateDoc(doc(db, 'sessions', editingSession.id), {
          [configKey]: config[configKey],
        })
        flashDefaultFeedback(key, 'Saved to this session.')
      } else {
        flashDefaultFeedback(key, 'Saved — used when you create the session.')
      }
    } catch (err) {
      console.error('Could not save:', err)
      flashDefaultFeedback(key, 'Could not save (check Firestore rules).')
    }
  }

  // ── Idea Parameters: Save / Make this the default / Restore built-in ──
  // "Save" commits the current idea parameters. When editing a session it
  // writes them to that session immediately; in create mode the values are
  // already captured and will be used when the session is created.
  async function saveIdeaParams() {
    try {
      if (editingSession) {
        await updateDoc(doc(db, 'sessions', editingSession.id), {
          phaseConfig: config.phaseConfig,
        })
      }
      flashDefaultFeedback('ideaParameters', editingSession
        ? 'Saved to this session.'
        : 'Saved — used when you create the session.')
    } catch (err) {
      console.error('Could not save idea parameters:', err)
      flashDefaultFeedback('ideaParameters', 'Could not save (check Firestore rules).')
      throw err
    }
  }

  // Persist the current idea parameters as the default for every new session.
  async function saveIdeaParamsAsDefault() {
    const { maxIdeasIndividual, ideasCarriedToGroup, groupSize } = config.phaseConfig
    try {
      await setDoc(
        doc(db, 'settings', 'contentDefaults'),
        { ideaParameters: { maxIdeasIndividual, ideasCarriedToGroup, groupSize } },
        { merge: true }
      )
      flashDefaultFeedback('ideaParameters', 'Saved — new sessions will start with these.')
    } catch (err) {
      console.error('Could not save idea parameters default:', err)
      flashDefaultFeedback('ideaParameters', 'Could not save (check Firestore rules).')
      throw err
    }
  }

  // Delete the saved idea-parameters default and restore the built-in values.
  async function restoreIdeaParamsBuiltin() {
    try {
      await setDoc(
        doc(db, 'settings', 'contentDefaults'),
        { ideaParameters: deleteField() },
        { merge: true }
      )
      setConfig(c => ({
        ...c,
        phaseConfig: {
          ...c.phaseConfig,
          maxIdeasIndividual: DEFAULT_CONFIG.phaseConfig.maxIdeasIndividual,
          ideasCarriedToGroup: DEFAULT_CONFIG.phaseConfig.ideasCarriedToGroup,
          groupSize: DEFAULT_CONFIG.phaseConfig.groupSize,
        },
      }))
      flashDefaultFeedback('ideaParameters', 'Built-in defaults restored.')
    } catch (err) {
      console.error('Could not restore idea parameters:', err)
      flashDefaultFeedback('ideaParameters', 'Could not restore (check Firestore rules).')
      throw err
    }
  }

  // ── Phase Timers: Save / Make this the default / Restore built-in ──
  // "Save" commits the current timer durations. When editing a session it writes
  // them to that session immediately; in create mode the values are already
  // captured and will be used when the session is created.
  async function savePhaseTimers() {
    try {
      if (editingSession) {
        await updateDoc(doc(db, 'sessions', editingSession.id), {
          phaseConfig: config.phaseConfig,
        })
      }
      flashDefaultFeedback('phaseTimers', editingSession
        ? 'Saved to this session.'
        : 'Saved — used when you create the session.')
    } catch (err) {
      console.error('Could not save phase timers:', err)
      flashDefaultFeedback('phaseTimers', 'Could not save (check Firestore rules).')
      throw err
    }
  }

  // Persist the current phase timers as the default for every new session.
  async function savePhaseTimersAsDefault() {
    const { individualPhaseDuration, groupPhaseDuration } = config.phaseConfig
    try {
      await setDoc(
        doc(db, 'settings', 'contentDefaults'),
        { phaseTimers: { individualPhaseDuration, groupPhaseDuration } },
        { merge: true }
      )
      flashDefaultFeedback('phaseTimers', 'Saved — new sessions will start with these.')
    } catch (err) {
      console.error('Could not save phase timers default:', err)
      flashDefaultFeedback('phaseTimers', 'Could not save (check Firestore rules).')
      throw err
    }
  }

  // Delete the saved phase-timers default and restore the built-in values.
  async function restorePhaseTimersBuiltin() {
    try {
      await setDoc(
        doc(db, 'settings', 'contentDefaults'),
        { phaseTimers: deleteField() },
        { merge: true }
      )
      setConfig(c => ({
        ...c,
        phaseConfig: {
          ...c.phaseConfig,
          individualPhaseDuration: DEFAULT_CONFIG.phaseConfig.individualPhaseDuration,
          groupPhaseDuration: DEFAULT_CONFIG.phaseConfig.groupPhaseDuration,
        },
      }))
      flashDefaultFeedback('phaseTimers', 'Built-in defaults restored.')
    } catch (err) {
      console.error('Could not restore phase timers:', err)
      flashDefaultFeedback('phaseTimers', 'Could not restore (check Firestore rules).')
      throw err
    }
  }

  async function createSession() {
    setCreateError('')

    // Resolve the session code: a custom one if the admin typed it, otherwise
    // an auto-generated short code. Custom codes are a single word of capital
    // letters and digits (3–40 chars) — the same normalisation the join page
    // applies — so what the admin shares can always be typed back in.
    const raw = newCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    let code
    if (raw) {
      if (!/^[A-Z0-9]{3,40}$/.test(raw)) {
        setCreateError('Session ID must be a single word of 3–40 capital letters and digits (no spaces or dashes).')
        return
      }
      code = raw
    } else {
      code = generateCode()
    }

    setCreating(true)
    setLastCreatedCode(null)
    try {
      // Reject a duplicate code (custom or, very rarely, a generated collision).
      const dup = await getDocs(query(collection(db, 'sessions'), where('code', '==', code)))
      if (!dup.empty) {
        setCreateError(raw
          ? 'That Session ID is already in use. Please choose another.'
          : 'Code collision — please try creating the session again.')
        setCreating(false)
        return
      }

      await addDoc(collection(db, 'sessions'), {
        code,
        name: newName.trim() || null,
        instructorId: user.uid,
        instructorName: user.displayName || user.email,
        status: 'waiting',
        joinCount: 0, // monotonic join counter -> deterministic, race-free grouping
        createdAt: serverTimestamp(),
        ...config,
      })
      setLastCreatedCode(code)
      setNewName('')
      setNewCode('')
    } catch (err) {
      console.error(err)
      setCreateError('Could not create the session. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  async function saveEdit() {
    if (!editingSession) return
    await updateDoc(doc(db, 'sessions', editingSession.id), {
      phaseConfig: config.phaseConfig,
      aiConfig: config.aiConfig,
      contentConfig: config.contentConfig,
      registrationConfig: config.registrationConfig,
      surveyConfig: config.surveyConfig,
    })
    setEditingSession(null)
    setConfig(freshConfig(customDefaults))
  }

  function startEdit(session) {
    setLastCreatedCode(null)
    setEditingSession(session)
    // getContent merges saved overrides over defaults so every field is populated.
    setConfig({
      phaseConfig: session.phaseConfig,
      aiConfig: session.aiConfig,
      contentConfig: getContent(session),
      registrationConfig: getRegistration(session),
      surveyConfig: { questions: getSurveyQuestions(session) },
    })
  }

  function cancelEdit() {
    setEditingSession(null)
    setConfig(freshConfig(customDefaults))
  }

  async function deleteSession(sessionId) {
    await deleteDoc(doc(db, 'sessions', sessionId))
    setDeleteConfirm(null)
  }

  // "Close Session" — mark a session as completed without deleting it. It moves
  // out of Active Sessions into Completed Sessions (which filters on the 'done'
  // status), where it stays read-only for review/export. Useful for closing out
  // sessions that were only used for testing or that never finished on their own.
  async function closeSession(sessionId) {
    await updateDoc(doc(db, 'sessions', sessionId), {
      status: 'done',
      completedAt: serverTimestamp(),
    })
    setCloseConfirm(null)
  }

  // ── Bulk "Delete all" actions ─────────────────────────────────────────────
  // Sessions are deleted directly (the instructor owns them). Registered
  // accounts live in Firebase Auth, which only the Admin SDK can delete, so
  // that runs through the deleteAllRegisteredUsers callable.
  async function runBulkDelete() {
    if (!bulkConfirm) return
    setBulkBusy(true)
    try {
      if (bulkConfirm === 'active') {
        await Promise.allSettled(activeSessions.map(s => deleteDoc(doc(db, 'sessions', s.id))))
      } else if (bulkConfirm === 'completed') {
        await Promise.allSettled(completedSessions.map(s => deleteDoc(doc(db, 'sessions', s.id))))
      } else if (bulkConfirm === 'users') {
        await httpsCallable(functions, 'deleteAllRegisteredUsers')()
        await loadUsers()
      }
    } catch (err) {
      console.error('Bulk delete failed:', err)
    } finally {
      setBulkBusy(false)
      setBulkConfirm(null)
    }
  }

  // Permanently remove ONE registered account. The deleteRegisteredUser callable
  // first detaches them from any active group (which then continues with one
  // fewer member, under the same parameters) and then deletes the Auth account.
  async function removeUser(uid) {
    setRemovingUserUid(uid)
    try {
      await httpsCallable(functions, 'deleteRegisteredUser')({ uid })
      await loadUsers()
    } catch (err) {
      console.error('deleteRegisteredUser failed:', err)
      alert('Could not remove this user: ' + (err?.message || 'unknown error'))
    } finally {
      setRemovingUserUid(null)
      setRemoveUserConfirm(null)
    }
  }

  const pc = config.phaseConfig
  const ac = config.aiConfig
  const bothActive = pc.individualPhaseActive && pc.groupPhaseActive

  const activeSessions = sessions
    .filter(s => !['done', 'survey'].includes(s.status))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))

  const completedSessions = sessions
    .filter(s => ['done', 'survey'].includes(s.status))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))

  // ── Registered users + their participation ───────────────────────────────
  const sessionsById = useMemo(
    () => Object.fromEntries(sessions.map(s => [s.id, s])),
    [sessions]
  )

  const countFor = sid => participantsBySession[sid]?.length || 0

  // uid -> [{ sessionId, code, status, joinedAt, ... }] built from the
  // participant docs of every session the instructor owns.
  const participationByUid = useMemo(() => {
    const map = {}
    Object.entries(participantsBySession).forEach(([sid, parts]) => {
      const sess = sessionsById[sid]
      parts.forEach(p => {
        if (!map[p.id]) map[p.id] = []
        map[p.id].push({
          sessionId: sid,
          code: sess?.code || sid,
          status: p.status,
          joinedAt: p.joinedAt,
          anonymousLabel: p.anonymousLabel,
          surveyCompletedAt: p.surveyCompletedAt,
          email: p.email,
          name: p.name,
        })
      })
    })
    return map
  }, [participantsBySession, sessionsById])

  // The Firebase Auth list (listRegisteredUsers) is the authoritative roster of
  // registered accounts. Participation is only used to BACKFILL it when that
  // callable is unavailable (not deployed / errored) — otherwise an account the
  // admin just deleted would be resurrected from its intentionally-retained
  // participant docs, so it would never disappear from this list. The admin
  // account is excluded.
  const registeredUsers = useMemo(() => {
    const byUid = {}
    authUsers.forEach(u => {
      if (u.email === ADMIN_EMAIL) return
      byUid[u.uid] = {
        uid: u.uid, email: u.email, name: u.displayName,
        createdAt: u.createdAt, lastSignInAt: u.lastSignInAt, fromAuth: true,
      }
    })
    if (usersError) {
      Object.entries(participationByUid).forEach(([uid, parts]) => {
        if (byUid[uid]) return
        const sample = parts[0] || {}
        if (sample.email === ADMIN_EMAIL) return
        byUid[uid] = {
          uid, email: sample.email || '', name: sample.name || '',
          createdAt: null, lastSignInAt: null, fromAuth: false,
        }
      })
    }
    return Object.values(byUid)
      .map(u => ({ ...u, sessions: participationByUid[u.uid] || [] }))
      .sort((a, b) =>
        (b.sessions.length - a.sessions.length) ||
        (a.email || '').localeCompare(b.email || '')
      )
  }, [authUsers, participationByUid, usersError])

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return registeredUsers
    return registeredUsers.filter(u =>
      (u.email || '').toLowerCase().includes(q) ||
      (u.name || '').toLowerCase().includes(q)
    )
  }, [registeredUsers, userSearch])

  const phases = []
  if (pc.individualPhaseActive) phases.push('Individual')
  if (pc.groupPhaseActive) phases.push('Group Ideation', 'Group Voting')
  const phaseStr = pc.phaseOrder === 'group_first' ? [...phases].reverse().join(' \u2192 ') : phases.join(' \u2192 ')
  const timers = [
    pc.individualPhaseActive && pc.individualPhaseDuration && `${Math.round(pc.individualPhaseDuration / 60)}min individual`,
    pc.groupPhaseActive && pc.groupPhaseDuration && `${Math.round(pc.groupPhaseDuration / 60)}min group ideation`,
    pc.groupPhaseActive && pc.votingDuration && `${Math.round(pc.votingDuration / 60)}min group voting`,
  ].filter(Boolean)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <div className={styles.headerRight}>
          <span className={styles.role}>Instructor</span>
          <button className={styles.themeBtn} onClick={toggle} title="Toggle dark mode">
            {dark ? '\u2600' : '\u263E'}
          </button>
          <button className="btn-ghost" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => navigate('/admin')}>Admin</button>
          <button className="btn-ghost" onClick={() => navigate('/admin/data-analytics')}>Data Analytics</button>
          <button className="btn-ghost" onClick={() => navigate('/admin/ai-settings')}>AI Settings</button>
          <button className="btn-ghost" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.columns}>
          <div className={styles.leftCol}>
            <div className="card">
              <h2 className={styles.cardTitle}>
                {editingSession ? `Edit Session \u2014 ${editingSession.code}` : 'Create New Session'}
                {editingSession && <span className={styles.editBadge}>editing</span>}
              </h2>
              <p className={styles.cardSubtitle}>
                {editingSession
                  ? 'Adjust the configuration for this session. Changes apply immediately on save.'
                  : 'Configure the session structure, timers, and AI assistance before launching.'}
              </p>

              <div className={`${styles.section} ${styles.aiBox}`}>
                <h3 className={styles.subTitle}>AI Assistant</h3>
                <p className={styles.sectionHint}>Enable AI assistance per phase. Provider and model are configured globally in AI Settings.</p>
                <div className={styles.grid2}>
                  <Toggle label="AI in Individual Phase" checked={ac.individualAI} onChange={v => setAI('individualAI', v)} disabled={!pc.individualPhaseActive} />
                  <Toggle label="AI in Group Phase" checked={ac.groupAI} onChange={v => setAI('groupAI', v)} disabled={!pc.groupPhaseActive} />
                </div>
              </div>

              <div className={styles.section}>
                <h3 className={styles.subTitle}>Phases</h3>
                <p className={styles.sectionHint}>Select which phases to include and the order participants will move through them.</p>
                <div className={styles.grid2}>
                  <Toggle label="Individual Phase" checked={pc.individualPhaseActive} onChange={v => setPhase('individualPhaseActive', v)} />
                  <Toggle label="Group Phase" checked={pc.groupPhaseActive} onChange={v => setPhase('groupPhaseActive', v)} />
                </div>
                {bothActive && (
                  <div className={styles.field}>
                    <label className={styles.label}>Phase Order</label>
                    <select className="input-field" value={pc.phaseOrder} onChange={e => setPhase('phaseOrder', e.target.value)}>
                      <option value="individual_first">Individual first, then Group</option>
                      <option value="group_first">Group first, then Individual</option>
                    </select>
                  </div>
                )}
              </div>

              <div className={styles.section}>
                <h3 className={styles.subTitle}>Idea Parameters</h3>
                <p className={styles.sectionHint}>Control how many ideas each participant can submit and how many carry forward into the group phase.</p>
                <div className={styles.grid2}>
                  <NumberField label="Max ideas (individual)" value={pc.maxIdeasIndividual} min={1} max={20} onChange={v => setPhase('maxIdeasIndividual', v)} disabled={!pc.individualPhaseActive} />
                  <NumberField label="Ideas carried to group" value={pc.ideasCarriedToGroup} min={1} max={pc.maxIdeasIndividual} onChange={v => setPhase('ideasCarriedToGroup', v)} disabled={!pc.individualPhaseActive || !pc.groupPhaseActive} />
                </div>
                {pc.groupPhaseActive && (
                  <div className={styles.grid2} style={{ marginTop: 12 }}>
                    <NumberField label="Participants per group (1 = solo test)" value={pc.groupSize} min={1} max={10} onChange={v => setPhase('groupSize', v)} />
                  </div>
                )}
                <div className={styles.contentBtnRow} style={{ marginTop: 16 }}>
                  <ConfirmButton
                    className={styles.contentDefaultBtn}
                    onClick={saveIdeaParams}
                    confirmedLabel="Saved ✓"
                    title="Save these idea parameters (applies to the session you are editing)"
                  >
                    Save
                  </ConfirmButton>
                  <ConfirmButton
                    className={styles.contentDefaultBtn}
                    onClick={saveIdeaParamsAsDefault}
                    confirmedLabel="Default set ✓"
                    title="Make these idea parameters the default for every new session"
                  >
                    Make this the default
                  </ConfirmButton>
                  <ConfirmButton
                    className={styles.contentResetBtn}
                    onClick={restoreIdeaParamsBuiltin}
                    confirmedLabel="Restored ✓"
                    title="Delete the saved default and restore the built-in idea parameters"
                  >
                    Restore built-in default
                  </ConfirmButton>
                  {defaultFeedback?.key === 'ideaParameters' && (
                    <span className={styles.contentSavedNote}>{defaultFeedback.text}</span>
                  )}
                </div>
              </div>

              <div className={styles.section}>
                <h3 className={styles.subTitle}>Phase Timers (minutes &amp; seconds, blank = manual)</h3>
                <p className={styles.sectionHint}>Set a countdown for each phase as minutes and seconds, or leave both blank to advance manually from the host control room.</p>
                <div className={styles.grid2}>
                  <DurationField label="Individual" seconds={pc.individualPhaseDuration} onChange={v => setPhase('individualPhaseDuration', v)} disabled={!pc.individualPhaseActive} />
                  <DurationField label="Group (ideation + voting)" seconds={pc.groupPhaseDuration} onChange={v => setPhase('groupPhaseDuration', v)} disabled={!pc.groupPhaseActive} />
                </div>
                <div className={styles.contentBtnRow} style={{ marginTop: 16 }}>
                  <ConfirmButton
                    className={styles.contentDefaultBtn}
                    onClick={savePhaseTimers}
                    confirmedLabel="Saved ✓"
                    title="Save these phase timers (applies to the session you are editing)"
                  >
                    Save
                  </ConfirmButton>
                  <ConfirmButton
                    className={styles.contentDefaultBtn}
                    onClick={savePhaseTimersAsDefault}
                    confirmedLabel="Default set ✓"
                    title="Make these phase timers the default for every new session"
                  >
                    Make this the default
                  </ConfirmButton>
                  <ConfirmButton
                    className={styles.contentResetBtn}
                    onClick={restorePhaseTimersBuiltin}
                    confirmedLabel="Restored ✓"
                    title="Delete the saved default and restore the built-in phase timers"
                  >
                    Restore built-in default
                  </ConfirmButton>
                  {defaultFeedback?.key === 'phaseTimers' && (
                    <span className={styles.contentSavedNote}>{defaultFeedback.text}</span>
                  )}
                </div>
              </div>

              <div className={styles.section}>
                <h3 className={styles.subTitle}>Page Text &amp; Content</h3>
                <p className={styles.sectionHint}>
                  Edit the wording participants see on every page after they join. Leave a
                  field blank to fall back to the default. Use <code>**bold**</code> for emphasis,
                  blank lines for new paragraphs, and keep <code>{'{placeholders}'}</code> intact.
                  &ldquo;Make this the default&rdquo; saves a page&rsquo;s current text as the
                  starting text for every future session. Drag an editor&rsquo;s
                  bottom-right corner to make it larger. Start a line with <code>[AI]</code> to
                  show it only when AI is enabled (phase pages use their own phase&rsquo;s AI
                  setting; other pages show it if either phase has AI on).
                </p>
                <ContentEditor
                  content={config.contentConfig}
                  onField={setContentField}
                  onSaveGroup={saveContentGroup}
                  onSaveDefault={saveContentGroupAsDefault}
                  onRestoreBuiltin={restoreBuiltinDefault}
                  customDefaults={customDefaults}
                  feedback={defaultFeedback}
                />
              </div>

              <div className={styles.section}>
                <h3 className={styles.subTitle}>Registration Form</h3>
                <p className={styles.sectionHint}>The demographic questions and consent checkboxes participants complete when they join.</p>
                <Collapsible label="Edit registration questions">
                  <RegistrationBuilder value={config.registrationConfig} onChange={setRegistrationConfig} />
                  <DefaultActions
                    onSave={() => saveBuilder('registrationForm')}
                    onMakeDefault={() => saveBuilderAsDefault('registrationForm')}
                    onRestore={() => restoreBuilderBuiltin('registrationForm')}
                    hasCustom={!!customDefaults?.registrationForm}
                    feedback={defaultFeedback?.key === 'registrationForm' ? defaultFeedback.text : null}
                  />
                </Collapsible>
              </div>

              <div className={styles.section}>
                <h3 className={styles.subTitle}>Survey Questions</h3>
                <p className={styles.sectionHint}>The post-session survey. Edit, reorder, add or remove questions and their answers.</p>
                <Collapsible label="Edit survey questions">
                  <SurveyBuilder value={config.surveyConfig} onChange={setSurveyConfig} />
                  <DefaultActions
                    onSave={() => saveBuilder('surveyQuestions')}
                    onMakeDefault={() => saveBuilderAsDefault('surveyQuestions')}
                    onRestore={() => restoreBuilderBuiltin('surveyQuestions')}
                    hasCustom={!!customDefaults?.surveyQuestions}
                    feedback={defaultFeedback?.key === 'surveyQuestions' ? defaultFeedback.text : null}
                  />
                </Collapsible>
              </div>

              {!editingSession && (
                <div className={styles.section}>
                  <h3 className={styles.subTitle}>Session details</h3>
                  <div className={styles.field}>
                    <label className={styles.label}>Session name</label>
                    <input
                      className="input-field"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="e.g. Spring MBA 2026"
                    />
                  </div>
                  <div className={styles.field} style={{ marginTop: 12 }}>
                    <label className={styles.label}>Session ID</label>
                    <input
                      className="input-field"
                      value={newCode}
                      onChange={e => { setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setCreateError('') }}
                      placeholder="(OPTIONAL) CUSTOM CODE"
                      maxLength={40}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <p className={styles.sectionHint}>Leave blank to auto-generate a short code. Single word — capital letters and digits only, no spaces or dashes (3–40 chars).</p>
                    {createError && <p className="error-msg">{createError}</p>}
                  </div>
                </div>
              )}

              <div className={styles.formActions}>
                {editingSession ? (
                  <>
                    <button className="btn-primary" onClick={saveEdit}>Save Changes</button>
                    <button className="btn-ghost" onClick={cancelEdit}>Cancel</button>
                  </>
                ) : (
                  <button className="btn-primary" onClick={createSession} disabled={creating || (!pc.individualPhaseActive && !pc.groupPhaseActive)}>
                    {creating ? 'Creating...' : 'Create Session'}
                  </button>
                )}
              </div>

              {lastCreatedCode && (
                <div className={styles.createdCodeBox}>
                  <p className={styles.createdCodeLabel}>Session created! Share this code with participants:</p>
                  <div className={styles.createdCode}>{lastCreatedCode}</div>
                  <p className={styles.createdCodeHint}>Share this code before your session begins. Participants join at: <a href="https://www.stouras.com/lab/ideasearchlab/join" target="_blank" rel="noreferrer">stouras.com/lab/ideasearchlab/join</a></p>
                </div>
              )}

              <div className={styles.summary}>
                <h3 className={styles.summaryTitle}>Setup Summary</h3>
                <p className={styles.sectionHint}>A quick snapshot of the configuration you are about to launch. You can run multiple sessions with different settings independently.</p>
                <div className={styles.summaryGrid}>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Phases</span>
                    <span className={styles.summaryValue}>{phaseStr || 'None selected'}</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Timers</span>
                    <span className={styles.summaryValue}>{timers.length ? timers.join(', ') : 'Manual only'}</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Ideas</span>
                    <span className={styles.summaryValue}>Max {pc.maxIdeasIndividual}, carry {pc.ideasCarriedToGroup} to group</span>
                  </div>
                  {pc.groupPhaseActive && (
                    <div className={styles.summaryRow}>
                      <span className={styles.summaryLabel}>Group size</span>
                      <span className={styles.summaryValue}>{pc.groupSize} per group</span>
                    </div>
                  )}
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>AI</span>
                    <span className={styles.summaryValue}>Individual: {ac.individualAI ? 'On' : 'Off'} / Group: {ac.groupAI ? 'On' : 'Off'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.rightCol}>
            <div className="card">
              <h2 className={styles.cardTitle}>
                Active Sessions
                <span className={styles.countBadge}>{activeSessions.length} active</span>
              </h2>
              <p className={styles.cardSubtitle}>Open a session to monitor progress, advance phases, and manage participants in real time.</p>
              {activeSessions.length > 0 && (
                <button className={styles.bulkDeleteBtn} type="button" onClick={() => setBulkConfirm('active')}>
                  Delete all active sessions
                </button>
              )}
              {activeSessions.length === 0 ? (
                <div className={styles.empty}>No active sessions. Create one to get started.</div>
              ) : (
                <div className={styles.sessionList}>
                  {activeSessions.map(s => (
                    <SessionCard key={s.id} session={s} participantCount={countFor(s.id)}
                      onOpen={() => navigate(`/admin/session/${s.id}`)}
                      onEdit={() => startEdit(s)}
                      onClose={() => setCloseConfirm(s.id)}
                      onDelete={() => setDeleteConfirm(s.id)}
                      canEdit={s.status === 'waiting'} />
                  ))}
                </div>
              )}
              <p className={styles.joinHint}>Participants join by entering the session code at the join page. No account required.</p>
            </div>

            {completedSessions.length > 0 && (
              <div className="card" style={{ marginTop: 20 }}>
                <h2 className={styles.cardTitle}>
                  Completed Sessions
                  <span className={styles.countBadge}>{completedSessions.length} total</span>
                </h2>
                <p className={styles.cardSubtitle}>Completed sessions are read-only. Review responses or export data before deleting.</p>
                <button className={styles.bulkDeleteBtn} type="button" onClick={() => setBulkConfirm('completed')}>
                  Delete all completed sessions
                </button>
                <div className={styles.sessionList}>
                  {completedSessions.map(s => (
                    <SessionCard key={s.id} session={s} participantCount={countFor(s.id)}
                      onOpen={() => navigate(`/admin/session/${s.id}`)}
                      onDelete={() => setDeleteConfirm(s.id)}
                      canEdit={false} />
                  ))}
                </div>
              </div>
            )}

            <div className="card" style={{ marginTop: 20 }}>
              <h2 className={styles.cardTitle}>
                Registered Users
                <span className={styles.countBadge}>{registeredUsers.length} total</span>
              </h2>
              <p className={styles.cardSubtitle}>
                Everyone who created an account, with the sessions each person has joined.
                {usersError && ' Showing only users who joined a session — deploy the listRegisteredUsers function to include accounts that never joined.'}
              </p>
              {registeredUsers.length > 0 && (
                <button className={styles.bulkDeleteBtn} type="button" onClick={() => setBulkConfirm('users')}>
                  Delete all registered users
                </button>
              )}
              <UsersPanel
                users={filteredUsers}
                totalCount={registeredUsers.length}
                search={userSearch}
                onSearch={setUserSearch}
                loading={usersLoading && authUsers.length === 0 && registeredUsers.length === 0}
                expandedUser={expandedUser}
                onToggle={uid => setExpandedUser(prev => (prev === uid ? null : uid))}
                onRefresh={loadUsers}
                onOpenSession={sid => navigate(`/admin/session/${sid}`)}
                onRemoveUser={u => setRemoveUserConfirm(u)}
                removingUserUid={removingUserUid}
              />
            </div>
          </div>
        </div>
      </main>

      {closeConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Close Session?</h3>
            <p className={styles.modalDesc}>This marks the session as completed and moves it to Completed Sessions. Participants can no longer join or take part, but the session and all its data are kept so you can still review and export them.</p>
            <div className={styles.modalActions}>
              <button className="btn-primary" onClick={() => closeSession(closeConfirm)}>Close session</button>
              <button className="btn-ghost" onClick={() => setCloseConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Delete Session?</h3>
            <p className={styles.modalDesc}>This permanently deletes the session and all its data. Cannot be undone.</p>
            <div className={styles.modalActions}>
              <button className="btn-primary" style={{ background: '#c0392b' }} onClick={() => deleteSession(deleteConfirm)}>Delete permanently</button>
              <button className="btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {bulkConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>
              {bulkConfirm === 'active' && `Delete all ${activeSessions.length} active session${activeSessions.length === 1 ? '' : 's'}?`}
              {bulkConfirm === 'completed' && `Delete all ${completedSessions.length} completed session${completedSessions.length === 1 ? '' : 's'}?`}
              {bulkConfirm === 'users' && `Delete all ${registeredUsers.length} registered user${registeredUsers.length === 1 ? '' : 's'}?`}
            </h3>
            <p className={styles.modalDesc}>
              {bulkConfirm === 'users'
                ? 'This permanently deletes every registered account except the admin. It cannot be undone. (Requires the deleteAllRegisteredUsers Cloud Function to be deployed.)'
                : 'This permanently deletes all of these sessions and their data. It cannot be undone.'}
            </p>
            <div className={styles.modalActions}>
              <button className="btn-primary" style={{ background: '#c0392b' }} onClick={runBulkDelete} disabled={bulkBusy}>
                {bulkBusy ? 'Deleting...' : 'Delete all permanently'}
              </button>
              <button className="btn-ghost" onClick={() => setBulkConfirm(null)} disabled={bulkBusy}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {removeUserConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Remove this user?</h3>
            <p className={styles.modalDesc}>
              This permanently deletes the account
              {removeUserConfirm.email ? <> <strong>{removeUserConfirm.email}</strong></> : ''}.
              {removeUserConfirm.sessions?.length > 0
                ? ` They are in ${removeUserConfirm.sessions.length} session${removeUserConfirm.sessions.length === 1 ? '' : 's'}: any group they are still actively playing in will simply continue with one fewer member, under the same settings. Records from sessions they already finished are kept.`
                : ' They have not joined any session.'}
              {' '}This cannot be undone.
            </p>
            <div className={styles.modalActions}>
              <button
                className="btn-primary"
                style={{ background: '#c0392b' }}
                onClick={() => removeUser(removeUserConfirm.uid)}
                disabled={removingUserUid === removeUserConfirm.uid}
              >
                {removingUserUid === removeUserConfirm.uid ? 'Removing…' : 'Remove user'}
              </button>
              <button
                className="btn-ghost"
                onClick={() => setRemoveUserConfirm(null)}
                disabled={removingUserUid === removeUserConfirm.uid}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SessionCard({ session, participantCount, onOpen, onEdit, onClose, onDelete, canEdit }) {
  const pc = session.phaseConfig || {}
  const phases = [pc.individualPhaseActive && 'Individual', pc.groupPhaseActive && 'Group'].filter(Boolean).join(' + ')
  const created = session.createdAt?.seconds
    ? new Date(session.createdAt.seconds * 1000)
    : null
  const createdStr = created
    ? `${created.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}, ${created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : null
  return (
    <div className={styles.sessionCard}>
      <div className={styles.sessionCardTop}>
        <div className={styles.sessionCardLeft}>
          <span className={styles.sessionCode}>{session.code}</span>
          {/* A session only reaches 'survey' once every participant has, and it is
              then filed under Completed Sessions — so a 'survey' badge there read
              as if work was still happening. Show it (and 'done') as "done". */}
          {(() => {
            const shown = session.status === 'survey' ? 'done' : session.status
            return <span className={`${styles.statusBadge} ${styles['status_' + shown]}`}>{shown}</span>
          })()}
        </div>
        <div className={styles.sessionCardRight}>
          <span className={styles.participantCount}>{participantCount} participants</span>
          <span className={styles.phasesMeta}>{phases}</span>
        </div>
      </div>
      {session.name && <div className={styles.sessionName}>{session.name}</div>}
      {createdStr && <div className={styles.sessionDate}>Created {createdStr}</div>}
      <div className={styles.sessionCardActions}>
        <button className="btn-primary" style={{ padding: '6px 18px', fontSize: 13 }} onClick={onOpen}>Open</button>
        {canEdit && <button className="btn-ghost" style={{ padding: '6px 18px', fontSize: 13 }} onClick={onEdit}>Edit</button>}
        {onClose && <button className={styles.closeBtn} onClick={onClose}>Close Session</button>}
        <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
      </div>
    </div>
  )
}

// Accepts a Firestore Timestamp ({seconds}) or an ISO/date string (Auth
// metadata is returned as ISO strings by the callable). Returns a short date.
function formatWhen(value) {
  if (!value) return null
  const d = value.seconds ? new Date(value.seconds * 1000) : new Date(value)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

// Maps a participant's own status to one of the existing status badge classes.
const USER_STATUS_CLASS = {
  waiting: 'waiting', waiting_for_group: 'waiting', individual: 'individual',
  group: 'group', voting: 'voting', survey: 'survey', done: 'done',
}

function UsersPanel({ users, totalCount, search, onSearch, loading, expandedUser, onToggle, onRefresh, onOpenSession, onRemoveUser, removingUserUid }) {
  return (
    <div className={styles.usersWrap}>
      <div className={styles.usersToolbar}>
        <input
          className={`input-field ${styles.userSearch}`}
          placeholder="Search by email or name…"
          value={search}
          onChange={e => onSearch(e.target.value)}
        />
        <button className="btn-ghost" style={{ padding: '8px 14px', fontSize: 13 }} onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className={styles.empty}>Loading users…</div>
      ) : users.length === 0 ? (
        <div className={styles.empty}>
          {totalCount === 0 ? 'No registered users yet.' : 'No users match your search.'}
        </div>
      ) : (
        <div className={styles.userList}>
          {users.map(u => {
            const open = expandedUser === u.uid
            const registered = formatWhen(u.createdAt)
            const lastSeen = formatWhen(u.lastSignInAt)
            const sorted = [...u.sessions].sort(
              (a, b) => (b.joinedAt?.seconds || 0) - (a.joinedAt?.seconds || 0)
            )
            return (
              <div key={u.uid} className={styles.userCard}>
                <button type="button" className={styles.userHead} onClick={() => onToggle(u.uid)}>
                  <div className={styles.userIdentity}>
                    <span className={styles.userEmail}>{u.email || '(no email)'}</span>
                    {u.name && <span className={styles.userFullName}>{u.name}</span>}
                  </div>
                  <div className={styles.userMetaRight}>
                    <span className={styles.userSessionCount}>
                      {u.sessions.length} session{u.sessions.length === 1 ? '' : 's'}
                    </span>
                    <span className={styles.contentChevron}>{open ? '▲' : '▼'}</span>
                  </div>
                </button>

                {open && (
                  <div className={styles.userBody}>
                    <div className={styles.userFacts}>
                      {registered && <span>Registered {registered}</span>}
                      {lastSeen && <span>· Last sign-in {lastSeen}</span>}
                      {!u.fromAuth && <span className={styles.userFlag}>· account details unavailable</span>}
                    </div>
                    {sorted.length === 0 ? (
                      <div className={styles.userNoSessions}>Hasn&rsquo;t joined any session yet.</div>
                    ) : (
                      <div className={styles.userSessions}>
                        {sorted.map(s => (
                          <div key={s.sessionId} className={styles.userSessionRow}>
                            <span className={styles.userSessionCode}>{s.code}</span>
                            <span className={`${styles.statusBadge} ${styles['status_' + (USER_STATUS_CLASS[s.status] || 'done')]}`}>
                              {s.status || 'unknown'}
                            </span>
                            {s.anonymousLabel && <span className={styles.userSessionLabel}>{s.anonymousLabel}</span>}
                            <button className={styles.userOpenBtn} onClick={() => onOpenSession(s.sessionId)}>Open</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {onRemoveUser && (
                      <div className={styles.userActions}>
                        <button
                          className={styles.userRemoveBtn}
                          type="button"
                          onClick={() => onRemoveUser(u)}
                          disabled={removingUserUid === u.uid}
                          title="Permanently delete this account; any active group of theirs continues with one fewer member"
                        >
                          {removingUserUid === u.uid ? 'Removing…' : 'Remove user'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className={`${styles.toggle} ${disabled ? styles.toggleDisabled : ''}`}>
      <span className={styles.toggleLabel}>{label}</span>
      <div className={`${styles.toggleTrack} ${checked && !disabled ? styles.toggleOn : ''}`} onClick={() => !disabled && onChange(!checked)}>
        <div className={styles.toggleThumb} />
      </div>
    </label>
  )
}

function NumberField({ label, value, min, max, onChange, disabled, nullable }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <input className="input-field" type="number" value={value ?? ''} min={min} max={max} disabled={disabled}
        onChange={e => onChange(e.target.value === '' ? null : parseInt(e.target.value))} />
    </div>
  )
}

// A phase-duration input split into minutes and seconds. The value is stored as
// a single total-seconds number (or null = manual / no timer). Leaving both
// boxes blank clears the timer; otherwise the total is minutes*60 + seconds.
function DurationField({ label, seconds, onChange, disabled }) {
  const hasVal = seconds != null && seconds !== ''
  const mins = hasVal ? Math.floor(seconds / 60) : ''
  const secs = hasVal ? seconds % 60 : ''
  function update(nextMins, nextSecs) {
    const mEmpty = nextMins === '' || nextMins == null
    const sEmpty = nextSecs === '' || nextSecs == null
    if (mEmpty && sEmpty) { onChange(null); return } // both blank = manual
    const m = Math.max(0, parseInt(nextMins) || 0)
    const s = Math.max(0, parseInt(nextSecs) || 0)
    onChange(m * 60 + s)
  }
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <div className={styles.durationRow}>
        <input
          className={`input-field ${styles.durationInput}`}
          type="number" min={0} placeholder="min" value={mins} disabled={disabled}
          onChange={e => update(e.target.value, secs)}
        />
        <span className={styles.durationUnit}>min</span>
        <input
          className={`input-field ${styles.durationInput}`}
          type="number" min={0} max={59} placeholder="sec" value={secs} disabled={disabled}
          onChange={e => update(mins, e.target.value)}
        />
        <span className={styles.durationUnit}>sec</span>
      </div>
    </div>
  )
}

// A button that briefly turns green to confirm the action ran, then reverts.
// Used for the admin default-management actions so a click gives clear feedback.
function ConfirmButton({ children, onClick, className, title, confirmedLabel = 'Done ✓', disabled = false }) {
  const [confirmed, setConfirmed] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function handle(e) {
    if (disabled) return
    try {
      await onClick?.(e)
    } catch (_) {
      return // action failed: don't show the green confirmation
    }
    setConfirmed(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setConfirmed(false), 2200)
  }
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={`${className || ''} ${confirmed ? styles.btnConfirmed : ''}`.trim()}
      onClick={handle}
    >
      {confirmed ? confirmedLabel : children}
    </button>
  )
}

// The default-management buttons shown under every admin-editable page/builder:
// save current state as the default for new sessions, reset the editor to the
// effective default, and (when a saved default exists) restore the built-in.
// Each turns green briefly to confirm it was pressed.
function DefaultActions({ onSave, onMakeDefault, onRestore, hasCustom, feedback }) {
  return (
    <div className={styles.contentBtnRow}>
      <ConfirmButton
        className={styles.contentDefaultBtn}
        onClick={onSave}
        confirmedLabel="Saved ✓"
        title="Save the current text (to this session when editing one)"
      >
        Save
      </ConfirmButton>
      <ConfirmButton
        className={styles.contentDefaultBtn}
        onClick={onMakeDefault}
        confirmedLabel="Default set ✓"
        title="Save the current state as the default that every new session starts with"
      >
        Make this the default
      </ConfirmButton>
      <ConfirmButton
        className={styles.contentResetBtn}
        onClick={onRestore}
        confirmedLabel="Restored ✓"
        disabled={!hasCustom}
        title={hasCustom
          ? 'Delete the saved default and go back to the built-in'
          : 'Already using the built-in default'}
      >
        Restore built-in default
      </ConfirmButton>
      {feedback && <span className={styles.contentSavedNote}>{feedback}</span>}
    </div>
  )
}

// Generic collapsible wrapper (closed by default) for long editors.
function Collapsible({ label, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.contentGroup}>
      <button type="button" className={styles.contentGroupHeader} onClick={() => setOpen(o => !o)}>
        <span>{label}</span>
        <span className={styles.contentChevron}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className={styles.contentGroupBody}>{children}</div>}
    </div>
  )
}

// Collapsible per-page editor: one full-page rich-text document per page.
function ContentEditor({ content, onField, onSaveGroup, onSaveDefault, onRestoreBuiltin, customDefaults, feedback }) {
  const [openGroup, setOpenGroup] = useState(null)

  return (
    <div className={styles.contentEditor}>
      {CONTENT_SCHEMA.map(group => {
        const isOpen = openGroup === group.key
        return (
          <div key={group.key} className={styles.contentGroup}>
            <button
              type="button"
              className={styles.contentGroupHeader}
              onClick={() => setOpenGroup(isOpen ? null : group.key)}
            >
              <span>{group.label}</span>
              <span className={styles.contentChevron}>{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className={styles.contentGroupBody}>
                {group.fields.map(field => {
                  const value = content[group.key]?.[field.key] ?? ''
                  return (
                    <div key={field.key} className={styles.contentField}>
                      {(field.label !== group.label || field.hint) && (
                        <label className={styles.contentLabel}>
                          {field.label}
                          {field.hint && <span className={styles.contentHint}> — {field.hint}</span>}
                        </label>
                      )}
                      <RichTextEditor
                        value={value}
                        placeholder={field.label}
                        onChange={html => onField(group.key, field.key, html)}
                      />
                    </div>
                  )
                })}

                <DefaultActions
                  onSave={() => onSaveGroup(group.key)}
                  onMakeDefault={() => onSaveDefault(group.key)}
                  onRestore={() => onRestoreBuiltin(group.key)}
                  hasCustom={!!customDefaults?.[group.key]}
                  feedback={feedback?.key === group.key ? feedback.text : null}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}