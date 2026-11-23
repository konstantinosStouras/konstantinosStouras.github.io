import { purchase, dispatch } from './engine.mjs?v=bf0482d7502e';

export function appeal(s, market, c, offer) {
  const footprint = c.inventory.panel.qty ? c.inventory.panel.carbon / c.inventory.panel.qty : 75;
  const green = s.effects.carbonDemand ? Math.exp(-market.greenWeight / 100 * footprint / 100) : 1;
  return market.referencePrice ** 2 * c.satisfaction * c.quality * (1 + Math.sqrt(c.marketing / 10000) * 0.1) * green * (1 + offer.payment / 2400) / (1 + offer.delivery / 480);
}

export function quoteScores(s, c) {
  return s.catalog.markets.map(m => {
    const offer = c.offers.filter(o => o.enabled && o.marketId === m.id).sort((a,b) => a.price-b.price)[0];
    return offer ? appeal(s, m, c, offer) / offer.price ** 2 : 0;
  });
}
export function bestPrice(s, market, c, offer) {
  const rivals = s.companies.filter(other => other !== c).reduce((sum, other) => {
    const quote = other.offers.filter(o => o.enabled && o.marketId === market.id).sort((a,b) => a.price-b.price)[0];
    return sum + (quote ? appeal(s, market, other, quote) / quote.price ** 2 : 0);
  }, (s.referenceQuotes || []).reduce((n,row) => n + row.scores[s.catalog.markets.indexOf(market)], 0));
  const stock = c.inventory.panel;
  const unitCost = stock.qty ? stock.value / stock.qty : Object.entries(s.recipe).reduce((sum,[key,qty]) => sum + qty * (s.catalog.suppliers.find(r => r.item === key)?.price ?? 0), 0);
  // Continuous one-period contribution: (p-cost) * A / (A + rivals*p²).
  const best = rivals > 0 ? unitCost + Math.sqrt(unitCost ** 2 + appeal(s, market, c, offer) / rivals) : 1000000;
  return Math.max(5000, Math.min(1000000, Math.round(best)));
}
export function opponentTurn(s, c) {
  const strong = c.bot === 'benchmark', cadence = strong ? 1 : 8 + c.profile;
  if (!strong && s.hour !== 1 && s.hour % cadence !== 0) return;
  if (s.features.offers.allowed) for (const offer of c.offers) {
    const market = s.catalog.markets.find(m => m.id === offer.marketId);
    if (market?.enabled) offer.price = strong ? bestPrice(s, market, c, offer) : Math.round(market.referencePrice * (1.04 + c.profile / 100));
  }
  if (s.features.purchasing.allowed) for (const [item, perUnit] of Object.entries(s.recipe)) {
    const incoming = c.purchases.filter(p => p.item === item && p.receivedAt === null).reduce((n,p) => n + p.qty, 0);
    if (incoming + c.inventory[item].qty >= perUnit * (strong ? 192 : 48)) continue;
    const supplier = s.catalog.suppliers.filter(r => r.item === item && r.enabled && r.stock >= r.min).sort((a,b) => a.price-b.price)[0];
    if (!supplier) continue;
    const qty = Math.min(Math.floor(supplier.stock / supplier.lot) * supplier.lot, Math.max(supplier.min, Math.ceil(perUnit * (strong ? 192 : 48) / supplier.lot) * supplier.lot));
    try { purchase(s, c, { supplierId: supplier.id, qty }); } catch (e) { if (e.status !== 400) throw e; }
  }
  if (!s.features.offers.allowed) return;
  const pending = c.orders.filter(o => o.remaining > 0).sort((a,b) => strong ? b.price-a.price || a.dueAt-b.dueAt : a.createdAt-b.createdAt);
  for (const order of pending) {
    const qty = Math.min(order.remaining, c.inventory.panel.qty);
    if (!qty) break;
    const routes = s.catalog.routes.filter(r => r.enabled);
    const timely = routes.filter(r => s.hour + r.hours + r.maxDelay <= order.dueAt);
    const route = (timely.length ? timely : routes).sort((a,b) => a.fixed + a.unit*qty - b.fixed - b.unit*qty)[0];
    if (!route || (strong && order.price * qty <= route.fixed + route.unit * qty)) continue;
    try { dispatch(s, c, { routeId: route.id, orderId: order.id, qty }); } catch (e) { if (e.status !== 400) throw e; }
    if (!strong) break;
  }
}
