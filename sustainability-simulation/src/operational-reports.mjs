import { itemName } from './engine.mjs?v=b6c679bc9e11';
import { supplyChainRows, supplierEvidence } from './supply-performance.mjs?v=b6c679bc9e11';
// Original reports derived from the authorized company view. Never infer or
// expose competitors' private orders, customers, contracts or purchase records.
export const operationalReports = {
  servicePerformance: ['Sales', 'Supply chain performance'],
  esgEvidence: ['Purchases', 'Supplier ESG evidence and exposure'],
  profitability: ['Finances', 'Profitability metrics'],
  procurementCosts: ['Purchases', 'Average purchase price and ordering costs'],
  warehouseCosts: ['Inventory', 'Warehousing costs'],
  waste: ['Inventory', 'Waste from inventories'],
  utilization: ['Production', 'Shift salaries and capacity utilization'],
  income: ['Finances', 'Income statement'],
  companyIncome: ['Finances', 'Income statements, all companies'],
  balance: ['Finances', 'Balance sheet'],
  cashflow: ['Finances', 'Future cash flow'],
  cashEvents: ['Finances', 'Cash flow events'],
  payables: ['Finances', 'Accounts payable and other debts'],
  receivables: ['Finances', 'Accounts receivable'],
  costs: ['Finances', 'Costs by type'],
  keyFigures: ['Finances', 'Key figure development'],
  purchases: ['Purchases', 'All purchases'],
  purchases14: ['Purchases', 'Last 14 days'],
  purchasesDaily: ['Purchases', 'Daily by product'],
  purchasesWeekly: ['Purchases', 'Weekly by product'],
  purchasesSupplierProduct: ['Purchases', 'Weekly by supplier and product'],
  purchasesSupplierAverage: ['Purchases', 'Weekly by supplier with averages'],
  purchasesMonthly: ['Purchases', 'Monthly by product'],
  supplierInfo: ['Purchases', 'Supplier information'],
  stock: ['Inventory', 'Inventory item values'],
  stockHistory: ['Inventory', 'Inventory development by item'],
  production: ['Production', 'Produced units and average costs'],
  capacity: ['Production', 'Production capacity'],
  componentUsage: ['Production', 'Production component usage'],
  cumulativeOutput: ['Production', 'Production cumulative output'],
  productionCost: ['Production', 'Production average cost'],
  carbonDemand: ['Carbon/Energy efficiency', 'How CO₂ changes affect customer demand'],
  energy: ['Carbon/Energy efficiency', 'Electricity and carbon efficiency'],
  deliveryCarbon: ['Carbon/Energy efficiency', 'Delivery carbon by route'],
  history: ['Sales', 'Order/delivery history'],
  orders: ['Sales', 'All received orders'],
  ordersByMarket: ['Sales', 'All received orders by products and markets'],
  ordersByCustomer: ['Sales', 'All received orders by customers'],
  openOrders: ['Sales', 'Open orders by products and markets'],
  deliveries: ['Sales', 'All deliveries'],
  deliveriesByMarket: ['Sales', 'Deliveries by products and markets'],
  transportCosts: ['Sales', 'Transportation costs by product'],
  orders14: ['Sales', '14 day received orders by products'],
  deliveries14: ['Sales', '14 day deliveries by products'],
  marketVolumes: ['Markets/Competitors', 'Market volumes (monthly)'],
  componentPurchases: ['Markets/Competitors', 'All component purchases'],
  customers: ['Markets/Competitors', 'Customer information'],
  quality: ['Markets/Competitors', 'Quality report'],
  reliability: ['Markets/Competitors', 'Delivery reliability'],
  arrivals: ['Markets/Competitors', "Deliveries (at customer's), from beginning"],
  arrivals7: ['Markets/Competitors', "Deliveries (at customer's), last 7 days"],
  arrivals14: ['Markets/Competitors', "Deliveries (at customer's), last 14 days"],
  arrivalsByProduct: ['Markets/Competitors', 'Deliveries by product'],
  arrivalsByMarket: ['Markets/Competitors', 'Deliveries by market'],
  arrivalsByMarketProduct: ['Markets/Competitors', 'Deliveries by market and product'],
  averageDeliveries: ['Markets/Competitors', 'Average delivery sizes'],
  relativeSales: ['Markets/Competitors', 'Relative sales by products'],
  marketShares: ['Markets/Competitors', 'Market shares by market and product']
};

const sum = (rows, value) => rows.reduce((n, row) => n + (value(row) || 0), 0);
const ratio = (n, d) => d ? n / d : null;
const group = (rows, key) => {
  const groups = new Map();
  for (const row of rows) { const k = key(row); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(row); }
  return [...groups];
};
const col = (label, type = 'text') => ({ label, type });
const eur = label => col(label, 'money');
const num = label => col(label, 'number');
const date = label => col(label, 'time');

export function businessUpdates(state, deliveryOnly = false) {
  const c = state.company;
  if (!c) return [];
  const orders = new Map(c.orders.map(o => [o.id, o]));
  const updates = c.shipments.flatMap(s => {
    const o = orders.get(s.orderId); if (!o) return [];
    const timing = at => at > o.dueAt ? ['Late delivery', 'warning', `${at - o.dueAt} h after the promised time`] : at < o.dueAt - 24 ? ['Early delivery', 'warning', `${o.dueAt - at} h before the promised time`] : ['Delivery within window', 'success', 'within the promised delivery window'];
    const describe = (at, actual) => {
      const [title, severity, timingText] = timing(at);
      return { id: s.id + (actual ? ':arrival' : ':dispatch'), hour: actual ? s.receivedAt : s.dispatchedAt, title: (actual ? '' : 'Expected: ') + title.toLowerCase(), severity,
        text: `${s.qty} units for ${o.customer} via ${s.route}. ${actual ? 'Arrived' : 'Expected to arrive'} ${timingText}. ${actual ? 'This is the actual customer receipt.' : 'Transit delays may change the outcome.'}${severity === 'warning' ? ' Early or late receipts reduce customer satisfaction in this simulation.' : ''}`, shipmentId: s.id, orderId: o.id, expectedAt: s.expectedAt, receivedAt: s.receivedAt, dueAt: o.dueAt };
    };
    return [describe(s.expectedAt, false), ...(s.receivedAt == null ? [] : [describe(s.receivedAt, true)])];
  });
  if (!deliveryOnly) updates.push(...(c.notices || []).filter(n => !/modules reach customer|Dispatched \d+/.test(n.text)).map(n => ({ id: n.id, hour: n.hour, title: n.kind === 'outcome' ? 'Business event completed' : n.kind === 'automation' ? 'Automation update' : n.kind === 'error' ? 'Action needed' : 'Business update', severity: n.kind === 'error' ? 'warning' : 'info', text: n.text })));
  return updates.sort((a, b) => b.hour - a.hour || b.id.localeCompare(a.id, 'en', { numeric: true }));
}

export function buildOperationalReport(state, id, filters = {}) {
  if (!Object.hasOwn(operationalReports, id)) throw new Error('Unknown report.');
  const c = state.company;
  const result = { title: operationalReports[id][1], columns: [], rows: [], note: '', chart: null };
  if (!c) return { ...result, note: 'Select a company preview to inspect its records.' };
  const product = itemName(state, 'panel');
  const item = key => itemName(state, key) || key;
  const market = key => state.catalog.markets.find(m => m.id === key)?.name || key;
  const range = /7$/.test(id) ? 7 : /14$/.test(id) ? 14 : Number(filters.days) || 0;
  const since = range ? state.hour - range * 24 : -Infinity;
  const during = hour => hour != null && hour > since && hour <= state.hour;
  const matchesMarket = order => !filters.market || order.marketId === filters.market;
  const orderMap = new Map(c.orders.map(o => [o.id, o]));
  const orders = c.orders.filter(o => matchesMarket(o) && during(o.createdAt));
  const shipments = c.shipments.filter(s => matchesMarket(orderMap.get(s.orderId) || {}));
  const sent = shipments.filter(s => during(s.dispatchedAt));
  const arrived = shipments.filter(s => during(s.receivedAt));
  const purchases = c.purchases.filter(p => during(p.orderedAt));
  const a = c.accounts;
  const make = (columns, rows, note = '', chart = null) => ({ ...result, columns, rows, note, chart });
  if (id === 'servicePerformance') return make([col('KPI'), num('Value'), col('Basis')], supplyChainRows(c, c.orders.filter(matchesMarket), shipments, state.hour, since), 'Market filter applies to customer service. Financial measures cover the whole company. A dash means unavailable or undefined.');
  if (id === 'esgEvidence') {
    const rows = state.catalog.suppliers.map(supplier => {
      const history = purchases.filter(p => p.supplier === supplier.name && p.item === supplier.item);
      const [environment, social, governance, action, reviewed] = supplierEvidence(supplier);
      return [supplier.name, environment, social, governance, action, sum(history, p => p.cost), sum(history, p => p.carbon), reviewed ? 'Yes' : 'No'];
    });
    const spend = rows.reduce((n, r) => n + r[5], 0);
    const reviewed = rows.reduce((n, r) => n + (r[7] === 'Yes' ? r[5] : 0), 0);
    return make([col('Supplier'), col('Environmental evidence'), col('Social evidence'), col('Governance evidence'), col('Follow-up'), eur('Committed spend'), num('Committed upstream kg CO₂e'), col('All three reviewed')], rows, 'Illustrative, simulated case files. Spend with evidence reviewed in all three areas / total committed spend: ' + (spend ? (100 * reviewed / spend).toFixed(1) + '%' : 'undefined (zero spend)') + '. Evidence coverage is not assurance of compliance.');
  }
  const own = 'Company records only. Competitor transaction details are not shared.';
  const orderColumns = [col('Order'), date('Ordered'), col('Customer'), col('Market'), col('Product'), num('Original quantity'), num('Remaining to dispatch'), num('Arrived quantity'), eur('Unit price'), eur('Order value'), date('Promised arrival'), num('Payment term (hours)'), col('Status')];
  const orderRows = rows => rows.map(o => [o.id, o.createdAt, o.customer, market(o.marketId), product, o.originalQty, o.remaining, o.received, o.price, o.originalQty * o.price, o.dueAt, o.payment, o.received === o.originalQty ? 'Delivered' : o.remaining === 0 ? 'In transit' : o.remaining < o.originalQty ? 'Partly dispatched' : 'Open']);
  const deliveryColumns = [col('Shipment'), col('Order'), date('Ordered'), col('Market'), col('Customer'), col('Product'), num('Quantity'), eur('Unit price'), eur('Value'), date('Dispatched'), date('Promised arrival'), date('Expected arrival'), date('Actual arrival'), col('Route'), eur('Freight cost'), num('Transport kg CO₂e'), num('Transport kg CO₂e/unit'), col('Arrival status')];
  const deliveryRows = rows => rows.map(s => { const o = orderMap.get(s.orderId) || {}; return [s.id, s.orderId, o.createdAt, market(o.marketId), o.customer, product, s.qty, o.price, s.revenue, s.dispatchedAt, o.dueAt, s.expectedAt, s.receivedAt, s.route, s.cost, s.carbon, ratio(s.carbon, s.qty), s.receivedAt == null ? 'In transit' : s.receivedAt > o.dueAt ? 'Late' : s.receivedAt < o.dueAt - 24 ? 'Early' : 'Within delivery window']; });

  if (id === 'profitability') {
    const revenue = -(a.revenue || 0), gross = revenue - (a.cogs || 0);
    return make([eur('Revenue'), eur('Gross profit'), num('Gross margin (%)'), eur('Net profit'), num('Net margin (%)')],
      [[revenue, gross, ratio(100 * gross, revenue), c.profit, ratio(100 * c.profit, revenue)]],
      'Cumulative recognised amounts. Margins divide profit by revenue. A dash means no recognised revenue.');
  }
  if (id === 'procurementCosts') {
    const automated = new Set(c.notices.filter(n => n.kind === 'automation').map(n => /^Purchase (purchase-\\d+) accepted/.exec(n.text)?.[1]));
    const rows = group(purchases, p => p.item).map(([key, orders]) => {
      // Legacy contracts stored the landed amount. Supplier fees are fixed for
      // the session and successful automated orders have a corresponding notice.
      let fees = 0;
      for (const order of orders) {
        const supplier = state.catalog.suppliers.find(s => s.name === order.supplier && s.item === key);
        const fee = order.orderFee ?? (supplier && (automated.has(order.id) ? Math.round(supplier.fee / 2) : supplier.fee));
        if (fee == null) { fees = null; break; }
        fees += fee;
      }
      const units = sum(orders, o => o.qty), cost = sum(orders, o => o.cost);
      return [item(key), orders.length, units, fees == null ? null : ratio(cost - fees, units), fees, cost];
    });
    return make([col('Component'), num('Orders'), num('Units ordered'), eur('Average purchase price / unit'), eur('Ordering costs'), eur('Total committed cost')], rows,
      'Grouped by placement time. The quantity-weighted purchase price excludes ordering fees. Automatic replenishment receives a discounted fee.');
  }
  if (id === 'waste') {
    const losses = (c.writeOffs || []).filter(row => during(row.hour));
    return make([col('Item'), num('Units written off'), eur('Inventory value lost'), num('Embodied kg CO₂e discarded')],
      Object.keys(c.inventory).map(key => {
        const rows = losses.filter(row => row.item === key);
        return [item(key), sum(rows, row => row.qty), sum(rows, row => row.value), sum(rows, row => row.carbon)];
      }), 'Actual write-offs during the period. Record damaged or obsolete units under Ops → Inventory → Write off stock. Excess stock incurs storage charges but does not automatically expire.');
  }
  if (id === 'warehouseCosts') {
    const history = buildOperationalReport(state, 'stockHistory', filters).rows;
    const expansions = c.investments.filter(x => x.kind === 'warehouse' && x.activeAt != null);
    const byName = new Map(Object.keys(c.inventory).map(key => [item(key), c.inventory[key].capacity]));
    const rows = group(history, row => row[0]).map(([hour, stocks]) => {
      const later = expansions.filter(x => x.activeAt > hour).length;
      const excess = sum(stocks, ([, name, qty]) => {
        let capacity = byName.get(name);
        for (let i = 0; i < later; i++) capacity = Math.ceil(capacity / 1.5);
        return Math.max(0, qty - capacity);
      });
      return [hour, excess, excess * 5];
    });
    return make([date('Daily close'), num('Units above storage capacity'), eur('Overflow storage charge')], rows,
      'Each daily close charges €0.05 per unit above its own item capacity. General premises rent and capital investment in warehouse expansion are separate.');
  }
  if (id === 'utilization') {
    const staffEvents = state.events.filter(e => e.companyId === c.id && e.type === 'staff' && e.status === 'completed');
    const machines = c.investments.filter(x => x.kind === 'machine' && x.activeAt != null);
    const schedules = state.events.filter(e => e.companyId === c.id && e.type === 'shifts' && e.status === 'completed');
    let workers = c.workers - sum(staffEvents, e => e.data.delta), lines = c.machines - machines.length;
    let shifts = schedules.length ? [true, false, false] : c.shifts;
    const staffByHour = new Map(group(staffEvents, e => e.completedAt).map(([hour, events]) => [hour, sum(events, e => e.data.delta)]));
    const linesByHour = new Map(group(machines, x => x.activeAt).map(([hour, events]) => [hour, events.length]));
    const shiftsByHour = new Map(schedules.map(e => [e.completedAt, e.data.shifts]));
    const wages = new Map(group(c.ledger.filter(l => l.description === 'Active shift wages'), l => Math.ceil(l.hour / 24) * 24)
      .map(([hour, entries]) => [hour, sum(entries, l => l.lines.expense)]));
    const output = new Map(state.snapshots.map(s => [s.hour, s.companies.find(x => x.id === c.id)?.production]));
    const rows = [];
    let scheduled = 0;
    for (let hour = 1; hour <= state.hour; hour++) {
      workers += staffByHour.get(hour) || 0;
      lines += linesByHour.get(hour) || 0;
      if (shifts[Math.floor(((hour - 1) % 24) / 8)]) scheduled += Math.min(workers * 2, lines * 6);
      shifts = shiftsByHour.get(hour) || shifts;
      if (hour % 24 === 0) {
        const produced = output.get(hour) - (output.get(hour - 24) ?? 0);
        if (during(hour) && Number.isFinite(produced)) rows.push([hour, wages.get(hour) || 0, produced, scheduled, ratio(100 * produced, scheduled)]);
        scheduled = 0;
      }
    }
    return make([date('Daily close'), eur('Production shift work salaries'), num('Units produced'), num('Scheduled capacity (units)'), num('Capacity utilization (%)')], rows,
      'Actual output divided by scheduled staffed assembly capacity. Active hours use the lower of worker and machine capacity. A dash means no shift capacity was scheduled. Salaries are actual posted shift wages.');
  }
  if (id === 'companyIncome') { const snapshot = state.snapshots.at(-1); return make([date('Daily close'), col('Company'), eur('Cumulative revenue'), eur('Cumulative net profit'), eur('Cumulative net costs')], snapshot ? snapshot.companies.map(x => [snapshot.hour, x.name, x.revenue, x.profit, x.revenue - x.profit]) : [], 'Shared financial summaries at the latest completed daily close. Individual competitor expense accounts are not shared. Net costs include interest income offsets.'); }
  if (id === 'keyFigures') return make([date('Daily close'), eur('Cash'), eur('Net profit'), eur('Revenue'), num('Production'), num('Inventory'), num('Electricity kWh'), num('Emissions kg CO₂e')], state.snapshots.filter(s => during(s.hour)).flatMap(s => { const x = s.companies.find(x => x.id === c.id); return x ? [[s.hour, x.cash, x.profit, x.revenue, x.production, x.inventory, x.energyKwh, x.emissions]] : []; }), 'Cumulative company metrics at each completed daily close.');
  if (id === 'supplierInfo') return make([col('Supplier'), col('Component'), eur('Unit price'), eur('Order fee'), num('Available stock'), num('Minimum order'), num('Lot size'), num('Lead time (h)'), num('Payment after receipt (h)'), num('Reliability (%)'), num('Component kg CO₂e/unit'), num('Freight kg CO₂e/unit')], state.catalog.suppliers.map(s => [s.name, item(s.item), s.price, s.fee, s.stock, s.min, s.lot, s.lead, s.term, s.reliability, s.carbon, s.freight]), 'Current catalogue, not historical contract terms.');
  if (['purchasesDaily', 'purchasesWeekly', 'purchasesSupplierProduct', 'purchasesSupplierAverage', 'purchasesMonthly'].includes(id)) {
    const monthly = id === 'purchasesMonthly', daily = id === 'purchasesDaily', withSupplier = id.startsWith('purchasesSupplier');
    const bucket = p => monthly ? new Date(Date.parse(state.startDate) + p.orderedAt * 3600000).toISOString().slice(0, 7) : Math.floor(p.orderedAt / (daily ? 24 : 168));
    return make([col(monthly ? 'Month (UTC)' : daily ? 'Day (1-based)' : 'Week (1-based)'), col('Supplier'), col('Component'), num('Purchase orders'), num('Units'), eur('Committed cost'), eur('Average acquisition cost/unit'), num('Average promised lead (h)'), num('Average actual lead (h)'), num('Average payment term (h)')], group(purchases, p => JSON.stringify([bucket(p), withSupplier ? p.supplier : 'All suppliers', p.item])).map(([key, ps]) => { const [period, supplier, component] = JSON.parse(key); return [monthly ? period : period + 1, supplier, item(component), ps.length, sum(ps, p => p.qty), sum(ps, p => p.cost), ratio(sum(ps, p => p.cost), sum(ps, p => p.qty)), ratio(sum(ps, p => p.expectedAt - p.orderedAt), ps.length), ratio(sum(ps.filter(p => p.receivedAt != null), p => p.receivedAt - p.orderedAt), ps.filter(p => p.receivedAt != null).length), ratio(sum(ps, p => p.term), ps.length)]; }), 'Grouped by placement time. Acquisition costs include ordering fees. Components stay separate so averages never mix incompatible units. Weeks begin at session start.');
  }
  const recipe = state.recipe || { cell: 24, frame: 1, controller: 1 };
  if (id === 'capacity') return make([col('Constraint'), num('Modules/hour')], [['Installed machine capacity', c.machines * 6], ['Current worker capacity', c.workers * 2], ['Combined nominal capacity', Math.min(c.machines * 6, c.workers * 2)]], 'Live nominal capacity during enabled shifts. Materials, storage and available cash may further limit actual output.');
  if (id === 'componentUsage') return make([col('Component'), num('Units per finished product'), num('Cumulative units consumed')], Object.entries(recipe).map(([key, qty]) => [item(key), qty, qty * c.production]), 'Derived from the session recipe and actual cumulative production. The model has no production waste or random yield loss.');
  if (id === 'cumulativeOutput') return make([date('Daily close'), col('Product'), num('Cumulative output')], state.snapshots.filter(s => during(s.hour)).flatMap(s => { const x = s.companies.find(x => x.id === c.id); return x ? [[s.hour, product, x.production]] : []; }), 'Completed daily snapshots.');
  if (id === 'productionCost') {
    const wages = sum(c.ledger.filter(l => l.description === 'Active shift wages'), l => l.lines.expense);
    return make([col('Product'), num('Cumulative output'), eur('Production wages'), eur('Production electricity'), eur('Wages + electricity / produced unit')], [[product, c.production, wages, c.energyCost, ratio(wages + c.energyCost, c.production)]], 'Live period conversion costs, not a full absorption cost: excludes materials, depreciation and other overhead. Wages accrue during active shifts even if materials block output.');
  }
  if (id === 'stockHistory') {
    const waste = c.writeOffs || [];
    const opening = Object.fromEntries(Object.entries(c.inventory).map(([key, value]) => [key, value.qty + sum(waste.filter(w => w.item === key), w => w.qty) + (recipe[key] || 0) * c.production - (key === 'panel' ? c.production - sum(c.shipments, s => s.qty) : sum(c.purchases.filter(p => p.item === key && p.receivedAt != null), p => p.qty))]));
    return make([date('Daily close'), col('Item'), num('Stock units')], state.snapshots.filter(s => during(s.hour)).flatMap(s => { const x = s.companies.find(x => x.id === c.id); if (!x) return []; return Object.keys(c.inventory).map(key => [s.hour, item(key), key === 'panel' ? x.inventory : opening[key] - sum(waste.filter(w => w.item === key && w.hour < s.hour), w => w.qty) + sum(c.purchases.filter(p => p.item === key && p.receivedAt != null && p.receivedAt <= s.hour), p => p.qty) - (recipe[key] || 0) * x.production]); }), 'Finished stock from daily snapshots; component balances reconstructed from opening stock, actual purchase receipts and the fixed session recipe.');
  }
  if (id === 'carbonDemand') {
    const intensity = c.inventory.panel.qty ? c.inventory.panel.carbon / c.inventory.panel.qty : 75;
    return make([col('Market'), num('Carbon preference weight'), num('Current product kg CO₂e/unit'), num('Carbon factor in demand score'), col('Effect')], state.catalog.markets.map(m => [m.name, m.greenWeight, intensity, state.effects.carbonDemand ? Math.exp(-m.greenWeight / 100 * intensity / 100) : 1, state.effects.carbonDemand ? 'Enabled' : 'Disabled']), 'The carbon factor multiplies the demand score alongside price, quality, reputation and offer terms. It is not a forecast of sales. Empty finished stock uses the model fallback of 75 kg CO₂e/unit.');
  }

  if (id === 'orders') return make(orderColumns, orderRows(orders), own + ' Date filter uses the time the customer placed the order.');
  if (id === 'deliveries' || id.startsWith('arrivals') && !id.includes('By')) return make(deliveryColumns, deliveryRows(id === 'deliveries' ? sent : arrived), own + (id === 'deliveries' ? ' Includes goods still in transit; date filter uses dispatch time.' : ' Completed customer arrivals only; date filter uses actual arrival time.'));
  if (['ordersByMarket', 'ordersByCustomer', 'openOrders', 'orders14'].includes(id)) {
    const rows = id === 'openOrders' ? c.orders.filter(o => matchesMarket(o) && o.remaining > 0) : orders;
    const customer = id === 'ordersByCustomer';
    return make([col(customer ? 'Customer' : 'Market'), col('Product'), num('Orders'), num('Original quantity'), num('Remaining to dispatch'), num('Arrived'), eur('Order value')], group(rows, o => customer ? o.customer : market(o.marketId)).map(([key, os]) => [key, product, os.length, sum(os, o => o.originalQty), sum(os, o => o.remaining), sum(os, o => o.received), sum(os, o => o.originalQty * o.price)]), own + (id === 'openOrders' ? ' All currently open commitments, regardless of order date.' : ' Grouped by order placement time.'));
  }
  if (['deliveriesByMarket', 'deliveries14', 'arrivalsByProduct', 'arrivalsByMarket', 'arrivalsByMarketProduct', 'averageDeliveries', 'relativeSales'].includes(id)) {
    const rows = id.startsWith('deliveries') ? sent : arrived;
    const byProduct = ['arrivalsByProduct', 'relativeSales', 'deliveries14'].includes(id);
    const quantity = sum(rows, s => s.qty);
    return make([col(byProduct ? 'Product' : 'Market'), col('Product'), num('Consignments'), num('Units'), num('Average consignment size'), eur('Sales value'), num('Share of selected units (%)')], group(rows, s => byProduct ? product : market(orderMap.get(s.orderId)?.marketId)).map(([key, ss]) => [key, product, ss.length, sum(ss, s => s.qty), ratio(sum(ss, s => s.qty), ss.length), sum(ss, s => s.revenue), ratio(sum(ss, s => s.qty) * 100, quantity)]), own + (id.startsWith('deliveries') ? ' Based on dispatch time.' : ' Based on actual customer arrival. The model currently manufactures one finished product.'));
  }
  if (id === 'history') {
    const type = ['orders', 'dispatches', 'arrivals'].includes(filters.type) ? filters.type : 'orders';
    const records = type === 'orders' ? orders.map(o => [o.createdAt, o.originalQty]) : (type === 'arrivals' ? arrived : sent).map(s => [type === 'arrivals' ? s.receivedAt : s.dispatchedAt, s.qty]);
    const rows = group(records, r => Math.floor(r[0] / 24)).sort((a, b) => a[0] - b[0]).map(([day, rs]) => [day * 24, sum(rs, r => r[1])]);
    return make([date('Simulation day'), num(type === 'orders' ? 'Ordered units' : type === 'arrivals' ? 'Arrived units' : 'Dispatched units')], rows, 'Daily buckets from timestamped company records, including the current partial day. Zero-activity days are omitted.', { type: 'bars' });
  }
  if (id === 'transportCosts' || id === 'deliveryCarbon') return make([col(id === 'transportCosts' ? 'Product' : 'Route'), num('Consignments'), num('Units dispatched'), eur('Freight cost'), eur('Freight cost/unit'), num('Transport kg CO₂e'), num('Transport kg CO₂e/unit')], group(sent, s => id === 'transportCosts' ? product : s.route).map(([key, ss]) => [key, ss.length, sum(ss, s => s.qty), sum(ss, s => s.cost), ratio(sum(ss, s => s.cost), sum(ss, s => s.qty)), sum(ss, s => s.carbon), ratio(sum(ss, s => s.carbon), sum(ss, s => s.qty))]), 'Freight and transport emissions are recorded at dispatch. Includes fixed and per-unit charges.');
  if (id === 'reliability') return make([col('Market'), num('Arrived consignments'), num('Within window'), num('Early (>24 h)'), num('Late'), num('Within window (%)')], group(arrived, s => market(orderMap.get(s.orderId)?.marketId)).map(([key, ss]) => { const late = ss.filter(s => s.receivedAt > orderMap.get(s.orderId)?.dueAt).length, early = ss.filter(s => s.receivedAt < orderMap.get(s.orderId)?.dueAt - 24).length, onTime = ss.length - late - early; return [key, ss.length, onTime, early, late, ratio(onTime * 100, ss.length)]; }), 'Actual arrivals only. The delivery window is the promised time minus 24 hours through the promised time, inclusive. Each partial consignment counts separately.');
  if (id === 'customers') return make([col('Customer'), col('Market'), num('Orders'), num('Ordered units'), num('Units to dispatch'), eur('Accepted order value')], group(orders, o => o.customer).map(([key, os]) => [key, market(os[0].marketId), os.length, sum(os, o => o.originalQty), sum(os, o => o.remaining), sum(os, o => o.originalQty * o.price)]), 'Synthetic customer labels generated by this teaching model, not real customer identities.');
  if (id === 'quality') return make([col('Company'), num('Quality multiplier'), num('Customer satisfaction'), eur('Daily research'), eur('Daily marketing')], [[c.name, c.quality, c.satisfaction, c.research, c.marketing]], 'Live company indicators. Competitor quality and research budgets are private.');
  if (id === 'marketVolumes') return make([col('Market'), col('Demand model'), num('Configured mean units / h'), num('Expected units / 30 days'), eur('Reference unit price'), num('Carbon preference weight'), col('Status')], state.catalog.markets.map(m => { const rate = m.lambda ?? m.volume / 6; return [m.name, m.lambda === undefined ? 'Legacy six-hour uniform' : 'Hourly Poisson (λ)', rate, m.enabled ? rate * 24 * 30 : 0, m.referencePrice, m.greenWeight, m.enabled ? 'Enabled' : 'Disabled']; }), 'Expected shared market demand if current rates and enabled states stay unchanged for 30 days, not observed sales or guaranteed arrivals. Poisson λ is modules per simulation hour across all teams. Actual demand varies and some demand may be unallocated.');
  if (id === 'marketShares') {
    const snap = state.snapshots.at(-1);
    return make([date('Daily close'), col('Company'), num('Cumulative customer receipts'), num('Delivered market share (%)')], snap ? snap.companies.map(x => [snap.hour, x.name, x.received, x.marketShare]) : [], 'All markets combined, at the latest completed daily close. Per-market competitor shares are not recorded in the shared snapshots; this report does not invent that breakdown.');
  }
  if (['componentPurchases', 'purchases', 'purchases14'].includes(id)) return make([col('Purchase'), date('Ordered'), col('Supplier'), col('Component'), num('Quantity'), eur('Committed cost'), date('Expected arrival'), date('Actual arrival'), date('Paid'), num('Embodied + inbound kg CO₂e')], purchases.map(p => [p.id, p.orderedAt, p.supplier, item(p.item), p.qty, p.cost, p.expectedAt, p.receivedAt, p.paidAt, p.carbon]), own + ' Costs include ordering fees; carbon includes materials and inbound freight.');
  if (id === 'purchasesByProduct') return make([col('Component'), num('Purchase orders'), num('Quantity ordered'), eur('Committed cost'), num('Quantity received')], group(purchases, p => p.item).map(([key, ps]) => [item(key), ps.length, sum(ps, p => p.qty), sum(ps, p => p.cost), sum(ps.filter(p => p.receivedAt != null), p => p.qty)]), 'Grouped by purchase placement time.');
  if (id === 'stock') return make([col('Item'), num('Quantity'), num('Capacity'), eur('Inventory value'), eur('Average material cost/unit'), num('Embodied kg CO₂e'), num('Embodied kg CO₂e/unit')], Object.entries(c.inventory).map(([key, s]) => [item(key), s.qty, s.capacity, s.value, ratio(s.value, s.qty), s.carbon, ratio(s.carbon, s.qty)]), 'Live stock at material acquisition cost. Labour and electricity are period expenses.');
  if (id === 'production' || id === 'energy') {
    const snapshots = state.snapshots.filter(s => during(s.hour));
    const wagesByDay = new Map();
    for (const entry of c.ledger) if (entry.description === 'Active shift wages') { const close = Math.ceil(entry.hour / 24) * 24; wagesByDay.set(close, (wagesByDay.get(close) || 0) + entry.lines.expense); }
    const daily = snapshots.flatMap(s => { const x = s.companies.find(x => x.id === c.id), prev = state.snapshots.find(p => p.hour === s.hour - 24)?.companies.find(x => x.id === c.id); if (!x) return []; const output = x.production - (prev?.production || 0), power = x.energyKwh - (prev?.energyKwh || 0); return [[s.hour, output, power, x.energyCost - (prev?.energyCost || 0), ratio(power, output), x.emissions - (prev?.emissions || 0), ratio((wagesByDay.get(s.hour) || 0) + x.energyCost - (prev?.energyCost || 0), output)]]; });
    return make([date('Daily close'), num('Units produced'), num('Electricity kWh'), eur('Electricity cost'), num('kWh/unit produced'), num('Company emissions kg CO₂e'), eur('Wages + electricity / unit')], daily, 'Completed daily intervals only. Average conversion costs exclude materials and overhead. Company emissions include transport; they are not solely production emissions. A dash means no production denominator.');
  }
  if (id === 'income') return make([col('Account'), eur('Amount')], [['Revenue', -(a.revenue || 0)], ['Cost of goods sold', -(a.cogs || 0)], ['Operating expenses', -(a.expense || 0)], ['Interest income', -(a.interestIncome || 0)], ['Net profit', c.profit]], 'Cumulative live income statement. Expense rows are negative; recognised revenue follows the session accounting policy.');
  if (id === 'balance') {
    const assets = ['cash', 'inventory', 'inbound', 'transit', 'receivable', 'deposits', 'fixedAssets', 'construction'];
    const liabilities = ['payable', 'debt', 'interestPayable', 'overheadPayable'];
    const assetTotal = sum(assets, key => a[key]), liabilityTotal = -sum(liabilities, key => a[key]);
    return make([col('Section'), col('Account'), eur('Amount')], [...assets.map(key => ['Assets', key, a[key] || 0]), ['Assets', 'Total assets', assetTotal], ...liabilities.map(key => ['Liabilities', key, -(a[key] || 0)]), ['Liabilities', 'Total liabilities', liabilityTotal], ['Equity', 'Contributed capital', -(a.equity || 0)], ['Equity', 'Retained profit / loss', c.profit], ['Total', 'Liabilities and equity', liabilityTotal - (a.equity || 0) + c.profit]], 'Live balance sheet. Net fixed assets include posted depreciation. Retained profit is included in equity.');
  }
  if (id === 'cashflow') { let projected = a.cash || 0; return make([date('Scheduled time'), col('Event'), eur('Cash movement'), eur('Projected cash'), col('Status')], c.forecast.map(f => { projected += f.amount; return [f.hour, f.description, f.amount, projected, f.blocked || 'Scheduled']; }), 'Starts from current cash. Committed scheduled events only: excludes future trading, recurring costs and payments not yet scheduled by receipt. Negative projected cash indicates a funding gap; it is not a prediction that payment will succeed.'); }
  if (id === 'cashEvents') return make([date('Time'), col('Transaction'), eur('Cash movement')], c.ledger.filter(l => l.lines.cash && during(l.hour)).map(l => [l.hour, l.description, l.lines.cash]), 'Actual posted cash movements, including opening capital when in the selected period.');
  if (id === 'costs') return make([col('Cost type'), eur('Expense')], group(c.ledger.filter(l => l.lines.expense && during(l.hour)), l => l.description.replace(/ [a-z]+-\d+$/, '')).map(([key, ls]) => [key, sum(ls, l => l.lines.expense)]), 'Operating expense postings in the selected period. Cost of goods sold is shown separately in the income statement.');
  if (id === 'payables') return make([col('Obligation'), eur('Outstanding amount')], [['Supplier and freight payables', -(a.payable || 0)], ['Loan principal', -(a.debt || 0)], ['Interest payable', -(a.interestPayable || 0)], ['Operating overhead payable', -(a.overheadPayable || 0)]], 'Live ledger obligations. Future cash flow shows the payments that have a scheduled settlement event.');
  if (id === 'receivables') return make([col('Shipment'), col('Customer'), eur('Recognised amount outstanding'), date('Recognised'), date('Arrived')], c.shipments.filter(s => s.paidAt == null && (s.recognizedAt != null || s.receivedAt != null)).map(s => [s.id, orderMap.get(s.orderId)?.customer, s.revenue, s.recognizedAt ?? s.receivedAt, s.receivedAt]), 'Recognised sales awaiting payment. Goods in transit are included only when revenue was recognised at dispatch.');
  return result;
}
