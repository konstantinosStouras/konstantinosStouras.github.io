import {parseCatalog} from './catalog.mjs';
export function mergeResearch(base, catalog) {
  const merged=[...base];
  for(const record of catalog.datasets){
    const papers=record.paperDois.map(doi=>catalog.papers[doi]);
    if(papers.some(p=>!p))throw new Error('A dataset citation is missing');
    const markdown=`### ${record.topic}\n- [${record.title}](${record.url}) - ${record.description}\n  - Years: ${record.years || 'not specified'}. Access: ${record.access}\n${record.notes.map(n=>'  - '+n).join('\n')}\n${record.links.map(l=>`  - [${l.title}](${l.url})`).join('\n')}`;
    const parsed=parseCatalog(markdown)[0];
    const entry={...parsed,...record,papers,research:true,paper:true,details:[...record.notes,...record.links.map(l=>`[${l.title}](${l.url})`),record.verification]};
    entry.search+=' '+[...record.tags,...papers.map(p=>`${p.title} ${p.authors} ${p.journal} ${p.year} ${p.doi}`)].join(' ').toLowerCase();
    const existing=merged.findIndex(e=>e.url===record.url || e.id===record.id);
    if(existing>=0)merged[existing]={...merged[existing],...entry};else merged.push(entry);
  }
  return merged;
}
