export function getFunctions() { return { __stub: 'functions' } }
export function httpsCallable(_f, name) {
  return async () => { throw new Error(`stub: callable ${name} is not available in the harness`) }
}
