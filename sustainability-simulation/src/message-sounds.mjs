// Original, quiet synthesized cues; no recordings or third-party audio assets.
export function createMessageSounds({ storage = globalThis.localStorage, AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext, now = Date.now } = {}) {
  let enabled = true, context = null, scope = null, seen = new Set(), lastReceiveAt = -Infinity;
  try { enabled = storage?.getItem('studio-message-sounds') !== 'off'; } catch {}
  function arm() {
    if (!enabled || !AudioContext) return;
    try {
      context ||= new AudioContext();
      if (context.state === 'suspended') void context.resume().catch(() => {});
    } catch { /* Audio support must never block messaging. */ }
  }
  function play(kind) {
    if (!enabled || context?.state !== 'running') return false;
    if (kind === 'received' && now() - lastReceiveAt < 750) return false;
    try {
      const start = context.currentTime;
      const notes = kind === 'sent' ? [[540, 900, 0, .12]] : [[880, 880, 0, .17], [1174.66, 1174.66, .09, .19]];
      for (const [from, to, delay, duration] of notes) {
        const oscillator = context.createOscillator(), gain = context.createGain(), at = start + delay;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(from, at);
        oscillator.frequency.exponentialRampToValueAtTime(to, at + duration);
        gain.gain.setValueAtTime(.0001, at);
        gain.gain.exponentialRampToValueAtTime(.035, at + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(at); oscillator.stop(at + duration + .02);
      }
      if (kind === 'received') lastReceiveAt = now();
      return true;
    } catch { return false; }
  }
  function observe(nextScope, messages, actorId) {
    const ids = (messages || []).map(message => message.id).filter(Boolean);
    if (scope !== nextScope) { scope = nextScope; seen = new Set(ids); return; }
    const incoming = (messages || []).some(message => message.id && !seen.has(message.id) && message.senderId !== actorId);
    ids.forEach(id => seen.add(id));
    if (incoming) play('received');
  }
  return {
    get enabled() { return enabled; }, arm, play, observe,
    reset() { scope = null; seen.clear(); },
    setEnabled(value) {
      enabled = !!value;
      try { storage?.setItem('studio-message-sounds', enabled ? 'on' : 'off'); } catch {}
      if (enabled) arm();
      else if (context?.state === 'running') { try { void context.suspend().catch(() => {}); } catch {} }
    }
  };
}
