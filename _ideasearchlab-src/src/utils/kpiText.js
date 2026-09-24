/**
 * kpiText.js
 *
 * How the Section 3.1 novelty KPIs read an idea's words (owner, 2026-09-24: "UK and
 * US spelling (colour, color), plurals (sock, socks) and synonyms all change the
 * scores" — fix it). `kpiTokens` turns a text into the terms the TF-IDF vectors are
 * built from, in five steps:
 *
 *   1. the tokeniser tfidf.js has always used (lowercase, runs of 2+ letters/digits);
 *   2. common English words are dropped (COMMON_WORDS, NLTK's list — the same list
 *      the "two meaningful words" rule uses), so "the", "that", "with" stop counting
 *      toward similarity, and stop inflating long texts' overlap with everything;
 *   3. UK spelling is folded to US (colour -> color, grey -> gray, fibre -> fiber,
 *      -ise -> -ize for a closed list of stems);
 *   4. Porter stemming (porter.js): sock/socks, change/changing/changed are one term;
 *   5. a short list of synonyms is mapped onto one word (SYNONYMS below): tee and
 *      t-shirt, pullover and hoodie, cup and mug ...
 *
 * Measured on the audit's labelled benchmark (88 restatements of the 22 products in
 * R, 84 new ideas): spelling no longer moves any score, the plural forms of R's own
 * products score ~0 instead of 0.55, and separation of new from existing ideas is
 * unchanged or better. Steps 2-4 are the textbook fixes; step 5 is deliberately
 * short and conservative — a word with a common second meaning (ring, band, case,
 * glass, patch) is NOT mapped, since a wrong synonym makes a new idea look old.
 *
 * Mirrored by kpi_tokens in _idea-kpi-script/idea_kpis.py (det-kpi-guard.mjs checks
 * both lists and the numbers match).
 */
import { tokenize } from './tfidf.js'
import { porterStem } from './porter.js'

/**
 * Common English words: NLTK's English stop-word list (nltk_data corpora/stopwords,
 * "english"), keeping the entries the tokeniser can produce — two or more letters and
 * no apostrophe (it splits "don't" into "don" + "t", and "don" is on the list).
 * Mirrored as COMMON_WORDS in _idea-kpi-script/idea_kpis.py.
 */
export const COMMON_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'ain', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'couldn', 'did', 'didn', 'do',
  'does', 'doesn', 'doing', 'don', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'hadn', 'has', 'hasn', 'have', 'haven', 'having', 'he', 'her',
  'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'if', 'in', 'into', 'is',
  'isn', 'it', 'its', 'itself', 'just', 'll', 'ma', 'me', 'mightn', 'more', 'most',
  'mustn', 'my', 'myself', 'needn', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
  'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  're', 'same', 'shan', 'she', 'should', 'shouldn', 'so', 'some', 'such', 'than',
  'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 've',
  'very', 'was', 'wasn', 'we', 'were', 'weren', 'what', 'when', 'where', 'which', 'while',
  'who', 'whom', 'why', 'will', 'with', 'won', 'wouldn', 'you', 'your', 'yours',
  'yourself', 'yourselves'
])

/** UK -> US spelling: whole words first, then the -our and -ise patterns. */
export const UK_US_WORDS = {
  grey: 'gray', greys: 'grays', cosy: 'cozy', cosier: 'cozier', centre: 'center', centres: 'centers',
  metre: 'meter', metres: 'meters', litre: 'liter', litres: 'liters', fibre: 'fiber', fibres: 'fibers',
  fibreglass: 'fiberglass', theatre: 'theater', theatres: 'theaters', pyjamas: 'pajamas', pyjama: 'pajama',
  tyre: 'tire', tyres: 'tires', mould: 'mold', aluminium: 'aluminum', jewellery: 'jewelry',
  catalogue: 'catalog', programme: 'program', defence: 'defense', licence: 'license', practise: 'practice',
  analyse: 'analyze', analysed: 'analyzed', travelling: 'traveling', travelled: 'traveled',
  modelling: 'modeling', labelled: 'labeled', nappy: 'diaper', nappies: 'diapers',
}
const OUR_STEMS = 'colo|flavo|favo|behavio|humo|labo|neighbo|odo|harbo|hono|rumo|vapo|armo|savo|endeavo|vigo|splendo|tumo|rigo|valo'
const ISE_STEMS = 'personal|custom|organ|real|recogn|optim|minim|maxim|visual|priorit|emphas|apolog|categor|sanit|steril|stabil|standard|util|special|mobil|energ|synchron|harmon|memor|summar|critic|final|normal|neutral|person'
const OUR_RE = new RegExp('^(' + OUR_STEMS + ')ur(.*)$')
const ISE_RE = new RegExp('^(' + ISE_STEMS + ')is(e|ed|es|ing|ation|ations|er|ers)$')

/** One token, UK spelling folded to US. */
export function foldUkUs(t) {
  if (Object.prototype.hasOwnProperty.call(UK_US_WORDS, t)) return UK_US_WORDS[t]
  let m = OUR_RE.exec(t)
  if (m) return m[1] + 'r' + m[2]
  m = ISE_RE.exec(t)
  if (m) return m[1] + 'iz' + m[2]
  return t
}

/**
 * Synonyms: each word on the left counts as the word on the right. Unambiguous
 * everyday words only (see the header). Both sides are stemmed when the table is
 * built, so plurals and -ing forms follow ("tees", "pullovers").
 */
export const SYNONYMS = {
  // shirts and tops
  tee: 'shirt', tshirt: 'shirt', jersey: 'top', singlet: 'top', vest: 'top',
  // hoodies and jumpers
  hoody: 'hoodie', sweatshirt: 'hoodie', pullover: 'hoodie', jumper: 'hoodie', sweater: 'hoodie',
  // legwear and swimwear
  hosiery: 'sock', trunks: 'shorts', swimsuit: 'swim', swimwear: 'swim',
  // sport
  sport: 'athletic', sports: 'athletic', sportswear: 'athletic', gym: 'athletic', workout: 'athletic',
  fitness: 'athletic', exercise: 'athletic', athlete: 'athletic', athletes: 'athletic',
  // jewellery and accessories
  pendant: 'necklace', choker: 'necklace', bangle: 'bracelet', wristband: 'bracelet',
  spectacles: 'eyeglass', eyewear: 'eyeglass', eyeglasses: 'eyeglass', sunglasses: 'eyeglass',
  smartphone: 'phone', cellphone: 'phone',
  // cosmetics
  varnish: 'polish', lacquer: 'polish',
  // containers and home
  cup: 'mug', tumbler: 'mug', rug: 'mat', showerhead: 'shower', fishtank: 'aquarium',
  // babies and health
  infant: 'baby', infants: 'baby', newborn: 'baby', toddler: 'baby', toddlers: 'baby',
  decal: 'sticker',
  // colour and warmth
  hue: 'color', shade: 'color', tint: 'color', warmth: 'heat', warm: 'heat', warmed: 'heat',
}
const SYN_STEMS = new Map(Object.entries(SYNONYMS).map(([a, b]) => [porterStem(foldUkUs(a)), porterStem(foldUkUs(b))]))

/** The terms the Section 3.1 novelty KPIs compare (see the header). */
export function kpiTokens(text) {
  const out = []
  for (const t of tokenize(text)) {
    if (COMMON_WORDS.has(t)) continue
    const s = porterStem(foldUkUs(t))
    out.push(SYN_STEMS.get(s) ?? s)
  }
  return out
}
