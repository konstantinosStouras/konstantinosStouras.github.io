import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { doc, onSnapshot } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { db, auth, functions } from '../firebase'
import { useTheme } from '../context/ThemeContext'
import { PROVIDERS } from '../data/aiModels'
import styles from './AISettings.module.css'

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
const RECOMMENDED_IDEATION_PROMPT = `You are a collaborative ideation partner helping a participant (or a small group)
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
          <button className="btn-ghost" onClick={() => navigate('/admin')}>Admin</button>
          <button className="btn-ghost" onClick={() => navigate('/admin/data-analytics')}>Data Analytics</button>
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
