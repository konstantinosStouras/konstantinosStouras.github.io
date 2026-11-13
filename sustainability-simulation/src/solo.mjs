import { createSession, applyCommand, publicView, assertInvariants } from './engine.mjs?v=5366cc14c565';
const KEY = 'sustainability-studio-solo-v1';
export function soloAdapter(initial) {
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY)); if (state?.schema !== 1) state = null; } catch { state = null; }
  if (initial) { state = structuredClone(initial); state.id = 'solo'; state.name = 'Test round · ' + state.name; state.status = 'paused'; state.messages = []; state.audit = []; }
  const teacher = { id: 'sandbox-instructor', role: 'instructor', name: 'Sandbox instructor' };
  if (!state) {
    state = createSession({ id: 'solo', name: 'Your sustainability sandbox' });
    state.companies.forEach((c, i) => {
      const actor = { id: `sandbox-${i}`, name: c.name, role: 'student', companyId: c.id };
      applyCommand(state, actor, { type: 'invest', kind: 'delivery' });
      if (i === 1) applyCommand(state, actor, { type: 'shifts', shifts: [true, true, false] });
      if (i === 2) applyCommand(state, actor, { type: 'energy', energyId: 'wind' });
    });
    applyCommand(state, teacher, { type: 'step', hours: 72 });
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  let actor = { id: 'sandbox-0', role: 'student', name: 'You · Helio', companyId: 'company-1' };
  return {
    isTest: !!initial,
    get actor() { return actor; },
    switchRole(role, companyId = 'company-1') { actor = role === 'instructor' ? teacher : { id: 'sandbox-player', name: 'Sandbox player', role: 'student', companyId }; },
    view(preview) { return { state: publicView(state, actor, preview), actor }; },
    command(command) {
      if (command.type === 'clock') throw new Error('The solo sandbox uses manual steps. Switch to instructor view and advance the clock.');
      const next = structuredClone(state), message = applyCommand(next, actor, command, new Date().toISOString());
      assertInvariants(next); if (!initial) localStorage.setItem(KEY, JSON.stringify(next)); state = next; return { message };
    },
    reset() { localStorage.removeItem(KEY); },
    export() { return state; }
  };
}
