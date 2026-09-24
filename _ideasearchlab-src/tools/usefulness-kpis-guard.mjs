/**
 * usefulness-kpis-guard.mjs — offline test (no network, no deps).
 *
 *   node _ideasearchlab-src/tools/usefulness-kpis-guard.mjs
 *
 * Guards the Section 3.1 objective USEFULNESS KPIs (src/utils/usefulnessKpis.js)
 * and the one design rule they exist for (owner 2026-09): usefulness must mean
 * something different from novelty, so no usefulness KPI may be computed from the
 * novelty KPIs' anchor (the reference set R) or from their similarities. Checks:
 *   - each measure's arithmetic (Need fit, Specificity, Workability, the composite,
 *     the novelty × usefulness cross-check helpers),
 *   - Workability's negation rule, both directions: a technology the idea really
 *     uses is never hidden (every sentence the two 2026-09-24 reviews found
 *     hidden, plus fever-garment sentences of the same shapes, each rule also
 *     alone), a negated list is read ("no batteries, charging, or apps"), a
 *     negator more than 60 characters back does not count, pasted hyphen runs
 *     stay fast, and the cost grows no faster than the length of the idea,
 *   - that the composite does not move when only novelty moves,
 *   - the "idea with no words" rule the novelty side follows (objectiveKpis.js):
 *     such an idea is left blank on every usefulness KPI and kept out of the corpus,
 *   - that the default need set U does not reuse R's product words,
 *   - that every new KPI key is registered in every place a KPI must be for it to
 *     reach Section 4, the Rankings tab, the downloads, a re-import and the
 *     Python/R regressions (a KPI missing from one of them is dropped silently).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  needFit, specificity, specificityFacets, FACETS, percentileRanks, usefulnessComposite,
  compileTerms, techTermsIn, workability, computeUsefulnessKpis, usefulnessKpisFromText,
  pearson, partialPearson, median, quadrantCounts, contentText, foldPlural, STOP_WORDS,
} from '../src/utils/usefulnessKpis.js'
import { tfidfVectors } from '../src/utils/tfidf.js'
import { objectiveKpisFromText } from '../src/utils/objectiveKpis.js'
import { computeDeterministicKpis } from '../src/utils/deterministicKpis.js'
import {
  KPI_DEFS, COLUMNS, canonicalKpiField, normalizeImportedRows, buildRowsForSession,
  DEFAULT_REFERENCE_SET, DEFAULT_NEED_SET, DEFAULT_TECH_SET, stripAllKpis, scriptKpiKeys,
  exportKpiColumns,
} from '../src/utils/analyticsData.js'
import { aiUseKey, UNRECORDED } from '../src/utils/aiScoreColumns.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = p => readFileSync(join(here, '..', p), 'utf8')

let failures = 0
function check(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`); return }
  failures++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b, eps = 1e-9) => a != null && b != null && Math.abs(a - b) < eps

// ── Specificity ─────────────────────────────────────────────────────────────
console.log('Specificity — who / what / where-when / why / how')
{
  const full = 'Fever Onesie: a baby onesie that turns red when the baby has a fever, so parents can check at night without waking them.'
  const f = specificityFacets(full)
  check('a fully specified idea states all five parts', FACETS.every(x => f[x.key]), JSON.stringify(f))
  check('…and scores 1', specificity(full) === 1, String(specificity(full)))
  check('"Mood shirt" names only what it is (0.2)', near(specificity('Mood shirt'), 0.2), String(specificity('Mood shirt')))
  check('the verb "wear" is not a product ("easy to wear shirt" = what only)',
    near(specificity('easy to wear shirt'), 0.2), JSON.stringify(specificityFacets('easy to wear shirt')))
  check('"sportswear" counts as a product', specificityFacets('new sportswear line').what === true)
  check('vague fillers ("people", "anyone") do not count as WHO',
    specificityFacets('a shirt that anyone and all people can use').who === false)
  check('an idea with no text is null, not 0', specificity('') === null && specificity('   ') === null)
  // HOW counts only detail BEYOND the brief (and the worked example), or it fires for every idea.
  const how = t => specificityFacets(t).how
  check('HOW: restating the brief does not count', !how('A shirt that changes colour at body temperature') && !how('A vest, 37°C'))
  check('HOW: the worked example ("reveals a hidden pattern … body heat") does not count',
    !how('Body-Heat Reveal Tee: a t-shirt that reveals a hidden pattern wherever your body heat warms the fabric'))
  check('HOW: the colour it turns, a threshold other than 37, placement, construction, reset all count',
    how('a panel that turns red') && how('turns bright blue') && how('above 38 C') && how('a 39°C threshold') &&
    how('printed on the cuff') && how('goes back to white when cool'),
    ['a panel that turns red', 'above 38 C', 'a 39°C threshold', 'goes back to white when cool'].map(how).join())
  check('a facet counts once however many words hit it',
    near(specificity('baby child kid infant toddler'), 0.2), String(specificity('baby child kid infant toddler')))
}

// ── Workability ─────────────────────────────────────────────────────────────
console.log('Workability — 1 / (1 + extra technologies named)')
{
  const c = compileTerms(['app', 'battery', 'light up', 'sensor', 'ai', 'led'])
  check('no extra technology → 1', workability('A tee that reveals a pattern with body heat', c) === 1)
  check('one (an app) → 0.5', workability('A shirt linked to an app', c) === 0.5)
  check('plurals match ("apps", "batteries")', techTermsIn('apps and batteries', c).join() === 'app,battery',
    techTermsIn('apps and batteries', c).join())
  check('distinct entries count once ("app … app")', workability('an app, then another app', c) === 0.5)
  check('whole words only ("leading", "mapped", "paint" are not led / app / ai)',
    techTermsIn('leading brand, mapped path, paint', c).length === 0, techTermsIn('leading brand, mapped path, paint', c).join())
  check('a phrase matches with a hyphen ("light-up")', techTermsIn('a light-up sock', c).join() === 'light up')
  check('three technologies → 0.25', workability('sensors feed an AI app', c) === 0.25)
  check('no text → null', workability('', c) === null)
  check('the default list compiles and flags a typical gadget idea',
    workability('A bluetooth patch with a battery that sends data to an app', compileTerms(DEFAULT_TECH_SET)) === 0.2,
    String(workability('A bluetooth patch with a battery that sends data to an app', compileTerms(DEFAULT_TECH_SET))))
  // The worked example participants saw ends "no electronics needed": copying it
  // must read as needing LESS technology, not as naming electronics.
  const T = compileTerms(DEFAULT_TECH_SET)
  check('the worked example ("… no electronics needed") needs no extra technology',
    workability('Body-Heat Reveal Tee: a t-shirt that reveals a hidden pattern wherever your body heat warms the fabric, shifting as you move — no electronics needed.', T) === 1)
  const neg = [
    ['without batteries or apps', []], ['battery-free patch', []], ['does not need a battery', []],
    ["doesn't require sensors or LEDs", []], ['works without any extra electronics', []],
    ['an app, no batteries', ['app']], ['No app. It has a sensor', ['sensor']], ['a sensor-free led strip', ['led']],
  ]
  for (const [t, want] of neg) {
    const got = techTermsIn(t, c.concat(compileTerms(['electronics'])))
    check(`negation: "${t}" → [${want.join(', ')}]`, got.join() === want.join(), got.join())
  }
  // A negated LIST (owner's data, 2026-09-24): the negation reaches every item,
  // not only the first — "it removes the battery or Bluetooth wearable device"
  // was scored as needing both. Each phrasing below is from, or shaped like, a
  // real idea in the owner's 741-idea dataset; the "must still count" ones pin
  // the other side, so the rule cannot drift into swallowing real technology.
  const lists = [
    ['it removes the battery or Bluetooth wearable device', []],
    ['no battery or Bluetooth needed', []],
    ['without a battery or an app', []],
    ['no need for App or charging', []],
    ['requires no electronic sensors or batteries', []],
    ['without using an electronic sensor', []],
    ['without requiring batteries, electronics, or a phone', []],
    ['without electronic sensors, apps or charging', []],
    ['without adding sensors or electronics', []],
    ['works without batteries, screens or uncomfortable electronic sensors', []],
    ['without an app, battery, or electronic temperature sensor', []],        // Oxford comma
    ['without constantly checking an electronic device', []],                // adverb + -ing
    ['requiring no batteries, charging, or apps', []],
    // must still count — including every case the 2026-09-24 review found the
    // first version of this rule swallowing (a negation leaking past its clause)
    ['there is no delay and the app alerts parents', ['app']],
    ['no delay, the app alerts parents', ['app']],
    ['It does not look like a watch, and the app shows it', ['app']],
    ['not only the app but also a sensor', ['app', 'sensor']],
    ['uses a battery and an app', ['app', 'battery']],
    ['It is not expensive. The app shows data', ['app', 'data']],
    ['replaces a thermometer with an app', ['app']],
    ['A sensor with no app', ['sensor']],
    ['It replaces manual checks using an app.', ['app']],
    ['Eliminates guesswork through an app.', ['app']],
    ['It is not expensive because the app is free.', ['app']],
    ['Parents no longer worry because the app sends a notification.', ['app', 'notification']],
    ['No false alarms because the algorithm filters noise.', ['algorithm']],
    ['It never fails since the sensor is sewn in.', ['sensor']],
    ['The baby is never cold or hot because a sensor adjusts the heater.', ['heater', 'sensor']],
    ['no app, a sensor measures it', ['sensor']],
    ['Replaces thermometers via a Bluetooth sensor.', ['bluetooth', 'sensor']],
    ['no wires, just an app', ['app']],
    ['without waiting, the sensor reads the heat', ['sensor']],
  ]
  // Compared on the terms that are on the default list T (e.g. "heater" is).
  const expectTerms = (label, rows) => {
    for (const [t, want] of rows) {
      const w = want.filter(x => T.some(c => c.term === x)).sort()
      const got = techTermsIn(t, T).slice().sort()
      const shown = t.replace(/\r/g, '\\r').replace(/\n/g, '\\n')      // a line break stays on one line
      check(`${label}: "${shown}" → [${w.join(', ')}]`, got.join() === w.join(), got.join())
    }
  }
  expectTerms('negated list', lists)

  // PRECISION FIRST (review of 2026-09-24, findings P1–P5, P21, P41): each sentence
  // below names technology the idea really uses, and the first list rule hid it,
  // lifting the idea's Workability to 1. A real technology must never be hidden.
  expectTerms('must count (P1: only a closed list of -ing verbs carries "without")', [
    ['The shirt can be washed without damaging the sensor.', ['sensor']],
    ['It lasts all night without draining the battery.', ['battery']],
    ['The child can move freely without disturbing the sensor under the arm.', ['sensor']],
    ['Kids can play without breaking the LED strip in the sleeve.', ['led']],
    ['It runs for months without recharging the battery.', ['battery']],
  ])
  expectTerms('must count (P2, P21, P41: a comma closes the negated phrase)', [
    ['Instead of an app, the LED turns red or amber when the baby passes 37°C.', ['led']],
    ['Rather than an app, the LED blinks red or orange at 37°C.', ['led']],
    ['No Bluetooth, the LED blinks red or blue when the fabric reaches 37°C.', ['led']],
    ['No app, the sensor turns the patch red or green.', ['sensor']],
    ['Without WiFi, the app still works offline or syncs later.', ['app', 'syncs']],
    ['Without Wi-Fi or Bluetooth, the sensor stores readings locally.', ['sensor']],
    ['no battery or app, a sensor measures it', ['sensor']],
    ['without a battery or sensor, the app alerts parents', ['app']],
    ['No wires or batteries, the app shows the temperature', ['app']],
    ['It needs no battery or charging, an app sends the alert', ['app']],
    ['No app, a sensor or an LED shows the warning', ['sensor', 'led']],
    ['Without a battery, the sensor or the app alerts parents', ['sensor', 'app']],
    ['without batteries or charging, a Bluetooth chip sends data to the app', ['app', 'bluetooth', 'chip', 'data']],
    ['No need for batteries or charging, the app shows the temperature history.', ['app']],
    ['No battery or charger, an app sends a notification to parents.', ['app', 'notification']],
    ['Without charging, the LED or the app alerts the nurse.', ['app', 'led']],
    ['No battery or sensor, an app does the work instead.', ['app']],
    ['Without batteries or wires, the app alerts the parent.', ['app']],
    ['There is no wifi or bluetooth, so the app syncs later.', ['app', 'syncs']],
    ['No wires or batteries, an app with a camera reads the shirt colour.', ['app', 'camera']],
    ['It has no battery or chip; the app reads the colour from a photo.', ['app']],
  ])
  expectTerms('must count (P3: "or" meaning "or else", "no matter", "no wire means")', [
    ['Do not tumble dry or the battery inside the collar may be damaged.', ['battery']],
    ['Do not tumble dry the shirt or the battery inside the collar may be damaged.', ['battery']],
    ['Do not machine wash or the sensor in the cuff will stop working.', ['sensor']],
    ['Do not iron or the LEDs along the hem will melt.', ['led']],
    ['Never tumble dry or the chip in the label will break.', ['chip']],
    ['If the shirt shows no change or the app alarm stays silent, the child is fine.', ['app']],
    ['No wire means the sensor stays hidden in the seam.', ['sensor']],
    ['No matter what the sensor reads, the fabric changes colour at 37°C.', ['sensor']],
    ['No matter how the app is set up, the shirt changes colour at 37°C.', ['app']],
  ])
  expectTerms('must count (P4: "replace" / "remove" as upkeep, by a person or an order)', [
    ['Parents replace the coin battery once a year.', ['battery']],
    ['Remove the sensor before washing the shirt at 30 degrees.', ['sensor']],
    ['Simply remove the battery pack and throw the shirt in the wash.', ['battery']],
    ['Just replace the battery when the LED starts to dim.', ['battery', 'led']],
  ])
  expectTerms('must count (P5: "no-" / "zero-" compounds and a spaced dash)', [
    ["A no-contact sensor in the collar reads the child's temperature.", ['sensor']],
    ['No-touch sensors in the cuffs track the fever all night.', ['sensor']],
    ['A no-sew sensor pocket keeps the chip in place.', ['sensor', 'chip']],
    ['A no-hassle app shows parents the temperature history.', ['app']],
    ['Zero-waste LED strips line the hem and glow at 37°C.', ['led']],
    ['No thermometer - the sensor in the fabric does the work.', ['sensor']],
    ['No guessing - the app shows the exact temperature.', ['app']],
    ['No fuss: the app pings you at 37°C.', ['app']],
    ['No batteries are needed; the sensor harvests body heat.', ['sensor']],
    ['It is not bulky or heavy, and the app is free to download.', ['app']],
    ['Not only the fabric but also the LED changes colour.', ['led']],
    ['The dye has no toxic chemicals and the sensor is sealed.', ['sensor']],
    ['It replaces manual checks using an app that reads the sensor.', ['app', 'sensor']],
    ['The shirt never overheats since the sensor cuts power early.', ['sensor']],
  ])
  // More of the same, written for this study's brief (a garment or patch that
  // changes colour at 37°C): every one names technology the idea keeps.
  expectTerms('must count (fever garment)', [
    ['The patch has no battery or the sensor would overheat against the skin.', ['sensor']],
    ['It also works without the app, which keeps a fever log for the doctor.', ['app']],
    ['Without the app, parents still see the collar turn red at 37°C.', ['app']],
    ['It is not the app that warns parents but the red sleeve.', ['app']],
    ['Without a fever, the patch stays white, but the LED blinks once an hour.', ['led']],
    ['With no delay, the app pings parents when the patch turns red.', ['app']],
    ['No batteries to replace: the patch uses an NFC chip read by a phone.', ['nfc', 'chip']],
    ['No wires, the patch talks to the app over Bluetooth.', ['app', 'bluetooth']],
    ['There is no screen; the app shows the reading.', ['app']],
    ['The collar has no buttons or switches, and the sensor turns on by itself.', ['sensor']],
    ['It has no cables or plugs and the battery charges wirelessly.', ['battery']],
    ['It never needs charging, but the LED indicator runs on a coin battery.', ['led', 'battery']],
    ['Instead of guessing, parents see the LED glow red at 37°C.', ['led']],
    ['Rather than waking the baby, parents check the app.', ['app']],
    ['Without waking the baby, the app shows the temperature.', ['app']],
    ['Without waking the baby or using a thermometer, parents see the LED turn red.', ['led']],
    ['It replaces the old battery with a solar panel sewn into the hem.', ['solar panel']],
    ['It removes the guesswork: the LED glows red above 37°C.', ['led']],
    ['It eliminates false alarms because the sensor checks twice.', ['sensor']],
    ["Kids won't notice the sensor sewn into the cuff.", ['sensor']],
    ["Parents don't have to guess: the app shows the fever.", ['app']],
    ['No one has to check the app; it buzzes at 37°C.', ['app']],
    ['Neither parent has to wake up because the app alerts them.', ['app']],
    ['Zero false alarms thanks to the sensor in the armpit seam.', ['sensor']],
    ['Free of charge, the app lets parents track the fever.', ['app']],
    ['Instead of a thermometer, the shirt uses a sensor in the collar.', ['sensor']],
    ['Rather than an app or a screen, the patch has an LED that turns red.', ['led']],
    ['Instead of an app, an LED or a buzzer warns parents at 37°C.', ['led', 'buzzer']],
    ['No app or LED is needed, since the dye turns red; a sensor tag is optional.', ['sensor']],
    ['It works without batteries or apps, but a sensor tag can be added.', ['sensor']],
    ['With no app, a Bluetooth chip or an NFC tag does the job.', ['bluetooth', 'chip', 'nfc']],
    ['Do not remove the battery or the LED will stop blinking.', ['battery', 'led']],
    ['Never iron the patch or the sensor will crack.', ['sensor']],
    ['The no-battery claim is false: a tiny coin battery powers the LED.', ['battery', 'led']],
    ['A no-app design still needs a sensor to trigger the dye.', ['sensor']],
    ['It needs no app, yet a sensor inside checks the skin every minute.', ['sensor']],
    ['Unlike the old sensor, this one is washable and syncs to the app.', ['sensor', 'syncs', 'app']],
    ['Unlike other patches, it uses a Bluetooth chip to alert the app.', ['bluetooth', 'chip', 'app']],
    ['An app free of ads shows the fever curve.', ['app']],
    ['No two sensors read the same, so the app averages them.', ['sensor', 'app']],
    ['There is no other sensor like it on the market.', ['sensor']],
    ['It works with or without the app, and the LED blinks at 37°C.', ['app', 'led']],
    ['Parents need not open an app because the LED turns red.', ['app', 'led']],
    ['There is no doubt sensors will make it more accurate.', ['sensor']],
    ['No matter which sensor you pick, the dye turns red at 37°C.', ['sensor']],
    ['No parent needs an app to read the patch.', ['app']],
    ['No false alarm - the sensor double-checks at 37°C.', ['sensor']],
    ['No thermometer—the sensor in the seam does the work.', ['sensor']],
    ['No thermometer (the sensor in the seam does the work).', ['sensor']],
    ['No battery, but an app and a sensor.', ['app', 'sensor']],
    ['No battery means sensors stay light and thin.', ['sensor']],
  ])

  // The same guards one at a time: in most sentences above two of them stand in the
  // way, so each of these fails if just ONE guard is taken out.
  expectTerms('must count (one guard at a time)', [
    // an -ing verb that is not "using / needing / …" ends the reach
    ['It glows all night without draining a coin battery.', ['battery']],
    ['Children can run around without dislodging any sensor.', ['sensor']],
    // an "or" before the list's last comma does not close it
    ['Without Wi-Fi or Bluetooth, a sensor, a dye patch and a strap do the work.', ['sensor']],
    // "not" / "never" do not start a list
    ['Do not remove batteries or chips will reset.', ['battery', 'chip']],
    ['Never tug cables or sensors may come loose.', ['sensor']],
    // an item must end in a term of T or a kit noun ("change" is neither)
    ['If the patch shows no change or app alerts stay quiet, the baby is fine.', ['app']],
    ['If the sleeve shows no rash or app alarm, the child is fine.', ['app']],
    // a later "or" item that runs straight into a verb starts a new clause
    ['It needs no battery or an LED would dim.', ['led']],
    ['The patch has no battery or a sensor could overheat.', ['sensor']],
    ['No wires or sensors stay hidden in the seam.', ['sensor']],
    ['It has no screen or an electronic tag logs the fever.', ['electronic']],
    // a window cut short (here exactly 60 characters after "sensor") is not an end
    ['No app, a sensor or an ultra-mega-bright-orange super-high-contrast-mini LED shows the warning.', ['sensor', 'led']],
  ])

  // SECOND REVIEW (2026-09-24). A preposition or a "no" that OPENS its clause, then
  // a comma: the comma usually closes the negated phrase, and what follows is the
  // subject of the sentence. Every sentence here was hidden by the first rewrite.
  expectTerms('must count (a clause-opening negator + a comma list)', [
    ['Instead of a bulky thermometer, a small sensor or an LED, hidden in the collar, alerts parents at 37°C.', ['sensor', 'led']],
    ['Without a smartphone, a buzzer or an LED, built into the patch, tells the nurse.', ['buzzer', 'led']],
    ['Instead of a screen, a vibration motor or buzzer is needed to wake the parent.', ['vibration', 'motor', 'buzzer']],
    ['Rather than a thermometer, a sensor or an LED, placed in the armpit seam, flags the fever.', ['sensor', 'led']],
    ['Unlike thermometers that need batteries, a sensor or chip, woven into the fabric, reads the heat.', ['sensor', 'chip']],
    ['Free from wires, a chip or sensor, woven into the sleeve, reads the heat.', ['chip', 'sensor']],
    ['Without Wi-Fi, Bluetooth or NFC is needed to send the alert.', ['bluetooth', 'nfc']],
    ['Instead of an app, an LED or a buzzer is included to alert parents.', ['led', 'buzzer']],
    ['Instead of an app, an LED or a buzzer, sewn into the collar, warns parents.', ['led', 'buzzer']],
    ['Instead of a battery, a solar panel or USB cable is required.', ['solar panel']],
    ['Rather than an app, an LED or buzzer - cheap and simple - alerts parents.', ['led', 'buzzer']],
    ['Without an app, a sensor or LED, powered by a coin cell, warns the nurse.', ['sensor', 'led']],
    ['Instead of Wi-Fi, Bluetooth or NFC is required, and the app shows the fever.', ['bluetooth', 'nfc', 'app']],
    ['No app, a sensor or an LED, sewn into the cuff, shows the warning.', ['sensor', 'led']],
    ['Rather than an app, a buzzer or LED is included in the collar.', ['buzzer', 'led']],
    ['Rather than a thermometer, an LED or a buzzer - both cheap - warns parents.', ['led', 'buzzer']],
    ['Without Wi-Fi, NFC or Bluetooth is required for syncing.', ['nfc', 'bluetooth']],
    // fever garment, the same shapes
    ['No app, sensors or LEDs, sewn into the cuff, alert parents.', ['sensor', 'led']],
    ['Instead of a thermometer, a sensor or an LED, the size of a coin, alerts parents.', ['sensor', 'led']],
    ['Rather than an app or a screen, a buzzer or an LED, stitched into the hem, warns the nurse.', ['buzzer', 'led']],
    ['Instead of a thermometer or an app, a sensor, a buzzer or an LED is sewn into the sleeve.', ['sensor', 'buzzer', 'led']],
    ['Unlike patches that rely on apps, a chip or a sensor, placed in the seam, reads the heat.', ['chip', 'sensor']],
    ['At night, without a screen, a buzzer or an LED, hidden in the collar, wakes the parent.', ['buzzer', 'led']],
    ['Without a charger, a solar panel or a coin battery, sewn into the hem, powers the LED.', ['solar panel', 'battery', 'led']],
    ['Instead of a phone, a buzzer or vibration motor is included in the cuff.', ['buzzer', 'vibration', 'motor']],
    ['Free of wires, a sensor or a chip, printed on the fabric, detects the fever.', ['sensor', 'chip']],
    ['No screen, sensors or chips, built into the lining, detect the heat.', ['sensor', 'chip']],
    ['Without an app, a Bluetooth chip or an NFC tag, read by a phone, logs the fever.', ['bluetooth', 'chip', 'nfc']],
    ['Instead of a battery, a solar panel or kinetic charger, woven into the sleeve, powers the sensor.', ['solar panel', 'charger', 'sensor']],
    ['Instead of a phone app, a baby camera or a very loud buzzer, sewn into the collar, wakes the parent.', ['camera', 'buzzer']],
    // a pronoun or a "just / so …" that starts an aside is not a new clause
    ['Rather than a thermometer, a sensor or an LED, we think, works best.', ['sensor', 'led']],
    ['Without a thermometer, sensors or LEDs, we are told, alert parents.', ['sensor', 'led']],
    ['No thermometer, sensors or LEDs, just like before, alert parents.', ['sensor', 'led']],
    ['No screen, sensors or chips, so small they are invisible, alert the nurse.', ['sensor', 'chip']],
    ['Instead of an app, an LED or a buzzer - it is cheap - alerts parents.', ['led', 'buzzer']],
    ['No app, sensors or LEDs - just tiny ones - alert parents.', ['sensor', 'led']],
    // "with no" is a preposition like "without"
    ['With no wires, sensors or LEDs, hidden in the collar, alert parents.', ['sensor', 'led']],
  ])
  // Each of these stands on ONE of the new rules, so taking that rule out fails it.
  expectTerms('must count (one new rule at a time)', [
    // "instead of" / "rather than" name the substitute: a fragment is not a negation
    ['Instead of an app, an LED or a buzzer.', ['led', 'buzzer']],
    // a bare "no" does not reach an item with "a / an" after a comma
    ['No app, a sensor or an LED.', ['sensor', 'led']],
    ['It needs no app, a sensor or an LED.', ['sensor', 'led']],
    ['No thermometer, a sensor or an LED is needed.', ['sensor', 'led']],
    ['No thermometer, sensors or an LED is needed.', ['sensor', 'led']],
    ['With no app, a sensor or an LED.', ['sensor', 'led']],
    // a preposition's list never runs into "is needed" (with or without a comma)
    ['Without Wi-Fi or Bluetooth is needed to send the alert.', ['bluetooth']],
    ['It works without a cable, Bluetooth or NFC is required.', ['bluetooth', 'nfc']],
    // a line break ends the clause
    ['Idea 3\nNo app\nBluetooth sensor tag clips onto the sleeve', ['bluetooth', 'sensor']],
    ['Key points\nNo app\nLED blinks red at 37C', ['led']],
    ['No wires\nBluetooth sensor inside the cuff sends the reading.', ['bluetooth', 'sensor']],
    ['No batteries\nSolar panel on the sleeve powers the LED', ['solar panel', 'led']],
    ['Without batteries\r\nSensor strip in the collar reads the heat', ['sensor']],
    // "removes / replaces / gets rid of" with a person as the subject is upkeep
    ['The nurse replaces the battery every week.', ['battery']],
    ['Dad removes the sensor before washing.', ['sensor']],
    ['She replaces the coin battery each month.', ['battery']],
    ['The clinic removes the chip before the sleeve is washed.', ['chip']],
    ['The nurse gets rid of the sensor after each patient.', ['sensor']],
    ['The nurse eliminates the sensor readings that look wrong.', ['sensor']],
    // "removes … from" moves it
    ['The shirt has a pocket, which removes the sensor from direct skin contact.', ['sensor']],
    // an upkeep noun after the term, reached through a verb or a lead-in
    ['It lasts a year, eliminating battery changes.', ['battery']],
    ['It works without having a battery change for a year.', ['battery']],
    ['It does not need battery replacements for two years.', ['battery']],
    ["It won't need battery swaps.", ['battery']],
    ['There is no need for sensor calibration or battery swaps.', ['sensor', 'battery']],
    // "no ordinary / simple …" and "no risk / chance …" do not negate what follows
    ['It is no ordinary sensor: it changes colour.', ['sensor']],
    ['This is no simple app, it predicts fever.', ['app']],
    ['There is no risk sensor data leaks.', ['sensor', 'data']],
    ['There is no chance the sensor misses a fever.', ['sensor']],
    // "whether or not" negates nothing
    ['The patch works whether or not Bluetooth is on.', ['bluetooth']],
    // "the app free" is at no cost; "battery free" with no determiner is no battery
    ['Parents download the app free.', ['app']],
    ['Get the app free today and pair it with the patch.', ['app']],
    ['It is battery free and turns red at 37°C.', []],
  ])
  // A known miss, kept on purpose (P6): "no need to charge a battery" is also said of
  // a device whose battery simply lasts, and "open" an app is not a using verb, so
  // both stay counted. Precision first: an unclear case counts its technology.
  expectTerms('known miss (counted on purpose)', [
    ['There is no need to charge a battery or open an app.', ['battery', 'app']],
  ])

  // The other direction (P6): phrasings that DO say the idea needs none of it,
  // read through closed phrases ("having to use", "relying on", "the help of",
  // "no longer need", "neither … nor") rather than open word classes.
  expectTerms('must negate (P6)', [
    ['Without having to use an app, parents can see the fever.', []],
    ['It works without the help of any sensor.', []],
    ['It does not rely on an app or Bluetooth.', []],
    ['Parents no longer need a thermometer or an app.', []],
    ['The design has no electronic parts, sensors or apps.', []],
    ['It needs neither an app nor a battery.', []],
    ['It works without batteries or using an app.', []],
    ['It needs no battery or app to work.', []],
    ['No batteries or sensors are required.', []],
    ['No wire, chip or battery is needed.', []],
    ["Parents won't need an app or a thermometer.", []],
    ["You don't need any app or battery.", []],
    ['No app, no battery, no sensor.', []],
    ['It works with no app, battery, or charger.', []],
    ['It works without an app, a battery or an electronic sensor.', []],
    ['It needs no Wi-Fi, no app and no battery.', []],
    ['No wires or LEDs are used anywhere in the shirt.', []],
    ['It does not use any LED, sensor or chip.', []],
    ['It works without using any app or wireless connection.', []],
    ['There are no sensors, chips, or batteries inside.', []],
  ])
  expectTerms('must negate (fever garment)', [
    ['The patch needs no battery, no app and no Bluetooth.', []],
    ['It works without batteries, wires or a phone.', []],
    ['No electronics needed: the dye turns red at 37°C.', []],
    ['A battery-free patch that turns red at 37°C.', []],
    ['Parents do not need an app or a thermometer to spot a fever.', []],
    ["It doesn't use any sensors or LEDs; the fabric does the work.", []],
    ['Unlike smart patches that rely on Bluetooth, it just changes colour.', []],
    ['Unlike thermometers that need batteries, the sleeve changes colour at 37°C.', []],
    ['It needs neither an app nor a charger.', []],
    ['There is no need for an app, a battery or a sensor.', []],
    ['The sleeve works without using any electronic sensor.', []],
    ['It works without the help of any app.', []],
    ['Without having to wear a smartwatch, athletes see their heat map.', []],
    ['It removes the need for a thermometer or an app.', []],
    ['Zero batteries, zero apps, zero charging.', []],
    ['No wires/batteries needed.', []],
    ['Instead of using an app, parents glance at the collar.', []],
    ['Rather than relying on Bluetooth, the patch simply turns red at 37°C.', []],
    ['It works with no charging, no pairing and no app.', []],
    ['No sensors, chips, or batteries are inside the patch.', []],
    ['The patch contains no electronic parts, sensors or batteries.', []],
    ['It never needs a battery or a charger.', []],
    ['It does not rely on Wi-Fi or Bluetooth.', []],
    ['Without waking the child or using a thermometer or an app, parents see the fever.', []],
    ['It is not an app but a sleeve that turns red at 37°C.', []],
    ['A no-app, no-battery fever patch.', []],
    ['It gets rid of the battery and turns red on its own.', []],
    ['It replaces the electronic thermometer with dyed fabric.', []],
    ['Free from batteries: the dye does the work.', []],
  ])
  // What the stricter comma rule must still read as a negated list: a clause-opening
  // negator whose list ends where a new clause clearly starts (a subject, or after
  // "no" also "just / so …", ":" or "needed"), and every list in the middle of a clause.
  expectTerms('must negate (a comma list that ends where a new clause starts)', [
    ['Without batteries, wires or sensors, it is cheap.', []],
    ['Without batteries, apps or sensors, the patch is cheap to make.', []],
    ['Without Wi-Fi, Bluetooth or NFC, the shirt still works.', []],
    ['Free from batteries, apps or sensors, it is safe for babies.', []],
    ['Unlike thermometers that need batteries, apps or sensors, it simply changes colour.', []],
    ['The patch warns parents, and without batteries, apps or sensors, it stays light.', []],
    ['It is washable because, without batteries, chips or sensors, there is nothing to break.', []],
    ['Without having to use an app, a battery or a sensor, parents see the fever.', []],
    ['Instead of using an app, a battery or a sensor, parents glance at the collar.', []],
    ['Rather than relying on an app, a battery or a sensor, the patch simply turns red.', []],
    ['Unlike smart patches that need an app, a battery or Bluetooth, the dye does the work.', []],
    ['Without batteries, apps or sensors - it is washable.', []],
    ['No app, Bluetooth or Wi-Fi is required.', []],
    ['No batteries, sensors or apps, just dye that turns red at 37°C.', []],
    ['No batteries, sensors or apps, just dye that turns red, so parents know at a glance.', []],
    ['Without any app, battery or sensor needed, the patch turns red at 37°C.', []],
    ['With no app, battery or sensor, it is safe for newborns.', []],
    ['No batteries, sensors or apps: the fabric does the work.', []],
    ['No app, sensors or LEDs.', []],
    ['Zero batteries, sensors or apps, so it is safe for newborns.', []],
    ['It changes colour at 37°C, without an app, battery, or electronic temperature sensor.', []],
    ['It turns red at 37°C, without batteries, apps or sensors.', []],
    ['A sleeve that turns red at 37°C, free of batteries, apps or sensors.', []],
    ['It works without an app, a battery, or a sensor, so it is cheap.', []],
    ['There are no batteries, sensors, or apps in the sleeve.', []],
    ['It works without any battery, chip or sensor in the fabric.', []],
    ['Parents no longer need a thermometer, an app or a charger.', []],
    ['The patch needs no app, battery or sensor, which keeps it cheap.', []],
    ['The sleeve turns red at 37°C, with no app, battery, or sensor involved.', []],
    ['It needs no Bluetooth, NFC or Wi-Fi, making it safe for newborns.', []],
    ['Ditching the battery or the app, the patch simply turns red.', []],
    ['Key points\nWithout an app, a battery or a sensor\nWashable at 40°C', []],
    // "zero battery life" means no battery (owner's data): a bare "no / zero" keeps
    // an upkeep noun negated, only a verb or a lead-in lets it through
    ['It becomes a coaching tool, with zero electronics and zero battery life to manage.', []],
    // the owner's own sentences, in full: the window before the last term starts
    // inside the word before "without", so what precedes it is read from the text
    ['The playful design reduces children\'s anxiety. It works without batteries, screens or uncomfortable electronic sensors.', []],
    ['The blanket warms up at night. It works continuously without an app, battery, or electronic temperature sensor.', []],
    ['It provides a simple visual warning of possible fever without requiring batteries, electronics, or a smartphone.', []],
    ['The fabric provides real-time feedback without electronic sensors, apps or charging and returns to its original colour.', []],
  ])
  // The same window edge for "rather than": in the middle of a clause it negates its
  // whole list, so reading an unknown start as "opens the clause" would be wrong.
  {
    const s = 'Parents see the warning on the collar rather than a phone app, a baby camera or a very loud buzzer.'
    const d = s.indexOf('buzzer') - s.indexOf('rather')
    check(`mid-clause "rather than" at the window's edge (${d} characters back) negates its whole list`,
      d > 50 && d <= 60 && /[a-z]/.test(s[s.indexOf('buzzer') - 61]) && techTermsIn(s, T).length === 0, techTermsIn(s, T).join())
  }
  // A real idea from the owner's 741 (PnSzJyM52e07j6TyswqO): it says four times that
  // it needs no electronics, and the first list rule still counted three terms.
  {
    const idea = "Fever Guard Sleepwear: A set of pajamas that changes color in areas where the wearer's skin temperature reaches or exceeds 37°C. During sleep, caregivers or parents can quickly identify if someone may have a fever without waking them or using electronic sensors. The fabric uses thermochromic dye, requiring no batteries, charging, or apps. Unlike smart wearables that rely on electronics, it offers a simple, affordable, and washable first-level health indicator.\nWhy it's unique:\nIt provides passive fever monitoring without electronics, making it ideal for children, elderly people, and hospitals"
    const got = techTermsIn(idea, T)
    check('the owner\'s "Fever Guard Sleepwear" idea needs no extra technology (Workability 1)',
      got.length === 0 && workability(idea, T) === 1, got.join())
  }
  // The 60-character window (P27): a negator further back than that does not reach
  // the term, even at the end of a list that would otherwise carry it.
  {
    const near = 'It works without app, app, app, or sensor.'
    const far = 'It works without app, app, app, app, app, app, app, app, app, app, or sensor.'
    const dist = far.indexOf('sensor') - far.indexOf('without')
    check('a list within the window negates its last item', techTermsIn(near, T).length === 0, techTermsIn(near, T).join())
    check(`a negator ${dist} characters back (> 60) does not negate the term`,
      dist > 60 && techTermsIn(far, T).join() === 'sensor', techTermsIn(far, T).join())
  }
  // Bounded (P7): the grammar splits any text one way only, so pasted separator
  // lines and hyphen runs cannot make it backtrack. The first version took 68–355 ms
  // on ONE such window and about 1 s per 700 characters of them (10 s for 10,350).
  {
    const hy = n => '-'.repeat(n)
    techTermsIn('no battery or sensor, app, electronic, charging, or LED.', T)   // compile once first
    const inputs = [
      ['one hyphen-run window', 'no ' + hy(56) + ',app'],
      ['hyphen runs, 690 characters', ('no ' + hy(56) + ',app-free ').repeat(10)],
      ['hyphen runs, 10,350 characters', ('no ' + hy(56) + ',app-free ').repeat(150)],
      ['hyphenated words', 'without ' + 'a-'.repeat(26) + ',app'],
      ['"or" chains', ('no ' + 'x-a-a or '.repeat(6) + ',app ').repeat(200)],
      ['a 6,000-character list', 'no battery or sensor, app, electronic, charging, '.repeat(120)],
      ['a pasted separator line', 'Unique feature: no app ' + hy(45) + ' Idea 2: a sensor patch'],
    ]
    let worst = 0
    for (const [label, text] of inputs) {
      let ms = Infinity
      for (let k = 0; k < 3; k++) { const t0 = performance.now(); techTermsIn(text, T); ms = Math.min(ms, performance.now() - t0) }
      worst = Math.max(worst, ms)
      check(`fast on ${label} (${ms.toFixed(1)} ms)`, ms < 25)
    }
    check(`the dashed separator ends the clause ("no app ---- Idea 2: a sensor patch" keeps the sensor)`,
      techTermsIn(inputs[6][1], T).join() === 'sensor', techTermsIn(inputs[6][1], T).join())
    // The costliest honest input: every one of hundreds of mentions negated, so each
    // is read in full. The cost grows in step with the length (about 2 µs a
    // character), never faster: 4 times the text may take at most about 4 times as long.
    const best = text => {
      let ms = Infinity
      for (let k = 0; k < 5; k++) { const t0 = performance.now(); techTermsIn(text, T); ms = Math.min(ms, performance.now() - t0) }
      return ms
    }
    const dense = n => 'no app/battery/sensor/chip/led/app/app/app, without an app, a battery or a sensor. '.repeat(n)
    const small = best(dense(12)), large = best(dense(48))
    check(`fully negated, ${dense(48).length.toLocaleString('en')} characters: grows linearly (${small.toFixed(1)} ms → ${large.toFixed(1)} ms for 4× the text)`,
      large < 25 && large < 8 * Math.max(small, 0.5))
  }
}

// ── Percentile ranks + composite ────────────────────────────────────────────
console.log('Percentile ranks and the Usefulness score')
{
  const pr = percentileRanks([0.1, 0.5, 0.5, null, 0.9])
  check('mid-ranks in [0,1], ties share a rank, null stays null',
    pr[0] === 0 && pr[1] === 0.5 && pr[2] === 0.5 && pr[3] === null && pr[4] === 1, JSON.stringify(pr))
  check('a single value gets 0.5', percentileRanks([null, 3])[1] === 0.5)
  const comp = usefulnessComposite([[0, 1, null], [1, null, null]])
  check('composite = mean of the available ranks; none → null',
    comp[0] === 0.5 && comp[1] === 1 && comp[2] === null, JSON.stringify(comp))
}

// ── Need fit + the independence rule ────────────────────────────────────────
console.log('Need fit — anchored on U, never on R')
{
  const ideas = [
    'Fever onesie: a baby onesie that turns red when the baby has a fever so parents notice at night',
    'Aura dress: a dress that changes colour to express your cosmic aura',
  ]
  const needs = ['spot a fever early in a baby or young child at night', 'let people express how they feel']
  const v = tfidfVectors([...ideas, ...needs].map(contentText)).vectors
  const nf = [needFit(v[0], v.slice(2)), needFit(v[1], v.slice(2))]
  check('the fever idea fits a need better than the aura idea', nf[0] > nf[1], JSON.stringify(nf))
  check('an empty U → null', needFit(v[0], []) === null)
  check('contentText drops stop words and keeps content words',
    contentText('A shirt that shows when the baby is hot') === 'shirt baby hot', contentText('A shirt that shows when the baby is hot'))
  check('contentText folds plurals ("pets" = "pet", "babies" = "baby", "patches" = "patch"; "bus" stays)',
    contentText('pets babies patches bus') === 'pet baby patch bus', contentText('pets babies patches bus'))
  check('foldPlural leaves short words and -ss/-us/-is alone', ['dress', 'virus', 'iris', 'gas'].every(w => foldPlural(w) === w))

  // Two ideas with IDENTICAL text-usefulness inputs but different novelty (one is
  // a word-for-word existing product, one is not) must get the SAME usefulness.
  const useVecs = [[1, 0], [1, 0]]
  const out = computeUsefulnessKpis(useVecs, [[1, 0]], ['A baby vest for parents', 'A baby vest for parents'], [])
  check('same need fit + specificity + workability → same Usefulness score whatever the novelty',
    out.perIdea[0].usefulness === out.perIdea[1].usefulness, JSON.stringify(out.perIdea.map(p => p.usefulness)))
  check('no vote-based KPI is produced (left out per the owner)', !('voteShare' in out.perIdea[0]))

  // The novelty side is computed from ideas + R alone: the same numbers whatever U is.
  const refs = DEFAULT_REFERENCE_SET
  const nv = tfidfVectors([...ideas, ...refs]).vectors
  const nov1 = computeDeterministicKpis(nv.slice(0, 2), nv.slice(2)).perIdea.map(d => d.novelty)
  check('the novelty KPIs never see U (vectorised from ideas + R only)', nov1.every(x => x != null && x > 0 && x <= 1), JSON.stringify(nov1))
}

// ── The pipeline from text, and the "idea with no words" rule ──────────────
console.log('usefulnessKpisFromText — unreadable ideas are left blank, like the novelty side')
{
  const ideas = [
    'Fever onesie: a baby onesie that turns red at night when the baby has a fever',
    'Heat vest for outdoor workers that warns of heat stroke during summer shifts',
    '',            // blank
    '?',           // nothing the tokeniser reads
    'Καλή ιδέα',   // a script the tokeniser does not read
    'It is what it is',  // readable, but only common words: fewer than two meaningful words
    'Zorblax',           // a single word
  ]
  const res = usefulnessKpisFromText(ideas, DEFAULT_NEED_SET, DEFAULT_TECH_SET)
  const p = res.perIdea
  check('two real ideas get all three components and a score', [0, 1].every(i =>
    p[i].needFit > 0 && p[i].specificity > 0 && p[i].workability === 1 && p[i].usefulness != null), JSON.stringify(p.slice(0, 2)))
  check('blank / "?" / Greek text: every usefulness KPI blank (null), never a top score',
    [2, 3, 4].every(i => p[i].needFit === null && p[i].specificity === null && p[i].workability === null && p[i].usefulness === null),
    JSON.stringify(p.slice(2, 5)))
  // Same rule as the novelty side (objectiveKpis.js isMeasurable: two meaningful
  // words), so an idea is blank on both sides or on neither.
  const nov = objectiveKpisFromText(ideas, DEFAULT_REFERENCE_SET)
  check('counts measured / unmeasured exactly as objectiveKpis does (2 scored, 5 blank)',
    res.measured === 2 && res.unmeasured === 5 && res.measured === nov.measured && res.unmeasured === nov.unmeasured,
    `${res.measured}/${res.unmeasured} vs novelty side ${nov.measured}/${nov.unmeasured}`)
  check('only common words, or a single word: blank on every usefulness KPI, as on the novelty side',
    [5, 6].every(i => p[i].needFit === null && p[i].specificity === null && p[i].workability === null && p[i].usefulness === null
      && nov.perIdea[i].score === null), JSON.stringify(p.slice(5)))
  // An unreadable idea must not shift the real ideas' numbers (it stays out of the corpus).
  const alone = usefulnessKpisFromText(ideas.slice(0, 2), DEFAULT_NEED_SET, DEFAULT_TECH_SET).perIdea
  check('adding unreadable ideas does not change the real ideas\' need fit',
    near(alone[0].needFit, p[0].needFit) && near(alone[1].needFit, p[1].needFit))
  check('an empty need set is an error, not a silent 0', !!usefulnessKpisFromText(ideas, ['', '  '], []).error)
  check('need fit of a zero vector is null', needFit([0, 0], [[1, 0]]) === null)
}

// ── Cross-check helpers ─────────────────────────────────────────────────────
console.log('Novelty × usefulness cross-check')
{
  check('pearson: perfect + / − and null for < 3 pairs or a constant',
    near(pearson([1, 2, 3], [2, 4, 6]), 1) && near(pearson([1, 2, 3], [3, 2, 1]), -1) &&
    pearson([1, 2], [1, 2]) === null && pearson([1, 1, 1], [1, 2, 3]) === null)
  check('pearson skips pairs with a missing side', near(pearson([1, 2, null, 3], [2, 4, 9, 6]), 1))
  // Partial r must equal the r of the residuals after regressing x and y on z.
  const resid = (ys, zs) => {
    const mz = zs.reduce((a, b) => a + b, 0) / zs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length
    let szz = 0, szy = 0
    zs.forEach((zv, i) => { szz += (zv - mz) ** 2; szy += (zv - mz) * (ys[i] - my) })
    const b = szy / szz
    return ys.map((yv, i) => yv - my - b * (zs[i] - mz))
  }
  const px = [3, 1, 4, 1, 5, 9, 2, 6], py = [2, 7, 1, 8, 2, 8, 1, 8], pz = [1, 4, 1, 4, 2, 1, 3, 5]
  check('partialPearson equals the r of the residuals on z',
    near(partialPearson(px, py, pz), pearson(resid(px, pz), resid(py, pz)), 1e-9),
    `${partialPearson(px, py, pz)} vs ${pearson(resid(px, pz), resid(py, pz))}`)
  check('partialPearson: constant z → plain r', near(partialPearson([1, 2, 3], [2, 4, 6], [5, 5, 5]), 1))
  check('median of odd / even / with nulls', median([3, 1, 2]) === 2 && median([4, 1, 2, 3]) === 2.5 && median([null, 5]) === 5)
  const q = quadrantCounts([0.9, 0.9, 0.1, 0.1, null], [0.9, 0.1, 0.9, 0.1, 0.5], 0.5, 0.5)
  check('quadrants: both / novel only / useful only / neither, missing skipped',
    q.n === 4 && q.both === 1 && q.novelOnly === 1 && q.usefulOnly === 1 && q.neither === 1, JSON.stringify(q))
  check('"high" means strictly above the median', quadrantCounts([0.5], [0.5], 0.5, 0.5).neither === 1)
}

// ── Default lists ───────────────────────────────────────────────────────────
console.log('Default lists')
{
  const words = list => new Set(contentText(list.join(' ')).split(' ').filter(Boolean))
  const R = words(DEFAULT_REFERENCE_SET), U = words(DEFAULT_NEED_SET)
  const shared = [...U].filter(w => R.has(w))
  check('U shares only the core need words with R (fever, baby)', shared.every(w => ['fever', 'baby'].includes(w)), shared.join(', '))
  check('U and T are non-empty', DEFAULT_NEED_SET.length >= 10 && DEFAULT_TECH_SET.length >= 10)
  check('T avoids words the fabric itself covers or that are ambiguous',
    !['display', 'smart', 'heat', 'phone', 'screen', 'light', 'sound'].some(w => DEFAULT_TECH_SET.includes(w)))
  check('STOP_WORDS covers the function words the novelty tokeniser keeps', ['that', 'when', 'the', 'or', 'for'].every(w => STOP_WORDS.has(w)))
}

// ── Registry: every place a KPI must be registered ──────────────────────────
console.log('Registry — every new KPI reaches every consumer')
{
  const NEW = ['det_need_fit', 'det_specificity', 'det_workability', 'det_usefulness']
  const defs = Object.fromEntries(KPI_DEFS.map(d => [d.key, d]))
  const py = src('src/data/analyticsPython.py')
  const R_ = src('src/data/analyticsR.R')
  const page = src('src/pages/DataAnalytics.jsx')
  const exp = src('src/utils/sessionExport.js')
  const allKpiKeys = (page.match(/const ALL_KPI_KEYS = \[([\s\S]*?)\]/) || [])[1] || ''
  check('ALL_KPI_KEYS slice found in DataAnalytics.jsx (a vacuous slice would pass everything)', allKpiKeys.length > 100)
  const blankRow = buildRowsForSession({ code: 'S' }, [{ id: 'i1', title: 't' }], [], [])[0]
  for (const k of NEW) {
    const d = defs[k]
    // "(empirical)" since 2026-09-24 (owner: "Don't call them objective").
    check(`${k}: in KPI_DEFS with an "(empirical)" label, not on the 1–5 scale`, d && /\(empirical\)$/.test(d.label) && d.scale5 === false, d && d.label)
    check(`${k}: the old "(objective)" label still imports into it`,
      canonicalKpiField(d.label.replace('(empirical)', '(objective)')) === k &&
      normalizeImportedRows([{ Condition: 'Solo', Title: 'x', [d.label.replace('(empirical)', '(objective)')]: 0.42 }])[0][k] === 0.42)
    if (!d) continue
    check(`${k}: in COLUMNS (the analysis CSV)`, COLUMNS.includes(k))
    check(`${k}: canonicalKpiField routes its label AND its key back to it`,
      canonicalKpiField(d.label) === k && canonicalKpiField(k) === k, `${canonicalKpiField(d.label)} / ${canonicalKpiField(k)}`)
    check(`${k}: the importer reads its label`,
      normalizeImportedRows([{ Condition: 'Solo', Title: 'x', [d.label]: 0.42 }])[0][k] === 0.42)
    check(`${k}: a Firestore-built row starts blank`, blankRow[k] === '')
    check(`${k}: stripAllKpis blanks it`, stripAllKpis([{ [k]: 0.5 }])[0][k] === '')
    check(`${k}: in ALL_KPI_KEYS (DataAnalytics.jsx)`, allKpiKeys.includes(`'${k}'`))
    const pyKeys = (py.match(/^KPI_DEFS = \[([\s\S]*?)^\]/m) || [])[1] || ''
    const pyActive = pyKeys.split('\n').filter(l => !l.trim().startsWith('#')).join('\n')
    const rKeys = (R_.match(/KPI_KEYS\s*<-\s*c\(([\s\S]*?)\)/) || [])[1] || ''
    check(`${k}: in the Python KPI_DEFS with the same label`, pyActive.includes(`("${k}", "${d.label}", False)`))
    check(`${k}: in the R KPI_KEYS / KPI_LABELS / KPI_SCALE5`,
      rKeys.includes(`"${k}"`) && R_.includes(`${k}="${d.label}"`) && R_.includes(`${k}=FALSE`))
    // The Rankings tab takes its KPI columns from exportKpiColumns (the page's
    // order: empirical first), all seven 3.1 columns even before they are computed.
    check(`${k}: a column of the aggregate Rankings tab`,
      exportKpiColumns([], { allEmpirical: true }).some(c => c.key === k && c.label === d.label) &&
      /for \(const c of columns\) row\[c\.label\]/.test(exp))
  }
  check('the old novelty labels still route (no regression)',
    canonicalKpiField('Novelty (objective)') === 'det_novelty' && canonicalKpiField('Novelty (empirical)') === 'det_novelty' &&
    canonicalKpiField('Combined score') === 'det_score' && canonicalKpiField('Pool distinctiveness') === 'det_distinctiveness' &&
    // a plain AI column has no model name: "model not recorded" (aiScoreColumns.js)
    canonicalKpiField('Usefulness') === aiUseKey(UNRECORDED) &&
    canonicalKpiField('Eval. Usefulness') === 'ext_usefulness')
  // Stale saved scripts: the page compares the template's registry with the script's.
  const pyNow = scriptKpiKeys(py, 'python'), rNow = scriptKpiKeys(R_, 'r')
  check('scriptKpiKeys reads the Python and R registries (the new keys are in)',
    pyNow && rNow && ['det_need_fit', 'det_workability', 'det_usefulness', 'novelty', 'det_score'].every(k => pyNow.has(k) && rNow.has(k)),
    `${pyNow && [...pyNow].join(',')} | ${rNow && [...rNow].join(',')}`)
  const oldPy = py.replace(/^\s*\("det_(need_fit|specificity|workability|usefulness)".*\n/gm, '')
  check('an older script without the new keys is detected as missing them',
    ['det_need_fit', 'det_usefulness'].every(k => !scriptKpiKeys(oldPy, 'python').has(k)) && scriptKpiKeys(oldPy, 'python').has('det_score'))
  check('a restructured script (no registry) gives null, so nothing is flagged', scriptKpiKeys('print(1)', 'python') === null)
  check('Step 5 wires the warning under Run',
    /const staleKpis = useMemo/.test(page) && page.includes('scriptKpiKeys(code, lang)') && page.includes('{staleKpis.length > 0 && ('))
  // Found in the browser run: the facet table read .facets of an unmeasured idea (null).
  check('the facet-coverage table counts only measured ideas (an unreadable one has no facets)',
    page.includes('const m = idxs.filter(i => useIdea[i].facets)'))
  check('the page runs the shared text pipelines, not its own vectorisation',
    page.includes('usefulnessKpisFromText(ideaTexts, needLines, techTerms)') && page.includes('objectiveKpisFromText(ideaTexts, refLines'))
  // Length check: Table 7 = Table 4 with log(1 + word count) held fixed, in BOTH
  // scripts (they must stay in step), on by default, Tables 3-6 untouched.
  check('Python and R both run Table 7 (length held fixed) by default',
    /^LENGTH_CHECK = True/m.test(py) && /^LENGTH_CHECK <- TRUE/m.test(R_) &&
    py.includes('df["log_words"] = np.log1p(df["word_count"])') && R_.includes('dat$log_words   <- log1p(dat$word_count)') &&
    py.includes('df, 7, "Robustness - Solo / Group / Both with idea length held fixed"') &&
    R_.includes('dat, 7, "Robustness - Solo / Group / Both with idea length held fixed"'))
  check('both print the same length-check read-out after Table 7',
    py.includes('def length_check_summary(') && R_.includes('length_check_summary <- function(') &&
    py.includes('LENGTH CHECK  (Table 4 vs Table 7') && R_.includes('LENGTH CHECK  (Table 4 vs Table 7'))
  check('Tables 3-6 keep their own controls (the length control is Table 7 only)',
    (py.match(/controls=controls\)/g) || []).length === 4 && (py.match(/controls=lterms/g) || []).length === 1)
  check('a det_* key column is no longer re-imported as an x_ duplicate',
    !Object.keys(normalizeImportedRows([{ Condition: 'Solo', Title: 'x', det_distinctiveness: 0.37 }])[0]).some(k => k.startsWith('x_')))
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll usefulness-KPI checks passed.')
process.exit(failures ? 1 : 0)
