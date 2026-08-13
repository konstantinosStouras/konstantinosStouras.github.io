/* ==========================================================================
   PortfolioFit — favicon generator (offline; no network)
       node lab/portfoliofit/tools/make-favicon.mjs

   Writes the three icon files each app's index.html declares, for BOTH copies
   of the game — the live one and its testing twin:
       lab/portfoliofit/…          favicon.svg, favicon-32.png, apple-touch-icon.png
       lab/portfoliofit-testing/…  the same three

   ONE generator for both on purpose: lab/portfoliofit-testing/ keeps its own
   copies of shared assets (og-image.jpg is byte-identical there), and copies
   drift. Emitting both from this file means they cannot.

   The artwork IS the game: a 4x4 frame perfectly packed by four of its own
   polyominoes — the shipped "easy" solution in pf-defaults.js (I3/S/L5/T) —
   in the piece colours those specs use. Keep PIECES in step with
   pf-defaults.js if that palette ever moves. The two apps differ ONLY in the
   board behind the pieces: the live game gets the app's dark --ink board, the
   testing twin the light --bg one. That is the whole point of the variant —
   the two share a `<title>`, so without it their tabs are indistinguishable,
   and board lightness is the one difference that still reads at 16px.

   Rasterising needs Playwright's Chromium (paths overridable via PW/CHROMIUM,
   same convention as preview-guard.mjs). Pass --svg-only to skip it.
   ========================================================================== */
import { writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* --- the two apps ------------------------------------------------------- */
const TARGETS = [
  { dir: 'portfoliofit',         board: '#2b2b2b', edge: '#f6f3ee' },  // --ink
  { dir: 'portfoliofit-testing', board: '#f6f3ee', edge: '#2b2b2b' },  // --bg
];

/* --- the packing ------------------------------------------------------- */
/* (row, col) cells; together they tile the 4x4 frame with no cell left over. */
const PIECES = [
  { name: 'I3', color: '#e74c3c', cells: [[0,0],[1,0],[2,0]] },
  { name: 'S',  color: '#2ecc71', cells: [[0,1],[1,1],[1,2],[2,2]] },
  { name: 'L5', color: '#e67e22', cells: [[0,2],[0,3],[1,3],[2,3],[3,3]] },
  { name: 'T',  color: '#3498db', cells: [[2,1],[3,0],[3,1],[3,2]] },
];

const M = 9;                    // board margin inside the 100x100 card
const C = (100 - 2 * M) / 4;    // cell pitch
const G = 1.9;                  // gap between DIFFERENT pieces
const R = 3.2;                  // cell corner radius

/* the tiling is the whole point of the picture — assert it rather than trust it */
const seen = new Set();
for (const p of PIECES) for (const [r, c] of p.cells) {
  if (r < 0 || r > 3 || c < 0 || c > 3) throw new Error(`${p.name}: cell ${r},${c} is off the board`);
  if (seen.has(r + ',' + c)) throw new Error(`${p.name}: cell ${r},${c} is already taken`);
  seen.add(r + ',' + c);
}
if (seen.size !== 16) throw new Error(`the pieces leave ${16 - seen.size} cell(s) empty`);

/* --- the SVG ----------------------------------------------------------- */
const n = (v) => (Math.round(v * 100) / 100).toString();

function pieceShape(p) {
  const has = new Set(p.cells.map(([r, c]) => r + ',' + c));
  const parts = [];
  for (const [r, c] of p.cells) {
    const x = M + c * C + G / 2, y = M + r * C + G / 2, s = C - G;
    parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(s)}" height="${n(s)}" rx="${n(R)}"/>`);
    // bridge the gap to same-piece neighbours, so a piece reads as ONE shape
    if (has.has(r + ',' + (c + 1)))
      parts.push(`<rect x="${n(x + s - R)}" y="${n(y)}" width="${n(G + 2 * R)}" height="${n(s)}"/>`);
    if (has.has((r + 1) + ',' + c))
      parts.push(`<rect x="${n(x)}" y="${n(y + s - R)}" width="${n(s)}" height="${n(G + 2 * R)}"/>`);
  }
  return `  <g fill="${p.color}">\n    ${parts.join('\n    ')}\n  </g>`;
}

const svgFor = (t) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="PortfolioFit — a frame packed with project pieces">
  <title>PortfolioFit</title>
  <rect width="100" height="100" rx="21" fill="${t.board}"/>
  <rect x="${n(M - 3)}" y="${n(M - 3)}" width="${n(100 - 2 * (M - 3))}" height="${n(100 - 2 * (M - 3))}" rx="10" fill="none" stroke="${t.edge}" stroke-opacity=".22" stroke-width="1.6"/>
${PIECES.map(pieceShape).join('\n')}
</svg>
`;

for (const t of TARGETS) {
  t.svg = svgFor(t);
  await writeFile(join(LAB, t.dir, 'favicon.svg'), t.svg);
  console.log(`wrote ${t.dir}/favicon.svg`);
}

if (process.argv.includes('--svg-only')) process.exit(0);

/* --- rasterise --------------------------------------------------------- */
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const pg = await br.newPage();
for (const t of TARGETS) {
  for (const [file, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180]]) {
    await pg.setViewportSize({ width: size, height: size });
    await pg.setContent(`<html><body style="margin:0;background:transparent">
      <div style="width:${size}px;height:${size}px">${t.svg}</div></body></html>`);
    await writeFile(join(LAB, t.dir, file), await (await pg.$('div')).screenshot({ omitBackground: true }));
    console.log(`wrote ${t.dir}/${file} (${size}px)`);
  }
}
await br.close();
