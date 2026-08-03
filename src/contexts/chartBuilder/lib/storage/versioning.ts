import { stringifyJsonDangerous } from "../../../../lib/json"

/** Generic storage versioning for localStorage-backed entities.
 *
 *  Every persisted entity in vis-components is at risk of breaking when its
 *  TypeScript shape changes. We address that here in a uniform way: each
 *  entity declares a `currentVersion` and an array of `migrations` (one per
 *  version bump). Migration N upgrades a value stored at version N into a
 *  value at version N+1. On load we read the stored `_v`, run any
 *  outstanding migrations in sequence, and rewrite the upgraded shape so
 *  the next load is fast.
 *
 *  Wire format: `{ _v: number, data: T }`. Any localStorage value that
 *  lacks `_v` and `data` is treated as the pre-versioning shape (v0).
 *  That's how the rollout works without breaking the user's existing
 *  saved state — the v0 → v1 migration is the first entry in each
 *  entity's array. */

export type Migration<From = unknown, To = unknown> = (raw: From) => To

type Versioned<T> = { _v: number; data: T }

const isVersioned = (parsed: unknown): parsed is Versioned<unknown> =>
	typeof parsed === "object" &&
	parsed !== null &&
	"_v" in parsed &&
	"data" in parsed &&
	typeof (parsed as { _v: unknown })._v === "number"

/** A logger callable so tests can capture diagnostic output without
 *  asserting on `console.error` calls. */
type Logger = {
	warn: (msg: string, extra?: unknown) => void
	error: (msg: string, extra?: unknown) => void
}
const defaultLogger: Logger = {
	// eslint-disable-next-line no-console
	warn: (msg, extra) => console.warn(`[storage] ${msg}`, extra ?? ""),
	// eslint-disable-next-line no-console
	error: (msg, extra) => console.error(`[storage] ${msg}`, extra ?? ""),
}

/** Migrate an already-parsed value forward to `currentVersion`.
 *
 * Shared by `loadVersioned` (localStorage, value comes from `JSON.parse`) and
 * by IndexedDB-backed loaders (value comes straight from a structured clone).
 * `parsed` is either the `{ _v, data }` wrapper or a bare legacy (v0) value.
 * Returns `fallback` on any failure (unknown future version, missing
 * migration, a migration that throws, failed validation). Does NOT persist the
 * upgraded shape — callers decide whether/where to write it back. */
export const migrateVersioned = <T>(
	parsed: unknown,
	currentVersion: number,
	migrations: Migration[],
	fallback: T,
	logger: Logger = defaultLogger,
	validate?: (data: unknown) => data is T,
	label = "value"
): T => {
	let value: unknown
	let version: number
	if (isVersioned(parsed)) {
		value = parsed.data
		version = parsed._v
	} else {
		// Unversioned legacy shape — treat as v0 and migrate forward.
		value = parsed
		version = 0
	}
	if (version > currentVersion) {
		logger.warn(
			`"${label}" stored at v${version} but current is v${currentVersion} — falling back to default`
		)
		return fallback
	}
	for (let v = version; v < currentVersion; v++) {
		const step = migrations[v]
		if (!step) {
			logger.error(
				`"${label}" claims currentVersion=${currentVersion} but migrations.length=${migrations.length} — falling back`
			)
			return fallback
		}
		try {
			value = step(value)
		} catch (error) {
			logger.error(
				`migration "${label}" v${v} -> v${v + 1} threw — falling back`,
				error
			)
			return fallback
		}
	}
	if (validate && !validate(value)) {
		logger.warn(
			`"${label}" migrated value failed validation — falling back to default`
		)
		return fallback
	}
	return value as T
}

export type LoadVersionedArgs<T> = {
	key: string
	currentVersion: number
	migrations: Migration[]
	fallback: T
	/** Optional shape check after migrations run. Returning `false` means
	 *  the migrated value is unsafe — we'll fall back to `fallback`
	 *  rather than hand untyped garbage to the rest of the app. */
	validate?: (data: unknown) => data is T
	/** Storage and logger injection for tests. */
	storage?: Storage
	logger?: Logger
}

/** Read a versioned entity. Migrates older values forward to
 *  `currentVersion` and rewrites the upgraded shape so subsequent reads
 *  skip the migration step. Returns `fallback` on any failure (parse,
 *  unknown future version, failed validation, storage exception). */
export const loadVersioned = <T>({
	key,
	currentVersion,
	migrations,
	fallback,
	validate,
	storage,
	logger = defaultLogger,
}: LoadVersionedArgs<T>): T => {
	const store = storage ?? safeStorage()
	if (store === null) return fallback
	let raw: string | null
	try {
		raw = store.getItem(key)
	} catch (error) {
		logger.error(`getItem("${key}") threw`, error)
		return fallback
	}
	if (raw === null) return fallback
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch (error) {
		logger.error(`JSON.parse("${key}") threw — falling back`, error)
		return fallback
	}
	const storedVersion = isVersioned(parsed) ? parsed._v : 0
	const value = migrateVersioned(
		parsed,
		currentVersion,
		migrations,
		fallback,
		logger,
		validate,
		key
	)
	// If we migrated forward and didn't fall back, persist the upgraded shape
	// so the next load is O(1). Best-effort — failing to write back isn't fatal.
	if (storedVersion < currentVersion && value !== fallback) {
		saveVersioned({
			key,
			currentVersion,
			data: value as T,
			storage: store,
			logger,
		})
	}
	return value as T
}

export type SaveVersionedArgs<T> = {
	key: string
	currentVersion: number
	data: T
	storage?: Storage
	logger?: Logger
}

export const saveVersioned = <T>({
	key,
	currentVersion,
	data,
	storage,
	logger = defaultLogger,
}: SaveVersionedArgs<T>): void => {
	const store = storage ?? safeStorage()
	if (store === null) return
	const wrapped: Versioned<T> = { _v: currentVersion, data }
	try {
		store.setItem(key, stringifyJsonDangerous(wrapped as never))
	} catch (error) {
		logger.error(`setItem("${key}") threw`, error)
	}
}

/** Returns the global `localStorage` or `null` when unavailable (SSR,
 *  privacy modes that disable storage, etc). Centralizing the access
 *  here keeps the rest of the module pure-ish and easy to test. */
const safeStorage = (): Storage | null => {
	try {
		// eslint-disable-next-line no-restricted-globals
		return typeof localStorage === "undefined" ? null : localStorage
	} catch {
		return null
	}
}
