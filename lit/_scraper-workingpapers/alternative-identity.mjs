import {earlierTitleStatement} from './deep-evidence.mjs';
export const compact=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
function completeTitleBeforeAuthors(area,title,names){
  const normalized=area.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),positions=[];let joined='';
  for(let i=0;i<normalized.length;i++)if(/[a-z0-9]/.test(normalized[i])){joined+=normalized[i];positions.push(i);}
  const needle=compact(title),authorWords=new Set(names.flat().map(compact)),surnames=new Set(names.map(a=>compact(a.at(-1)))),fullNames=new Set(names.map(a=>compact(a.join(''))));
  const metadata=new Set('by and january february march april may june july august september october november december revised version draft working paper discussion series research article preprint date updated'.split(' '));
  for(let at=joined.indexOf(needle);at>=0;at=joined.indexOf(needle,at+needle.length)){
    const after=normalized.slice(positions[at+needle.length-1]+1).match(/[a-z]+|\d+/g)||[];
    for(const token of after.slice(0,24)){if(surnames.has(token)||fullNames.has(token))return true;if(!authorWords.has(token)&&!/^\d+$/.test(token)&&token.length!==1&&!metadata.has(token))break;}
  }
  return false;
}
export function manuscriptIdentity(text,job){
  const head=String(text).split('\f').slice(0,3).join('\n').slice(0,18000),n=compact(head);
  const names=String(job.authors||'').split(/[,;]/).map(s=>s.trim().split(/\s+/).filter(Boolean)).filter(a=>a.length);
  const count=names.filter(a=>{const last=compact(a.at(-1));return last.length>=3?n.includes(last):a.length>1&&n.includes(compact(a[0]+a.at(-1)));}).length;
  if(!names.length||count<Math.min(2,names.length))return null;
  const heading=head.search(/\n\s*(?:\d+[.\s]+)?(?:abstract|introduction)\s*\n/i);
  const titleArea=head.slice(0,heading>=0?Math.min(heading,3500):3500);
  if(compact(job.title).length>=25&&completeTitleBeforeAuthors(titleArea,job.title,names))return 'complete-front-title-and-authors';
  if(earlierTitleStatement(head,job.title))return 'explicit-earlier-title-and-authors';
  if(job.id.startsWith('pub:')&&head.slice(0,3500).toLowerCase().includes(job.id.slice(4).toLowerCase()))return 'printed-publication-doi-and-authors';
  if(!job.id.startsWith('wp:'))return null;
  const ssrn=job.id.match(/abstract_id=(\d+)/)?.[1];
  if(ssrn&&(new RegExp('ssrn[.]com[^\\n]{0,40}'+ssrn,'i').test(head)||head.toLowerCase().includes('10.2139/ssrn.'+ssrn)))return 'printed-primary-ssrn-identifier-and-authors';
  const nber=job.id.match(/nber\.org\/papers\/(w\d+)/)?.[1];
  if(nber&&(new RegExp('working paper(?: no[.]?)?\\s*'+nber.slice(1),'i').test(head)||head.toLowerCase().includes('10.3386/'+nber)))return 'printed-primary-nber-identifier-and-authors';
  const arxiv=job.id.match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+)/)?.[1]?.replace(/v\d+(?:\.pdf)?$/,'').replace(/\.pdf$/,'');
  if(arxiv&&n.includes(compact('arxiv'+arxiv)))return 'printed-primary-arxiv-identifier-and-authors';
  return null;
}
