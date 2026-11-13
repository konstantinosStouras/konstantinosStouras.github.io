// Original economic model. Monetary values are integer EUR cents.
export const VERSION = 1;
export const ITEMS = { cell: 'PV cell', frame: 'Recycled frame', controller: 'Controller', panel: 'Solar module' };
export const RECIPE = { cell: 32, frame: 1, controller: 2 };
export const productionRecipe = session => session.recipe ?? { cell: 24, frame: 1, controller: 1 };
export function itemName(session, item) {
  if (!session.recipe) return ITEMS[item];
  return { cell: 'Photo cell', frame: 'Recycled frame', controller: 'Junction box', panel: 'Solar panel' }[item];
}
export const FEATURES = ['offers', 'purchasing', 'production', 'finance', 'energy', 'investments', 'messaging'];
export const INVESTMENTS = {
  delivery: { name: 'Dispatch assistant', cost: 1800000, delay: 48 },
  purchasing: { name: 'Replenishment assistant', cost: 1500000, delay: 48 },
  machine: { name: 'Assembly line (+6 modules/h)', cost: 4500000, delay: 72 },
  warehouse: { name: 'Warehouse expansion (+50%)', cost: 1200000, delay: 48 },
  efficiency: { name: 'Energy efficiency retrofit (−25%)', cost: 2400000, delay: 48 }
};
export function fail(message, code = 400) { throw Object.assign(new Error(message), { status: code }); }
export function integer(value, name, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${name} must be a whole number between ${min} and ${max}.`);
  return value;
}
export function cleanText(value, name, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${name} must contain 1–${max} characters.`);
  return value.trim();
}
function bool(v, name) { if (typeof v !== 'boolean') fail(`${name} must be true or false.`); return v; }
function uid(s, kind) { return `${kind}-${++s.sequence}`; }
function random(s) { s.rng = (Math.imul(1664525, s.rng) + 1013904223) >>> 0; return s.rng / 4294967296; }
const sum = values => values.reduce((a, b) => a + b, 0);
export const balance = (c, account) => c.accounts[account] || 0;
export const profit = c => -balance(c, 'revenue') - balance(c, 'interestIncome') - balance(c, 'cogs') - balance(c, 'expense');
function post(s, c, description, lines) {
  if (sum(Object.values(lines)) !== 0 || Object.values(lines).some(v => !Number.isSafeInteger(v))) fail('Unbalanced ledger transaction.', 500);
  for (const [account, amount] of Object.entries(lines)) c.accounts[account] = balance(c, account) + amount;
  c.ledger.push({ id: uid(s, 'entry'), hour: s.hour, description, lines });
}
function available(c, amount) { if (balance(c, 'cash') < amount) fail(`Insufficient cash: need €${(amount / 100).toFixed(2)}; available €${(balance(c, 'cash') / 100).toFixed(2)}.`); }
function notice(s, c, text, kind = 'info') { c.notices.push({ id: uid(s, 'notice'), hour: s.hour, text, kind }); }
function schedule(s, c, type, at, data, description) {
  const event = { id: uid(s, 'event'), companyId: c.id, type, at, createdAt: s.hour, status: 'pending', data, description };
  s.events.push(event); return event;
}
function takeStock(c, item, qty) {
  const stock = c.inventory[item];
  if (stock.qty < qty) fail(`Insufficient ${ITEMS[item]} inventory: ${stock.qty} available, ${qty} requested.`);
  const value = qty === stock.qty ? stock.value : Math.round(stock.value * qty / stock.qty);
  const carbon = stock.qty ? stock.carbon * qty / stock.qty : 0;
  stock.qty -= qty; stock.value -= value; stock.carbon -= carbon;
  return { value, carbon };
}
function addStock(c, item, qty, value, carbon) {
  const stock = c.inventory[item]; stock.qty += qty; stock.value += value; stock.carbon += carbon;
}
function catalog() {
  const suppliers = [];
  for (const [item, price, carbon, lot] of [['cell', 310, 2.2, 24], ['frame', 1800, 9, 1], ['controller', 2400, 6, 1]]) {
    suppliers.push({ id: `${item}-circular`, name: 'Circular Works · rail', item, price, carbon, freight: 0.3, fee: 4500, lead: 48, term: 120, reliability: 95, maxDelay: 6, stock: 1000 * lot, replenish: 150 * lot, min: 10 * lot, lot, enabled: true });
    suppliers.push({ id: `${item}-express`, name: 'Atlas Components · road', item, price: Math.round(price * 1.24), carbon: carbon * 1.6, freight: 1.5, fee: 7500, lead: 18, term: 72, reliability: 90, maxDelay: 4, stock: 700 * lot, replenish: 100 * lot, min: lot, lot, enabled: true });
  }
  return {
    suppliers,
    routes: [
      { id: 'rail', name: 'Rail freight', hours: 36, fixed: 5000, unit: 180, carbonFixed: 12, carbonUnit: 0.8, reliability: 94, maxDelay: 8, enabled: true },
      { id: 'road', name: 'Electric road', hours: 18, fixed: 8500, unit: 320, carbonFixed: 20, carbonUnit: 1.8, reliability: 97, maxDelay: 4, enabled: true },
      { id: 'air', name: 'Air express', hours: 6, fixed: 14000, unit: 900, carbonFixed: 75, carbonUnit: 12, reliability: 90, maxDelay: 6, enabled: true }
    ],
    energy: [
      { id: 'grid', name: 'Regional grid', rates: [17, 22, 14], carbon: 0.32, fee: 0, daily: 1800, delay: 24, enabled: true },
      { id: 'wind', name: 'Wind collective', rates: [19, 16, 9], carbon: 0.035, fee: 45000, daily: 3200, delay: 48, enabled: true },
      { id: 'solar', name: 'Solar cooperative', rates: [12, 24, 22], carbon: 0.055, fee: 30000, daily: 2400, delay: 24, enabled: true }
    ],
    markets: [
      { id: 'local', name: 'Regional installers', volume: 95, referencePrice: 28500, greenWeight: 25, enabled: true },
      { id: 'export', name: 'International projects', volume: 120, referencePrice: 30000, greenWeight: 40, enabled: true }
    ]
  };
}
export function createSession({ id = 'session', name = 'The circular economy challenge', seed = 20261112, days = 30, companyNames = ['Helio Works', 'Northstar Solar', 'Verdant Energy'], revenueAt = 'receipt', dailyCorporateOverhead = 0, dailyEnergyOverhead = 0, dailyDepreciation = null, startingPrices = {}, inventoryStatement = 'cogs', openingUnitCosts = {} } = {}) {
  integer(seed, 'Seed', 0, 4294967295); integer(days, 'Duration in days', 1, 180);
  if (!['dispatch', 'receipt'].includes(revenueAt)) fail('Choose dispatch or customer receipt for revenue recognition.');
  integer(dailyCorporateOverhead, 'Daily corporate overhead (cents)', 0, 100000000);
  integer(dailyEnergyOverhead, 'Daily energy overhead (cents)', 0, 100000000);
  if (dailyDepreciation !== null) integer(dailyDepreciation, 'Daily depreciation (cents)', 0, 100000000);
  if (!['cogs', 'inventory-change'].includes(inventoryStatement)) fail('Choose a valid inventory statement format.');
  for (const [settings, keys, label, minimum] of [
    [startingPrices, ['local', 'export'], 'Starting sales price', 5000],
    [openingUnitCosts, Object.keys(ITEMS), 'Opening inventory unit cost', 0]
  ]) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) fail(`${label} settings must be an object.`);
    for (const [key, amount] of Object.entries(settings)) {
      if (!keys.includes(key)) fail(`Unknown ${label.toLowerCase()} key.`);
      integer(amount, label, minimum, 1000000);
    }
  }
  if (!Array.isArray(companyNames) || companyNames.length < 1 || companyNames.length > 12) fail('Choose 1–12 companies.');
  const s = { id, name: cleanText(name, 'Session name'), schema: VERSION, seed, rng: seed >>> 0, sequence: 0, revision: 0, hour: 0, startDate: '2026-01-01T00:00:00.000Z', endHour: days * 24, status: 'paused', secondsPerHour: 4, features: Object.fromEntries(FEATURES.map(f => [f, { visible: true, allowed: true }])), effects: { carbonDemand: true }, catalog: catalog(), companies: [], events: [], snapshots: [], messages: [], audit: [] };
  s.recipe = { ...RECIPE };
  s.accounting = { revenueAt, dailyCorporateOverhead };
  if (dailyEnergyOverhead) s.accounting.dailyEnergyOverhead = dailyEnergyOverhead;
  if (dailyDepreciation !== null) s.accounting.dailyDepreciation = dailyDepreciation;
  if (inventoryStatement !== 'cogs') s.accounting.inventoryStatement = inventoryStatement;
  if (Object.keys(startingPrices).length) s.accounting.startingPrices = { ...startingPrices };
  if (Object.keys(openingUnitCosts).length) s.accounting.openingUnitCosts = { ...openingUnitCosts };
  companyNames.forEach((name, i) => {
    const c = { id: `company-${i + 1}`, name: cleanText(name, 'Company name', 60), accounts: {}, ledger: [], inventory: {}, offers: [], orders: [], shipments: [], purchases: [], loans: [], deposits: [], investments: [], notices: [], reorder: {}, autoStatus: {}, workers: 8, machines: 2, shifts: [true, false, false], energy: 'grid', efficiency: 1, satisfaction: 1, quality: 1, marketing: 0, research: 0, production: 0, energyKwh: 0, energyCost: 0, emissions: 0, dispatched: 0, received: 0, receivedValue: 0, demandUnits: 0, lastBottleneck: 'Waiting for the first production hour' };
    for (const [item, qty, cost, carbon, capacity] of [['cell', 14400, 310, 2.2, 36000], ['frame', 600, 1800, 9, 1500], ['controller', 600, 2400, 6, 1500], ['panel', 180, 13000, 72, 1200]]) c.inventory[item] = { qty, value: qty * (openingUnitCosts[item] ?? cost), carbon: qty * carbon, capacity };
    const inventoryValue = sum(Object.values(c.inventory).map(x => x.value));
    post(s, c, 'Opening capital and assets', { cash: 18000000, inventory: inventoryValue, fixedAssets: 6000000, equity: -(24000000 + inventoryValue) });
    for (const market of s.catalog.markets) c.offers.push({ id: `${market.id}-standard`, marketId: market.id, price: startingPrices[market.id] ?? market.referencePrice, min: 1, max: 500, delivery: market.id === 'local' ? 60 : 96, payment: 72, enabled: true });
    s.companies.push(c);
  });
  return s;
}
export function inventoryStatementValues(company) {
  const openingInventory = company.ledger[0].lines.inventory;
  const purchases = sum(company.purchases.filter(purchase => purchase.receivedAt != null).map(purchase => purchase.cost));
  const inventoryChange = balance(company, 'inventory') + balance(company, 'transit') - openingInventory;
  return { purchases, inventoryChange };
}
function sampleDelay(s, obj) { return random(s) * 100 < obj.reliability ? 0 : 1 + Math.floor(random(s) * obj.maxDelay); }
function purchase(s, c, a, automated = false) {
  const sup = s.catalog.suppliers.find(x => x.id === a.supplierId && x.enabled);
  if (!sup) fail('Choose an enabled supplier.');
  const qty = integer(a.qty, 'Purchase quantity', sup.min, 1000000);
  if (qty % sup.lot) fail(`Order in lots of ${sup.lot}.`);
  if (sup.stock < qty) fail(`Supplier has only ${sup.stock} units available.`);
  const inFlight = sum(c.purchases.filter(p => p.item === sup.item && p.receivedAt === null).map(p => p.qty));
  if (c.inventory[sup.item].qty + inFlight + qty > c.inventory[sup.item].capacity * 2) fail('Purchase would exceed the hard storage limit (twice base capacity including incoming stock).');
  const cost = qty * sup.price + (automated ? Math.round(sup.fee / 2) : sup.fee);
  const commitments = -balance(c, 'payable');
  if (cost + commitments > balance(c, 'cash') + 8000000) fail('Supplier credit limit exceeded: cash plus €80,000 less current payables.');
  const p = { id: uid(s, 'purchase'), supplier: sup.name, item: sup.item, qty, cost, carbon: qty * (sup.carbon + sup.freight), orderedAt: s.hour, expectedAt: s.hour + sup.lead, receivedAt: null, paidAt: null, term: sup.term };
  sup.stock -= qty; c.purchases.push(p);
  post(s, c, `Purchase committed: ${p.id}`, { inbound: cost, payable: -cost });
  schedule(s, c, 'purchaseReceipt', p.expectedAt + sampleDelay(s, sup), { purchaseId: p.id }, `${qty} ${itemName(s, p.item)} arrive from ${sup.name}`);
  return `Purchase ${p.id} accepted. Expected in ${sup.lead} h; payment ${sup.term} h after receipt.`;
}
function dispatch(s, c, a) {
  const order = c.orders.find(x => x.id === a.orderId);
  if (!order) fail('Order not found.');
  const qty = integer(a.qty, 'Dispatch quantity', 1, order.remaining);
  const route = s.catalog.routes.find(x => x.id === a.routeId && x.enabled);
  if (!route) fail('Choose an enabled route.');
  const cost = route.fixed + qty * route.unit, freightTerm = route.term ?? 0;
  if (!freightTerm) available(c, cost);
  const stock = takeStock(c, 'panel', qty);
  const shipment = { id: uid(s, 'shipment'), orderId: order.id, qty, cost, stockValue: stock.value, carbon: route.carbonFixed + qty * route.carbonUnit, route: route.name, dispatchedAt: s.hour, expectedAt: s.hour + route.hours, receivedAt: null, paidAt: null, revenue: qty * order.price };
  order.remaining -= qty; c.shipments.push(shipment); c.dispatched += qty; c.emissions += shipment.carbon;
  post(s, c, `Goods in transit: ${shipment.id}`, { transit: stock.value, inventory: -stock.value });
  if (s.accounting?.revenueAt === 'dispatch') {
    shipment.recognizedAt = s.hour;
    post(s, c, `Sale recognized at dispatch ${shipment.id}`, { receivable: shipment.revenue, revenue: -shipment.revenue, cogs: stock.value, transit: -stock.value });
  }
  if (freightTerm) {
    shipment.freightDueAt = s.hour + freightTerm;
    shipment.freightPaidAt = null;
    post(s, c, `Freight incurred: ${shipment.id}`, { expense: cost, payable: -cost });
    schedule(s, c, 'freightPayment', shipment.freightDueAt, { shipmentId: shipment.id }, `Pay freight for ${shipment.id}`);
  } else post(s, c, `Freight paid: ${shipment.id}`, { expense: cost, cash: -cost });
  schedule(s, c, 'customerReceipt', shipment.expectedAt + sampleDelay(s, route), { shipmentId: shipment.id }, `${qty} modules reach customer (${shipment.id})`);
  const early = order.dueAt - shipment.expectedAt;
  return `Dispatched ${qty} of ${order.originalQty} original modules. ${order.remaining} remain. Freight €${(cost / 100).toFixed(2)} ${freightTerm ? `due in ${freightTerm} h` : 'paid'}. ${early < 0 ? 'Expected late: customer satisfaction will fall at receipt.' : early > 24 ? 'Expected more than 24 h early: a small satisfaction penalty applies at receipt.' : 'Expected within the delivery window.'} Transit can be delayed by up to ${route.maxDelay} h.`;
}
function requireCompany(s, actor, a) {
  if (actor.role !== 'student') fail('Instructor previews are read-only. Sign in as a student to make company decisions.', 403);
  if (a.companyId && a.companyId !== actor.companyId) fail('You cannot act for another company.', 403);
  const c = s.companies.find(x => x.id === actor.companyId);
  if (!c) fail('Join a company first.', 403); return c;
}
export function applyCommand(s, actor, a, realAt = '2026-01-01T00:00:00.000Z', { replay = false } = {}) {
  if (!a || typeof a.type !== 'string') fail('A command type is required.');
  if (s.status === 'deleted') fail('Session not found.', 404);
  if (s.status === 'completed' && actor.role !== 'instructor' && a.type === 'message' && !replay) fail('This session is closed and read-only.', 409);
  // Preserve contracts when opening sessions saved before energy-term snapshots were added.
  for (const c of s.companies) c.energyTerms ||= structuredClone(s.catalog.energy.find(x => x.id === c.energy));
  for (const e of s.events) if (e.type === 'energy' && e.status === 'pending') e.data.terms ||= structuredClone(s.catalog.energy.find(x => x.id === e.data.energyId));
  let result;
  if (['step', 'clock', 'configure', 'catalog', 'renameCompany', 'assignment', 'closeSession', 'deleteSession'].includes(a.type)) {
    if (actor.role !== 'instructor') fail('Instructor access required.', 403);
    // Store.assign updates membership in the same transaction. This deterministic
    // transition preserves its audit record and revision in exported replay.
    if (a.type === 'assignment') {
      cleanText(a.userId, 'Assigned user', 200);
      if (!s.companies.some(c => c.id === a.companyId)) fail('Company not found.');
      result = 'Student assignment updated.';
    }
    if (a.type === 'closeSession') { s.plannedEndHour ??= s.endHour; s.status = 'completed'; s.endHour = s.hour; result = 'Session closed.'; }
    if (a.type === 'deleteSession') { s.status = 'deleted'; result = 'Session deleted; stored records retained.'; }
    if (a.type === 'step') { if (s.status === 'running') fail('Pause before stepping the clock.'); advance(s, integer(a.hours, 'Hours', 1, 168)); result = `Advanced to simulation hour ${s.hour}.`; }
    if (a.type === 'clock') {
      if (!['running', 'paused'].includes(a.status)) fail('Invalid clock status.');
      if (s.hour >= s.endHour) fail('Session completed. Extend its duration to resume.');
      s.secondsPerHour = integer(a.secondsPerHour ?? s.secondsPerHour, 'Seconds per hour', 1, 120);
      s.status = a.status; result = `Clock ${s.status}.`;
    }
    if (a.type === 'configure') {
      if (a.secondsPerHour !== undefined) s.secondsPerHour = integer(a.secondsPerHour, 'Seconds per hour', 1, 120);
      if (a.studentAccess !== undefined) s.studentAccess = bool(a.studentAccess, 'Student access');
      if (a.name !== undefined) s.name = cleanText(a.name, 'Session name');
      if (a.endHour !== undefined) { s.endHour = integer(a.endHour, 'End hour', Math.max(24, s.hour), 4320); if (s.hour >= s.endHour) s.status = 'completed'; else if (s.status === 'completed') s.status = 'paused'; }
      if (a.carbonDemand !== undefined) s.effects.carbonDemand = bool(a.carbonDemand, 'Carbon demand effect');
      if (a.feature !== undefined) { if (!FEATURES.includes(a.feature)) fail('Unknown capability.'); s.features[a.feature] = { visible: bool(a.visible, 'Visibility'), allowed: bool(a.allowed, 'Decision permission') }; }
      result = 'Settings applied to future decisions and events. Existing contracts keep their accepted terms.';
    }
    if (a.type === 'renameCompany') { const c = s.companies.find(x => x.id === a.companyId); if (!c) fail('Company not found.'); c.name = cleanText(a.name, 'Company name', 60); result = 'Company renamed.'; }
    if (a.type === 'catalog') {
      const editable = { suppliers: { price: [1, 1000000], stock: [0, 10000000], replenish: [0, 1000000], lead: [1, 720], term: [0, 720], reliability: [0, 100] }, routes: { hours: [1, 720], term: [0, 720], fixed: [0, 1000000], unit: [0, 100000], reliability: [0, 100] }, markets: { volume: [0, 1000], referencePrice: [100, 1000000], greenWeight: [0, 100] }, energy: { fee: [0, 10000000], daily: [0, 1000000], delay: [1, 720] } };
      const rules = editable[a.collection]; if (!rules) fail('Unknown catalog.');
      const row = s.catalog[a.collection].find(x => x.id === a.id); if (!row) fail('Catalog row not found.');
      if (!a.patch || typeof a.patch !== 'object') fail('Catalog changes required.');
      for (const [key, value] of Object.entries(a.patch)) { if (key === 'enabled') row.enabled = bool(value, 'Enabled'); else if (rules[key]) row[key] = integer(value, key, ...rules[key]); else fail(`Field ${key} is not editable.`); }
      result = 'Catalog updated; pending contracts retain their original terms.';
    }
  } else if (a.type === 'message') {
    if (!s.features.messaging.allowed) fail('Messaging is disabled.', 403);
    const channel = cleanText(a.channel, 'Channel');
    // Keep the sequence and revision of previously accepted messages during replay.
    const legacyMessage = replay && (channel === 'global' || channel.startsWith('peer:'));
    if (!legacyMessage && !canMessage(s, actor, channel, true)) fail('You do not have access to this channel.', 403);
    const message = { id: uid(s, 'message'), channel, text: cleanText(a.text, 'Message', 2000), senderId: actor.id, senderName: actor.name, role: actor.role, companyId: actor.companyId || null, hour: s.hour, realAt };
    s.messages.push(message); result = 'Message sent.';
  } else {
    if (s.status === 'completed') fail('Session completed. Pending obligations are preserved; ask the instructor to extend it.');
    const c = requireCompany(s, actor, a);
    const groups = { offer: 'offers', purchase: 'purchasing', dispatch: 'offers', shifts: 'production', staff: 'production', loan: 'finance', deposit: 'finance', energy: 'energy', invest: 'investments', reorder: 'investments', budget: 'investments' };
    if (!groups[a.type]) fail('Unknown command.');
    if (!s.features[groups[a.type]].allowed) fail(`The instructor has disabled ${groups[a.type]} decisions.`, 403);
    if (a.type === 'purchase') result = purchase(s, c, a);
    if (a.type === 'dispatch') result = dispatch(s, c, a);
    if (a.type === 'offer') {
      const offer = c.offers.find(x => x.id === a.offerId); if (!offer) fail('Offer not found.');
      const next = { price: integer(a.price, 'Price in cents', 5000, 1000000), min: integer(a.min, 'Minimum quantity', 1, 10000), max: integer(a.max, 'Maximum quantity', 1, 10000), delivery: integer(a.delivery, 'Delivery hours', 6, 720), payment: integer(a.payment, 'Payment hours', 0, 720), enabled: bool(a.enabled, 'Offer enabled') };
      if (next.min > next.max) fail('Minimum quantity cannot exceed maximum quantity.');
      Object.assign(offer, next); result = 'Offer saved. Existing orders retain their original price and promise.';
    }
    if (a.type === 'shifts') {
      if (!Array.isArray(a.shifts) || a.shifts.length !== 3 || a.shifts.some(x => typeof x !== 'boolean')) fail('Choose exactly three shift states.');
      if (s.events.some(e => e.companyId === c.id && e.type === 'shifts' && e.status === 'pending')) fail('A shift change is already pending.');
      schedule(s, c, 'shifts', (Math.floor(s.hour / 8) + 1) * 8, { shifts: a.shifts }, 'Production shift schedule changes'); result = 'Shift changes queued for the next 8-hour boundary.';
    }
    if (a.type === 'staff') {
      const delta = integer(a.delta, 'Worker change', -20, 20); if (!delta) fail('Choose a nonzero staff change.');
      const future = c.workers + sum(s.events.filter(e => e.companyId === c.id && e.type === 'staff' && e.status === 'pending').map(e => e.data.delta)) + delta;
      integer(future, 'Resulting workers', 1, 80);
      const cost = Math.abs(delta) * (delta > 0 ? 25000 : 50000); available(c, cost); post(s, c, 'Recruitment / severance fee', { expense: cost, cash: -cost });
      schedule(s, c, 'staff', s.hour + 48, { delta }, `${delta > 0 ? '+' : ''}${delta} workers become effective`); result = 'Staff change accepted; effective in 48 h.';
    }
    if (a.type === 'energy') {
      const energy = s.catalog.energy.find(x => x.id === a.energyId && x.enabled); if (!energy) fail('Choose an enabled energy supplier.');
      if (c.energy === energy.id || s.events.some(e => e.companyId === c.id && e.type === 'energy' && e.status === 'pending')) fail('Already selected or a switch is pending.');
      available(c, energy.fee); post(s, c, 'Energy agreement fee', { expense: energy.fee, cash: -energy.fee });
      schedule(s, c, 'energy', s.hour + energy.delay, { energyId: energy.id, terms: structuredClone(energy) }, `Switch to ${energy.name}`); result = `Switch accepted. Current provider remains effective for ${energy.delay} h.`;
    }
    if (a.type === 'invest') {
      const inv = INVESTMENTS[a.kind]; if (!inv) fail('Unknown investment.');
      if (c.investments.some(x => x.kind === a.kind) && !['machine', 'warehouse'].includes(a.kind)) fail('This investment is already active or pending.');
      const pending = c.investments.filter(x => x.kind === a.kind && x.activeAt === null).length;
      if (pending) fail('An investment of this type is already pending.');
      if (a.kind === 'machine' && c.machines >= 10) fail('Maximum 10 assembly lines.');
      available(c, inv.cost); post(s, c, `Prepaid investment: ${inv.name}`, { construction: inv.cost, cash: -inv.cost });
      const contract = { id: uid(s, 'investment'), kind: a.kind, cost: inv.cost, orderedAt: s.hour, activeAt: null }; c.investments.push(contract);
      schedule(s, c, 'investment', s.hour + inv.delay, { investmentId: contract.id }, `${inv.name} becomes active`); result = `${inv.name} accepted. Funds reserved now; active in ${inv.delay} h.`;
    }
    if (a.type === 'reorder') {
      const sup = s.catalog.suppliers.find(x => x.id === a.supplierId && x.enabled); if (!sup) fail('Choose an enabled supplier.');
      const point = integer(a.point, 'Reorder point', 0, c.inventory[sup.item].capacity); const qty = integer(a.qty, 'Order quantity', sup.min, c.inventory[sup.item].capacity);
      if (qty % sup.lot) fail(`Use a multiple of lot size ${sup.lot}.`);
      c.reorder[sup.item] = { supplierId: sup.id, point, qty, enabled: bool(a.enabled, 'Replenishment enabled') }; result = 'Policy saved. It runs hourly after the replenishment assistant is active and purchasing is permitted.';
    }
    if (a.type === 'budget') { c.marketing = integer(a.marketing, 'Daily marketing cents', 0, 100000); c.research = integer(a.research, 'Daily research cents', 0, 100000); result = 'Budgets saved. Daily costs and quality effects apply at each daily close.'; }
    if (a.type === 'loan') {
      if (a.plan === 'annuity') {
        if (a.repaymentAnchor !== undefined && a.repaymentAnchor !== 'request') fail('Invalid annuity repayment anchor.');
        const amount = integer(a.amount, 'Principal in cents', 100000, 15000000);
        const weeks = integer(a.weeks, 'Term in weeks', 1, 20);
        if (sum(c.loans.filter(x => x.paidAt === null).map(x => x.amount)) + amount > 15000000) fail('Total loan limit is €150,000 including pending funding.');
        const rate = 0.08 * 168 / 8760;
        const weeklyPayment = Math.round(amount * rate / (1 - (1 + rate) ** -weeks));
        const installments = [];
        let remaining = amount;
        for (let i = 1; i <= weeks; i++) {
          const interest = Math.round(remaining * rate);
          const principal = i === weeks ? remaining : Math.min(remaining, weeklyPayment - interest);
          installments.push({ principal, interest });
          remaining -= principal;
        }
        const loan = { id: uid(s, 'loan'), amount, term: weeks * 168, plan: 'annuity', installments, interest: sum(installments.map(i => i.interest)), requestedAt: s.hour, fundedAt: null, paidAt: null };
        if (a.repaymentAnchor === 'request') loan.repaymentAnchor = 'request';
        c.loans.push(loan);
        schedule(s, c, 'loanFunding', s.hour + 48, { loanId: loan.id }, `Loan ${loan.id} funding: €${amount / 100}`);
        result = `Annuity loan accepted. Funding in 48 h. Weekly payment €${(weeklyPayment / 100).toFixed(2)}.`;
      } else {
      const amount = integer(a.amount, 'Loan cents', 100000, 15000000), term = integer(a.term, 'Term hours', 168, 2160);
      if (sum(c.loans.filter(x => x.paidAt === null).map(x => x.amount)) + amount > 15000000) fail('Total loan limit is €150,000 including pending funding.');
      const l = { id: uid(s, 'loan'), amount, term, interest: Math.round(amount * 0.09 * term / 8760), requestedAt: s.hour, fundedAt: null, paidAt: null }; c.loans.push(l);
      schedule(s, c, 'loanFunding', s.hour + 24, { loanId: l.id }, `Loan ${l.id} funding: €${amount / 100}`); result = 'Loan accepted. Funding in 24 h; 9% simple annual interest, one repayment at maturity.';
      }
    }
    if (a.type === 'deposit') {
      const amount = integer(a.amount, 'Deposit cents', 10000, 10000000);
      const term = a.weeks === undefined
        ? integer(a.term, 'Term hours', 24, 2160)
        : integer(a.weeks, 'Term in weeks', 1, 26) * 168;
      available(c, amount);
      const d = { id: uid(s, 'deposit'), amount, term, interest: Math.round(amount * 0.04 * term / 8760), placedAt: s.hour, maturedAt: null }; c.deposits.push(d);
      post(s, c, `Term deposit ${d.id}`, { deposits: amount, cash: -amount }); schedule(s, c, 'depositMaturity', s.hour + term, { depositId: d.id }, `Deposit ${d.id} matures`); result = 'Deposit placed. Principal is locked until maturity; 4% simple annual interest.';
    }
    notice(s, c, result, 'decision');
  }
  s.audit.push({ id: uid(s, 'audit'), hour: s.hour, realAt, actorId: actor.id, actorName: actor.name, role: actor.role, companyId: actor.companyId || null, command: structuredClone(a), result });
  s.revision++; return result;
}
export function canMessage(s, actor, channel, sending = false) {
  if (!['instructor', 'student'].includes(actor.role)) return false;
  if (sending && actor.role !== 'instructor' && ['completed','deleted'].includes(s.status)) return false;

  if (channel === 'announcements') return !sending || actor.role === 'instructor';
  const [kind, ...ids] = channel.split(':');
  if (ids.some(id => !s.companies.some(c => c.id === id))) return false;
  if (kind === 'teacher' && ids.length === 1) return actor.role === 'instructor' || ids[0] === actor.companyId;
  if (kind === 'team' && ids.length === 1) return actor.role === 'student' && ids[0] === actor.companyId;

  return false;
}
function settle(s, c, e, lines, required, description) {
  if (balance(c, 'cash') < required) { e.at = s.hour + 24; e.attempts = (e.attempts || 0) + 1; e.blocked = 'Insufficient cash; retry in 24 h'; notice(s, c, `${description} overdue: insufficient cash. Will retry in 24 h.`, 'warning'); return false; }
  post(s, c, description, lines); delete e.blocked; return true;
}
function executeEvent(s, e) {
  const c = s.companies.find(x => x.id === e.companyId), d = e.data;
  if (e.type === 'purchaseReceipt') {
    const p = c.purchases.find(x => x.id === d.purchaseId); p.receivedAt = s.hour;
    addStock(c, p.item, p.qty, p.cost, p.carbon); c.emissions += p.carbon;
    post(s, c, `Supplier receipt ${p.id}`, { inventory: p.cost, inbound: -p.cost });
    schedule(s, c, 'purchasePayment', s.hour + p.term, { purchaseId: p.id }, `Pay supplier for ${p.id}`);
  }
  if (e.type === 'purchasePayment') {
    const p = c.purchases.find(x => x.id === d.purchaseId);
    if (!settle(s, c, e, { payable: p.cost, cash: -p.cost }, p.cost, `Supplier payment ${p.id}`)) return; p.paidAt = s.hour;
  }
  if (e.type === 'freightPayment') {
    const sh = c.shipments.find(x => x.id === d.shipmentId);
    if (!settle(s, c, e, { payable: sh.cost, cash: -sh.cost }, sh.cost, `Freight payment ${sh.id}`)) return;
    sh.freightPaidAt = s.hour;
  }
  if (e.type === 'customerReceipt') {
    const sh = c.shipments.find(x => x.id === d.shipmentId), order = c.orders.find(x => x.id === sh.orderId); sh.receivedAt = s.hour; order.received += sh.qty; c.received += sh.qty; c.receivedValue += sh.revenue;
    if (sh.recognizedAt == null) {
      post(s, c, `Revenue recognized at customer receipt ${sh.id}`, { receivable: sh.revenue, revenue: -sh.revenue });
      post(s, c, `Cost of delivered goods ${sh.id}`, { cogs: sh.stockValue, transit: -sh.stockValue });
    }
    const early = order.dueAt - s.hour;
    c.satisfaction = Math.max(0.3, Math.min(1.3, c.satisfaction + (early < 0 ? -0.08 : early > 24 ? -0.02 : 0.025)));
    schedule(s, c, 'customerPayment', s.hour + order.payment, { shipmentId: sh.id }, `Customer pays for ${sh.id}`);
  }
  if (e.type === 'customerPayment') {
    const sh = c.shipments.find(x => x.id === d.shipmentId); sh.paidAt = s.hour;
    post(s, c, `Customer collection ${sh.id}`, { cash: sh.revenue, receivable: -sh.revenue });
  }
  if (e.type === 'shifts') c.shifts = d.shifts;
  if (e.type === 'staff') c.workers += d.delta;
  if (e.type === 'energy') { c.energy = d.energyId; c.energyTerms = d.terms || structuredClone(s.catalog.energy.find(x => x.id === d.energyId)); }
  if (e.type === 'investment') {
    const inv = c.investments.find(x => x.id === d.investmentId); inv.activeAt = s.hour;
    post(s, c, `Investment commissioned ${inv.id}`, { fixedAssets: inv.cost, construction: -inv.cost });
    if (inv.kind === 'machine') c.machines++;
    if (inv.kind === 'warehouse') for (const stock of Object.values(c.inventory)) stock.capacity = Math.floor(stock.capacity * 1.5);
    if (inv.kind === 'efficiency') c.efficiency = 0.75;
  }
  if (e.type === 'loanFunding') {
    const l = c.loans.find(x => x.id === d.loanId); l.fundedAt = s.hour;
    post(s, c, `Loan funding ${l.id}`, { cash: l.amount, debt: -l.amount });
    if (l.installments) {
      const anchor = l.repaymentAnchor === 'request' ? l.requestedAt : s.hour;
      l.installments.forEach((_, index) => schedule(s, c, 'loanRepayment', anchor + (index + 1) * 168, { loanId: l.id, installment: index }, `Loan ${l.id} weekly payment ${index + 1}`));
    } else schedule(s, c, 'loanRepayment', s.hour + l.term, { loanId: l.id }, `Repay loan ${l.id} plus interest`);
  }
  if (e.type === 'loanRepayment') {
    const l = c.loans.find(x => x.id === d.loanId);
    const installment = l.installments?.[d.installment];
    const { principal, interest } = installment ?? { principal: l.amount, interest: l.interest };
    if (!e.accrued) { post(s, c, `Loan interest due ${l.id}`, { expense: interest, interestPayable: -interest }); e.accrued = true; }
    if (!settle(s, c, e, { debt: principal, interestPayable: interest, cash: -principal - interest }, principal + interest, `Loan repayment ${l.id}`)) return;
    if (installment) installment.paidAt = s.hour;
    if (!l.installments || l.installments.every(i => i.paidAt != null)) l.paidAt = s.hour;
  }
  if (e.type === 'depositMaturity') {
    const dep = c.deposits.find(x => x.id === d.depositId); dep.maturedAt = s.hour;
    post(s, c, `Deposit maturity ${dep.id}`, { cash: dep.amount + dep.interest, deposits: -dep.amount, interestIncome: -dep.interest });
  }
  e.status = 'completed'; e.completedAt = s.hour;
  notice(s, c, e.description, 'outcome');
}
function production(s, c, shifts) {
  const shift = Math.floor(((s.hour - 1) % 24) / 8);
  if (!shifts[shift]) { c.lastBottleneck = 'Shift inactive'; return; }
  const energy = c.energyTerms || s.catalog.energy.find(x => x.id === c.energy);
  const machineLimit = c.machines * 6, staffLimit = c.workers * 2, capacity = c.inventory.panel.capacity - c.inventory.panel.qty;
  const recipe = Object.entries(productionRecipe(s));
  const materials = recipe.map(([item, count]) => [item, Math.floor(c.inventory[item].qty / count)]);
  const wage = c.workers * 1350, perUnitEnergy = Math.round(3 * c.efficiency * energy.rates[shift]);
  const cashLimit = Math.max(0, Math.floor((balance(c, 'cash') - wage) / perUnitEnergy));
  const limits = [['Assembly lines', machineLimit], ['Staff', staffLimit], ['Finished-goods space', capacity], ['Cash for wages and energy', cashLimit], ...materials.map(([k, n]) => [itemName(s, k), n])];
  const qty = Math.max(0, Math.min(...limits.map(x => x[1]))); c.lastBottleneck = limits.find(x => x[1] === qty)?.[0] || 'At capacity';
  if (balance(c, 'cash') < wage) { c.lastBottleneck = 'Production paused: insufficient cash for wages'; return; }
  post(s, c, 'Active shift wages', { expense: wage, cash: -wage });
  if (!qty) return;
  let value = 0, carbon = 0;
  for (const [item, amount] of recipe) { const used = takeStock(c, item, qty * amount); value += used.value; carbon += used.carbon; }
  const kwh = qty * 3 * c.efficiency, energyCost = qty * perUnitEnergy;
  addStock(c, 'panel', qty, value, carbon + kwh * energy.carbon);
  // Material conversion leaves total inventory account unchanged; energy and labour are period costs.
  post(s, c, 'Production electricity', { expense: energyCost, cash: -energyCost });
  c.production += qty; c.energyKwh += kwh; c.energyCost += energyCost; c.emissions += kwh * energy.carbon;
}
function demand(s) {
  for (const market of s.catalog.markets.filter(m => m.enabled && m.volume > 0)) {
    // Four opportunities per day; common random demand then weighted integer allocation.
    const units = Math.round(market.volume * (0.8 + 0.4 * random(s)));
    const candidates = s.companies.map(c => {
      const offer = c.offers.filter(o => o.marketId === market.id && o.enabled).sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
      if (!offer) return null;
      const footprint = c.inventory.panel.qty ? c.inventory.panel.carbon / c.inventory.panel.qty : 75;
      const green = s.effects.carbonDemand ? Math.exp(-market.greenWeight / 100 * footprint / 100) : 1;
      const score = Math.pow(market.referencePrice / offer.price, 2) * c.satisfaction * c.quality * (1 + Math.sqrt(c.marketing / 10000) * 0.1) * green * (1 + offer.payment / 2400) / (1 + offer.delivery / 480);
      return { c, offer, score };
    }).filter(Boolean);
    const total = sum(candidates.map(x => x.score));
    if (!total) continue;
    const allocated = candidates.map(x => ({ ...x, exact: units * x.score / total, qty: Math.floor(units * x.score / total) }));
    let left = units - sum(allocated.map(x => x.qty));
    for (const x of [...allocated].sort((a, b) => (b.exact - b.qty) - (a.exact - a.qty) || a.c.id.localeCompare(b.c.id))) if (left-- > 0) x.qty++;
    for (const { c, offer, qty } of allocated) {
      if (qty < offer.min) continue; const accepted = Math.min(qty, offer.max);
      c.orders.push({ id: uid(s, 'order'), marketId: market.id, customer: `${market.name} · ${s.hour}h`, originalQty: accepted, remaining: accepted, received: 0, price: offer.price, payment: offer.payment, createdAt: s.hour, dueAt: s.hour + offer.delivery, reason: 'Weighted allocation: price, delivery promise, payment term, quality, reputation, marketing' + (s.effects.carbonDemand ? ' and module carbon intensity.' : '. Carbon effect is disabled.') }); c.demandUnits += accepted;
    }
  }
}
function automated(s, c) {
  const has = kind => c.investments.some(x => x.kind === kind && x.activeAt !== null);
  c.autoStatus = { delivery: has('delivery') ? 'No open orders.' : 'Install the dispatch assistant to enable automatic shipping.', purchasing: has('purchasing') ? 'Stock plus incoming goods is above the reorder points.' : 'Install the replenishment assistant to execute saved policies.' };
  if (has('purchasing')) {
    if (!s.features.purchasing.allowed) c.autoStatus.purchasing = 'Paused by instructor purchasing permission.';
    else for (const [item, policy] of Object.entries(c.reorder)) {
      if (!policy.enabled) continue;
      const incoming = sum(c.purchases.filter(p => p.item === item && p.receivedAt === null).map(p => p.qty));
      if (c.inventory[item].qty + incoming <= policy.point) {
        try { c.autoStatus.purchasing = purchase(s, c, policy, true); notice(s, c, c.autoStatus.purchasing, 'automation'); }
        catch (err) { c.autoStatus.purchasing = `Waiting: ${err.message}`; }
      }
    }
  }
  if (has('delivery')) {
    if (!s.features.offers.allowed) { c.autoStatus.delivery = 'Paused by instructor shipping permission.'; return; }
    const order = c.orders.find(x => x.remaining > 0); if (!order) return;
    const qty = Math.min(order.remaining, c.inventory.panel.qty);
    if (!qty) { c.autoStatus.delivery = `Waiting for modules for ${order.id}.`; return; }
    const routes = s.catalog.routes.filter(r => r.enabled).sort((a, b) => a.fixed + a.unit * qty - b.fixed - b.unit * qty || a.id.localeCompare(b.id));
    const feasible = routes.filter(r => s.hour + r.hours + r.maxDelay <= order.dueAt);
    const route = feasible[0] || [...routes].sort((a, b) => a.hours - b.hours)[0];
    if (!route) { c.autoStatus.delivery = 'Waiting for an enabled transport route.'; return; }
    const nextAt = order.dueAt - route.hours - route.maxDelay - 12;
    if (s.hour < nextAt) { c.autoStatus.delivery = `Next: ${qty} modules for ${order.id} by ${route.name} at hour ${nextAt}; 12 h target buffer plus maximum carrier delay.`; return; }
    try { c.autoStatus.delivery = dispatch(s, c, { orderId: order.id, qty, routeId: route.id }); notice(s, c, c.autoStatus.delivery, 'automation'); }
    catch (err) { c.autoStatus.delivery = `Waiting: ${err.message}`; }
  }
}
function dailyClose(s) {
  for (const sup of s.catalog.suppliers) sup.stock = Math.min(sup.stock + sup.replenish, sup.replenish * 30 + 10000);
  for (const c of s.companies) {
    const energy = c.energyTerms || s.catalog.energy.find(e => e.id === c.energy);
    const overflow = sum(Object.values(c.inventory).map(x => Math.max(0, x.qty - x.capacity) * 5));
    const overhead = 35000 + energy.daily + overflow + c.marketing + c.research;
    // Contractual overhead is expensed even if cash is exhausted; arrears are explicit.
    const paid = Math.min(balance(c, 'cash'), overhead), arrears = overhead - paid;
    post(s, c, 'Daily rent, energy standing charge, storage and budgets', { expense: overhead, cash: -paid, overheadPayable: -arrears });
    const corporate = s.accounting?.dailyCorporateOverhead ?? 0;
    const corporatePaid = Math.min(balance(c, 'cash'), corporate);
    if (corporate) post(s, c, 'Daily corporate overhead', { expense: corporate, cash: -corporatePaid, overheadPayable: corporatePaid - corporate });
    const energyOverhead = s.accounting?.dailyEnergyOverhead ?? 0;
    const energyPaid = Math.min(balance(c, 'cash'), energyOverhead);
    if (energyOverhead) {
      post(s, c, 'Daily energy overhead', { expense: energyOverhead, cash: -energyPaid, overheadPayable: energyPaid - energyOverhead });
      c.energyCost += energyOverhead;
    }
    const oldArrears = -balance(c, 'overheadPayable');
    if (oldArrears && balance(c, 'cash') > 0) { const payment = Math.min(oldArrears, balance(c, 'cash')); post(s, c, 'Settle overhead arrears', { overheadPayable: payment, cash: -payment }); }
    if (arrears || corporatePaid < corporate || energyPaid < energyOverhead) notice(s, c, 'Daily overhead could not be fully paid. Arrears remain in liabilities and will be retried at daily close.', 'warning');
    const fixedAssets = balance(c, 'fixedAssets');
    const fixedDailyDepreciation = s.accounting?.dailyDepreciation;
    const depreciation = Math.min(fixedAssets, fixedDailyDepreciation ?? Math.round(fixedAssets * 0.2 / 365));
    const depreciationDescription = fixedDailyDepreciation == null ? 'Daily depreciation (20% annual declining balance)' : 'Daily depreciation (fixed amount)';
    post(s, c, depreciationDescription, { expense: depreciation, fixedAssets: -depreciation });
    c.quality = Math.min(1.5, c.quality + Math.sqrt(c.research / 10000) * 0.004);
    c.satisfaction = Math.min(1.3, c.satisfaction + 0.005);
  }
  const totalReceived = sum(s.companies.map(c => c.received));
  s.snapshots.push({ hour: s.hour, companies: s.companies.map(c => ({ id: c.id, name: c.name, cash: balance(c, 'cash'), profit: profit(c), revenue: -balance(c, 'revenue'), production: c.production, inventory: c.inventory.panel.qty, energyKwh: c.energyKwh, energyCost: c.energyCost, emissions: c.emissions, dispatched: c.dispatched, received: c.received, demandUnits: c.demandUnits, marketShare: totalReceived ? c.received / totalReceived * 100 : 0 })) });
}
export function advance(s, hours) {
  integer(hours, 'Hours', 1, 168);
  if (s.status === 'completed') fail('Session completed. Extend its duration to continue.');
  for (let i = 0; i < hours && s.hour < s.endHour; i++) {
    s.hour++;
    // Production closes (hour - 1, hour]; boundary changes govern the next interval.
    const closingShifts = new Map(s.companies.map(c => [c.id, [...c.shifts]]));
    // All due events, including same-hour consequences, run in creation order.
    let due;
    while ((due = s.events.filter(e => e.status === 'pending' && e.at <= s.hour).sort((a, b) => a.at - b.at || Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]))[0])) executeEvent(s, due);
    for (const c of s.companies) production(s, c, closingShifts.get(c.id));
    if (s.hour % 6 === 0) demand(s);
    for (const c of s.companies) automated(s, c);
    if (s.hour % 24 === 0) dailyClose(s);
  }
  if (s.hour >= s.endHour) s.status = 'completed';
}
export function tick(s) { if (s.status === 'running') { advance(s, 1); s.revision++; } }
export function forecast(s, c) {
  return s.events.filter(e => e.companyId === c.id && e.status === 'pending').map(e => {
    let amount = 0;
    if (e.type === 'purchasePayment') amount = -c.purchases.find(x => x.id === e.data.purchaseId).cost;
    if (e.type === 'freightPayment') amount = -c.shipments.find(x => x.id === e.data.shipmentId).cost;
    if (e.type === 'customerPayment') amount = c.shipments.find(x => x.id === e.data.shipmentId).revenue;
    if (e.type === 'loanFunding') amount = c.loans.find(x => x.id === e.data.loanId).amount;
    if (e.type === 'loanRepayment') { const l = c.loans.find(x => x.id === e.data.loanId); const part = l.installments?.[e.data.installment]; amount = part ? -part.principal - part.interest : -l.amount - l.interest; }
    if (e.type === 'depositMaturity') { const d = c.deposits.find(x => x.id === e.data.depositId); amount = d.amount + d.interest; }
    return { eventId: e.id, hour: e.at, amount, description: e.description, blocked: e.blocked || null };
  }).filter(x => x.amount).sort((a, b) => a.hour - b.hour);
}
export function assertInvariants(s) {
  for (const c of s.companies) {
    if (sum(Object.values(c.accounts)) !== 0) fail(`Ledger imbalance for ${c.id}.`, 500);
    if (balance(c, 'cash') < 0) fail('Cash cannot be negative.', 500);
    if (sum(Object.values(c.inventory).map(i => i.value)) !== balance(c, 'inventory')) fail('Inventory valuation does not reconcile.', 500);
    for (const stock of Object.values(c.inventory)) if (!Number.isSafeInteger(stock.qty) || stock.qty < 0 || stock.value < 0) fail('Invalid stock.', 500);
    for (const o of c.orders) {
      const shipped = sum(c.shipments.filter(sh => sh.orderId === o.id).map(sh => sh.qty));
      if (o.originalQty !== o.remaining + shipped || o.received > shipped) fail('Order conservation failed.', 500);
    }
  }
  return true;
}
export function publicView(s, actor, previewId) {
  const view = structuredClone(s), isTeacher = actor.role === 'instructor';
  const companyId = isTeacher ? previewId : actor.companyId;
  view.company = view.companies.find(c => c.id === companyId) || null;
  if (view.company) { view.company.profit = profit(view.company); view.company.forecast = forecast(s, view.company); }
  view.companies = view.companies.map(c => ({ id: c.id, name: c.name, ...(isTeacher ? { cash: balance(c, 'cash'), profit: profit(c), inventory: c.inventory.panel.qty, openUnits: sum(c.orders.map(o => o.remaining)), emissions: c.emissions } : {}) }));
  view.events = view.events.filter(e => isTeacher || e.companyId === companyId);
  view.messages = view.messages.filter(m => canMessage(s, actor, m.channel));
  view.audit = view.audit.filter(a => isTeacher || a.companyId === companyId).map(a => ({ ...a, command: a.command.type === 'message' ? { type: 'message' } : a.command }));
  delete view.rng; delete view.sequence;
  return view;
}
