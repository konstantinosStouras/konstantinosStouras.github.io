/**
 * usefulnessKpis.js
 *
 * The objective, deterministic proxies of idea USEFULNESS for Section 3.1 — the
 * counterpart of deterministicKpis.js, whose KPIs are all proxies of NOVELTY.
 *
 * Why usefulness needs its OWN anchor (the design rule of this file). Creativity is
 * "novel AND useful" (Runco & Jaeger 2012; Amabile 1983), and the two often pull in
 * opposite directions: originality falls as appropriateness rises across idea pools
 * (Runco & Charles 1993), originality is negatively correlated with feasibility
 * (Rietzschel, Nijstad & Stroebe 2010), and a text-distance novelty score correlated
 * about r = -.75 with rated appropriateness (Beaty & Johnson 2021, reanalysing Heinen
 * & Johnson 2018; single-word verb generation, not product ideas). So a usefulness
 * score built from the SAME similarities as novelty (e.g. "close to the reference
 * set R") would only be 1 − novelty with a new name. Every KPI here is anchored on
 * something the novelty KPIs never look at:
 *
 *   • Need fit     — closeness to a list U of USER NEEDS (what people need), where
 *                    Novelty measures distance from R (what already exists). The
 *                    brief itself asks for this: "consider what users currently
 *                    have (R) and what unmet needs remain (U)". Dean, Hender,
 *                    Rodgers & Santanen (2006): relevance = the idea applies to,
 *                    and would solve, the stated problem.
 *   • Specificity  — how completely the idea is specified: who it is for, what it
 *                    is, where/when it is used, why (the benefit) and how it works.
 *                    Dean et al. (2006): specificity, whose completeness
 *                    sub-dimension covers exactly these subcomponents.
 *   • Workability  — feasibility with the brief's material: 1 / (1 + the number
 *                    of extra technologies the idea needs: apps, batteries,
 *                    sensors …). Dean et al. (2006) workability; the brief's own
 *                    "Feasibility" criterion.
 *   • Usefulness score — the composite of the three (mean of their percentile
 *                    ranks in the pool, so no one scale dominates).
 *
 * (A behavioural "peer vote share" was considered and left out, per the owner: the
 * Final Ideas are chosen by those votes, which makes it circular.)
 *
 * Everything is pure arithmetic over the idea text, so it is unit-testable offline
 * (tools/usefulness-kpis-guard.mjs) and reproducible from the Step-2 data alone.
 * `usefulnessKpisFromText` is the whole pipeline the page runs. Ideas + U are
 * vectorised together (one vocabulary, one IDF) but SEPARATELY from ideas + R, so
 * editing U never moves a novelty number. An idea that cannot be scored — fewer than
 * two meaningful words: blank, a single word, only common words, a non-Latin script —
 * is left unscored on every usefulness KPI and kept out of the corpus: the same rule
 * objectiveKpis.js applies to the novelty side (isMeasurable), so an idea is blank on
 * both sides or on neither.
 */
import { cosine, hasTerms } from './deterministicKpis.js'
import { tfidfVectors } from './tfidf.js'
import { isMeasurable } from './objectiveKpis.js'

// ── Stop words (usefulness side only) ───────────────────────────────────────
// Short ideas share function words with everything ("that", "when", "for"), and
// without removal those words carry part of every cosine. Forthmann et al. (2019)
// show such text-similarity scores are biased by response length and that dropping
// stop words reduces the bias. Applied ONLY to the Need-fit vectorisation: the
// novelty KPIs keep their original tokenisation, so their values do not move.
export const STOP_WORDS = new Set((
  'a an the and or but if then so as of at by for from in into on onto to up with within without ' +
  'is are was were be been being am do does did doing have has had having can could will would shall ' +
  'should may might must it its it\'s this that these those there here their theirs them they you your ' +
  'yours we our ours us he him his she her hers i me my mine who whom whose which what when where why ' +
  'how all any both each few more most other some such no nor not only own same than too very just ' +
  'also about above after again against below between during before over under once while until ' +
  'because through off out down further per via one ones something anything everything thing things ' +
  'get gets got make makes made use used uses using like new product products show shows showing'
).split(/\s+/))

/**
 * Light plural folding so "pets" matches "pet" and "babies" matches "baby" (TF-IDF
 * matches exact words): -ies → -y, -ches/-shes/-sses/-xes/-zes → drop "es", else a
 * final "s" (not -ss / -us / -is). Crude on purpose: the same rule runs on the ideas
 * AND on U, so any oddity ("clothes" → "clothe") is the same on both sides.
 */
export function foldPlural(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 4 && /(?:ch|sh|ss|x|z)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1)
  return w
}

/** Lowercase, drop stop words, fold plurals (keeps word order; for TF-IDF input). */
export function contentText(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [])
    .filter(w => !STOP_WORDS.has(w)).map(foldPlural).join(' ')
}

// ── Need fit ─────────────────────────────────────────────────────────────────

/**
 * Need fit of an idea = the highest cosine similarity to any line of the need set
 * U. Higher = closer to a stated user need. Returns null if U is empty.
 */
export function needFit(ideaVec, needVecs) {
  // An idea with no content word left (blank, or only filler words) has nothing to
  // compare: null, not "fits no need" (0). A need line with no terms is ignored.
  if (!hasTerms(ideaVec)) return null
  const needs = (needVecs || []).filter(hasTerms)
  if (needs.length === 0) return null
  let max = 0
  for (const u of needs) { const s = cosine(ideaVec, u); if (s > max) max = s }
  return max
}

// ── Specificity (5W1H completeness) ─────────────────────────────────────────
// Five facets an idea description can state (Dean et al. 2006, completeness).
// Small, generic English lexicons: plain word lists, matched on whole words, case-
// insensitive. Deliberately NOT tuned to one theme beyond wearables/products, and
// deliberately free of the vaguest fillers ("people", "anyone", "users"), which
// name nobody in particular. A facet counts once, however many words hit it.

const words = list => new RegExp(`\\b(?:${list.join('|')})\\b`, 'i')

export const FACETS = [
  {
    key: 'who',
    label: 'Who it is for',
    re: words([
      'bab(?:y|ies)', 'infants?', 'toddlers?', 'newborns?', 'child(?:ren)?', 'kids?',
      'parents?', 'mothers?', 'moms?', 'mums?', 'fathers?', 'dads?', 'famil(?:y|ies)',
      'elderly', 'older (?:adults?|people|persons?)', 'seniors?', 'grandparents?', 'pensioners?',
      'patients?', 'nurses?', 'doctors?', 'clinicians?', 'medics?', 'surgeons?', 'carers?', 'caregivers?',
      'athletes?', 'runners?', 'joggers?', 'cyclists?', 'bikers?', 'swimmers?', 'players?', 'hikers?',
      'climbers?', 'skiers?', 'dancers?', 'footballers?', 'sportspeople', 'sports(?:wo)?m[ae]n',
      'workers?', 'employees?', 'staff', 'builders?', 'labou?rers?', 'farmers?', 'soldiers?',
      'firefighters?', 'police(?: officers?)?', 'drivers?', 'pilots?', 'chefs?', 'cooks?',
      'students?', 'pupils?', 'teachers?', 'coaches', 'travell?ers?', 'tourists?', 'commuters?',
      'women', 'woman', 'girls?', 'boys?', 'teens?', 'teenagers?', 'adults?',
      'pregnan(?:t|cy)', 'diabetics?', 'disabled', 'dementia', 'autis(?:m|tic)', 'arthritis',
      'pets?', 'dogs?', 'cats?', 'pupp(?:y|ies)', 'horses?', 'animals?', 'livestock', 'cattle', 'cows?',
      'fans?', 'gamers?', 'musicians?', 'performers?', 'babysitters?', 'nann(?:y|ies)', 'wearers?',
    ]),
  },
  {
    key: 'what',
    label: 'What the product is',
    re: words([
      't-?shirts?', 'shirts?', 'tees?', 'tops?', 'hood(?:ie|y|ies)s?', 'jumpers?', 'sweaters?',
      'jackets?', 'coats?', 'vests?', 'dress(?:es)?', 'skirts?', 'trousers', 'pants', 'leggings',
      'shorts', 'jeans', 'socks?', 'gloves?', 'mittens?', 'hats?', 'caps?', 'beanies?', 'headbands?',
      'scarf', 'scarves', 'bandanas?', 'masks?', 'bibs?', 'onesies?', 'rompers?', 'babygrows?',
      'sleepsuits?', 'pyjamas?', 'pajamas?', 'underwear', 'bras?', 'swimsuits?', 'uniforms?',
      'aprons?', 'scrubs', 'gowns?', 'sleeves?', 'wristbands?', 'armbands?', 'bands?', 'bracelets?',
      'straps?', 'belts?', 'collars?', 'harness(?:es)?', 'patch(?:es)?', 'plasters?', 'bandages?',
      'dressings?', 'wraps?', 'braces?', 'slings?', 'blankets?', 'sheets?', 'bedding', 'duvets?',
      'pillows?', 'pillowcases?', 'mattress(?:es)?', 'towels?', 'bags?', 'backpacks?', 'covers?',
      'shoes?', 'insoles?', 'sneakers?', 'trainers?', 'boots?', 'slippers?', 'helmets?',
      'stickers?', 'labels?', 'tags?', 'toys?', 'dolls?', 'teddy', 'teddies', 'garments?',
      'clothing', 'clothes', 'apparel', 'outfits?', 'costumes?', 'curtains?', 'upholstery',
      'seat ?covers?', 'car ?seats?', 'pram', 'strollers?', 'cot', 'crib', 'sleeping ?bags?',
      '\\w+wear',  // sportswear, sleepwear, nightwear, workwear, swimwear, footwear (not the verb "wear")
    ]),
  },
  {
    key: 'context',
    label: 'Where or when it is used',
    re: words([
      'hospitals?', 'clinics?', 'wards?', 'care ?homes?', 'nursing ?homes?', 'at home', 'schools?',
      'nurser(?:y|ies)', 'daycare', 'kindergartens?', 'gyms?', 'offices?', 'workplaces?',
      'factor(?:y|ies)', 'sites?', 'kitchens?', 'bed', 'bedrooms?', 'cars?', 'vehicles?',
      'beach(?:es)?', 'pools?', 'festivals?', 'concerts?', 'stadiums?', 'pitch(?:es)?', 'farms?',
      'stables?', 'outdoors?', 'outside', 'indoors?', 'mountains?', 'deserts?', 'battlefields?',
      'nights?', 'night-?time', 'overnight', 'bedtime', 'sleep(?:ing)?', 'mornings?', 'summers?',
      'winters?', 'heat ?waves?', 'hot (?:weather|days?|climates?)', 'cold (?:weather|days?|climates?)',
      'during', 'while', 'whilst', 'workouts?', 'exercis(?:e|es|ing)', 'training', 'matches',
      'races?', 'marathons?', 'games?', 'travel(?:l?ing)?', 'flights?', 'commut(?:e|es|ing)',
      'surger(?:y|ies)', 'recovery', 'rehab(?:ilitation)?', 'physio(?:therapy)?',
      'emergenc(?:y|ies)', 'every ?day', 'daily', 'shifts?', 'playgrounds?', 'parties', 'party',
    ]),
  },
  {
    key: 'why',
    label: 'Why: the benefit or purpose',
    re: words([
      'to help', 'helps?', 'helping', 'so that', 'so (?:you|they|parents|carers|staff|users|it|the)',
      'in order to', 'allows?', 'allowing', 'lets?', 'letting', 'enables?', 'enabling',
      'prevents?', 'preventing', 'prevention', 'avoids?', 'avoiding', 'reduces?', 'reducing',
      'saves?', 'saving', 'protects?', 'protecting', 'protection', 'warns?', 'warning', 'alerts?',
      'alerting', 'notif(?:y|ies|ying)', 'reminds?', 'reminding', 'reassur(?:e|es|ing|ance)',
      'detects?', 'detecting', 'detection', 'monitors?', 'monitoring', 'tracks?', 'tracking',
      'safer', 'safety', 'safe', 'health(?:y|ier)?', 'comfort(?:able)?', 'easier', 'early',
      'quickly', 'instantly', 'peace of mind', 'no need', 'without (?:the need|needing|having)',
      'ideal for', 'useful for', 'great for', 'perfect for', 'designed for', 'aimed at',
      'benefits?', 'improv(?:e|es|ing)', 'encourag(?:e|es|ing)', 'motivat(?:e|es|ing)',
    ]),
  },
  {
    // Only mechanism detail BEYOND the brief. Almost every idea restates the brief
    // ("changes colour at body temperature"), so its words (temperature, heat, 37,
    // colour change, fabric) do not count, nor do the worked example's ("reveals a
    // hidden pattern"): otherwise this part fires for nearly every idea. What counts:
    // the colour it turns, a threshold other than 37 degrees, where on the product or
    // body the fabric sits, how it is made, and whether it resets.
    key: 'how',
    label: 'How it works (beyond the brief)',
    re: new RegExp([
      words([
        '(?:turns?|turning|goes|going|becomes?|becoming|changes? to|shifts? to|fades? to) (?:bright |dark |light |deep |pale )?(?:red|blue|green|yellow|purple|pink|orange|white|black|clear|transparent|grey|gray|violet)',
        'zones?', 'panels?', 'linings?', 'layers?', 'stripes?', 'cuffs?', 'underarms?', 'armpits?',
        'chest', 'forehead', 'neckline', 'wrists?', 'soles?', 'waistband', 'inner', 'inside', 'outer',
        'placed', 'positioned', 'printed', 'prints?', 'woven', 'sewn', 'stitched', 'embroidered',
        'embedded', 'coated', 'coating', 'dyed', 'microcapsules?', 'inserts?', 'detachable', 'removable',
        'washable', 'reusable', 'reversible', 'adjustable', 'velcro', 'pockets?', 'threads?', 'yarns?',
        'fib(?:re|er)s?', 'mesh', 'gradients?', 'scale', 'threshold', 'symbols?', 'icons?', 'logos?',
        'messages?', 'returns? to', 'resets?', 'fades? back', 'changes? back', 'goes back',
      ]).source,
      // A temperature other than the brief's 37: "38°C", "39 degrees", "40C", "above 38".
      '(?:^|[^\\d.,])(?!37(?![.,]\\d))\\d{1,3}(?:[.,]\\d)?\\s?(?:°|º|degrees?\\b|c\\b)',
      '\\b(?:above|over|below|under|reaches|past) (?!37\\b)\\d{2}(?:[.,]\\d)?\\b',
    ].join('|'), 'i'),
  },
]

/** Which facets a text states: { who, what, context, why, how } → booleans. */
export function specificityFacets(text) {
  const t = String(text || '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
  const out = {}
  for (const f of FACETS) out[f.key] = f.re.test(t)
  return out
}

/**
 * Specificity = the share of the five facets the idea states (0, .2, … 1).
 * Returns null for an idea with no text (nothing can be measured).
 */
export function specificity(text) {
  if (!String(text || '').trim()) return null
  const f = specificityFacets(text)
  return FACETS.filter(x => f[x.key]).length / FACETS.length
}

// ── Workability (feasibility with the given material) ───────────────────────
// Dean et al. (2006) "workability": can it be built easily, without breaking known
// constraints. Participants were told the same ("Feasibility: can it be built with
// today's technology?") and the worked example says "no electronics needed". So
// Workability counts the EXTRA technology an idea says it needs on top of the
// brief's material (apps, batteries, sensors, AI …), from an editable list T:
//     workability = 1 / (1 + k),  k = number of distinct T entries the idea names
// 1 = needs nothing but the material; 0.5 = one extra technology; 0.33 = two; ….
// A word list, not a similarity, so it is not tied to Novelty by construction —
// though ideas that bolt on electronics tend to move away from R, so the two can
// correlate negatively in the data (the originality-feasibility trade-off:
// Rietzschel et al. 2006, 2010; Poetz & Schreier 2012).

const escapeRe = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Compile the technology list (one term or phrase per entry) into matchers: whole
 * words, case-insensitive, an optional plural ("app"/"apps", "battery"/"batteries"),
 * and a space in a phrase also matching a hyphen ("light up" = "light-up").
 */
export function compileTerms(terms) {
  return (terms || [])
    .map(t => String(t || '').trim().toLowerCase())
    .filter(Boolean)
    .map(t => {
      // "battery" also matches "batteries" (consonant + y → ies); else an optional s/es.
      const yPlural = /[^aeiou]y$/.test(t)
      const stem = escapeRe(yPlural ? t.slice(0, -1) : t).replace(/\s+/g, '[\\s-]+')
      return { term: t, re: new RegExp(`\\b${stem}${yPlural ? '(?:y|ies)' : '(?:e?s)?'}\\b`, 'i') }
    })
}

// A mention that is negated does not count: the worked example participants saw
// says "no electronics needed", and "battery-free" / "without an app" say the idea
// needs LESS technology, not more. The negation also reaches the later items of a
// negated LIST (owner's data, 2026-09-24: "it removes the battery or Bluetooth
// wearable device" was scored as needing both).
//
// The rule is written for PRECISION first. Hiding a technology the idea really uses
// inflates its Workability, and the review of 2026-09-24 found the first list rule
// doing exactly that in ordinary sentences: "washed without damaging the sensor",
// "Parents replace the coin battery", "a no-contact sensor", "Do not iron or the
// LEDs will melt", "No app, the sensor turns the patch red or green". So a mention
// is negated only when EVERY word from a negator up to the term fits this small
// grammar, with nothing left over:
//
//   negator  [lead-in]  { [articles] item joiner }  [articles]  [<= 2 describing words]  TERM
//
//   negator      a closed list, each a whole word followed by a space (so "no-contact"
//                and "zero-waste" are adjectives, not negators): no, without, zero,
//                nor, neither, free of / from, instead of, rather than, "does not
//                need / require / have / rely on …", "never needs", "no longer
//                need(s)", "removes the need for", "unlike … that rely on / use /
//                need / require", and the verbs that take something AWAY: "it / this
//                / which / that removes / eliminates / replaces", "eliminates", "gets
//                rid of", "ditches". A maintenance verb with a person or an order as
//                its subject ("Parents replace the battery", "Remove the sensor
//                before washing") is not a negator.
//   lead-in      "the need for", "the help of", "the use of", "need to use", and one
//                verb from a CLOSED list that means using or needing (using, needing,
//                requiring, relying on, adding, having, having to use, wearing,
//                carrying, checking …), maybe after an -ly adverb. Any other -ing
//                verb ends the reach ("without draining the battery" keeps the
//                battery). After "without", "<-ing verb> [two words] or <closed
//                verb>" is allowed too: "without waking them or using a sensor".
//   articles     a, an, any, extra, external, separate, additional. "the" only
//                after a verb that takes something away ("removes the battery"), and
//                after "or" only when the item before it had "the" too: "without the
//                app" / "no battery or the sensor would overheat" name a thing the
//                idea HAS.
//   item         at most two describing words + a HEAD: a term of T, or one of a few
//                general kit nouns (device, screen, thermometer, phone, wire …), so
//                "no change or the app alarm" keeps the app ("change" is not kit).
//   joiner       "or", "nor", "/", or a comma (", or" too). Never "and", and never
//                " - " or a dash, which end the clause like ".;:!?".
//   describing   any word except a joining word, preposition, pronoun, auxiliary,
//     word       article, negator, "only / just / even / longer / matter / doubt …",
//                a number, or a word ending in -ing / -ed / -ly / -s (a verb such as
//                "means" or "sends", or a plural noun, is never a describing word).
//
// With no list at all it is the plain case: "no battery", "without any extra
// electronics", "does not need a sensor", "no electronic sensors".
//
// "not" and "never" alone reach only "a / an / any" and the term ("it's not a
// notification"): they usually govern a verb ("Do not tumble dry or the battery …").
// "no-app" / "zero-battery" (fused by a hyphen) negate the term they are fused to,
// and "-free" / " free" straight after the term negates it ("battery-free").
//
// A list with a COMMA is where a negation most often leaks, because the comma can
// just as well close the negated phrase: "Without a battery, the sensor or the app
// alerts parents". So a comma list negates only when (1) it closes with "or" /
// "nor" INSIDE the list itself (after its last comma before the term, or in the
// next items straight after the term), and (2) its last item is followed by an
// end: ".", ";", ",", ")", a dash, "needed", "required", "inside", or "and" + a
// word that is not an article. So "no battery or app, a sensor measures it" and
// "No app, a sensor or an LED shows the warning" keep the sensor and the LED. A
// later item of an "or" list without a comma must not run straight into a verb
// either ("It needs no battery or an LED would dim" keeps the LED).
//
// Everything is read from a 60-character window on each side of the term, and the
// grammar has one way to split any text (single spaces between words, a hyphen only
// inside a word), so matching stays fast whatever is pasted in.
const NEG_WINDOW = 60
// A negator must start a word: not the end of "piano" or "casino", not "-no".
const NEG_START = String.raw`(?:^|[^a-z0-9'-])`
// Not "the", and not "other": "no other sensor like it" is said of a sensor.
const NEG_ART = 'any|an|a|extra|external|separate|additional'
const NEG_ARTS = String.raw`(?:(?:${NEG_ART}) ){0,2}`
const NEG_THE = String.raw`the (?:(?:${NEG_ART}) )?`
// Before matching, the window is reduced to its grammar: every HEAD (a term of T,
// or a general kit noun) becomes one mark, and every describing word another, so
// the matchers below are small and do not depend on the list T.
const NEG_HEAD = '\uE000'
const NEG_DESC = '\uE001'
const NEG_KIT = compileTerms([
  'device', 'gadget', 'technology', 'tech', 'equipment', 'hardware', 'software', 'electricity', 'power',
  'wire', 'wiring', 'cable', 'cord', 'plug', 'screen', 'display', 'monitor', 'thermometer', 'phone',
  'smartphone', 'watch', 'tracker', 'wearable', 'component', 'part', 'reader', 'probe', 'connectivity', 'connection',
])
// Verbs that start a new clause after a plural subject ("or sensors STAY hidden");
// never a describing word either.
const NEG_BASE_VERBS = 'get|keep|stay|start|stop|turn|change|blink|glow|flash|beep|buzz|vibrate|send|read|show|alert|warn|tell|measure|detect|sense|track|log|record|store|save|monitor|check|work|run|last|die|fail|break|overheat|go'
// Words that are never a describing word (the grammar's own words among them).
const NEG_NOT_A_MODIFIER = new Set([
  NEG_BASE_VERBS,
  `the|other|${NEG_ART}`,
  'and|or|nor|but|plus|also|yet|so|then|than|only|just|even|ever|merely|still|already|all|some|every|each|such|like|unlike',
  'because|since|as|by|via|through|for|to|in|on|at|of|from|into|onto|over|under|with|within|about|after|before|until|unless|when|where|whether|while|if|though|although',
  'which|that|who|whom|whose|what|whatever|how|why|this|these|those|it|its|they|them|their|he|she|his|her|we|our|you|your|i|my|me',
  'one|two|three|four|five|six|seven|eight|nine|ten|dozen|hundred|several',
  'is|are|was|were|be|been|being|am|will|shall|can|cannot|could|would|should|may|might|must|do|does|did|has|have|had|get',
  'need|use|wear|carry|buy|install|check|rely|depend|require|contain|include|involve|help|rid',
  'no|not|never|without|zero|neither|free|instead|rather|none|nothing',
  'longer|more|less|most|least|much|many|few|matter|doubt|wonder|way|sooner|question|fail|exception|up|out|off|down|here|there',
  'necessary|inside|anywhere|whatsoever',
].join('|').split('|'))
/**
 * A describing word: a plain word, not on the list above (nor starting with one:
 * "no-contact"), not a number, not a contraction, and not ending in -ing / -ed /
 * -ly / -s (a verb such as "means" or "sends", or a plural noun).
 */
const isDescribingWord = w => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(w)
  && !NEG_NOT_A_MODIFIER.has(w.split('-')[0]) && !w.split('-').some(p => /(?:ing|ed|ly|[^su]s)$/.test(p))
// The verbs that carry "without / no / instead of" on to what is used or needed.
const NEG_GERUND = String.raw`(?:(?:[a-z]+ly|ever|even) )?(?:using|needing|requiring|relying on|depending on|adding|having to (?:use|wear|carry|buy|install|check|rely on|depend on)|having|wearing|carrying|checking|installing|buying)`
const NEG_LEAD = String.raw`(?:(?:the )?(?:need|help|use) (?:for|of) |(?:the )?need to (?:use|wear|carry|buy|install) )?(?:${NEG_GERUND} )?`
// One word of the "unlike …" / "without waking …" phrases.
const negToken = stop => String.raw`(?!(?:${stop})\b)[^\s,/.;:!?()]+`
// The verbs that take something away: the only negators "the" may follow.
const NEG_TAKE_AWAY = String.raw`(?:it|this|which|that) (?:removes|eliminates|replaces)|eliminat(?:es|ing)|gets rid of|getting rid of|ditch(?:es|ing)`
const NEG_OTHER = [
  'no|zero|nor|neither|free of|free from|instead of|rather than',
  // "without waking them or using …": the negation skips one other -ing phrase to
  // reach a closed verb that means using.
  String.raw`without(?: [a-z]+ing(?: ${negToken('and|or|nor|but|because|since|so|while|when|if|then|which|that')}){0,2} or(?= ${NEG_GERUND} ))?`,
  String.raw`(?:do|does|did|will|would)(?: not|n't)(?: even)? (?:need|require|have|contain|include|involve|rely on|depend on)`,
  String.raw`(?:does|did)(?: not|n't)(?: even)? use|won't(?: even)? (?:need|require|use|have|rely on)`,
  String.raw`(?:never|no longer) (?:needs?|requires?|uses?|relies on|rely on|depends on|depend on)`,
  String.raw`(?:remov|replac|eliminat|avoid)(?:es|ing) the need (?:for|of)`,
  String.raw`unlike(?: ${negToken('and|or|nor|but|because|since|so|while|when|if|that|which|who')}){1,4} (?:that|which|who) (?:rely on|relies on|depend on|depends on|need|needs|require|requires|use|uses)`,
].join('|')
// What may follow the LAST item of a comma list for the list to count as closed.
const NEG_END = String.raw`(?:$| ?[.;:!?)]| ,| -| ?[—–]| and (?!(?:the|${NEG_ART}|some|its|their|his|her|our|your)\b)| (?:(?:is|are) )?(?:needed|required|necessary|involved|included)\b| (?:is|are) inside\b| (?:at all|inside|anywhere|whatsoever)\b)`
const NEG_ITEM_MOD = `[${NEG_HEAD}${NEG_DESC}]`             // a head can describe another: "watch sensor"
const NEG_ITEM = `(?:${NEG_ITEM_MOD} ){0,2}${NEG_HEAD}`
// Text before the term (reduced, see reduceWindow), ending where the term starts.
const negBefore = joiner => {
  const noThe = `${NEG_ARTS}(?:${NEG_ITEM} ${joiner}(?:${NEG_GERUND} )?${NEG_ARTS})*(?:${NEG_ITEM_MOD} ){0,2}$`
  const the = `(?:${NEG_THE}${NEG_ITEM} ${joiner}(?:${NEG_GERUND} )?)*(?:${NEG_THE}(?:${NEG_ITEM_MOD} ){0,2}$|${noThe})`
  return new RegExp(`${NEG_START}(?:(?:${NEG_TAKE_AWAY}) ${the}|(?:${NEG_OTHER}) ${NEG_LEAD}${noThe})`)
}
const NEG_LIST_PLAIN = negBefore('(?:or |nor |/ )')
const NEG_LIST_COMMA = negBefore('(?:, (?:or |nor )?|or |nor |/ )')
// Text after the term: the rest of the term's own item ("electronic TEMPERATURE
// SENSOR"), then either the end of the list, or more items that close with or/nor.
const NEG_REST = String.raw`(?:(?: ${NEG_ITEM_MOD}){0,2} ${NEG_HEAD})?`
const NEG_NEXT_ITEM = String.raw`(?: (?:the|${NEG_ART})){0,2}(?: ${NEG_ITEM_MOD}){0,2} ${NEG_HEAD}`
const NEG_LIST_ENDS_HERE = new RegExp(`^${NEG_REST}${NEG_END}`)
// A later item of an "or" list followed by a verb (maybe after two more words of the
// item) starts a new clause ("It needs no battery or an LED would dim", "No wires or
// sensors stay hidden", "or an electronic tag logs it"): that item keeps its technology.
const NEG_LIST_THEN_VERB = new RegExp(`^${NEG_REST}(?: ${NEG_DESC}){0,2} (?:(?:is|are)(?! (?:needed|required|necessary|involved|included|used|inside)\\b)|${[
  'would|could|should|will|can|may|might|must|shall|cannot|won\'t|can\'t|wouldn\'t|couldn\'t|does|did|has|had|was|were',
  'gets|keeps|stays|starts|stops|turns|changes|blinks|glows|lights|flashes|beeps|buzzes|vibrates|sends|reads|shows',
  'alerts|warns|tells|measures|detects|senses|tracks|logs|records|stores|saves|monitors|checks|works|runs|lasts|dies|fails|breaks|overheats|goes',
  NEG_BASE_VERBS,     // the same verbs after a plural ("or sensors stay hidden")
].join('|')})\\b`)
const NEG_LIST_CLOSES_AFTER = new RegExp(
  `^${NEG_REST}(?: ,${NEG_NEXT_ITEM})*(?: ,)? (?:or|nor)(?: ${NEG_GERUND})?${NEG_NEXT_ITEM}${NEG_END}`)
// "not" / "never" reach only "a / an / any"; "no-app", "zero-battery" negate the term
// they are fused to; "battery-free" / "sensor free" (but not "an app free to download",
// "an app free of ads").
const NEGATED_SHORT = new RegExp(String.raw`${NEG_START}(?:(?:not|never) ${NEG_ARTS}|(?:no|zero)-)$`)
const NEGATED_AFTER = /^(?:-| )free\b(?! (?:to|of|from|for)\b)/

const headMarkCache = new WeakMap()
/** One regex that finds every head of T + the kit nouns (built once per list T). */
function headMarker(compiled) {
  let re = headMarkCache.get(compiled)
  if (!re) {
    re = new RegExp([...compiled, ...NEG_KIT].map(c => c.re.source).join('|'), 'gi')
    headMarkCache.set(compiled, re)
  }
  return re
}
/**
 * The window as the grammar reads it: lower case, one word per space, "," and "/"
 * as words of their own, every head replaced by NEG_HEAD and every describing
 * word by NEG_DESC.
 */
const reduceWindow = (s, heads) => s.replace(heads, NEG_HEAD).toLowerCase()
  .replace(/\s*([,/])\s*/g, ' $1 ').split(' ').map(w => (isDescribingWord(w) ? NEG_DESC : w)).join(' ')

/** Is the mention at [start, end) negated? */
function isNegated(text, start, end, heads) {
  let before = text.slice(Math.max(0, start - NEG_WINDOW), start)
  // A window that starts inside a word drops that part word ("…casi|no app").
  if (start > NEG_WINDOW && /[a-z0-9'-]/i.test(text[start - NEG_WINDOW - 1])) before = before.replace(/^[a-z0-9'-]+/i, '')
  // A window cut short is marked with "…", so the cut is never read as the end of a list.
  const after = text.slice(end, end + NEG_WINDOW) + (end + NEG_WINDOW < text.length ? '…' : '')
  if (NEGATED_SHORT.test(before.toLowerCase()) || NEGATED_AFTER.test(after.toLowerCase())) return true
  const b = reduceWindow(before, heads)
  const p = b.match(NEG_LIST_PLAIN)
  // With an "or" / "nor" / "/" in it, the list must not run into a new clause.
  if (p) return !/ (?:or|nor|\/) /.test(p[0]) || !NEG_LIST_THEN_VERB.test(reduceWindow(after, heads))
  const m = b.match(NEG_LIST_COMMA)
  if (!m) return false
  const a = reduceWindow(after, heads)
  // Closed before the term when an or/nor sits after the list's last comma.
  const tail = m[0].slice(m[0].lastIndexOf(',') + 1)
  return /(?:^| )(?:or|nor) /.test(tail) ? NEG_LIST_ENDS_HERE.test(a) : NEG_LIST_CLOSES_AFTER.test(a)
}

/** Does `text` name this entry at least once without negating it? */
function namesTerm(text, re, heads) {
  const g = new RegExp(re.source, 'gi')
  let m
  while ((m = g.exec(text))) {
    if (!isNegated(text, m.index, m.index + m[0].length, heads)) return true
  }
  return false
}

/** The list entries an idea names, not negated (distinct, in list order). */
export function techTermsIn(text, compiled) {
  const t = String(text || '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
  const heads = headMarker(compiled)
  return compiled.filter(c => namesTerm(t, c.re, heads)).map(c => c.term)
}

/** Workability = 1 / (1 + number of extra technologies named); null for no text. */
export function workability(text, compiled) {
  if (!String(text || '').trim()) return null
  return 1 / (1 + techTermsIn(text, compiled).length)
}

// ── Percentile ranks + the composite ────────────────────────────────────────

/**
 * Mid-rank percentile of every value in `values` among the non-null ones, in
 * [0, 1] (ties share their average rank; a pool of one gets 0.5). null stays null.
 * Used so two components on different scales (a cosine, a share of five facets)
 * weigh equally in the composite.
 */
export function percentileRanks(values) {
  const idx = []
  values.forEach((v, i) => { if (v != null && Number.isFinite(v)) idx.push(i) })
  const out = values.map(() => null)
  const n = idx.length
  if (!n) return out
  if (n === 1) { out[idx[0]] = 0.5; return out }
  const sorted = idx.slice().sort((a, b) => values[a] - values[b])
  let k = 0
  while (k < n) {
    let j = k
    while (j + 1 < n && values[sorted[j + 1]] === values[sorted[k]]) j++
    const mid = (k + j) / 2                   // 0-based mid-rank of the tie block
    for (let m = k; m <= j; m++) out[sorted[m]] = mid / (n - 1)
    k = j + 1
  }
  return out
}

/**
 * Usefulness score = mean of the available components' percentile ranks. If only
 * one component is present for an idea, it stands alone; none → null.
 */
export function usefulnessComposite(rankLists) {
  const n = rankLists.length ? rankLists[0].length : 0
  const out = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const vals = rankLists.map(l => l[i]).filter(v => v != null)
    if (vals.length) out[i] = vals.reduce((a, b) => a + b, 0) / vals.length
  }
  return out
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Compute every per-idea usefulness KPI from vectors already built.
 * @param ideaVecs   number[][] — one TF-IDF vector per idea (pool order; all zeros
 *                   or null for an idea with nothing to compare)
 * @param needVecs   number[][] — one vector per line of the need set U
 * @param texts      string[]   — the idea texts (for specificity and workability)
 * @param techTerms  the extra-technology list T (strings) for Workability
 * @returns { perIdea: [{ needFit, specificity, workability, usefulness, facets, tech }] }
 *   An idea that cannot be scored (isMeasurable false) gets null on every KPI.
 */
export function computeUsefulnessKpis(ideaVecs, needVecs, texts, techTerms = []) {
  const compiled = compileTerms(techTerms)
  const readable = texts.map(isMeasurable)
  const nf = ideaVecs.map((v, i) => (readable[i] ? needFit(v, needVecs) : null))
  const sp = texts.map((t, i) => (readable[i] ? specificity(t) : null))
  const wk = texts.map((t, i) => (readable[i] ? workability(t, compiled) : null))
  // The composite: the three components as percentile ranks, equally weighted.
  const comp = usefulnessComposite([percentileRanks(nf), percentileRanks(sp), percentileRanks(wk)])
  return {
    perIdea: ideaVecs.map((_, i) => ({
      needFit: nf[i], specificity: sp[i], workability: wk[i], usefulness: comp[i],
      facets: readable[i] ? specificityFacets(texts[i]) : null,
      tech: readable[i] ? techTermsIn(texts[i], compiled) : [],
    })),
  }
}

/**
 * The whole usefulness pipeline from TEXT, as the page runs it (the counterpart of
 * objectiveKpisFromText). Only readable ideas and non-empty need lines enter the
 * TF-IDF corpus, after contentText (stop words dropped, plurals folded), so an
 * unreadable idea cannot shift the IDF weights of the others.
 * @param ideaTexts string[]  one text per idea, in pool order
 * @param needTexts string[]  the need set U, one need per item
 * @param techTerms string[]  the extra-technology list T
 * @returns { error } | { perIdea, needs, measured, unmeasured }
 */
export function usefulnessKpisFromText(ideaTexts, needTexts, techTerms = []) {
  const needs = (needTexts || []).map(s => String(s ?? '').trim()).filter(t => contentText(t))
  if (!needs.length) return { error: 'The need set U is empty. Add the needs or problems people have (one per line).' }
  const texts = (ideaTexts || []).map(t => String(t ?? ''))
  const readable = texts.map(isMeasurable)
  // The corpus holds only ideas with a content word left after contentText: an idea
  // of filler words alone ("it is what it is") would enter as an EMPTY document and
  // still shift every IDF weight (N counts documents). It gets no need fit, but its
  // specificity and workability are still read from its text.
  const content = texts.map(t => contentText(t))
  const corpusIdx = texts.map((_, i) => i).filter(i => readable[i] && content[i])
  const { vectors } = tfidfVectors([...corpusIdx.map(i => content[i]), ...needs.map(contentText)])
  const ideaVecs = texts.map(() => null)
  corpusIdx.forEach((i, k) => { ideaVecs[i] = vectors[k] })
  const { perIdea } = computeUsefulnessKpis(ideaVecs, vectors.slice(corpusIdx.length), texts, techTerms)
  const measured = readable.filter(Boolean).length
  return { perIdea, needs, measured, unmeasured: texts.length - measured }
}

// ── Novelty × usefulness cross-check (pool level) ───────────────────────────

/** Pearson correlation over pairs where both are finite; null if < 3 pairs or constant. */
export function pearson(xs, ys) {
  const a = [], b = []
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] != null && ys[i] != null && Number.isFinite(xs[i]) && Number.isFinite(ys[i])) { a.push(xs[i]); b.push(ys[i]) }
  }
  if (a.length < 3) return null
  const ma = a.reduce((s, x) => s + x, 0) / a.length
  const mb = b.reduce((s, x) => s + x, 0) / b.length
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < a.length; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db }
  if (saa === 0 || sbb === 0) return null
  return sab / Math.sqrt(saa * sbb)
}

/**
 * Partial correlation of x and y holding z constant (all three present), from the
 * three pairwise Pearson rs. Used with z = log(1 + word count): longer ideas score
 * higher on most text measures (Forthmann et al. 2019), which can create or hide a
 * novelty-usefulness correlation, so the cross-check reports both. null if undefined.
 */
export function partialPearson(xs, ys, zs) {
  const x = [], y = [], z = []
  for (let i = 0; i < xs.length; i++) {
    const ok = [xs[i], ys[i], zs[i]].every(v => v != null && Number.isFinite(v))
    if (ok) { x.push(xs[i]); y.push(ys[i]); z.push(zs[i]) }
  }
  const rxy = pearson(x, y), rxz = pearson(x, z), ryz = pearson(y, z)
  if (rxy == null) return null
  if (rxz == null || ryz == null) return rxy            // z constant: nothing to hold fixed
  const d = Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz))
  return d > 1e-12 ? (rxy - rxz * ryz) / d : null
}

/** Median of the finite values; null if none. */
export function median(values) {
  const v = values.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/**
 * Classify ideas into the four novelty × usefulness quadrants, split at the POOL
 * medians (`novCut`, `useCut`): an idea is "high" on a measure when it is strictly
 * above that measure's median. Ideas missing either measure are skipped.
 * Returns { n, both, novelOnly, usefulOnly, neither } as counts.
 */
export function quadrantCounts(nov, use, novCut, useCut) {
  const out = { n: 0, both: 0, novelOnly: 0, usefulOnly: 0, neither: 0 }
  if (novCut == null || useCut == null) return out
  for (let i = 0; i < nov.length; i++) {
    const a = nov[i], b = use[i]
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue
    out.n++
    const hn = a > novCut, hu = b > useCut
    if (hn && hu) out.both++
    else if (hn) out.novelOnly++
    else if (hu) out.usefulOnly++
    else out.neither++
  }
  return out
}
