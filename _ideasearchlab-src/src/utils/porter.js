/**
 * porter.js — Martin Porter's stemming algorithm (1980), the reference JavaScript
 * version he published (tartarus.org/~martin/PorterStemmer, with his bli->ble and
 * logi->log amendments). Used by kpiText.js so "sock" and "socks", "colour" and
 * "colours", "changing" and "changed" count as one word in the Section 3.1 KPIs.
 * Mirrored line for line by porter_stem in _idea-kpi-script/idea_kpis.py.
 */
const step2list = { ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', bli: 'ble', alli: 'al',
  entli: 'ent', eli: 'e', ousli: 'ous', ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive',
  fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log' }
const step3list = { icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '' }
const c = '[^aeiou]', v = '[aeiouy]', C = c + '[^aeiouy]*', V = v + '[aeiou]*'
const mgr0 = new RegExp('^(' + C + ')?' + V + C)
const meq1 = new RegExp('^(' + C + ')?' + V + C + '(' + V + ')?$')
const mgr1 = new RegExp('^(' + C + ')?' + V + C + V + C)
const sV = new RegExp('^(' + C + ')?' + v)
const cvc = new RegExp('^' + C + v + '[^aeiouwxy]$')
export function porterStem(w) {
  if (w.length < 3) return w
  const firstch = w[0]
  if (firstch === 'y') w = 'Y' + w.slice(1)
  let m
  // Step 1a
  if ((m = /^(.+?)(ss|i)es$/.exec(w))) w = m[1] + m[2]
  else if ((m = /^(.+?)([^s])s$/.exec(w))) w = m[1] + m[2]
  // Step 1b
  if ((m = /^(.+?)eed$/.exec(w))) {
    if (mgr0.test(m[1])) w = w.slice(0, -1)
  } else if ((m = /^(.+?)(ed|ing)$/.exec(w))) {
    const stem = m[1]
    if (sV.test(stem)) {
      w = stem
      if (/(at|bl|iz)$/.test(w)) w += 'e'
      else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1)
      else if (cvc.test(w)) w += 'e'
    }
  }
  // Step 1c
  if ((m = /^(.+?)y$/.exec(w)) && sV.test(m[1])) w = m[1] + 'i'
  // Step 2
  if ((m = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/.exec(w))
      && mgr0.test(m[1])) w = m[1] + step2list[m[2]]
  // Step 3
  if ((m = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/.exec(w)) && mgr0.test(m[1])) w = m[1] + step3list[m[2]]
  // Step 4
  if ((m = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/.exec(w))) {
    if (mgr1.test(m[1])) w = m[1]
  } else if ((m = /^(.+?)(s|t)(ion)$/.exec(w))) {
    if (mgr1.test(m[1] + m[2])) w = m[1] + m[2]
  }
  // Step 5
  if ((m = /^(.+?)e$/.exec(w))) {
    const stem = m[1]
    if (mgr1.test(stem) || (meq1.test(stem) && !cvc.test(stem))) w = stem
  }
  if (/ll$/.test(w) && mgr1.test(w)) w = w.slice(0, -1)
  if (firstch === 'y') w = 'y' + w.slice(1)
  return w
}
