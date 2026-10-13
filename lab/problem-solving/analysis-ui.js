/* One report model feeds both the visible report and its PDF. */
const AnalysisView = (() => {
  const A = ProblemAnalysis;
  const state = { report:null, charts:[], snapshot:null, save:'', roundId:null };
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (x, digits=1) => x===null || !Number.isFinite(x) ? 'Unavailable' : Number.isInteger(x) ? String(x) : x.toFixed(digits);
  const pct = n => { if(n===null)return 'Unavailable'; const v=Math.round(n);return v+((v%100>=11&&v%100<=13)?'th':({1:'st',2:'nd',3:'rd'}[v%10]||'th'))+' percentile'; };
  const table = (headers,rows) => `<div class="analysis-table-wrap"><table class="analysis-table"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((x,i)=>`<${i?'td':'th scope="row"'}>${esc(x)}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const benchmarkRows = r => r.metrics.map(m=>[m.label,num(m.value)+m.unit,num(m.average)+m.unit,m.bottom===null?'Unavailable':num(m.bottom)+m.unit,m.top===null?'Unavailable':num(m.top)+m.unit,pct(m.percentile),`${m.n}; tails ${m.tailN || '—'}`]);
  const headers = ['Measure','You','Average','Bottom 5% mean','Top 5% mean','Your percentile','Peers; each tail'];
  async function snapshot() {
    const data=await ProblemStore.load(),cols=A.detectColumns(data.headers);
    if (cols.attempts<0 || cols.conf<0 || cols.yesSeq<0 || cols.noSeq<0) throw new Error('Unexpected response columns');
    return { records:A.records(data.rows,cols), fetchedAt:data.fetchedAt, note:'Peer snapshot captured before this submission was sent. Your current response is excluded. Includes imported historical responses and new responses from the independent game.'+(data.excluded?' '+data.excluded+' malformed records excluded.':'') };
  }
  function startSnapshot() { state.snapshot=snapshot().catch(()=>null); return state.snapshot; }
  async function prepareSubmission() {
    // Capture peers before sending and also exclude the response ID.
    // A failed fresh fetch may reuse only a snapshot known to predate this write.
    const previous = state.snapshot;
    state.snapshot = snapshot().catch(async()=>previous ? await previous : null);
    return state.snapshot;
  }
  function personalHTML(r) {
    return `<div class="analysis-card"><p class="analysis-kicker">Your result</p><h2>${esc(r.feedback.title)}</h2>
      <div class="analysis-answer"><strong>Your answer:</strong> ${esc(r.player.rule)}<br><strong>Confidence:</strong> ${r.player.conf}/5<br><strong>The rule:</strong> any three numbers in strictly increasing order<br><strong>Answer check:</strong> ${esc(r.feedback.grade.label)} <span class="analysis-muted">(automatic interpretation)</span><p>${esc(r.feedback.grade.reason)}</p></div>
      ${r.feedback.items.map(s=>`<p>${esc(s)}</p>`).join('')}<div class="analysis-next"><strong>One useful next step</strong><p>${esc(r.feedback.next)}</p></div>
      <h3>Your evidence: ${r.player.evidence.coverage} of 6 alternatives ruled out</h3><p>${r.player.attempts} tests; ${r.player.evidence.unique} distinct sequences; ${r.player.yeses} Yes and ${r.player.nos} No.</p>
      ${table(['Alternative rule','Evidence from your tests'],r.player.evidence.checklist.map(p=>[p.label,p.covered?p.witness:'Not directly checked']))}<p class="analysis-muted">${esc(r.sequenceNote)}</p>
      <details><summary>Your test history</summary>${table(['Test','Sequence','Result'],r.player.sequences.map((s,i)=>[i+1,A.sequenceText(s),A.passes(s)?'Yes':'No']))}</details></div>`;
  }
  function tailNote(r) {
    if (r.metrics.every(m=>m.n<100)) return 'Top and bottom 5% means are unavailable until each measure has at least 100 eligible peers.';
    return 'Tail means require at least 100 eligible peers. Groups of 100–199 are marked as unstable; 200+ is preferred. '+r.metrics.filter(m=>m.unstable).map(m=>m.label+': unstable tails.').join(' ');
  }
  function peerHTML(r) {
    const accuracyRows = r.accuracy.map(x=>[x.conf+'/5',x.n ? num(x.rate)+'%' : 'Unavailable',x.n ? `${num(x.low)}–${num(x.high)}%` : 'Unavailable',x.n]);
    return `<div class="analysis-card"><div class="analysis-heading"><div><p class="analysis-kicker">Your peer comparison</p><h2>How your evidence compares</h2></div><button class="pdf-btn" data-analysis-pdf onclick="downloadPDF()">Download PDF</button></div>
      <p>${esc(r.sourceNote)}</p><p class="analysis-muted">Snapshot: ${esc(r.snapshot)}. ${r.sampleN} responses; ${r.historyN} complete histories. ${r.excludedHistories} ${r.excludedHistories===1?'history':'histories'} excluded from sequence measures. Each metric shows its own eligible count.</p>
      ${table(headers,benchmarkRows(r))}<p class="analysis-muted">${esc(r.benchmarkNote)} ${esc(tailNote(r))}</p>
      <h3>Alternatives ruled out across the sample</h3><p>Your coverage: ${r.player.evidence.coverage}/6. Peer median: ${num(r.metrics[0].median)}/6. Matching bars show peers tied with your coverage; you are not counted in the bars.</p>
      <div class="analysis-chart"><canvas id="analysis-coverage" role="img" aria-label="Peer evidence coverage distribution; numerical values in the table below"></canvas></div>
      <details><summary>Chart values and benchmark method</summary>${table(['Alternatives ruled out','Other responses'],r.coverageCounts.map((n,i)=>[i,n]))}<p>${esc(r.tieNote)}</p><p>${esc(r.limitsNote)}</p></details>
      <h3>Confidence and accuracy</h3>${r.reviewedN ? `<p>Answer phrasings audited by Codex, or explicitly reviewed by an instructor, with valid confidence (n=${r.reviewedN}). ${r.sampleN-r.reviewedN} responses excluded because their answer or confidence is not assessable. The catalogue is assistant-reviewed, not instructor-certified. Your confidence: ${r.player.conf}/5. Intervals describe uncertainty, not causation.</p><div class="analysis-chart"><canvas id="analysis-accuracy" role="img" aria-label="Audited accuracy by confidence; values and 95 percent intervals below"></canvas></div>${table(['Confidence','Audited accuracy','95% interval','n'],accuracyRows)}` : '<p>No eligible audited answer labels are available yet. Accuracy comparisons are withheld until the answers can be assessed reliably. Your personal feedback and evidence benchmarks remain available.</p>'}
      <details id="analysis-details"><summary>Explore the sample</summary><h3>How many tests did others make?</h3><div class="analysis-chart"><canvas id="analysis-attempts" role="img" aria-label="Peer test count distribution; values below"></canvas></div>${table(['Tests','Other responses'],r.attemptsCounts.map((n,i)=>[i===14?'15+':i+1,n]))}<h3>Common sequences</h3>${table(['Sequence','Distinct responses'],r.common.map(s=>[s.sequence,s.n]))}<p class="analysis-muted">One count per response per numerical sequence. Repeating a test does not increase this count. Frequency does not measure usefulness.</p></details>
      <p class="analysis-muted">${esc(r.limitsNote)}</p><p class="analysis-muted">Analysis version: ${esc(r.version)}</p></div>`;
  }
  function charts(r) {
    state.charts.forEach(c=>c.destroy()); state.charts=[];
    if (typeof Chart==='undefined') { document.querySelectorAll('.analysis-chart').forEach(e=>e.hidden=true); return; }
    const create = (id, labels, data, selected, title, max) => {
      const canvas=document.getElementById(id); if (!canvas) return;
      const chart=new Chart(canvas,{type:'bar',data:{labels,datasets:[{label:title,data,backgroundColor:labels.map((_,i)=>i===selected?'#708822':'#cad3b9'),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${title}: ${num(ctx.raw)}${id==='analysis-accuracy'?'%':''}`}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,max,ticks:{precision:0},title:{display:true,text:id==='analysis-accuracy'?'Reviewed accuracy (%)':'Other responses'}}}}});state.charts.push(chart);
    };
    create('analysis-coverage',[0,1,2,3,4,5,6],r.coverageCounts,r.player.evidence.coverage,'Responses');
    create('analysis-accuracy',[1,2,3,4,5],r.accuracy.map(x=>x.rate),r.player.conf-1,'Reviewed accuracy',100);
    const details=document.getElementById('analysis-details');
    details.addEventListener('toggle',()=>{if(details.open&&!Chart.getChart(document.getElementById('analysis-attempts'))) create('analysis-attempts',Array.from({length:15},(_,i)=>i===14?'15+':i+1),r.attemptsCounts,Math.min(r.player.attempts,15)-1,'Responses');});
  }
  async function show() {
    document.body.classList.add('analysis-mode');
    const source=await (state.snapshot || startSnapshot());
    state.report=A.makeReport({rule:document.getElementById('rule-input').value,conf:confidence,guesses,id:state.roundId},source);
    const r=state.report;
    document.getElementById('outcome-section').innerHTML=personalHTML(r);
    const el=document.getElementById('class-results');el.classList.remove('hidden');el.innerHTML=peerHTML(r);charts(r);
    const save=document.createElement('p');save.id='analysis-save';save.className='analysis-muted';save.setAttribute('role','status');save.textContent=state.save;document.getElementById('outcome-section').prepend(save);saveStatus(state.save);
  }
  function saveStatus(text) {state.save=text;const e=document.getElementById('analysis-save');if(e){e.textContent=text;if(state.retry){const button=document.createElement('button');button.type='button';button.textContent='Retry saving';button.className='pdf-btn';button.addEventListener('click',retrySave);e.append(' ',button);}}}
  async function retrySave(){
    state.retry=false;saveStatus('Saving your response…');
    try{await ProblemStore.save(state.pending);saveStatus('Response saved.');}
    catch{state.retry=true;saveStatus('Save could not be confirmed. Retry saving or keep your PDF as a record.');}
  }
  async function save(rule, conf, numAttempts) {
    if (submitted) return; submitted=true;
    state.roundId=crypto.randomUUID();
    state.pending={submissionId:state.roundId,analysisVersion:A.VERSION,rule,confidence:conf,events:guesses.map((g,i)=>({index:i+1,nums:g.nums,passes:g.passes}))};
    await retrySave();
  }
  let fontPromise;
  async function makePDF() {
    const r=state.report;if(!r)throw new Error('Wait for your results to finish loading.');
    if(!window.jspdf)throw new Error('PDF library could not load. Please reconnect and try again.');
    const pdf=new window.jspdf.jsPDF({unit:'mm',format:'a4'});
    fontPromise ||= fetch('assets/analysis-font.ttf').then(r=>{if(!r.ok)throw new Error('PDF font could not load.');return r.arrayBuffer();}).then(b=>{let s='';const a=new Uint8Array(b);for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s);}).catch(e=>{fontPromise=null;throw e;});
    pdf.addFileToVFS('Analysis.ttf',await fontPromise);pdf.addFont('Analysis.ttf','Analysis','normal');pdf.setFont('Analysis');
    const width=174,left=18,bottom=278;let y=22;
    const page=()=>{pdf.addPage();y=22;};
    const room=n=>{if(y+n>bottom)page();};
    const text=(s,size=10,color=[55,60,49])=>{pdf.setFontSize(size);pdf.setTextColor(...color);const lines=pdf.splitTextToSize(String(s),width);for(const line of lines){room(size*.46+2);pdf.text(line,left,y);y+=size*.46;}y+=3;};
    const heading=s=>{room(20);text(s,15,[49,67,32]);};
    const drawTable=(heads,rows,widths)=>{
      const draw=(cells,header=false)=>{pdf.setFontSize(8.5);const ls=cells.map((s,i)=>pdf.splitTextToSize(String(s),widths[i]-5)),height=Math.max(...ls.map(x=>x.length))*4+6;
        room(height);let x=left;pdf.setFillColor(...(header?[234,240,222]:[249,250,247]));pdf.rect(left,y-3,width,height,'F');pdf.setTextColor(35,40,30);ls.forEach((lines,i)=>{pdf.text(lines,x+2,y+1,{lineHeightFactor:1.33});x+=widths[i];});y+=height;};
      draw(heads,true);for(const row of rows){pdf.setFontSize(8.5);const h=Math.max(...row.map((s,i)=>pdf.splitTextToSize(String(s),widths[i]-5).length))*4+6;if(y+h>bottom){page();draw(heads,true);}draw(row);}y+=4;
    };
    const chart=(id,title)=>{const c=document.getElementById(id);if(!c||!c.width||!c.height||typeof Chart==='undefined'||!Chart.getChart(c))return;room(80);heading(title);const h=Math.min(62,width*c.height/c.width);pdf.addImage(c.toDataURL('image/png'),'PNG',left,y,width,h);y+=h+7;};
    heading('Your problem-solving report');text('Prof. Kostas Stouras · UCD Smurfit Graduate Business School',9);text('Analysis '+r.version+' · Snapshot: '+r.snapshot,8);
    heading(r.feedback.title);text('Your answer: '+r.player.rule);text('Confidence: '+r.player.conf+'/5');text('The rule: any three numbers in strictly increasing order');text('Answer check: '+r.feedback.grade.label+' (automatic interpretation). '+r.feedback.grade.reason);
    r.feedback.items.forEach(s=>text(s));heading('One useful next step');text(r.feedback.next);
    heading('Your evidence: '+r.player.evidence.coverage+' of 6 alternatives ruled out');text(`${r.player.attempts} tests; ${r.player.evidence.unique} distinct sequences; ${r.player.yeses} Yes and ${r.player.nos} No.`);
    drawTable(['Alternative rule','Evidence from your tests'],r.player.evidence.checklist.map(p=>[p.label,p.witness||'Not directly checked']),[80,94]);text(r.sequenceNote,9);
    page();heading('Your peer comparison');text(r.sourceNote,9);text(`${r.sampleN} responses; ${r.historyN} complete histories. ${r.excludedHistories} ${r.excludedHistories===1?'history':'histories'} excluded from sequence measures.`,9);
    drawTable(headers,benchmarkRows(r),[34,17,22,23,23,29,26]);text(r.benchmarkNote,9);text(tailNote(r),9);text(r.tieNote,8);
    chart('analysis-coverage','Alternatives ruled out across the sample');text('Coverage distribution (alternatives ruled out: other responses): '+r.coverageCounts.map((n,i)=>i+': '+n).join('; ')+'.',8);
    page();heading('Confidence and accuracy');text('Your confidence: '+r.player.conf+'/5. Answer phrasings audited by Codex, or explicitly reviewed by an instructor, with valid confidence (n='+r.reviewedN+'). '+(r.sampleN-r.reviewedN)+' responses excluded because their answer or confidence is not assessable. The catalogue is assistant-reviewed, not instructor-certified.');
    if(r.reviewedN){chart('analysis-accuracy','Reviewed accuracy by confidence');drawTable(['Confidence','Reviewed accuracy','95% interval','n'],r.accuracy.map(x=>[x.conf+'/5',x.n?num(x.rate)+'%':'Unavailable',x.n?num(x.low)+'–'+num(x.high)+'%':'Unavailable',x.n]),[36,48,54,36]);}
    else text('No eligible audited answer labels are available yet. Accuracy comparisons are withheld until the answers can be assessed reliably.');
    page();heading('Your test history');drawTable(['Test','Sequence','Result'],r.player.sequences.map((s,i)=>[i+1,A.sequenceText(s),A.passes(s)?'Yes':'No']),[18,132,24]);
    heading('Sample details');drawTable(['Tests','Responses','Tests','Responses'],Array.from({length:8},(_,i)=>[i+1,r.attemptsCounts[i],i<7?(i===6?'15+':i+9):'',i<7?r.attemptsCounts[i+8]:'']),[44,43,44,43]);drawTable(['Common sequence','Distinct responses'],r.common.map(x=>[x.sequence,x.n]),[112,62]);text('Common sequences count each response once. Frequency does not measure usefulness.',9);text(r.limitsNote,9);
    const count=pdf.internal.getNumberOfPages();for(let p=1;p<=count;p++){pdf.setPage(p);pdf.setFontSize(8);pdf.setTextColor(110,115,100);pdf.text('Problem-Solving Game · '+p+' / '+count,18,289);}
    return pdf;
  }
  async function download() {
    const buttons=[...document.querySelectorAll('[data-analysis-pdf]')];buttons.forEach(b=>b.disabled=true);
    try{(await makePDF()).save('problem-solving-insights.pdf');}catch(e){showToast(e.message,6000);}finally{buttons.forEach(b=>b.disabled=false);}
  }
  return {state,startSnapshot,prepareSubmission,show,save,saveStatus,download,makePDF,personalHTML,peerHTML};
})();

