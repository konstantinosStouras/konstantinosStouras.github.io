/**
 * translation.js
 *
 * Data Analytics Step 1b, "Translate everything to English" (owner, 2026-09-23):
 * "add a first step in the data analysis process that would be translating all text
 * supplied to our app in English using Fable 5.1 and Anthropic's API … Everything that
 * is not in English should be translated in English and then show me updated file with
 * all data collected in English."
 *
 * Why it comes first: every Section 3 measure reads an idea's words. The 3.1
 * empirical KPIs compare them with an ENGLISH list of existing products and needs and
 * with the other ideas, and the 3.2 AI rater is prompted in English — so an idea in
 * Chinese was measured on its language, not its content. And the aggregate workbook
 * (Step 2) is the study's record: chats and survey answers in another language are
 * unreadable to anyone analysing it in English.
 *
 * The shape:
 *   1. `detectLanguage` decides, LOCALLY and for free, which texts are not English:
 *      letters of a non-Latin script (Chinese, Japanese, Korean, Greek, Cyrillic,
 *      Persian/Arabic, …), or Latin-script text whose function words are clearly
 *      another language's.
 *   2. `collectTexts` gathers every such text the page holds — each idea's title and
 *      description, and every text cell of every sheet the aggregate would contain
 *      (survey answers, group chat, AI chat, imported workbooks) — skipping identity
 *      columns (a name is never "translated").
 *   3. Only those texts go to Claude Fable 5.1 (`TRANSLATION_MODEL`, Anthropic's API,
 *      the Claude key in AI Settings) through `runTranslation` — batched, partial
 *      results kept, a breaker for a dead provider, a rejected key fatal.
 *   4. The results live in ONE translation memory (`tm`: original text → { en, lang,
 *      by }), saved in the browser and written as a "Translations" sheet into every
 *      download, from which an import restores it — so nothing is paid for twice.
 *   5. `applyTranslationMemory` gives each idea row its English version (`title_en`,
 *      `description_en`, `text_en`, `translated_from`, `translated_by`) without ever
 *      overwriting the original; `measureText` is what every measure reads, and
 *      `untranslatedRows` is the gate Step 3 checks. `translateSheets` writes the
 *      English into every sheet of the aggregate, logging each replaced cell.
 *
 * Pure (no Firebase, no fetch of its own) so tools/translate-guard.mjs can drive it
 * offline.
 */
import { withRetry, extractScoreObjects } from './scoreBatch.js'
import { scorableText } from './scoreGaps.js'

/** The model Step 1b translates with (owner: "Fable 5.1 and Anthropic's API"). */
export const TRANSLATION_PROVIDER = 'claude'
export const TRANSLATION_MODEL = 'claude-fable-5-1'
/**
 * The output ceiling for a translation call (thinking counts toward it). The 8000
 * that rating uses is too low here: a batch is up to ~2500 characters, but ONE long
 * AI reply travels alone and its English can run past 8000 tokens with thinking.
 */
export const TRANSLATION_MAX_TOKENS = 16000

// ── Detection ────────────────────────────────────────────────────────────────


// The detector, stress-tested on 341 + 103 held-out English ideas, 167 non-English
// ideas in 30 groups, the owner's 741 ideas, 90k Lit titles/abstracts and 248k FT50
// titles (review of 2026-09-24): no false alarms on the English sets or the owner's
// data, recall on the non-English set 69%. What it does, in order:
//  1. NFC-normalise (NFD text from macOS/Excel otherwise matches nothing accented).
//  2. Non-Latin script: two or more letters of a dense script (Chinese, Japanese,
//     Korean), or of an alphabetic one (Greek, Cyrillic, Arabic, …) making up at
//     least 10% of the letters — where a LONE alphabetic letter (ΔT, α/β) is a
//     symbol and does not count.
//  3. Letters no English loanword carries (Vietnamese, Turkish, pinyin tone marks)
//     spread over at least 35% of the words, so a name like Nguyễn inside an
//     English idea never trips it.
//  4. Latin-script function words: another language's must reach 3 votes and more
//     than 1.5× the English ones. Hyphenated compounds are one token (non-toxic),
//     "et al." and "est." do not vote, a Capitalised word votes once (Le Mans x La
//     Liga), and words that are also ordinary English (per, non, door, pour, …)
//     vote at most once per text. Every listed word was measured at about one per
//     million or less in 7.2M tokens of English.
// Its known limit: a one-to-three-word title in a Latin-script language ("Gants
// intelligents") has no function word to count, so it passes as English — the
// Step 1b copy says so, and the review table lets the admin act on it.
const LETTER = /\p{L}/u
const LATIN = /\p{Script=Latin}/u
const NEUTRAL = /[\p{Script=Common}\p{Script=Inherited}]/u
const SCRIPT_LANG = [
  ['Hangul', 'Korean'], ['Hiragana', 'Japanese'], ['Katakana', 'Japanese'], ['Han', 'Chinese'],
  ['Greek', 'Greek'], ['Cyrillic', 'Russian or another Cyrillic-script language'],
  ['Arabic', 'Persian or Arabic'], ['Hebrew', 'Hebrew'], ['Devanagari', 'Hindi'],
  ['Bengali', 'Bengali'], ['Tamil', 'Tamil'], ['Thai', 'Thai'], ['Armenian', 'Armenian'],
  ['Georgian', 'Georgian'],
].map(([script, lang]) => [new RegExp(`\\p{Script=${script}}`, 'u'), lang])
const DENSE = new Set(['Chinese', 'Japanese', 'Korean'])

const OTHER_LATIN = {
  French: 'le la les des une est et pour avec dans qui que sur pas du au aux ce cette sont peut leur elle ils nous vous mais très quand aussi être fait selon chaque avoir' +
    ' qu lors chez leurs lui où elles cet peu moins bien comme depuis lorsque après contre vers votre devient permet peuvent donc',
  Spanish: 'el los las del una uno es y que para con por se su sus como está pero más cuando también muy puede este esta cada entre ser hace sobre' +
    ' qué cuál donde hasta desde porque la si',
  German: 'der das und ist mit für ein eine nicht auf dem den sich wenn oder sie werden kann einen einem wird sind durch bei nach wie zum zur auch dass' +
    ' zu sehr ich wir sein ihre kein keine noch schon unter zwischen welche welcher welches diese dieser dieses zeigt',
  Italian: 'il lo gli della delle di che per con una uno sono è questo questa quando anche più non nel nella ogni essere può come' +
    ' alla degli molto perché senza sul mostra la si le',
  Portuguese: 'os uma um é não com para que do da dos das em se mais quando também pode este esta cada ser muito pelo pela como' +
    ' ao às sua quais fica muda',
  Dutch: 'het een en van dat niet met voor zijn te maar wordt deze ook bij naar kan worden als door' +
    ' hij wij hun wat wanneer zodat welke zien laat',
  'Indonesian or Malay': 'yang dan di untuk dengan ini itu dari pada akan bisa dapat tidak ke saat ketika oleh juga lebih atau' +
    ' jika menjadi sehingga boleh apabila jadi kita saya bertukar berubah bila supaya karena kerana sudah belum sangat semua',
  Turkish: 'için bir çok daha olan gibi veya olarak kadar sonra olur değil ise eder hangi böylece hemen',
  Tagalog: 'ang mga kapag kung nila niya siya nang yung rin naman kanyang kanilang ng sa na',
  Polish: 'się że jest nie jak przez dla która które który więc oraz jego jej tylko bardzo może być aby lub czy',
  Swedish: 'och det är på för när så inte har blir eller också vilka',
  Vietnamese: 'khi của và là có được những người một trong với để các này duoc nhung nguoi khong',
  'Persian (Finglish)': 'baraye mishe mikone mide vaghti chon inke mitoone mishavad mikonad hast khodesh hamin yek ke',
  'Hindi (romanized)': 'liye jata deta aur nahi karta karti wala wali jab bhi hota hoti ke hai',
  'Greek (Greeklish)': 'pou otan einai exei oti alla enas stin giati gia',
}
const OTHER_LATIN_SETS = Object.fromEntries(
  Object.entries(OTHER_LATIN).map(([lang, words]) => [lang, new Set(words.split(/\s+/))]))
// Also everyday English: each may vote only once per text.
const WEAK = new Set('per non come con van door met do com pour'.split(' '))

const ENGLISH = new Set(('the and of to in for with that this it is are be can when its their your you they ' +
  'which from by as on at or an will has have would could should into about more than so if not but ' +
  'also each other when while where who what how there these those our we my his her them been being').split(' '))

const WORD = /\p{L}+(?:-\p{L}+)*/gu
const VIET = /[ăĂơƠưƯđĐẠ-ỹ]/u
const TURK = /[ğĞıİşŞ]/u
const PINYIN_CARON = /[ǎěǐǒǔǚǜǍĚǏǑǓǙǛ]/u
const PINYIN_TONE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/u

export function detectLanguage(text) {
  const s = String(text ?? '').normalize('NFC')
  let latin = 0
  const other = new Map()
  const chars = [...s]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (!LETTER.test(ch)) continue
    if (LATIN.test(ch)) { latin++; continue }
    if (NEUTRAL.test(ch)) continue
    const hit = SCRIPT_LANG.find(([re]) => re.test(ch))
    const lang = hit ? hit[1] : 'another language'
    if (!DENSE.has(lang)) {
      const same = c => c && LETTER.test(c) && !LATIN.test(c) && (hit ? hit[0].test(c) : !NEUTRAL.test(c))
      if (!same(chars[i - 1]) && !same(chars[i + 1])) continue       // ΔT, α-, β: a symbol
    }
    other.set(lang, (other.get(lang) || 0) + 1)
  }
  let otherTotal = 0
  for (const n of other.values()) otherTotal += n
  if (otherTotal >= 2) {
    const lang = other.has('Japanese') ? 'Japanese'
      : [...other.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const dense = [...other.keys()].some(l => DENSE.has(l))
    if (dense || otherTotal / (otherTotal + latin) >= 0.1) {
      return { english: false, lang, reason: `${otherTotal} letter${otherTotal === 1 ? '' : 's'} in ${lang} script` }
    }
  }

  // Letters that no English loanword carries, spread over most of the words.
  const ws = s.match(/\p{L}+/gu) || []
  const spread = re => ws.filter(w => re.test(w)).length / Math.max(1, ws.length)
  const count = re => [...s].filter(c => re.test(c)).length
  if (count(VIET) >= 2 && spread(VIET) >= 0.35) return { english: false, lang: 'Vietnamese', reason: `${count(VIET)} Vietnamese letters` }
  if (count(TURK) >= 2 && spread(TURK) >= 0.35) return { english: false, lang: 'Turkish', reason: `${count(TURK)} Turkish letters` }
  if (count(PINYIN_CARON) >= 1 && spread(PINYIN_TONE) >= 0.35) return { english: false, lang: 'Chinese (pinyin)', reason: 'pinyin tone marks' }

  const ms = [...s.matchAll(WORD)]
  let en = 0
  const voters = []
  const seenCap = new Set()
  ms.forEach((m, k) => {
    const w = m[0], lower = w.toLowerCase()
    if (ENGLISH.has(lower)) en++
    if (lower === 'et' && ms[k + 1] && ms[k + 1][0].toLowerCase() === 'al') return   // et al.
    if (lower === 'est' && s[m.index + w.length] === '.') return                      // est.
    if (w !== lower) { if (seenCap.has(lower)) return; seenCap.add(lower) }          // names
    voters.push(lower)
  })
  let best = null, bestHits = 0
  for (const [lang, set] of Object.entries(OTHER_LATIN_SETS)) {
    let h = 0
    const seenWeak = new Set()
    for (const w of voters) {
      if (!set.has(w)) continue
      if (WEAK.has(w)) { if (seenWeak.has(w)) continue; seenWeak.add(w) }
      h++
    }
    if (h > bestHits) { best = lang; bestHits = h }
  }
  if (best && bestHits >= 3 && bestHits > 1.5 * en) {
    return { english: false, lang: best, reason: `${bestHits} ${best} function words against ${en} English` }
  }
  return { english: true, lang: 'English', reason: '' }
}

// ── Ideas: what the measures read ────────────────────────────────────────────

/** The idea's own (original-language) text, as the measures used to read it. */
export function originalText(r) {
  return scorableText(r) || ''
}

/** True when the row carries an English version. */
export function hasEnglishVersion(r) {
  return !!String(r?.text_en ?? '').trim()
}

/**
 * The text every Section 3 measure reads: the English version when there is one,
 * else the idea's own text (exactly `scorableText`).
 */
export function measureText(r) {
  return hasEnglishVersion(r) ? String(r.text_en).trim() : originalText(r)
}

/** Does this idea still need an English version before it can be measured? */
export function needsTranslation(r) {
  if (hasEnglishVersion(r)) return false
  const t = originalText(r)
  return !!t && !detectLanguage(t).english
}

/** The rows (of those given) that must be translated before a measure may run. */
export function untranslatedRows(rows) {
  return (rows || []).filter(needsTranslation)
}

/**
 * Rows for the analysis — Section 4's table, the analysis CSV and the Step-5
 * regressions, whose word-count control reads `text` — with `text` set to what the
 * measures read (the English version when there is one). Other fields untouched.
 */
export function withMeasuredText(rows) {
  return (rows || []).map(r => (hasEnglishVersion(r) ? { ...r, text: String(r.text_en).trim() } : r))
}

/** "3 ideas (Chinese 2, French 1)" — for the page's messages. */
export function languageSummary(rows) {
  const by = new Map()
  for (const r of rows || []) {
    const l = detectLanguage(originalText(r)).lang
    by.set(l, (by.get(l) || 0) + 1)
  }
  const n = (rows || []).length
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([l, k]) => `${l} ${k}`)
  return `${n} idea${n === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}`
}

/** "Title: Description", the page's own way of joining an idea's two fields. */
export function joinIdea(title, description) {
  const t = String(title ?? '').trim(), d = String(description ?? '').trim()
  return t && d ? `${t}: ${d}` : (t || d)
}

/** The parts of an idea that are translated separately: title + description, else its text. */
export function ideaParts(r) {
  const title = String(r?.idea_title ?? r?.title ?? '').trim()
  const description = String(r?.idea_description ?? r?.description ?? '').trim()
  if (title || description) return { title, description, text: '' }
  return { title: '', description: '', text: originalText(r) }
}

// ── The translation memory ───────────────────────────────────────────────────
// A plain object: original text (exactly as supplied, trimmed) → { en, lang, by }.

const key = t => String(t ?? '').trim()

/** The memory's entry for a text, or null. */
export function tmGet(tm, text) {
  const k = key(text)
  return k && tm && Object.prototype.hasOwnProperty.call(tm, k) ? tm[k] : null
}

/**
 * The memory's entry for a text, also resolving an idea's joined "Title: Description"
 * (the Ideas sheet's Full Text, a session row's text) when its two parts are each
 * in the memory — the parts are what gets translated, the join is not a new text.
 */
export function tmLookup(tm, text) {
  const direct = tmGet(tm, text)
  if (direct) return direct
  const s = key(text)
  for (let i = s.indexOf(': '); i > 0; i = s.indexOf(': ', i + 1)) {
    const a = tmGet(tm, s.slice(0, i)), b = tmGet(tm, s.slice(i + 2))
    if (a && b) return { en: `${a.en}: ${b.en}`, lang: a.lang, by: a.by }
  }
  return null
}

/** A new memory with one entry set (en '' removes it). */
export function tmSet(tm, text, entry) {
  const k = key(text)
  const next = { ...(tm || {}) }
  if (!k) return next
  if (!entry || !String(entry.en ?? '').trim()) delete next[k]
  else next[k] = { en: String(entry.en).trim(), lang: String(entry.lang || '').trim() || 'unknown', by: String(entry.by || '').trim() }
  return next
}

/** Merge `extra` into `tm`, FILL-EMPTY: an entry already in `tm` is never replaced. */
export function tmMerge(tm, extra) {
  const next = { ...(tm || {}) }
  let added = 0
  for (const [k, v] of Object.entries(extra || {})) {
    const kk = key(k)
    if (!kk || next[kk] || !v || !String(v.en ?? '').trim()) continue
    next[kk] = { en: String(v.en).trim(), lang: String(v.lang || '').trim() || 'unknown', by: String(v.by || '').trim() || 'file' }
    added++
  }
  return { tm: next, added }
}

/** Serialise / parse the memory for localStorage. Never throws on bad input. */
export function tmToJson(tm) { return JSON.stringify({ v: 1, entries: tm || {} }) }
export function tmFromJson(s) {
  try {
    const o = JSON.parse(s)
    return o && o.entries && typeof o.entries === 'object' ? tmMerge({}, o.entries).tm : {}
  } catch { return {} }
}

/**
 * Give each idea row its English version from the memory. Only a row whose text is
 * not English is touched, and only when EVERY non-empty part of it (title,
 * description, or its text) has an entry — a half-translated idea is not measured
 * as if it were finished. A row that already carries an English version (from an
 * uploaded file) and has no memory entries keeps it. The original fields are never
 * changed. Returns a new array; rows that do not change are returned as they are.
 */
export function applyTranslationMemory(rows, tm) {
  return (rows || []).map(r => {
    const orig = originalText(r)
    if (!orig || detectLanguage(orig).english) return r
    const p = ideaParts(r)
    const parts = [p.title, p.description, p.text]
    const entries = parts.map(t => (t ? tmGet(tm, t) : null))
    if (parts.some((t, i) => t && !entries[i])) return r
    const first = entries.find(Boolean)
    if (!first) return r
    const title_en = p.title ? entries[0].en : ''
    const description_en = p.description ? entries[1].en : ''
    const text_en = p.text ? entries[2].en : joinIdea(title_en, description_en)
    if (r.text_en === text_en && r.title_en === title_en && r.description_en === description_en) return r
    return { ...r, title_en, description_en, text_en, translated_from: first.lang, translated_by: first.by }
  })
}

// ── Collecting every text that needs translating ─────────────────────────────

/**
 * Columns never translated: identities and codes. A participant's name written in
 * Chinese characters is their name, not text to translate; IDs, e-mails, labels and
 * codes are not language at all.
 */
export const SKIP_COLUMN = /(^|\b|_)(name|names|e-?mail|emails?|id|ids|uid|uids|label|labels|code|codes|model|models)($|\b|_)|\(ids?\)|\(labels?\)/i

/** Every string cell of a sheet as { row (1-based, as in Excel with its header), column, text }. */
export function sheetTextCells(sheet) {
  const out = []
  if (!sheet) return out
  if (sheet.kind === 'aoa') {
    ;(sheet.aoa || []).forEach((line, ri) => (line || []).forEach((v, ci) => {
      if (typeof v === 'string' && v.trim()) out.push({ row: ri + 1, column: String(ci + 1), text: v })
    }))
    return out
  }
  ;(sheet.rows || []).forEach((obj, ri) => {
    for (const [col, v] of Object.entries(obj || {})) {
      if (typeof v === 'string' && v.trim() && !SKIP_COLUMN.test(col)) out.push({ row: ri + 2, column: col, text: v })
    }
  })
  return out
}

/**
 * Everything the page holds that is not in English, deduplicated by text.
 * @param rows    the idea rows (each flagged idea sends ALL its parts, so a short
 *                French title is translated with its description even though a
 *                title alone would not be detected)
 * @param sheets  every sheet of the loaded sources ([{ name, kind, rows|aoa }])
 * @returns { items: [{ text, lang, where: { <sheet>: count } }], bySheet, byLanguage }
 */
export function collectTexts({ rows = [], sheets = [], tm = {} } = {}) {
  const found = new Map()
  // A joined "Title: Description" whose parts are already found (or translated) is
  // not a new text: tmLookup resolves it from its parts.
  const known = t => found.has(key(t)) || !!tmGet(tm, t)
  const isComposite = t => {
    const s = key(t)
    for (let i = s.indexOf(': '); i > 0; i = s.indexOf(': ', i + 1)) {
      if (known(s.slice(0, i)) && known(s.slice(i + 2))) return true
    }
    return false
  }
  const add = (text, lang, where) => {
    const k = key(text)
    if (!k) return
    const e = found.get(k) || { text: k, lang, where: {} }
    e.where[where] = (e.where[where] || 0) + 1
    found.set(k, e)
  }
  for (const r of rows) {
    const orig = originalText(r)
    if (!orig) continue
    const d = detectLanguage(orig)
    if (d.english) continue
    const p = ideaParts(r)
    for (const t of [p.title, p.description, p.text]) if (t) add(t, d.lang, 'Ideas (loaded)')
  }
  for (const s of sheets) {
    for (const c of sheetTextCells(s)) {
      const d = detectLanguage(c.text)
      if (d.english) continue
      if (!found.has(key(c.text)) && isComposite(c.text)) continue
      add(c.text, d.lang, s.name)
    }
  }
  const items = [...found.values()]
  const bySheet = {}, byLanguage = {}
  for (const it of items) {
    byLanguage[it.lang] = (byLanguage[it.lang] || 0) + 1
    for (const w of Object.keys(it.where)) bySheet[w] = (bySheet[w] || 0) + 1
  }
  return { items, bySheet, byLanguage }
}

/**
 * Write the memory's English into every translatable cell of every sheet. Returns
 * new sheets (the originals are not mutated) and a log of every replaced cell, which
 * becomes the "Translations" sheet so the original is never lost. A text marked
 * "It is English" (kept as written) is logged too, with its cell unchanged: the
 * decision must reach a fresh browser through an import, or the idea is flagged
 * and locked again there.
 */
export function translateSheets(sheets, tm) {
  const log = []
  const out = (sheets || []).map(s => {
    if (!s) return s
    if (s.kind === 'aoa') {
      const aoa = (s.aoa || []).map((line, ri) => (line || []).map((v, ci) => {
        const e = typeof v === 'string' ? tmLookup(tm, v) : null
        if (!e) return v
        log.push({ sheet: s.name, row: ri + 1, column: String(ci + 1), lang: e.lang, original: v, english: e.en, by: e.by })
        return e.en
      }))
      return { ...s, aoa }
    }
    const rows = (s.rows || []).map((obj, ri) => {
      let changed = null
      for (const [col, v] of Object.entries(obj || {})) {
        if (typeof v !== 'string' || SKIP_COLUMN.test(col)) continue
        const e = tmLookup(tm, v)
        if (!e) continue
        if (!changed) changed = { ...obj }
        changed[col] = e.en
        log.push({ sheet: s.name, row: ri + 2, column: col, lang: e.lang, original: v, english: e.en, by: e.by })
      }
      return changed || obj
    })
    return { ...s, rows }
  })
  return { sheets: out, log }
}

/** The "Translations" sheet: one row per replaced cell (or, with no log, per memory entry). */
export const TRANSLATIONS_SHEET = 'Translations'
export function translationsSheet(log, tm) {
  const rows = log && log.length
    ? log.map(l => ({
      Sheet: l.sheet, Row: l.row, Column: l.column, 'Translated from': l.lang,
      Original: l.original, English: l.english, 'Translated by': l.by,
    }))
    : Object.entries(tm || {}).map(([orig, e]) => ({
      Sheet: '', Row: '', Column: '', 'Translated from': e.lang, Original: orig, English: e.en, 'Translated by': e.by,
    }))
  return { name: TRANSLATIONS_SHEET, kind: 'json', rows }
}

/**
 * The "Translations" sheet for a workbook built from `sources` (sheets), or null when
 * there is nothing to log: this run's replaced cells PLUS the rows of any Translations
 * sheet a loaded source already carried. A re-imported English workbook has English
 * in its cells already, so this run replaces nothing there; without carrying its log
 * forward, a second download would lose the originals. `keep(row)` limits which
 * carried rows belong in this workbook (the ideas file keeps only the idea sheets').
 */
export function carryTranslationsSheet(log, sources, keep = () => true) {
  const rows = log && log.length ? translationsSheet(log).rows : []
  // A carried row is a duplicate when this run logged the same original in the same
  // sheet and column (its row number in an older file may no longer be right).
  const seen = new Set(rows.map(r => [r.Sheet, r.Column, r.Original].join('\u0001')))
  for (const s of sources || []) {
    if (!s || s.name !== TRANSLATIONS_SHEET) continue
    for (const r of s.rows || []) {
      if (!key(r?.Original) || !key(r?.English) || !keep(r)) continue
      const k = [r.Sheet, r.Column, r.Original].join('\u0001')
      if (seen.has(k)) continue
      seen.add(k)
      rows.push({
        Sheet: r.Sheet ?? '', Row: r.Row ?? '', Column: r.Column ?? '', 'Translated from': r['Translated from'] ?? '',
        Original: r.Original, English: r.English, 'Translated by': r['Translated by'] ?? '',
      })
    }
  }
  return rows.length ? { name: TRANSLATIONS_SHEET, kind: 'json', rows } : null
}

/** Read a "Translations" sheet (json rows) back into a memory. */
export function tmFromTranslationsRows(rows) {
  const tm = {}
  for (const r of rows || []) {
    const lower = Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [String(k).toLowerCase().trim(), v]))
    const orig = key(lower.original)
    const en = key(lower.english)
    if (!orig || !en || tm[orig]) continue
    tm[orig] = { en, lang: key(lower['translated from']) || 'unknown', by: key(lower['translated by']) || 'file' }
  }
  return tm
}

// ── Translating with Claude ──────────────────────────────────────────────────

export const TRANSLATOR_SYSTEM_PROMPT = `You translate text written in a product-design brainstorming study into English, so the
study can be analysed in English. The texts are participants' product ideas (titles and
descriptions), their group-chat messages, their survey answers, their prompts to an AI
assistant, and that assistant's replies.

Translate faithfully. Keep the meaning, the level of detail, the tone and the informality.
Do not summarise, shorten, improve, correct, explain or add anything. Keep the structure:
markdown (**bold**, headings, lists), line breaks, numbering and emojis. Keep names, product
and brand names, numbers and units as they are. If part of a text is already in English,
keep that part exactly as written. When a reply explains words of another language (for
example "**面料 (miàn liào)**"), keep the original word and its romanisation beside the
English, e.g. "**fabric: 面料 (miàn liào)**". If a whole text is already English, return
it unchanged.

Return ONLY valid JSON: an array with one object per text, in the order given, each
{"i": <index>, "lang": "<the text's original language, in English, e.g. Chinese>",
"text": "<the complete English translation>"}. No prose, no markdown fences.`

/** The user message for one batch: each text as a JSON line with its index. */
export function buildTranslatePrompt(items) {
  const lines = items.map((it, i) => JSON.stringify({ i, text: String(it.text ?? '') }))
  return `Translate these ${items.length} text(s) into English. Return a JSON array with one ` +
    `{"i","lang","text"} object per text, indices 0..${items.length - 1}.\n\n` +
    lines.join('\n')
}

/** A usable translation entry: a non-empty string text. */
export function isTranslation(e) {
  return !!(e && typeof e === 'object' && typeof e.text === 'string' && e.text.trim())
}

/**
 * Is `out` really an English version of `src`? A reply is not trusted just for
 * being non-empty (review of 2026-09-24): an echo of the source, or a reply still
 * in the source's language, would otherwise unlock the measures on text that is
 * not English. Accepted: text the detector reads as English, or text that is
 * mostly Latin letters with a few quoted foreign words (a reply explaining Chinese
 * terms keeps them, by the prompt's own rule). Rejected: the source itself (unless
 * the source is English already), and text still in another Latin-script language
 * or mostly in another script.
 */
export function looksTranslated(src, out) {
  const o = key(out)
  if (!o) return false
  // An echo is refused unless the source reads as English already: a flagged idea
  // sends ALL its parts, so an English title ("ThermoShirt") beside a Chinese
  // description comes back unchanged, and refusing that would leave the idea
  // locked for ever (review of 2026-09-24).
  if (o === key(src)) return detectLanguage(o).english
  const d = detectLanguage(o)
  if (d.english) return true
  const letters = [...o.normalize('NFC')].filter(c => /\p{L}/u.test(c))
  const latin = letters.filter(c => /\p{Script=Latin}/u.test(c)).length
  const byScript = letters.length > 0 && letters.some(c => !/[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(c))
  return byScript && latin / letters.length >= 0.7
}

/**
 * Map a batch's parsed objects onto `count` slots by their echoed index `"i"` —
 * STRICTLY, unlike scoreBatch's assignScores: a rating in the wrong slot is one
 * wrong number, a translation in the wrong slot puts another text's words in its
 * place. So an out-of-range, missing or duplicate index leaves that slot empty (it
 * is retried on its own), with two exceptions that cannot misplace anything: a
 * reply numbered 1..count instead of 0..count-1 is shifted back as a whole, and a
 * one-text call takes its one object whatever index it carries. An incomplete
 * reply with no index 0 is ambiguous (see below) and fills nothing.
 */
export function assignByIndex(parsed, count) {
  const out = new Array(count).fill(null)
  const objs = (parsed || []).filter(o => o && typeof o === 'object')
  if (count === 1 && objs.length === 1) { out[0] = objs[0]; return out }
  const idx = objs.map(o => Number(o.i))
  const oneBased = count > 0 && idx.length === count && !idx.includes(0)
    && [...new Set(idx)].length === count && idx.every(n => Number.isInteger(n) && n >= 1 && n <= count)
  // An INCOMPLETE reply with no index 0 cannot be read safely: numbered from 0 with
  // the first text left out, or from 1 with a later one left out, the same objects
  // land in different slots. Trust none of them; each text is asked again alone.
  if (!oneBased && count > 1 && objs.length && !idx.includes(0)) return out
  const seen = new Set()
  objs.forEach((o, k) => {
    const n = oneBased ? idx[k] - 1 : idx[k]
    if (!Number.isInteger(n) || n < 0 || n >= count) return
    if (seen.has(n)) { out[n] = null; return }      // a duplicate index: trust neither
    seen.add(n)
    out[n] = o
  })
  return out
}

/**
 * Split items into batches of at most `maxItems` texts and about `maxChars`
 * characters (a long AI reply travels alone), keeping the order.
 */
export function makeBatches(items, { maxItems = 10, maxChars = 2500 } = {}) {
  const batches = []
  let cur = [], chars = 0
  items.forEach((it, i) => {
    const n = String(it.text ?? '').length
    if (cur.length && (cur.length >= maxItems || chars + n > maxChars)) { batches.push(cur); cur = []; chars = 0 }
    cur.push(i); chars += n
  })
  if (cur.length) batches.push(cur)
  return batches
}

/**
 * Translate every item, losing nothing it can avoid losing — the same shape as
 * scoreBatch's runScoring: a batch that fails keeps the run going; anything a batch
 * reply left out gets one call of its own; a provider that keeps failing trips a
 * breaker (`aborted`); a fatal error (no key, a rejected key) throws.
 *
 * @param items  [{ text }] in the caller's order
 * @param call   async (items) => raw model reply (string)
 * @returns { results, untranslated, failedBatches, aborted, lastError } —
 *          `results` is the same length/order as `items`, each { text, lang } | null
 */
export async function runTranslation({
  items, call, maxItems = 10, maxChars = 2500, onProgress, sleep, isFatal,
  retryAttempts = 3, maxConsecutiveFailures = 3, singleTries = 2,
}) {
  const results = new Array(items.length).fill(null)
  let done = 0, failedBatches = 0, consecutive = 0, aborted = false, lastError = null, rejected = 0
  const attempt = fn => withRetry(fn, { attempts: retryAttempts, sleep, isFatal })
  const take = (raw, idx) => {
    assignByIndex(extractScoreObjects(raw), idx.length).forEach((e, k) => {
      if (!isTranslation(e)) return
      const i = idx[k]
      if (!looksTranslated(items[i].text, e.text)) { rejected++; return }
      results[i] = { text: e.text.trim(), lang: typeof e.lang === 'string' ? e.lang.trim() : '' }
    })
  }
  // A fatal error (a rejected key) still hands back what was already translated
  // and paid for: it rides on the error as `partial`.
  const fatal = err => { err.partial = { results: results.slice() }; return err }

  for (const idx of makeBatches(items, { maxItems, maxChars })) {
    let threw = false
    try {
      take(await attempt(() => call(idx.map(i => items[i]))), idx)
      consecutive = 0
    } catch (err) {
      if (isFatal && isFatal(err)) throw fatal(err)
      lastError = err
      if (err?.replyProblem) consecutive = 0
      else {
        failedBatches++
        threw = true
        if (++consecutive >= maxConsecutiveFailures) { aborted = true; break }
      }
    }
    // Whatever the batch reply left out, or answered with something that is not a
    // translation, gets calls of its own (`singleTries`: an unreadable reply is
    // usually a one-off, and the transport retry above never sees it).
    for (const i of threw ? [] : idx) {
      for (let t = 0; t < singleTries && !results[i]; t++) {
        try {
          take(await attempt(() => call([items[i]])), [i])
        } catch (err) {
          if (isFatal && isFatal(err)) throw fatal(err)
          lastError = err
          break
        }
      }
    }
    done += idx.length
    if (onProgress) onProgress({ done, total: items.length })
  }
  const untranslated = results.filter(r => !r).length
  return { results, untranslated, failedBatches, aborted, lastError, rejected }
}

/**
 * Rough cost of translating `items` with a model priced `price` = { in, out } USD
 * per 1M tokens: a character of Chinese/Japanese/Korean is about one token, other
 * text about four characters a token, English comes back about 1.3× the source
 * tokens, plus the instructions once per batch and some room for the model's
 * thinking. An ESTIMATE for the button, never a bill.
 */
export function estimateTranslationCost(items, price, opts = {}) {
  if (!price) return null
  let inTok = 0
  for (const it of items || []) {
    const s = String(it.text ?? '')
    let dense = 0
    for (const ch of s) if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch)) dense++
    inTok += dense + (s.length - dense) / 4
  }
  const batches = makeBatches(items || [], opts).length
  const promptTok = batches * 450
  const outTok = inTok * 1.3 * 1.5            // translation + thinking headroom
  const usd = ((inTok + promptTok) * price.in + outTok * price.out) / 1e6
  return { usd, inTok: Math.round(inTok + promptTok), outTok: Math.round(outTok) }
}
