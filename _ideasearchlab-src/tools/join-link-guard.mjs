/**
 * join-link-guard.mjs — offline test (no network, no deps).
 *
 *   node _ideasearchlab-src/tools/join-link-guard.mjs
 *
 * The admin's session cards carry a **Copy link** button; the link it copies has
 * to be readable by the join page it lands on. Both ends live in
 * `src/utils/joinLink.js` precisely so they cannot drift, and this pins the
 * round trip: whatever `joinLinkFor()` writes, `joinCodeFromSearch()` must read
 * back as the same code.
 *
 * The other half of the path — that the `?code=` survives the app's "/" → "/join"
 * redirect — is a routing concern verified against the BUILT bundle by loading
 * `…/lab/ideasearchlab/?code=X` and watching the route trail (see the commit
 * that added this); a bare `<Navigate to="/join">` dropped it.
 */
import { joinLinkFor, joinCodeFromSearch, normalizeJoinCode } from '../src/utils/joinLink.js'

let failures = 0
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); return }
  failures++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ORIGIN = 'https://www.stouras.com'
const BASE = '/lab/ideasearchlab/'

console.log('joinLinkFor — the shape an instructor pastes into a class chat')
{
  const url = joinLinkFor(ORIGIN, BASE, 'BALI')
  check('is the app root with ?code= (never /join, which needs the SPA 404 fallback)',
    url === 'https://www.stouras.com/lab/ideasearchlab/?code=BALI', url)
  check('a base without its trailing slash still yields one',
    joinLinkFor(ORIGIN, '/lab/ideasearchlab', 'BALI') === url,
    joinLinkFor(ORIGIN, '/lab/ideasearchlab', 'BALI'))
  check('the code is normalised into the link, not pasted raw',
    joinLinkFor(ORIGIN, BASE, ' bali-2 ') === `${ORIGIN}${BASE}?code=BALI2`,
    joinLinkFor(ORIGIN, BASE, ' bali-2 '))
}

console.log('round trip — every code the admin can mint survives the link')
{
  // Session codes are [A-Z0-9]{3,40} (the create form + JoinSession normalise
  // to exactly that), so these cover the space the button can ever be given.
  for (const code of ['BALI', 'CORK', 'ABC', 'A1B2C3', '000000', 'X'.repeat(40)]) {
    const url = joinLinkFor(ORIGIN, BASE, code)
    const back = joinCodeFromSearch(new URL(url).search)
    check(`"${code.length > 12 ? code.slice(0, 9) + '…' : code}" copies out and reads back identically`,
      back === code, `read back "${back}"`)
  }
}

console.log('joinCodeFromSearch — what the join page accepts')
{
  check('?code=BALI', joinCodeFromSearch('?code=BALI') === 'BALI')
  check('?s=BALI too (Answer Arena spelling, so either link shape works)',
    joinCodeFromSearch('?s=BALI') === 'BALI')
  check('?code wins when both are present',
    joinCodeFromSearch('?s=CORK&code=BALI') === 'BALI', joinCodeFromSearch('?s=CORK&code=BALI'))
  check('lowercase/punctuated input normalises like the form does',
    joinCodeFromSearch('?code=bali-x') === 'BALIX', joinCodeFromSearch('?code=bali-x'))
  check('a code beside other params is still found',
    joinCodeFromSearch('?utm_source=chat&code=BALI') === 'BALI')
  check('percent-encoding is decoded',
    joinCodeFromSearch('?code=BA%4CI') === 'BALI', joinCodeFromSearch('?code=BA%4CI'))
}

console.log('joinCodeFromSearch — no code means an empty form, never a crash')
{
  for (const [label, input] of [
    ['no query', ''], ['bare ?', '?'], ['other params only', '?theme=dark'],
    ['empty code', '?code='], ['punctuation-only code', '?code=---'],
    ['null', null], ['undefined', undefined],
  ]) check(`${label} → ''`, joinCodeFromSearch(input) === '', `got "${joinCodeFromSearch(input)}"`)
}

console.log('normalizeJoinCode — the shared rule')
{
  check('caps, strips punctuation and spaces', normalizeJoinCode(' bali-2 x ') === 'BALI2X')
  check('caps at 40 chars (the create form\'s limit)', normalizeJoinCode('Z'.repeat(60)).length === 40)
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nJOIN-LINK GUARD OK — the copied link reads back as the same session code.')
process.exit(failures ? 1 : 0)
