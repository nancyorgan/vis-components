/** Ephemeral device-local storage — the published-embed runtime's rule-6
 *  guarantee ("loading an embed writes nothing durable to the viewer's
 *  browser").
 *
 *  When enabled, EVERY device-local localStorage read/write is redirected to
 *  one in-memory map: the `safe*` helpers in `../storage.ts` and the
 *  versioned-entity reader/writer in `./versioning.ts` both consult this
 *  module before touching the real `localStorage`. It is a Storage-shaped
 *  wrapper (not a bare Map) so the versioning module's `storage` injection
 *  point takes it unchanged.
 *
 *  Enabled once, before any atom reads storage; deliberately no way back. */

let ephemeral: Storage | null = null

const storageOverMap = (): Storage => {
	const map = new Map<string, string>()
	return {
		get length() {
			return map.size
		},
		clear: () => map.clear(),
		getItem: (key) => map.get(key) ?? null,
		key: (index) => [...map.keys()][index] ?? null,
		removeItem: (key) => {
			map.delete(key)
		},
		setItem: (key, value) => {
			map.set(key, value)
		},
	}
}

/** Redirect ALL device-local persistence to memory. */
export const enableEphemeralStorage = (): void => {
	ephemeral = storageOverMap()
}

/** The in-memory Storage when ephemeral mode is on, null otherwise. */
export const ephemeralStorage = (): Storage | null => ephemeral
