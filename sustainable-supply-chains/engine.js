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
     Base rate per importing region + scheduled shocks (a shock replaces the
     rate for its importer/from pair from its round onward; 'from' omitted =
     all origins). No tariff on domestic (same-region) flows. Returns a
     fraction (0.35 = 35%). */
  function tariffRate(session, importer, from, round) {
    if (importer === from) return 0;
    var s = session.settings;
    var rate = num((s.tariffBase || {})[importer], 0);
    var shocks = s.tariffShocks || [];
    for (var i = 0; i < shocks.length; i++) {
      var sh = shocks[i];
      if (round >= num(sh.round, 1) && sh.importer === importer &&
          (!sh.from || sh.from === from)) rate = Math.max(rate, num(sh.rate, 0));
    }
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

  /* ---- preview (student UI): what this decision costs before submitting ----- */
  function previewDecision(session, state, decision, round) {
    var s = session.settings, cat = session.catalog;
    var ord = computeOrders(session, state, decision, round);
    var invest = (decision.buyRenewable && !state.renewable ? num(s.renewableCapex, 0) : 0) +
      (decision.auditSuppliers || []).filter(function (id) { return state.audits.indexOf(id) === -1; }).length * num(s.auditCost, 0) +
      decision.offsetTons * num(s.offsetPricePerTon, 25);
    var availKits = kitsAvailable(session, state);
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
     demand variability upstream — the bullwhip effect, measured per firm. */
  function bullwhipRatio(state) {
    var h = (state && state.hist) || [];
    if (h.length < 3) return null;
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
    var stWithArrivals = clone(state);
    stWithArrivals.pipeline.forEach(function (e) {
      if (e.eta <= round) stWithArrivals.comp[e.compId] = (stWithArrivals.comp[e.compId] || 0) + e.qty;
    });
    d.production = Math.round(Math.min(num(s.factoryCapacity, 500), forecast * 1.05,
                                       kitsAvailable(session, stWithArrivals)));
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

  return {
    hashStr: hashStr, mulberry32: mulberry32, rand: rand, clamp: clamp, clone: clone,
    distMm: distMm, leadTime: leadTime, freightPerUnit: freightPerUnit, tariffRate: tariffRate,
    demandFor: demandFor, demandFactor: demandFactor, eventsFor: eventsFor, newsFor: newsFor,
    findComponent: findComponent, findSupplier: findSupplier, findMarket: findMarket,
    activeMarkets: activeMarkets, effectiveEsg: effectiveEsg,
    initFirmState: initFirmState, emptyDecision: emptyDecision, sanitizeDecision: sanitizeDecision,
    kitsAvailable: kitsAvailable, computeOrders: computeOrders, allocationRatios: allocationRatios,
    previewDecision: previewDecision,
    resolveRound: resolveRound, bullwhipRatio: bullwhipRatio, leaderboard: leaderboard,
    botDecision: botDecision
  };
});
