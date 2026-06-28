/**
 * sessionExport.js
 *
 * The single source of truth for the admin "research data export" workbook —
 * the multi-tab, condition-stamped Excel a session produces (About, Participants,
 * Ideas, Survey, Timing, Group Chat, AI Chat, AI Usage, AI Pricing, Groups,
 * Conditions). Extracted from AdminSession so that BOTH the per-session export
 * (AdminSession "Download Excel") and the Data Analytics "Aggregate Data" step
 * build identical sheets — the aggregate simply fetches every loaded session,
 * builds its sheets here, and stacks them tab-by-tab. Keeping one builder
 * guarantees the aggregate always matches the per-session format.
 *
 * The sheets are designed to STACK: every data row carries Session Code +
 * Condition columns (`stamp()`), so the same sheet from several sessions
 * concatenates straight into one condition-coded table.
 */
import { getDocs, collection, query, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { getRegistration, getSurveyQuestions } from '../data/formDefaults'
import { MODEL_PRICES, USD_TO_EUR, PRICES_AS_OF, replyCostUSD } from '../data/aiPricing'
import * as XLSX from 'xlsx-js-style'

// Canonical tab order, used when merging several sessions into one workbook.
export const SHEET_ORDER = [
  'About', 'Participants', 'Ideas', 'Survey', 'Timing',
  'Group Chat', 'AI Chat', 'AI Usage', 'AI Pricing', 'Groups', 'Conditions',
]

// ── Small formatting helpers (ported verbatim from AdminSession) ───────────────
export function formatTimestamp(ts) {
  if (!ts) return ''
  const seconds = ts.seconds || ts._seconds
  if (!seconds) return String(ts)
  return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
}
function countVotes(ideaId, participantList) {
  let count = 0
  participantList.forEach(p => { if ((p.votedFor || []).includes(ideaId)) count++ })
  return count
}
// Accept a Firestore Timestamp ({seconds}/{_seconds}) or a client epoch-ms number.
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
function durSec(a, b) {
  const x = toMs(a), y = toMs(b)
  return (x != null && y != null && y >= x) ? Math.round((y - x) / 1000) : ''
}
// Strip HTML/entities from instructor-authored question text → clean column header.
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

/** Derive a session's AI-timing condition (Set A / placement) + display strings. */
export function conditionOf(session) {
  const indivPhaseOn = session.phaseConfig?.individualPhaseActive !== false
  const groupPhaseOn = session.phaseConfig?.groupPhaseActive !== false
  const aiSolo = !!session.aiConfig?.individualAI && indivPhaseOn
  const aiGroup = !!session.aiConfig?.groupAI && groupPhaseOn
  const sessionCode = session.code || session.id
  const placement = aiSolo && aiGroup ? 'Both' : aiSolo ? 'Solo' : aiGroup ? 'Group' : 'None'
  const paperName = aiSolo && aiGroup ? 'Full AI' : aiSolo ? 'Individual + AI' : aiGroup ? 'Group + AI' : 'Human-Only Hybrid'
  const aiPresentIn = aiSolo && aiGroup ? 'both stages' : aiSolo ? 'solo stage only' : aiGroup ? 'group stage only' : 'neither stage'
  return { aiSolo, aiGroup, sessionCode, placement, paperName, aiPresentIn }
}

/** Fetch everything a session's export needs from Firestore. */
export async function fetchSessionExportData(session) {
  const sessionId = session.id
  const [partsSnap, ideasSnap, groupsSnap, aiSnap] = await Promise.all([
    getDocs(collection(db, 'sessions', sessionId, 'participants')),
    getDocs(collection(db, 'sessions', sessionId, 'ideas')),
    getDocs(collection(db, 'sessions', sessionId, 'groups')),
    getDocs(query(collection(db, 'sessions', sessionId, 'aiMessages'), orderBy('timestamp', 'asc'))),
  ])
  const participants = partsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const ideas = ideasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const groups = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const aiMessages = aiSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const chatMessages = []
  for (const group of groups) {
    const msgSnap = await getDocs(collection(db, 'sessions', sessionId, 'groups', group.id, 'messages'))
    msgSnap.docs.forEach(d => chatMessages.push({ groupId: group.id, messageId: d.id, ...d.data() }))
  }
  return { participants, ideas, groups, aiMessages, chatMessages }
}

/**
 * Build the ordered list of sheet descriptors for ONE session. Each descriptor is
 * { name, kind:'json'|'aoa', rows?|aoa?, cols? }. Mirrors AdminSession's export
 * exactly (it now calls this too). Sheets that have no data are omitted, just like
 * the per-session export.
 */
export function buildSessionSheets(session, { participants = [], ideas = [], groups = [], aiMessages = [], chatMessages = [] }) {
  const sheets = []
  const sessionId = session.id
  const { aiSolo, aiGroup, sessionCode, placement, paperName, aiPresentIn } = conditionOf(session)
  const aiConditionLabel = `${placement} = ${paperName} (AI in ${aiPresentIn})`

  const finalIdeaIds = new Set(groups.flatMap(g => g.finalIdeas || []))
  const finalIdeaRank = {}
  groups.forEach(g => (g.finalIdeas || []).forEach((id, i) => { finalIdeaRank[id] = `${g.id} #${i + 1}` }))
  const authorGroupId = Object.fromEntries(participants.map(p => [p.id, p.groupId || '']))
  const authorLabel = Object.fromEntries(participants.map(p => [p.id, p.anonymousLabel || '']))
  const ideaById = Object.fromEntries(ideas.map(i => [i.id, i]))
  const ideaTitleById = Object.fromEntries(ideas.map(i => [i.id, i.title || i.text || i.id]))

  // Prepend the condition keys as the leftmost columns of every data sheet.
  const stamp = row => ({
    'Session Code': sessionCode,
    'Condition': placement,
    'Condition (paper name)': paperName,
    'AI present in': aiPresentIn,
    'AI Solo (0/1)': aiSolo ? 1 : 0,
    'AI Group (0/1)': aiGroup ? 1 : 0,
    ...row,
  })

  const nIndivIdeas = ideas.filter(i => i.phase === 'individual').length
  const nGroupIdeas = ideas.filter(i => i.phase === 'group').length

  // ── About / Analysis Guide ──
  const aboutAoa = [
    ['Ideation Challenge — research data export'],
    [],
    ['Session code', sessionCode],
    ['Session name', session.name || ''],
    ['AI CONDITION (this session)', aiConditionLabel],
    ['  AI in solo (individual) stage', aiSolo ? 'Yes' : 'No'],
    ['  AI in group stage', aiGroup ? 'Yes' : 'No'],
    [],
    ['STUDY — AsPredicted #298152: "The Effects of AI Timing on Idea Generation and Selection"'],
    ['Unit of analysis', 'the IDEA. Each idea is rated on Novelty, Usefulness, and Overall Quality (= mean of novelty & usefulness) by blind expert raters.'],
    ['Manipulation', 'the TIMING of AI = {AI in solo stage} × {AI in group stage} → four between-subjects conditions. Each row is tagged with the Set A placement code in the "Condition" column:'],
    ['  Condition (code)', 'paper name           — AI is present in'],
    ['  • None', 'Human-Only Hybrid    — neither stage'],
    ['  • Solo', 'Individual + AI      — solo (individual) stage only'],
    ['  • Group', 'Group + AI           — group stage only'],
    ['  • Both', 'Full AI              — both stages'],
    ['Pooling across sessions', 'each session is ONE condition; every data row carries Session Code + Condition (None/Solo/Group/Both) + Condition (paper name) + AI present in + AI Solo/Group (0/1), so you can stack the same sheet from several sessions into one condition-coded table.'],
    ['Condition coding for regressions', 'regress on the Condition column (None/Solo/Group/Both; None = reference), or use AI Solo (0/1) × AI Group (0/1) as the two dummies (main effects + interaction give the full 2×2). The planned Solo-vs-Group contrast (= Individual+AI vs Group+AI) = rows where exactly one of the two dummies is 1.'],
    ['Clustering unit (triad)', 'use Group UID (= "SessionCode:groupId"), NOT the bare Group ID — g0/g1… repeat across sessions and would collide when pooled. Participant nesting: Author ID / Participant ID (Firebase uids, globally unique).'],
    [],
    ['WHERE EACH MEASURE LIVES'],
    ['Dependent variables (idea creativity)', '"Ideas" sheet, one row per idea. Empty rater columns Novelty (rater 1..3) / Usefulness (rater 1..3) for blind expert scoring — aggregate across raters, then Overall Quality = mean(Novelty, Usefulness). Also Stage, Carried to Group, Vote Count, Final Group Pick, and Exclude (Yes/No) + Exclusion reason for the pre-registered "drop nonsensical/empty ideas" screen.'],
    ['Selected ideas (group level)', '"Ideas" sheet → filter Final Group Pick = Yes (the ideas each group locked in after voting). "Groups" sheet lists them per group as titles.'],
    ['Vote completeness (read this before vote analysis)', '"Participants" sheet → Ballot Status + Votes Cast. A "submitted" ballot can hold ZERO votes (auto-submitted at timer expiry), so do NOT treat Votes Submitted = Yes as "actually voted". Ballot Status = voted / partial (n/required) / empty (submitted, no votes) / not submitted; treat empty + not submitted as non-votes, partial as fewer than the required votes. "Voted For (titles)" lists each ballot\'s chosen ideas by name.'],
    ['Mechanism — prompt behaviour', '"AI Chat" sheet (Role = user → prompts: count = intensity; prompt text → semantic diversity, by Author ID/Scope). "AI Usage" sheet aggregates prompts/replies per participant & per group (filter Row Type = scope to drop TOTAL/AVG summary rows).'],
    ['Mechanism — idea diversity / search breadth', '"Ideas" sheet Full Text, grouped by author / condition → compute semantic dispersion.'],
    ['Moderators', 'the "Survey" sheet holds the moderator items — the default questionnaire now includes them: Big-Five personality (2 items/trait), cognitive diversity (group level), and the divergent-thinking "creative uses for a brick" task. (Sessions created before this was added, or with a custom survey, only have them if the instructor included them — confirm the columns are present for your session.) Domain-expertise proxies: Survey items on prior product/innovation experience + Participants occupation / work experience.'],
    ['Controls', '"Participants" sheet — Age, Gender (+ other demographics).'],
    ['Engagement / timing', '"Timing" sheet; "Group Chat" sheet (group-stage discussion).'],
    [],
    ['THIS SESSION AT A GLANCE'],
    ['Participants', participants.length],
    ['Groups (triads)', groups.length],
    ['Individual-stage ideas', nIndivIdeas],
    ['Group-stage ideas', nGroupIdeas],
    ['Final selected ideas (across groups)', finalIdeaIds.size],
  ]
  sheets.push({ name: 'About', kind: 'aoa', aoa: aboutAoa, cols: [{ wch: 40 }, { wch: 96 }] })

  // ── Participants ──
  const regFields = getRegistration(session).fields
  const labelById = Object.fromEntries(regFields.map(f => [f.id, f.label]))
  const demoKeys = [...new Set([
    ...regFields.map(f => f.id),
    ...participants.flatMap(p => Object.keys(p.demographics || {})),
  ])]
  const groupPoolCount = {}
  ideas.forEach(i => {
    const gid = i.groupId || authorGroupId[i.authorId]
    if (gid) groupPoolCount[gid] = (groupPoolCount[gid] || 0) + 1
  })
  const requiredVotesFor = gid => Math.max(1, Math.min(3, groupPoolCount[gid] || 3))
  const participantRows = participants.map(p => {
    const demo = p.demographics || {}
    const votedFor = p.votedFor || []
    const votesCast = votedFor.length
    const required = requiredVotesFor(p.groupId)
    const ballotStatus = !p.votesSubmitted
      ? 'not submitted'
      : votesCast === 0 ? 'empty (submitted, no votes)'
        : votesCast < required ? `partial (${votesCast}/${required})`
          : 'voted'
    const row = {
      'Participant ID': p.id,
      'Name': p.name || '',
      'Email': p.email || '',
      'Anonymous Label': p.anonymousLabel || '',
      'Group ID': p.groupId || '',
      'Group UID': p.groupId ? `${sessionCode}:${p.groupId}` : '',
      'Status': p.status || '',
      'Individual Complete': p.individualComplete ? 'Yes' : 'No',
      'Votes Submitted': p.votesSubmitted ? 'Yes' : 'No',
      'Votes Cast': votesCast,
      'Ballot Status': ballotStatus,
      'Voted For (idea IDs)': votedFor.join(', '),
      'Voted For (titles)': votedFor.map(id => ideaTitleById[id] || id).join(' | '),
      'Consent Given': p.consentGiven ? 'Yes' : 'No',
      'Consent Timestamp': p.consentTimestamp || '',
      'Joined At': formatTimestamp(p.joinedAt),
    }
    demoKeys.forEach(k => { row[labelById[k] || k] = demo[k] ?? '' })
    return row
  }).map(stamp)
  sheets.push({ name: 'Participants', kind: 'json', rows: participantRows })

  // ── Ideas (primary unit of analysis) ──
  const ideaRows = ideas.map(idea => ({
    'Idea ID': idea.id,
    'Stage': idea.phase === 'group' ? 'group' : (idea.phase === 'individual' ? 'individual (solo)' : (idea.phase || '')),
    'Phase': idea.phase || '',
    'Group ID': idea.groupId || authorGroupId[idea.authorId] || '',
    'Group UID': (idea.groupId || authorGroupId[idea.authorId]) ? `${sessionCode}:${idea.groupId || authorGroupId[idea.authorId]}` : '',
    'Author ID': idea.authorId || '',
    'Author Name': idea.authorName || '',
    'Author Label': authorLabel[idea.authorId] || idea.anonymousLabel || '',
    'Title': idea.title || '',
    'Description': idea.description || '',
    'Full Text': idea.text || '',
    'Carried to Group': idea.selected ? 'Yes' : 'No',
    'Vote Count': countVotes(idea.id, participants),
    'Final Group Pick': finalIdeaIds.has(idea.id) ? 'Yes' : 'No',
    'Final Pick Rank': finalIdeaRank[idea.id] || '',
    'Created At': formatTimestamp(idea.createdAt),
    'Exclude (Yes/No)': '',
    'Exclusion reason': '',
    'Novelty (rater 1)': '',
    'Usefulness (rater 1)': '',
    'Novelty (rater 2)': '',
    'Usefulness (rater 2)': '',
    'Novelty (rater 3)': '',
    'Usefulness (rater 3)': '',
  })).map(stamp)
  sheets.push({ name: 'Ideas', kind: 'json', rows: ideaRows })

  // ── Survey ──
  const surveyParticipants = participants.filter(p => p.surveyAnswers)
  if (surveyParticipants.length > 0) {
    const questions = getSurveyQuestions(session)
    const columns = []
    const covered = new Set()
    questions.forEach((q, i) => {
      const n = i + 1
      const qText = plain(q.text) || q.id
      if (q.type === 'rating_group' && Array.isArray(q.items) && q.items.length) {
        q.items.forEach(item => { columns.push({ header: `Q${n}. ${qText} — ${plain(item.label) || item.id}`, key: q.id, subKey: item.id }) })
      } else {
        columns.push({ header: `Q${n}. ${qText}`, key: q.id })
      }
      covered.add(q.id)
      if (q.followUp && q.followUp.id) {
        columns.push({ header: `Q${n}. ${plain(q.followUp.prompt) || 'Follow-up'}`, key: q.followUp.id })
        covered.add(q.followUp.id)
      }
    })
    const extraKeys = new Set()
    surveyParticipants.forEach(p => Object.keys(p.surveyAnswers).forEach(k => { if (!covered.has(k)) extraKeys.add(k) }))
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
    }).map(stamp)
    sheets.push({ name: 'Survey', kind: 'json', rows: surveyRows })
  }

  // ── Timing ──
  if (participants.length > 0) {
    const timingRows = participants
      .slice()
      .sort((a, b) => (a.anonymousLabel || '').localeCompare(b.anonymousLabel || '', undefined, { numeric: true }))
      .map(p => {
        const t = p.timing || {}
        const myIdeas = ideas.filter(i => i.authorId === p.id).sort((a, b) => (toMs(a.createdAt) || 0) - (toMs(b.createdAt) || 0))
        const myPrompts = aiMessages.filter(m => m.authorId === p.id && m.role === 'user').sort((a, b) => (toMs(a.timestamp) || 0) - (toMs(b.timestamp) || 0))
        const myReplies = aiMessages.filter(m => m.role === 'assistant' && m.scope === 'individual' && m.scopeId === p.id)
        return {
          'Participant ID': p.id,
          'Name': p.name || '',
          'Anonymous Label': p.anonymousLabel || '',
          'Group ID': p.groupId || '',
          'Group UID': p.groupId ? `${sessionCode}:${p.groupId}` : '',
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
      }).map(stamp)
    sheets.push({ name: 'Timing', kind: 'json', rows: timingRows })
  }

  // ── Group Chat ──
  if (chatMessages.length > 0) {
    const chatRows = chatMessages
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
      .map(msg => ({
        'Group ID': msg.groupId,
        'Author ID': msg.authorId || '',
        'Author Label': msg.authorLabel || '',
        'Message': msg.text || '',
        'Sent At': formatTimestamp(msg.createdAt),
      })).map(stamp)
    sheets.push({ name: 'Group Chat', kind: 'json', rows: chatRows })
  }

  // ── AI Chat (+ AI Usage + AI Pricing) ──
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
      'Gen time (s)': msg.generationMs != null ? Math.round(msg.generationMs / 100) / 10 : '',
      'Timestamp': formatTimestamp(msg.timestamp),
    })).map(stamp)
    sheets.push({ name: 'AI Chat', kind: 'json', rows: aiRows })

    const costUsdCol = `Cost USD (prices as of ${PRICES_AS_OF})`
    const costEurCol = `Cost EUR (as of ${PRICES_AS_OF})`
    const r4 = v => Number(v.toFixed(4))
    const usageByScope = {}
    aiMessages.forEach(msg => {
      if (msg.role !== 'assistant') return
      const key = `${msg.scope || '?'}|${msg.scopeId || '?'}`
      if (!usageByScope[key]) {
        usageByScope[key] = { scope: msg.scope || '', scopeId: msg.scopeId || '', replies: 0, inputTokens: 0, outputTokens: 0, genMs: 0, costUSD: 0, unpriced: 0, models: new Set() }
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
      'Row Type': 'scope',
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
        'Row Type': 'TOTAL', 'Scope': 'TOTAL', 'Scope ID': '',
        'AI Replies': sum('AI Replies'),
        'Input Tokens': sum('Input Tokens'),
        'Output Tokens': sum('Output Tokens'),
        'Total Tokens': sum('Total Tokens'),
        'Total gen time (s)': Math.round(sum('Total gen time (s)') * 10) / 10,
        'Avg gen time/reply (s)': sum('AI Replies') ? Math.round(sum('Total gen time (s)') / sum('AI Replies') * 10) / 10 : '',
        'Model(s)': '',
        [costUsdCol]: r4(sum(costUsdCol)),
        [costEurCol]: r4(sum(costEurCol)),
        'Unpriced Replies': sum('Unpriced Replies'),
      }
      usageRows.push(totals)
      const n = participants.length
      if (n > 0) {
        usageRows.push({
          'Row Type': 'AVG', 'Scope': `AVG PER PARTICIPANT (n=${n})`, 'Scope ID': '',
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
      sheets.push({ name: 'AI Usage', kind: 'json', rows: usageRows })
    }

    sheets.push({ name: 'AI Pricing', kind: 'json', rows: aiPricingRows() })
  }

  // ── Groups ──
  if (groups.length > 0) {
    const groupRows = groups.map(g => ({
      'Group ID': g.id,
      'Members': (g.members || []).join(', '),
      'Member Labels': g.memberLabels ? Object.entries(g.memberLabels).map(([uid, label]) => `${label}`).join(', ') : '',
      'Status': g.status || '',
      'Final Ideas': (g.finalIdeas || []).join(', '),
      'Final Ideas (titles)': (g.finalIdeas || []).map(id => {
        const it = ideaById[id]
        const tag = it ? (it.phase === 'group' ? ' [group]' : ' [individual]') : ''
        return `${ideaTitleById[id] || id}${tag}`
      }).join(' | '),
      'Created At': formatTimestamp(g.createdAt),
    })).map(stamp)
    sheets.push({ name: 'Groups', kind: 'json', rows: groupRows })
  }

  // ── Conditions (one stackable summary row per session) ──
  const isUserPrompt = (m, sc) => m.role === 'user' && m.scope === sc
  const isAiReply = (m, sc) => m.role === 'assistant' && m.scope === sc
  const conditionRows = [{
    'Session Code': sessionCode,
    'Session Name': session.name || '',
    'Condition': placement,
    'Condition (paper name)': paperName,
    'AI present in': aiPresentIn,
    'AI Solo (0/1)': aiSolo ? 1 : 0,
    'AI Group (0/1)': aiGroup ? 1 : 0,
    'Participants': participants.length,
    'Groups (triads)': groups.length,
    'Individual-stage ideas': nIndivIdeas,
    'Group-stage ideas': nGroupIdeas,
    'Carried-to-group ideas': ideas.filter(i => i.selected).length,
    'Final selected ideas': finalIdeaIds.size,
    'Ideas / participant (avg)': participants.length ? Math.round(ideas.length / participants.length * 100) / 100 : '',
    'AI prompts — solo (user)': aiMessages.filter(m => isUserPrompt(m, 'individual')).length,
    'AI prompts — group (user)': aiMessages.filter(m => isUserPrompt(m, 'group')).length,
    'AI replies — solo': aiMessages.filter(m => isAiReply(m, 'individual')).length,
    'AI replies — group': aiMessages.filter(m => isAiReply(m, 'group')).length,
    'Participants who completed survey': participants.filter(p => p.surveyAnswers).length,
  }]
  sheets.push({ name: 'Conditions', kind: 'json', rows: conditionRows })

  return sheets
}

/** The static AI Pricing reference rows (identical for every session). */
function aiPricingRows() {
  const rows = Object.entries(MODEL_PRICES).map(([m, p]) => ({
    'Model': m,
    'USD per 1M input': p ? p.in : 'not confirmed',
    'USD per 1M output': p ? p.out : 'not confirmed',
    'EUR per 1M input': p ? Number((p.in * USD_TO_EUR).toFixed(3)) : '',
    'EUR per 1M output': p ? Number((p.out * USD_TO_EUR).toFixed(3)) : '',
  }))
  rows.push({})
  rows.push({ 'Model': `Prices as of ${PRICES_AS_OF}. USD>EUR rate ${USD_TO_EUR} (same date). Update src/data/aiPricing.js when providers change prices.` })
  return rows
}

// ── Workbook writing ──────────────────────────────────────────────────────────

/** Union of object keys across rows, in first-seen order (for a stable header). */
function unionKeys(rows) {
  const keys = []
  const seen = new Set()
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k) }
  return keys
}

/** Auto-fit column widths and bold the header row of a json sheet. */
function autoWidthAndBold(ws, rows, keys) {
  if (!rows.length) return
  ws['!cols'] = keys.map(key => {
    const maxContent = Math.max(key.length, ...rows.map(r => String(r[key] ?? '').length))
    return { wch: Math.min(maxContent + 2, 50) }
  })
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })]
    if (cell) cell.s = { ...(cell.s || {}), font: { ...(cell.s && cell.s.font), bold: true } }
  }
}

/** Append a list of sheet descriptors to a workbook (json → bold/auto-fit). */
export function appendSheetsToWorkbook(wb, sheets) {
  for (const s of sheets) {
    let ws
    if (s.kind === 'aoa') {
      ws = XLSX.utils.aoa_to_sheet(s.aoa)
      if (s.cols) ws['!cols'] = s.cols
    } else {
      const header = s.header || unionKeys(s.rows)
      ws = XLSX.utils.json_to_sheet(s.rows, { header })
      autoWidthAndBold(ws, s.rows, header)
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
}

/** Fetch + build + download a single session's research export workbook. */
export async function exportSessionWorkbook(session) {
  const data = await fetchSessionExportData(session)
  const wb = XLSX.utils.book_new()
  appendSheetsToWorkbook(wb, buildSessionSheets(session, data))
  XLSX.writeFile(wb, `session_${session.code || session.id}_data.xlsx`)
}

// ── Aggregation across several sessions / imported workbooks ───────────────────

/**
 * Merge several sessions' sheet lists into ONE ordered list, stacking rows of the
 * same tab. About is replaced by a single aggregate guide; AI Pricing is kept
 * once (it is static); every other data tab concatenates its rows. Each source is
 * `{ label, sheets }` where sheets is the array from buildSessionSheets() (or
 * sheets read from an imported workbook, same shape with kind:'json').
 */
export function mergeSessionSheets(sources, aboutMeta = []) {
  const byName = new Map()     // name -> concatenated json rows
  let pricing = null           // first AI Pricing seen (kept once)
  const extraOrder = []        // names not in SHEET_ORDER, in first-seen order

  for (const src of sources) {
    for (const sheet of src.sheets || []) {
      if (sheet.name === 'About') continue                 // replaced by aggregate About
      if (sheet.name === 'AI Pricing') { if (!pricing) pricing = sheet.rows; continue }
      const rows = sheet.rows || []
      if (!rows.length) continue
      if (!byName.has(sheet.name)) {
        byName.set(sheet.name, [])
        if (!SHEET_ORDER.includes(sheet.name)) extraOrder.push(sheet.name)
      }
      byName.get(sheet.name).push(...rows)
    }
  }

  const out = []
  out.push(buildAggregateAbout(aboutMeta))
  // Keep every tab in its canonical position; AI Pricing is emitted once (deduped).
  for (const name of [...SHEET_ORDER.filter(n => n !== 'About'), ...extraOrder]) {
    if (name === 'AI Pricing') { if (pricing) out.push({ name: 'AI Pricing', kind: 'json', rows: pricing }); continue }
    if (byName.has(name)) out.push({ name, kind: 'json', rows: byName.get(name) })
  }
  return out
}

/** A single "About" guide for the aggregated workbook (same study guide text). */
function buildAggregateAbout(entries) {
  const totalParticipants = entries.reduce((s, e) => s + (e.participants || 0), 0)
  const totalIdeas = entries.reduce((s, e) => s + (e.ideas || 0), 0)
  const aoa = [
    ['Ideation Challenge — aggregated research data export'],
    [],
    ['This file consolidates ' + entries.length + ' session export(s) into ONE workbook, keeping the per-session tab structure. Rows from each session are stacked within each tab and every row is condition-stamped (Session Code + Condition + …), so the sheets read exactly like a single-session export with more rows.'],
    [],
    ['SESSIONS IN THIS FILE'],
    ['Session code', 'Condition — paper name (participants · ideas)'],
    ...entries.map(e => [e.code, `${e.placement} — ${e.paperName} (${e.participants} · ${e.ideas})`]),
    [],
    ['Totals', `${entries.length} sessions · ${totalParticipants} participants · ${totalIdeas} ideas`],
    [],
    ['STUDY — AsPredicted #298152: "The Effects of AI Timing on Idea Generation and Selection"'],
    ['Unit of analysis', 'the IDEA. Rated on Novelty, Usefulness, Overall Quality (= mean of the two) by blind expert raters.'],
    ['Manipulation', 'the TIMING of AI = {AI in solo stage} × {AI in group stage} → four between-subjects conditions, in the "Condition" column:'],
    ['  • None', 'Human-Only Hybrid    — neither stage'],
    ['  • Solo', 'Individual + AI      — solo (individual) stage only'],
    ['  • Group', 'Group + AI           — group stage only'],
    ['  • Both', 'Full AI              — both stages'],
    ['Condition coding for regressions', 'regress on the Condition column (None = reference), or use AI Solo (0/1) × AI Group (0/1) as the two dummies. Planned Solo-vs-Group contrast = rows where exactly one dummy is 1.'],
    ['Clustering unit (triad)', 'use Group UID (= "SessionCode:groupId"), NOT the bare Group ID — g0/g1… repeat across sessions.'],
    [],
    ['WHERE EACH MEASURE LIVES'],
    ['Dependent variables', '"Ideas" sheet (one row per idea) + the "Rankings" sheet (one row per idea, with empty Novelty / Usefulness / Quality columns for blind expert rating).'],
    ['Selected ideas (group level)', '"Ideas" sheet → Final Group Pick = Yes; "Groups" sheet lists them as titles.'],
    ['Vote completeness', '"Participants" sheet → Ballot Status + Votes Cast (a submitted ballot can hold zero votes).'],
    ['Mechanisms', '"AI Chat" / "AI Usage" (prompt behaviour & tokens); "Ideas" Full Text (idea diversity).'],
    ['Moderators', '"Survey" sheet (Big-Five, cognitive diversity, divergent-thinking task) + occupation / experience.'],
    ['Controls', '"Participants" sheet — Age, Gender (+ other demographics).'],
    ['Engagement / timing', '"Timing" and "Group Chat" sheets.'],
  ]
  return { name: 'About', kind: 'aoa', aoa, cols: [{ wch: 40 }, { wch: 96 }] }
}

/**
 * Build the extra "Rankings" tab from the aggregated Ideas rows. One row per idea
 * with fixed headings; the Novelty / Usefulness / Quality columns are left EMPTY
 * for blind expert rating.
 */
export function rankingsSheetFromIdeas(ideaRows) {
  const rows = (ideaRows || []).map(r => ({
    'Idea ID': r['Idea ID'] ?? '',
    'Condition': r['Condition'] ?? '',
    'Stage': r['Stage'] ?? '',
    'Final Group Pick': r['Final Group Pick'] ?? '',
    'Title': r['Title'] ?? '',
    'Description': r['Description'] ?? '',
    'Novelty': '',
    'Usefulness': '',
    'Quality': '',
  }))
  return { name: 'Rankings', kind: 'json', rows }
}
