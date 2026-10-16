export const plain = s => s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1').replace(/\*\*|`/g, '').trim();
export function parseCatalog(markdown) {
  markdown = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const entries = []; let topic = '', current;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+)/);
    if (heading) { topic = heading[1].trim(); current = null; continue; }
    if (!topic || topic === 'Contents' || /^---/.test(line)) continue;
    const bullet = line.match(/^(\s*)[-*]\s+(.+)/);
    if (!bullet) continue;
    if (bullet[1].length < 2 && !/^From\s+\[/i.test(bullet[2])) {
      current = {topic, title: '', description: '', details: [], links: []};
      const lead = bullet[2].match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)(.*)/);
      if (lead) { current.title = plain(lead[1]); current.url = lead[2]; current.descriptionMarkdown=lead[3].replace(/^\s*[-–—]\s*/, ''); current.description = plain(current.descriptionMarkdown); }
      else { const split = bullet[2].split(/\s[-–—]\s/); current.title = plain(split.shift()); current.description = plain(split.join(' — ')); }
      if (/(see above|see [a-z]+ above)/i.test(bullet[2]) && !lead) { current = null; continue; }
      if (!lead && current.title.length > 100) {
        const embedded = bullet[2].match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
        if (embedded) { current.title = plain(embedded[1]); current.url = embedded[2]; current.description = plain(bullet[2]); }
      }
      entries.push(current);
    } else if (current) current.details.push(bullet[2]);
  }
  for (const entry of entries) {
    const text = [entry.descriptionMarkdown || entry.description, ...entry.details].join('\n');
    entry.links = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)].map(m => ({title:plain(m[1]), url:m[2]}));
    if (!entry.url) entry.url = entry.links[0]?.url || '';
    entry.access = /agreement|permission|not available|not publicly/i.test(text) ? 'Agreement or mixed' : /access:\s*(public|free)|publicly available|free (to download|download)/i.test(text) ? 'Public' : 'Not specified';
    entry.years = (plain(text).match(/Years(?: covered)?:\s*([^.;\n]+)/i)?.[1] || '').trim();
    entry.search = plain([entry.title, entry.topic, text].join(' ')).toLowerCase();
    if (entry.topic==='Temperature') entry.search+=' climate weather rainfall precipitation';
    if (entry.topic==='Environment and energy') entry.search+=' climate environment energy';
    entry.id = entry.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    entry.geography = /worldwide|global|countries|international|multinational/i.test(entry.search) ? 'International' : /england|wales|united kingdom/i.test(entry.search) ? 'United Kingdom' : /\b(us|u\.s\.|american|census|ssa|cdc|nchs|nber|nfl|nba|mlb|congress|texas|chicago|new york|california|seattle|los angeles)\b/i.test(entry.search) ? 'United States' : 'Other / not specified';
    if (/european|europe\b/i.test(entry.search) && entry.geography === 'Other / not specified') entry.geography='Europe';
    const s=entry.search;
    entry.types=[];
    for(const [value,re] of [['Survey',/survey|diaries|interview/],['Census',/census|full.count/],['Administrative records',/administrative|registration|register|license|mortality|birth|death|tax|criminal|police|vot(er|ing)|patent/],['Geospatial data',/geocod|gridded|maps|borders|elevation|tract.level|census block/],['Research & publications',/academic|papers|publications|faculty|phd|scopus|repec/]])if(re.test(s))entry.types.push(value);
    entry.units=[];
    for(const [value,re] of [['Individuals',/individual|person|people|worker|player|graduate|offender|victim|baby|babies|child|children/],['Households',/household/],['Places & geographic areas',/county|counties|state.level|city.level|district|tract|block|countries|country|gridded|geocod/],['Firms & institutions',/firm|establishment|employer|business|universit|college|school|institution/]])if(re.test(s))entry.units.push(value);
    entry.designs=[];
    for(const [value,re] of [['Panel / longitudinal',/panel|longitudinal|follows people/],['Repeated cross-section',/repeated cross.section/],['Full count / universe',/full.count|universe/]])if(re.test(s))entry.designs.push(value);
    entry.tools=[];
    for(const [value,re] of [['API',/\bapi\b/],['R',/\br package|including r\b|r and stata|tidycensus|nflverse/],['Stata',/\bstata\b/]])if(re.test(s))entry.tools.push(value);
    entry.features=[];
    for(const [value,re] of [['Geocoded / spatial',/geocod|gridded|maps|borders|elevation|census block/],['Demographics',/demograph|\bage\b|race|ethnic|gender|\bsex\b/],['Income / earnings',/income|earning|wage|salary|salaries/],['Names / addresses',/\bnames?\b|addresses|\baddress\b/],['Text / transcripts',/transcript|text|scouting reports|abstract/],['Employment',/employ|occupation|labor|labour|job/]])if(re.test(s))entry.features.push(value);
    entry.paper = /sample paper|from \[|see \[.*(?:dataset|survey)|nature\.com\/articles|doi\.org|sciencedirect|onlinelibrary\.wiley|arxiv\.org/.test(s);
    entry.period=/present|ongoing/i.test(entry.years || text)?'Ongoing': /\b(?:1[0-9]{3}|20[0-9]{2})\s*[-–]\s*(?:1[0-9]{3}|20[0-9]{2})/.test(entry.years || text)?'Historical / fixed period':'Not specified';
    const ranges=[...entry.years.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\s*[-–]\s*(present|1[0-9]{3}|20[0-9]{2})\b/gi)];
    entry.ranges=ranges.map(m=>[Number(m[1]),m[2].toLowerCase()==='present'?new Date().getFullYear():Number(m[2])]);
    if(!ranges.length)entry.ranges=[...entry.years.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map(m=>[Number(m[1]),Number(m[1])]);
  }
  return entries;
}
export function filterEntries(entries, filters, saved = []) {
  const terms = (filters.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const listMatch=(list,value)=>!value || (value==='Not specified'?!list.length:list.includes(value));
  return entries.filter(e => terms.every(t => e.search.includes(t)) && (!filters.topic || e.topic === filters.topic) && (!filters.access || e.access === filters.access) && (!filters.geo || e.geography === filters.geo) && (filters.view !== 'saved' || saved.includes(e.id)) && listMatch(e.types,filters.type) && listMatch(e.units,filters.unit) && listMatch(e.designs,filters.design) && listMatch(e.tools,filters.tool) && listMatch(e.features,filters.feature) && (!filters.period || e.period===filters.period) && (!filters.paper || e.paper===(filters.paper==='yes')) && (!filters.year || e.ranges.some(([start,end])=>Number(filters.year)>=start&&Number(filters.year)<=end)));
}
