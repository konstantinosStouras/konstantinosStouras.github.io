/* ── lit-acct-nav.js — shared account control for The Lit's sub-pages ─────────
 *
 * The main browser (lit/index.html) shows a Sign-in / account button at the top
 * right of its claret header. This gives the three standalone sub-pages —
 * About (lit/about/), Data Analytics (lit/analytics/) and Feedback
 * (lit/feedback/) — the SAME control, so the header's top-right menu looks and
 * behaves consistently everywhere.
 *
 * It is deliberately lightweight: the account FEATURES (library, e-mail alerts,
 * default filters, edit profile) all live on the main page, so this control only
 *   • reflects the shared sign-in state (Firebase Auth persists per-project for
 *     the whole stouras.com origin, so a user signed in on the main page is
 *     already recognised here — no extra sign-in needed),
 *   • renders the identical button + dropdown (same CSS classes / identicon), and
 *   • links each menu item back to the main page, which opens the matching view
 *     from the URL hash (#lit-signin / #lit-library / #lit-alerts /
 *     #lit-defaults / #lit-profile — handled by acctHandleHashLink() in
 *     lit/index.html), with Sign out done in place.
 *
 * Requirements on the host page: load the Firebase compat SDK (app + auth) and
 * include an empty  <div id="acctControl" class="acct-control"></div>  in the
 * header. This script only uses firebase.auth() (never Firestore), so it works
 * the same on all three pages. It reuses the default Firebase app if the page
 * already created one (Feedback / Analytics do), otherwise it creates it.
 *
 * KEEP FB_CONFIG BELOW IN SYNC with FB_CONFIG in lit/index.html.
 */
(function () {
  'use strict';

  var FB_CONFIG = {
    apiKey: "AIzaSyDUh6qKU42CiJf6yCsQ-znmH8Y9zo95u04",
    authDomain: "lit-paper-browser.firebaseapp.com",
    projectId: "lit-paper-browser",
    storageBucket: "lit-paper-browser.firebasestorage.app",
    messagingSenderId: "336217663944",
    appId: "1:336217663944:web:219da7d213d1005625f8fd",
    measurementId: "G-2E1BTF9SSD"
  };

  var MAIN = '/lit/';

  var el = document.getElementById('acctControl');
  if (!el) return;
  // Inert (like the main page) until Firebase is loaded and configured — the
  // control just stays empty, and .acct-control:empty hides it (no layout shift).
  if (!window.firebase || !firebase.auth || !FB_CONFIG.apiKey
      || FB_CONFIG.apiKey.indexOf('PASTE_') !== -1) return;

  var app;
  try { app = (firebase.apps && firebase.apps.length) ? firebase.app() : firebase.initializeApp(FB_CONFIG); }
  catch (e) { return; }
  var auth;
  try { auth = firebase.auth(); } catch (e) { return; }

  injectStyles();

  var user = null;
  auth.onAuthStateChanged(function (u) { user = u || null; render(); });
  render(); // show the Sign-in button immediately, before auth resolves

  function render() {
    if (!user) {
      // ".../#lit-signin" makes the main page open its full sign-in modal
      // (Google + e-mail/password), so there is ONE sign-in implementation.
      el.innerHTML = '<a class="acct-btn" href="' + MAIN + '#lit-signin">Sign in</a>';
      return;
    }
    var name = user.displayName || (user.email ? user.email.split('@')[0] : 'Account');
    var avatar = avatarUrl(user.uid || user.email || 'anon');
    el.innerHTML =
      '<div class="acct-wrap">' +
        '<button class="acct-btn acct-user" type="button" data-acct-toggle>' +
          '<span class="acct-avatar" style="background-image:url(\'' + avatar + '\')"></span>' +
          '<span class="acct-uname">' + esc(name) + '</span>' +
        '</button>' +
        '<div class="acct-menu" data-acct-menu>' +
          '<div class="acct-menu-head">Signed in as<strong>' + esc(user.email || name) + '</strong></div>' +
          '<a class="acct-menu-item" title="Your starred papers, lists, tags and private notes — everything you have saved." href="' + MAIN + '#lit-library">★ My library</a>' +
          '<div class="acct-menu-sep"></div>' +
          '<a class="acct-menu-item" title="Get an e-mail when new papers match your filters, or when the site gains a feature." href="' + MAIN + '#lit-alerts">✉️ E-mail alerts</a>' +
          '<a class="acct-menu-item" title="A set of journals or types applied automatically each time you sign in." href="' + MAIN + '#lit-defaults">⚙️ Default filters</a>' +
          '<a class="acct-menu-item" title="Edit your name, affiliation and account details." href="' + MAIN + '#lit-profile">👤 Edit profile</a>' +
          '<div class="acct-menu-sep"></div>' +
          '<button class="acct-menu-item danger" type="button" title="Sign out of your account on this device." data-acct-signout>Sign out</button>' +
        '</div>' +
      '</div>';
    var toggle = el.querySelector('[data-acct-toggle]');
    var menu = el.querySelector('[data-acct-menu]');
    toggle.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('open'); });
    el.querySelector('[data-acct-signout]').addEventListener('click', function () {
      menu.classList.remove('open');
      auth.signOut().catch(function (err) { console.warn('sign out:', err && err.code); });
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.acct-wrap')) {
      var m = el.querySelector('[data-acct-menu]'); if (m) m.classList.remove('open');
    }
  });

  // ── identicon (byte-for-byte the same algorithm as acctHash / acctAvatarUrl
  //    in lit/index.html, seeded by uid/email, so the avatar matches everywhere)
  function hash(s) {
    var h = 2166136261 >>> 0;                       // FNV-1a
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function avatarUrl(seed) {
    var h = hash(String(seed || 'anon'));
    var hue = h % 360;
    var fg = 'hsl(' + hue + ',55%,45%)';
    var bg = 'hsl(' + ((hue + 45) % 360) + ',46%,94%)';
    var rng = (h ^ 0x9e3779b9) >>> 0;
    function bit() { rng = (Math.imul(rng, 1103515245) + 12345) >>> 0; return (rng >>> 17) & 1; }
    var cells = '';
    for (var y = 0; y < 5; y++) {                    // 5×5 grid, mirrored left→right
      for (var x = 0; x < 3; x++) {
        if (bit()) {
          cells += '<rect x="' + (x * 20) + '" y="' + (y * 20) + '" width="20" height="20"/>';
          if (x < 2) cells += '<rect x="' + ((4 - x) * 20) + '" y="' + (y * 20) + '" width="20" height="20"/>';
        }
      }
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" shape-rendering="crispEdges">' +
              '<rect width="100" height="100" fill="' + bg + '"/><g fill="' + fg + '">' + cells + '</g></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The control's CSS, injected once (mirrors the .acct-* rules in lit/index.html
  // so the button + dropdown look identical). Kept here rather than copied into
  // each sub-page's inline <style>, so it lives in ONE place. Relies on the
  // shared header variables (--navy-light / --border / --text / --text-muted /
  // --accent / --navy-dark / --shadow-lg), which every sub-page defines.
  function injectStyles() {
    if (document.getElementById('lit-acct-nav-css')) return;
    var css =
      '.header-right{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end;}' +
      '.acct-control{display:flex;align-items:center;}' +
      '.acct-control:empty{display:none;}' +
      '.acct-btn{font-family:\'Work Sans\',sans-serif;font-size:13px;font-weight:600;cursor:pointer;border-radius:8px;padding:9px 15px;border:1.5px solid rgba(255,255,255,0.5);background:rgba(255,255,255,0.08);color:#fff;transition:all .15s;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;line-height:1;}' +
      '.acct-btn:hover{background:rgba(255,255,255,0.18);border-color:#fff;}' +
      '.acct-user{gap:8px;max-width:220px;}' +
      '.acct-uname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.acct-avatar{width:24px;height:24px;border-radius:50%;background:var(--accent) center/cover no-repeat;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.07);}' +
      '.acct-wrap{position:relative;}' +
      '.acct-menu{display:none;position:absolute;right:0;top:calc(100% + 8px);background:#fff;color:var(--text);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow-lg);min-width:240px;z-index:300;overflow:hidden;}' +
      '.acct-menu.open{display:block;}' +
      '.acct-menu-head{padding:12px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted);}' +
      '.acct-menu-head strong{display:block;color:var(--text);font-size:13.5px;font-weight:600;overflow-wrap:break-word;margin-top:2px;}' +
      '.acct-menu-item{display:flex;justify-content:space-between;gap:10px;align-items:center;width:100%;padding:10px 16px;font-family:inherit;font-size:13.5px;text-align:left;cursor:pointer;transition:background .1s;color:var(--text);text-decoration:none;background:none;border:none;}' +
      '.acct-menu-item:hover{background:var(--navy-light);}' +
      '.acct-menu-sep{height:1px;background:var(--border);}' +
      '.acct-menu-item.danger{color:#b33a3a;}' +
      '.acct-menu-item.danger:hover{background:#fdeaea;}';
    var st = document.createElement('style');
    st.id = 'lit-acct-nav-css';
    st.textContent = css;
    document.head.appendChild(st);
  }
})();
