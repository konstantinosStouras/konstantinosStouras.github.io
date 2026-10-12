import {pieces} from './data.js?v=20261012-likeness-v1';
import {checkPurchase, purchaseColours} from './purchase-check.js?v=20261012-likeness-v1';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let photoURL = '', revision = 0;
export function clearPurchase() {
  ++revision;
  if (photoURL) URL.revokeObjectURL(photoURL);
  photoURL = '';
  document.querySelector('#purchase-preview')?.replaceChildren();
  document.querySelector('#purchase-results')?.replaceChildren();
  document.querySelector('#purchase-form')?.reset();
}

export function purchasePage(uid) {
  const heading = '<div class="page-head"><div><p class="eyebrow">MAKE EVERY PIECE COUNT</p><h1>Before you buy</h1></div></div>';
  if (!uid) return heading + '<div class="empty"><h2>A little pause before a purchase.</h2><p>Sign in to compare a clothing photo with your wardrobe.</p><button data-purchase-signin>Sign in / Register</button></div>';
  return heading + `<p class="intro muted">Would it work with what you already own? Add a photo, choose the closest capsule piece and check the possibilities.</p>
    <div class="purchase-layout"><section class="purchase-card"><h2>The piece you have in mind</h2>
    <p class="caption">Your photo stays in this tab. It is never uploaded or saved, and is cleared when you leave this page or sign out.</p>
    <form id="purchase-form">
      <label class="field purchase-upload">Clothing photo<span class="button">Choose photo</span><input class="purchase-file" type="file" id="purchase-photo" aria-label="Clothing photo" accept="image/jpeg,image/png,image/webp" required><small>JPEG, PNG or WebP · up to 8 MB</small></label>
      <div id="purchase-preview" class="purchase-preview"></div>
      <button type="button" class="text-button" data-purchase-clear>Clear photo & check</button>
      <label class="field">Closest capsule piece<select name="reference" required><option value="">Choose a comparable piece</option>${pieces.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field">Main colour<select name="colour" required><option value="">Choose a colour</option>${purchaseColours.map(c => `<option value="${c}">${c}</option>`).join('')}</select></label>
      <p class="caption">You identify the garment and colour. This check uses those details and your Owned pieces; it does not recognise the photo or simulate a try-on.</p>
      <button class="primary" type="submit">Check my wardrobe</button>
      <p id="purchase-status" role="status" aria-live="polite"></p>
    </form></section>
    <section class="purchase-results" aria-label="Wardrobe compatibility"><div id="purchase-results"><div class="empty"><p class="eyebrow">BUY LESS, WEAR MORE</p><h2>Start with what is already yours.</h2><p>Mark the clothes you own in Pieces for a useful comparison.</p><a href="#pieces">Review your pieces ↗</a></div></div></section></div>`;
}

export function installPurchase({uid, ownership, image}) {
  const message = text => { const el = document.querySelector('#purchase-status'); if (el) el.textContent = text; };
  document.addEventListener('click', event => {
    if (event.target.closest('[data-purchase-signin]')) document.querySelector('#account-button').click();
    if (event.target.closest('[data-purchase-clear]')) { clearPurchase(); message('Photo and check cleared.'); }
  });
  document.addEventListener('change', async event => {
    if (event.target.closest('#purchase-form')) document.querySelector('#purchase-results')?.replaceChildren();
    if (event.target.id !== 'purchase-photo') return;
    const input = event.target, file = input.files?.[0], owner = uid();
    const request = ++revision;
    if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = '';
    document.querySelector('#purchase-preview')?.replaceChildren();
    if (!owner || !file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      input.value = ''; message('Choose a JPEG, PNG or WebP image smaller than 8 MB.'); return;
    }
    message('Opening your photo…');
    const url = URL.createObjectURL(file), photo = new Image();
    photo.src = url;
    try {
      await photo.decode();
      if (request !== revision || owner !== uid() || !input.isConnected) { URL.revokeObjectURL(url); return; }
      if (photo.naturalWidth * photo.naturalHeight > 40000000) throw Error('size');
      photo.alt = 'Your potential purchase';
      photoURL = url;
      document.querySelector('#purchase-preview').replaceChildren(photo);
      message('Photo ready. Confirm the piece and colour below.');
    } catch {
      URL.revokeObjectURL(url);
      if (request === revision && owner === uid()) { input.value = ''; message('This image could not be opened. Try a smaller JPEG, PNG or WebP.'); }
    }
  });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'purchase-form') return;
    event.preventDefault();
    if (!uid() || !photoURL) { message('Add a clothing photo before checking.'); return; }
    const data = new FormData(event.target);
    const result = checkPurchase({referenceId:data.get('reference'), colour:data.get('colour')}, ownership());
    const target = document.querySelector('#purchase-results');
    const list = items => items.map(p => `<li>${esc(p.name)}</li>`).join('');
    target.innerHTML = `<h2>Your wardrobe check</h2><p class="caption">Based on your selected garment type, colour and confirmed ownership. Catalog photos show the original looks, not your uploaded item.</p>
      ${result.duplicates.length ? `<div class="callout"><h3>You may already have something similar</h3><ul>${list(result.duplicates)}</ul><p>Could one of these do the same job? Compare condition and fit before buying another.</p></div>` : '<p>No similar owned capsule piece was found for this garment type and colour. That alone is not a reason to buy.</p>'}
      ${!result.ownedCount ? '<div class="empty"><h3>Confirm your wardrobe first</h3><p>No pieces are marked Owned yet. We cannot claim matches with clothes you own.</p><a href="#pieces">Review your pieces ↗</a></div>' : !result.matches.length ? '<div class="empty"><h3>No connections yet</h3><p>No confirmed owned companions were found in the existing looks for this piece. Review ownership or try another comparable piece.</p><a href="#pieces">Review your pieces ↗</a></div>' : result.matches.map(m => `<article class="purchase-match"><a href="#look/${m.look.id}">${image(m.look)}</a><div><p class="eyebrow">${m.complete ? 'All companion pieces owned' : 'Some companion pieces still unconfirmed'}</p><h3><a href="#look/${m.look.id}">${esc(m.look.name)}</a></h3><p class="caption">Compare your photo with this existing look.</p><h4>Already in your wardrobe</h4><ul>${list(m.owned)}</ul>${m.missing.length ? `<details><summary>Other pieces to review</summary><ul>${list(m.missing)}</ul></details>` : ''}<p class="caption">${m.palette === 'easy' ? 'The selected colour has a simple palette connection with your owned companions.' : 'Compare the colours and pattern carefully; this pairing needs a visual check.'}</p></div></article>`).join('')}
      <div class="callout"><h3>Worth a second thought</h3><p>Can you wear it with what you own, and would you choose it often? Check the actual cut, fabric, warmth, rain protection and measurements. This is styling guidance, not a fit or weather guarantee.</p><p class="caption">Your collection stays unchanged. Nothing is added to your wardrobe or shopping list.</p></div>`;
    message('Wardrobe check ready.');
    target.setAttribute('tabindex','-1'); target.focus({preventScroll:true});
  });
}

window.addEventListener('pagehide', clearPurchase);
