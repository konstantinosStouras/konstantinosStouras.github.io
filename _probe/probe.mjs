// TEMPORARY probe — evidence-gathering for Nature/Science topic-filtered
// harvesting (GenAI / LLMs / innovation / science-of-science). Runs ONLY on
// the claude/nature-science-filtering-s59mno feature branch and is removed
// before merge. It answers, with real data from the Actions runner (this
// sandbox's egress blocks the scholarly APIs):
//   1. What OpenAlex topics/keywords do the owner's six example papers carry?
//   2. Which OpenAlex topics match the four themes, and how many works does
//      each contribute per journal (Nature / Science / NHB / NComms)?
//   3. How big are the journals' Crossref back-catalogues (harvest sizing)?
//   4. Are nature.com / science.org article pages readable from runner IPs
//      (i.e. is a PNAS-style subject-tag scrape CI-viable, or local-only)?
// Results: printed to the job log between markers + committed as
// _probe/results.json.

const MAILTO = 'kstouras+nsprobe@gmail.com';
const OA = 'https://api.openalex.org';
const CR = 'https://api.crossref.org';

const EXAMPLE_DOIS = [
  '10.1126/science.1136099',        // Wuchty/Jones/Uzzi 2007 (Science)
  '10.1038/s41586-019-0941-9',      // Wu/Wang/Evans 2019 (Nature)
  '10.1038/s41562-025-02173-x',     // ChatGPT idea diversity (NHB)
  '10.1038/s41562-024-01953-1',     // (NHB)
  '10.1038/s41562-025-02195-5',     // (NHB)
  '10.1038/s41467-025-61345-5',     // LLM persuasion (NComms)
];

const JOURNALS = [
  { key: 'nature', name: 'Nature', issn: '0028-0836' },
  { key: 'science', name: 'Science', issn: '0036-8075' },
  { key: 'nhb', name: 'Nature Human Behaviour', issn: '2397-3374' },
  { key: 'ncomms', name: 'Nature Communications', issn: '2041-1723' },
];

const TOPIC_SEARCHES = [
  'large language model', 'natural language processing', 'topic modeling',
  'generative artificial intelligence', 'artificial intelligence',
  'machine learning', 'deep learning',
  'scientometrics', 'bibliometrics', 'science of science', 'citation analysis',
  'research productivity', 'scientific collaboration', 'peer review',
  'innovation', 'innovation management', 'technology adoption',
  'knowledge management', 'creativity', 'team performance',
  'human-AI interaction', 'ethics of artificial intelligence',
];

// Themes the curated filter must cover; used to pick candidate topics out of
// the search results (and to bucket them in the report).
const THEME_RX = {
  genai_llm: /language model|natural language|generative|chatgpt|gpt|human-?ai|ai interaction|artificial intelligence|machine learning|deep learning|neural network/i,
  scisci: /scientometric|bibliometric|citation|science of science|research (productivity|collaboration|evaluation|funding|integrity)|peer review|scholarly|scientific (career|collaboration|workforce|misconduct)/i,
  innovation: /innovation|technolog(y|ical) (adoption|diffusion|transfer)|knowledge (management|spillover|diffusion|production)|entrepreneurship|r&d|patent/i,
  teams_creativity: /team|creativit|brainstorm|idea generation|collective intelligence|crowdsourcing/i,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': `lit-ns-probe (mailto:${MAILTO})` } });
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!res.ok) return { __error: `HTTP ${res.status}` };
      return await res.json();
    } catch (e) {
      if (i === tries - 1) return { __error: String(e) };
      await sleep(1500 * (i + 1));
    }
  }
  return { __error: 'exhausted retries' };
}

async function probePage(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    const body = res.ok ? await res.text() : '';
    const subjects = [...body.matchAll(/<meta[^>]+name="dc\.subject"[^>]+content="([^"]+)"/gi)].map((m) => m[1]);
    const subjectLinks = [...body.matchAll(/href="\/subjects\/([a-z0-9-]+)"/gi)].map((m) => m[1]);
    return {
      status: res.status,
      finalUrl: res.url,
      bytes: body.length,
      dcSubjects: [...new Set(subjects)],
      subjectSlugs: [...new Set(subjectLinks)].slice(0, 30),
    };
  } catch (e) {
    return { error: String(e) };
  }
}

function slimTopic(t) {
  return t && {
    id: (t.id || '').replace('https://openalex.org/', ''),
    name: t.display_name,
    subfield: t.subfield?.display_name,
    field: t.field?.display_name,
    works: t.works_count,
    score: t.score,
  };
}

const out = { ranAt: new Date().toISOString(), examples: [], sources: [], topicSearch: {}, counts: {}, searchCounts: {}, samples: {}, crossref: {}, pages: {} };

// ---- 1. Sources ------------------------------------------------------------
{
  const issns = JOURNALS.map((j) => j.issn).join('|');
  const j = await getJson(`${OA}/sources?filter=issn:${issns}&select=id,display_name,issn,works_count&per-page=10&mailto=${MAILTO}`);
  out.sources = (j.results || []).map((s) => ({ id: s.id?.replace('https://openalex.org/', ''), name: s.display_name, issn: s.issn, works: s.works_count }));
  for (const jr of JOURNALS) {
    const hit = out.sources.find((s) => (s.issn || []).includes(jr.issn));
    jr.sid = hit?.id;
  }
}

// ---- 2. Example papers' topics ---------------------------------------------
{
  const filter = EXAMPLE_DOIS.map((d) => `https://doi.org/${d}`).join('|');
  const j = await getJson(`${OA}/works?filter=doi:${filter}&select=doi,display_name,publication_year,primary_location,primary_topic,topics,keywords&per-page=10&mailto=${MAILTO}`);
  out.examples = (j.results || []).map((w) => ({
    doi: w.doi,
    title: w.display_name,
    year: w.publication_year,
    source: w.primary_location?.source?.display_name,
    primaryTopic: slimTopic(w.primary_topic),
    topics: (w.topics || []).map(slimTopic),
    keywords: (w.keywords || []).map((k) => k.display_name),
  }));
  out.examplesError = j.__error;
}

// ---- 3. Topic-name search ---------------------------------------------------
const candidates = new Map(); // id -> {id,name,works,themes[]}
for (const q of TOPIC_SEARCHES) {
  const j = await getJson(`${OA}/topics?search=${encodeURIComponent(q)}&select=id,display_name,subfield,field,works_count,keywords&per-page=12&mailto=${MAILTO}`);
  const res = (j.results || []).map((t) => ({
    id: t.id?.replace('https://openalex.org/', ''),
    name: t.display_name,
    subfield: t.subfield?.display_name,
    field: t.field?.display_name,
    works: t.works_count,
    keywords: (t.keywords || []).slice(0, 8),
  }));
  out.topicSearch[q] = res;
  for (const t of res) {
    const themes = Object.entries(THEME_RX).filter(([, rx]) => rx.test(t.name) || rx.test((t.keywords || []).join(' '))).map(([k]) => k);
    if (themes.length && !candidates.has(t.id)) candidates.set(t.id, { ...t, themes });
  }
  await sleep(150);
}
// Example papers' own topics are prime candidates too.
for (const ex of out.examples) {
  for (const t of ex.topics || []) {
    if (t?.id && !candidates.has(t.id)) candidates.set(t.id, { ...t, themes: ['from-example'] });
    else if (t?.id) candidates.get(t.id).themes = [...new Set([...(candidates.get(t.id).themes || []), 'from-example'])];
  }
}
out.candidates = [...candidates.values()];

// ---- 4. Per-journal counts for candidate topics ------------------------------
{
  const top = [...candidates.values()].slice(0, 45);
  for (const jr of JOURNALS) {
    if (!jr.sid) continue;
    out.counts[jr.key] = {};
    for (const t of top) {
      const j = await getJson(`${OA}/works?filter=primary_location.source.id:${jr.sid},topics.id:${t.id}&per-page=1&select=id&mailto=${MAILTO}`);
      out.counts[jr.key][`${t.id} ${t.name}`] = j.meta?.count ?? j.__error;
      await sleep(120);
    }
  }
}

// ---- 5. Per-journal title+abstract search counts ------------------------------
const SEARCH_TERMS = ['"large language model"', 'ChatGPT', '"generative AI"', '"science of science"', 'scientometrics', '"team science"', 'innovation'];
for (const jr of JOURNALS) {
  if (!jr.sid) continue;
  out.searchCounts[jr.key] = {};
  for (const term of SEARCH_TERMS) {
    const j = await getJson(`${OA}/works?filter=primary_location.source.id:${jr.sid},title_and_abstract.search:${encodeURIComponent(term)}&per-page=1&select=id&mailto=${MAILTO}`);
    out.searchCounts[jr.key][term] = j.meta?.count ?? j.__error;
    await sleep(120);
  }
}

// ---- 6. Samples: eyeball precision of the biggest combos ----------------------
{
  const sampleQueries = [];
  const byTheme = (th) => [...candidates.values()].filter((c) => c.themes.includes(th) || c.themes.includes('from-example'));
  const firstOf = (th) => byTheme(th)[0];
  for (const jr of JOURNALS.slice(0, 2)) {
    for (const th of Object.keys(THEME_RX)) {
      const t = firstOf(th);
      if (t && jr.sid) sampleQueries.push({ jr, t, th });
    }
  }
  for (const { jr, t, th } of sampleQueries) {
    const j = await getJson(`${OA}/works?filter=primary_location.source.id:${jr.sid},topics.id:${t.id}&sort=publication_date:desc&per-page=6&select=doi,display_name,publication_year&mailto=${MAILTO}`);
    out.samples[`${jr.key}|${th}|${t.name}`] = (j.results || []).map((w) => `${w.publication_year} ${w.display_name} [${w.doi}]`);
    await sleep(150);
  }
}

// ---- 7. Crossref sizing + abstract presence -----------------------------------
for (const jr of JOURNALS) {
  const j = await getJson(`${CR}/journals/${jr.issn}/works?rows=0&filter=type:journal-article&mailto=${MAILTO}`);
  out.crossref[jr.key] = { totalJournalArticles: j.message?.['total-results'] ?? j.__error };
  await sleep(150);
}
{
  out.crossref.exampleAbstracts = {};
  for (const d of EXAMPLE_DOIS) {
    const j = await getJson(`${CR}/works/${d}?mailto=${MAILTO}`);
    const m = j.message || {};
    out.crossref.exampleAbstracts[d] = { hasAbstract: !!m.abstract, abstractChars: (m.abstract || '').length, type: m.type, containerTitle: (m['container-title'] || [])[0] };
    await sleep(150);
  }
}

// ---- 8. Publisher-page accessibility from runner IPs ---------------------------
out.pages['nature-article'] = await probePage('https://www.nature.com/articles/s41586-019-0941-9');
out.pages['nature-subjects-hub'] = await probePage('https://www.nature.com/subjects/machine-learning/nature');
out.pages['science-article'] = await probePage('https://www.science.org/doi/10.1126/science.1136099');

// ---- emit ----------------------------------------------------------------------
const json = JSON.stringify(out, null, 1);
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./results.json', import.meta.url), json);
console.log('===PROBE-RESULTS-BEGIN===');
console.log(json);
console.log('===PROBE-RESULTS-END===');
