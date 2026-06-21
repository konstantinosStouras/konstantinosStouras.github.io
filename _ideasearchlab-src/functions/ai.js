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

// Human-friendly names for the AI note shown to participants. Mirrored to the
// public settings/aiPublic doc so the app can say which model is in use without
// exposing keys. Unknown ids fall back to the provider brand.
const MODEL_LABELS = {
  'claude-opus-4-8': "Anthropic's Claude Opus 4.8",
  'claude-fable-5': "Anthropic's Claude Fable 5",
  'claude-opus-4-7': "Anthropic's Claude Opus 4.7",
  'claude-opus-4-6': "Anthropic's Claude Opus 4.6",
  'claude-sonnet-4-6': "Anthropic's Claude Sonnet 4.6",
  'claude-haiku-4-5': "Anthropic's Claude Haiku 4.5",
  'claude-opus-4-5': "Anthropic's Claude Opus 4.5",
  'claude-sonnet-4-5': "Anthropic's Claude Sonnet 4.5",
  'gpt-5.5': "OpenAI's GPT-5.5",
  'gpt-5.4-mini': "OpenAI's GPT-5.4 mini",
  'gpt-5.4-nano': "OpenAI's GPT-5.4 nano",
  'gpt-5.2': "OpenAI's GPT-5.2",
  'gpt-5.1': "OpenAI's GPT-5.1",
  'gpt-4.1': "OpenAI's GPT-4.1",
  'gpt-4o': "OpenAI's GPT-4o",
  'gemini-3.5-flash': "Google's Gemini 3.5 Flash",
  'gemini-3.1-pro-preview': "Google's Gemini 3.1 Pro",
  'gemini-3-flash': "Google's Gemini 3 Flash",
  'gemini-2.5-pro': "Google's Gemini 2.5 Pro",
  'gemini-2.5-flash': "Google's Gemini 2.5 Flash",
  'gemini-2.5-flash-lite': "Google's Gemini 2.5 Flash-Lite",
}
const PROVIDER_BRANDS = {
  claude: "Anthropic's Claude",
  openai: "OpenAI's GPT",
  gemini: "Google's Gemini",
}
function modelLabel(provider, model) {
  return MODEL_LABELS[model] || PROVIDER_BRANDS[provider] || model || 'an advanced AI model'
}

// Built-in default system prompt (what "Restore built-in default" falls back
// to). One prompt serves both phases. Keep in sync with the recommended prompt
// in src/pages/AISettings.jsx.
const IDEATION_PARTNER_PROMPT = `You are a collaborative ideation partner helping a participant (or a small group)
design a new product during a creative session. You help them produce strong ideas
efficiently.

Working with them:
- Brainstorm together, build on what they say, and add fresh angles and concrete
  examples that could create value.
- Help them refine: sharpen a vague idea, combine ideas, strengthen weak points.
- Help them evaluate: weigh pros, cons, and trade-offs, and suggest simple criteria
  for comparing options when useful.

How to hand off an idea (important):
- When an idea takes shape format it as:
  TITLE: <short title>
  DESCRIPTION: <one to two sentences>

Formatting:
- Use emojis very sparingly — only when one genuinely adds light or funny context.
  Never decorate every item or heading with emojis; default to none.

Keep it efficient:
- Be brief and concrete — a few focused points per reply, no walls of text.

Also answer plain factual questions directly and correctly. Be warm, practical, and
genuinely helpful. Never refuse to help generate ideas, and never reply with only a
question.`

const SYSTEM_PROMPTS = {
  individual: IDEATION_PARTNER_PROMPT,
  group: IDEATION_PARTNER_PROMPT,
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

  // Time the provider call so we can report how long each AI reply took.
  const genStart = Date.now()
  const { text: assistantText, inputTokens, outputTokens } =
    await callLLM(history.slice(-config.contextWindow), config)
  const generationMs = Date.now() - genStart

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
      // How long the provider took to generate this reply (ms).
      generationMs,
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

  // Mirror only the non-secret display info (provider + model) to a
  // participant-readable doc, so the app can name the AI in use without ever
  // exposing API keys. Re-read the merged doc so a partial update still yields
  // the full effective provider/model.
  try {
    const merged = (await db.collection('settings').doc('ai').get()).data() || {}
    const prov = merged.provider || DEFAULTS.provider
    const mdl = merged.model || (PROVIDER_DEFAULTS[prov] || PROVIDER_DEFAULTS.claude).model
    await db.collection('settings').doc('aiPublic').set({
      provider: prov,
      model: mdl,
      modelLabel: modelLabel(prov, mdl),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch (err) {
    console.error('Failed to mirror settings/aiPublic:', err)
  }

  return { success: true }
})

