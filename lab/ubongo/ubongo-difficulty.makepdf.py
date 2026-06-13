#!/usr/bin/env python3
# Minimal dependency-free PDF writer for the Ubongo difficulty note.
# Uses standard-14 fonts (Helvetica family + Courier); WinAnsi-safe ASCII text.

import zlib, struct

# ---- Helvetica AFM widths (units/1000 em) for ASCII 32..126 ----
HELV = {
 ' ':278,'!':278,'"':355,'#':556,'$':556,'%':889,'&':667,"'":191,'(':333,')':333,
 '*':389,'+':584,',':278,'-':333,'.':278,'/':278,'0':556,'1':556,'2':556,'3':556,
 '4':556,'5':556,'6':556,'7':556,'8':556,'9':556,':':278,';':278,'<':584,'=':584,
 '>':584,'?':556,'@':1015,'A':667,'B':667,'C':722,'D':722,'E':667,'F':611,'G':778,
 'H':722,'I':278,'J':500,'K':667,'L':556,'M':833,'N':722,'O':778,'P':667,'Q':778,
 'R':722,'S':667,'T':611,'U':722,'V':667,'W':944,'X':667,'Y':667,'Z':611,'[':278,
 '\\':278,']':278,'^':469,'_':556,'`':333,'a':556,'b':556,'c':500,'d':556,'e':556,
 'f':278,'g':556,'h':556,'i':222,'j':222,'k':500,'l':222,'m':833,'n':556,'o':556,
 'p':556,'q':556,'r':333,'s':500,'t':278,'u':556,'v':500,'w':722,'x':500,'y':500,
 'z':500,'{':334,'|':260,'}':334,'~':584}
# Helvetica-Bold widths (only where they differ enough to matter for wrapping)
HELVB = dict(HELV)
for c,w in {'a':556,'b':611,'c':556,'d':611,'e':556,'f':333,'g':611,'h':611,'k':556,
 'm':889,'n':611,'o':611,'p':611,'q':611,'r':389,'s':556,'t':333,'u':611,'v':556,
 'w':778,'x':556,'y':556,'z':500,'A':722,'B':722,'C':722,'D':722,'E':667,'F':611,
 'G':778,'I':278,'J':556,'L':611,'M':833,'N':722,'P':667,'R':722,'S':667,'T':611,
 '.':278,',':278,'0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,
 '8':556,'9':556,':':333,'-':333,'(':333,')':333}.items():
    HELVB[c]=w

def cw(ch, font):
    if font=='Cour': return 600
    t = HELVB if font=='HelvB' else HELV
    return t.get(ch, 556)

def text_w(s, size, font):
    return sum(cw(ch,font) for ch in s)/1000.0*size

def wrap(s, size, font, maxw):
    words = s.split(' ')
    lines, cur = [], ''
    for w in words:
        trial = w if cur=='' else cur+' '+w
        if text_w(trial,size,font) <= maxw or cur=='':
            cur = trial
        else:
            lines.append(cur); cur = w
    if cur!='': lines.append(cur)
    return lines

def esc(s):
    return s.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')

# ---- page/layout state ----
PW, PH = 595.28, 841.89          # A4 pt
ML, MR, MT, MB = 56, 56, 56, 60
CW = PW - ML - MR
pages = []          # list of content-op strings
ops = []
y = PH - MT

FONT = {'Helv':'/F1','HelvB':'/F2','Cour':'/F3'}

def newpage():
    global ops, y
    if ops: pages.append('\n'.join(ops))
    ops = []
    y = PH - MT

def ensure(h):
    global y
    if y - h < MB:
        newpage()

def show(x, yy, s, size, font, color=(0.1,0.1,0.1)):
    ops.append('q %.3f %.3f %.3f rg BT %s %.1f Tf 1 0 0 1 %.2f %.2f Tm (%s) Tj ET Q'
               % (color[0],color[1],color[2],FONT[font],size,x,yy,esc(s)))

def para(s, size=11, font='Helv', lead=None, gap=4, color=(0.12,0.12,0.12), indent=0):
    global y
    lead = lead or size*1.32
    for ln in wrap(s, size, font, CW-indent):
        ensure(lead)
        show(ML+indent, y-size, ln, size, font, color)
        y -= lead
    y -= gap

def heading(s, size, font='HelvB', top=12, bot=4, rule=False, color=(0.05,0.05,0.05)):
    global y
    ensure(size+top+bot+ (6 if rule else 0))
    y -= top
    show(ML, y-size, s, size, font, color)
    y -= size
    if rule:
        y -= 3
        ops.append('q 0.7 0.7 0.7 RG 0.7 w %.2f %.2f m %.2f %.2f l S Q' % (ML, y, PW-MR, y))
    y -= bot

def bullets(items, size=11, font='Helv', gap=4):
    global y
    lead = size*1.32
    for it in items:
        lines = wrap(it, size, font, CW-18)
        for i,ln in enumerate(lines):
            ensure(lead)
            if i==0:
                show(ML+4, y-size, '-', size, font)
            show(ML+18, y-size, ln, size, font, (0.12,0.12,0.12))
            y -= lead
    y -= gap

def code_block(text, size=8.5, pad=7):
    global y
    lead = size*1.28
    lines = text.split('\n')
    h = pad*2 + lead*len(lines)
    ensure(h+6)
    top = y
    bot = y - h
    ops.append('q 0.965 0.957 0.945 rg 0.85 0.85 0.85 RG 0.6 w %.2f %.2f %.2f %.2f re B Q'
               % (ML, bot, CW, h))
    ty = top - pad - size
    for ln in lines:
        show(ML+pad, ty, ln, size, 'Cour', (0.15,0.15,0.18))
        ty -= lead
    y = bot - 8

def table(rows, widths, size=9.5, pad=6, header=True):
    # rows: list of list[str]; widths: relative fractions summing ~1
    global y
    colw = [CW*w for w in widths]
    lead = size*1.28
    def row_height(cells, fnt):
        hh = 0
        for j,c in enumerate(cells):
            n = len(wrap(c, size, fnt, colw[j]-2*pad))
            hh = max(hh, n*lead)
        return hh + 2*pad
    for ri, cells in enumerate(rows):
        fnt = 'HelvB' if (header and ri==0) else 'Helv'
        rh = row_height(cells, fnt)
        ensure(rh)
        top = y; bot = y - rh
        x = ML
        for j,c in enumerate(cells):
            if header and ri==0:
                ops.append('q 0.941 0.925 0.894 rg %.2f %.2f %.2f %.2f re f Q'%(x,bot,colw[j],rh))
            ops.append('q 0.73 0.73 0.73 RG 0.6 w %.2f %.2f %.2f %.2f re S Q'%(x,bot,colw[j],rh))
            ty = top - pad - size
            for ln in wrap(c, size, fnt, colw[j]-2*pad):
                show(x+pad, ty, ln, size, fnt, (0.13,0.13,0.13))
                ty -= lead
            x += colw[j]
        y = bot
    y -= 8

def spacer(h):
    global y; y -= h

# ============================ CONTENT ============================
heading('A Sahni-style Difficulty Measure for Ubongo', 18, 'HelvB', top=0, bot=2)
para('From the 0-1 Knapsack Problem to geometric exact cover', 10.5, 'Helv', gap=1, color=(0.3,0.3,0.3))
para('Technical note  -  stouras.com/lab/ubongo  -  June 2026', 9.5, 'Helv', gap=8, color=(0.45,0.45,0.45))

para('The board game Ubongo asks a player to fill a printed outline exactly, using a prescribed '
     'set of polyomino tiles, with no gaps and no overlaps. Computer scientists classify this as a '
     'variant of the Exact Cover Problem and a two-dimensional Bin-Packing / Knapsack problem: a '
     'fixed "capacity" (the outline) must be packed with indivisible items (the pieces). This note '
     'transfers the Sahni-k difficulty measure, originally defined for the 0-1 knapsack problem, to '
     'Ubongo, and records two complementary measures used by the live game to grade its puzzles.')

heading('1.  The knapsack / Ubongo correspondence', 13, rule=True)
table([
 ['Feature','0-1 Knapsack Problem','Ubongo'],
 ['Objective','Maximise the value of items packed into a bag without exceeding a weight limit.',
  'Fill a shaded board region exactly with geometric pieces - no overlap, no spill.'],
 ['Capacity','A scalar weight budget (e.g. 15 kg).',
  'The exact cell-outline printed on the card (an area budget and a shape).'],
 ['Items / pieces','Each item has a weight and a value.',
  'A set of polyomino (tromino / tetromino / pentomino) tiles, each of fixed area.'],
 ['Indivisibility','An item is taken whole (1) or not at all (0); no fractions.',
  'Pieces cannot be cut; each is placed whole, with rotation / reflection.'],
], [0.18,0.41,0.41])
para('The essential difference is dimensionality: knapsack feasibility is governed by a single scalar '
     '(total weight <= capacity), whereas Ubongo feasibility is governed by 2-D geometry (placements '
     'must tile a specific shape). Ubongo is therefore most precisely an instance of geometric exact '
     'cover, solvable with Knuth\'s Algorithm X / Dancing Links.')

heading('2.  The Sahni-k difficulty of a knapsack instance', 13, rule=True)
para('Sahni\'s (1975) approximation scheme S_k for the 0-1 knapsack works as follows: enumerate every '
     'subset of at most k items, force that subset into the bag, then complete the packing greedily in '
     'non-increasing value-to-weight ratio order; return the best packing found over all such subsets. '
     'As k grows the guarantee improves (relative error at most 1/(k+1)), and at k = n the method is exact.')
para('The Sahni-difficulty of an instance is the smallest k for which S_k returns the optimum.',
     11, 'HelvB', indent=14, gap=4)
para('Intuitively, it is the fewest decisions one must commit by hand before a myopic greedy rule '
     'finishes the job correctly. A value k = 0 means greedy is already optimal (easy); a large k means '
     'greedy is repeatedly led into traps and substantial search is unavoidable (hard). Two ingredients '
     'make the measure work: (i) a canonical greedy rule, and (ii) the notion of "minimum forced '
     'decisions" to reach the target. Both port to Ubongo.')

heading('3.  A Sahni-style difficulty for Ubongo', 13, rule=True)
heading('3.1  Instance', 11.5, 'HelvB', top=8, bot=2)
para('An instance is a region R of N cells together with the set of available bricks P = {p_1, ..., p_m} '
     '(here m = 8 - all bricks are available every round). A solution (tiling) places a SUBSET of the '
     'bricks - choosing an orientation (rotations and reflections allowed) and a translation for each - '
     'so that the chosen placements partition R exactly; bricks that are not needed are left unused. '
     'This is exact cover by a sub-collection, and the player\'s job is to discover which subset fits.')
heading('3.2  Canonical greedy H (the value-to-cell ratio order)', 11.5, 'HelvB', top=8, bot=2)
para('Each brick carries a dollar value; its value-per-cell ratio - dollars divided by the number of '
     'cells it occupies - is the exact analogue of the knapsack value-to-weight ratio. The greedy H '
     'considers the bricks in non-increasing order of this ratio and places each at its first feasible '
     'spot (a fixed top-to-bottom, left-to-right cell scan) if it fits, otherwise skips it; it stops '
     'once the outline is filled. Deterministic and backtrack-free, it either tiles R (success) or jams '
     '- mirroring knapsack greedy producing a feasible but sub-optimal pack.')
heading('3.3  Definition', 11.5, 'HelvB', top=8, bot=2)
para('Let H-completion(S) denote the result of running H after pre-placing a set S of piece-placements. '
     'Write k(R,P) for the difficulty. Then:')
para('k(R,P)  =  min over tilings T  of  min { |S| : S subset of T, and H-completion(S) yields a full tiling }.',
     10.5, 'Cour', indent=10, gap=4, color=(0.15,0.15,0.18))
para('In words: k is the fewest correctly-placed pieces that must be revealed before a naive greedy '
     'player can finish the board without ever getting stuck. In the live game this is literally the '
     'minimum number of times the Hint button must be pressed before greedy play coasts home.')
heading('3.4  Properties (parallel to Sahni-k)', 11.5, 'HelvB', top=8, bot=2)
bullets([
 'k = 0:  the greedy rule tiles the board outright - trivial.',
 'k = m:  every piece is a trap; the seed must contain the whole solution - pure search.',
 'k forms a hierarchy 0, 1, ..., m and is always finite, because pinning all m pieces of any known tiling completes trivially (so k <= m).',
 'Computing k is itself the Sahni-style subset enumeration; for puzzle sizes with m <= 5 it is negligible (at most 2^m <= 32 greedy runs per tiling).',
])
heading('3.5  Algorithm', 11.5, 'HelvB', top=8, bot=2)
code_block(
"function sahniDifficulty(R, P):\n"
"    if H-completion(EMPTY) tiles R:        return 0        # k = 0\n"
"    best <- m\n"
"    for each tiling T of (R, P):                           # via Algorithm X / DLX\n"
"        for k = 1 .. best-1:\n"
"            for each subset S of T with |S| = k:\n"
"                if H-completion(S) tiles R:  best <- k; break\n"
"        if best == 1:  return 1                            # cannot beat k=1 once k != 0\n"
"    return best")
para('Short-circuiting (test k = 0 first; stop at the first tiling that needs a single hint) keeps the '
     'computation fast in practice; solution enumeration is capped for robustness.', 9.5, 'Helv',
     color=(0.35,0.35,0.35))

heading('4.  Two complementary measures', 13, rule=True)
para('k captures trap structure (the Sahni spirit). Two further signals capture scarcity and human '
     'search effort, and are solver-light:')
table([
 ['Measure','What it captures','Cost'],
 ['k  (Sahni analogue)','Minimum forced hints before greedy succeeds.','O(2^m . N)'],
 ['Solution count |T|','Scarcity: a unique tiling is hardest; many tilings are forgiving.','One DLX count.'],
 ['Search nodes / backtracks','Proxy for the effort a backtracking solver (or human) expends.','One solve.'],
], [0.27,0.55,0.18])
para('The three agree at the extremes and diverge in the middle - the Ubongo version of "where are the '
     'hard knapsack problems": difficulty peaks when the number of tilings is small but positive and the '
     'pieces interlock (high k), not merely when the board is large.')

heading('5.  Use in the live game', 13, rule=True)
para('All eight bricks are available every round; the player must find the combination that fills the '
     'outline. Each brick has a dollar value, chosen so the eight value-per-cell ratios are all distinct '
     '(giving the greedy a strict order). The KPIs shown to the player mirror the Tetris app: value '
     'placed, the best value achievable on the board (the maximum-value exact cover), cells filled, and '
     'value density ($/cell).')
table([
 ['Brick','I3','L','S','T','L5','Y','P','N'],
 ['Cells','3','4','4','4','5','5','5','5'],
 ['Value','$5k','$6k','$5k','$7k','$9k','$6k','$8k','$7k'],
 ['$/cell','1667','1500','1250','1750','1800','1200','1600','1400'],
], [0.20,0.10,0.10,0.10,0.10,0.10,0.10,0.10,0.10])
para('Difficulty is the value-ratio Sahni k itself. Because the outline is generated from a real tiling, '
     'a solution always exists; the game rejection-samples outlines until k matches the tier:')
table([
 ['Tier','Outline','Defined by','Meaning'],
 ['Easy','14 cells','k <= 1','the ratio-greedy almost solves it unaided'],
 ['Hard','18 cells','k >= 3','the ratio-greedy is badly trapped - real search needed'],
], [0.12,0.16,0.20,0.52])

heading('References', 13, rule=True)
para('S. Sahni, "Approximate algorithms for the 0/1 knapsack problem," Journal of the ACM 22(1):115-124, 1975.', 9.5, 'Helv', gap=1, color=(0.3,0.3,0.3))
para('D. E. Knuth, "Dancing Links," in Millennial Perspectives in Computer Science, 2000.', 9.5, 'Helv', gap=1, color=(0.3,0.3,0.3))
para('D. Pisinger, "Where are the hard knapsack problems?" Computers & Operations Research 32(9):2271-2284, 2005.', 9.5, 'Helv', gap=2, color=(0.3,0.3,0.3))

newpage()

# ============================ ASSEMBLE PDF ============================
objs = []
def add(o): objs.append(o); return len(objs)  # returns 1-based obj number

# Fonts
f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>')
res = ('<< /Font << /F1 %d 0 R /F2 %d 0 R /F3 %d 0 R >> >>' % (f1,f2,f3))

# Pages tree (reserve number)
pages_obj_num = len(objs) + 1 + 2*len(pages) + 1  # not used; compute later
# We'll build content + page objs, then pages tree, then catalog.
content_nums = []
page_nums = []
# placeholder for pages parent
pages_parent = None

# First create the Pages object number by reserving: easier to append after.
kids = []
page_obj_ids = []
content_obj_ids = []
for c in pages:
    data = c.encode('latin-1','replace')
    comp = zlib.compress(data)
    cnum = add('<< /Length %d /Filter /FlateDecode >>\nstream\n@@BIN@@%s' % (len(comp), '@@'+str(len(objs))+'@@'))
    content_obj_ids.append(cnum)
    objs[cnum-1] = (comp,)  # store bytes marker
# We need pages parent number now:
parent_num = len(objs) + len(pages) + 1
for i,c in enumerate(pages):
    pnum = add('<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] /Resources %s /Contents %d 0 R >>'
               % (parent_num, PW, PH, res, content_obj_ids[i]))
    page_obj_ids.append(pnum)
kids_str = ' '.join('%d 0 R'%n for n in page_obj_ids)
pg = add('<< /Type /Pages /Count %d /Kids [%s] >>' % (len(page_obj_ids), kids_str))
assert pg == parent_num, (pg, parent_num)
cat = add('<< /Type /Catalog /Pages %d 0 R >>' % pg)

# Serialize
out = bytearray(b'%PDF-1.5\n%\xe2\xe3\xcf\xd3\n')
offsets = [0]*(len(objs)+1)
for i,o in enumerate(objs, start=1):
    offsets[i] = len(out)
    out += ('%d 0 obj\n'%i).encode()
    if isinstance(o, tuple):  # content stream bytes
        comp = o[0]
        out += ('<< /Length %d /Filter /FlateDecode >>\nstream\n'%len(comp)).encode()
        out += comp
        out += b'\nendstream'
    else:
        out += o.encode('latin-1','replace')
    out += b'\nendobj\n'
xref_pos = len(out)
out += ('xref\n0 %d\n'%(len(objs)+1)).encode()
out += b'0000000000 65535 f \n'
for i in range(1,len(objs)+1):
    out += ('%010d 00000 n \n'%offsets[i]).encode()
out += ('trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n'
        %(len(objs)+1, cat, xref_pos)).encode()

open('/tmp/ubongo-note/ubongo-difficulty.pdf','wb').write(out)
print('wrote PDF:', len(out), 'bytes;', len(pages), 'page(s);', len(objs), 'objects')
