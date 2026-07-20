/*
 * informs-editors-selftest.mjs — offline tests (no network) for the ISR /
 * Marketing Science Senior/Associate Editor extraction:
 *   parseInformsEditors(text)  — the History-line parser
 *   editorsFromPageHtml(html)  — the whole-page multi-window scan the local
 *                                pubsonline scraper uses
 * Fixtures mirror the phrasings INFORMS actually prints. Run:
 *   node lit/_scraper/informs-editors-selftest.mjs
 */
import { parseInformsEditors, editorsFromPageHtml } from './informs-editors.mjs';

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); fails++; } };
const eq = (got, want, msg) => ok(got === want, `${msg}${got === want ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);

console.log('parseInformsEditors: ISR phrasings');
let r = parseInformsEditors('History: Dr. Ram D. Gopal, Senior Editor; Dr. Hong Xu, Associate Editor.');
eq(r.se, 'Ram D. Gopal', 'titled "Name, Senior Editor" list — SE');
eq(r.ae, 'Hong Xu', 'titled "Name, Associate Editor" list — AE');

r = parseInformsEditors('History: Accepted by Alessandro Acquisti, Senior Editor; Il-Horn Hann, Associate Editor.');
eq(r.se, 'Alessandro Acquisti', '"Accepted by Name, Senior Editor" — verb stripped');
eq(r.ae, 'Il-Horn Hann', 'AE segment after the semicolon');

r = parseInformsEditors('History: Received October 12, 2020; revised August 3, 2021, March 14, 2022; accepted May 2, 2022. ' +
  'This paper was accepted by Rajiv Kohli, Senior Editor; Wenjing Duan, Associate Editor.');
eq(r.se, 'Rajiv Kohli', 'long dated History line — SE past the dates');
eq(r.ae, 'Wenjing Duan', 'long dated History line — AE');

r = parseInformsEditors('History: Accepted by Senior Editor Jeffrey Parsons.');
eq(r.se, 'Jeffrey Parsons', 'inverted "Accepted by Senior Editor Name"');

r = parseInformsEditors('History: Processed by Associate Editor Pallab Sanyal.');
eq(r.ae, 'Pallab Sanyal', 'inverted "Processed by Associate Editor Name"');

r = parseInformsEditors('Senior Editor: Olivia Liu Sheng. Associate Editor: Jason Thatcher.');
eq(r.se, 'Olivia Liu Sheng', 'colon form — SE');
eq(r.ae, 'Jason Thatcher', 'colon form — AE');

r = parseInformsEditors('History: Accepted by the special issue senior editors Ola Henfridsson and Peiyu Chen.');
eq(r.se, 'Ola Henfridsson; Peiyu Chen', 'special-issue senior editors, "and"-joined pair');

console.log('parseInformsEditors: Marketing Science phrasings');
r = parseInformsEditors('History: Anthony Dukes served as the senior editor for this article.');
eq(r.se, 'Anthony Dukes', '"served as the senior editor"');

r = parseInformsEditors('History: K. Sudhir served as the senior editor and Shan Yu served as associate editor for this article.');
eq(r.se, 'K. Sudhir', 'initialed name before "served as the senior editor"');
eq(r.ae, 'Shan Yu', 'second "served as associate editor" clause');

r = parseInformsEditors('History: Puneet Manchanda served as the senior editor and Yuxin Chen as associate editor for this article.');
eq(r.se, 'Puneet Manchanda', 'elided-verb pair — SE');
eq(r.ae, 'Yuxin Chen', 'elided "as associate editor" clause (no second served)');

r = parseInformsEditors('History: Received April 5, 2021; accepted March 1, 2023. Catherine Tucker served as the senior editor.');
eq(r.se, 'Catherine Tucker', 'dates before the served-as clause');

console.log('parseInformsEditors: guards');
r = parseInformsEditors('The editorial board thanks all reviewers. See the list of Senior Editors on the masthead.');
eq(r.se, '', 'masthead mention without a name yields nothing');
r = parseInformsEditors('This paper was accepted by received revisions, Senior Editor');
eq(r.se, '', 'sentence-word junk rejected by plausibleName');
r = parseInformsEditors('');
ok(r.se === '' && r.ae === '', 'empty text → empty result');

console.log('editorsFromPageHtml: page-level scan');
const dates = 'Received October 12, 2020; revised August 3, 2021, March 14, 2022, September 1, 2022; accepted May 2, 2022. '
  + 'This paper has been accepted for the Information Systems Research Special Section. '.repeat(3);
let page = `<html><body><nav>Journals; Senior Editors page</nav>
  <h1>A Paper</h1><section class="history"><b>History:</b> ${dates}
  Accepted by Rajiv Kohli, Senior Editor; Wenjing Duan, Associate Editor.</section></body></html>`;
r = editorsFromPageHtml(page);
eq(r.se, 'Rajiv Kohli', 'editors beyond the old 500-char window still found (SE)');
eq(r.ae, 'Wenjing Duan', 'editors beyond the old 500-char window still found (AE)');

page = '<html><body><p>Anna Editorless</p><div>Anthony Dukes served as the senior editor for this article.</div></body></html>';
r = editorsFromPageHtml(page);
eq(r.se, 'Anthony Dukes', 'label-less layout found via the Senior-Editor-mention window');

r = editorsFromPageHtml('<html><body><p>No editorial metadata here at all.</p></body></html>');
ok(r === null, 'page without any editor text → null (cached as a miss)');

console.log(fails ? `\nFAILED (${fails})` : '\nAll informs-editors checks passed.');
process.exit(fails ? 1 : 0);
