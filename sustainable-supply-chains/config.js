/* ==========================================================================
   Sustainable Supply Chains — config.js
   Default game configuration: the product catalog (components, suppliers,
   regions, markets, transport modes) and the tunable session settings.
   Everything here is a DEFAULT — the admin panel copies these into each new
   session (and can edit the catalog JSON per session), so changing this file
   only affects sessions created afterwards.

   Loads in the browser (window.SSC_CONFIG) and in Node (module.exports) so
   tools/selftest.js can exercise the engine against the same numbers.

   Units used throughout:
     money  $            CO2  kg per unit           distance  Mm (1000 km)
     freight $ / kg / Mm  freight CO2  kg / kg / Mm  lead time  rounds
   The freight rates are rough real-world magnitudes (sea ~15 g CO2 per
   tonne-km, air ~500 g; sea ~$0.006 per kg per 1000 km, air ~$0.5) so the
   sea-vs-air tension students face is the real one: air is ~2 orders of
   magnitude dirtier and pricier, but 1 round instead of 2–3.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SSC_CONFIG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- Regions: where suppliers, factories (hubs) and markets live -------- */
  var REGIONS = {
    easia:    { name: 'East Asia',      port: 'Shenzhen'   },
    seasia:   { name: 'Southeast Asia', port: 'Hai Phong'  },
    sasia:    { name: 'South Asia',     port: 'Chennai'    },
    europe:   { name: 'Europe',         port: 'Rotterdam'  },
    namerica: { name: 'North America',  port: 'Los Angeles'},
    latam:    { name: 'Latin America',  port: 'Santos'     }
  };

  /* Symmetric sea-route distances in Mm (1000 km), rough real magnitudes.
     Key is the two region ids sorted alphabetically, joined by '|'.
     Same-region legs use SAME_REGION_DIST. */
  var DISTANCES = {
    'easia|seasia': 2.5,   'easia|sasia': 7.0,    'easia|europe': 20.5,
    'easia|namerica': 11.5,'easia|latam': 18.5,
    'sasia|seasia': 4.5,   'europe|seasia': 15.5, 'namerica|seasia': 14.0,
    'latam|seasia': 19.5,
    'europe|sasia': 11.5,  'namerica|sasia': 16.0,'latam|sasia': 14.5,
    'europe|namerica': 8.0,'europe|latam': 10.0,
    'latam|namerica': 7.5
  };
  var SAME_REGION_DIST = 0.5;

  /* ---- Transport modes ----------------------------------------------------
     surface = sea/rail/truck. Lead time in ROUNDS (an order placed in round r
     arrives at the start of round r+lead). Air is always 1 round; surface
     grows with distance — this lag is what makes the bullwhip effect bite. */
  var MODES = {
    surface: { name: 'Sea / surface', costPerKgMm: 0.006, co2PerKgMm: 0.015 },
    air:     { name: 'Air',           costPerKgMm: 0.5,   co2PerKgMm: 0.5   }
  };
  // surface lead by distance: same region 1, near (<6 Mm) 2, far 3
  function surfaceLead(distMm) { return distMm <= SAME_REGION_DIST ? 1 : (distMm < 6 ? 2 : 3); }

  /* ---- The product ---------------------------------------------------------
     One finished unit consumes the full bill of materials below. */
  var PRODUCT = {
    name: 'Commuter e-bike',
    unitLabel: 'e-bike',
    weightKg: 25,            // finished-good shipping weight
    assemblyCost: 90,        // $ per unit assembled at the firm's hub
    assemblyCO2: 20,         // kg CO2 per unit assembled (factory energy)
    assemblyCO2Renewable: 8, // …after the renewable-energy upgrade
    co2Baseline: 220         // kg/unit reference intensity for the green score
  };

  /* ---- Components & their global supplier base -----------------------------
     Per supplier: cost $/unit · co2 kg embodied/unit · esg 0–100 rating ·
     capacity units/round. Capacity is ONE shared pool across all firms: when
     total orders exceed it, every firm's order is cut pro-rata (rationing).
     The spread is deliberate: cheap+dirty+risky East/Southeast Asia vs
     expensive+clean Europe vs mid-priced nearshoring options. */
  var COMPONENTS = [
    { id: 'battery', name: 'Battery pack', qty: 1, weightKg: 12, suppliers: [
      { id: 'bat_szn', name: 'Shenzhen CellWorks',  region: 'easia',    cost: 240, co2: 55, esg: 55, capacity: 2400 },
      { id: 'bat_nag', name: 'Nagoya PowerCell',    region: 'easia',    cost: 290, co2: 38, esg: 78, capacity: 1600 },
      { id: 'bat_gda', name: 'GreenCell Gdańsk',    region: 'europe',   cost: 320, co2: 26, esg: 90, capacity: 1100 },
      { id: 'bat_mty', name: 'Monterrey Volt',      region: 'namerica', cost: 285, co2: 44, esg: 70, capacity: 1000 }
    ]},
    { id: 'frame', name: 'Aluminium frame', qty: 1, weightKg: 8, suppliers: [
      { id: 'frm_tai', name: 'Taicang Alloy',       region: 'easia',    cost: 120, co2: 32, esg: 60, capacity: 2600 },
      { id: 'frm_han', name: 'Hanoi FrameWorks',    region: 'seasia',   cost: 105, co2: 35, esg: 48, capacity: 2000 },
      { id: 'frm_por', name: 'Porto Cycleworks',    region: 'europe',   cost: 165, co2: 18, esg: 90, capacity: 1100 },
      { id: 'frm_gdl', name: 'Guadalajara Metals',  region: 'latam',    cost: 138, co2: 26, esg: 72, capacity: 1300 }
    ]},
    { id: 'drive', name: 'Drive unit (motor)', qty: 1, weightKg: 5, suppliers: [
      { id: 'drv_szn', name: 'Shenzhen Dynamo',     region: 'easia',    cost: 150, co2: 22, esg: 58, capacity: 2600 },
      { id: 'drv_che', name: 'Chennai Drives',      region: 'sasia',    cost: 130, co2: 26, esg: 62, capacity: 1800 },
      { id: 'drv_stu', name: 'Stuttgart Antrieb',   region: 'europe',   cost: 230, co2: 12, esg: 92, capacity: 1100 }
    ]},
    { id: 'electronics', name: 'Electronics kit', qty: 1, weightKg: 1.5, suppliers: [
      { id: 'ele_szn', name: 'Shenzhen Circuits',   region: 'easia',    cost: 88,  co2: 18, esg: 62, capacity: 3200 },
      { id: 'ele_pen', name: 'Penang Micro',        region: 'seasia',   cost: 95,  co2: 16, esg: 74, capacity: 2000 },
      { id: 'ele_ein', name: 'Eindhoven Embedded',  region: 'europe',   cost: 145, co2: 9,  esg: 94, capacity: 1300 }
    ]}
  ];

  /* ---- Markets --------------------------------------------------------------
     size = base consumer demand (units/round, before the demand pattern).
     priceBeta / greenBeta / brandBeta drive the logit market shares:
       u = priceBeta·(ref−p)/ref + greenBeta·gs·(green−50)/50 + brandBeta·(brand−50)/50
     Europe cares most about sustainability; South Asia mostly about price. */
  var MARKETS = [
    { id: 'europe',   name: 'Europe',        region: 'europe',   size: 1200, refPrice: 1150, priceBeta: 3.2, greenBeta: 1.1, brandBeta: 0.5 },
    { id: 'namerica', name: 'North America', region: 'namerica', size: 1400, refPrice: 1250, priceBeta: 3.0, greenBeta: 0.7, brandBeta: 0.6 },
    { id: 'easia',    name: 'East Asia',     region: 'easia',    size: 1600, refPrice: 980,  priceBeta: 3.6, greenBeta: 0.5, brandBeta: 0.5 },
    { id: 'sasia',    name: 'South Asia',    region: 'sasia',    size: 900,  refPrice: 800,  priceBeta: 4.2, greenBeta: 0.3, brandBeta: 0.4 },
    { id: 'latam',    name: 'Latin America', region: 'latam',    size: 700,  refPrice: 880,  priceBeta: 3.8, greenBeta: 0.4, brandBeta: 0.4 }
  ];

  var CATALOG = {
    product: PRODUCT, regions: REGIONS, distances: DISTANCES,
    sameRegionDist: SAME_REGION_DIST, modes: MODES,
    components: COMPONENTS, markets: MARKETS
  };

  /* ---- Default session settings (everything the admin can tune) ----------- */
  var DEFAULT_SETTINGS = {
    rounds: 8,
    // Async practice mode: every firm plays its OWN self-paced game against
    // optimal (Nash-equilibrium) bots — no instructor pacing needed. Great as
    // homework before the live class game.
    asyncMode: false,
    asyncBots: 3,               // opponents per firm in async mode (1–5)
    startingCash: 500000,
    factoryCapacity: 800,       // units a firm can assemble per round
    startingComponents: 400,    // units of EACH component on hand at start (so round 1 can produce)
    startingFinished: 150,      // finished units on hand at start (so round 1 can sell)
    markets: ['europe', 'namerica', 'easia'],  // which markets are open
    // Demand pattern applied to every open market's base size:
    //   stable | step (jump at stepRound) | seasonal | walk (random walk)
    demandScale: 1.0,           // multiply every market's size (match your class size)
    demandPattern: 'step',
    stepRound: 4, stepFactor: 1.5,
    demandNoise: 0.12,          // ± uniform noise fraction each round
    marketIntel: true,          // firms see last round's market totals & avg price
    showStandings: true,        // firms see the leaderboard during play
    // Tariffs: base % applied to any import into a region (components into the
    // hub, finished goods into a market region), plus scheduled shocks.
    tariffBase: { europe: 5, namerica: 10, easia: 3, seasia: 3, sasia: 5, latam: 8 },
    tariffShocks: [
      { round: 4, importer: 'namerica', from: 'easia', rate: 35, announce: true }
    ],
    carbonTaxPerTon: 0,         // $ per tonne of gross CO2 (0 = off)
    carbonTaxFromRound: 1,
    greenSensitivity: 1.0,      // multiplier on every market's greenBeta
    eventsOn: true,             // seeded supply disruptions / ESG scandals
    autoResolve: false,         // resolve automatically once every firm submitted
    scoreWeightProfit: 50,      // final score: % weight on profit rank (rest = sustainability)
    holdingComp: 3,             // $ / component unit / round
    holdingFG: 12,              // $ / finished unit / round
    overheadPerRound: 15000,
    overdraftRate: 0.05,        // interest per round on negative cash
    offsetPricePerTon: 25,      // carbon offsets: reduce NET CO2 only, never gross
    renewableCapex: 60000,      // one-time renewable-energy upgrade at the factory
    auditCost: 8000             // one-time ESG audit of one supplier
  };

  var DEMAND_PATTERNS = [
    { id: 'stable',   name: 'Stable',                       hint: 'flat demand + noise' },
    { id: 'step',     name: 'Step jump',                    hint: 'demand jumps ×factor at a chosen round' },
    { id: 'seasonal', name: 'Seasonal',                     hint: '±35% sine wave over ~6 rounds' },
    { id: 'walk',     name: 'Random walk',                  hint: 'drifts ±12% per round' }
  ];

  return {
    CATALOG: CATALOG,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    DEMAND_PATTERNS: DEMAND_PATTERNS,
    surfaceLead: surfaceLead
  };
});
