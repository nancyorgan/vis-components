/** Minimal promise-based key/value wrapper over IndexedDB.
 *
 * Why this exists: datasets (parsed CSV rows) can be large, and `localStorage`
 * is a single ~5 MB origin-wide bucket shared with every other persisted
 * entity (visuals, thumbnails, configs…). A dataset that pushes the total over
 * quota fails to write — and `localStorage.setItem` does so by throwing, which
 * upstream code swallows, so the dataset silently never persists and is lost on
 * the next reload. IndexedDB has a far larger quota (typically hundreds of MB)
 * and stores structured clones directly (no JSON stringify/parse), so datasets
 * live here instead.
 *
 * Everything degrades gracefully: when IndexedDB is unavailable (SSR, the
 * happy-dom test environment, privacy modes) the calls resolve to a safe
 * no-op (`null` / `false`) rather than throwing, and callers fall back to the
 * synchronous `localStorage` bootstrap.
 */

const DB_NAME = "vis-components"
const STORE = "kv"
const DB_VERSION = 1

/** Hard off-switch: the published-embed runtime disables IndexedDB outright
 *  before boot — an embed must write NOTHING durable to the viewer's browser
 *  (0016 rule 6). Every helper below already degrades gracefully when IDB is
 *  unavailable, so flipping this makes them all safe no-ops. */
let idbDisabled = false

/** Disable IndexedDB for this document. Call once, before anything reads or
 *  writes; there is deliberately no way back. */
export const disableIdb = (): void => {
	idbDisabled = true
}

/** True when IndexedDB is usable in this environment. */
export const idbAvailable = (): boolean => {
	if (idbDisabled) return false
	try {
		// eslint-disable-next-line no-restricted-globals
		return typeof indexedDB !== "undefined" && indexedDB !== null
	} catch {
		return false
	}
}

let dbPromise: Promise<IDBDatabase> | null = null

const openDB = (): Promise<IDBDatabase> => {
	if (dbPromise) return dbPromise
	dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		// eslint-disable-next-line no-restricted-globals
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
	// If the open fails, clear the cached promise so a later call can retry.
	dbPromise.catch(() => {
		dbPromise = null
	})
	return dbPromise
}

/** Read a value by key. Resolves `null` when the key is absent or IndexedDB
 * is unavailable / errors. */
export const idbGet = async <T>(key: string): Promise<T | null> => {
	if (!idbAvailable()) return null
	try {
		const db = await openDB()
		return await new Promise<T | null>((resolve, reject) => {
			const tx = db.transaction(STORE, "readonly")
			const req = tx.objectStore(STORE).get(key)
			req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
			req.onerror = () => reject(req.error)
		})
	} catch {
		return null
	}
}

export type IdbReadResult<T> = { ok: true; value: T | null } | { ok: false }

/** Like {@link idbGet}, but tells a failed read apart from a truly absent
 * key. Any caller that WRITES based on what it read must use this one:
 * `idbGet` collapses "the read errored" into "the key is absent", and a
 * read-modify-write that mistakes the first for the second persists a record
 * with the unread data missing — which is how a transient read error once
 * emptied the dataset index. `ok: false` also covers IndexedDB being
 * unavailable, where nothing here can vouch for what is stored. */
export const idbGetChecked = async <T>(
	key: string
): Promise<IdbReadResult<T>> => {
	if (!idbAvailable()) return { ok: false }
	try {
		const db = await openDB()
		return await new Promise<IdbReadResult<T>>((resolve, reject) => {
			const tx = db.transaction(STORE, "readonly")
			const req = tx.objectStore(STORE).get(key)
			req.onsuccess = () =>
				resolve({ ok: true, value: (req.result as T | undefined) ?? null })
			req.onerror = () => reject(req.error)
		})
	} catch {
		return { ok: false }
	}
}

/** Write a value by key. Resolves `true` on success, `false` when IndexedDB is
 * unavailable or the write fails (so callers can avoid destructive follow-ups
 * like clearing the legacy localStorage copy). */
export const idbSet = async (key: string, value: unknown): Promise<boolean> => {
	if (!idbAvailable()) return false
	try {
		const db = await openDB()
		return await new Promise<boolean>((resolve) => {
			const tx = db.transaction(STORE, "readwrite")
			tx.objectStore(STORE).put(value, key)
			tx.oncomplete = () => resolve(true)
			tx.onerror = () => resolve(false)
			tx.onabort = () => resolve(false)
		})
	} catch {
		return false
	}
}

/** Delete a value by key. Best-effort; never throws. */
export const idbDelete = async (key: string): Promise<void> => {
	if (!idbAvailable()) return
	try {
		const db = await openDB()
		await new Promise<void>((resolve) => {
			const tx = db.transaction(STORE, "readwrite")
			tx.objectStore(STORE).delete(key)
			tx.oncomplete = () => resolve()
			tx.onerror = () => resolve()
			tx.onabort = () => resolve()
		})
	} catch {
		// best-effort
	}
}
