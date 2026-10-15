// Full-paper evidence deliberately excludes reference lists and conference books.
export function substantiveText(text) {
  const normalized = String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2');
  const heading = [...normalized.matchAll(/\n\s*(?:\d+\.?\s*)?(?:references|bibliography|literature cited)\s*\n/gi)]
    .find(m => m.index > 2500);
  return heading ? normalized.slice(0, heading.index) : normalized;
}
export function paperWords(text) { return substantiveText(text).toLowerCase().match(/[a-z0-9]+/g) || []; }
export function paperGrams(words) { return new Set(words.slice(0, -6).map((_, i) => words.slice(i, i + 7).join(' '))); }
export function comparePapers(a, b) {
  const aw = paperWords(a), bw = paperWords(b), ag = paperGrams(aw), bg = paperGrams(bw);
  let shared = 0;
  for (const gram of ag) if (bg.has(gram)) shared++;
  return { workingWords: aw.length, publishedWords: bw.length, sharedSevenWordPassages: shared,
    containment: shared / (Math.min(ag.size, bg.size) || 1), dice: 2 * shared / (ag.size + bg.size || 1) };
}
export function substantialPaperMatch(overlap) {
  return !!overlap && Math.min(overlap.workingWords, overlap.publishedWords) >= 1000
    && overlap.sharedSevenWordPassages >= 500 && overlap.containment >= 0.5 && overlap.dice >= 0.4;
}
export function conferenceBook(front) {
  return /conference program(?:me)?|book of abstracts|abstract book|meeting program(?:me)?|program and abstracts|curriculum vitae|e.companion to|supporting information for|supplementary material for|additional (?:results|proofs|material)(?: and extensions)? (?:for|to) (?:the )?paper/i.test(String(front).slice(0, 1500));
}
export function frontMatterPublication(front, doi) {
  const text = String(front || '').toLowerCase().slice(0, 10000), needle = String(doi || '').toLowerCase();
  if (!needle) return false;
  let position = text.indexOf(needle);
  while (position >= 0) {
    const preceding = text.slice(0, position), context = text.slice(Math.max(0, position - 200), position + needle.length + 150);
    if (!/\n\s*(?:references|bibliography)\s*\n/i.test(preceding)
      && !/companion|follow.up|see also|building on|related (?:paper|work)|we extend|extending|our previous paper|prior work/i.test(context)
      && (position < 2000 || /published|accepted|forthcoming|version of record|version of this paper|to cite/i.test(context))) return true;
    position = text.indexOf(needle, position + needle.length);
  }
  return false;
}
export function earlierTitleStatement(front, title) {
  const compact = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let text=String(front || '').slice(0, 16000); const needle=compact(title);
  const references=text.search(/\n\s*(?:references|bibliography)\s*\n/i);
  if (references >= 0) text=text.slice(0,references);
  if (needle.length < 30 || !compact(text).includes(needle)) return false;
  for (const match of text.matchAll(/earlier version|previous version|previously circulated|circulated under|formerly (?:entitled|titled)|originally (?:entitled|titled)|earlier draft|earlier working.paper/gi)) {
    const context=text.slice(match.index,match.index+title.length*3+400);
    if (/\btitle\b|entitled|titled|circulated|\bcalled\b|\bas\b|\bunder\b/i.test(context.slice(0,200))
      && compact(context).includes(needle)) return true;
  }
  return false;
}
