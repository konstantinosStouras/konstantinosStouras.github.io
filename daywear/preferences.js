import {looks, pieceById} from './data.js?v=20261011-languages-v1';

export function cleanRatings(value) {
  return Object.fromEntries(looks.filter(l => value && [1, -1].includes(value[l.id])).map(l => [l.id, value[l.id]]));
}

// Learn only from explicit votes. Shared garments and palette are modest signals;
// a vote on the complete look always has more weight than inferred similarity.
export function preferenceScore(look, ratings = {}) {
  const votes = looks.filter(l => [1, -1].includes(ratings[l.id]));
  if (!votes.length) return 0;
  const garments = look.pieces.filter(id => pieceById[id].category !== 'Extras');
  const affinity = votes.reduce((sum, voted) => {
    const overlap = garments.filter(id => voted.pieces.some(other =>
      id === other || (pieceById[id].category === pieceById[other].category && pieceById[id].colour === pieceById[other].colour)
    )).length / garments.length;
    return sum + ratings[voted.id] * overlap;
  }, 0) / votes.length;
  return ([1, -1].includes(ratings[look.id]) ? ratings[look.id] * 2 : 0) + affinity;
}
