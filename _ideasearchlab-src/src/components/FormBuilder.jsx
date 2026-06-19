import { FIELD_TYPES, QUESTION_TYPES, newId } from '../data/formDefaults'
import styles from './FormBuilder.module.css'

// ── small immutable helpers ────────────────────────────────────────────────
const replaceAt = (arr, i, val) => arr.map((x, j) => (j === i ? val : x))
const removeAt = (arr, i) => arr.filter((_, j) => j !== i)
function moveAt(arr, i, dir) {
  const j = i + dir
  if (j < 0 || j >= arr.length) return arr
  const copy = [...arr]
  ;[copy[i], copy[j]] = [copy[j], copy[i]]
  return copy
}

function RowControls({ i, count, onMove, onRemove }) {
  return (
    <div className={styles.rowControls}>
      <button type="button" className={styles.iconBtn} title="Move up" disabled={i === 0} onClick={() => onMove(i, -1)}>↑</button>
      <button type="button" className={styles.iconBtn} title="Move down" disabled={i === count - 1} onClick={() => onMove(i, 1)}>↓</button>
      <button type="button" className={styles.removeBtn} title="Remove" onClick={() => onRemove(i)}>✕</button>
    </div>
  )
}

// Editable list of plain string options (for dropdowns / multiple choice).
function OptionList({ options, onChange }) {
  return (
    <div className={styles.optionList}>
      {options.map((opt, i) => (
        <div key={i} className={styles.optionRow}>
          <input
            className="input-field"
            value={opt}
            placeholder={`Option ${i + 1}`}
            onChange={e => onChange(replaceAt(options, i, e.target.value))}
          />
          <button type="button" className={styles.removeBtn} title="Remove option" onClick={() => onChange(removeAt(options, i))}>✕</button>
        </div>
      ))}
      <button type="button" className={styles.addMini} onClick={() => onChange([...options, ''])}>+ Add option</button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Registration form builder
// ════════════════════════════════════════════════════════════════════════════
export function RegistrationBuilder({ value, onChange }) {
  const fields = value.fields || []
  const consents = value.consents || []
  const setFields = f => onChange({ ...value, fields: f })
  const setConsents = c => onChange({ ...value, consents: c })

  function patchField(i, patch) {
    setFields(replaceAt(fields, i, { ...fields[i], ...patch }))
  }

  function addField() {
    setFields([...fields, { id: newId('f'), label: 'New question', type: 'select', required: true, options: ['Option 1'] }])
  }

  return (
    <div className={styles.builder}>
      <p className={styles.builderHint}>Demographic questions shown on the Registration page. Reorder, edit, add or remove them.</p>

      {fields.map((f, i) => (
        <div key={f.id} className={styles.itemCard}>
          <div className={styles.itemTop}>
            <input
              className={`input-field ${styles.grow}`}
              value={f.label}
              placeholder="Question label"
              onChange={e => patchField(i, { label: e.target.value })}
            />
            <RowControls i={i} count={fields.length} onMove={(idx, d) => setFields(moveAt(fields, idx, d))} onRemove={idx => setFields(removeAt(fields, idx))} />
          </div>

          <div className={styles.itemRow}>
            <label className={styles.miniLabel}>
              Type
              <select className="input-field" value={f.type} onChange={e => patchField(i, { type: e.target.value })}>
                {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={!!f.required} onChange={e => patchField(i, { required: e.target.checked })} />
              Required
            </label>
          </div>

          {f.type === 'select' && (
            <OptionList options={f.options || []} onChange={opts => patchField(i, { options: opts })} />
          )}
          {f.type === 'number' && (
            <div className={styles.itemRow}>
              <label className={styles.miniLabel}>Min
                <input className="input-field" type="number" value={f.min ?? ''} onChange={e => patchField(i, { min: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
              <label className={styles.miniLabel}>Max
                <input className="input-field" type="number" value={f.max ?? ''} onChange={e => patchField(i, { max: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
            </div>
          )}
          {f.type === 'country' && <p className={styles.note}>Uses the built-in 195-country dropdown.</p>}
        </div>
      ))}

      <button type="button" className={styles.addBtn} onClick={addField}>+ Add registration question</button>

      <h4 className={styles.subHead}>Consent checkboxes</h4>
      {consents.map((c, i) => (
        <div key={i} className={styles.consentRow}>
          <textarea
            className="input-field"
            rows={2}
            value={c}
            placeholder="Consent statement"
            onChange={e => setConsents(replaceAt(consents, i, e.target.value))}
          />
          <button type="button" className={styles.removeBtn} title="Remove" onClick={() => setConsents(removeAt(consents, i))}>✕</button>
        </div>
      ))}
      <button type="button" className={styles.addMini} onClick={() => setConsents([...consents, ''])}>+ Add consent statement</button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Survey questions builder
// ════════════════════════════════════════════════════════════════════════════
export function SurveyBuilder({ value, onChange }) {
  const questions = value.questions || []
  const setQuestions = q => onChange({ ...value, questions: q })

  function patchQ(i, patch) {
    setQuestions(replaceAt(questions, i, { ...questions[i], ...patch }))
  }

  function addQuestion() {
    setQuestions([...questions, {
      id: newId('q'), section: '', sectionSubheading: '', text: 'New question', type: 'likert5',
      lowLabel: '1', highLabel: '5', items: [], options: [], followUp: null,
      required: true, showIfGroup: false,
    }])
  }

  return (
    <div className={styles.builder}>
      <p className={styles.builderHint}>Post-session survey questions. The survey title/intro is edited under Page Text → Survey.</p>

      {questions.map((q, i) => (
        <div key={q.id} className={styles.itemCard}>
          <div className={styles.itemTop}>
            <span className={styles.qNum}>Q{i + 1}</span>
            <RowControls i={i} count={questions.length} onMove={(idx, d) => setQuestions(moveAt(questions, idx, d))} onRemove={idx => setQuestions(removeAt(questions, idx))} />
          </div>

          <input
            className={`input-field ${styles.full}`}
            value={q.section}
            placeholder="Section heading (optional — starts a new section)"
            onChange={e => patchQ(i, { section: e.target.value })}
          />
          <input
            className={`input-field ${styles.full}`}
            value={q.sectionSubheading || ''}
            placeholder="Section subheading (optional — adds a subheading below the heading)"
            onChange={e => patchQ(i, { sectionSubheading: e.target.value })}
          />
          <textarea
            className={`input-field ${styles.full}`}
            rows={2}
            value={q.text}
            placeholder="Question text"
            onChange={e => patchQ(i, { text: e.target.value })}
          />

          <div className={styles.itemRow}>
            <label className={styles.miniLabel}>Type
              <select className="input-field" value={q.type} onChange={e => patchQ(i, { type: e.target.value })}>
                {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={q.required !== false} onChange={e => patchQ(i, { required: e.target.checked })} />
              Required
            </label>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={!!q.showIfGroup} onChange={e => patchQ(i, { showIfGroup: e.target.checked })} />
              Group phase only
            </label>
          </div>

          {q.type === 'likert5' && (
            <div className={styles.itemRow}>
              <label className={styles.miniLabel}>Low label (1)
                <input className="input-field" value={q.lowLabel} onChange={e => patchQ(i, { lowLabel: e.target.value })} />
              </label>
              <label className={styles.miniLabel}>High label (5)
                <input className="input-field" value={q.highLabel} onChange={e => patchQ(i, { highLabel: e.target.value })} />
              </label>
            </div>
          )}

          {q.type === 'radio' && (
            <>
              <OptionList options={q.options || []} onChange={opts => patchQ(i, { options: opts })} />
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={!!q.followUp}
                  onChange={e => patchQ(i, { followUp: e.target.checked ? { trigger: (q.options || [])[0] || '', id: `${q.id}_detail`, prompt: 'Please specify' } : null })}
                />
                Conditional follow-up (free text shown when a choice is selected)
              </label>
              {q.followUp && (
                <div className={styles.itemRow}>
                  <label className={styles.miniLabel}>Shows when answer is
                    <select className="input-field" value={q.followUp.trigger} onChange={e => patchQ(i, { followUp: { ...q.followUp, trigger: e.target.value } })}>
                      {(q.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label className={styles.miniLabel}>Prompt
                    <input className="input-field" value={q.followUp.prompt} onChange={e => patchQ(i, { followUp: { ...q.followUp, prompt: e.target.value } })} />
                  </label>
                </div>
              )}
            </>
          )}

          {q.type === 'rating_group' && (
            <div className={styles.ratingItems}>
              <p className={styles.builderHint}>Each criterion is rated on its own 1–5 box scale. Description and anchor labels are optional.</p>
              {(q.items || []).map((it, ii) => {
                const patchItem = patch => patchQ(i, { items: replaceAt(q.items, ii, { ...it, ...patch }) })
                return (
                  <div key={it.id} className={styles.ratingItemCard}>
                    <div className={styles.itemTop}>
                      <input
                        className={`input-field ${styles.grow}`}
                        value={it.label}
                        placeholder={`Criterion ${ii + 1} name (e.g. Novelty)`}
                        onChange={e => patchItem({ label: e.target.value })}
                      />
                      <button type="button" className={styles.removeBtn} title="Remove criterion" onClick={() => patchQ(i, { items: removeAt(q.items, ii) })}>✕</button>
                    </div>
                    <input
                      className={`input-field ${styles.full}`}
                      value={it.description || ''}
                      placeholder="Subheading / description (optional — shown in italics after the name)"
                      onChange={e => patchItem({ description: e.target.value })}
                    />
                    <div className={styles.itemRow}>
                      <label className={styles.miniLabel}>Low label (1)
                        <input className="input-field" value={it.lowLabel || ''} placeholder="optional" onChange={e => patchItem({ lowLabel: e.target.value })} />
                      </label>
                      <label className={styles.miniLabel}>High label (5)
                        <input className="input-field" value={it.highLabel || ''} placeholder="optional" onChange={e => patchItem({ highLabel: e.target.value })} />
                      </label>
                    </div>
                  </div>
                )
              })}
              <button type="button" className={styles.addMini} onClick={() => patchQ(i, { items: [...(q.items || []), { id: newId('item'), label: '', description: '', lowLabel: '', highLabel: '' }] })}>+ Add criterion</button>
            </div>
          )}
        </div>
      ))}

      <button type="button" className={styles.addBtn} onClick={addQuestion}>+ Add survey question</button>
    </div>
  )
}
