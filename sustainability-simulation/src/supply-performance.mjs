export const supplierCaseFiles = {
  'cell-circular': ['Reviewed', 'Worker interviews pending', 'Ownership disclosed', 'Obtain worker interviews', false],
  'cell-express': ['Supplier declaration', 'Reviewed', 'Ownership disclosed', 'Verify process emissions', false],
  'frame-circular': ['Reviewed', 'Reviewed', 'Reviewed', 'No open finding', true],
  'frame-express': ['Reviewed', 'Overtime finding open', 'Reviewed', 'Verify working-hour records and remedy', false],
  'controller-circular': ['Reviewed', 'Reviewed', 'Traceability gap', 'Trace upstream origin', false],
  'controller-express': ['Supplier declaration', 'Worker evidence missing', 'Ownership undisclosed', 'Request evidence and worker feedback', false]
};

export function supplierEvidence(supplier) {
  return supplierCaseFiles[supplier.id] ?? ['Unknown', 'Unknown', 'Unknown', 'Request evidence', false];
}

export function supplyChainRows(company, orders, shipments, hour, since) {
  const due = orders.filter(order => order.dueAt > since && order.dueAt <= hour);
  const receipts = new Map();
  for (const shipment of shipments) {
    if (shipment.receivedAt == null || shipment.receivedAt > hour) continue;
    const items = receipts.get(shipment.orderId) ?? [];
    items.push(shipment);
    receipts.set(shipment.orderId, items);
  }
  let otif = 0, complete = 0, cycleHours = 0, unitsDue = 0, unitsFilled = 0;
  for (const order of due) {
    const items = receipts.get(order.id) ?? [];
    const arrived = items.reduce((total, item) => total + item.qty, 0);
    unitsDue += order.originalQty;
    unitsFilled += Math.min(arrived, order.originalQty);
    if (arrived < order.originalQty) continue;
    complete++;
    cycleHours += Math.max(...items.map(item => item.receivedAt)) - order.createdAt;
    if (items.every(item => item.receivedAt >= order.dueAt - 24 && item.receivedAt <= order.dueAt)) otif++;
  }
  const divide = (n, d) => d > 0 ? n / d : null;
  const start = Math.max(0, since), days = (hour - start) / 24;
  const area = { inventory: 0, inbound: 0, transit: 0, receivable: 0, payable: 0 };
  let cogs = 0, sales = 0;
  for (const entry of company.ledger) {
    if (entry.hour > hour) continue;
    const duration = hour - Math.max(start, entry.hour);
    for (const key of Object.keys(area)) area[key] += (entry.lines[key] || 0) * duration / 24;
    if (entry.hour > since) {
      cogs += entry.lines.cogs || 0;
      sales -= entry.lines.revenue || 0;
    }
  }
  const stockDays = area.inventory + area.inbound + area.transit;
  const dio = divide(stockDays, cogs), dso = divide(area.receivable, sales), dpo = divide(-area.payable, cogs);
  return [
    ['On-time, in-full orders (%)', divide(100 * otif, due.length), 'Due orders. Every unit must arrive within the promised window.'],
    ['Demand fulfilled (%)', divide(100 * unitsFilled, unitsDue), 'Received units / original units on orders due by cutoff.'],
    ['Perfect order fulfillment (%)', null, 'Unavailable: damage and documentation accuracy are outside the model.'],
    ['Order fulfillment cycle time (hours)', divide(cycleHours, complete), 'Order placement to final receipt for completed orders in the due cohort.'],
    ['Inventory turnover (turns in period)', divide(cogs * days, stockDays), 'Company COGS / time-weighted average owned inventory including transit.'],
    ['Cash-to-cash cycle (days)', dio == null || dso == null || dpo == null ? null : dio + dso - dpo, 'Inventory days + receivable days − payable days. COGS proxies purchases for payable days.']
  ];
}
