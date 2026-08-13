/* ==========================================================================
   Simulation Platform — registration completeness guard
   (Playwright + a local static server over the repo root; no network,
    LOCAL mode, nothing is written anywhere real).
       node simulation/tools/registration-guard.mjs
       (CHROMIUM=/path/to/chromium to override; PW=/path/to/playwright pkg)

   Two owner reports, one root cause and one policy:

   (1) "Many students show Chinese characters in the LEVEL column, but their
       profile shows that field EMPTY." The registration selects were written
       as <option>Undergraduate</option> — no value attribute — so the option's
       value IS its text. A student browsing with the browser's page
       translation on has that text rewritten in the DOM ("大学本科生"), which
       is then what `select.value` returns and what gets saved. Opening the
       profile later sets `select.value` to that translated string, no option
       matches, and the field renders blank. Every option now carries an
       explicit value="…", so a translated LABEL never becomes the stored
       ANSWER — checked here by translating the labels in the page exactly the
       way a translator does.

   (2) "Never have the empty option in these fields" + "show a pop-up to
       complete the registration before they can play". The blank first option
       is now a disabled placeholder (nothing empty is selectable, and an
       untouched field is still caught rather than silently recording the first
       real option), an incomplete registration cannot start a simulation, and
       the prompt names what is missing.
   ========================================================================== */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }

/* Force LOCAL mode (the shipped config is live) so the guard writes nothing
   real, and hand the page one active simulation to click at. */
const LOCAL_CONFIG = `window.SIMP_FIREBASE_CONFIG = { apiKey: 'PASTE_API_KEY', projectId: 'PASTE_PROJECT_ID' };
window.SIMP_ADMIN_EMAILS = ['admin@admin.com'];`
const ACTIVE_CONFIG = JSON.stringify({ sims: { jagged: { active: true, sessionId: '', note: '' } }, updated: '2026-08-13T00:00:00.000Z' })

const srv = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path === '/simulation/firebase-config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(LOCAL_CONFIG)
  }
  if (path === '/simulation/config.json') {
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(ACTIVE_CONFIG)
  }
  let f = join(ROOT, path)
  if (f.endsWith('/')) f = join(f, 'index.html')
  try {
    const b = await readFile(f)
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' })
    res.end(b)
  } catch { res.writeHead(404); res.end('nope') }
})
await new Promise(r => srv.listen(0, r))
const base = `http://localhost:${srv.address().port}/`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' })
let fail = 0
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); return }
  fail++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('dialog', d => d.accept())
await page.goto(base + 'simulation/', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('#s-register:not([hidden])')       // LOCAL mode opens the form

/* ── 1. no empty option anywhere ──────────────────────────────────────── */
const selects = ['f-age', 'f-gender', 'f-nationality', 'f-country', 'f-level',
                 'f-occupation', 'f-industry', 'f-english']
const opts = await page.evaluate(ids => ids.map(id => {
  const el = document.getElementById(id)
  return {
    id,
    total: el.options.length,
    blankSelectable: [...el.options].filter(o => !o.value && !o.disabled).length,
    valueless: [...el.options].filter(o => o.value === '' && o.textContent.trim() !== '' && !o.disabled).length,
    placeholderDisabled: el.options[0].disabled && el.options[0].value === '',
    everyOptionHasValue: [...el.options].slice(1).every(o => o.getAttribute('value') !== null),
  }
}), selects)
opts.forEach(o => {
  check(`${o.id}: no selectable empty option`, o.blankSelectable === 0, JSON.stringify(o))
  check(`${o.id}: the first entry is a disabled placeholder`, o.placeholderDisabled, JSON.stringify(o))
  check(`${o.id}: every real option carries an explicit value attribute`, o.everyOptionHasValue, JSON.stringify(o))
})

/* ── 2. a translated page still saves canonical answers ───────────────── */
/* Rewrite the visible option TEXT the way a page translator does — the values
   must be untouched, and what we save must be the English canonical string. */
await page.evaluate(() => {
  const map = {
    'Undergraduate': '大学本科生', 'Postgraduate (Masters)': '硕士研究生',
    'Female': '女', 'Male': '男', 'Advanced': '高级', 'Student': '学生',
    'China': '中国', 'Technology & Software': '技术与软件',
  }
  document.querySelectorAll('#s-register option').forEach(o => {
    if (map[o.textContent]) o.textContent = map[o.textContent]
  })
})
await page.fill('#f-name', 'JiaQing Li')
await page.fill('#f-email', 'jiaqing@example.com')
await page.fill('#f-sid', '25241164')
await page.fill('#f-workexp', '0')
await page.selectOption('#f-age', '18-24')
await page.selectOption('#f-gender', 'Female')
await page.selectOption('#f-nationality', 'China')
await page.selectOption('#f-country', 'China')
await page.selectOption('#f-level', 'Undergraduate')
await page.selectOption('#f-occupation', 'Student')
await page.selectOption('#f-industry', 'Technology & Software')
await page.selectOption('#f-english', 'Advanced')
const levelLabel = await page.evaluate(() => {
  const el = document.getElementById('f-level')
  return el.options[el.selectedIndex].textContent
})
check('the label the student reads IS translated (so the test is real)', levelLabel === '大学本科生', levelLabel)
await page.click('#btn-save')
await page.waitForSelector('#s-sims:not([hidden])')
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('simp:profile:v1')))
check('the SAVED level is the canonical English value, not the translated label',
  saved.levelOfStudy === 'Undergraduate', JSON.stringify(saved.levelOfStudy))
check('…same for gender / occupation / industry',
  saved.gender === 'Female' && saved.occupation === 'Student' && saved.industry === 'Technology & Software',
  JSON.stringify([saved.gender, saved.occupation, saved.industry]))
check('a complete registration shows no incomplete banner',
  await page.locator('#reg-note').isHidden())
check('…and no complete-your-registration pop-up', await page.locator('#regmodal').isHidden())

/* ── 3. a translated answer is REPAIRED, an unmappable one is asked again ─ */
const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page2.on('dialog', d => d.accept())
await page2.addInitScript(() => {
  /* Exactly what the reported students carry: everything filled in, but the
     level saved as a translated label (and the industry left blank). */
  localStorage.setItem('simp:profile:v1', JSON.stringify({
    name: 'JiaQing Li', email: 'jiaqing@example.com', studentId: '25241164',
    age: '18-24岁', gender: '女', nationality: '中国', country: '中国',
    levelOfStudy: '大学本科生', workExperience: '0', occupation: '学生',
    industry: 'Sonstiges (unmapped)', englishFluency: '高级',
    updatedAt: new Date(0).toISOString(),
  }))
})
await page2.goto(base + 'simulation/', { waitUntil: 'domcontentloaded' })
await page2.waitForSelector('#s-sims:not([hidden])')
await page2.waitForSelector('#regmodal:not([hidden])')
/* Everything a translator rewrote is put back on its own — level, gender,
   nationality/country, occupation, fluency, and the decorated age band —
   without asking the student anything. */
const healed0 = await page2.evaluate(() => JSON.parse(localStorage.getItem('simp:profile:v1')))
check('the translated level is repaired to its catalogue value',
  healed0.levelOfStudy === 'Undergraduate', healed0.levelOfStudy)
check('…gender, country, nationality, occupation and fluency too',
  healed0.gender === 'Female' && healed0.country === 'China' && healed0.nationality === 'China' &&
  healed0.occupation === 'Student' && healed0.englishFluency === 'Advanced',
  JSON.stringify([healed0.gender, healed0.country, healed0.nationality, healed0.occupation, healed0.englishFluency]))
check('a decorated age band ("18-24岁") keeps its option', healed0.age === '18-24', healed0.age)
check('an answer nothing can map is left EXACTLY as it was, never guessed',
  healed0.industry === 'Sonstiges (unmapped)', healed0.industry)

const body = await page2.locator('#rm-body').textContent()
check('the pop-up is raised for the answer that could not be repaired', true)
check('it names only that detail', /Industry/.test(body) && !/Level of study/.test(body), body)
await page2.click('#rm-close')
check('the incomplete banner stays on the cards',
  await page2.locator('#reg-note').isVisible())

/* Clicking a simulation must NOT launch it while details are missing. */
const cards = page2.locator('.sim-card:not(.done)')
if (await cards.count()) {
  const before = browser.contexts().reduce((n, c) => n + c.pages().length, 0)
  await cards.first().click()
  await page2.waitForTimeout(400)
  const after = browser.contexts().reduce((n, c) => n + c.pages().length, 0)
  check('clicking a simulation opens the prompt instead of launching it',
    after === before && await page2.locator('#regmodal').isVisible())
} else {
  check('at least one active simulation card to click', false, 'no cards rendered')
}

/* Completing the details clears the gate. */
await page2.click('#rm-go')
await page2.waitForSelector('#s-register:not([hidden])')
check('the edit form flags only the field that still needs an answer',
  await page2.locator('#f-industry.needs-answer').count() === 1 &&
  await page2.locator('#f-level.needs-answer').count() === 0)
check('the repaired level is selected in the form',
  await page2.locator('#f-level').inputValue() === 'Undergraduate')
check('the unmappable saved answer is not written into the select',
  await page2.locator('#f-industry').inputValue() === '')
check('the "some details are missing" note is shown', await page2.locator('#reg-missing').isVisible())
await page2.selectOption('#f-industry', 'Technology & Software')
await page2.click('#btn-save')
await page2.waitForSelector('#s-sims:not([hidden])')
check('after completing, the banner is gone', await page2.locator('#reg-note').isHidden())
const healed = await page2.evaluate(() => JSON.parse(localStorage.getItem('simp:profile:v1')))
check('and the stored level is canonical again', healed.levelOfStudy === 'Undergraduate', healed.levelOfStudy)

await browser.close()
srv.close()
console.log(fail ? `\nFAILURES: ${fail}` : '\nREGISTRATION GUARD OK — canonical answers under translation, no empty option, play gated on a complete registration.')
process.exit(fail ? 1 : 0)
