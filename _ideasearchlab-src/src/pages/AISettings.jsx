import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { doc, onSnapshot } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { db, auth, functions } from '../firebase'
import { useTheme } from '../context/ThemeContext'
import styles from './AISettings.module.css'

// Model lists updated June 2026. Keep in sync with PROVIDER_DEFAULTS in
// functions/ai.js (the "Use default" option). Older saved model IDs keep
// working until the provider retires them.
const PROVIDERS = [
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-ant-...',
    keyLink: 'https://console.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable Opus (recommended)' },
      { id: 'claude-fable-5', label: 'Claude Fable 5 — frontier model (premium pricing)' },
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — best speed/cost balance' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest, most cost-effective' },
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5 (older)' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (older)' },
    ],
  },
  {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-...',
    keyLink: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-5.5',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5 — flagship (recommended)' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini — fast, cost-efficient' },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano — fastest, cheapest' },
      { id: 'gpt-5.2', label: 'GPT-5.2 — previous flagship' },
      { id: 'gpt-5.1', label: 'GPT-5.1' },
      { id: 'gpt-4.1', label: 'GPT-4.1 (older)' },
      { id: 'gpt-4o', label: 'GPT-4o (legacy)' },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini (Google)',
    keyLabel: 'API Key',
    keyPlaceholder: 'AIza...',
    keyLink: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-3.5-flash',
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash — latest GA (recommended)' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview) — deepest reasoning' },
      { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
    ],
  },
]

// The same three default-management buttons used across the admin panel,
// shown under every section. In this app the global `settings/ai` document IS
// the configuration applied to every session, so "Save" and "Make this the
// default" both persist this section to that document (they differ only in the
// confirmation they show). "Restore built-in default" clears the section back
// to the hardcoded fallback in functions/ai.js and is disabled while the
// section already uses that built-in default (nothing saved to restore from).
function DefaultActions({ onSave, onMakeDefault, onRestore, hasCustom, feedback }) {
  return (
    <div className={styles.btnRow}>
      <button
        type="button"
        className={styles.saveSectionBtn}
        onClick={onSave}
        title="Save this section's current values"
      >
        Save
      </button>
      <button
        type="button"
        className={styles.defaultBtn}
        onClick={onMakeDefault}
        title="Save these values as the default applied to every session"
      >
        Make this the default
      </button>
      <button
        type="button"
        className={styles.resetBtn}
        onClick={onRestore}
        disabled={!hasCustom}
        title={
          hasCustom
            ? 'Discard the saved value and go back to the built-in default'
            : 'Already using the built-in default'
        }
      >
        Restore built-in default
      </button>
      {feedback && <span className={styles.savedNote}>{feedback}</span>}
    </div>
  )
}

// A ready-to-use system prompt that makes the assistant behave as a helpful
// ideation partner (generate, select, evaluate, brainstorm anything) and answer
// plain questions directly. Saving this takes effect immediately without
// redeploying Cloud Functions, since the resolver prefers the saved override.
const RECOMMENDED_IDEATION_PROMPT = `You are an enthusiastic, knowledgeable ideation partner helping participants brainstorm, develop, select, and evaluate ideas during a creative session.

How to help:
- Brainstorm freely: generate ideas, build directly on the participant's, and offer fresh angles, concrete examples, and useful analogies.
- Help them choose and evaluate ideas: weigh pros and cons, surface trade-offs, and suggest simple criteria for comparing options.
- Give a useful, substantive answer first. You may add a sharpening question afterwards, but never reply with only a question and never refuse to help generate ideas.
- Answer general or factual questions directly and correctly (for example, "1+1" is "2"). Be a well-rounded, genuinely helpful assistant, not a riddle-master.

Style: warm, concise, and practical. Use plain language and offer concrete suggestions the participant can act on.`

export default function AISettings() {
  const navigate = useNavigate()
  const { dark, toggle } = useTheme()
  const [current, setCurrent] = useState(null)
  const [provider, setProvider] = useState('claude')
  const [apiKeys, setApiKeys] = useState({ claude: '', openai: '', gemini: '' })
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState(1.0)
  const [maxTokens, setMaxTokens] = useState(1000)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [sectionFeedback, setSectionFeedback] = useState(null) // { key, text }

  function flashSection(key, text) {
    setSectionFeedback({ key, text })
    setTimeout(() => setSectionFeedback(curr => (curr?.key === key ? null : curr)), 3000)
  }

  // Save a partial update to settings/ai (the doc is merged server-side;
  // null clears a field back to its built-in default). The message lets each
  // button (Save / Make this the default / Restore built-in default) show its
  // own confirmation while sharing one code path.
  async function saveSection(key, values, message = 'Saved.') {
    try {
      await httpsCallable(functions, 'saveAISettings')(values)
      flashSection(key, message)
    } catch (err) {
      flashSection(key, err.message || 'Could not save.')
    }
  }

  // Load current settings from Firestore
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'ai'), snap => {
      if (snap.exists()) {
        const data = snap.data()
        setCurrent(data)
        if (data.provider)     setProvider(data.provider)
        if (data.apiKeys)      setApiKeys(k => ({ ...k, ...data.apiKeys }))
        if (data.model)        setModel(data.model)
        if (data.temperature)  setTemperature(data.temperature)
        if (data.maxTokens)    setMaxTokens(data.maxTokens)
        if (data.systemPrompt) setSystemPrompt(data.systemPrompt)
      }
    })
    return unsub
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const save = httpsCallable(functions, 'saveAISettings')
      await save({
        provider,
        apiKeys,
        model: model || null,
        temperature,
        maxTokens,
        systemPrompt: systemPrompt || null,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message || 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  const activeProvider = PROVIDERS.find(p => p.id === provider)

  return (
    <div className={styles.pageWrap}>
      <header className={styles.topBar}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <div className={styles.topBarRight}>
          <span className={styles.role}>Instructor</span>
          <button className={styles.themeBtn} onClick={toggle} title="Toggle dark mode">
            {dark ? '☀' : '☾'}
          </button>
          <button className="btn-ghost" onClick={() => navigate('/admin')}>{'←'} Back to Admin</button>
          <button className="btn-ghost" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </header>

      <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>AI Settings</h1>
        <p className={styles.sub}>
          Configure which LLM provider powers the AI assistant across all sessions.
          API keys are stored securely in Firestore and never exposed to participants.
        </p>
      </div>

      <form onSubmit={handleSave} className={styles.form}>

        {/* Provider selector */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Provider</h2>
          <div className={styles.providerGrid}>
            {PROVIDERS.map(p => (
              <div
                key={p.id}
                className={`${styles.providerCard} ${provider === p.id ? styles.providerActive : ''}`}
                onClick={() => { setProvider(p.id); setModel('') }}
              >
                <span className={styles.providerName}>{p.name}</span>
                {apiKeys[p.id] ? (
                  <span className={styles.keySet}>key set</span>
                ) : (
                  <span className={styles.keyMissing}>no key</span>
                )}
              </div>
            ))}
          </div>
          <DefaultActions
            onSave={() => saveSection('provider', { provider }, 'Saved.')}
            onMakeDefault={() => saveSection('provider', { provider }, 'Saved — this is now the default for all sessions.')}
            onRestore={() => { setProvider('claude'); setModel(''); saveSection('provider', { provider: 'claude' }, 'Restored the built-in default (Claude).') }}
            hasCustom={current?.provider != null && current.provider !== 'claude'}
            feedback={sectionFeedback?.key === 'provider' ? sectionFeedback.text : null}
          />
        </div>

        {/* API Keys - one field per provider */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>API Keys</h2>
          <p className={styles.hint}>
            You can store keys for multiple providers. Only the active provider's key is used.
            Keys are saved when you click Save below (or Save Settings at the bottom) and load
            back automatically every time you open this page — only the administrator account
            can read or change them.
          </p>
          {PROVIDERS.map(p => (
            <div key={p.id} className={styles.field}>
              <label className={styles.label}>
                <span className={styles.labelLeft}>
                  {p.name}
                  {current?.apiKeys?.[p.id] && <span className={styles.keySet}>saved ✓</span>}
                </span>
                <a href={p.keyLink} target="_blank" rel="noopener noreferrer" className={styles.keyLink}>
                  Get key →
                </a>
              </label>
              <input
                className="input-field"
                type="password"
                value={apiKeys[p.id] || ''}
                onChange={e => setApiKeys(k => ({ ...k, [p.id]: e.target.value }))}
                placeholder={p.keyPlaceholder}
                autoComplete="off"
              />
            </div>
          ))}
          <DefaultActions
            onSave={() => saveSection('keys', { apiKeys }, 'Keys saved.')}
            onMakeDefault={() => saveSection('keys', { apiKeys }, 'Keys saved — now the default for all sessions.')}
            onRestore={() => {
              if (!window.confirm('Remove all saved API keys and go back to no keys (the built-in default)?')) return
              const cleared = { claude: '', openai: '', gemini: '' }
              setApiKeys(cleared)
              saveSection('keys', { apiKeys: cleared }, 'Removed saved API keys.')
            }}
            hasCustom={!!(current?.apiKeys && Object.values(current.apiKeys).some(Boolean))}
            feedback={sectionFeedback?.key === 'keys' ? sectionFeedback.text : null}
          />
        </div>

        {/* Model */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Model</h2>
          <div className={styles.field}>
            <label className={styles.label}>Model for {activeProvider?.name}</label>
            <select
              className="input-field"
              value={model}
              onChange={e => setModel(e.target.value)}
            >
              <option value="">Use default ({activeProvider?.defaultModel})</option>
              {activeProvider?.models.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <p className={styles.hint}>
              Model lists updated June 2026. A previously saved model keeps working
              until its provider retires it; models marked preview may change.
            </p>
          </div>
          <DefaultActions
            onSave={() => saveSection('model', { model: model || null }, 'Saved.')}
            onMakeDefault={() => saveSection('model', { model: model || null }, 'Saved — this is now the default for all sessions.')}
            onRestore={() => { setModel(''); saveSection('model', { model: null }, 'Restored the built-in default.') }}
            hasCustom={!!current?.model}
            feedback={sectionFeedback?.key === 'model' ? sectionFeedback.text : null}
          />
        </div>

        {/* Advanced parameters */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Parameters</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Temperature (0 = deterministic, 2 = creative)</label>
              <input
                className="input-field"
                type="number"
                min="0" max="2" step="0.1"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Max tokens per response</label>
              <input
                className="input-field"
                type="number"
                min="100" max="4000" step="100"
                value={maxTokens}
                onChange={e => setMaxTokens(parseInt(e.target.value))}
              />
            </div>
          </div>
          <DefaultActions
            onSave={() => saveSection('params', { temperature, maxTokens }, 'Saved.')}
            onMakeDefault={() => saveSection('params', { temperature, maxTokens }, 'Saved — this is now the default for all sessions.')}
            onRestore={() => {
              setTemperature(1.0)
              setMaxTokens(1000)
              saveSection('params', { temperature: 1.0, maxTokens: 1000 }, 'Restored the built-in default.')
            }}
            hasCustom={current?.temperature != null || current?.maxTokens != null}
            feedback={sectionFeedback?.key === 'params' ? sectionFeedback.text : null}
          />
        </div>

        {/* System prompt override */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>System Prompt Override</h2>
          <p className={styles.hint}>
            Sets how the AI behaves for participants. Leave blank to use the
            built-in phase prompts, or click below to load a ready-made
            ideation-partner prompt that brainstorms, helps select and evaluate
            ideas, and answers plain questions directly. Saving applies right
            away (no Cloud Functions redeploy needed).
          </p>
          <button
            type="button"
            className="btn-ghost"
            style={{ marginBottom: 10 }}
            onClick={() => setSystemPrompt(RECOMMENDED_IDEATION_PROMPT)}
            title="Fill the box with a recommended ideation-partner prompt"
          >
            Use recommended ideation-partner prompt
          </button>
          <textarea
            className={`input-field ${styles.promptArea}`}
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="Leave blank to use default phase prompts..."
            rows={6}
          />
          <DefaultActions
            onSave={() => saveSection('prompt', { systemPrompt: systemPrompt || null }, 'Saved.')}
            onMakeDefault={() => saveSection('prompt', { systemPrompt: systemPrompt || null }, 'Saved — this is now the default for all sessions.')}
            onRestore={() => { setSystemPrompt(''); saveSection('prompt', { systemPrompt: null }, 'Restored the built-in default.') }}
            hasCustom={!!current?.systemPrompt}
            feedback={sectionFeedback?.key === 'prompt' ? sectionFeedback.text : null}
          />
        </div>

        {error && <p className="error-msg">{error}</p>}

        <button
          className={`btn-primary ${styles.saveBtn}`}
          type="submit"
          disabled={saving}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </form>
      </div>
    </div>
  )
}
