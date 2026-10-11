import {pieceById} from './data.js?v=20261011-piece-feedback-v2';
import {dislikeReasons} from './preferences.js?v=20261011-piece-feedback-v2';

const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function pieceFeedbackControls(look, feedback = {}) {
  return `<section class="piece-feedback" aria-label="Feedback on each piece">
    <h3>What didn't work?</h3>
    <p class="caption">Rate each piece in this combination. You can like the pieces even if the whole look isn't for you.</p>
    <p class="caption">All follow-up feedback is optional. Tap a selected vote to undo.</p>
    ${look.pieces.map(id => {
      const entry = feedback[id];
      return `<fieldset class="piece-feedback-row"><legend>${esc(pieceById[id].name)}</legend>
        <div class="actions"><button type="button" data-piece-rate="${id}" data-look="${look.id}" data-value="1" aria-pressed="${entry?.rating === 1}">♡ Like</button><button type="button" data-piece-rate="${id}" data-look="${look.id}" data-value="-1" aria-pressed="${entry?.rating === -1}">Not for me</button></div>
        ${entry?.rating === -1 ? `<details class="reason-dropdown"><summary><span>Choose reasons (optional)</span> · <span data-reason-count>${entry.reasons.length}</span></summary><p class="caption">Select all that apply.</p><div class="reason-options">${dislikeReasons.map(([reason, text]) => `<label><input type="checkbox" data-piece-reason="${reason}" data-piece="${id}" data-look="${look.id}" ${entry.reasons.includes(reason) ? 'checked' : ''}><span>${esc(text)}</span></label>`).join('')}</div></details>` : ''}
      </fieldset>`;
    }).join('')}
  </section>`;
}

export function lookFeedbackControls(look, {uid, ratings, pieceFeedback}, compact = false) {
  return `<div class="look-feedback ${compact ? 'compact' : ''}" data-feedback-look="${look.id}">
    <p class="eyebrow">Do you like this combination?</p>
    ${uid ? `<div class="actions" role="group" aria-label="Outfit combination preference"><button type="button" data-rate="${look.id}" data-value="1" aria-pressed="${ratings[look.id] === 1}">♡ Like</button><button type="button" data-rate="${look.id}" data-value="-1" aria-pressed="${ratings[look.id] === -1}">Not for me</button></div>
    <p class="caption">Your vote is about how the pieces work together.</p>
    ${ratings[look.id] === -1 ? pieceFeedbackControls(look, pieceFeedback[look.id]) : ''}
    <p class="caption">Saved for your account in this browser. Weather needs come first.</p>
    ${ratings[look.id] === -1 ? '<p class="caption">Changing or undoing your combination vote clears its piece feedback.</p>' : ''}` : '<p class="caption">Sign in to save your style preferences.</p><button class="text-button" data-style-signin>Sign in / Register</button>'}
  </div>`;
}
