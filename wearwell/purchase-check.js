import {pieces, looks, pieceById} from './data.js?v=20261022-admin-v2';

export const purchaseColours = ['white','ecru','navy','black','grey','charcoal','stone','oatmeal','blue','light blue','indigo','forest','olive','brown','chocolate','tobacco','oxblood','bright / patterned'];
const neutral = new Set(['white','ecru','navy','black','grey','charcoal','stone','oatmeal','indigo']);
export function paletteMatch(colour, companions) {
  if (colour === 'bright / patterned') return 'review';
  return companions.every(p => neutral.has(colour) || neutral.has(p.colour) || colour === p.colour) ? 'easy' : 'review';
}
export function checkPurchase({referenceId, colour}, ownership = {}) {
  const reference = pieceById[referenceId];
  if (!reference || !purchaseColours.includes(colour)) throw Error('Choose a comparable piece and a colour.');
  const duplicates = pieces.filter(p => ownership[p.id] === 'owned' && p.category === reference.category && (p.id === reference.id || p.colour === colour));
  const matches = looks.filter(l => l.pieces.includes(referenceId)).map(look => {
    const companions = look.pieces.filter(id => id !== referenceId).map(id => pieceById[id]);
    const owned = companions.filter(p => ownership[p.id] === 'owned');
    const missing = companions.filter(p => ownership[p.id] !== 'owned');
    return {look, owned, missing, palette:paletteMatch(colour, owned), complete:missing.length === 0};
  }).filter(m => m.owned.length > 0).sort((a,b) => Number(b.complete)-Number(a.complete) || b.owned.length-a.owned.length || a.look.id.localeCompare(b.look.id));
  return {reference, duplicates, matches, ownedCount:pieces.filter(p => ownership[p.id] === 'owned').length};
}
