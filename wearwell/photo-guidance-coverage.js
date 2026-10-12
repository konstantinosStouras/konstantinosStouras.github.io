// Used by repository and publishing checks, never by the browser.
export function checkPhotoGuidance(languages,copy,source){
 const section=source.slice(source.indexOf('export function photosSection'),source.indexOf('function status'));
 const calls=[...section.matchAll(/\$\{t\((.*?)\)\}/g)];
 const keys=[...new Set(calls.flatMap(m=>[...m[1].matchAll(/(["'])(.*?)\1/g)].map(value=>value[2])))];
 if(!keys.length)throw Error('No photo guidance messages found. Update the coverage extractor.');
 const errors=[];
 for(const code of Object.keys(languages))for(const key of keys){
  const value=copy[code]?.[key];
  if(typeof value!=='string'||!value.trim()||(code!=='en'&&value===key))errors.push(`${code}: ${key}`);
 }
 if(errors.length)throw Error('Missing photo guidance translations:\n'+errors.join('\n'));
 return keys;
}
