import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, collection, onSnapshot, getDocs, orderBy, query, where, updateDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { getPhaseSequence } from '../utils/phaseSequence'
import { getRegistration, getSurveyQuestions } from '../data/formDefaults'
import { MODEL_PRICES, USD_TO_EUR, PRICES_AS_OF, replyCostUSD } from '../data/aiPricing'
import * as XLSX from 'xlsx-js-style'
import styles from './AdminSession.module.css'

export default function AdminSession() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [participants, setParticipants] = useState([])
  const [ideas, setIdeas] = useState([])
  const [advancing, setAdvancing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [nudgedId, setNudgedId] = useState(null)
  const [expandedPid, setExpandedPid] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [removeConfirmId, setRemoveConfirmId] = useState(null)
  const [viewGroup, setViewGroup] = useState(null)     // group bucket being watched live
  const [messageTarget, setMessageTarget] = useState(null) // { kind:'group'|'participant', group?, participant? }
  const [messageText, setMessageText] = useState('')
  const [messageSending, setMessageSending] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState(() => new Set()) // group buckets drilled open

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'sessions', sessionId), snap => {
      if (snap.exists()) setSession({ id: snap.id, ...snap.data() })
    })
    return unsub
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'participants'),
      snap => setParticipants(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [sessionId])

  // Live ideas feed, used for the submitted-ideas confirmation summary below.
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'ideas'),
      snap => setIdeas(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [sessionId])

  async function advancePhase() {
    if (!session) return
    setAdvancing(true)
    try {
      await httpsCallable(functions, 'advancePhase')({ sessionId })
    } catch (err) {
      console.error('advancePhase error:', err)
    } finally {
      setAdvancing(false)
    }
  }

  // ── Data export ─────────────────────────────────────
  async function exportData() {
    if (exporting) return
    setExporting(true)
    try {
      // Fetch all data collections in parallel
      const [ideasSnap, groupsSnap, aiMessagesSnap] = await Promise.all([
        getDocs(collection(db, 'sessions', sessionId, 'ideas')),
        getDocs(collection(db, 'sessions', sessionId, 'groups')),
        getDocs(query(
          collection(db, 'sessions', sessionId, 'aiMessages'),
          orderBy('timestamp', 'asc')
        )),
      ])

      const ideas = ideasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const groups = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const aiMessages = aiMessagesSnap.docs.map(d => ({ id: d.id, ...d.data() }))

      // Which ideas each group locked in as its final (voted) selection. A
      // group's `finalIdeas` is stored top-voted-first, so the index gives the
      // rank. These maps let the Ideas sheet flag the winners directly and the
      // Groups sheet show them as titles instead of bare ids.
      const finalIdeaIds = new Set(groups.flatMap(g => g.finalIdeas || []))
      const finalIdeaRank = {}                       // ideaId -> "g2 #1 (most-voted)"
      groups.forEach(g => (g.finalIdeas || []).forEach((id, i) => {
        finalIdeaRank[id] = `${g.id} #${i + 1}`
      }))
      const authorGroupId = Object.fromEntries(participants.map(p => [p.id, p.groupId || '']))
      const ideaById = Object.fromEntries(ideas.map(i => [i.id, i]))
      const ideaTitleById = Object.fromEntries(ideas.map(i => [i.id, i.title || i.text || i.id]))

      // Fetch group chat messages from each group
      const chatMessages = []
      for (const group of groups) {
        const msgSnap = await getDocs(
          collection(db, 'sessions', sessionId, 'groups', group.id, 'messages')
        )
        msgSnap.docs.forEach(d => {
          const msg = d.data()
          chatMessages.push({ groupId: group.id, messageId: d.id, ...msg })
        })
      }

      // Build workbook
      const wb = XLSX.utils.book_new()

      // ── Sheet 1: Participants ──
      // Demographic columns are dynamic so custom registration fields export too.
      const regFields = getRegistration(session).fields
      const labelById = Object.fromEntries(regFields.map(f => [f.id, f.label]))
      const demoKeys = [...new Set([
        ...regFields.map(f => f.id),
        ...participants.flatMap(p => Object.keys(p.demographics || {})),
      ])]
      const participantRows = participants.map(p => {
        const demo = p.demographics || {}
        const row = {
          'Participant ID': p.id,
          'Name': p.name || '',
          'Email': p.email || '',
          'Anonymous Label': p.anonymousLabel || '',
          'Group ID': p.groupId || '',
          'Status': p.status || '',
          'Individual Complete': p.individualComplete ? 'Yes' : 'No',
          'Votes Submitted': p.votesSubmitted ? 'Yes' : 'No',
          'Voted For': (p.votedFor || []).join(', '),
          'Consent Given': p.consentGiven ? 'Yes' : 'No',
          'Consent Timestamp': p.consentTimestamp || '',
          'Joined At': formatTimestamp(p.joinedAt),
        }
        demoKeys.forEach(k => { row[labelById[k] || k] = demo[k] ?? '' })
        return row
      })
      const wsParticipants = XLSX.utils.json_to_sheet(participantRows)
      autoWidth(wsParticipants, participantRows)
      XLSX.utils.book_append_sheet(wb, wsParticipants, 'Participants')

      // ── Sheet 2: Ideas ──
      const ideaRows = ideas.map(idea => ({
        'Idea ID': idea.id,
        'Title': idea.title || '',
        'Description': idea.description || '',
        'Full Text': idea.text || '',
        'Author ID': idea.authorId || '',
        'Author Name': idea.authorName || '',
        'Phase': idea.phase || '',
        // Individual ideas don't carry a groupId on the doc — fall back to the
        // author's group so every idea row shows which group it belongs to.
        'Group ID': idea.groupId || authorGroupId[idea.authorId] || '',
        // Renamed from 'Selected' (which read ambiguously): this means the idea
        // was double-click-selected in the INDIVIDUAL phase to be carried into
        // the group — NOT that it was a final group choice.
        'Carried to Group': idea.selected ? 'Yes' : 'No',
        'Vote Count': countVotes(idea.id, participants),
        // The actual answer to "which ideas did the group pick after voting":
        // Yes if this idea is in its group's finalIdeas; the rank column shows
        // its position (#1 = most-voted) and which group selected it.
        'Final Group Pick': finalIdeaIds.has(idea.id) ? 'Yes' : 'No',
        'Final Pick Rank': finalIdeaRank[idea.id] || '',
        'Created At': formatTimestamp(idea.createdAt),
      }))
      const wsIdeas = XLSX.utils.json_to_sheet(ideaRows)
      autoWidth(wsIdeas, ideaRows)
      XLSX.utils.book_append_sheet(wb, wsIdeas, 'Ideas')

      // ── Sheet 3: Survey Answers ──
      // Columns follow the survey's own question order with readable titles (the
      // question text shown in the admin) instead of raw answer keys. A
      // rating_group expands to one column per criterion; a radio follow-up gets
      // its own column. Any stored answer key not in the session's survey config
      // is appended at the end under its raw key so no data is ever dropped.
      const surveyParticipants = participants.filter(p => p.surveyAnswers)
      if (surveyParticipants.length > 0) {
        const questions = getSurveyQuestions(session)
        const columns = []          // { header, key, subKey? }
        const covered = new Set()
        questions.forEach((q, i) => {
          const n = i + 1
          const qText = plain(q.text) || q.id
          if (q.type === 'rating_group' && Array.isArray(q.items) && q.items.length) {
            q.items.forEach(item => {
              columns.push({ header: `Q${n}. ${qText} — ${plain(item.label) || item.id}`, key: q.id, subKey: item.id })
            })
          } else {
            columns.push({ header: `Q${n}. ${qText}`, key: q.id })
          }
          covered.add(q.id)
          if (q.followUp && q.followUp.id) {
            columns.push({ header: `Q${n}. ${plain(q.followUp.prompt) || 'Follow-up'}`, key: q.followUp.id })
            covered.add(q.followUp.id)
          }
        })
        // Preserve any stored answers whose key isn't in the current config.
        const extraKeys = new Set()
        surveyParticipants.forEach(p =>
          Object.keys(p.surveyAnswers).forEach(k => { if (!covered.has(k)) extraKeys.add(k) })
        )
        ;[...extraKeys].sort().forEach(k => columns.push({ header: k, key: k }))

        const fmtAns = v => {
          if (v == null) return ''
          if (Array.isArray(v)) return v.join(', ')
          if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join('; ')
          return v
        }
        const surveyRows = surveyParticipants.map(p => {
          const a = p.surveyAnswers || {}
          const row = {
            'Participant ID': p.id,
            'Name': p.name || '',
            'Anonymous Label': p.anonymousLabel || '',
            'Completed At': p.surveyCompletedAt ? formatTimestamp(p.surveyCompletedAt) : '',
          }
          columns.forEach(col => {
            let v = a[col.key]
            if (col.subKey) v = (v && typeof v === 'object') ? v[col.subKey] : undefined
            row[col.header] = fmtAns(v)
          })
          return row
        })
        const wsSurvey = XLSX.utils.json_to_sheet(surveyRows)
        autoWidth(wsSurvey, surveyRows)
        XLSX.utils.book_append_sheet(wb, wsSurvey, 'Survey')
      }

      // ── Sheet: Timing ──
      // How long each participant spent on / between the key steps. Durations are
      // in seconds; absolute timestamps are also given. Welcome + Registration
      // are measured client-side (the participant doc doesn't exist yet) and
      // flushed at registration; the rest come from server timestamps written as
      // events happen (page entered, Start pressed, voting started, votes/idea
      // submitted, survey opened/completed) and from the ideas / AI messages.
      if (participants.length > 0) {
        const timingRows = participants
          .slice()
          .sort((a, b) => (a.anonymousLabel || '').localeCompare(b.anonymousLabel || '', undefined, { numeric: true }))
          .map(p => {
            const t = p.timing || {}
            const myIdeas = ideas
              .filter(i => i.authorId === p.id)
              .sort((a, b) => (toMs(a.createdAt) || 0) - (toMs(b.createdAt) || 0))
            const myPrompts = aiMessages
              .filter(m => m.authorId === p.id && m.role === 'user')
              .sort((a, b) => (toMs(a.timestamp) || 0) - (toMs(b.timestamp) || 0))
            const myReplies = aiMessages.filter(
              m => m.role === 'assistant' && m.scope === 'individual' && m.scopeId === p.id
            )
            return {
              'Participant ID': p.id,
              'Name': p.name || '',
              'Anonymous Label': p.anonymousLabel || '',
              'Group ID': p.groupId || '',
              'Joined At': fmtMs(p.joinedAt),
              'Welcome opened At': fmtMs(t.welcomeOpenedAt),
              'Welcome read (s)': durSec(t.welcomeOpenedAt, t.welcomeAgreedAt),
              'Registration opened At': fmtMs(t.registrationOpenedAt),
              'Registration time (s)': durSec(t.registrationOpenedAt, t.registrationSubmittedAt),
              'Individual entered At': fmtMs(t.individualOpenedAt),
              'Individual instructions read (s)': durSec(t.individualOpenedAt, p.individualStartedAt),
              'Individual started At': fmtMs(p.individualStartedAt),
              'First idea At': fmtMs(myIdeas[0]?.createdAt),
              'Last idea At': fmtMs(myIdeas[myIdeas.length - 1]?.createdAt),
              'Ideas count': myIdeas.length,
              'All idea times': myIdeas.map(i => fmtMs(i.createdAt)).filter(Boolean).join(' ; '),
              'Group entered At': fmtMs(t.groupOpenedAt),
              'Group instructions read (s)': durSec(t.groupOpenedAt, p.groupStartedAt),
              'Group started At': fmtMs(p.groupStartedAt),
              'Group ideation time — adding ideas (s)': durSec(p.groupStartedAt, p.groupVotingStartedAt),
              'Proceeded to voting At': fmtMs(p.groupVotingStartedAt),
              'Group voting time (s)': durSec(p.groupVotingStartedAt, p.votedAt),
              'Votes submitted At': fmtMs(p.votedAt),
              'First AI message At': fmtMs(myPrompts[0]?.timestamp),
              'AI prompts (by user)': myPrompts.length,
              'AI replies (individual)': myReplies.length,
              'Survey opened At': fmtMs(t.surveyOpenedAt),
              'Survey time (s)': durSec(t.surveyOpenedAt, p.surveyCompletedAt),
              'Survey completed At': fmtMs(p.surveyCompletedAt),
            }
          })
        const wsTiming = XLSX.utils.json_to_sheet(timingRows)
        autoWidth(wsTiming, timingRows)
        XLSX.utils.book_append_sheet(wb, wsTiming, 'Timing')
      }

      // ── Sheet 4: Group Chat Messages ──
      if (chatMessages.length > 0) {
        const chatRows = chatMessages
          .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
          .map(msg => ({
            'Group ID': msg.groupId,
            'Author ID': msg.authorId || '',
            'Author Label': msg.authorLabel || '',
            'Message': msg.text || '',
            'Sent At': formatTimestamp(msg.createdAt),
          }))
        const wsChat = XLSX.utils.json_to_sheet(chatRows)
        autoWidth(wsChat, chatRows)
        XLSX.utils.book_append_sheet(wb, wsChat, 'Group Chat')
      }

      // ── Sheet 5: AI Chat ──
      if (aiMessages.length > 0) {
        const aiRows = aiMessages.map(msg => ({
          'Role': msg.role || '',
          'Scope': msg.scope || '',
          'Scope ID': msg.scopeId || '',
          'Author ID': msg.authorId || '',
          'Author Name': msg.authorName || '',
          'Message': msg.text || '',
          'Model': msg.model || '',
          'Input Tokens': msg.inputTokens ?? '',
          'Output Tokens': msg.outputTokens ?? '',
          // How long the provider took to generate this reply (assistant rows only).
          'Gen time (s)': msg.generationMs != null ? Math.round(msg.generationMs / 100) / 10 : '',
          'Timestamp': formatTimestamp(msg.timestamp),
        }))
        const wsAI = XLSX.utils.json_to_sheet(aiRows)
        autoWidth(wsAI, aiRows)
        XLSX.utils.book_append_sheet(wb, wsAI, 'AI Chat')

        // ── Sheet 5b: AI Usage summary (tokens + true cost per participant/group) ──
        const costUsdCol = `Cost USD (prices as of ${PRICES_AS_OF})`
        const costEurCol = `Cost EUR (as of ${PRICES_AS_OF})`
        const r4 = v => Number(v.toFixed(4))
        const usageByScope = {}
        aiMessages.forEach(msg => {
          if (msg.role !== 'assistant') return
          const key = `${msg.scope || '?'}|${msg.scopeId || '?'}`
          if (!usageByScope[key]) {
            usageByScope[key] = {
              scope: msg.scope || '', scopeId: msg.scopeId || '',
              replies: 0, inputTokens: 0, outputTokens: 0,
              genMs: 0, costUSD: 0, unpriced: 0, models: new Set(),
            }
          }
          const u = usageByScope[key]
          u.replies += 1
          u.inputTokens += msg.inputTokens || 0
          u.outputTokens += msg.outputTokens || 0
          u.genMs += msg.generationMs || 0
          if (msg.model) u.models.add(msg.model)
          const cost = replyCostUSD(msg.model, msg.inputTokens, msg.outputTokens)
          if (msg.inputTokens == null && msg.outputTokens == null) u.unpriced += 1
          else if (cost == null) u.unpriced += 1
          else u.costUSD += cost
        })
        const usageRows = Object.values(usageByScope).map(u => ({
          'Scope': u.scope,
          'Scope ID': u.scopeId,
          'AI Replies': u.replies,
          'Input Tokens': u.inputTokens,
          'Output Tokens': u.outputTokens,
          'Total Tokens': u.inputTokens + u.outputTokens,
          'Total gen time (s)': Math.round(u.genMs / 100) / 10,
          'Avg gen time/reply (s)': u.replies ? Math.round(u.genMs / u.replies / 100) / 10 : '',
          'Model(s)': [...u.models].join(', '),
          [costUsdCol]: r4(u.costUSD),
          [costEurCol]: r4(u.costUSD * USD_TO_EUR),
          'Unpriced Replies': u.unpriced,
        }))
        if (usageRows.length > 0) {
          const sum = col => usageRows.reduce((s, r) => s + (r[col] || 0), 0)
          const totals = {
            'Scope': 'TOTAL',
            'Scope ID': '',
            'AI Replies': sum('AI Replies'),
            'Input Tokens': sum('Input Tokens'),
            'Output Tokens': sum('Output Tokens'),
            'Total Tokens': sum('Total Tokens'),
            'Total gen time (s)': Math.round(sum('Total gen time (s)') * 10) / 10,
            'Avg gen time/reply (s)': sum('AI Replies')
              ? Math.round(sum('Total gen time (s)') / sum('AI Replies') * 10) / 10
              : '',
            'Model(s)': '',
            [costUsdCol]: r4(sum(costUsdCol)),
            [costEurCol]: r4(sum(costEurCol)),
            'Unpriced Replies': sum('Unpriced Replies'),
          }
          usageRows.push(totals)
          const n = participants.length
          if (n > 0) {
            usageRows.push({
              'Scope': `AVG PER PARTICIPANT (n=${n})`,
              'Scope ID': '',
              'AI Replies': r4(totals['AI Replies'] / n),
              'Input Tokens': Math.round(totals['Input Tokens'] / n),
              'Output Tokens': Math.round(totals['Output Tokens'] / n),
              'Total Tokens': Math.round(totals['Total Tokens'] / n),
              'Total gen time (s)': Math.round(totals['Total gen time (s)'] / n * 10) / 10,
              'Avg gen time/reply (s)': '',
              'Model(s)': '',
              [costUsdCol]: r4(totals[costUsdCol] / n),
              [costEurCol]: r4(totals[costEurCol] / n),
              'Unpriced Replies': '',
            })
          }
          const wsUsage = XLSX.utils.json_to_sheet(usageRows)
          autoWidth(wsUsage, usageRows)
          XLSX.utils.book_append_sheet(wb, wsUsage, 'AI Usage')
        }

        // ── Sheet 5c: AI Pricing reference (the rates used above) ──
        const priceRows = Object.entries(MODEL_PRICES).map(([m, p]) => ({
          'Model': m,
          'USD per 1M input': p ? p.in : 'not confirmed',
          'USD per 1M output': p ? p.out : 'not confirmed',
          'EUR per 1M input': p ? Number((p.in * USD_TO_EUR).toFixed(3)) : '',
          'EUR per 1M output': p ? Number((p.out * USD_TO_EUR).toFixed(3)) : '',
        }))
        priceRows.push({})
        priceRows.push({
          'Model': `Prices as of ${PRICES_AS_OF}. USD>EUR rate ${USD_TO_EUR} (same date). Update src/data/aiPricing.js when providers change prices.`,
        })
        const wsPricing = XLSX.utils.json_to_sheet(priceRows)
        autoWidth(wsPricing, priceRows)
        XLSX.utils.book_append_sheet(wb, wsPricing, 'AI Pricing')
      }

      // ── Sheet 6: Groups ──
      if (groups.length > 0) {
        const groupRows = groups.map(g => ({
          'Group ID': g.id,
          'Members': (g.members || []).join(', '),
          'Member Labels': g.memberLabels
            ? Object.entries(g.memberLabels).map(([uid, label]) => `${label}`).join(', ')
            : '',
          'Status': g.status || '',
          'Final Ideas': (g.finalIdeas || []).join(', '),
          // Readable version of the line above: the chosen ideas as titles
          // (top-voted first), each tagged with its phase, so you don't have to
          // look the ids up in the Ideas sheet.
          'Final Ideas (titles)': (g.finalIdeas || [])
            .map(id => {
              const it = ideaById[id]
              const tag = it ? (it.phase === 'group' ? ' [group]' : ' [individual]') : ''
              return `${ideaTitleById[id] || id}${tag}`
            })
            .join(' | '),
          'Created At': formatTimestamp(g.createdAt),
        }))
        const wsGroups = XLSX.utils.json_to_sheet(groupRows)
        autoWidth(wsGroups, groupRows)
        XLSX.utils.book_append_sheet(wb, wsGroups, 'Groups')
      }

      // Download
      const fileName = `session_${session.code || sessionId}_data.xlsx`
      XLSX.writeFile(wb, fileName)
    } catch (err) {
      console.error('Export error:', err)
      alert('Export failed. Check the console for details.')
    } finally {
      setExporting(false)
    }
  }

  // ── Helpers ─────────────────────────────────────────

  function formatTimestamp(ts) {
    if (!ts) return ''
    const seconds = ts.seconds || ts._seconds
    if (!seconds) return String(ts)
    return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
  }

  function countVotes(ideaId, participantList) {
    let count = 0
    participantList.forEach(p => {
      if ((p.votedFor || []).includes(ideaId)) count++
    })
    return count
  }

  // Auto-fit column widths AND bold the header row (row 0) of every sheet.
  function autoWidth(ws, rows) {
    if (!rows.length) return
    const keys = Object.keys(rows[0])
    const widths = keys.map(key => {
      const maxContent = Math.max(
        key.length,
        ...rows.map(r => String(r[key] || '').length)
      )
      return { wch: Math.min(maxContent + 2, 50) }
    })
    ws['!cols'] = widths
    // Bold every cell in the header row (needs xlsx-js-style to be written out).
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })]
      if (cell) cell.s = { ...(cell.s || {}), font: { ...(cell.s && cell.s.font), bold: true } }
    }
  }

  // Timing helpers. Accept a Firestore Timestamp ({seconds}/{_seconds}) or a
  // client epoch-ms number (the pre-join Welcome/Registration marks are stored
  // as ms). toMs normalises both to milliseconds.
  function toMs(v) {
    if (v == null) return null
    if (typeof v === 'number') return v
    if (v.seconds != null) return v.seconds * 1000
    if (v._seconds != null) return v._seconds * 1000
    return null
  }
  function fmtMs(v) {
    const ms = toMs(v)
    return ms == null ? '' : new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
  }
  // Duration in whole seconds between two marks of the SAME clock domain (both
  // client-ms or both server). Blank if either is missing or the order is off.
  function durSec(a, b) {
    const x = toMs(a), y = toMs(b)
    return (x != null && y != null && y >= x) ? Math.round((y - x) / 1000) : ''
  }

  // Strip any HTML/entities from instructor-authored question text so it reads
  // cleanly as an Excel column header.
  function plain(s) {
    return String(s ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
  }

  if (!session) return <div className={styles.loading}>Loading...</div>

  const sequence = getPhaseSequence(session.phaseConfig)
  // A session in the survey phase is already filed under "Completed Sessions"
  // (the admin list buckets both 'survey' and 'done' there) and needs no further
  // phase advancing — a session only reaches 'survey' once every participant has.
  // So the control room presents it as finished: the header badge and timeline
  // read "done", and the advance bar is replaced by the completion note.
  const isCompleted = session.status === 'done' || session.status === 'survey'
  const displayStatus = isCompleted ? 'done' : session.status
  const currentIndex = isCompleted ? sequence.indexOf('done') : sequence.indexOf(session.status)
  const nextPhase = sequence[currentIndex + 1]
  const isLast = !nextPhase || nextPhase === 'done'

  const byStatus = participants.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1
    return acc
  }, {})

  // Stable display numbering for groups (G1, G2, ...) and a list sorted by
  // group then anonymous label, so progress reads group-by-group.
  const groupNumbers = {}
  participants.forEach(p => {
    if (p.groupId && !(p.groupId in groupNumbers)) {
      groupNumbers[p.groupId] = Object.keys(groupNumbers).length + 1
    }
  })
  const sortedParticipants = [...participants].sort((a, b) => {
    const ga = a.groupId ? groupNumbers[a.groupId] : 999
    const gb = b.groupId ? groupNumbers[b.groupId] : 999
    if (ga !== gb) return ga - gb
    return (a.anonymousLabel || '').localeCompare(b.anonymousLabel || '', undefined, { numeric: true })
  })

  // Bucket participants by group so the list reads group-by-group (active users
  // per session AND per group). sortedParticipants is already group-ordered.
  const groupsOrdered = []
  const groupBuckets = {}
  sortedParticipants.forEach(p => {
    const key = p.groupId || '_none'
    if (!groupBuckets[key]) {
      groupBuckets[key] = { groupId: p.groupId || null, number: p.groupId ? groupNumbers[p.groupId] : null, members: [] }
      groupsOrdered.push(groupBuckets[key])
    }
    groupBuckets[key].members.push(p)
  })

  const indivActive = session.phaseConfig?.individualPhaseActive !== false
  const groupActive = session.phaseConfig?.groupPhaseActive !== false
  const regLabelById = Object.fromEntries(getRegistration(session).fields.map(f => [f.id, f.label]))

  // Write a nudge timestamp on the participant doc; their phase page shows a
  // "please wrap up" banner until they dismiss it.
  async function nudgeParticipant(participantId) {
    try {
      await updateDoc(doc(db, 'sessions', sessionId, 'participants', participantId), {
        nudgedAt: serverTimestamp(),
      })
      setNudgedId(participantId)
      setTimeout(() => setNudgedId(curr => (curr === participantId ? null : curr)), 2500)
    } catch (err) {
      console.error('Nudge error:', err)
    }
  }

  // Remove a participant mid-session (Cloud Function: detaches them from their
  // group, leaves a backfill vacancy for a late joiner). Two-click confirm.
  function askRemove(participantId) {
    setRemoveConfirmId(participantId)
    setTimeout(() => setRemoveConfirmId(curr => (curr === participantId ? null : curr)), 4000)
  }
  async function removeParticipant(participantId) {
    setRemovingId(participantId)
    try {
      await httpsCallable(functions, 'removeParticipant')({ sessionId, participantId })
    } catch (err) {
      console.error('Remove participant error:', err)
      alert('Could not remove participant: ' + (err?.message || 'unknown error'))
    } finally {
      setRemovingId(null)
      setRemoveConfirmId(null)
    }
  }

  // Drill a group bucket open/closed to reveal its participant list.
  function toggleGroup(key) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // Open the message composer for either a whole group or a single participant.
  function openMessage(target) {
    setMessageTarget(target)
    setMessageText('')
  }

  // Send a centred message window to the chosen recipient(s): the whole group,
  // or one specific participant (writes `adminMessage` to each recipient's own
  // doc; AdminBroadcast pops it up centered on their screen).
  async function sendMessage() {
    if (!messageTarget || !messageText.trim()) return
    setMessageSending(true)
    const msg = { id: Date.now(), text: messageText.trim(), from: session?.instructorName || null }
    const recipients = messageTarget.kind === 'group'
      ? messageTarget.group.members.filter(m => !m.removed && m.status !== 'removed')
      : [messageTarget.participant]
    try {
      await Promise.all(
        recipients.map(m => updateDoc(doc(db, 'sessions', sessionId, 'participants', m.id), { adminMessage: msg }))
      )
      setMessageTarget(null)
      setMessageText('')
    } catch (err) {
      console.error('Send message error:', err)
      alert('Could not send the message: ' + (err?.message || 'unknown error'))
    } finally {
      setMessageSending(false)
    }
  }

  function getAutoNote() {
    const status = session.status
    if (status === 'waiting') return 'Auto-advances when a group forms'
    if (status === 'individual') return 'Auto-advances when all groups complete'
    if (status === 'group') {
      return session.phaseConfig?.groupPhaseDuration
        ? 'Auto-advances when all votes are in or the timer expires'
        : 'Auto-advances when all members submit their votes'
    }
    return null
  }

  function phaseLabel(phase) {
    if (phase === 'group') return 'group ideation'
    return phase
  }

  const surveyCount = participants.filter(p => p.surveyAnswers).length
  const votedCount = participants.filter(p => p.votesSubmitted || (p.votedFor && p.votedFor.length > 0)).length

  // ── Submitted-ideas summary (individual phase) ────────
  // Confirmation view for the instructor: every idea each participant
  // submitted, grouped by participant, flagging the ones carried to the group.
  const individualIdeas = ideas.filter(i => i.phase === 'individual')
  // Ideas keyed by author id (each list chronological) so the Submitted Ideas
  // panel can be laid out group-by-group and then participant-by-participant,
  // reusing the same group buckets as the live participant list above.
  const ideasByAuthorId = individualIdeas.reduce((acc, i) => {
    ;(acc[i.authorId] = acc[i.authorId] || []).push(i)
    return acc
  }, {})
  Object.values(ideasByAuthorId).forEach(list =>
    list.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
  )
  // Any author with no matching current participant (e.g. later removed/deleted)
  // is shown under a trailing bucket so their ideas are never silently dropped.
  const memberIds = new Set(participants.map(p => p.id))
  const orphanAuthorIds = Object.keys(ideasByAuthorId).filter(id => !memberIds.has(id))

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={() => navigate('/admin')}>{'\u2190'} Back</button>
          <span className={styles.wordmark}>Ideation Challenge</span>
          <span className={styles.slash}>/</span>
          <span className={styles.sessionCode}>{session.code}</span>
        </div>
        <span className={`${styles.statusBadge} ${styles['status_' + displayStatus]}`}>
          {phaseLabel(displayStatus)}
        </span>
      </header>

      <main className={styles.main}>

        {/* Phase timeline */}
        <div className={styles.timelineCard}>
          <div className={styles.timeline}>
            {sequence.map((phase, i) => (
              <div
                key={phase}
                className={[
                  styles.timelineStep,
                  i < currentIndex ? styles.done : '',
                  i === currentIndex ? styles.active : '',
                ].join(' ')}
              >
                <div className={styles.timelineDot} />
                <span className={styles.timelineLabel}>{phaseLabel(phase)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.grid}>
          {/* Participant breakdown */}
          <div className="card">
            <h2 className={styles.cardTitle}>Participants <span className={styles.cardCount}>({participants.length})</span></h2>
            {participants.length === 0 ? (
              <p className={styles.emptyNote}>No participants have joined yet.</p>
            ) : (
              <>
                <div className={styles.breakdown}>
                  {Object.entries(byStatus).map(([status, count]) => (
                    <div key={status} className={styles.breakdownRow}>
                      <span className={styles.breakdownStatus}>{status}</span>
                      <span className={styles.breakdownCount}>{count}</span>
                    </div>
                  ))}
                </div>
                <p className={styles.panelHint}>
                  Click a group to see its participants. Reach a single participant
                  or a whole group with a message that pops up centered on their screen.
                </p>
                <div className={styles.participantGroups}>
                  {groupsOrdered.map(g => {
                    const doneIdeas = g.members.filter(m => m.individualComplete).length
                    const doneVotes = g.members.filter(m => m.votesSubmitted).length
                    const gkey = g.groupId || 'none'
                    const groupOpen = expandedGroups.has(gkey)
                    return (
                      <div key={gkey} className={styles.groupBlock}>
                        <div className={styles.groupHeader}>
                          <button
                            className={styles.groupToggle}
                            onClick={() => toggleGroup(gkey)}
                            type="button"
                            aria-expanded={groupOpen}
                          >
                            <span className={styles.gChevron}>{groupOpen ? '▾' : '▸'}</span>
                            <span className={styles.groupName}>
                              {g.number ? `Group ${g.number}` : 'Unassigned'}
                            </span>
                            <span className={styles.groupMeta}>
                              {g.members.length} member{g.members.length === 1 ? '' : 's'}
                              {indivActive && ` · ideas ${doneIdeas}/${g.members.length}`}
                              {groupActive && ` · votes ${doneVotes}/${g.members.length}`}
                            </span>
                          </button>
                          {g.groupId && (
                            <span className={styles.groupActions}>
                              <button
                                className={styles.groupActionBtn}
                                onClick={() => setViewGroup(g)}
                                type="button"
                                title="Watch this group's ideas and chat live"
                              >
                                View
                              </button>
                              <button
                                className={styles.groupActionBtn}
                                onClick={() => openMessage({ kind: 'group', group: g })}
                                type="button"
                                title="Send the whole group a message that pops up centered on their screens"
                              >
                                Message group
                              </button>
                            </span>
                          )}
                        </div>

                        {groupOpen && g.members.map(p => {
                          const canNudge = ['individual', 'group'].includes(p.status)
                          const open = expandedPid === p.id
                          const demoEntries = Object.entries(p.demographics || {})
                            .filter(([, v]) => v !== '' && v != null)
                          return (
                            <div key={p.id} className={styles.participantItem}>
                              <div
                                className={`${styles.participantRow} ${open ? styles.participantRowOpen : ''}`}
                                onClick={() => setExpandedPid(prev => (prev === p.id ? null : p.id))}
                                role="button"
                                tabIndex={0}
                                onKeyDown={e => { if (e.key === 'Enter') setExpandedPid(prev => (prev === p.id ? null : p.id)) }}
                              >
                                <span className={styles.pIdentity}>
                                  <span className={styles.pChevron}>{open ? '▾' : '▸'}</span>
                                  {p.anonymousLabel && <span className={styles.pGroupTag}>{p.anonymousLabel}</span>}
                                  <span className={styles.pName}>{p.name || p.anonymousLabel || p.id.slice(0, 6)}</span>
                                </span>
                                <span className={styles.pRight}>
                                  {indivActive && (
                                    <span
                                      className={`${styles.pTick} ${p.individualComplete ? styles.pTickOn : ''}`}
                                      title={p.individualComplete ? 'Individual ideas submitted' : 'Individual ideas not submitted yet'}
                                    >
                                      ideas {p.individualComplete ? '✓' : '–'}
                                    </span>
                                  )}
                                  {groupActive && (
                                    <span
                                      className={`${styles.pTick} ${p.votesSubmitted ? styles.pTickOn : ''}`}
                                      title={p.votesSubmitted ? 'Votes submitted' : 'Votes not submitted yet'}
                                    >
                                      votes {p.votesSubmitted ? '✓' : '–'}
                                    </span>
                                  )}
                                  <span className={styles.pStatus}>{participantStageLabel(p)}</span>
                                </span>
                              </div>

                              {open && (
                                <div className={styles.pDetail}>
                                  <DetailRow label="Current stage" value={participantStageLabel(p)} />
                                  <DetailRow label="Email" value={p.email || '—'} />
                                  <DetailRow label="Joined" value={formatTimestamp(p.joinedAt) || '—'} />
                                  {indivActive && <DetailRow label="Individual ideas" value={p.individualComplete ? 'Submitted ✓' : 'Not yet'} />}
                                  {groupActive && <DetailRow label="Group stage" value={p.groupStage || (p.votesSubmitted ? 'voting' : '—')} />}
                                  {groupActive && <DetailRow label="Votes" value={p.votesSubmitted ? `Submitted (${(p.votedFor || []).length})` : `${(p.votedFor || []).length} selected`} />}
                                  <DetailRow label="Survey" value={p.surveyCompletedAt || p.surveyAnswers ? 'Completed ✓' : 'Not yet'} />
                                  {demoEntries.length > 0 && (
                                    <div className={styles.pDetailDemo}>
                                      {demoEntries.map(([k, v]) => (
                                        <DetailRow key={k} label={regLabelById[k] || k} value={String(v)} />
                                      ))}
                                    </div>
                                  )}
                                  <div className={styles.pActions}>
                                    <button
                                      className={styles.msgBtn}
                                      onClick={() => openMessage({ kind: 'participant', participant: p })}
                                      type="button"
                                      title="Send this participant a message that pops up centered on their screen"
                                    >
                                      Message
                                    </button>
                                    {canNudge && (
                                      <button
                                        className={styles.nudgeBtn}
                                        onClick={() => nudgeParticipant(p.id)}
                                        disabled={nudgedId === p.id}
                                        type="button"
                                        title="Show this participant a reminder banner to wrap up and submit"
                                      >
                                        {nudgedId === p.id ? 'Nudged ✓' : 'Nudge'}
                                      </button>
                                    )}
                                    {p.status !== 'removed' && p.status !== 'done' && (
                                      <button
                                        className={`${styles.removeBtn} ${removeConfirmId === p.id ? styles.removeBtnConfirm : ''}`}
                                        onClick={() => removeConfirmId === p.id ? removeParticipant(p.id) : askRemove(p.id)}
                                        disabled={removingId === p.id}
                                        type="button"
                                        title="Remove this participant from the session (frees a slot for a late joiner)"
                                      >
                                        {removingId === p.id ? 'Removing…' : removeConfirmId === p.id ? 'Confirm?' : 'Remove'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* Session config summary */}
          <div className="card">
            <h2 className={styles.cardTitle}>Session Config</h2>
            <div className={styles.configList}>
              <ConfigRow label="Individual Phase" value={session.phaseConfig?.individualPhaseActive ? 'On' : 'Off'} />
              <ConfigRow label="Group Phase" value={session.phaseConfig?.groupPhaseActive ? 'On' : 'Off'} />
              <ConfigRow label="Phase Order" value={session.phaseConfig?.phaseOrder?.replace('_', ' ') || 'N/A'} />
              <ConfigRow label="Group size" value={session.phaseConfig?.groupSize ?? 'N/A'} />
              <ConfigRow label="Max ideas (individual)" value={session.phaseConfig?.maxIdeasIndividual ?? 'N/A'} />
              <ConfigRow label="Ideas carried to group" value={session.phaseConfig?.ideasCarriedToGroup ?? 'N/A'} />
              <ConfigRow label="Group phase timer" value={session.phaseConfig?.groupPhaseDuration ? `${Math.round(session.phaseConfig.groupPhaseDuration / 60)} min` : 'Manual'} />
              <ConfigRow label="AI (individual)" value={session.aiConfig?.individualAI ? 'On' : 'Off'} />
              <ConfigRow label="AI (group)" value={session.aiConfig?.groupAI ? 'On' : 'Off'} />
            </div>
          </div>
        </div>

        {/* Submitted ideas summary (individual-phase confirmation) */}
        {indivActive && (
          <div className="card" style={{ marginTop: 20 }}>
            <h2 className={styles.cardTitle}>
              Submitted Ideas <span className={styles.cardCount}>({individualIdeas.length})</span>
            </h2>
            <p className={styles.exportSub}>
              Every idea participants submitted in the individual phase, grouped by
              group and then by participant. Ideas carried into the group phase are
              flagged. Use “Message” to nudge a specific participant about their ideas.
            </p>
            {individualIdeas.length === 0 ? (
              <p className={styles.emptyNote}>No ideas submitted yet.</p>
            ) : (
              <div className={styles.ideaGroups}>
                {groupsOrdered.map(g => {
                  const groupIdeaCount = g.members.reduce(
                    (n, m) => n + (ideasByAuthorId[m.id]?.length || 0), 0
                  )
                  return (
                    <div key={g.groupId || 'none'} className={styles.ideaGroupBlock}>
                      <div className={styles.ideaGroupHeader}>
                        <span className={styles.ideaGroupName}>
                          {g.number ? `Group ${g.number}` : 'Unassigned'}
                        </span>
                        <span className={styles.ideaGroupCount}>
                          {groupIdeaCount} idea{groupIdeaCount === 1 ? '' : 's'}
                        </span>
                        {g.groupId && (
                          <button
                            className={styles.msgBtn}
                            style={{ marginLeft: 'auto' }}
                            onClick={() => openMessage({ kind: 'group', group: g })}
                            type="button"
                            title="Message the whole group"
                          >
                            Message group
                          </button>
                        )}
                      </div>
                      {g.members.map(p => {
                        const list = ideasByAuthorId[p.id] || []
                        const canNudge = ['individual', 'group'].includes(p.status)
                        return (
                          <div key={p.id} className={styles.ideaUserBlock}>
                            <div className={styles.ideaUserHeader}>
                              <span className={styles.ideaUserIdentity}>
                                {p.anonymousLabel && <span className={styles.pGroupTag}>{p.anonymousLabel}</span>}
                                <span className={styles.ideaUserName}>{p.name || p.anonymousLabel || p.id.slice(0, 6)}</span>
                                <span className={styles.ideaSummaryCount}>
                                  {list.length} idea{list.length === 1 ? '' : 's'}
                                </span>
                              </span>
                              <span className={styles.ideaUserActions}>
                                <button
                                  className={styles.msgBtn}
                                  onClick={() => openMessage({ kind: 'participant', participant: p })}
                                  type="button"
                                  title="Send this participant a message centered on their screen"
                                >
                                  Message
                                </button>
                                {canNudge && (
                                  <button
                                    className={styles.nudgeBtn}
                                    onClick={() => nudgeParticipant(p.id)}
                                    disabled={nudgedId === p.id}
                                    type="button"
                                    title="Show this participant a reminder banner to wrap up"
                                  >
                                    {nudgedId === p.id ? 'Nudged ✓' : 'Nudge'}
                                  </button>
                                )}
                              </span>
                            </div>
                            {list.length === 0 ? (
                              <div className={styles.ideaNone}>No ideas submitted.</div>
                            ) : list.map(idea => (
                              <div key={idea.id} className={styles.ideaSummaryItem}>
                                <div className={styles.ideaSummaryText}>
                                  <span className={styles.ideaSummaryTitle}>{idea.title || idea.text}</span>
                                  {idea.description && (
                                    <span className={styles.ideaSummaryDesc}>{idea.description}</span>
                                  )}
                                </div>
                                {idea.selected && (
                                  <span className={styles.ideaSummaryBadge}>carried to group</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}

                {orphanAuthorIds.length > 0 && (
                  <div className={styles.ideaGroupBlock}>
                    <div className={styles.ideaGroupHeader}>
                      <span className={styles.ideaGroupName}>Former participants</span>
                    </div>
                    {orphanAuthorIds.map(aid => {
                      const list = ideasByAuthorId[aid]
                      return (
                        <div key={aid} className={styles.ideaUserBlock}>
                          <div className={styles.ideaUserHeader}>
                            <span className={styles.ideaUserIdentity}>
                              <span className={styles.ideaUserName}>{list[0]?.authorName || aid.slice(0, 6)}</span>
                              <span className={styles.ideaSummaryCount}>
                                {list.length} idea{list.length === 1 ? '' : 's'}
                              </span>
                            </span>
                          </div>
                          {list.map(idea => (
                            <div key={idea.id} className={styles.ideaSummaryItem}>
                              <div className={styles.ideaSummaryText}>
                                <span className={styles.ideaSummaryTitle}>{idea.title || idea.text}</span>
                                {idea.description && (
                                  <span className={styles.ideaSummaryDesc}>{idea.description}</span>
                                )}
                              </div>
                              {idea.selected && (
                                <span className={styles.ideaSummaryBadge}>carried to group</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Data & Export */}
        <div className={styles.exportCard}>
          <div className={styles.exportHeader}>
            <div>
              <h2 className={styles.cardTitle}>Data &amp; Export</h2>
              <p className={styles.exportSub}>
                Download all session data as an Excel file with separate sheets for
                participants, ideas, survey responses, timing, group chat, AI chat, and groups.
              </p>
            </div>
            <button
              className={styles.exportBtn}
              onClick={exportData}
              disabled={exporting || participants.length === 0}
            >
              {exporting ? 'Exporting...' : 'Download Excel'}
            </button>
          </div>
          <div className={styles.exportStats}>
            <div className={styles.statBox}>
              <span className={styles.statNum}>{participants.length}</span>
              <span className={styles.statLabel}>Participants</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statNum}>{votedCount}</span>
              <span className={styles.statLabel}>Voted</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statNum}>{surveyCount}</span>
              <span className={styles.statLabel}>Surveys</span>
            </div>
          </div>
        </div>

        {/* Advance control */}
        {!isCompleted && (
          <div className={styles.advanceBar}>
            <div className={styles.advanceInfo}>
              <span className={styles.advanceLabel}>Current phase:</span>
              <strong>{phaseLabel(session.status)}</strong>
              {nextPhase && (
                <>
                  <span className={styles.advanceArrow}>{'\u2192'}</span>
                  <span className={styles.advanceNext}>{phaseLabel(nextPhase)}</span>
                </>
              )}
            </div>
            <div className={styles.advanceRight}>
              {getAutoNote() && (
                <span className={styles.autoNote}>{getAutoNote()}</span>
              )}
              <button
                className="btn-primary"
                onClick={advancePhase}
                disabled={advancing || isLast}
              >
                {advancing ? 'Advancing...' : isLast ? 'Session Complete' : `Force advance \u2192 ${phaseLabel(nextPhase)}`}
              </button>
            </div>
          </div>
        )}

        {isCompleted && (
          <div className={styles.doneBar}>
            {session.status === 'done'
              ? 'Session complete. All participants have finished.'
              : (() => {
                  const inSurvey = participants.filter(p => p.status === 'survey').length
                  const finished = participants.filter(p => p.status === 'done').length
                  return inSurvey > 0
                    ? `Session complete and read-only. ${finished} of ${participants.length} finished the survey; ${inSurvey} still had it open.`
                    : 'Session complete. All participants have finished.'
                })()}
          </div>
        )}
      </main>

      {viewGroup && (
        <GroupViewModal
          sessionId={sessionId}
          group={viewGroup}
          onClose={() => setViewGroup(null)}
        />
      )}

      {messageTarget && (
        <div className={styles.modalBackdrop} onClick={() => !messageSending && setMessageTarget(null)}>
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>
              {messageTarget.kind === 'group'
                ? `Message ${messageTarget.group.number ? `Group ${messageTarget.group.number}` : 'group'}`
                : `Message ${messageTarget.participant.anonymousLabel || messageTarget.participant.name || 'participant'}`}
            </h3>
            <p className={styles.modalSub}>
              {messageTarget.kind === 'group'
                ? "Pops up as a window in the centre of every member's screen."
                : "Pops up as a window in the centre of this participant's screen."}
            </p>
            <textarea
              className={`input-field ${styles.modalTextarea}`}
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              placeholder="e.g. Please wrap up your individual ideas — about 2 minutes left."
              rows={4}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button className="btn-ghost" onClick={() => setMessageTarget(null)} disabled={messageSending} type="button">
                Cancel
              </button>
              <button className="btn-primary" onClick={sendMessage} disabled={messageSending || !messageText.trim()} type="button">
                {messageSending ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * GroupViewModal — a read-only live window into one group while they play:
 * each member's current stage, the group's ideas, and the group chat.
 */
function GroupViewModal({ sessionId, group, onClose }) {
  const [messages, setMessages] = useState([])
  const [ideas, setIdeas] = useState([])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'sessions', sessionId, 'groups', group.groupId, 'messages'), orderBy('createdAt', 'asc')),
      snap => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {}
    )
    return unsub
  }, [sessionId, group.groupId])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'sessions', sessionId, 'ideas'), where('groupId', '==', group.groupId)),
      snap => setIdeas(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {}
    )
    return unsub
  }, [sessionId, group.groupId])

  const ideasSorted = [...ideas].sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={`${styles.modalCard} ${styles.viewCard}`} onClick={e => e.stopPropagation()}>
        <div className={styles.viewHead}>
          <h3 className={styles.modalTitle}>{group.number ? `Group ${group.number}` : 'Group'} — live view</h3>
          <button className={styles.closeX} onClick={onClose} type="button" aria-label="Close">×</button>
        </div>
        <div className={styles.viewMembers}>
          {group.members.map(m => (
            <span key={m.id} className={styles.viewMemberChip}>
              {m.anonymousLabel || m.id.slice(0, 5)} · {participantStageLabel(m)}
            </span>
          ))}
        </div>
        <div className={styles.viewCols}>
          <div className={styles.viewCol}>
            <div className={styles.viewColLabel}>Ideas ({ideasSorted.length})</div>
            <div className={styles.viewScroll}>
              {ideasSorted.length === 0 && <div className={styles.viewEmpty}>No ideas yet.</div>}
              {ideasSorted.map(i => (
                <div key={i.id} className={styles.viewIdea}>
                  <div className={styles.viewIdeaTitle}>
                    {i.title || i.text || 'Untitled'}
                    <span className={styles.viewIdeaTag}>{i.phase === 'group' ? 'group' : 'individual'}</span>
                  </div>
                  {i.description && <div className={styles.viewIdeaDesc}>{i.description}</div>}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.viewCol}>
            <div className={styles.viewColLabel}>Group chat ({messages.length})</div>
            <div className={styles.viewScroll}>
              {messages.length === 0 && <div className={styles.viewEmpty}>No messages yet.</div>}
              {messages.map(msg => (
                <div key={msg.id} className={styles.viewMsg}>
                  <span className={styles.viewMsgWho}>{msg.authorLabel || 'p?'}</span>
                  <span className={styles.viewMsgText}>{msg.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className={styles.viewNote}>Read-only — use “Message” to send the group a note.</p>
      </div>
    </div>
  )
}

function ConfigRow({ label, value }) {
  return (
    <div className={styles.configRow}>
      <span className={styles.configLabel}>{label}</span>
      <strong className={styles.configValue}>{String(value)}</strong>
    </div>
  )
}

const PARTICIPANT_STAGE_LABELS = {
  waiting: 'waiting in lobby',
  waiting_for_group: 'individual submitted — waiting for group',
  individual: 'individual phase',
  group: 'group phase',
  voting: 'group voting',
  survey: 'survey',
  done: 'finished',
}
// Fine-grained "exactly where is this participant" label. Distinguishes the
// instructions screen (before they press Start) from the active workspace,
// using the per-participant signals individualStartedAt / groupStage.
function participantStageLabel(p) {
  const status = typeof p === 'string' ? p : p?.status
  if (typeof p === 'object' && p) {
    if (status === 'individual') {
      return p.individualStartedAt
        ? 'individual — writing ideas'
        : 'individual — reading instructions'
    }
    if (status === 'group') {
      if (p.votesSubmitted) return 'group — votes submitted'
      if (p.groupStage === 'voting') return 'group — voting'
      if (p.groupStage === 'ideation') return 'group — ideation'
      return 'group — reading instructions'
    }
  }
  return PARTICIPANT_STAGE_LABELS[status] || status || 'unknown'
}

function DetailRow({ label, value }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{value}</span>
    </div>
  )
}