// translate-guard.mjs — offline checks for Data Analytics Step 1b, "Translate
// everything to English" (src/utils/translation.js). No network.
//
//   node _ideasearchlab-src/tools/translate-guard.mjs
//
// Owner, 2026-09-23: "add a first step in the data analysis process that would be
// translating all text supplied to our app in English using Fable 5.1 and Anthropic's
// API … Everything that is not in English should be translated in English and then
// show me updated file with all data collected in English."
//
// Pins: which texts the local check flags (and, as importantly, which terse English
// ideas it does NOT flag); the translation memory and how it reaches the idea rows;
// which cells of which sheets are collected and rewritten (names and IDs never);
// that the originals survive the download → import round trip; that a run against
// a fake Claude loses nothing it can avoid losing and never files one text's words
// under another; and that the page wires all of it (Step 1b before Step 2, the
// 3.1/3.2 gates, every measure reading measureText, Fable 5.1 as the model).

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  detectLanguage, measureText, needsTranslation, untranslatedRows, hasEnglishVersion, languageSummary,
  originalText, withMeasuredText, joinIdea, ideaParts,
  tmGet, tmLookup, tmSet, tmMerge, tmToJson, tmFromJson, applyTranslationMemory,
  SKIP_COLUMN, sheetTextCells, collectTexts, translateSheets, translationsSheet, tmFromTranslationsRows,
  carryTranslationsSheet, TRANSLATIONS_SHEET,
  TRANSLATOR_SYSTEM_PROMPT, buildTranslatePrompt, isTranslation, looksTranslated, assignByIndex,
  makeBatches, runTranslation, estimateTranslationCost, TRANSLATION_PROVIDER, TRANSLATION_MODEL, TRANSLATION_MAX_TOKENS,
} from '../src/utils/translation.js'
import { objectiveKpisFromText } from '../src/utils/objectiveKpis.js'
import { scorableText } from '../src/utils/scoreGaps.js'
import { MODEL_PRICES } from '../src/data/aiPricing.js'
import { buildClaudeRequest, SCORING_MAX_TOKENS } from '../src/utils/providerRequest.js'

const HERE = dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const head = s => console.log(`\n--- ${s} ---`)
const noSleep = () => Promise.resolve()

// ── Detection ────────────────────────────────────────────────────────────────
head('detection: English stays English (a false alarm locks Step 3 for nothing)')
const ENGLISH = [
  'Survival tent cloth: uses smart materials for disaster rescue.',
  'body heat show exact level different temperature give different colour',
  'Museum story gloves: screen-free interactive learning',
  'Smart bandana: pretty patterns show when temp goes over limit.',
  'Colour Changing Laptop Case: tracks laptop temperature, turns red at 40º',
  'ΔT sensing sleeve for α-athletes, 5 µm fibres',
  'α/β testing wristbands',
  'Fever alert pillowcase (cf. et al. 2024): turns pink at 37°C',
  'Non-woven, non-slip, non-toxic',
  'Price: £5 per shirt, sold in packs of three',
  'Est. price €12, café and résumé friendly',
  'Hypercolor tee',
  'Thermochromic socks',
  '',
]
for (const t of ENGLISH) {
  const d = detectLanguage(t)
  check(`English: ${JSON.stringify(t.slice(0, 50))}`, d.english === true, `${d.lang}: ${d.reason}`)
}

head('detection: other languages are flagged and named')
const OTHER = [
  ['体温变色T恤：一件当你体温升高时会显示隐藏图案的T恤', 'Chinese'],
  ['智能袜子', 'Chinese'],
  ['Tシャツ 体温で色が変わる', 'Japanese'],
  ['체온에 따라 색이 변하는 셔츠', 'Korean'],
  ['Έξυπνο ύφασμα που αλλάζει χρώμα με τη θερμοκρασία', 'Greek'],
  ['Chaussettes thermochromiques : des chaussettes qui changent de couleur quand la température est trop élevée', 'French'],
  ['Camiseta que cambia de color cuando la temperatura del cuerpo es alta y avisa a los padres', 'Spanish'],
]
for (const [t, lang] of OTHER) {
  const d = detectLanguage(t)
  check(`${lang}: ${JSON.stringify(t.slice(0, 40))}`, d.english === false && d.lang === lang, `${d.english} ${d.lang}`)
}
for (const t of [
  'Áo thun đổi màu khi nhiệt độ cơ thể tăng cao',                         // Vietnamese
  'Vücut ısısı yükseldiğinde renk değiştiren tişört',                       // Turkish
  'Kaos yang berubah warna ketika suhu tubuh naik dan ini untuk anak-anak', // Indonesian
  'Футболка меняет цвет при температуре тела',                             // Russian
]) {
  check(`flagged: ${JSON.stringify(t.slice(0, 40))}`, detectLanguage(t).english === false, detectLanguage(t).lang)
}
check('NFD text (macOS/Excel) is read like NFC', detectLanguage('Chaussettes thermochromiques : des chaussettes qui changent de couleur quand la température est trop élevée'.normalize('NFD')).english === false)

// ── Ideas: what the measures read ────────────────────────────────────────────
head('ideas: the measures read the English version; the original stays as written')
const en = { rid: 'a', idea_title: 'Smart socks', idea_description: 'change colour when too warm', text: 'Smart socks: change colour when too warm' }
const zh = { rid: 'b', idea_title: '智能袜子', idea_description: '体温升高时袜子会变色', text: '智能袜子: 体温升高时袜子会变色' }
check('an English idea needs no translation, and measureText is scorableText', needsTranslation(en) === false && measureText(en) === scorableText(en))
check('a Chinese idea needs one', needsTranslation(zh) === true)
check('untranslatedRows picks out only the Chinese idea', untranslatedRows([en, zh]).map(r => r.rid).join() === 'b')
check('languageSummary names the languages', languageSummary([zh, { ...zh, rid: 'c' }]) === '2 ideas (Chinese 2)')
check('joinIdea joins the page\'s way, and copes with a missing part',
  joinIdea('T', 'D') === 'T: D' && joinIdea('T', '') === 'T' && joinIdea('', ' D ') === 'D')
check('ideaParts splits title and description, else the text alone',
  JSON.stringify(ideaParts(zh)) === JSON.stringify({ title: '智能袜子', description: '体温升高时袜子会变色', text: '' })
  && ideaParts({ text: '只有文本' }).text === '只有文本')
check('an English version made only of spaces does not count', hasEnglishVersion({ ...zh, text_en: '   ' }) === false)

// ── The translation memory ───────────────────────────────────────────────────
head('translation memory')
let tm = {}
tm = tmSet(tm, '  智能袜子 ', { en: 'Smart socks', lang: 'Chinese', by: 'Claude Fable 5.1' })
check('tmSet trims the key and tmGet finds it either way', tmGet(tm, '智能袜子')?.en === 'Smart socks' && tmGet(tm, ' 智能袜子')?.en === 'Smart socks')
check('tmSet does not mutate the memory it was given', Object.keys(tmSet(tm, 'x', { en: 'y' })).length === 2 && Object.keys(tm).length === 1)
check('tmSet with null (or an empty English) removes the entry', !tmGet(tmSet(tm, '智能袜子', null), '智能袜子') && !tmGet(tmSet(tm, '智能袜子', { en: ' ' }), '智能袜子'))
tm = tmSet(tm, '体温升高时袜子会变色', { en: 'the socks change colour when body temperature rises', lang: 'Chinese', by: 'Claude Fable 5.1' })
check('tmLookup resolves a joined "Title: Description" from its two parts',
  tmLookup(tm, '智能袜子: 体温升高时袜子会变色')?.en === 'Smart socks: the socks change colour when body temperature rises')
check('…but not when a part is missing', tmLookup(tm, '智能袜子: 未翻译的部分') === null)
{
  const { tm: merged, added } = tmMerge(tm, { '智能袜子': { en: 'OTHER', lang: 'x' }, '新的': { en: 'New', lang: 'Chinese' }, '空': { en: '' } })
  check('tmMerge is fill-empty: an entry already there is never replaced', merged['智能袜子'].en === 'Smart socks' && added === 1 && merged['新的'].by === 'file')
}
check('the memory survives localStorage (tmToJson → tmFromJson)', JSON.stringify(tmFromJson(tmToJson(tm))) === JSON.stringify(tm))
check('a corrupt stored memory reads as empty, it does not throw', JSON.stringify(tmFromJson('{not json')) === '{}' && JSON.stringify(tmFromJson('')) === '{}')

head('applyTranslationMemory: the idea rows get their English version')
{
  const out = applyTranslationMemory([en, zh], tm)
  const z = out[1]
  check('an English row is returned untouched (same object)', out[0] === en)
  check('the Chinese row gets title_en / description_en / text_en', z.title_en === 'Smart socks'
    && z.description_en === 'the socks change colour when body temperature rises'
    && z.text_en === 'Smart socks: the socks change colour when body temperature rises')
  check('…and records where it came from', z.translated_from === 'Chinese' && z.translated_by === 'Claude Fable 5.1')
  check('the original fields are never changed', z.idea_title === '智能袜子' && z.text === zh.text && originalText(z) === scorableText(zh))
  check('measureText now reads the English', measureText(z) === z.text_en && !needsTranslation(z))
  const half = applyTranslationMemory([zh], tmSet({}, '智能袜子', { en: 'Smart socks', lang: 'Chinese' }))[0]
  check('a half-translated idea is left alone (not measured as if finished)', half === zh && needsTranslation(half))
  check('a second pass with the same memory changes nothing (same object)', applyTranslationMemory(out, tm)[1] === z)
  const kept = applyTranslationMemory([{ rid: 'k', text: 'Chaussettes thermochromiques : des chaussettes qui changent de couleur quand la température est trop élevée' }],
    tmSet({}, 'Chaussettes thermochromiques : des chaussettes qui changent de couleur quand la température est trop élevée',
      { en: 'Chaussettes thermochromiques : des chaussettes qui changent de couleur quand la température est trop élevée', lang: 'English (checked by hand)', by: 'kept as written' }))[0]
  check('"It is English" (kept as written) unlocks the idea with its own words', !needsTranslation(kept) && measureText(kept) === kept.text)
  const w = withMeasuredText([en, z])
  check('withMeasuredText sets text to what the measures read, other fields untouched',
    w[0] === en && w[1].text === z.text_en && w[1].idea_title === '智能袜子')
}

head('3.1 measures the English version, not the language')
{
  const REFS = ['Hypercolor T-shirt that changes colour with body heat', 'Colour-changing mood ring', 'Thermochromic baby spoon']
  const pool = [
    { rid: '1', text: 'A shirt that changes colour with body heat for athletes' },
    { rid: '2', text: 'A mug that changes colour when the drink is too hot' },
    { rid: '3', idea_title: '智能袜子', idea_description: '体温升高时袜子会变色', text: '智能袜子: 体温升高时袜子会变色' },
  ]
  const raw = objectiveKpisFromText(pool.map(r => r.text), REFS, { tau: 0.8 })
  check('without an English version the Chinese idea cannot be scored at all', raw.perIdea[2].score === null)
  const withEn = applyTranslationMemory(pool, tm)
  const res = objectiveKpisFromText(withEn.map(measureText), REFS, { tau: 0.8 })
  check('with it, the idea is scored on its English words', typeof res.perIdea[2].score === 'number' && res.perIdea[2].novelty < 1)
}

// ── Sheets ───────────────────────────────────────────────────────────────────
head('sheets: which cells are collected, which never are')
check('SKIP_COLUMN covers names, e-mails, IDs, labels, codes and models',
  ['Name', 'Participant Name', 'Email', 'E-mail', 'Author ID', 'participant_id', 'uid', 'Label', 'Session Code', 'AI Model', 'Group Members (IDs)', 'Author (labels)']
    .every(c => SKIP_COLUMN.test(c)))
check('…but not the text columns', !['Idea Title', 'Idea Description', 'Message', 'Answer', 'Prompt', 'Response', 'Full Text', 'Idea'].some(c => SKIP_COLUMN.test(c)))
const SHEETS = [
  { name: 'Ideas', kind: 'json', rows: [
    { 'Idea ID': 'i1', 'Author Name': '王小明', 'Idea Title': '智能袜子', 'Idea Description': '体温升高时袜子会变色', 'Full Text': '智能袜子: 体温升高时袜子会变色' },
    { 'Idea ID': 'i2', 'Author Name': 'Ann', 'Idea Title': 'Mood mug', 'Idea Description': 'A mug that changes colour', 'Full Text': 'Mood mug: A mug that changes colour' },
  ] },
  { name: 'Group Chat', kind: 'json', rows: [
    { 'Sender Name': '李华', Message: '我觉得这个想法很好，我们应该选择它' },
    { 'Sender Name': 'Ann', Message: 'I like the socks idea' },
  ] },
  { name: 'About', kind: 'aoa', aoa: [['Session', 'SGP1'], ['说明', '这是一个测试会话']] },
]
check('sheetTextCells gives Excel row numbers (header = row 1) and skips name columns',
  JSON.stringify(sheetTextCells(SHEETS[1]).map(c => [c.row, c.column])) === JSON.stringify([[2, 'Message'], [3, 'Message']]))
check('…and reads an array-of-arrays sheet cell by cell', sheetTextCells(SHEETS[2]).length === 4)
const found = collectTexts({ rows: [en, zh], sheets: SHEETS, tm: {} })
const texts = found.items.map(i => i.text)
check('every non-English text is collected once, with where it was found',
  texts.includes('智能袜子') && texts.includes('体温升高时袜子会变色') && texts.includes('我觉得这个想法很好，我们应该选择它')
  && texts.includes('说明') && texts.includes('这是一个测试会话'))
check('names are never collected (a name in Chinese characters is a name)', !texts.includes('王小明') && !texts.includes('李华'))
check('English text is never collected', !texts.some(t => /Mood mug|socks idea|SGP1/.test(t)))
check('a joined "Title: Description" is not sent again (its parts are)', !texts.includes('智能袜子: 体温升高时袜子会变色'))
check('the title is found in both the rows and the Ideas sheet, counted in each',
  found.items.find(i => i.text === '智能袜子').where['Ideas (loaded)'] === 1 && found.items.find(i => i.text === '智能袜子').where.Ideas === 1)
check('byLanguage and bySheet add up', found.byLanguage.Chinese === found.items.length && found.bySheet['Group Chat'] === 1)
check('a short title of a flagged idea goes too, even alone it would not be flagged',
  collectTexts({ rows: [{ idea_title: 'Chic', idea_description: 'Chaussettes thermochromiques : des chaussettes qui changent de couleur quand la température est trop élevée' }] })
    .items.some(i => i.text === 'Chic'))

head('translateSheets: the English goes into every cell, the original onto the log')
{
  let m = tm
  m = tmSet(m, '我觉得这个想法很好，我们应该选择它', { en: 'I think this idea is very good, we should choose it', lang: 'Chinese', by: 'Claude Fable 5.1' })
  m = tmSet(m, '说明', { en: 'Note', lang: 'Chinese', by: 'by hand' })
  const before = JSON.stringify(SHEETS)
  const { sheets, log } = translateSheets(SHEETS, m)
  check('the source sheets are not mutated', JSON.stringify(SHEETS) === before)
  const ideas = sheets[0].rows[0]
  check('title, description and the joined Full Text are all in English',
    ideas['Idea Title'] === 'Smart socks' && ideas['Full Text'] === 'Smart socks: the socks change colour when body temperature rises')
  check('a name column is left exactly as written', ideas['Author Name'] === '王小明' && sheets[1].rows[0]['Sender Name'] === '李华')
  check('the chat message is translated', sheets[1].rows[0].Message === 'I think this idea is very good, we should choose it')
  check('an array-of-arrays cell is translated; one with no entry is kept', sheets[2].aoa[1][0] === 'Note' && sheets[2].aoa[1][1] === '这是一个测试会话')
  check('an untouched row is the same object', sheets[0].rows[1] === SHEETS[0].rows[1])
  check('every replaced cell is logged with sheet, row, column, original and English',
    log.length === 5 && log.some(l => l.sheet === 'Group Chat' && l.row === 2 && l.column === 'Message' && l.original.startsWith('我觉得') && l.by === 'Claude Fable 5.1'))
  const trSheet = translationsSheet(log)
  check('the Translations sheet has one row per replaced cell', trSheet.name === TRANSLATIONS_SHEET && trSheet.rows.length === 5
    && Object.keys(trSheet.rows[0]).join() === 'Sheet,Row,Column,Translated from,Original,English,Translated by')
  const back = tmFromTranslationsRows(trSheet.rows)
  check('importing that sheet gives the memory back (round trip)', back['我觉得这个想法很好，我们应该选择它']?.en === 'I think this idea is very good, we should choose it'
    && back['说明']?.by === 'by hand' && back['智能袜子']?.lang === 'Chinese')
  check('a Translations sheet with other header casing still reads', tmFromTranslationsRows([{ original: 'x', ENGLISH: 'y', 'translated FROM': 'French' }]).x?.lang === 'French')
  check('with no log, translationsSheet falls back to the memory itself', translationsSheet([], m).rows.length === Object.keys(m).length)

  // A re-imported English workbook: its cells are English already, so nothing is
  // replaced — the originals must still reach the next download.
  const reimport = [...sheets, trSheet]
  const again = translateSheets(reimport.filter(s => s.name !== TRANSLATIONS_SHEET), m)
  check('a second translateSheets over English cells replaces nothing', again.log.length === 0)
  const carried = carryTranslationsSheet(again.log, reimport)
  check('carryTranslationsSheet keeps the imported originals for the next download', carried && carried.rows.length === 5)
  check('…without doubling a cell logged twice', carryTranslationsSheet(log, reimport).rows.length === 5)
  check('…and returns null when there is nothing to log', carryTranslationsSheet([], SHEETS) === null)
  check('…and keeps only the rows `keep` accepts (the ideas file: its idea sheets\' rows)',
    carryTranslationsSheet([], reimport, r => /idea|ranking/i.test(String(r.Sheet))).rows.every(r => r.Sheet === 'Ideas')
    && carryTranslationsSheet([], reimport, r => /idea|ranking/i.test(String(r.Sheet))).rows.length === 3)
  const keptText = 'Chaussettes thermochromiques : des chaussettes qui changent de couleur quand la température est trop élevée'
  const kept = translateSheets([{ name: 'Survey', kind: 'json', rows: [{ Answer: keptText }] }],
    tmSet({}, keptText, { en: keptText, lang: 'English (checked by hand)', by: 'kept as written' }))
  check('a text kept as written ("It is English") is not logged as a translation', kept.log.length === 0 && kept.sheets[0].rows[0].Answer === keptText)
  // sessionExport.js imports Firebase, so its merge rule is pinned by source.
  const exp = readFileSync(join(HERE, '../src/utils/sessionExport.js'), 'utf8')
  check('mergeSessionSheets drops a source\'s Translations sheet (it is rebuilt, never duplicated)',
    /sheet\.name === 'Translations'\) continue/.test(exp))
}

// ── Translating with a fake Claude ───────────────────────────────────────────
head('the prompt')
check('the translator is told to be faithful, keep markdown and names, and answer in JSON',
  /faithfully/i.test(TRANSLATOR_SYSTEM_PROMPT) && /markdown/i.test(TRANSLATOR_SYSTEM_PROMPT)
  && /names/i.test(TRANSLATOR_SYSTEM_PROMPT) && /JSON/.test(TRANSLATOR_SYSTEM_PROMPT))
{
  const p = buildTranslatePrompt([{ text: '智能袜子' }, { text: 'a "quoted"\nline' }])
  const lines = p.split('\n').filter(l => l.startsWith('{'))
  check('the batch prompt lists each text as a JSON line with its index',
    lines.length === 2 && JSON.parse(lines[0]).i === 0 && JSON.parse(lines[1]).text === 'a "quoted"\nline')
}
check('the model is Fable 5.1 on the Claude provider, and it has a price',
  TRANSLATION_PROVIDER === 'claude' && TRANSLATION_MODEL === 'claude-fable-5-1' && !!MODEL_PRICES[TRANSLATION_MODEL])

head('what counts as a translation')
check('isTranslation needs a non-empty text string', isTranslation({ i: 0, text: 'x' }) && !isTranslation({ i: 0, text: ' ' }) && !isTranslation({ i: 0 }) && !isTranslation(null))
check('an echo of the source is not a translation', !looksTranslated('智能袜子', '智能袜子'))
check('a reply still in Chinese is not a translation', !looksTranslated('智能袜子', '智能的袜子'))
check('a reply still in French is not a translation',
  !looksTranslated('Chaussettes thermochromiques', 'Les chaussettes qui changent de couleur quand la température du corps est trop élevée'))
check('English is', looksTranslated('智能袜子', 'Smart socks'))
check('English that keeps a few quoted Chinese terms is', looksTranslated('面料是什么意思', 'What does **fabric: 面料 (miàn liào)** mean? It is the cloth a garment is made of, like cotton or wool.'))

head('assignByIndex: strict, so no text gets another text\'s words')
{
  const a = assignByIndex([{ i: 1, text: 'b' }, { i: 0, text: 'a' }], 2)
  check('objects land by their index, not their order', a[0].text === 'a' && a[1].text === 'b')
  const one = assignByIndex([{ i: 1, text: 'a' }, { i: 2, text: 'b' }, { i: 3, text: 'c' }], 3)
  check('a reply numbered 1..n is shifted back as a whole', one.map(o => o.text).join('') === 'abc')
  const dup = assignByIndex([{ i: 0, text: 'a' }, { i: 0, text: 'b' }, { i: 1, text: 'c' }], 2)
  check('a duplicate index voids that slot (trust neither)', dup[0] === null && dup[1].text === 'c')
  const oob = assignByIndex([{ i: 5, text: 'x' }, { i: 0, text: 'a' }], 2)
  check('an out-of-range index is dropped', oob[0].text === 'a' && oob[1] === null)
  check('a one-text call takes its one object whatever its index', assignByIndex([{ i: 7, text: 'x' }], 1)[0].text === 'x')
  check('a partial 1-based reply is NOT shifted (it could misplace)', assignByIndex([{ i: 1, text: 'b' }], 2)[1].text === 'b')
}

head('makeBatches and the cost estimate')
{
  const items = Array.from({ length: 23 }, (_, i) => ({ text: `文本 ${i}` }))
  check('batches of at most 10 texts, in order', JSON.stringify(makeBatches(items).map(b => b.length)) === '[10,10,3]'
    && makeBatches(items).flat().every((v, i) => v === i))
  const long = [{ text: 'x'.repeat(3000) }, { text: 'y' }, { text: 'z' }]
  check('a long text travels alone', JSON.stringify(makeBatches(long)) === '[[0],[1,2]]')
  const est = estimateTranslationCost([{ text: '智能袜子'.repeat(100) }], MODEL_PRICES[TRANSLATION_MODEL])
  check('the estimate is a small positive number of dollars', est && est.usd > 0 && est.usd < 1 && est.inTok > 400)
  check('no price, no estimate', estimateTranslationCost(items, null) === null)
}

// A fake Claude: answers each batch from a dictionary, as the real one is asked to.
const DICT = Object.fromEntries(Array.from({ length: 23 }, (_, i) => [`文本 ${i}`, `Text ${i}`]))
const itemsOf = n => Array.from({ length: n }, (_, i) => ({ text: `文本 ${i}` }))
const reply = (batch, f = (o) => o) =>
  JSON.stringify(batch.map((it, i) => f({ i, lang: 'Chinese', text: DICT[it.text] }, i)).filter(Boolean))

head('runTranslation against a fake Claude')
{
  const calls = []
  const r = await runTranslation({ items: itemsOf(23), sleep: noSleep, call: async b => { calls.push(b.length); return reply(b) } })
  check('every text is translated, in order', r.untranslated === 0 && r.results.every((x, i) => x.text === `Text ${i}` && x.lang === 'Chinese'))
  check('three calls for 23 texts', JSON.stringify(calls) === '[10,10,3]', JSON.stringify(calls))
  const seen = []
  await runTranslation({ items: itemsOf(3), sleep: noSleep, call: async b => reply(b), onProgress: p => seen.push(p.done) })
  check('progress is reported', seen.join() === '3')
}
{
  const calls = []
  const r = await runTranslation({ items: itemsOf(4), sleep: noSleep, call: async b => { calls.push(b.length); return reply(b, (o, i) => (i === 2 && b.length > 1 ? null : o)) } })
  check('a text the batch reply left out gets a call of its own', r.untranslated === 0 && JSON.stringify(calls) === '[4,1]', JSON.stringify(calls))
}
{
  const r = await runTranslation({ items: itemsOf(3), sleep: noSleep, call: async b => (b.length > 1 ? reply(b).slice(0, 60) : reply(b)) })
  check('a truncated reply keeps what it finished and retries the rest', r.untranslated === 0)
}
{
  const r = await runTranslation({ items: itemsOf(2), sleep: noSleep, call: async b => JSON.stringify(b.map((it, i) => ({ i, lang: 'Chinese', text: it.text }))) })
  check('an echo is rejected (never unlocks the measures on text that is not English)', r.untranslated === 2 && r.rejected >= 2)
}
{
  let n = 0
  const r = await runTranslation({ items: itemsOf(3), sleep: noSleep, call: async b => { n++; return JSON.stringify(b.map((it, i) => ({ i: 0, lang: 'Chinese', text: DICT[it.text] }))) } })
  check('a reply that numbers every object 0 misplaces nothing: each text is asked again alone',
    r.untranslated === 0 && r.results.every((x, i) => x.text === `Text ${i}`), `calls ${n}`)
}
{
  const bad = Object.assign(new Error('401 invalid x-api-key'), { status: 401 })
  let n = 0
  let threw = null
  try {
    await runTranslation({
      items: itemsOf(15), sleep: noSleep, isFatal: e => e.status === 401,
      call: async b => { if (++n === 2) throw bad; return reply(b) },
    })
  } catch (e) { threw = e }
  check('a rejected key stops the run at once', threw === bad && n === 2)
  check('…and hands back what was already translated (and paid for)',
    threw?.partial?.results?.slice(0, 10).every((x, i) => x?.text === `Text ${i}`) && threw.partial.results[10] === null)
}
{
  let n = 0
  const r = await runTranslation({ items: itemsOf(23), sleep: noSleep, retryAttempts: 1, call: async () => { n++; throw new Error('503 overloaded') } })
  check('a provider that keeps failing trips the breaker after 3 batches', r.aborted === true && n === 3 && r.untranslated === 23 && r.failedBatches === 3, `calls ${n}`)
}
{
  let n = 0
  const r = await runTranslation({
    items: itemsOf(3), sleep: noSleep, retryAttempts: 1,
    call: async b => { n++; if (n === 1) throw new Error('503'); return reply(b) },
  })
  check('a batch that fails once does not take the rest of the run with it', r.failedBatches === 1 && !r.aborted && r.untranslated === 3 && n === 1)
}

// ── The page and the client ──────────────────────────────────────────────────
head('the page wires Step 1b in (source pins)')
const page = readFileSync(join(HERE, '../src/pages/DataAnalytics.jsx'), 'utf8')
const client = readFileSync(join(HERE, '../src/utils/llmClient.js'), 'utf8')
const i1 = page.indexOf('{/* STEP 1 ')
const i1b = page.indexOf('{/* STEP 1b')
const i2 = page.indexOf('{/* STEP 2 ')
check('the Step 1b section sits right after Step 1 and before Step 2', i1 > 0 && i1b > i1 && i2 > i1b, `${i1} ${i1b} ${i2}`)
const step1b = page.slice(i1b, i2)
check('…titled "Translate everything to English", naming Claude Fable 5.1',
  step1b.includes('Translate everything to English') && step1b.includes('Claude Fable 5.1') && step1b.includes('Find text not in English'))
check('…offering the download of all data in English', step1b.includes('Download all data in English'))
check('…and saying Step 3 is locked until the ideas are translated', /Step 3&apos;s measures read the English/.test(step1b))
check('its action cells are wrapped in a div (a td with display:flex breaks the table)', /<td><div className=\{styles\.trActions\}>/.test(step1b))
check('3.1 refuses to compute while an idea is not in English', /const notEnglish = untranslatedRows\(pool\)/.test(page))
check('3.2 refuses to rate while an idea in its scope is not in English', /const notEnglish = untranslatedRows\(scope\)/.test(page))
check('3.1 measures measureText (the English version)', /const ideaTexts = pool\.map\(measureText\)/.test(page))
check('the productivity count reads measureText too', /text: measureText\(pool\[i\]\), group:/.test(page))
check('3.2 rates measureText', /\.map\(r => \(\{ rid: r\.rid, text: measureText\(r\) \}\)\)/.test(page))
check('3.2 works off the rows WITH their English versions', /let working = applyTranslationMemory\(rows, tm\)/.test(page))
check('every downstream view reads the rows with their English versions', /const effectiveRows = useMemo\(\(\) => rowsEn\.filter/.test(page))
check('the regressions\' word count and the CSV read the English text', (page.match(/withMeasuredText\(/g) || []).length >= 3)
check('the aggregate is translated and carries the originals on a Translations sheet',
  /const tr = translateSheets\(merged, tm\)/.test(page) && /carryTranslationsSheet\(tr\.log, sources/.test(page))
check('the ideas + KPIs download is translated as well, carrying a loaded file\'s originals',
  /translateSheets\(\[\{ name: 'ideas'/.test(page) && (page.match(/carryTranslationsSheet\(tr\.log,/g) || []).length === 2)
check('both imports read a Translations sheet back', (page.match(/restoreTranslationsFrom\(bookSheets\)/g) || []).length === 2)
check('the memory is kept in this browser', /translations: 'da:translations'/.test(page))
check('changing an English version clears the measures computed from the old text', /measuredTextRef/.test(page) && /setDetResult\(null\)/.test(page))
check('translateTexts calls Claude Fable 5.1 through the shared provider call',
  /resolveProvider\(settings, TRANSLATION_PROVIDER, TRANSLATION_MODEL\)/.test(client)
  && /callProvider\(resolved, TRANSLATOR_SYSTEM_PROMPT, buildTranslatePrompt\(batch\), \{ maxTokens: TRANSLATION_MAX_TOKENS \}\)/.test(client))
check('translations get a higher output ceiling than ratings; ratings keep theirs',
  TRANSLATION_MAX_TOKENS > SCORING_MAX_TOKENS
  && buildClaudeRequest({ model: 'claude-fable-5-1', apiKey: 'k', system: 's', user: 'u', maxTokens: TRANSLATION_MAX_TOKENS }).body.max_tokens === TRANSLATION_MAX_TOKENS
  && buildClaudeRequest({ model: 'claude-fable-5-1', apiKey: 'k', system: 's', user: 'u' }).body.max_tokens === SCORING_MAX_TOKENS)
check('no Claude key is a clear, fatal error', /No Anthropic \(Claude\) API key is saved/.test(client) && /err\.fatal = true/.test(client))

head('the shipped bundle')
{
  const dir = join(HERE, '../../lab/ideasearchlab/assets')
  let files = []
  try { files = readdirSync(dir).filter(f => f.endsWith('.js')) } catch { /* not built */ }
  const html = (() => { try { return readFileSync(join(HERE, '../../lab/ideasearchlab/index.html'), 'utf8') } catch { return '' } })()
  const main = files.find(f => html.includes(f))
  const body = main ? readFileSync(join(dir, main), 'utf8') : ''
  check('the served bundle carries Step 1b ("Translate everything to English", Fable 5.1)',
    body.includes('Translate everything to English') && body.includes('claude-fable-5-1'), main || 'no bundle')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
