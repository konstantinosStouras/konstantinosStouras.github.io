/* ==========================================================================
   Sustainable Supply Chains — tools/selftest.js
   Node self-test of the simulation engine: plays a complete bot game and
   asserts the properties the class is built to teach actually emerge
   (bullwhip amplification, tariff impact, sea-vs-air tradeoff, CO2/ESG
   scoring), plus determinism and accounting identities.

   Run:  node sustainable-supply-chains/tools/selftest.js
   ========================================================================== */
'use strict';
var path = require('path');
var CONFIG = require(path.join(__dirname, '..', 'config.js'));
var E = require(path.join(__dirname, '..', 'engine.js'));

var failures = 0, checks = 0;
function ok(cond, label) {
  checks++;
  if (cond) { console.log('  ok  ' + label); }
  else { failures++; console.error('FAIL  ' + label); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

function makeSession(overrides) {
  var settings = JSON.parse(JSON.stringify(CONFIG.DEFAULT_SETTINGS));
  Object.assign(settings, overrides || {});
  return { code: 'SELFTEST1', settings: settings, catalog: JSON.parse(JSON.stringify(CONFIG.CATALOG)) };
}

/* ---- unit checks ---------------------------------------------------------- */
console.log('· unit checks');
var sess = makeSession();
var cat = sess.catalog;

// distances symmetric-ish and lead times ordered
ok(E.distMm(cat, 'easia', 'europe') === E.distMm(cat, 'europe', 'easia'), 'distance symmetric');
ok(E.leadTime(sess, 'easia', 'europe', 'air', 1) === 1, 'air lead is 1 round');
ok(E.leadTime(sess, 'easia', 'europe', 'surface', 1) === 3, 'far surface lead is 3 rounds');
ok(E.leadTime(sess, 'europe', 'europe', 'surface', 1) === 1, 'domestic surface lead is 1 round');

// freight: air costs and emits ~2 orders of magnitude more than sea
var fSea = E.freightPerUnit(cat, 12, 'easia', 'europe', 'surface');
var fAir = E.freightPerUnit(cat, 12, 'easia', 'europe', 'air');
ok(fAir.cost > 40 * fSea.cost, 'air freight ≫ sea freight cost (' + fAir.cost.toFixed(0) + ' vs ' + fSea.cost.toFixed(1) + ')');
ok(fAir.co2 > 20 * fSea.co2, 'air freight ≫ sea freight CO2 (' + fAir.co2.toFixed(0) + ' vs ' + fSea.co2.toFixed(1) + ' kg)');

// tariffs: base rate + shock override from its round
ok(E.tariffRate(sess, 'namerica', 'easia', 1) === 0.10, 'base tariff into North America = 10%');
ok(E.tariffRate(sess, 'namerica', 'easia', 4) === 0.35, 'tariff shock kicks in at round 4 (35%)');
ok(E.tariffRate(sess, 'namerica', 'namerica', 4) === 0, 'no tariff on domestic flows');
ok(E.tariffRate(sess, 'namerica', 'europe', 4) === 0.10, 'shock scoped to its origin region');

// a later shock REPLACES the rate — including lowering it (trade deal)
var deal = makeSession({ tariffShocks: [
  { round: 3, importer: 'namerica', from: 'easia', rate: 35 },
  { round: 6, importer: 'namerica', from: 'easia', rate: 2 }
] });
ok(E.tariffRate(deal, 'namerica', 'easia', 4) === 0.35, 'shock raises rate from its round');
ok(E.tariffRate(deal, 'namerica', 'easia', 6) === 0.02, 'later shock can LOWER the rate (replace, not max)');

// demand: step pattern jumps at stepRound; deterministic
var d3 = E.demandFor(sess, 'europe', 3), d5 = E.demandFor(sess, 'europe', 5);
ok(d5 > d3 * 1.15, 'step demand jumps after stepRound (' + d3 + ' → ' + d5 + ')');
ok(E.demandFor(sess, 'europe', 3) === d3, 'demand deterministic');

// news: announced tariff shows the round before
var news3 = E.newsFor(sess, 3).map(function (n) { return n.text; }).join(' ');
var news4 = E.newsFor(sess, 4).map(function (n) { return n.text; }).join(' ');
ok(/ANNOUNCED/.test(news3), 'tariff announced in round 3 news');
ok(/IN EFFECT/.test(news4), 'tariff in effect in round 4 news');

/* ---- one-firm accounting check (zero starting inventory) -------------------- */
console.log('· accounting identities');
var sess0 = makeSession({ startingComponents: 0, startingFinished: 0 });
var firmA = { id: 'fa', name: 'Alpha', hub: 'europe' };
var st0 = E.initFirmState(sess0, firmA);
var dec = E.emptyDecision(sess0, 'fa', 1);
dec.orders.battery.bat_gda = { qty: 100, mode: 'surface' };      // all European suppliers:
dec.orders.frame.frm_por = { qty: 100, mode: 'surface' };        // domestic → arrive next round
dec.orders.drive.drv_stu = { qty: 100, mode: 'surface' };
dec.orders.electronics.ele_ein = { qty: 100, mode: 'surface' };
dec.production = 50; // no components on hand yet → must produce 0
var r1 = E.resolveRound(sess0, [firmA], { fa: st0 }, { fa: dec }, 1);
var res1 = r1.results.fa;
ok(res1.produced === 0, 'cannot produce without components on hand');
ok(res1.costs.purchase === 100 * (320 + 165 + 230 + 145), 'purchase cost adds up');
ok(res1.costs.inTariff === 0, 'no tariff on domestic (EU→EU) sourcing');
var expectCash = st0.cash + res1.revenue - res1.costTotal;
ok(approx(r1.states.fa.cash, expectCash, 1), 'cash identity holds');
ok(r1.states.fa.pipeline.length === 4, 'orders sit in the pipeline');
ok(r1.states.fa.pipeline.every(function (e) { return e.eta > 1; }), 'nothing arrives in the ordering round');

// arrivals + production in the next round
var d2 = E.emptyDecision(sess0, 'fa', 2); d2.production = 100;
var r2 = E.resolveRound(sess0, [firmA], r1.states, { fa: d2 }, 2);
ok(r2.results.fa.produced === 100, 'production runs once components arrive');
ok(r2.states.fa.comp.battery === 0, 'components consumed by production');
ok(r2.results.fa.co2.assembly > 0, 'assembly CO2 booked');
ok(r2.results.fa.revenue > 0, 'units sold once produced');

// tariff charged when importing across a border
var decImp = E.emptyDecision(sess0, 'fa', 1);
decImp.orders.battery.bat_szn = { qty: 100, mode: 'surface' };
var rImp = E.resolveRound(sess0, [firmA], { fa: E.initFirmState(sess0, firmA) }, { fa: decImp }, 1);
ok(rImp.results.fa.costs.inTariff === Math.round(100 * 240 * 0.05), 'import tariff charged into Europe hub');

// determinism: identical inputs → identical outputs
var r2b = E.resolveRound(sess0, [firmA], r1.states, { fa: d2 }, 2);
ok(JSON.stringify(r2) === JSON.stringify(r2b), 'resolveRound is deterministic');

// preview counts arrivals due this round, exactly like resolution
var stPrev = E.initFirmState(sess0, firmA);
stPrev.pipeline.push({ eta: 2, compId: 'battery', supplierId: 'bat_gda', qty: 80, mode: 'surface', placed: 1 });
stPrev.pipeline.push({ eta: 2, compId: 'frame', supplierId: 'frm_por', qty: 80, mode: 'surface', placed: 1 });
stPrev.pipeline.push({ eta: 2, compId: 'drive', supplierId: 'drv_stu', qty: 80, mode: 'surface', placed: 1 });
stPrev.pipeline.push({ eta: 2, compId: 'electronics', supplierId: 'ele_ein', qty: 80, mode: 'surface', placed: 1 });
var decPrev = E.emptyDecision(sess0, 'fa', 2); decPrev.production = 80;
var pv = E.previewDecision(sess0, stPrev, decPrev, 2);
var rPrev = E.resolveRound(sess0, [firmA], { fa: stPrev }, { fa: decPrev }, 2);
ok(pv.produce === 80 && rPrev.results.fa.produced === 80, 'preview production matches resolution when arrivals land');
ok(pv.prodCost === rPrev.results.fa.costs.production, 'preview production cost matches resolution');

/* ---- sea vs air: air lands next round, sea later ---------------------------- */
console.log('· logistics');
var stAir = E.initFirmState(sess, firmA);
var decAir = E.emptyDecision(sess, 'fa', 1);
decAir.orders.battery.bat_szn = { qty: 10, mode: 'air' };
var rAir = E.resolveRound(sess, [firmA], { fa: stAir }, { fa: decAir }, 1);
ok(rAir.states.fa.pipeline[0].eta === 2, 'air order arrives next round');
var decSea = E.emptyDecision(sess, 'fa', 1);
decSea.orders.battery.bat_szn = { qty: 10, mode: 'surface' };
var rSea = E.resolveRound(sess, [firmA], { fa: E.initFirmState(sess, firmA) }, { fa: decSea }, 1);
ok(rSea.states.fa.pipeline[0].eta === 4, 'sea order from East Asia to Europe takes 3 rounds');
ok(rAir.results.fa.costs.inFreight > 30 * rSea.results.fa.costs.inFreight, 'air freight premium is material');

/* ---- shared capacity: pro-rata rationing when oversubscribed ------------------ */
var firmB = { id: 'fb', name: 'Beta', hub: 'europe' };
var decA = E.emptyDecision(sess0, 'fa', 1); decA.orders.battery.bat_gda = { qty: 1500, mode: 'surface' };
var decB = E.emptyDecision(sess0, 'fb', 1); decB.orders.battery.bat_gda = { qty: 700, mode: 'surface' };
var rRation = E.resolveRound(sess0, [firmA, firmB],
  { fa: E.initFirmState(sess0, firmA), fb: E.initFirmState(sess0, firmB) },
  { fa: decA, fb: decB }, 1); // 2200 requested vs capacity 1100 → ratio 0.5
ok(rRation.results.fa.orderLines[0].qty === 750 && rRation.results.fb.orderLines[0].qty === 350,
   'oversubscribed supplier allocates pro-rata (750/350 of 1500/700)');
ok(rRation.results.fa.cut === 750 && rRation.results.fb.cut === 350, 'cut units reported');
ok(rRation.results.fa.costs.purchase === 750 * 320, 'only allocated units are charged');
// solo firm within capacity gets everything
var decCap = E.emptyDecision(sess0, 'fa', 1);
decCap.orders.battery.bat_gda = { qty: 500, mode: 'surface' };
var rCap = E.resolveRound(sess0, [firmA], { fa: E.initFirmState(sess0, firmA) }, { fa: decCap }, 1);
ok(rCap.results.fa.orderLines[0].qty === 500 && rCap.results.fa.cut === 0, 'orders within capacity uncut');

/* ---- full bot game: bullwhip + green scoring --------------------------------- */
console.log('· full 8-round bot game (4 firms)');
var game = makeSession({ eventsOn: true });
var firms = [
  { id: 'f1', name: 'Atlas SC',  hub: 'easia' },
  { id: 'f2', name: 'Borealis',  hub: 'europe' },
  { id: 'f3', name: 'Cardinal',  hub: 'namerica' },
  { id: 'f4', name: 'Verde',     hub: 'europe' }
];
var st = {}; firms.forEach(function (f) { st[f.id] = E.initFirmState(game, f); });
var lastMarket = null;
for (var r = 1; r <= game.settings.rounds; r++) {
  var ds = {};
  firms.forEach(function (f, i) {
    ds[f.id] = E.botDecision(game, f, st[f.id], r, firms.length, i === 3 ? 'green' : null);
  });
  var out = E.resolveRound(game, firms, st, ds, r);
  st = out.states;
  lastMarket = out.market;
}
var totalSold = firms.reduce(function (a, f) { return a + st[f.id].cum.sold; }, 0);
ok(totalSold > 1000, 'bots sell a substantial volume (' + totalSold + ' units)');
firms.forEach(function (f) {
  ok(st[f.id].hist.length === 8, f.name + ' has 8 history rows');
  ok(st[f.id].green >= 0 && st[f.id].green <= 100, f.name + ' green score in [0,100] (' + st[f.id].green + ')');
});
// bullwhip: at least one firm amplifies variance upstream under the step demand
var ratios = firms.map(function (f) { return E.bullwhipRatio(st[f.id]); }).filter(function (x) { return x != null; });
console.log('    bullwhip ratios: ' + ratios.join(', '));
ok(ratios.length >= 3, 'bullwhip measurable for most firms');
ok(Math.max.apply(null, ratios) > 1, 'order variance amplified vs demand (bullwhip > 1)');
// green bot ends greener than the cheapest-cost bots
var greens = firms.map(function (f) { return st[f.id].green; });
console.log('    green scores: ' + firms.map(function (f) { return f.name + '=' + st[f.id].green; }).join(', '));
ok(st.f4.green > Math.min(st.f1.green, st.f3.green), 'green-sourcing firm scores greener');
// leaderboard shape
var lb = E.leaderboard(game, firms, st);
ok(lb.length === 4 && lb[0].score >= lb[3].score, 'leaderboard sorted by blended score');
ok(lb.every(function (r2) { return isFinite(r2.profit); }), 'leaderboard profits finite');

// market clearing sanity: firm sales never exceed market demand
var over = 0;
Object.keys(lastMarket.sales).forEach(function (m) {
  var soldM = 0;
  Object.keys(lastMarket.sales[m]).forEach(function (f) { soldM += lastMarket.sales[m][f]; });
  if (soldM > lastMarket.demand[m]) over++;
});
ok(over === 0, 'market sales never exceed market demand');

// determinism of the whole game
var st2 = {}; firms.forEach(function (f) { st2[f.id] = E.initFirmState(game, f); });
for (var r2i = 1; r2i <= game.settings.rounds; r2i++) {
  var ds2 = {};
  firms.forEach(function (f, i) {
    ds2[f.id] = E.botDecision(game, f, st2[f.id], r2i, firms.length, i === 3 ? 'green' : null);
  });
  st2 = E.resolveRound(game, firms, st2, ds2, r2i).states;
}
ok(JSON.stringify(st) === JSON.stringify(st2), 'entire bot game reproducible');

/* ---- tariff shock raises landed cost ----------------------------------------- */
console.log('· tariff shock impact');
var hubNA = { id: 'fn', name: 'NA Firm', hub: 'namerica' };
function landedBatteryCost(round) {
  var d0 = E.emptyDecision(sess, 'fn', round);
  d0.orders.battery.bat_szn = { qty: 100, mode: 'surface' };
  var rr = E.resolveRound(sess, [hubNA], { fn: E.initFirmState(sess, hubNA) }, { fn: d0 }, round);
  var c = rr.results.fn.costs;
  return c.purchase + c.inTariff + c.inFreight;
}
var pre = landedBatteryCost(3), post = landedBatteryCost(4);
ok(post > pre * 1.15, 'tariff shock raises landed cost into NA (' + pre.toFixed(0) + ' → ' + post.toFixed(0) + ')');

/* ---- offsets: net falls, gross does not --------------------------------------- */
var decOff = E.emptyDecision(sess0, 'fa', 1);
decOff.orders.battery.bat_szn = { qty: 100, mode: 'surface' };
decOff.offsetTons = 3;
var rOff = E.resolveRound(sess0, [firmA], { fa: E.initFirmState(sess0, firmA) }, { fa: decOff }, 1);
ok(rOff.states.fa.cum.co2Net < rOff.states.fa.cum.co2Gross, 'offsets reduce net CO2');
ok(rOff.results.fa.co2.gross === Math.round(100 * 55 + rOff.results.fa.co2.inFreight), 'gross CO2 unaffected by offsets');
ok(rOff.results.fa.costs.offsets === 3 * sess0.settings.offsetPricePerTon, 'offset cost booked');

/* ---- carbon tax ----------------------------------------------------------------- */
var taxed = makeSession({ carbonTaxPerTon: 80, carbonTaxFromRound: 1 });
var rTax = E.resolveRound(taxed, [firmA], { fa: E.initFirmState(taxed, firmA) }, { fa: decOff }, 1);
ok(rTax.results.fa.costs.carbonTax > 0, 'carbon tax charged on gross CO2');

/* ---- xlsx writer builds a workbook (shared with the admin panel) --------------- */
console.log('· xlsx writer');
try {
  var XL = require(path.join(__dirname, '..', 'admin', 'xlsx.js'));
  var bytes = XL.build([{ name: 'Test', rows: [['a', 'b'], [1, 2]] }]);
  ok(bytes.length > 500 && bytes[0] === 0x50 && bytes[1] === 0x4B, 'xlsx bytes look like a zip');
} catch (e) {
  ok(false, 'xlsx writer: ' + e.message);
}

console.log('');
if (failures) { console.error(failures + ' of ' + checks + ' checks FAILED'); process.exit(1); }
console.log('All ' + checks + ' checks passed.');
