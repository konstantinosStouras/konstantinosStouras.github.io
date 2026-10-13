/* Conservative domain-specific grader, backed by an explicitly reviewed corpus.
   Never use edit distance to turn an unfamiliar or negated rule into a verdict. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./answer-model.js'):root.ProblemAnswerCorpus);if(typeof module==='object'&&module.exports)module.exports=api;else root.ProblemAnswerGrader=api;})(typeof globalThis!=='undefined'?globalThis:this,function(corpus){
  'use strict';
  function normalize(text){return String(text||'').normalize('NFKC').toLowerCase().replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[‐‑–—]/g,'-').replace(/[。！？]/g,'.').trim().replace(/[.!?]+$/g,'').trim().replace(/\s+/g,' ');}
  const known=new Map();
  for(const item of corpus.entries){const k=normalize(item.text),prior=known.get(k);if(prior&&prior.status!==item.status)throw Error('Conflicting reviewed labels: '+k);known.set(k,item);}
  const answer=(status,reason,method,extra={})=>({status:status==='correct'||status==='incorrect'?status:'review',reviewStatus:status,label:status==='correct'?'Correct':status==='incorrect'?'Not the rule':status==='invalid'?'No assessable rule':'Needs clarification',reason,method,version:corpus.version,...extra});
  const correct=(reason='Your answer expresses strictly increasing order without an additional numerical restriction.')=>answer('correct',reason,'semantic-rule');
  const incorrect=reason=>answer('incorrect',reason,'semantic-rule');
  const uncertain=()=>answer('unclear','This wording is not yet safely covered by the reviewed examples or the rule parser. Clarify whether each number must exceed the one immediately before it, and whether you impose any other condition. It is not counted as wrong.','needs-review');
  function lookup(text){return known.get(normalize(text))||null;}
  function grade(text){
    const old=lookup(text);if(old)return answer(old.status,old.reason,'reviewed-phrase',{reviewedRows:old.rows,reviewedBy:corpus.reviewedBy});
    let s=normalize(text);
    if(!s||/^(?:test|idk|i (?:do not|don't) know|no idea|n\/a|#(?:error|ref|value)!?)$/.test(s))return answer('invalid','No assessable rule was supplied.','semantic-rule');
    s=s.replace(/^(?:i think (?:that )?|the (?:hidden |secret )?rule (?:is|says)(?: that)? |the sequence is accepted if |it (?:is|must be) )/,'').replace(/[.!?]+$/,'').trim();
    // Learnings from observed misspellings, with no fuzzy acceptance of negation.
    s=s.replace(/\b(?:incresing|increassing|increasingf|increassing)\b/g,'increasing').replace(/\bnubers\b/g,'numbers').replace(/\bareincrease\b/g,'are increasing');
    // Explicit rejection of a narrower hypothesis is safe only in this full form.
    const rejection=s.match(/^(?:it(?:'s| is) )?not (?:doubling|multiplication|a geometric progression|a fixed (?:gap|difference)),? (?:but |just |simply )+(.+)$/);
    if(rejection)s=rejection[1];
    const noRestriction=s.match(/^(.+?)(?:[;,] | )(?:the (?:gaps|differences|increments) (?:can be anything|do not matter|don't matter)|(?:negative numbers|negatives|decimals|fractions|zero)(?:,? (?:and |or )?(?:negative numbers|negatives|decimals|fractions|zero))* (?:are allowed|also work))$/);
    if(noRestriction)s=noRestriction[1];
    const symbols=s.replace(/\band\b/g,'&').replace(/\s+/g,'');
    if(/^(?:a<b<c|c>b>a|x<y<z|z>y>x|x1<x2<x3|n1<n2<n3|a<b&b<c|b>a&c>b)$/.test(symbols))return correct();
    if(/^(?:a<=b<=c|a≤b≤c|c>=b>=a|a>b>c|c<b<a|x>y>z)$/.test(symbols))return incorrect('The comparisons allow equality or require decreasing order. The game requires first < second < third.');
    // Full-expression matches prevent "increasing ... plus an extra condition"
    // from being accepted just because it contains an ordering keyword.
    const noun='(?:(?:any|all|the|these) )?(?:(?:three|3) )?(?:numbers?|values?|sequence)';
    const order='(?:(?:strictly|always) )?(?:increasing|ascending)(?: (?:order|sequence|values))?(?: from (?:left to right|smallest to largest|least to greatest|small to big|low to high))?';
    if(new RegExp('^(?:'+noun+' (?:(?:must |have to |should |need to )?be |are |is |in |arranged in |sorted in |ordered in )*'+order+'|'+order+'(?: (?:numbers?|values?))?)(?: in (?:size|value))?$').test(s))return correct();
    if(/^(?:each|every|the next|each successive|each subsequent) (?:number|value) (?:must |should |has to |needs to |is |must be |should be |be )*(?:(?:strictly )?(?:greater|larger|bigger|higher) than|exceed(?:s)?) (?:the )?(?:previous|preceding|prior|last)(?: (?:one|number|value))?$/.test(s))return correct();
    if(/^(?:any |the )?(?:three |3 )?(?:numbers|values) (?:must |should |have to )?(?:go|rise|increase) (?:up|from (?:left to right|small to big|low to high|smallest to largest))(?: in (?:size|value))?$/.test(s))return correct();
    if(/^(?:the )?first (?:number|value) (?:must be |is |must )?(?:less|smaller|lower) than (?:the )?second(?: number| value)?[,;]? and (?:the )?second (?:number|value) (?:must be |is |must )?(?:less|smaller|lower) than (?:the )?third(?: number| value)?$/.test(s))return correct();
    if(/^(?:each|every|the next) (?:number|value) (?:must be |is |should be )?(?:greater|larger|bigger|higher) than (?:the )?(?:one|number|value) (?:immediately )?before(?: it)?$/.test(s))return correct();
    if(/^(?:the )?(?:middle|second) (?:number|value) (?:must be |is )?(?:greater|larger|bigger|higher|more) than (?:the )?(?:first|left)(?: number| value)? and (?:less|smaller|lower) than (?:the )?(?:third|right|last)(?: number| value)?$/.test(s))return correct();
    if(/^(?:the )?(?:three |3 )?(?:numbers|values) (?:must be |are |should be )?(?:strictly )?(?:decreasing|descending|nondecreasing|non-decreasing)(?: order| in order)?$/.test(s)||/^(?:increasing|ascending)(?: order)? (?:with |and )?(?:ties|equal values|equal numbers) (?:allowed|permitted)$/.test(s))return incorrect('Decreasing order and equal adjacent values fail. The rule requires strictly increasing values.');
    // Clear restrictive rules, never their negated/qualified mention.
    if(!/\b(?:not|no|any|or|regardless|without|rather|instead|ignore|isn't|aren't|doesn't|don't)\b/.test(s)){
      if(/^(?:(?:each|every|the next|the subsequent) (?:number|value) (?:is |must be )?)?(?:double|twice)(?: (?:the )?(?:previous|preceding|last)(?: number| value| one)?)?$/.test(s)||/^(?:multiply|times|x|\*) (?:by )?(?:2|two)$/.test(s))return incorrect('Doubling is too restrictive. (1, 2, 3) passes even though it does not double.');
      if(new RegExp('^(?:'+noun+' )?(?:(?:must |should )?be |are |in )*(?:(?:strictly )?(?:increasing|ascending)(?: order)? (?:and |using |with )?)?(?:only )?(?:positive |even |odd |consecutive )?(?:integers|positive numbers|even numbers|odd numbers|consecutive numbers)(?: in (?:strictly )?(?:increasing|ascending) order)?$').test(s))return incorrect('The rule does not require positive values, integers, parity or consecutive numbers. It requires strictly increasing order.');
      if(/^(?:numbers |the numbers )?(?:increase|go up|increment) by (?:one|two|three|\d+(?:\.\d+)?) (?:each time|at each step)$/.test(s))return incorrect('A fixed increment is too restrictive. (1, 3, 8) also passes.');
    }
    return uncertain();
  }
  return {normalize,lookup,grade,version:corpus.version,corpus};
});

