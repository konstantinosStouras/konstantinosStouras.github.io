// An inclusive calendar-day boundary plus receipts preserves later harvests
// on the same day without sending the earlier harvest again.
import { createHash } from 'node:crypto';
export const DAY_MS = 86400000;
export const dayStart = d => new Date(Math.floor(d.getTime() / DAY_MS) * DAY_MS);
export function paperId(p) {
  const key = String(p.DOI || `${p.Title}|${p.Year}`).trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}
export function paperWindowStart(alert, last, initialWindow) {
  // Migrate old subscriptions without replaying an already-sent day.
  return last && alert.paperReceiptVersion === 1
    ? new Date(dayStart(last).getTime() - DAY_MS) : initialWindow;
}
export function unsentAtBoundary(p, alert, last) {
  return !last || dayStart(p._added).getTime() !== dayStart(last).getTime() ||
    !(alert.lastCheckedPaperIds || []).includes(paperId(p));
}
export function paperReceiptUpdate(alert, delivered, now, last) {
  const ids = new Set(last && dayStart(last).getTime() === dayStart(now).getTime()
    ? alert.lastCheckedPaperIds || [] : []);
  for (const p of delivered) if (dayStart(p._added).getTime() === dayStart(now).getTime()) ids.add(paperId(p));
  return { paperReceiptVersion: 1, lastCheckedPaperIds: [...ids] };
}
export function frequencyDue(frequency, last, created, now) {
  const days = { immediate: 0, daily: 1, weekly: 7, monthly: 28 };
  const period = days[frequency] ?? days.weekly;
  if (!last) return true;
  return now - last >= Math.max(0, period * DAY_MS - (period ? 60 * 60000 : 0));
}
