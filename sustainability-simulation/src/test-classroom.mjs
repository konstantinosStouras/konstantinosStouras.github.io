import { createSession, applyCommand, tick, publicView, assertInvariants, fail } from './engine.mjs?v=5366cc14c565';

// This model is held only by a SharedWorker. No storage, network or Firebase APIs.
export class TestClassroom {
  constructor(template, groups, uuid = () => crypto.randomUUID()) {
    if (!Array.isArray(groups) || groups.length < 1 || groups.length > 12) fail('Choose 1–12 companies.');
    if (groups.some(g => !Number.isInteger(g.students) || g.students < 1 || g.students > 20) || groups.reduce((n,g) => n + g.students, 0) > 60) fail('Choose 1–20 students per company, up to 60 in total.');
    this.state = createSession({ ...template, id: uuid(), name: ('Test · ' + template.name).slice(0,120), companyNames: groups.map(g => g.name) });
    for (const key of ['features', 'effects', 'catalog', 'recipe']) if (template[key]) this.state[key] = structuredClone(template[key]);
    this.state.secondsPerHour = template.secondsPerHour || 4;
    this.state.isTest = true;
    this.people = [{ id: uuid(), name: 'Test instructor', role: 'instructor', companyId: null, key: uuid() }];
    this.state.companies.forEach((company, i) => {
      for (let j = 0; j < groups[i].students; j++) this.people.push({ id: uuid(), name: `Test student ${i + 1}.${j + 1}`, role: 'student', companyId: company.id, key: uuid() });
    });
    this.receipts = new Map(); this.nextTick = null;
  }
  actor(key) { const person = this.people.find(p => p.key === key); if (!person) fail('This test tab link is invalid.', 403); const { key: _, ...actor } = person; return actor; }
  roster(key) { if (this.actor(key).role !== 'instructor') fail('Instructor access required.', 403); return structuredClone(this.people); }
  view(key, preview) { const actor = this.actor(key); return { actor, state: publicView(this.state, actor, preview) }; }
  advance(now) {
    if (this.state.status !== 'running') { this.nextTick = null; return; }
    this.nextTick ??= now + this.state.secondsPerHour * 1000;
    for (let n=0; n<120 && this.state.status === 'running' && this.nextTick <= now; n++) { tick(this.state); this.nextTick += this.state.secondsPerHour * 1000; }
  }
  command(key, request, now = Date.now()) {
    const actor = this.actor(key);
    if (typeof request.key !== 'string' || request.key.length < 8) fail('A request key is required.');
    const receiptKey = actor.id + ':' + request.key, payload = JSON.stringify(request.command), previous = this.receipts.get(receiptKey);
    if (previous) { if (previous.payload !== payload) fail('Request key already used for a different decision.',409); return previous.response; }
    if (request.revision !== this.state.revision) fail('The test session changed. Review the refreshed state and try again.',409);
    if (['assignment','deleteSession'].includes(request.command?.type)) fail('This action is not available in a temporary test round.');
    const next = structuredClone(this.state), message = applyCommand(next, actor, request.command, new Date(now).toISOString());
    assertInvariants(next); this.state = next;
    if (request.command.type === 'clock' || next.status !== 'running') this.nextTick = next.status === 'running' ? now + next.secondsPerHour * 1000 : null;
    const response = { message, revision: next.revision }; this.receipts.set(receiptKey, {payload,response}); return response;
  }
}
