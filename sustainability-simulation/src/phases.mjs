import { quoteScores } from './opponents.mjs?v=b6c679bc9e11';
import { advance, applyCommand, createSession, fail, integer, profit } from './engine.mjs?v=b6c679bc9e11';

export const phaseNames = {
  training: 'Training', main: 'Main play', supply: 'Supply chain disruptions',
  carbon: 'Sustainability and regulatory challenges', tariffs: 'Import tariffs'
};
export const defaultPhases = Object.keys(phaseNames).map(id => ({ id, mode: id === 'training' ? 'team' : 'class' }));

export function teamVersions(s) {
  if (s.status !== 'paused' || s.course?.plan[s.course.index]?.mode !== 'team') return {};
  return Object.fromEntries(s.companies.filter(c => !c.bot).map(c => [c.id, [c.id, s.course.index, s.course.controlVersion || 0, s.course.lanes[c.id]?.version || 0].join('/')]));
}
export function sameTeamDecision(actor, request, versions) {
  return actor.role === 'student' && request.command?.type !== 'message' && Number.isSafeInteger(request.revision) && request.revision >= 0 &&
    typeof request.teamVersion === 'string' && versions?.[actor.companyId] === request.teamVersion;
}
function applyConditions(s, id) {
  if (id === 'supply') {
    for (const row of s.catalog.suppliers) if (row.enabled) row.reliability = 70;
    for (const row of s.catalog.routes) if (row.enabled) row.reliability = 50;
  }
  if (id === 'carbon') {
    s.effects.carbonDemand = true;
    for (const market of s.catalog.markets) market.greenWeight = Math.max(65, market.greenWeight);
  }
  if (id === 'tariffs') {
    // Selected additional duties in the classroom's 5 April 2025 US scenario.
    const rates = { 'cell-circular': 30, 'cell-express': 10, 'frame-circular': 25, 'frame-express': 25, 'controller-circular': 10, 'controller-express': 0 };
    for (const supplier of s.catalog.suppliers) supplier.price = Math.round(supplier.price * (1 + (rates[supplier.id] || 0) / 100));
  }
}

export function setupPhases(s, { phases = defaultPhases, trainingHours = 48, benchmark = false, policy = null } = {}) {
  if (!Array.isArray(phases) || !phases.length || phases.length > 5) fail('Select at least one phase.');
  const plan = Object.keys(phaseNames).filter(id => phases.some(p => p?.id === id)).map(id => {
    const { mode } = phases.find(p => p.id === id);
    if (!['class','team'].includes(mode)) fail('Choose a valid phase mode.');
    return { id, mode };
  });
  if (plan.length !== phases.length) fail('Invalid or repeated phase.');
  integer(trainingHours, 'Training hours', 1, 720);
  if (typeof benchmark !== 'boolean') fail('Choose a valid benchmark setting.');
  const graded = plan.filter(p => p.id !== 'training'), total = s.endHour;
  plan.forEach(p => {
    const i = graded.indexOf(p);
    p.hours = i < 0 ? trainingHours : Math.floor((i + 1) * total / graded.length) - Math.floor(i * total / graded.length);
  });
  if (policy) {
    if (!Array.isArray(policy.profiles) || policy.profiles.length !== s.companies.length ||
        !policy.profiles.every(p => Number.isInteger(p) && p >= 0 && p <= 8)) fail('Invalid opponent profiles.');
    policy = { model: String(policy.model).slice(0,160), provider: String(policy.provider).slice(0,40), profiles: [...policy.profiles] };
  }
  s.course = { plan, index: 0, elapsed: 0, benchmark, policy, lanes: {}, results: [], total, trainingHours };
  // Shared operational time freezes while the teams work in separate markets.
  s.endHour = plan.filter(p => p.mode === 'class').reduce((n,p) => n + p.hours, 0) || total;
  enterPhase(s);
}

function enterPhase(s) {
  const course = s.course, phase = course.plan[course.index];
  course.elapsed = 0;
  if (!phase) { s.status = 'completed'; return; }
  if (phase.mode === 'team') { s.status = 'paused'; course.lanes = {}; return; }
  applyConditions(s, phase.id);
  if (course.benchmark && phase.id !== 'training' && !s.companies.some(c => c.bot)) {
    const bot = openingWorld(s, ['Shared benchmark']).companies[0];
    Object.assign(bot, { id: 'benchmark', bot: 'benchmark' });
    s.companies.push(bot);
  }
}
function openingWorld(s, names, seed = s.seed) {
  return createSession({ productId: s.productId, seed, companyNames: names, ...s.accounting });
}

function teamWorld(s, companyId, index) {
  const team = s.companies.find(c => c.id === companyId && !c.bot);
  if (!team) fail('Choose a student company.', 403);
  const ordinal = s.companies.indexOf(team), phase = s.course.plan[index];
  const seed = (s.seed + Math.imul(ordinal + 1, 2654435761) + index * 1717) >>> 0;
  const world = openingWorld(s, [team.name, 'Practice opponent'], seed);
  world.id = s.id; world.name = s.name; world.endHour = phase.hours;
  world.companies[0].id = companyId;
  Object.assign(world.companies[1], { id: 'opponent-' + companyId, bot: 'practice', profile: s.course.policy?.profiles[ordinal] ?? seed % 9 });
  world.catalog = structuredClone(s.catalog);
  world.effects = { ...s.effects };
  applyConditions(world, phase.id);
  return world;
}

function teamEnd(s) {
  let end = s.course.index;
  while (s.course.plan[end]?.mode === 'team') end++;
  return end;
}

export function laneView(s, companyId) {
  if (s.course?.plan[s.course.index]?.mode !== 'team' || !s.companies.some(c => c.id === companyId && !c.bot)) return null;
  const lane = s.course.lanes[companyId] || { index: s.course.index, start: 0, world: teamWorld(s, companyId, s.course.index) };
  return { ...lane, waiting: lane.index >= teamEnd(s) };
}

function score(s, phase, team, partial = false) {
  return { phase: phase.id, companyId: team.id, name: team.name, hour: s.hour, profit: profit(team), received: team.received, emissions: team.emissions, partial };
}

export function finishBlock(s) {
  const course = s.course, end = teamEnd(s);
  if (end === course.index) fail('The shared clock controls this phase.');
  for (const [id, lane] of Object.entries(course.lanes)) {
    if (lane.index < end) course.results.push(score(lane.world, course.plan[lane.index], lane.world.companies.find(c => c.id === id), true));
  }
  for (const [index, ref] of Object.entries(course.references || {})) {
    course.results.push(score(ref.world, course.plan[index], ref.world.companies[0], true));
    delete course.references[index];
  }
  // Retain the final team worlds for read-only review in an entirely asynchronous session.
  if (end < course.plan.length) course.lanes = {};
  course.index = end;
  enterPhase(s);
}

function recordBenchmarkHour(s, index, phaseHour, world) {
  const course = s.course;
  course.references ||= {};
  let reference = course.references[index];
  if (!reference) {
    const shared = openingWorld(s, ['Shared benchmark'], (s.seed + index) >>> 0);
    shared.catalog = structuredClone(world.catalog); shared.effects = { ...world.effects };
    shared.endHour = course.plan[index].hours;
    Object.assign(shared.companies[0], { id: 'benchmark', bot: 'benchmark' });
    reference = course.references[index] = { world: shared, pending: {} };
  }
  const team = world.companies[0], group = reference.pending[phaseHour] ||= {};
  group[team.id] = quoteScores(world, team);
  const shared = reference.world, teams = s.companies.filter(c => !c.bot);
  while (shared.hour < shared.endHour) {
    const next = shared.hour + 1, quotes = reference.pending[next];
    if (!quotes || !teams.every(c => quotes[c.id])) break;
    shared.referenceQuotes = teams.map(c => ({id:c.id, scores:quotes[c.id]}));
    shared.features = s.features;
    advance(shared, 1);
    delete shared.referenceQuotes; delete reference.pending[next];
  }
  if (shared.hour === shared.endHour) {
    course.results.push(score(shared, course.plan[index], shared.companies[0]));
    delete course.references[index];
  }
}

export function teamDecision(s, actor, a, at, options) {
  const lane = laneView(s, actor.companyId);
  if (!lane || lane.waiting || s.status === 'completed') fail('This phase is complete.', 409);
  const world = lane.world, phase = s.course.plan[lane.index];
  world.features = s.features;
  let message;
  if (a.type === 'teamStep') {
    const hours = integer(a.hours, 'Team clock hours', 1, 24);
    const count = Math.min(hours, world.endHour - world.hour);
    if (s.course.benchmark && phase.id !== 'training') {
      for (let i = 0; i < count; i++) {
        recordBenchmarkHour(s, lane.index, world.hour - (lane.start || 0) + 1, world);
        advance(world, 1);
      }
    } else advance(world, count);
    message = 'Team clock advanced to hour ' + world.hour + '.';
  } else message = applyCommand(world, actor, a, at, options);
  s.course.lanes[actor.companyId] = { index: lane.index, start: lane.start || 0, world };
  if (world.hour >= world.endHour) {
    for (const c of world.companies) s.course.results.push({ ...score(world, phase, c), teamId: actor.companyId });
    const index = lane.index + 1, end = teamEnd(s);
    let next = world, start = lane.start || 0;
    if (index < end) {
      if (phase.id === 'training') { next = teamWorld(s, actor.companyId, index); start = 0; }
      else {
        start = world.hour;
        world.status = 'paused'; world.endHour = start + s.course.plan[index].hours;
        applyConditions(world, s.course.plan[index].id);
      }
    }
    s.course.lanes[actor.companyId] = { index, start, world: next };
    if (s.companies.filter(c => !c.bot).every(c => s.course.lanes[c.id]?.index === end)) finishBlock(s);
  }
  const stored = s.course.lanes[actor.companyId];
  if (stored) stored.version = s.revision + 1;
  return message;
}

export function sharedHourFinished(s) {
  const course = s.course;
  if (!course) return;
  const phase = course.plan[course.index];
  if (++course.elapsed < phase.hours) return;
  for (const team of s.companies) course.results.push(score(s, phase, team));
  course.index++;
  enterPhase(s);
}

export function courseView(s, actor, teamId, lane) {
  const course = s.course;
  if (!course) return null;
  const instructor = actor.role === 'instructor';
  return { plan: course.plan, index: lane ? Math.min(lane.index, teamEnd(s) - 1) : Math.min(course.index, course.plan.length - 1),
    teamVersion: lane && actor.role === 'student' ? teamVersions(s)[teamId] : undefined,
    elapsed: lane ? lane.world.hour - (lane.start || 0) : course.elapsed, waiting: !!lane?.waiting, benchmark: course.benchmark,
    practice: lane ? lane.world.companies.map(c => ({name:c.name, profit:profit(c), received:c.received})) : undefined,
    model: course.policy?.model,
    reference: Object.entries(course.references || {}).map(([index, ref]) => ({ phase: course.plan[index].id, hour: ref.world.hour, profit: profit(ref.world.companies[0]) })),
    results: instructor ? course.results : course.results.filter(r => (r.teamId ?? r.companyId) === teamId || r.companyId === 'benchmark'),
    progress: instructor ? s.companies.filter(c => !c.bot).map(c => ({ name: c.name, index: course.lanes[c.id]?.index ?? course.index, hour: (course.lanes[c.id]?.world.hour ?? 0) - (course.lanes[c.id]?.start || 0) })) : undefined };
}
