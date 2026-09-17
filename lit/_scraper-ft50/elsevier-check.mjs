/*
 * elsevier-check.mjs — which Elsevier API key is live, and which one the
 * institutional token belongs to.
 * ===========================================================================
 * The abstracts backfill needs a MATCHED PAIR: an API key, and an insttoken
 * Elsevier issued AGAINST THAT KEY. Hold two keys and it is easy to lose track
 * of which one you quoted to Elsevier support — and the portal does not show
 * the pairing, because the token is issued by support and never listed there.
 * Elsevier will tell you, though, in the statusText of a 401. This script asks
 * it, for each key, and translates the answer:
 *
 *   Invalid API Key: valid apikey credentials required
 *       → that key is not live (wrong, mistyped, or revoked).
 *   Institution Token is not associated with API Key
 *       → that key IS live, but the token belongs to the OTHER key.
 *   200 with abstract text
 *       → matched pair, entitled. This is the one to keep.
 *   200 without abstract text
 *       → pair accepted, but no off-campus abstract entitlement.
 *   AUTHORIZATION_ERROR
 *       → valid pair, missing entitlement for the view asked for. A question
 *         for Elsevier support, not another paste.
 *
 * CREDENTIALS COME FROM THE ENVIRONMENT, NEVER FROM ARGV — a command line is
 * visible in shell history and in the process list, and the insttoken's terms
 * forbid it travelling anywhere but an https request header. Nothing is
 * written to disk and no value is ever printed: each key is identified by a
 * short SHA-256 fingerprint, which is enough to tell two keys apart and to
 * match one to a later run, and cannot be turned back into the key.
 *
 * Usage (locally, from the repository root):
 *
 *   ELSEVIER_API_KEY=<first key> \
 *   ELSEVIER_API_KEY_2=<second key> \
 *   ELSEVIER_INST_TOKEN=<the token> \
 *     node lit/_scraper-ft50/elsevier-check.mjs
 *
 * Either key may be omitted. With no token it reports only which keys are
 * live, which is still the first half of the answer.
 *
 *   node lit/_scraper-ft50/elsevier-check.mjs --selftest   (offline)
 *
 * NOTE: this build sandbox blocks api.elsevier.com, so a real check has to run
 * on a personal machine (like the pubsonline and pnas scrapers).
 */
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { headerSafeValue, elsErrorText, readRateLimit, elsevierAbstract, scopusDoiQuery, scopusAbstracts } from './abstracts-ci.mjs';

// An old, heavily-indexed EJOR paper our own catalog proves Elsevier holds an
// abstract for, so "no text came back" is about entitlement and never about
// this particular article. Deliberately NOT a recent paper: Scopus indexes an
// Elsevier article weeks after Crossref registration, so a 2026 DOI would
// report a 404 that says nothing about the credential.
const PROBE_DOI = '10.1016/j.ejor.2016.06.023';

// Each verdict a probe can reach, with what it means for the caller. Order is
// the order they are explained in the summary.
export const VERDICTS = {
  'ok-text':          'the pair works and abstracts come back',
  'ok-no-text':       'accepted, but no abstract text (off-campus entitlement missing)',
  'key-invalid':      'this key is NOT live (wrong, mistyped or revoked)',
  'token-not-paired': 'this key IS live, but the token belongs to a different key',
  'no-entitlement':   'valid pair, but not entitled to this API',
  'auth-other':       'refused on authentication, reason not recognised',
  'quota':            'throttled or the weekly quota is spent',
  'not-found':        'the key works; Elsevier has no record for the probe article',
  'unreachable':      'could not reach Elsevier from this machine',
  'other':            'unexpected response',
};

// Pure: Elsevier's answer -> one verdict key. Exported for the selftest.
export function classify({ status, err, textLen, networkError }) {
  if (networkError) return 'unreachable';
  if (status === 200) return (textLen || 0) >= 60 ? 'ok-text' : 'ok-no-text';
  if (status === 404) return 'not-found';
  if (status === 429) return 'quota';
  if (status === 401 || status === 403) {
    const e = String(err || '');
    if (/invalid\s+api\s*key/i.test(e)) return 'key-invalid';
    if (/institution\s+token\s+is\s+not\s+associated/i.test(e)) return 'token-not-paired';
    if (/AUTHORIZATION/i.test(e)) return 'no-entitlement';
    return 'auth-other';
  }
  return 'other';
}

// What to do next, from the verdicts the probes reached for one key. Pure.
export function advise({ keyOnly, withToken, scopus }) {
  if (keyOnly === 'key-invalid') return 'Not this one. Elsevier does not recognise it, so it cannot be the key the token was issued against.';
  if (keyOnly === 'unreachable') return 'No answer from Elsevier, so nothing is proved either way. Try again from a network that can reach api.elsevier.com.';
  // A refusal carrying no Elsevier error envelope is very often NOT Elsevier:
  // a corporate proxy or sandbox answering 403 looks exactly like this. It
  // must never be reported as a live key, which is what it used to say.
  if (keyOnly === 'auth-other') return 'Refused without an Elsevier error code, which usually means something between you and Elsevier answered instead. Nothing is proved about this key; run it again from a network that reaches api.elsevier.com directly.';
  const live = 'This key is live.';
  if (!withToken) return `${live} Set ELSEVIER_INST_TOKEN as well to find out whether the token belongs to it.`;
  if (withToken === 'ok-text') return `${live} The token belongs to THIS key and abstracts come back. Use this pair everywhere.`;
  if (withToken === 'ok-no-text') return `${live} The token is accepted with this key, but Elsevier serves no abstract text. Ask support to confirm the token's Abstract Retrieval entitlement.`;
  if (withToken === 'token-not-paired') return `${live} The token was issued against your OTHER key. Either use that key, or ask Elsevier to re-issue the token against this one.`;
  if (withToken === 'no-entitlement') return `${live} The pair is valid but lacks entitlement for this API${scopus === 'ok-text' ? ' (Scopus, however, answered)' : ''}. Ask Elsevier support which entitlements the token carries.`;
  return `${live} The token probe returned something unexpected; read the raw line above.`;
}

const fingerprint = (v) => createHash('sha256').update(v).digest('hex').slice(0, 8);

const headers = (key, token) => ({
  'X-ELS-APIKey': key,
  Accept: 'application/json',
  ...(token ? { 'X-ELS-Insttoken': token } : {}),
});

// One Abstract Retrieval probe. Returns {status, err, textLen, quota} and never
// the credential it used.
async function probeAbstract(key, token) {
  const url = `https://api.elsevier.com/content/abstract/doi/${PROBE_DOI.split('/').map(encodeURIComponent).join('/')}` +
    '?view=META_ABS&httpAccept=application/json';
  try {
    const r = await fetch(url, { headers: headers(key, token) });
    let body = null;
    try { body = await r.json(); } catch { /* an unreadable body is not a verdict */ }
    const err = elsErrorText(body);
    const textLen = r.status === 200 ? elsevierAbstract(body).length : 0;
    return { status: r.status, err, textLen, quota: readRateLimit(r.headers) };
  } catch (e) {
    return { networkError: true, kind: (e && (e.code || e.name)) ? String(e.code || e.name) : 'error' };
  }
}

// One Scopus Search probe — the subscriber-only COMPLETE view, which is what
// the batched leg of the backfill needs.
async function probeScopus(key, token) {
  const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(scopusDoiQuery([PROBE_DOI], 'exact'))}` +
    '&view=COMPLETE&count=1&httpAccept=application/json';
  try {
    const r = await fetch(url, { headers: headers(key, token) });
    let body = null;
    try { body = await r.json(); } catch { /* ignore */ }
    const err = elsErrorText(body);
    let textLen = 0;
    if (r.status === 200) {
      const map = scopusAbstracts(body);
      textLen = (map.get(PROBE_DOI) || '').length;
    }
    return { status: r.status, err, textLen, quota: readRateLimit(r.headers) };
  } catch (e) {
    return { networkError: true, kind: (e && (e.code || e.name)) ? String(e.code || e.name) : 'error' };
  }
}

const line = (label, res) => {
  const v = classify(res);
  const raw = res.networkError ? `network error (${res.kind})`
    : `HTTP ${res.status}${res.err ? ` (${res.err})` : ''}${res.status === 200 ? `, ${res.textLen} chars of abstract` : ''}`;
  return `    ${label.padEnd(22)} ${v.padEnd(18)} ${raw}`;
};

async function main() {
  if (process.argv.slice(2).some(a => /^--(key|token|apikey|insttoken)=/i.test(a))) {
    console.error('Refusing a credential on the command line: it lands in shell history and the process list. ' +
      'Pass ELSEVIER_API_KEY / ELSEVIER_API_KEY_2 / ELSEVIER_INST_TOKEN in the environment instead.');
    process.exit(2);
  }
  const token = headerSafeValue(process.env.ELSEVIER_INST_TOKEN || '');
  if ((process.env.ELSEVIER_INST_TOKEN || '').trim() && !token) {
    console.error('ELSEVIER_INST_TOKEN is not a valid header value (whitespace or a control character). Re-paste it.');
    process.exit(2);
  }
  const keys = [];
  for (const name of ['ELSEVIER_API_KEY', 'ELSEVIER_API_KEY_2']) {
    const raw = (process.env[name] || '').trim();
    if (!raw) continue;
    const v = headerSafeValue(raw);
    if (!v) { console.error(`${name} is not a valid header value (whitespace or a control character). Re-paste it.`); process.exit(2); }
    keys.push({ name, value: v });
  }
  if (!keys.length) {
    console.error('Set ELSEVIER_API_KEY (and optionally ELSEVIER_API_KEY_2, ELSEVIER_INST_TOKEN) and run again.');
    process.exit(2);
  }
  // Two secrets holding the same value is itself worth saying out loud.
  const seen = new Set();
  const dupes = [];
  for (const k of keys) {
    if (seen.has(k.value)) dupes.push(k.name);
    seen.add(k.value);
  }
  for (const name of dupes) console.log(`${name}: identical to the key already checked.`);

  console.log(`Probing Elsevier with ${PROBE_DOI} (an article our catalog shows Elsevier has an abstract for).`);
  const tokenNote = token
    ? 'An institutional token is set and will be tried against each key.\n'
    : 'No ELSEVIER_INST_TOKEN set: reporting only which keys are live.\n';
  console.log(tokenNote);

  const results = [];
  for (const k of keys) {
    const fp = fingerprint(k.value);
    console.log(`${k.name}  (fingerprint ${fp})`);
    const keyOnly = await probeAbstract(k.value, '');
    console.log(line('key alone', keyOnly));
    let withToken = null, scopus = null;
    if (token) {
      withToken = await probeAbstract(k.value, token);
      console.log(line('key + token', withToken));
      scopus = await probeScopus(k.value, token);
      console.log(line('key + token (Scopus)', scopus));
    }
    const q = (withToken && withToken.quota) || keyOnly.quota;
    if (q && q.remaining != null) console.log(`    quota: ${q.remaining}${q.limit != null ? ` of ${q.limit}` : ''} requests left this week`);
    const verdicts = {
      keyOnly: classify(keyOnly),
      withToken: withToken ? classify(withToken) : null,
      scopus: scopus ? classify(scopus) : null,
    };
    console.log(`    → ${advise(verdicts)}\n`);
    results.push({ name: k.name, fp, ...verdicts });
  }

  const winner = results.find(r => r.withToken === 'ok-text');
  const live = results.filter(r => !['key-invalid', 'unreachable', 'auth-other', 'other'].includes(r.keyOnly));
  console.log('Summary');
  if (winner) {
    console.log(`  Use ${winner.name} (fingerprint ${winner.fp}) together with the token you have. Put that pair in every repository.`);
  } else if (!live.length && results.some(r => r.keyOnly === 'auth-other' || r.keyOnly === 'unreachable')) {
    console.log('  Nothing was proved: Elsevier never gave a readable answer. Run this from a network that reaches api.elsevier.com directly.');
  } else if (live.length && token) {
    console.log(`  ${live.length} of ${results.length} keys are live, and the token pairs with none of them.`);
    console.log('  Go back to Elsevier support with the live key\'s value (read it off dev.elsevier.com) and ask them to');
    console.log('  issue the institutional token against THAT key, quoting the refusal text printed above.');
  } else if (live.length) {
    console.log(`  ${live.length} of ${results.length} keys are live. Set ELSEVIER_INST_TOKEN and run again to find the pairing.`);
  } else {
    console.log('  None of the keys given is live. Check them on https://dev.elsevier.com/apikey/manage.');
  }
}

function selftest() {
  let fails = 0;
  const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };
  const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

  console.log('classify: Elsevier\'s answer -> a verdict');
  eq(classify({ status: 200, textLen: 900 }), 'ok-text', '200 with prose');
  eq(classify({ status: 200, textLen: 0 }), 'ok-no-text', '200 with no description');
  eq(classify({ status: 200, textLen: 12 }), 'ok-no-text', 'a 12-char scrap is not an abstract');
  eq(classify({ status: 401, err: 'AUTHENTICATION_ERROR: Invalid API Key: valid apikey credentials required.' }),
    'key-invalid', 'the dead-key message');
  eq(classify({ status: 401, err: 'AUTHENTICATION_ERROR: Institution Token is not associated with API Key' }),
    'token-not-paired', 'the wrong-pairing message');
  eq(classify({ status: 403, err: 'AUTHORIZATION_ERROR: The requestor is not authorized' }),
    'no-entitlement', 'an entitlement refusal');
  eq(classify({ status: 401, err: 'AUTHENTICATION_ERROR: something new' }), 'auth-other', 'an unrecognised authentication refusal');
  eq(classify({ status: 429, err: 'QUOTA_EXCEEDED' }), 'quota', 'a throttle or spent quota');
  eq(classify({ status: 404 }), 'not-found', 'no record for the probe article');
  eq(classify({ status: 500 }), 'other', 'a server error decides nothing');
  eq(classify({ networkError: true, kind: 'ENOTFOUND' }), 'unreachable', 'no answer at all');
  ok(Object.keys(VERDICTS).every(k => typeof VERDICTS[k] === 'string'), 'every verdict carries an explanation');

  console.log('advise: the verdicts -> what to do');
  ok(/Not this one/.test(advise({ keyOnly: 'key-invalid' })), 'a dead key is ruled out');
  ok(/belongs to THIS key/.test(advise({ keyOnly: 'ok-no-text', withToken: 'ok-text' })), 'the working pair is named');
  ok(/OTHER key/.test(advise({ keyOnly: 'token-not-paired', withToken: 'token-not-paired' })),
    'the wrong pairing points at the other key');
  ok(/nothing is proved/.test(advise({ keyOnly: 'unreachable' })), 'an unreachable probe proves nothing');
  ok(/Nothing is proved/.test(advise({ keyOnly: 'auth-other', withToken: 'auth-other' })),
    'a refusal with no Elsevier error code never claims the key is live');
  ok(!/This key is live/.test(advise({ keyOnly: 'auth-other', withToken: 'auth-other' })),
    'and it says so in those words nowhere');
  ok(/Set ELSEVIER_INST_TOKEN/.test(advise({ keyOnly: 'ok-no-text', withToken: null })), 'no token asks for one');

  console.log('fingerprints identify a key without carrying it');
  const fp = fingerprint('key-abc');
  eq(fp.length, 8, 'eight hex characters');
  ok(!fp.includes('key-abc') && fingerprint('key-abc') === fp, 'stable, and not the key itself');
  ok(fingerprint('key-abd') !== fp, 'two keys are told apart');

  console.log('the source keeps the credentials to request headers');
  // Scoped to the RUNTIME half: these pins forbid patterns the checks
  // themselves have to spell out, so a whole-file slice would match its own
  // assertions and pass on nothing. The length guard fails loudly if the
  // marker ever moves (the rule this repository learned from the messages
  // card, where a slice taken on the wrong marker came back empty).
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const runtime = src.slice(0, src.indexOf('function selftest('));
  ok(runtime.length > 4000, `the runtime half was really sliced (${runtime.length} chars)`);
  ok(!/\$\{\s*(key|token|ELS_[A-Z_]*|ELSEVIER_[A-Z_]*)\s*\}/.test(runtime.replace(/X-ELS-[A-Za-z]+':\s*\w+/g, '')),
    'no credential is interpolated into a URL or a message');
  ok(/'X-ELS-APIKey':\s*key/.test(runtime) && /'X-ELS-Insttoken':\s*token/.test(runtime),
    'the key and the token travel as their documented headers');
  ok(!/api\.elsevier\.com[^'`]*(apiKey|insttoken)=/i.test(runtime), 'no endpoint carries a credential query parameter');
  ok((runtime.match(/https:\/\/api\.elsevier\.com/g) || []).length >= 2 && !/http:\/\/api\.elsevier\.com/.test(runtime),
    'every endpoint is https');
  ok(/Refusing a credential on the command line/.test(runtime), 'argv credentials are refused');
  // Single-quoted strings are LABELS and cannot interpolate a variable, so
  // they are blanked before this test — otherwise the printed column heading
  // "key + token" fails a check that is about passing the credential itself.
  // Template literals are deliberately KEPT: `${token}` is exactly the leak.
  const noLabels = runtime.replace(/'[^'\n]*'/g, "''");
  // What leaks is the credential being INTERPOLATED or PASSED, not the word
  // "token" appearing in a sentence — several lines legitimately explain the
  // token to the reader, and an earlier version of this check failed on those.
  const LOG_LEAK = /console\.(log|error|warn)\((\s*(token|key|k\.value)\s*[,)]|[^\n]*\$\{\s*(token|key|k\.value)\s*\})/;
  ok(!LOG_LEAK.test(noLabels), 'no log call interpolates or passes a credential');
  ok(LOG_LEAK.test("console.log(`v=${token}`)") && LOG_LEAK.test('console.error(k.value)'),
    'that check really catches a leak when there is one');
  ok(/'key \+ token'/.test(runtime), 'the label the blanking step exists for is really there');
  ok(!/writeFileSync|appendFileSync/.test(runtime), 'nothing is written to disk');

  console.log(fails ? `\nFAILED (${fails})` : '\nAll Elsevier credential-check checks passed.');
  process.exit(fails ? 1 : 0);
}

const { readFileSync } = await import('node:fs');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--selftest')) selftest();
  else main().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
}
