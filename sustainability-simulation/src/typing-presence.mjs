// Ephemeral presence only: never transmit draft text or change simulation state.
export function typingPresence(entries, actor, session, active, now = Date.now()) {
  const reject = (message, status) => { throw Object.assign(new Error(message), { status }); };
  if (active !== undefined && typeof active !== 'boolean') reject('Expected a typing flag.', 400);
  if (actor.role !== 'student' || !actor.companyId) reject('Team membership required.', 403);
  if (session.studentAccess === false || ['completed', 'deleted'].includes(session.status)
      || !session.features?.messaging?.allowed || !session.features?.messaging?.visible) reject('Team messaging is unavailable.', 403);
  const live = (entries || []).filter(entry => entry.until > now && (active === undefined || entry.id !== actor.id));
  if (active === true) live.push({ id: actor.id, until: now + 6000 });
  return { entries: live, typing: live.some(entry => entry.id !== actor.id) };
}
