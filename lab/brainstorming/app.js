// /lab/brainstorming/app.js

// ===== Global switches =====
const MANDATORY_MODE = true;       // true = strict; false = demo/skippable
const BLOCK_BACK_BUTTON = true;    // keeps URL same & neutralizes back/forward

// ===== Step config (order + files + titles) =====
const STEPS = [
  { key: "welcome",                 file: "00-welcome.html",                title: "Welcome" },
  { key: "registration",            file: "01-registration.html",           title: "Registration" },
  { key: "instr_individual",        file: "02-instruction-individual.html", title: "Individual Instructions" },
  { key: "phase1_individual",       file: "03-phase1-individual.html",      title: "Individual Ideation" },
  { key: "instr_group",             file: "04-instruction-group.html",      title: "Group Instructions" },
  { key: "phase2_group",            file: "05-phase2-group.html",           title: "Group Ideation" },
  { key: "post_survey",             file: "06-post-survey.html",            title: "Post Survey" },
  { key: "thank_you",               file: "07-thank-you.html",              title: "Thank You" },
];

// ===== App state (you can persist to localStorage if desired) =====
const state = {
  stepIndex: 0,
  participantId: null,
  data: {} // accumulate payloads per step if needed
};

// Prevent URL navigation & neutralize back/forward
(function setupHistoryLock(){
  if (!BLOCK_BACK_BUTTON) return;
  const sameURL = location.href;
  history.replaceState({ idx: state.stepIndex }, "", sameURL);
  window.addEventListener("popstate", (e) => {
    // Always force back to current step and same URL
    history.replaceState({ idx: state.stepIndex }, "", sameURL);
    render(); // re-render the current step
  });
})();

// Helper: load a partial and run any inline <script> it contains
async function loadPartialInto(el, partialPath){
  const res = await fetch(`./partials/${partialPath}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${partialPath}`);
  const html = await res.text();
  el.innerHTML = html;

  // Run inline scripts in the injected HTML (page-specific logic)
  el.querySelectorAll("script").forEach((oldScript) => {
    const s = document.createElement("script");
    if (oldScript.src) { s.src = oldScript.src; }
    else { s.textContent = oldScript.textContent; }
    document.body.appendChild(s);
    // Remove to avoid duplicates on next mounts
    setTimeout(() => s.remove(), 0);
  });
}

// Validation registry per step (reuse your existing code inside)
const validators = {
  // Updated registration validation to match new form fields
  registration: () => {
    if (!MANDATORY_MODE) return true;

    // Expect the partial to include these IDs/classes
    const form = document.getElementById("regForm");
    if (!form) return true; // nothing to validate

    const requiredIds = ["fullName","email","age","country","education"];
    let ok = true;

    const showError = (id, show) => {
      const el = document.querySelector(`[data-err="${id}"]`);
      if (el) el.style.display = show ? "block" : "none";
    };

    requiredIds.forEach(id => {
      const el = document.getElementById(id);
      const valid = el && el.value && (el.type !== "email" || /\S+@\S+\.\S+/.test(el.value));
      showError(id, !valid);
      if (!valid) ok = false;
    });

    // radios q1..q5 (screening questions)
    ["q1","q2","q3","q4","q5"].forEach(name => {
      const any = [...document.querySelectorAll(`input[name="${name}"]`)].some(r=>r.checked);
      const err = document.querySelector(`[data-err="${name}"]`);
      if (err) err.style.display = any ? "none" : "block";
      if (!any) ok = false;
    });

    // consent
    const c1 = document.getElementById("c1");
    const c2 = document.getElementById("c2");
    if (!(c1?.checked && c2?.checked)) ok = false;

    if (!ok) window.scrollTo({ top: 0, behavior: "smooth" });
    return ok;
  },

  // Example: post-survey strict validation
  post_survey: () => {
    if (!MANDATORY_MODE) return true;
    const required = ['q1','q2','q3','q4','q5','q6','q7','q8','q9','q10'];
    let ok = true;
    required.forEach(name => {
      const answered = [...document.querySelectorAll(`input[name="${name}"]`)].some(r=>r.checked);
      const err = document.querySelector(`[data-err="${name}"]`);
      if (err) err.style.display = answered ? 'none' : 'block';
      if (!answered) ok = false;
    });
    if (!ok) window.scrollTo({ top: 0, behavior: "smooth" });
    return ok;
  },

  // For other steps, either return true (no validation) or add your own checks
  welcome: () => true,
  instr_individual: () => true,
  phase1_individual: () => true,
  instr_group: () => true,
  phase2_group: () => {
    // Enforce "exactly 5 selected" in strict mode if your partial exposes it
    if (!MANDATORY_MODE) return true;
    const list = document.getElementById("groupTop5List");
    if (!list) return true;
    const selected = list.querySelectorAll("li").length;
    if (selected !== 5) {
      alert("Please select exactly 5 ideas.");
      return false;
    }
    return true;
  },
  thank_you: () => true
};

// Step navigation
async function render() {
  const step = STEPS[state.stepIndex];
  const app = document.getElementById("app");
  const badge = document.getElementById("phaseBadge");
  badge.textContent = `Step ${state.stepIndex + 1} of ${STEPS.length} • ${step.title}`;
  await loadPartialInto(app, step.file);
  wireNavButtons();
  exposeAppAPI(); // let partials call next/prev if needed
}

function next() {
  const stepKey = STEPS[state.stepIndex].key;
  const validate = validators[stepKey] || (() => true);
  if (!validate()) return;

  // Example: collect payload here if needed per step
  // state.data[stepKey] = collectPayloadFor(stepKey);

  // Keep the exact same URL; just update internal state and screen
  state.stepIndex = Math.min(state.stepIndex + 1, STEPS.length - 1);
  history.replaceState({ idx: state.stepIndex }, "", location.href);
  render();
}

function prev() {
  // You can disable prev entirely or allow within-phase back.
  // Keeping it disabled here to match your "no going back" rule.
  // If you ever want a controlled back: uncomment next two lines.
  // state.stepIndex = Math.max(0, state.stepIndex - 1);
  // render();
}

function wireNavButtons() {
  // Standardize "Next" / "Prev" hooks so all partials can just add:
  // <button data-next>Next</button>, <button data-prev>Prev</button>
  document.querySelectorAll("[data-next]").forEach(btn => btn.onclick = next);
  document.querySelectorAll("[data-prev]").forEach(btn => btn.onclick = prev);
}

// Optional: expose app controls to page scripts
function exposeAppAPI(){
  window.__APP__ = {
    next, prev,
    getState: () => ({ ...state }),
    setParticipantId: (id) => state.participantId = id,
    setData: (key, value) => { state.data[key] = value; }
  };
}

// Boot
render();