const functionsV1 = require('firebase-functions/v1')
const functions = functionsV1.region('europe-west1')
const { HttpsError } = functionsV1.https
const admin = require('firebase-admin')

const db = admin.firestore()

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  provider: 'claude',                        // 'claude' | 'openai' | 'gemini'
  model: null,                               // null = use provider default below
  temperature: 1.0,
  maxTokens: 1000,
  contextWindow: 20,
  systemPrompt: null,
}

// Keep in sync with the model lists in src/pages/AISettings.jsx (June 2026).
const PROVIDER_DEFAULTS = {
  claude: { model: 'claude-sonnet-4-6' },
  openai: { model: 'gpt-5.5' },
  gemini: { model: 'gemini-3.5-flash' },
}

const SYSTEM_PROMPTS = {
  individual: `You are an enthusiastic, knowledgeable ideation partner helping a participant brainstorm, develop, select, and evaluate ideas during a creative session.

How to help:
- Brainstorm freely: generate ideas, build directly on the participant's, and offer fresh angles, concrete examples, and useful analogies.
- Help them choose and evaluate ideas: weigh pros and cons, surface trade-offs, and suggest simple criteria for comparing options.
- Give a useful, substantive answer first. You may add a sharpening question afterwards, but never reply with only a question and never refuse to help generate ideas.
- Answer general or factual questions directly and correctly (for example, "1+1" is "2"). Be a well-rounded, genuinely helpful assistant, not a riddle-master.

Style: warm, concise, and practical. Use plain language and offer concrete suggestions the participant can act on.`,

  group: `You are an enthusiastic, knowledgeable ideation partner supporting a small group collaborating on ideas. The group has generated individual ideas and is now refining them together.

How to help:
- Brainstorm with the group: combine and extend their ideas, propose new directions, and give concrete examples.
- Help them select and evaluate ideas: find connections across ideas, suggest evaluation criteria, and weigh trade-offs.
- Address the group as a whole. Give a substantive, actionable answer first; add a sharpening question only when it genuinely helps. Never reply with only a question and never refuse to help generate ideas.
- Answer general or factual questions directly and correctly. Be a well-rounded, genuinely helpful assistant.

Style: warm, concise, and practical. Use plain language.`,
}

// ─── Load global AI settings from Firestore ───────────────────────────────────
async function loadGlobalAISettings() {
  const snap = await db.collection('settings').doc('ai').get()
  if (!snap.exists) return {}
  return snap.data()
}

// ─── Config resolver ──────────────────────────────────────────────────────────
function resolveAIConfig(sessionAIConfig, globalSettings, scope) {
  const provider = sessionAIConfig?.provider
    ?? globalSettings?.provider
    ?? DEFAULTS.provider

  const providerDefaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.claude

  return {
    provider,
    apiKey:        globalSettings?.apiKeys?.[provider] || null,
    model:         sessionAIConfig?.model         ?? globalSettings?.model         ?? providerDefaults.model,
    temperature:   sessionAIConfig?.temperature   ?? globalSettings?.temperature   ?? DEFAULTS.temperature,
    maxTokens:     sessionAIConfig?.maxTokens     ?? globalSettings?.maxTokens     ?? DEFAULTS.maxTokens,
    contextWindow: sessionAIConfig?.contextWindow ?? globalSettings?.contextWindow ?? DEFAULTS.contextWindow,
    systemPrompt:  sessionAIConfig?.systemPrompt  ?? globalSettings?.systemPrompt  ?? SYSTEM_PROMPTS[scope] ?? SYSTEM_PROMPTS.individual,
  }
}

// ─── Provider API calls ───────────────────────────────────────────────────────

async function callClaude(messages, config) {
  // Claude Opus 4.7+ and the Fable/Mythos family removed sampling parameters —
  // sending `temperature` to them returns a 400. Older models still accept it.
  const supportsTemperature = !/^claude-(opus-4-(?:[7-9]|\d{2})|fable|mythos)/.test(config.model || '')
  const body = {
    model:      config.model,
    max_tokens: config.maxTokens,
    system:     config.systemPrompt,
    messages,
  }
  if (supportsTemperature && config.temperature != null) {
    body.temperature = config.temperature
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Claude API error: ${await response.text()}`)
  const data = await response.json()
  // Newer models may lead with a thinking block — return the first text block.
  return {
    text: data.content?.find(b => b.type === 'text')?.text || '',
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
  }
}

async function callOpenAI(messages, config) {
  // Convert to OpenAI message format (system message goes first)
  const openAIMessages = [
    { role: 'system', content: config.systemPrompt },
    ...messages,
  ]
  // GPT-5-family and o-series reasoning models take max_completion_tokens and
  // reject non-default temperature; older chat models keep the legacy params.
  const isReasoningFamily = /^(gpt-5|o\d)/.test(config.model || '')
  const body = { model: config.model, messages: openAIMessages }
  if (isReasoningFamily) {
    body.max_completion_tokens = config.maxTokens
  } else {
    body.max_tokens = config.maxTokens
    if (config.temperature != null) body.temperature = config.temperature
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`OpenAI API error: ${await response.text()}`)
  const data = await response.json()
  return {
    text: data.choices?.[0]?.message?.content || '',
    inputTokens: data.usage?.prompt_tokens ?? null,
    outputTokens: data.usage?.completion_tokens ?? null,
  }
}

async function callGemini(messages, config) {
  // Convert to Gemini format
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: config.systemPrompt }] },
      contents,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
      },
    }),
  })
  if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`)
  const data = await response.json()
  // Billed output on Gemini thinking models = visible candidates + thoughts.
  const um = data.usageMetadata || {}
  const hasOutputCount = um.candidatesTokenCount != null || um.thoughtsTokenCount != null
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    inputTokens: um.promptTokenCount ?? null,
    outputTokens: hasOutputCount ? (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0) : null,
  }
}

// ─── Main LLM dispatcher ──────────────────────────────────────────────────────
async function callLLM(messages, config) {
  if (!config.apiKey) throw new Error(`No API key configured for provider: ${config.provider}`)

  switch (config.provider) {
    case 'claude': return callClaude(messages, config)
    case 'openai': return callOpenAI(messages, config)
    case 'gemini': return callGemini(messages, config)
    default: throw new Error(`Unknown provider: ${config.provider}`)
  }
}

// ─── Cloud Functions ──────────────────────────────────────────────────────────

/**
 * sendAIMessage
 * Called from AIChat component.
 */
exports.sendAIMessage = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Must be logged in.')

  const { sessionId, scope, scopeId, userMessage } = data
  if (!sessionId || !scope || !scopeId || !userMessage) {
    throw new HttpsError('invalid-argument', 'Missing required fields.')
  }

  const [sessionSnap, globalSettings] = await Promise.all([
    db.collection('sessions').doc(sessionId).get(),
    loadGlobalAISettings(),
  ])

  if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found.')
  const session = sessionSnap.data()

  if (scope === 'individual' && !session.aiConfig?.individualAI) {
    throw new HttpsError('permission-denied', 'AI not enabled for individual phase.')
  }
  if (scope === 'group' && !session.aiConfig?.groupAI) {
    throw new HttpsError('permission-denied', 'AI not enabled for group phase.')
  }

  const config = resolveAIConfig(session.aiConfig, globalSettings, scope)

  // Load conversation history
  const historySnap = await db
    .collection('sessions').doc(sessionId)
    .collection('aiMessages')
    .where('scope', '==', scope)
    .where('scopeId', '==', scopeId)
    .orderBy('timestamp', 'asc')
    .get()

  const history = historySnap.docs.map(d => ({
    role: d.data().role === 'assistant' ? 'assistant' : 'user',
    content: d.data().text,
  }))

  history.push({ role: 'user', content: userMessage })

  const { text: assistantText, inputTokens, outputTokens } =
    await callLLM(history.slice(-config.contextWindow), config)

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
      // Token usage as reported by the provider, for cost/budget analysis
      provider: config.provider,
      model: config.model,
      inputTokens: inputTokens ?? null,
      outputTokens: outputTokens ?? null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })

  return { text: assistantText }
})

/**
 * saveAISettings
 * Instructor saves global AI provider settings and API keys.
 */
exports.saveAISettings = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Must be logged in.')
  // Global AI settings (including API keys) are admin-only.
  if (context.auth.token.email !== 'admin@admin.com') {
    throw new HttpsError('permission-denied', 'Only the administrator can change AI settings.')
  }

  const { provider, apiKeys, model, temperature, maxTokens, contextWindow, systemPrompt } = data

  const allowed = ['claude', 'openai', 'gemini']
  if (provider && !allowed.includes(provider)) {
    throw new HttpsError('invalid-argument', 'Invalid provider.')
  }

  // Partial updates are allowed (the doc is merged); null clears a field so
  // it falls back to the built-in default in resolveAIConfig.
  const update = {}
  if (provider)                    update.provider      = provider
  if (apiKeys)                     update.apiKeys       = apiKeys       // { claude: 'sk-ant-...', openai: 'sk-...', gemini: 'AIza...' }
  if (model !== undefined)         update.model         = model         // null = provider default
  if (temperature !== undefined)   update.temperature   = temperature
  if (maxTokens !== undefined)     update.maxTokens     = maxTokens
  if (contextWindow !== undefined) update.contextWindow = contextWindow
  if (systemPrompt !== undefined)  update.systemPrompt  = systemPrompt  // null = built-in phase prompts

  update.updatedAt = admin.firestore.FieldValue.serverTimestamp()
  update.updatedBy = context.auth.uid

  await db.collection('settings').doc('ai').set(update, { merge: true })
  return { success: true }
})

