/* Simulation Platform — OPTIONAL drop-in prefill for hosted simulations.
   Include on a simulation's page (any position; it waits for the DOM):
       <script src="/simulation/prefill.js" defer></script>
   It reads the launch handoff the platform wrote to localStorage
   ('simp:handoff:v1' — same origin, so every app under stouras.com can see
   it) and fills the simulation's own registration/join form with the
   student's saved details. Design rules:
     - Does NOTHING when there is no fresh handoff — the app keeps working
       standalone exactly as before (the drop-in is inert outside the
       platform flow).
     - Fields are found by (1) an explicit data-simp="<key>" attribute, or
       (2) label text (the built-in map below) — this is what reaches the
       dynamically-built, id-less forms (portfoliofit's buildField,
       ideasearchlab's React inputs).
     - React-controlled inputs are set through the native value setter and a
       bubbling 'input' event, so component state updates too.
     - A field is only filled while empty and only once; nothing is ever
       auto-submitted. Radio groups are matched by their name attribute.
   A page can set window.SIMP_EXPECT = '<catalog key>' before this script to
   accept only handoffs meant for it. */
(function () {
  'use strict';
  var KEY = 'simp:handoff:v1';
  var MAX_AGE_MS = 6 * 60 * 60 * 1000;      // ignore handoffs older than 6 h
  var OBSERVE_MS = 45 * 60 * 1000;          // watch late-built forms this long

  var h = null;
  try { h = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (!h || !h.profile || (Date.now() - (h.ts || 0)) > MAX_AGE_MS) return;
  if (window.SIMP_EXPECT && h.sim !== window.SIMP_EXPECT) return;

  var V = {};
  Object.keys(h.profile).forEach(function (k) { V[k] = h.profile[k]; });
  if (h.session) V.session = h.session;
  window.SIMP_HANDOFF = h;                  // apps may also read it directly

  var LABELS = [
    ['studentId',      /university\s+student\s*id|participant\s*id|student\s*id|prolific\s*id/i],
    ['email',          /e-?mail/i],
    ['name',           /full\s*name|^your\s+name/i],
    ['age',            /^age\b/i],
    ['gender',         /^gender/i],
    ['nationality',    /nationality/i],
    ['country',        /country\s+of\s+residence|^country\b/i],
    ['levelOfStudy',   /level\s+of\s+study/i],
    ['workExperience', /work\s+experience/i],
    ['occupation',     /occupation/i],
    ['industry',       /industr/i],
    ['englishFluency', /english/i],
    ['session',        /session\s*(code|id)|game\s*code|join\s*code|entry\s*code/i]
  ];
  var SKIP_TYPES = { hidden: 1, submit: 1, button: 1, password: 1, file: 1, checkbox: 1, image: 1, reset: 1, range: 1, color: 1 };
  var done = (typeof WeakSet !== 'undefined') ? new WeakSet() : { add: function () {}, has: function () { return false; } };

  function setNative(el, val) {
    var proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
              : el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, val); else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function labelText(el) {
    var t = '';
    var lab = el.closest && el.closest('label');
    if (lab) t += ' ' + lab.textContent;
    if (el.id) {
      var forLab = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (forLab) t += ' ' + forLab.textContent;
    }
    var prev = el.previousElementSibling;
    if (prev && (prev.tagName === 'LABEL' || /label/i.test(prev.className))) t += ' ' + prev.textContent;
    if (!t.trim() && el.parentElement &&
        el.parentElement.querySelectorAll('input, select, textarea').length === 1) {
      // Field-wrapper case (e.g. portfoliofit's buildField): the parent holds
      // exactly this one field, so its label is unambiguous. Never grab a
      // label from a container with several fields — it would be another
      // field's label.
      var pl = el.parentElement.querySelector('label');
      if (pl) t += ' ' + pl.textContent;
    }
    t += ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '');
    return t.replace(/\s+/g, ' ').trim();
  }
  function keyFor(el) {
    var explicit = el.getAttribute('data-simp');
    if (explicit) return explicit;
    if (el.type === 'radio' && el.name && V[el.name] != null) return el.name;
    var t = labelText(el);
    if (!t.trim()) return null;
    for (var i = 0; i < LABELS.length; i++) if (LABELS[i][1].test(t)) return LABELS[i][0];
    return null;
  }
  function fill(el, key) {
    var val = V[key];
    if (val == null || val === '') return;
    val = String(val);
    if (el.tagName === 'SELECT') {
      if (el.value) return;
      for (var i = 0; i < el.options.length; i++) {
        var o = el.options[i];
        if (o.value.toLowerCase() === val.toLowerCase() || o.text.trim().toLowerCase() === val.toLowerCase()) {
          setNative(el, o.value);
          return;
        }
      }
      return;
    }
    if (el.type === 'radio') {
      var group = document.querySelectorAll('input[type="radio"][name="' + el.name + '"]');
      for (var j = 0; j < group.length; j++) if (group[j].checked) return;
      // Whole-word match, so "Male" can never select the "Female" option.
      var own = (el.value || '') + ' ' + labelText(el);
      var re = new RegExp('(^|[^a-z0-9])' + val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'i');
      if (re.test(own)) el.click();
      return;
    }
    if (el.value && el.value.trim()) return;
    if (el.type === 'number') { var n = parseFloat(val); if (isNaN(n)) return; val = String(n); }
    setNative(el, val);
  }
  function pass() {
    var els = document.querySelectorAll('input, select, textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (done.has(el) || SKIP_TYPES[el.type] || el.disabled || el.readOnly) continue;
      var key = keyFor(el);
      if (key) { fill(el, key); done.add(el); }
    }
  }

  function start() {
    pass();
    if (typeof MutationObserver === 'undefined') return;
    var timer = null;
    var mo = new MutationObserver(function () {
      if (timer) return;
      timer = setTimeout(function () { timer = null; pass(); }, 250);
    });
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { mo.disconnect(); }, OBSERVE_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
