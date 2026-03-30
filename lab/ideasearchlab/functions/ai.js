const functions = require('firebase-functions')
const admin = require('firebase-admin')

const db = admin.firestore()

// ─── Defaults ─────────────────────────────────────────────────────────────────
// To add a new AI parameter: add it here and to resolveAIConfig().
// No other file needs to change.
const DEFAULTS = {
  model: 'claude-sonnet-4-20250514',
  temperature: 1.0,
  maxTokens: 1000,
  contextWindow: 20,    // max past messages to send to the API
  systemPrompt: null,   // null = use phase-specific default below
}

const SYSTEM_PROMPTS = {
  individual: `You are a creative ideation assistant helping an individual participant generate and develop ideas.
Your role is to:
- Ask probing questions that expand their thinking
- Suggest related angles or perspectives they haven't considered
- Challenge assumptions constructively
- Encourage creative connections between concepts
Be concise. Never generate the ideas for them directly — guide them to think deeper.`,

  group: `You are a creative ideation assistant supporting a small group working together.
The group has already generated individual ideas and is now collaborating.
Your role is to:
- Help the group find connections and patterns across their individual ideas
- Challenge the group to push beyond obvious solutions
- Suggest how two or more ideas could be combined
- Ask questions that surface disagreements productively
Be concise. Address the group, not just one person.`,
}

// ─── Config resolver ───────────────────────────────────────────────────────────
function resolveAIConfig(sessionAIConfig, scope) {
  const cfg = sessionAIConfig || {}
  return {
    model:         cfg.model         ?? DEFAULTS.model,
    temperature:   cfg.temperature   ?? DEFAULTS.temperature,
    maxTokens:     cfg.maxTokens     ?? DEFAULTS.maxTokens,
    contextWindow: cfg.contextWindow ?? DEFAULTS.contextWindow,
    systemPrompt:  cfg.systemPrompt  ?? SYSTEM_PROMPTS[scope] ?? SYSTEM_PROMPTS.individual,
  }
}

// ─── LLM call ─────────────────────────────────────────────────────────────────
async function callLLM(messages, aiConfig, scope) {
  const config = resolveAIConfig(aiConfig, scope)

  // Get API key from Firebase environment config
  const apiKey = functions.config().anthropic?.key
  if (!apiKey) throw new Error('Anthropic API key not configured. Run: firebase functions:config:set anthropic.key="YOUR_KEY"')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:       config.model,
      max_tokens:  config.maxTokens,
      temperature: config.temperature,
      system:      config.systemPrompt,
      messages:    messages.slice(-config.contextWindow),
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Anthropic API error: ${err}`)
  }

  const data = await response.json()
  return data.content?.[0]?.text || ''
}

// ─── Cloud Function ────────────────────────────────────────────────────────────
/**
 * sendAIMessage
 *
 * Called from AIChat component. Fetches conversation history from Firestore,
 * calls the LLM, stores the response, returns it to the client.
 *
 * data: { sessionId, scope, scopeId, userMessage }
 * scope: 'individual' | 'group'
 * scopeId: uid (individual) | groupId (group)
 */
exports.sendAIMessage = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.')

  const { sessionId, scope, scopeId, userMessage } = data

  if (!sessionId || !scope || !scopeId || !userMessage) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields.')
  }

  // Load session to get aiConfig
  const sessionSnap = await db.collection('sessions').doc(sessionId).get()
  if (!sessionSnap.exists) throw new functions.https.HttpsError('not-found', 'Session not found.')
  const session = sessionSnap.data()

  // Verify AI is enabled for this scope
  if (scope === 'individual' && !session.aiConfig?.individualAI) {
    throw new functions.https.HttpsError('permission-denied', 'AI not enabled for individual phase.')
  }
  if (scope === 'group' && !session.aiConfig?.groupAI) {
    throw new functions.https.HttpsError('permission-denied', 'AI not enabled for group phase.')
  }

  // Load conversation history for this scope
  const historySnap = await db
    .collection('sessions').doc(sessionId)
    .collection('aiMessages')
    .where('scope', '==', scope)
    .where('scopeId', '==', scopeId)
    .orderBy('timestamp', 'asc')
    .get()

  const history = historySnap.docs.map(d => ({
    role: d.data().role,
    content: d.data().text,
  }))

  // Append the new user message
  history.push({ role: 'user', content: userMessage })

  // Call the LLM
  const assistantText = await callLLM(history, session.aiConfig, scope)

  // Store the assistant response in Firestore
  await db
    .collection('sessions').doc(sessionId)
    .collection('aiMessages')
    .add({
      role: 'assistant',
      text: assistantText,
      scope,
      scopeId,
      authorId: 'ai',
      authorName: 'AI Assistant',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })

  return { text: assistantText }
})
