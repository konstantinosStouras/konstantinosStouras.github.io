import {looks} from './data.js?v=20261011-authfast-v1';

export const dislikeReasons = [
  ['colour', 'Wrong colour for me'],
  ['combination', "Style doesn't fit with the rest"],
  ['cut', "I don't like the cut or silhouette"],
  ['proportions', "The proportions don't suit me"],
  ['fabric', "Fabric or texture isn't for me"],
  ['pattern', "Pattern or print isn't for me"],
  ['details', 'Details feel too busy'],
  ['formal', 'Too formal for my day'],
  ['casual', 'Too casual for my day'],
  ['comfort', "Doesn't look comfortable"]
];
const reasonIds = new Set(dislikeReasons.map(([id]) => id));
const contextualReasons = new Set(['combination', 'formal', 'casual']);

export function cleanRatings(value) {
  return Object.fromEntries(looks.filter(l => value && [1, -1].includes(value[l.id])).map(l => [l.id, value[l.id]]));
}

// Piece votes belong to a particular rejected combination, not a global blacklist.
export function cleanPieceFeedback(value, ratings = {}) {
  const result = {};
  for (const look of looks) {
    if (ratings[look.id] !== -1) continue;
    const entries = {};
    for (const id of look.pieces) {
      const entry = value?.[look.id]?.[id];
      if (!entry || ![1, -1].includes(entry.rating)) continue;
      entries[id] = {rating: entry.rating, reasons: entry.rating === -1 && Array.isArray(entry.reasons)
        ? [...new Set(entry.reasons.filter(reason => reasonIds.has(reason)))] : []};
    }
    if (Object.keys(entries).length) result[look.id] = entries;
  }
  return result;
}

export function preferenceScore(look, ratings = {}, pieceFeedback = {}) {
  // Whole-look votes judge the combination only. Never infer that every piece or
  // colour is liked/disliked. Explicit piece feedback provides a modest tie-break.
  const feedback = cleanPieceFeedback(pieceFeedback, ratings);
  const affinity = look.pieces.reduce((total, id) => {
    const votes = Object.values(feedback).map(entries => entries[id]).filter(Boolean);
    if (!votes.length) return total;
    return total + votes.reduce((sum, entry) => {
      // Styling/occasion objections should not penalize this piece in other looks.
      if (entry.rating === -1 && entry.reasons.length && entry.reasons.every(reason => contextualReasons.has(reason))) return sum;
      return sum + entry.rating;
    }, 0) / votes.length;
  }, 0) / look.pieces.length;
  return ([1, -1].includes(ratings[look.id]) ? ratings[look.id] * 2 : 0) + affinity;
}
