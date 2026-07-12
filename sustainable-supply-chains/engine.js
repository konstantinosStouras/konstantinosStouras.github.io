/* ==========================================================================
   Sustainable Supply Chains — engine.js
   The pure, deterministic simulation engine. No DOM, no network, no Date —
   everything derives from the session object (settings + catalog + code) and
   the round number, so the admin's browser, a student's preview, the bots and
   tools/selftest.js all compute identical results.

   What the model teaches (and where it lives):
     · Bullwhip effect ..... supplier lead times (1–3 rounds) + demand patterns
                             (step/seasonal/walk) + lost sales → firms over/under
                             order; bullwhipRatio() measures Var(orders)/Var(demand).
     · Logistics ........... sea/surface vs air per order: cost & CO2 per kg·Mm
                             vs lead time; port congestion events add +1 lead.
     · Competition ......... per-market multinomial logit on price, green score
                             and brand, with an outside option.
     · Tariffs ............. % on customs value of every border crossing
                             (components into the hub, finished goods into a
                             market), plus scheduled mid-game shocks.
     · Sourcing ............ per-component supplier mix under capacity (spot
                             premium above capacity) and disruption events.
     · CO2/ESG sourcing .... component embodied CO2 + freight CO2 + assembly,
                             supplier ESG ratings (audits mitigate scandal risk),
                             carbon tax on gross, offsets reduce net only.

   Round timeline (round r):
     decisions open → firms order components (arrive at r+lead), set production,
     prices, investments → admin resolves: arrivals land, production runs,
     markets clear via logit, money & CO2 are booked, green/brand update.

   Exposed as window.SSCEngine (browser) / module.exports (Node).
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SSCEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- deterministic RNG --------------------------------------------------- */
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // One-shot uniform in [0,1) from a list of key parts — the workhorse for all
  // seeded randomness (demand noise, events, scandals). Stable across runs.
  function rand(parts) { return mulberry32(hashStr(parts.join('§')))(); }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : (d || 0); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }

  /* ---- catalog lookups ------------------------------------------------------ */
  function distMm(catalog, a, b) {
    if (a === b) return catalog.sameRegionDist;
    var k = a < b ? a + '|' + b : b + '|' + a;
    return catalog.distances[k] != null ? catalog.distances[k] : 12;
  }
  function surfaceLead(catalog, d) { return d <= catalog.sameRegionDist ? 1 : (d < 6 ? 2 : 3); }

  // Lead time in rounds for an order on a lane, including congestion events.
  function leadTime(session, from, to, mode, round) {
    var d = distMm(session.catalog, from, to);
    var lead = mode === 'air' ? 1 : surfaceLead(session.catalog, d);
    if (mode !== 'air') {
      var ev = eventsFor(session, round);
      if (ev.congestion[from] || ev.congestion[to]) lead += 1;
    }
    return lead;
  }

  function freightPerUnit(catalog, weightKg, from, to, mode) {
    var m = catalog.modes[mode] || catalog.modes.surface;
    var d = distMm(catalog, from, to);
    return { cost: weightKg * d * m.costPerKgMm, co2: weightKg * d * m.co2PerKgMm };
  }

  function findComponent(catalog, compId) {
    for (var i = 0; i < catalog.components.length; i++)
      if (catalog.components[i].id === compId) return catalog.components[i];
    return null;
  }
  function findSupplier(comp, supId) {
    for (var i = 0; i < comp.suppliers.length; i++)
      if (comp.suppliers[i].id === supId) return comp.suppliers[i];
    return null;
  }
  function findMarket(catalog, mid) {
    for (var i = 0; i < catalog.markets.length; i++)
      if (catalog.markets[i].id === mid) return catalog.markets[i];
    return null;
  }
  function activeMarkets(session) {
    var ids = session.settings.markets || [];
    return session.catalog.markets.filter(function (m) { return ids.indexOf(m.id) !== -1; });
  }

  /* ---- tariffs --------------------------------------------------------------
     Base rate per importing region + scheduled shocks. A shock REPLACES the
     rate for its importer/from pair from its round onward (so a shock can cut
     a tariff too — trade deals happen). Among applicable shocks, the latest
     round wins; on a tie, an origin-specific shock beats an 'anywhere' one.
     'from' omitted = all origins. No tariff on domestic (same-region) flows.
     Returns a fraction (0.35 = 35%). */
  function tariffRate(session, importer, from, round) {
    if (importer === from) return 0;
    var s = session.settings;
    var rate = num((s.tariffBase || {})[importer], 0);
    var shocks = s.tariffShocks || [];
    var best = null;
    for (var i = 0; i < shocks.length; i++) {
      var sh = shocks[i];
      if (round < num(sh.round, 1) || sh.importer !== importer) continue;
      if (sh.from && sh.from !== from) continue;
      if (!best || num(sh.round, 1) > num(best.round, 1) ||
          (num(sh.round, 1) === num(best.round, 1) && sh.from && !best.from)) best = sh;
    }
    if (best) rate = num(best.rate, 0);
    return rate / 100;
  }

  /* ---- demand ----------------------------------------------------------------
     Total consumer demand for a market in a round: base size × pattern factor
     × noise. Deterministic per (session code, market, round). Firms never see
     the pattern — they experience it through their own sales. */
  function demandFactor(session, round) {
    var s = session.settings, p = s.demandPattern || 'stable';
    if (p === 'step') return round >= num(s.stepRound, 4) ? num(s.stepFactor, 1.5) : 1;
    if (p === 'seasonal') return 1 + 0.35 * Math.sin(2 * Math.PI * (round - 1) / 6);
    if (p === 'walk') {
      var f = 1;
      for (var r = 2; r <= round; r++) f *= 1 + 0.12 * (rand([session.code, 'walk', r]) * 2 - 1);
      return clamp(f, 0.4, 2.5);
    }
    return 1;
  }
  function demandFor(session, marketId, round) {
    var m = findMarket(session.catalog, marketId);
    if (!m) return 0;
    var noise = 1 + num(session.settings.demandNoise, 0) * (rand([session.code, 'demand', marketId, round]) * 2 - 1);
    var scale = num(session.settings.demandScale, 1) || 1;
    return Math.max(0, Math.round(m.size * scale * demandFactor(session, round) * noise));
  }

  /* ---- world events -----------------------------------------------------------
     Deterministic per (session, round); the same events hit every firm, like a
     real shared world. disruptions[region] halves that region's supplier
     capacity for the round; congestion[region] adds +1 surface lead on lanes
     touching it. */
  function eventsFor(session, round) {
    var out = { disruptions: {}, congestion: {} };
    if (!session.settings.eventsOn || round < 2) return out;
    var regions = Object.keys(session.catalog.regions);
    for (var i = 0; i < regions.length; i++) {
      var rg = regions[i];
      if (rand([session.code, 'disrupt', rg, round]) < 0.08) out.disruptions[rg] = true;
      else if (rand([session.code, 'congest', rg, round]) < 0.06) out.congestion[rg] = true;
    }
    return out;
  }

  /* News feed shown when a round opens (and stored with results): world events
     plus tariff/carbon-tax announcements. */
  function newsFor(session, round) {
    var items = [], s = session.settings, cat = session.catalog;
    var ev = eventsFor(session, round);
    Object.keys(ev.disruptions).forEach(function (rg) {
      items.push({ type: 'disruption', text: 'Supply disruption in ' + cat.regions[rg].name +
        ' — supplier capacity there is halved this round.' });
    });
    Object.keys(ev.congestion).forEach(function (rg) {
      items.push({ type: 'congestion', text: 'Port congestion in ' + cat.regions[rg].name +
        ' — surface shipments touching it take +1 round this round.' });
    });
    (s.tariffShocks || []).forEach(function (sh) {
      var who = cat.regions[sh.importer] ? cat.regions[sh.importer].name : sh.importer;
      var from = sh.from && cat.regions[sh.from] ? ' on goods from ' + cat.regions[sh.from].name : '';
      if (round === num(sh.round, 1)) {
        items.push({ type: 'tariff', text: 'TARIFF IN EFFECT: ' + who + ' now charges ' + sh.rate + '%' + from + '.' });
      } else if (sh.announce && round === num(sh.round, 1) - 1) {
        items.push({ type: 'tariff', text: 'TARIFF ANNOUNCED: from next round, ' + who + ' will charge ' + sh.rate + '%' + from + '.' });
      }
    });
    if (num(s.carbonTaxPerTon, 0) > 0 && round === num(s.carbonTaxFromRound, 1)) {
      items.push({ type: 'carbon', text: 'Carbon tax in effect: $' + s.carbonTaxPerTon + ' per tonne of gross CO2.' });
    }
    return items;
  }

  /* ---- firm state ------------------------------------------------------------ */
  function initFirmState(session, firm) {
    var comp = {};
    session.catalog.components.forEach(function (c) {
      comp[c.id] = Math.round(num(session.settings.startingComponents, 0) * c.qty);
    });
    return {
      firmId: firm.id, hub: firm.hub,
      cash: num(session.settings.startingCash, 150000),
      brand: 50, green: 50,
      comp: comp, pipeline: [], fg: Math.round(num(session.settings.startingFinished, 0)),
      renewable: false, audits: [],
      cum: { profit: 0, revenue: 0, co2Gross: 0, co2Net: 0, produced: 0, sold: 0,
             offsets: 0, spend: 0, esgSpend: 0, prodCO2: 0, scandals: 0 },
      hist: []   // one row per resolved round: {round, demand, sold, lost, ordered, profit, co2Gross, green, brand, cash}
    };
  }

  function emptyDecision(session, firmId, round) {
    var orders = {};
    session.catalog.components.forEach(function (c) { orders[c.id] = {}; });
    var prices = {};
    activeMarkets(session).forEach(function (m) { prices[m.id] = m.refPrice; });
    return { firmId: firmId, round: round, orders: orders, production: 0, prices: prices,
             offsetTons: 0, buyRenewable: false, auditSuppliers: [], submitted: false };
  }

  // Sanitize anything coming from the UI / storage into a safe decision.
  function sanitizeDecision(session, firmId, round, d) {
    var out = emptyDecision(session, firmId, round);
    if (!d) return out;
    session.catalog.components.forEach(function (c) {
      var src = (d.orders || {})[c.id] || {};
      c.suppliers.forEach(function (sup) {
        var o = src[sup.id];
        if (!o) return;
        var qty = clamp(Math.round(num(o.qty, 0)), 0, 99999);
        if (qty > 0) out.orders[c.id][sup.id] = { qty: qty, mode: o.mode === 'air' ? 'air' : 'surface' };
      });
    });
    out.production = clamp(Math.round(num(d.production, 0)), 0, 99999);
    activeMarkets(session).forEach(function (m) {
      var p = num((d.prices || {})[m.id], m.refPrice);
      out.prices[m.id] = clamp(Math.round(p), Math.round(m.refPrice * 0.3), Math.round(m.refPrice * 3));
    });
    out.offsetTons = clamp(Math.round(num(d.offsetTons, 0)), 0, 100000);
    out.buyRenewable = !!d.buyRenewable;
    out.auditSuppliers = Array.isArray(d.auditSuppliers) ? d.auditSuppliers.slice(0, 40) : [];
    out.submitted = !!d.submitted;
    return out;
  }

  function effectiveEsg(sup, audits) {
    return clamp(sup.esg + (audits.indexOf(sup.id) !== -1 ? 15 : 0), 0, 100);
  }

  /* ---- shared supplier capacity ------------------------------------------------
     Suppliers have ONE capacity pool per round shared across ALL firms. When
     total requests exceed it (after disruption halving), every firm's order is
     cut pro-rata and only allocated units are charged/shipped — real-world
     rationing, and Lee et al.'s "shortage gaming" driver of the bullwhip.
     Returns {supplierId: ratio 0..1}. */
  function allocationRatios(session, decisions, round) {
    var ev = eventsFor(session, round);
    var requested = {};
    Object.keys(decisions).forEach(function (fid) {
      var d = decisions[fid];
      if (!d) return;
      session.catalog.components.forEach(function (c) {
        c.suppliers.forEach(function (sup) {
          var o = d.orders[c.id] && d.orders[c.id][sup.id];
          if (o && o.qty) requested[sup.id] = (requested[sup.id] || 0) + o.qty;
        });
      });
    });
    var ratios = {};
    session.catalog.components.forEach(function (c) {
      c.suppliers.forEach(function (sup) {
        var cap = sup.capacity * (ev.disruptions[sup.region] ? 0.5 : 1);
        var req = requested[sup.id] || 0;
        ratios[sup.id] = req > cap ? cap / req : 1;
      });
    });
    return ratios;
  }

  /* ---- the ordering leg: cost / CO2 / pipeline entries for one decision ------
     Shared by resolveRound and previewDecision so the student's on-screen
     estimate always matches the resolution exactly (preview passes no ratios =
     assume full allocation; the UI warns that oversubscribed suppliers cut
     orders pro-rata). Only ALLOCATED units are charged and shipped. */
  function computeOrders(session, state, decision, round, allocRatios) {
    var cat = session.catalog;
    var out = { purchase: 0, freight: 0, tariff: 0, co2Comp: 0, co2Freight: 0,
                entries: [], kitsOrdered: 0, esgSpend: 0, lines: [], cut: 0 };
    var compLines = 0;
    cat.components.forEach(function (c) {
      var perComp = 0;
      c.suppliers.forEach(function (sup) {
        var o = decision.orders[c.id] && decision.orders[c.id][sup.id];
        if (!o || !o.qty) return;
        var ratio = allocRatios && allocRatios[sup.id] != null ? allocRatios[sup.id] : 1;
        var requested = o.qty, mode = o.mode;
        var qty = Math.floor(requested * ratio);
        var purchase = qty * sup.cost;
        var fr = freightPerUnit(cat, c.weightKg, sup.region, state.hub, mode);
        var tariff = purchase * tariffRate(session, state.hub, sup.region, round);
        var lead = leadTime(session, sup.region, state.hub, mode, round);
        out.purchase += purchase;
        out.freight += fr.cost * qty; out.tariff += tariff;
        out.co2Comp += qty * sup.co2; out.co2Freight += fr.co2 * qty;
        out.esgSpend += purchase * effectiveEsg(sup, state.audits.concat(decision.auditSuppliers || []));
        out.cut += requested - qty;
        if (qty > 0) out.entries.push({ eta: round + lead, compId: c.id, supplierId: sup.id, qty: qty, mode: mode, placed: round });
        out.lines.push({ compId: c.id, supplierId: sup.id, requested: requested, qty: qty,
                         cut: requested - qty, mode: mode, lead: lead,
                         cost: purchase + fr.cost * qty + tariff, co2: qty * sup.co2 + fr.co2 * qty });
        perComp += requested; // bullwhip measures the ORDER signal sent upstream
      });
      compLines++;
      out.kitsOrdered += perComp;
    });
    out.kitsOrdered = compLines ? out.kitsOrdered / compLines : 0; // avg units requested per BOM line ≈ "kits"
    out.total = out.purchase + out.freight + out.tariff;
    return out;
  }

  // State with this round's due arrivals landed — what production can really
  // draw on when the round resolves. Used by the preview and the bots so both
  // match resolveRound exactly.
  function withArrivals(session, state, round) {
    var st = clone(state);
    (st.pipeline || []).forEach(function (e) {
      if (e.eta <= round) st.comp[e.compId] = (st.comp[e.compId] || 0) + e.qty;
    });
    return st;
  }

  /* ---- preview (student UI): what this decision costs before submitting ----- */
  function previewDecision(session, state, decision, round) {
    var s = session.settings, cat = session.catalog;
    var ord = computeOrders(session, state, decision, round);
    var invest = (decision.buyRenewable && !state.renewable ? num(s.renewableCapex, 0) : 0) +
      (decision.auditSuppliers || []).filter(function (id) { return state.audits.indexOf(id) === -1; }).length * num(s.auditCost, 0) +
      decision.offsetTons * num(s.offsetPricePerTon, 25);
    var availKits = kitsAvailable(session, withArrivals(session, state, round));
    var produce = Math.min(decision.production, num(s.factoryCapacity, 500), availKits);
    var prodCost = produce * cat.product.assemblyCost;
    return {
      orders: ord, invest: invest, produce: produce, availKits: availKits,
      prodCost: prodCost,
      cashOut: ord.total + invest + prodCost + num(s.overheadPerRound, 0),
      cashAfterSpend: state.cash - ord.total - invest - prodCost - num(s.overheadPerRound, 0)
    };
  }

  function kitsAvailable(session, state) {
    var avail = Infinity;
    session.catalog.components.forEach(function (c) {
      avail = Math.min(avail, Math.floor((state.comp[c.id] || 0) / c.qty));
    });
    return isFinite(avail) ? avail : 0;
  }

  /* ---- market clearing: multinomial logit with an outside option ------------- */
  function marketShares(session, market, offers) {
    // offers: [{firmId, price, green, brand, hasStock}]
    var gs = num(session.settings.greenSensitivity, 1);
    var utils = offers.map(function (o) {
      if (!o.hasStock) return null;
      var u = market.priceBeta * (market.refPrice - o.price) / market.refPrice +
              market.greenBeta * gs * (o.green - 50) / 50 +
              market.brandBeta * (o.brand - 50) / 50;
      return Math.exp(clamp(u, -8, 8));
    });
    var denom = 1 + sum(utils.map(function (u) { return u || 0; })); // 1 = outside option
    return offers.map(function (o, i) { return utils[i] == null ? 0 : utils[i] / denom; });
  }

  /* ---- resolveRound: the whole world takes one step ---------------------------
     firms: [{id, name, hub}], states: {firmId: state}, decisions: {firmId: decision|null}.
     Returns { results: {firmId: result}, market: marketRound, states: {firmId: newState}, news }.
     Never mutates its inputs. */
  function resolveRound(session, firms, states, decisions, round) {
    var s = session.settings, cat = session.catalog;
    var newStates = {}, work = {};

    // sanitize every decision first, then compute shared-capacity allocation
    var sane = {};
    firms.forEach(function (f) { sane[f.id] = sanitizeDecision(session, f.id, round, decisions[f.id]); });
    var ratios = allocationRatios(session, sane, round);

    // -- supply phase per firm: arrivals, orders, production, investments
    firms.forEach(function (f) {
      var st = clone(states[f.id] || initFirmState(session, f));
      var d = sane[f.id];
      // arrivals
      var pipe = [];
      st.pipeline.forEach(function (e) {
        if (e.eta <= round) st.comp[e.compId] = (st.comp[e.compId] || 0) + e.qty;
        else pipe.push(e);
      });
      st.pipeline = pipe;
      // orders (allocated pro-rata when suppliers are oversubscribed)
      var ord = computeOrders(session, st, d, round, ratios);
      st.pipeline = st.pipeline.concat(ord.entries);
      // investments
      var investCost = 0;
      if (d.buyRenewable && !st.renewable) { st.renewable = true; investCost += num(s.renewableCapex, 0); }
      (d.auditSuppliers || []).forEach(function (id) {
        if (st.audits.indexOf(id) === -1) { st.audits.push(id); investCost += num(s.auditCost, 0); }
      });
      var offsetCost = d.offsetTons * num(s.offsetPricePerTon, 25);
      // production
      var availKits = kitsAvailable(session, st);
      var produced = Math.min(d.production, num(s.factoryCapacity, 500), availKits);
      cat.components.forEach(function (c) { st.comp[c.id] -= produced * c.qty; });
      st.fg += produced;
      var assemblyCO2 = produced * (st.renewable ? cat.product.assemblyCO2Renewable : cat.product.assemblyCO2);
      work[f.id] = { st: st, d: d, ord: ord, investCost: investCost, offsetCost: offsetCost,
                     produced: produced, assemblyCO2: assemblyCO2 };
    });

    // -- market phase: demand + logit shares per market, then per-firm rationing
    var mkts = activeMarkets(session);
    var marketRound = { round: round, demand: {}, sales: {}, avgPrice: {} };
    var desired = {}; // firmId -> {marketId: desired units}
    firms.forEach(function (f) { desired[f.id] = {}; });
    mkts.forEach(function (m) {
      var D = demandFor(session, m.id, round);
      marketRound.demand[m.id] = D;
      var offers = firms.map(function (f) {
        var w = work[f.id];
        return { firmId: f.id, price: w.d.prices[m.id] != null ? w.d.prices[m.id] : m.refPrice,
                 green: w.st.green, brand: w.st.brand, hasStock: w.st.fg > 0 };
      });
      var shares = marketShares(session, m, offers);
      offers.forEach(function (o, i) { desired[o.firmId][m.id] = D * shares[i]; });
    });
    // proportional rationing of each firm's finished stock across markets
    var soldBy = {};
    firms.forEach(function (f) {
      var w = work[f.id], want = desired[f.id];
      var totalWant = sum(mkts.map(function (m) { return want[m.id] || 0; }));
      var scale = totalWant > w.st.fg && totalWant > 0 ? w.st.fg / totalWant : 1;
      var sold = {}, totalSold = 0;
      mkts.forEach(function (m) {
        var u = Math.floor((want[m.id] || 0) * scale);
        sold[m.id] = u; totalSold += u;
      });
      // hand out remaining whole units (rounding leftovers) to the biggest markets
      var left = Math.min(w.st.fg, Math.round(totalWant * scale)) - totalSold;
      var order = mkts.slice().sort(function (a, b) { return (want[b.id] || 0) - (want[a.id] || 0); });
      for (var i = 0; i < order.length && left > 0; i++) { sold[order[i].id]++; totalSold++; left--; }
      soldBy[f.id] = { sold: sold, totalSold: totalSold, lost: Math.max(0, Math.round(totalWant - totalSold)) };
      w.st.fg -= totalSold;
    });
    mkts.forEach(function (m) {
      marketRound.sales[m.id] = {};
      var pSum = 0, n = 0;
      firms.forEach(function (f) {
        marketRound.sales[m.id][f.id] = soldBy[f.id].sold[m.id] || 0;
        pSum += work[f.id].d.prices[m.id] || m.refPrice; n++;
      });
      marketRound.avgPrice[m.id] = n ? Math.round(pSum / n) : m.refPrice;
    });

    // -- financial + sustainability wrap-up per firm
    var results = {};
    firms.forEach(function (f) {
      var w = work[f.id], st = w.st, d = w.d, sb = soldBy[f.id];
      var revenue = 0, outFreight = 0, outTariff = 0;
      mkts.forEach(function (m) {
        var units = sb.sold[m.id] || 0;
        if (!units) return;
        var price = d.prices[m.id];
        revenue += units * price;
        var fr = freightPerUnit(cat, cat.product.weightKg, st.hub, m.region, 'surface');
        outFreight += fr.cost * units;
        outTariff += units * price * 0.6 * tariffRate(session, m.region, st.hub, round);
      });
      var outFreightCO2 = 0;
      mkts.forEach(function (m) {
        var units = sb.sold[m.id] || 0;
        if (units) outFreightCO2 += freightPerUnit(cat, cat.product.weightKg, st.hub, m.region, 'surface').co2 * units;
      });
      var compUnits = 0;
      cat.components.forEach(function (c) { compUnits += st.comp[c.id] || 0; });
      var holding = compUnits * num(s.holdingComp, 0) + st.fg * num(s.holdingFG, 0);
      var co2Gross = w.ord.co2Comp + w.ord.co2Freight + w.assemblyCO2 + outFreightCO2;
      var carbonTax = 0;
      if (num(s.carbonTaxPerTon, 0) > 0 && round >= num(s.carbonTaxFromRound, 1))
        carbonTax = (co2Gross / 1000) * s.carbonTaxPerTon;
      var prodCost = w.produced * cat.product.assemblyCost;
      var costs = {
        purchase: w.ord.purchase, inFreight: w.ord.freight,
        inTariff: w.ord.tariff, production: prodCost, outFreight: outFreight,
        outTariff: outTariff, holding: holding, overhead: num(s.overheadPerRound, 0),
        carbonTax: carbonTax, offsets: w.offsetCost, investments: w.investCost, interest: 0
      };
      var costTotal = sum(Object.keys(costs).map(function (k) { return costs[k]; }));
      var cashEnd = st.cash + revenue - costTotal;
      if (cashEnd < 0) {
        costs.interest = -cashEnd * num(s.overdraftRate, 0.05);
        costTotal += costs.interest;
        cashEnd -= costs.interest;
      }
      var profit = revenue - costTotal;
      st.cash = cashEnd;

      // cumulative sustainability accounting
      st.cum.spend += w.ord.purchase;
      st.cum.esgSpend += w.ord.esgSpend;
      st.cum.co2Gross += co2Gross;
      st.cum.offsets += d.offsetTons * 1000; // kg
      st.cum.co2Net = Math.max(0, st.cum.co2Gross - st.cum.offsets);
      st.cum.prodCO2 += w.ord.co2Comp + w.ord.co2Freight + w.assemblyCO2;
      st.cum.produced += w.produced;
      st.cum.sold += sb.totalSold;
      st.cum.revenue += revenue;
      st.cum.profit += profit;

      // green score: gross intensity + supplier ESG + renewable + offsets
      var intensity = st.cum.produced > 0 ? st.cum.prodCO2 / st.cum.produced : null;
      var co2Score = intensity == null ? 50 : clamp(100 - 60 * intensity / cat.product.co2Baseline, 0, 100);
      var esgAvg = st.cum.spend > 0 ? st.cum.esgSpend / st.cum.spend : 50;
      var offsetScore = st.cum.co2Gross > 0 ? clamp(st.cum.offsets / st.cum.co2Gross, 0, 1) * 100 : 0;
      st.green = Math.round(0.45 * co2Score + 0.35 * esgAvg + 0.12 * (st.renewable ? 100 : 0) + 0.08 * offsetScore);

      // ESG scandal: unaudited low-ESG spend can blow up (seeded)
      var riskSpend = 0;
      cat.components.forEach(function (c) {
        c.suppliers.forEach(function (sup) {
          var o = d.orders[c.id] && d.orders[c.id][sup.id];
          if (o && o.qty && effectiveEsg(sup, st.audits) < 60) riskSpend += o.qty * sup.cost;
        });
      });
      var scandal = null;
      if (session.settings.eventsOn && w.ord.purchase > 0) {
        var riskShare = riskSpend / w.ord.purchase;
        if (riskShare > 0 && rand([session.code, 'scandal', f.id, round]) < Math.min(0.3, 0.35 * riskShare)) {
          scandal = 'Investigative report: labour-rights violations found in your supply base. Brand −12.';
          st.cum.scandals++;
        }
      }
      // Brand = reputation: drifts toward the green score AND the service level
      // (fill rate). Stockouts cost future demand — the loyalty effect that
      // makes managers over-order, which is exactly the bullwhip incentive.
      var demandSeen = sb.totalSold + sb.lost;
      var fillRate = demandSeen > 0 ? sb.totalSold / demandSeen : 1;
      st.brand = clamp(Math.round(0.7 * st.brand + 0.15 * st.green + 0.15 * (100 * fillRate)) - (scandal ? 12 : 0), 0, 100);
      st.hist.push({ round: round, demand: demandSeen, cut: w.ord.cut, sold: sb.totalSold, lost: sb.lost,
                     ordered: Math.round(w.ord.kitsOrdered * 10) / 10, produced: w.produced,
                     profit: Math.round(profit), revenue: Math.round(revenue),
                     co2Gross: Math.round(co2Gross), green: st.green, brand: st.brand,
                     cash: Math.round(st.cash) });

      results[f.id] = {
        firmId: f.id, round: round,
        sold: sb.sold, lost: sb.lost, produced: w.produced, prices: d.prices,
        revenue: Math.round(revenue), costs: roundObj(costs), costTotal: Math.round(costTotal),
        profit: Math.round(profit),
        co2: { components: Math.round(w.ord.co2Comp), inFreight: Math.round(w.ord.co2Freight),
               assembly: Math.round(w.assemblyCO2), outFreight: Math.round(outFreightCO2),
               gross: Math.round(co2Gross), offsets: d.offsetTons * 1000,
               intensity: w.produced > 0 ? Math.round(co2Gross / Math.max(1, w.produced)) : null },
        green: st.green, brand: st.brand, scandal: scandal,
        cut: w.ord.cut, orderLines: w.ord.lines,
        endState: publicState(session, st)
      };
      newStates[f.id] = st;
    });

    return { results: results, market: marketRound, states: newStates, news: newsFor(session, round) };
  }

  function roundObj(o) {
    var out = {};
    Object.keys(o).forEach(function (k) { out[k] = Math.round(o[k]); });
    return out;
  }

  // Snapshot of a firm's state safe to show in the UI (it IS the state, kept
  // in results docs so the next round can be resolved from the latest result).
  function publicState(session, st) { return clone(st); }

  /* ---- bullwhip metric ---------------------------------------------------------
     CV²(component orders) / CV²(consumer demand seen). >1 = the firm amplified
     demand variability upstream — the bullwhip effect, measured per firm.
     Measured over the STEADY MIDDLE of the game: the first round (rational
     pipeline start-up) and the last two (rational end-of-horizon wind-down)
     are excluded once there is enough data, so the metric captures true
     amplification rather than finite-horizon effects. */
  function bullwhipRatio(state) {
    var h = (state && state.hist) || [];
    if (h.length < 3) return null;
    if (h.length >= 6) h = h.slice(1, h.length - 2);
    var d = h.map(function (r) { return r.demand; });
    var o = h.map(function (r) { return r.ordered; });
    function cv2(a) {
      var m = sum(a) / a.length;
      if (m <= 0) return null;
      var v = sum(a.map(function (x) { return (x - m) * (x - m); })) / a.length;
      return v / (m * m);
    }
    var cd = cv2(d), co = cv2(o);
    if (cd == null || co == null || cd === 0) return null;
    return Math.round((co / cd) * 100) / 100;
  }

  /* ---- leaderboard ---------------------------------------------------------- */
  function leaderboard(session, firms, states) {
    var w = num(session.settings.scoreWeightProfit, 50) / 100;
    var rows = firms.map(function (f) {
      var st = states[f.id];
      return {
        firmId: f.id, name: f.name, hub: f.hub,
        profit: st ? Math.round(st.cum.profit) : 0,
        green: st ? st.green : 50,
        co2PerUnit: st && st.cum.produced > 0 ? Math.round(st.cum.prodCO2 / st.cum.produced) : null,
        co2Total: st ? Math.round(st.cum.co2Gross / 1000 * 10) / 10 : 0, // tonnes
        sold: st ? st.cum.sold : 0,
        bullwhip: st ? bullwhipRatio(st) : null,
        scandals: st ? st.cum.scandals : 0
      };
    });
    function rank(key, desc) {
      var sorted = rows.slice().sort(function (a, b) { return desc ? b[key] - a[key] : a[key] - b[key]; });
      rows.forEach(function (r) { r[key + 'Rank'] = sorted.findIndex(function (x) { return x[key] === r[key]; }) + 1; });
    }
    rank('profit', true); rank('green', true);
    var n = rows.length;
    rows.forEach(function (r) {
      var pPts = n > 1 ? (n - r.profitRank) / (n - 1) * 100 : 100;
      var gPts = n > 1 ? (n - r.greenRank) / (n - 1) * 100 : 100;
      r.score = Math.round(w * pPts + (1 - w) * gPts);
    });
    rows.sort(function (a, b) { return b.score - a.score || b.profit - a.profit; });
    return rows;
  }

  /* ---- bots ---------------------------------------------------------------------
     A simple order-up-to (base-stock) policy — deliberately the textbook policy
     that PRODUCES bullwhip under demand shifts. Bots pick the cheapest landed-
     cost supplier mix, ship surface, and price near reference. `profile` tilts
     one bot green (europe suppliers) for contrast. */
  function botDecision(session, firm, state, round, nFirms, profile) {
    var s = session.settings, cat = session.catalog;
    var d = emptyDecision(session, firm.id, round);
    var mkts = activeMarkets(session);
    // Forecast from rounds where the firm actually faced demand (a round with
    // no stock offered observes nothing — don't let it drag the forecast to 0).
    var h = state.hist.filter(function (r) { return r.demand > 0; });
    var naive = sum(mkts.map(function (m) { return m.size; })) / (nFirms + 1);
    var forecast;
    if (h.length === 0) forecast = naive;
    else if (h.length === 1) forecast = h[0].demand;
    else forecast = (h[h.length - 1].demand * 2 + h[h.length - 2].demand) / 3;
    forecast = Math.min(forecast, num(s.factoryCapacity, 500));

    var jitter = 0.95 + 0.1 * rand([session.code, 'bot', firm.id, round]);
    cat.components.forEach(function (c) {
      // rank suppliers by landed cost (green bots: by CO2+ESG instead)
      var ranked = c.suppliers.slice().sort(function (a, b) {
        function landed(sup) {
          var fr = freightPerUnit(cat, c.weightKg, sup.region, state.hub, 'surface');
          var t = tariffRate(session, state.hub, sup.region, round);
          if (profile === 'green') return sup.co2 + fr.co2 - sup.esg * 0.3;
          return sup.cost * (1 + t) + fr.cost;
        }
        return landed(a) - landed(b);
      });
      var lead = leadTime(session, ranked[0].region, state.hub, 'surface', round);
      var pipelineQty = sum(state.pipeline.filter(function (e) { return e.compId === c.id; })
        .map(function (e) { return e.qty; }));
      var target = forecast * (lead + 1) * 1.2 * c.qty;   // cover lead + review period + 20% safety
      var position = (state.comp[c.id] || 0) + pipelineQty;
      var need = Math.max(0, Math.round((target - position) * jitter));
      var placed = 0;
      for (var i = 0; i < ranked.length && need - placed > 0; i++) {
        var take = Math.min(need - placed, ranked[i].capacity);
        if (take > 0) { d.orders[c.id][ranked[i].id] = { qty: take, mode: 'surface' }; placed += take; }
      }
    });
    // production plan counts on-hand kits PLUS arrivals due this round (the
    // pipeline ETAs are known); the engine caps at true availability anyway
    d.production = Math.round(Math.min(num(s.factoryCapacity, 500), forecast * 1.05,
                                       kitsAvailable(session, withArrivals(session, state, round))));
    mkts.forEach(function (m) {
      var f = profile === 'green' ? 1.04 : 0.97;
      d.prices[m.id] = Math.round(m.refPrice * f * (0.98 + 0.04 * rand([session.code, 'botp', firm.id, m.id, round])));
    });
    if (profile === 'green' && round === 1) {
      d.buyRenewable = true;
      d.auditSuppliers = [];
    }
    d.submitted = true;
    return d;
  }

  /* =====================================================================
     "Optimal" (Nash-equilibrium) bots — self-paced practice opponents.

     Exact dynamic equilibrium of this game is intractable, so the bots play
     the standard rational decomposition, recomputed every period:

     · PRICING — the stage-game Nash equilibrium of logit price competition:
       iterate best responses p_f = c_f/(1−τ) + 1/(b·(1−s_f))  (multinomial-
       logit markup with an outside good; b = priceBeta/refPrice, τ = the
       ad-valorem export-tariff share of price), given every firm's current
       green score and brand. The fixed point is a contraction — a few dozen
       iterations converge.
     · ORDERING — the optimal order-up-to (base-stock) policy at the
       newsvendor critical fractile over the actual replenishment lead time,
       under RATIONAL EXPECTATIONS of the demand process: bots know the
       demand pattern (step/season schedules are public structure; the random
       walk is forecast at its current level) but never the noise draws.
     · SOURCING — cheapest landed cost (price + freight + tariffs, including
       already-scheduled tariff shocks), re-optimized every round; air is
       used only to expedite a genuine projected stockout when the margin
       covers the premium.
     · INVESTMENT — renewable/audits only when the payback is there;
       offsets never (they don't reduce the carbon tax base or gross CO2).
     ===================================================================== */

  // Expected demand factor for a FUTURE round, from the perspective of
  // `nowRound` — pattern structure is known, noise is not; the walk is a
  // martingale so its forecast is the current level.
  function expectedDemandFactor(session, futureRound, nowRound) {
    var p = session.settings.demandPattern || 'stable';
    if (p === 'walk') return demandFactor(session, Math.min(futureRound, nowRound));
    return demandFactor(session, futureRound);
  }
  function expectedDemand(session, marketId, futureRound, nowRound) {
    var m = findMarket(session.catalog, marketId);
    if (!m) return 0;
    return m.size * (num(session.settings.demandScale, 1) || 1) *
           expectedDemandFactor(session, futureRound, nowRound);
  }

  // Acklam's rational approximation of the standard normal inverse CDF —
  // plenty for safety-stock z-values.
  function invNorm(p) {
    p = clamp(p, 0.001, 0.999);
    var a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    var b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    var c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    var d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    var q, r;
    if (p < 0.02425) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
             ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 0.97575) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
             ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // Cheapest landed sourcing plan per component for a hub at a given round:
  // suppliers ranked by unit landed cost (price + surface freight + import
  // tariff), so scheduled tariff shocks re-rank suppliers automatically.
  function cheapestKit(session, hub, round) {
    var cat = session.catalog, plan = {}, kitCost = 0;
    cat.components.forEach(function (comp) {
      var ranked = comp.suppliers.map(function (sup) {
        var fr = freightPerUnit(cat, comp.weightKg, sup.region, hub, 'surface');
        var landed = sup.cost * (1 + tariffRate(session, hub, sup.region, round)) + fr.cost;
        return { sup: sup, landed: landed, lead: leadTime(session, sup.region, hub, 'surface', round) };
      }).sort(function (x, y) { return x.landed - y.landed; });
      plan[comp.id] = ranked;
      kitCost += ranked[0].landed * comp.qty;
    });
    return { plan: plan, kitCost: kitCost };
  }

  /* Stage-game Nash prices per market for a set of participants
     [{firmId, hub, green, brand}]. Returns {prices:{fid:{mid:p}}, shares:{fid:{mid:s}}}. */
  function nashPrices(session, parts, round) {
    var cat = session.catalog, gs = num(session.settings.greenSensitivity, 1);
    var mkts = activeMarkets(session);
    var kits = {};
    parts.forEach(function (pt) { if (!kits[pt.hub]) kits[pt.hub] = cheapestKit(session, pt.hub, round).kitCost; });
    var prices = {}, shares = {};
    parts.forEach(function (pt) { prices[pt.firmId] = {}; shares[pt.firmId] = {}; });
    mkts.forEach(function (m) {
      var b = m.priceBeta / m.refPrice;
      var econ = parts.map(function (pt) {
        var fr = freightPerUnit(cat, cat.product.weightKg, pt.hub, m.region, 'surface');
        return { pt: pt,
                 c0: kits[pt.hub] + cat.product.assemblyCost + fr.cost,
                 tau: 0.6 * tariffRate(session, m.region, pt.hub, round),
                 p: m.refPrice };
      });
      for (var it = 0; it < 40; it++) {
        var utils = econ.map(function (e) {
          var u = m.priceBeta * (m.refPrice - e.p) / m.refPrice +
                  m.greenBeta * gs * (e.pt.green - 50) / 50 +
                  m.brandBeta * (e.pt.brand - 50) / 50;
          return Math.exp(clamp(u, -8, 8));
        });
        var denom = 1 + sum(utils);
        econ.forEach(function (e, i) {
          var s = utils[i] / denom;
          var target = e.c0 / (1 - e.tau) + 1 / (b * (1 - s) * (1 - e.tau));
          e.p = clamp(0.5 * e.p + 0.5 * target, m.refPrice * 0.3, m.refPrice * 3);
          e.s = s;
        });
      }
      econ.forEach(function (e) {
        prices[e.pt.firmId][m.id] = Math.round(e.p);
        shares[e.pt.firmId][m.id] = e.s;
        e.pt['margin_' + m.id] = e.p * (1 - e.tau) - e.c0;
      });
    });
    return { prices: prices, shares: shares };
  }

  /* Equilibrium decisions for the firms listed in nashIds (computed jointly —
     the pricing equilibrium involves everyone, students included, at their
     observed green/brand states). */
  function nashDecisions(session, firms, states, round, nashIds) {
    var s = session.settings, cat = session.catalog;
    var mkts = activeMarkets(session);
    var parts = firms.map(function (f) {
      var st = states[f.id];
      return { firmId: f.id, hub: st.hub || f.hub, green: st ? st.green : 50, brand: st ? st.brand : 50 };
    });
    var eq = nashPrices(session, parts, round);
    var noiseSd = num(s.demandNoise, 0) / Math.sqrt(3) + (s.demandPattern === 'walk' ? 0.07 : 0);
    var out = {};
    nashIds.forEach(function (fid) {
      var f = firms.find(function (x) { return x.id === fid; });
      var st = states[fid];
      var d = emptyDecision(session, fid, round);
      d.prices = {};
      mkts.forEach(function (m) { d.prices[m.id] = eq.prices[fid][m.id]; });

      // Expected own units per round. The equilibrium share is only the
      // PRIOR (round 1): rivals may not play equilibrium (students rarely
      // do), so once the bot has observed its own realized demand it
      // forecasts from that — rescaled by the known demand-pattern factor,
      // which is how it still anticipates a step or season it hasn't felt
      // yet. Stockout rounds (observed demand 0 with no stock) carry no
      // information and are ignored.
      var eqNow = 0;
      mkts.forEach(function (m) { eqNow += eq.shares[fid][m.id] * expectedDemand(session, m.id, round, round); });
      var hobs = (st.hist || []).filter(function (r3) { return r3.demand > 0; });
      var baseU, obsRound;
      if (!hobs.length) { baseU = eqNow; obsRound = round; }
      else {
        var lastH = hobs[hobs.length - 1], prevH = hobs.length > 1 ? hobs[hobs.length - 2] : lastH;
        baseU = (2 * lastH.demand + prevH.demand) / 3;
        obsRound = lastH.round;
      }
      var obsFactor = Math.max(0.2, expectedDemandFactor(session, obsRound, round));
      // effective demand is capped by what the factory can actually build —
      // buying components you can never assemble is money on a shelf
      var capUnits = num(s.factoryCapacity, 500);
      function U(r2) {
        if (r2 > num(s.rounds, 8)) return 0; // nothing sells after the horizon
        return Math.min(capUnits, baseU * expectedDemandFactor(session, r2, round) / obsFactor);
      }
      // margin & critical fractile → safety factor
      var margin = 0, wsum = 0;
      var pt = parts.find(function (x) { return x.firmId === fid; });
      mkts.forEach(function (m) {
        var w = eq.shares[fid][m.id];
        margin += (pt['margin_' + m.id] || 0) * w; wsum += w;
      });
      margin = Math.max(50, wsum > 0 ? margin / wsum : 100);
      var cf = margin / (margin + num(s.holdingComp, 3) * 2);
      var z = clamp(invNorm(cf), 0, 2.5);

      var kit = cheapestKit(session, st.hub, round);
      var R = num(s.rounds, 8);
      var nFirms = Math.max(1, firms.length);
      cat.components.forEach(function (comp) {
        var ranked = kit.plan[comp.id];
        var primary = ranked[0];
        var L = primary.lead;
        // base-stock target over lead + review, clipped to the finite horizon
        var eDemand = 0;
        for (var i = 0; i <= L; i++) eDemand += U(round + i);
        var sigma = z * noiseSd * Math.sqrt(L + 1) * U(round + 1);
        var target = (eDemand + sigma) * comp.qty;
        // never hold more than the game can still sell (end-game tapering)
        var restNeed = 0;
        for (var r4 = round; r4 <= R; r4++) restNeed += U(r4);
        var position = (st.comp[comp.id] || 0);
        (st.pipeline || []).forEach(function (e) { if (e.compId === comp.id) position += e.qty; });
        target = Math.min(target, restNeed * comp.qty * 1.05);

        // 1) rational expediting FIRST: if what lands by NEXT round can't
        //    cover next round's expected sales (surface is too slow) and the
        //    margin clears the air premium, air-freight the gap now
        if (L >= 2 && round + 1 <= R) {
          var byNext = (st.comp[comp.id] || 0);
          (st.pipeline || []).forEach(function (e) { if (e.compId === comp.id && e.eta <= round + 1) byNext += e.qty; });
          var gap = Math.round(U(round + 1) * comp.qty - byNext);
          var airFr = freightPerUnit(cat, comp.weightKg, primary.sup.region, st.hub, 'air').cost;
          if (gap > 0 && margin > 2 * airFr) {
            var airQty = Math.min(gap, Math.ceil(primary.sup.capacity / nFirms));
            d.orders[comp.id][primary.sup.id] = { qty: airQty, mode: 'air' };
            position += airQty;
          }
        }
        // 2) then order-up-to by sea, cheapest landed first — with ORDER
        //    SMOOTHING: order next round's expected consumption plus a
        //    fraction of the remaining position gap, instead of gulping the
        //    whole gap at once. Smoothing is a textbook bullwhip remedy: it
        //    keeps the bots' order stream nearly as steady as the demand they
        //    face (and is what the debrief holds students against). Also skip
        //    lanes whose arrival would miss the horizon, and request only ~a
        //    fair share of each supplier's shared capacity (inflating a
        //    rationed order just feeds the cut).
        var consume = U(round + 1) * comp.qty;
        var gap = target - position;
        // rate limit at 1.6× consumption: pipeline fill is spread over several
        // rounds instead of gulped, so the order stream stays steady even for
        // far (3-round-lead) sourcing in a short game
        var smoothed = Math.min(gap, consume + 0.4 * Math.max(0, gap - consume), consume * 1.6);
        // …but never build position beyond what the rest of the game can sell
        var hardCap = Math.max(0, restNeed * comp.qty * 1.05 - position);
        var need = Math.max(0, Math.round(Math.min(smoothed, hardCap)));
        for (var k = 0; k < ranked.length && need > 0; k++) {
          if (d.orders[comp.id][ranked[k].sup.id]) continue;
          if (round + ranked[k].lead > R) continue;
          var fair = Math.ceil(ranked[k].sup.capacity * 1.25 / nFirms);
          var take = Math.min(need, fair, ranked[k].sup.capacity);
          if (take > 0) { d.orders[comp.id][ranked[k].sup.id] = { qty: take, mode: 'surface' }; need -= take; }
        }
      });

      // produce to expected sales this round + a small finished-goods buffer
      var eNow = U(round);
      d.production = Math.round(clamp(eNow + 0.5 * z * noiseSd * eNow - st.fg,
                                      0, num(s.factoryCapacity, 500)));

      // investments with payback
      var roundsLeft = num(s.rounds, 8) - round + 1;
      if (!st.renewable && round <= 2) {
        var avgGreenBeta = sum(mkts.map(function (m) { return m.greenBeta; })) / Math.max(1, mkts.length);
        if (num(s.carbonTaxPerTon, 0) > 0 ||
            (num(s.greenSensitivity, 1) * avgGreenBeta >= 0.6 && roundsLeft >= 5)) d.buyRenewable = true;
      }
      if (roundsLeft >= 3) {
        cat.components.forEach(function (comp) {
          comp.suppliers.forEach(function (sup) {
            var o = d.orders[comp.id][sup.id];
            if (o && o.qty > 0 && effectiveEsg(sup, st.audits) < 60 &&
                st.audits.indexOf(sup.id) === -1 &&
                d.auditSuppliers.indexOf(sup.id) === -1) d.auditSuppliers.push(sup.id);
          });
        });
      }
      d.submitted = true;
      out[fid] = sanitizeDecision(session, fid, round, d);
    });
    return out;
  }

  /* =====================================================================
     The COACH — automatic, rule-based guidance for students.
     coachDecision() looks at the CURRENT draft while a round is open and
     nudges toward sound supply-chain behavior; coachResult() reviews a
     RESOLVED round and explains what went well, what it cost, and what to
     try — benchmarked with the same rational machinery the optimal bots
     use. Deterministic and engine-level, so it's testable in Node and
     identical for every student. Each item: {level: 'warn'|'info'|'good',
     text}. Lists come back priority-ordered and capped.
     ===================================================================== */

  // The student's own demand estimate: recent realized demand, else a rough
  // fair-share prior. Everything coach-side is labeled as approximate.
  function coachExpDemand(session, state, nFirms) {
    var h = (state.hist || []).filter(function (r) { return r.demand > 0; });
    if (h.length >= 2) return (2 * h[h.length - 1].demand + h[h.length - 2].demand) / 3;
    if (h.length === 1) return h[0].demand;
    var total = sum(activeMarkets(session).map(function (m) {
      return m.size * (num(session.settings.demandScale, 1) || 1);
    }));
    return total / Math.max(2, (nFirms || 4) + 1);
  }

  function coachDecision(session, firm, state, decision, round, nFirms) {
    var out = [], s = session.settings, cat = session.catalog;
    var R = num(s.rounds, 8);
    var expD = coachExpDemand(session, state, nFirms);
    var pv = previewDecision(session, state, decision, round);
    var lastH = (state.hist || []).length ? state.hist[state.hist.length - 1] : null;

    // component position coverage (on hand + entire pipeline + this draft)
    var minCover = Infinity, horizonWaste = [];
    var airCost = 0, surfaceAltCost = 0;
    cat.components.forEach(function (c) {
      var pos = state.comp[c.id] || 0;
      (state.pipeline || []).forEach(function (e) { if (e.compId === c.id) pos += e.qty; });
      var ordered = 0;
      c.suppliers.forEach(function (sup) {
        var o = decision.orders[c.id] && decision.orders[c.id][sup.id];
        if (!o || !o.qty) return;
        ordered += o.qty;
        var lead = leadTime(session, sup.region, state.hub, o.mode, round);
        if (round + lead > R) horizonWaste.push(o.qty + '× ' + c.name + ' from ' + sup.name);
        if (o.mode === 'air') {
          airCost += freightPerUnit(cat, c.weightKg, sup.region, state.hub, 'air').cost * o.qty;
          surfaceAltCost += freightPerUnit(cat, c.weightKg, sup.region, state.hub, 'surface').cost * o.qty;
        }
      });
      minCover = Math.min(minCover, (pos + ordered) / Math.max(1, expD * c.qty));
    });
    if (!isFinite(minCover)) minCover = 0;

    // 1 · pricing below unit cost — the costliest mistake there is
    var kit = cheapestKit(session, state.hub, round).kitCost + cat.product.assemblyCost;
    activeMarkets(session).forEach(function (m) {
      var p = decision.prices[m.id];
      if (p != null && p < kit) {
        out.push({ pri: 0, level: 'warn', text: 'Your ' + m.name + ' price (' + Math.round(p) +
          ') is BELOW your unit cost (≈$' + Math.round(kit) + ' components + assembly, before freight/tariffs). Every sale there loses money.' });
      }
    });
    // 2 · thin pipeline → stockouts given lead times
    if (round < R && minCover < 1.6) {
      out.push({ pri: 1, level: 'warn', text: 'Thin supply line: components on hand + on order cover only ~' +
        (Math.round(minCover * 10) / 10) + ' rounds of your recent demand (~' + Math.round(expD) +
        ' units/round). With 1–3 round lead times, what you order now is what you can sell later — stockouts also dent your brand.' });
    }
    // 3 · massive over-ordering → holding costs + rationing
    var maxLead = 3;
    if (expD > 0 && minCover > (maxLead + 3)) {
      out.push({ pri: 2, level: 'warn', text: 'Heavy ordering: your position would cover ~' + Math.round(minCover) +
        ' rounds of demand. Excess stock costs ' + fmtMoneyish(num(s.holdingComp, 3)) + '/unit/round to hold, and over-ordering at popular suppliers deepens everyone\'s rationing cuts (including yours).' });
    }
    // 4 · orders that arrive after the game ends
    if (horizonWaste.length) {
      out.push({ pri: 1, level: 'warn', text: 'Arriving too late: ' + horizonWaste.slice(0, 2).join('; ') +
        (horizonWaste.length > 2 ? ' (+' + (horizonWaste.length - 2) + ' more)' : '') +
        ' would land AFTER round ' + R + ' — money spent on inventory the game never sells. Ship faster or skip it.' });
    }
    // 5 · air freight without stockout pressure
    if (airCost > 3000 && minCover - 0 > 2 && (!lastH || lastH.lost === 0)) {
      out.push({ pri: 3, level: 'info', text: 'Air freight adds ~' + fmtMoneyish(airCost - surfaceAltCost) +
        ' vs sea on this plan (and ~30× the CO2). You aren\'t under stockout pressure — sea + ordering one round earlier does the same job.' });
    }
    // 6 · announced tariff (or carbon tax) next round
    (s.tariffShocks || []).forEach(function (sh) {
      if (sh.announce && round === num(sh.round, 1) - 1) {
        out.push({ pri: 2, level: 'info', text: 'A tariff change is ANNOUNCED for next round. Orders you place THIS round are charged at today\'s rates — is your sourcing mix (or a stockpile) positioned for it?' });
      }
    });
    // 7 · scandal exposure
    var riskSpend = 0, spend = 0;
    cat.components.forEach(function (c) {
      c.suppliers.forEach(function (sup) {
        var o = decision.orders[c.id] && decision.orders[c.id][sup.id];
        if (!o || !o.qty) return;
        spend += o.qty * sup.cost;
        if (effectiveEsg(sup, state.audits.concat(decision.auditSuppliers || [])) < 60) riskSpend += o.qty * sup.cost;
      });
    });
    if (spend > 0 && riskSpend / spend > 0.3) {
      out.push({ pri: 2, level: 'warn', text: Math.round(100 * riskSpend / spend) +
        '% of this round\'s component spend goes to unaudited suppliers with ESG below 60 — real scandal risk (brand −12). An audit (' +
        fmtMoneyish(num(s.auditCost, 8000)) + ', one-time) removes it.' });
    }
    // 8 · producing less than you can while demand went unserved
    var canMake = Math.min(num(s.factoryCapacity, 500), kitsAvailable(session, withArrivals(session, state, round)));
    if (lastH && lastH.lost > 0 && decision.production < Math.min(canMake, Math.round(expD))) {
      out.push({ pri: 1, level: 'warn', text: 'Last round you lost ' + lastH.lost +
        ' sales, and this plan produces ' + decision.production + ' of the ' + canMake +
        ' units you could assemble. Unless you expect demand to fall, that\'s margin left on the table.' });
    }
    // 9 · deep overdraft
    if (pv.cashAfterSpend < -0.3 * num(s.startingCash, 500000)) {
      out.push({ pri: 2, level: 'warn', text: 'This plan pushes you deep into overdraft (' +
        fmtMoneyish(pv.cashAfterSpend) + ' before revenue) at ' + Math.round(num(s.overdraftRate, 0.05) * 100) + '%/round interest.' });
    }
    // 10 · offsets misconception
    if (decision.offsetTons > 0) {
      out.push({ pri: 4, level: 'info', text: 'Offsets reduce your NET CO2 (small green-score help) but never your gross footprint' +
        (num(s.carbonTaxPerTon, 0) > 0 ? ' — and the carbon tax is charged on GROSS, so offsets don\'t reduce it.' : '.') });
    }
    out.sort(function (a, b) { return a.pri - b.pri; });
    return out.slice(0, 4).map(function (x) { return { level: x.level, text: x.text }; });
  }

  /* Post-round feedback. parts = [{firmId, hub, green, brand}] for everyone in
     the game (rivals at their current observed states), used for the
     equilibrium-price benchmark. prevState = the firm's state BEFORE the round. */
  function coachResult(session, firm, prevState, result, parts, round) {
    var out = [], s = session.settings, cat = session.catalog;
    var sold = 0; Object.keys(result.sold || {}).forEach(function (k) { sold += result.sold[k]; });
    var demand = sold + (result.lost || 0);
    var fill = demand > 0 ? sold / demand : 1;
    var kitCheap = cheapestKit(session, prevState.hub, round).kitCost;
    var unitCost = kitCheap + cat.product.assemblyCost;
    var avgPrice = sold > 0 ? result.revenue / sold : null;
    var margin = avgPrice != null ? Math.max(60, avgPrice - unitCost) : 250;

    // stockouts, with the money attached
    if (demand > 0 && fill < 0.9) {
      out.push({ pri: 1, level: 'warn', text: 'Stockout: ' + result.lost + ' units of demand went unserved — roughly ' +
        fmtMoneyish(result.lost * margin) + ' of margin lost, plus a brand hit that lowers future demand. With your lead times, cover ~lead+1 rounds of expected demand in on-hand + on-order stock.' });
    } else if (demand > 0 && fill >= 0.97) {
      var endKits = kitsAvailable(session, result.endState || prevState);
      var cover = endKits / Math.max(1, demand);
      if (cover <= 2.5) out.push({ pri: 6, level: 'good', text: '✔ Strong service (' + Math.round(fill * 100) + '% of demand served) on lean inventory — exactly the balance the game rewards.' });
    }
    // rationing cuts
    if (result.cut > 200) {
      out.push({ pri: 3, level: 'info', text: 'Suppliers cut ' + result.cut + ' of your ordered units (shared capacity, pro-rata). Piling onto the one cheapest supplier is what everyone does — spreading across suppliers or ordering steadily gets you more actual units.' });
    }
    // pricing vs the competitive equilibrium
    if (parts && parts.length > 1) {
      var eq = nashPrices(session, parts, round);
      var mine = eq.prices[firm.id];
      if (mine) {
        var worst = null;
        activeMarkets(session).forEach(function (m) {
          var p = (result.prices || {})[m.id];
          if (p == null) return;
          var diff = (p - mine[m.id]) / mine[m.id];
          if (worst == null || Math.abs(diff) > Math.abs(worst.diff)) worst = { m: m, p: p, star: mine[m.id], diff: diff };
        });
        if (worst && worst.diff < -0.08) {
          out.push({ pri: 2, level: 'warn', text: 'Pricing: in ' + worst.m.name + ' you charged ' + fmtMoneyish(worst.p) +
            ' vs a competitive benchmark of ≈' + fmtMoneyish(worst.star) + ' for your costs and reputation' +
            (fill < 0.95 ? ' — and you stocked out anyway. When supply is short, a higher price converts scarce units into more profit.' : ' — you likely bought share more cheaply than needed.') });
        } else if (worst && worst.diff > 0.15) {
          out.push({ pri: 3, level: 'info', text: 'Pricing: your ' + worst.m.name + ' price (' + fmtMoneyish(worst.p) +
            ') sits well above the ≈' + fmtMoneyish(worst.star) + ' benchmark for your green score and brand — premium prices need the reputation to carry them.' });
        } else if (worst && Math.abs(worst.diff) <= 0.08 && sold > 0) {
          out.push({ pri: 7, level: 'good', text: '✔ Pricing close to the competitive optimum for your cost and reputation position.' });
        }
      }
    }
    // sourcing premium (deliberate green vs accidental expensive)
    var lines = result.orderLines || [];
    var bought = 0, paid = 0;
    lines.forEach(function (l) { bought += l.qty; paid += l.cost; });
    if (bought > 50) {
      var kitsBought = bought / Math.max(1, cat.components.length);
      var perKit = paid / Math.max(1, kitsBought);
      var premium = (perKit - kitCheap) / kitCheap;
      if (premium > 0.12 && (result.green || 50) >= 58) {
        out.push({ pri: 5, level: 'good', text: '✔ You paid ~' + Math.round(premium * 100) + '% over the cheapest landed mix — and it shows in a green score of ' +
          result.green + ', which wins share in sustainability-sensitive markets and half the final score.' });
      } else if (premium > 0.12) {
        out.push({ pri: 2, level: 'warn', text: 'Sourcing: your component mix cost ~' + Math.round(premium * 100) +
          '% more than the cheapest landed alternative, without a green score to show for it (' + result.green + '). Either buy cheaper or buy cleaner — paying more for neither is the one losing move.' });
      }
    }
    // air premium without need
    var airSpend = 0;
    lines.forEach(function (l) { if (l.mode === 'air') airSpend += l.cost; });
    if (airSpend > 8000 && result.lost === 0 && fill >= 0.99) {
      out.push({ pri: 4, level: 'info', text: 'You air-freighted ' + fmtMoneyish(airSpend) + ' of components in a round with zero stockout pressure — sea plus one round of patience is ~80× cheaper and ~30× cleaner.' });
    }
    // scandal
    if (result.scandal) {
      out.push({ pri: 1, level: 'warn', text: 'The ESG scandal cost you 12 brand points — that is future demand. Unaudited suppliers with ESG below 60 carry this risk every round you buy from them; one audit each removes it for good.' });
    }
    // idle production while demand exists
    if (result.lost > 0 && result.produced < num(s.factoryCapacity, 500)) {
      var kitsHad = kitsAvailable(session, withArrivals(session, prevState, round));
      if (result.produced < kitsHad) {
        out.push({ pri: 2, level: 'warn', text: 'You produced ' + result.produced + ' units while ' + kitsHad +
          ' component sets were available and ' + result.lost + ' units of demand went unserved — production below demand wastes both.' });
      }
    }
    out.sort(function (a, b) { return a.pri - b.pri; });
    return out.slice(0, 5).map(function (x) { return { level: x.level, text: x.text }; });
  }
  function fmtMoneyish(n) {
    var v = Math.round(n);
    return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US');
  }

  return {
    hashStr: hashStr, mulberry32: mulberry32, rand: rand, clamp: clamp, clone: clone,
    distMm: distMm, leadTime: leadTime, freightPerUnit: freightPerUnit, tariffRate: tariffRate,
    demandFor: demandFor, demandFactor: demandFactor, eventsFor: eventsFor, newsFor: newsFor,
    findComponent: findComponent, findSupplier: findSupplier, findMarket: findMarket,
    activeMarkets: activeMarkets, effectiveEsg: effectiveEsg,
    initFirmState: initFirmState, emptyDecision: emptyDecision, sanitizeDecision: sanitizeDecision,
    kitsAvailable: kitsAvailable, withArrivals: withArrivals,
    computeOrders: computeOrders, allocationRatios: allocationRatios,
    previewDecision: previewDecision,
    resolveRound: resolveRound, bullwhipRatio: bullwhipRatio, leaderboard: leaderboard,
    botDecision: botDecision,
    expectedDemand: expectedDemand, invNorm: invNorm, cheapestKit: cheapestKit,
    nashPrices: nashPrices, nashDecisions: nashDecisions,
    coachDecision: coachDecision, coachResult: coachResult
  };
});
