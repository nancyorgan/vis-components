/** An in-memory `Storage` stand-in for tests.
 *
 *  happy-dom ships a real `localStorage`, but it persists for the lifetime of
 *  the test file's environment and several store modules read it during
 *  module init. Tests that mount the persist-effect-backed atoms therefore
 *  need (a) a guaranteed-empty store and (b) a handle on the backing map so
 *  they can seed the persisted keys BEFORE the component reads them.
 *
 *  `installInMemoryLocalStorage()` defines a fresh fake on both `window` and
 *  `globalThis` (some modules close over one, some the other) and returns the
 *  backing `Map`. Callers that only want isolation can ignore the return.
 *
 *  `src/testSupport/vitest.setup.ts` installs one per test file, so every test
 *  starts on an in-memory store; call this directly whenever you need a fresh
 *  store mid-file or need the `Map` handle to seed keys. */
export const installInMemoryLocalStorage = (): Map<string, string> => {
	const store = new Map<string, string>()
	const fakeStorage: Storage = {
		get length() {
			return store.size
		},
		clear: () => store.clear(),
		// `setItem` coerces to string, so a present key never holds
		// `undefined` — `?? null` is exactly the `has() ? get() : null` the
		// per-file copies spelled out, minus the non-null assertion.
		getItem: (k) => store.get(k) ?? null,
		key: (i) => [...store.keys()][i] ?? null,
		removeItem: (k) => {
			store.delete(k)
		},
		setItem: (k, v) => {
			store.set(k, String(v))
		},
	}
	for (const target of [window, globalThis]) {
		Object.defineProperty(target, "localStorage", {
			value: fakeStorage,
			writable: true,
			configurable: true,
		})
	}
	return store
}
