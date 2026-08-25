/** HTTP storage adapter for server mode (the self-host server).
 *
 *  The `StorageContentAdapter` contract is whole-collection save — exactly
 *  right for the single-user local build, but on a shared backend a stale
 *  whole-collection write from one user would clobber another's items. This
 *  adapter closes that gap WITHOUT touching the contract or the atoms: it
 *  remembers a baseline (id → serialized item) from its last load/save and
 *  turns each whole-collection save into per-item requests —
 *
 *      changed or new vs baseline → PUT    /api/<collection>/<id>
 *      in baseline, absent now    → DELETE /api/<collection>/<id>
 *
 *  so a save only ever transmits what this session actually changed.
 *  Semantics are item-level last-write-wins (no accounts, no locks). Known
 *  residual, accepted for v1: if another user deletes an item this session
 *  still holds and this session then edits it, the PUT resurrects it.
 *
 *  All requests are same-origin relative — the server that served the page
 *  is the API. The configured base URL is for outward-facing links only
 *  (see lib/appOrigin.ts), never for reaching the API.
 *
 *  CONTENT MIGRATIONS. The localStorage path gets these for free: every key
 *  holds a `{_v,data}` envelope and `loadVersioned` walks it forward. A
 *  backend stores bare items, so this adapter carries the version out of band
 *  — `/api/content-versions` holds one number per collection — and applies
 *  `CONTENT_MIGRATIONS` on load, persisting the upgrade once. That is what
 *  lets an app update reshape visuals that are already sitting on a server.
 *  Two refusals are deliberate: data stamped NEWER than this build, and a
 *  migration that throws, both fail the load rather than write something
 *  half-migrated over the user's work. */

import { stringifyJsonDangerous } from "../../../../lib/json"
import { loadUserDefaultThemeId, saveUserDefaultThemeId } from "../storage"
import type { UserFont } from "../fontLibrary"
import type {
	Dataset,
	EmbedInstance,
	Folder,
	SavedTheme,
	Visual,
} from "../types"
import type { StorageContentAdapter } from "./adapter"
import { CONTENT_MIGRATIONS } from "./migrations"
import { migrateVersioned } from "./versioning"

type Baseline = Map<string, string>

const serialize = (value: unknown): string =>
	stringifyJsonDangerous(value as never)

const request = async (
	method: "PUT" | "DELETE",
	collection: string,
	id: string,
	body?: BodyInit,
	headers?: Record<string, string>
): Promise<void> => {
	const response = await fetch(
		`/api/${collection}/${encodeURIComponent(id)}`,
		{ method, body, headers }
	)
	if (!response.ok) {
		throw new Error(`${method} /api/${collection}/${id} failed: ${response.status}`)
	}
}

const loadCollection = async <T>(collection: string): Promise<T> => {
	const response = await fetch(`/api/${collection}`)
	if (!response.ok) {
		throw new Error(`GET /api/${collection} failed: ${response.status}`)
	}
	return (await response.json()) as T
}

/** Diff `next` against `baseline` and issue per-item requests. Successful
 *  requests update the baseline immediately (so a partial failure retries
 *  only what actually failed on the next save); the first failure is
 *  rethrown after everything settles. */
const syncCollection = async (
	baseline: Baseline,
	next: Map<string, string>,
	putOne: (id: string, serialized: string) => Promise<void>,
	deleteOne: (id: string) => Promise<void>
): Promise<void> => {
	const ops: Promise<void>[] = []
	for (const [id, serialized] of next) {
		if (baseline.get(id) === serialized) continue
		ops.push(
			putOne(id, serialized).then(() => {
				baseline.set(id, serialized)
			})
		)
	}
	for (const id of baseline.keys()) {
		if (next.has(id)) continue
		ops.push(
			deleteOne(id).then(() => {
				baseline.delete(id)
			})
		)
	}
	const results = await Promise.allSettled(ops)
	const failure = results.find((r) => r.status === "rejected")
	if (failure) throw (failure as PromiseRejectedResult).reason
}

const toMap = (items: { id: string }[]): Map<string, string> =>
	new Map(items.map((item) => [item.id, serialize(item)]))

const recordToMap = (record: Record<string, unknown>): Map<string, string> =>
	new Map(Object.entries(record).map(([id, item]) => [id, serialize(item)]))

const setBaseline = (baseline: Baseline, entries: Map<string, string>): void => {
	baseline.clear()
	for (const [id, serialized] of entries) baseline.set(id, serialized)
}

const JSON_HEADERS = { "content-type": "application/json" }

/** Every stamped content version, or `{}` when the server has none — which
 *  covers both a brand-new server and one older than this bundle (the route
 *  404s). `upgraded` treats both the same way. */
const fetchContentVersions = async (): Promise<Record<string, number>> => {
	const response = await fetch("/api/content-versions")
	if (response.status === 404) return {}
	if (!response.ok) {
		throw new Error(`GET /api/content-versions failed: ${response.status}`)
	}
	return (await response.json()) as Record<string, number>
}

/** Gzip a dataset body client-side when the platform can (every current
 *  browser); the server tolerates identity bodies and compresses them
 *  itself, so environments without CompressionStream still work. */
const datasetBody = async (
	serialized: string
): Promise<{ body: BodyInit; headers: Record<string, string> }> => {
	if (typeof CompressionStream === "undefined") {
		return { body: serialized, headers: JSON_HEADERS }
	}
	const compressed = new Blob([serialized])
		.stream()
		.pipeThrough(new CompressionStream("gzip"))
	const blob = await new Response(compressed).blob()
	return {
		body: blob,
		headers: { ...JSON_HEADERS, "content-encoding": "gzip" },
	}
}

export const createHttpStorageAdapter = (): StorageContentAdapter => {
	const baselines = {
		visuals: new Map<string, string>(),
		folders: new Map<string, string>(),
		datasets: new Map<string, string>(),
		embedInstances: new Map<string, string>(),
		themes: new Map<string, string>(),
		fonts: new Map<string, string>(),
	}

	const putJson = (collection: string) => (id: string, serialized: string) =>
		request("PUT", collection, id, serialized, JSON_HEADERS)
	const deleteFrom = (collection: string) => (id: string) =>
		request("DELETE", collection, id)
	const putDataset = async (id: string, serialized: string): Promise<void> => {
		const { body, headers } = await datasetBody(serialized)
		await request("PUT", "datasets", id, body, headers)
	}

	// One fetch per session, shared by every collection's load.
	let versionsCache: Promise<Record<string, number>> | null = null
	const contentVersions = (): Promise<Record<string, number>> =>
		(versionsCache ??= fetchContentVersions())

	const stampVersion = async (
		collection: string,
		version: number
	): Promise<void> => {
		try {
			await request(
				"PUT",
				"content-versions",
				collection,
				serialize({ v: version }),
				JSON_HEADERS
			)
			;(await contentVersions())[collection] = version
		} catch (error) {
			// Non-fatal: the items in hand are correct either way. Failing to
			// stamp just means the next session re-derives the same answer.
			// eslint-disable-next-line no-console
			console.warn(
				`[vis-components] could not stamp content version for ${collection}`,
				error
			)
		}
	}

	/** Record the server state as the diff baseline, then bring the collection
	 *  forward to this build's content schema — persisting the upgrade so the
	 *  work happens once per server, not once per page load. */
	const upgraded = async <T>({
		collection,
		raw,
		baseline,
		entries,
		putOne,
		deleteOne,
	}: {
		collection: string
		raw: T
		baseline: Baseline
		entries: (value: T) => Map<string, string>
		putOne: (id: string, serialized: string) => Promise<void>
		deleteOne: (id: string) => Promise<void>
	}): Promise<T> => {
		setBaseline(baseline, entries(raw))
		const spec = CONTENT_MIGRATIONS[collection]
		if (!spec) return raw
		const stored = (await contentVersions())[collection]

		// No stamp. The only servers in that state hold rows written by a build
		// at the CURRENT shape, so adopt it. Reading an absent stamp as v0 (the
		// meaning localStorage gives it, where absent really does mean
		// pre-versioning) would re-run every migration over already-current
		// data — the px→pt font reset would fire a second time and visibly
		// wreck every saved visual.
		if (stored === undefined) {
			await stampVersion(collection, spec.currentVersion)
			return raw
		}

		// Written by a newer build than this one. Migrations only run forward,
		// and saving back what an old build made of a new shape would drop
		// whatever the new shape added — so refuse, the way the server itself
		// refuses to start on a future DB schema.
		if (stored > spec.currentVersion) {
			throw new Error(
				`Server "${collection}" is at content version ${stored}, but this ` +
					`build only understands ${spec.currentVersion}. Refusing to load ` +
					`rather than risk overwriting newer data — reload to pick up the ` +
					`newer build.`
			)
		}
		if (stored === spec.currentVersion) return raw

		// `migrateVersioned` signals failure by returning the fallback it was
		// given, so hand it an identity no real value can collide with. Never
		// dereferenced — only compared.
		const failed = {} as T
		const next = migrateVersioned<T>(
			{ _v: stored, data: raw },
			spec.currentVersion,
			spec.migrations,
			failed,
			undefined,
			undefined,
			collection
		)
		if (next === failed) {
			throw new Error(
				`Migrating server "${collection}" from content version ${stored} to ` +
					`${spec.currentVersion} failed. Refusing to load rather than write ` +
					`a half-migrated collection.`
			)
		}
		// Baseline is still the pre-migration server state, so this diff is
		// exactly the items the migration actually changed.
		await syncCollection(baseline, entries(next), putOne, deleteOne)
		await stampVersion(collection, spec.currentVersion)
		return next
	}

	return {
		capabilities: { remoteLoad: true },

		loadVisuals: async () =>
			upgraded({
				collection: "visuals",
				raw: await loadCollection<Visual[]>("visuals"),
				baseline: baselines.visuals,
				entries: toMap,
				putOne: putJson("visuals"),
				deleteOne: deleteFrom("visuals"),
			}),
		// Server-mode visuals arrive with thumbnails inline (loadVisuals), and
		// the atoms skip the local IndexedDB thumbnail merge under remoteLoad —
		// this read exists only to satisfy the interface.
		loadThumbnails: async () => ({}),
		saveVisuals: (visuals) =>
			syncCollection(
				baselines.visuals,
				toMap(visuals),
				putJson("visuals"),
				deleteFrom("visuals")
			),

		// Folders are the one collection the frontend never versioned (see
		// CONTENT_MIGRATIONS) — nothing to migrate, so no upgrade pass.
		loadFolders: async () => {
			const folders = await loadCollection<Folder[]>("folders")
			setBaseline(baselines.folders, toMap(folders))
			return folders
		},
		saveFolders: (folders) =>
			syncCollection(
				baselines.folders,
				toMap(folders),
				putJson("folders"),
				deleteFrom("folders")
			),

		loadDatasets: async () =>
			upgraded({
				collection: "datasets",
				raw: await loadCollection<Record<string, Dataset>>("datasets"),
				baseline: baselines.datasets,
				entries: recordToMap,
				putOne: putDataset,
				deleteOne: deleteFrom("datasets"),
			}),
		saveDatasets: (datasets) =>
			syncCollection(
				baselines.datasets,
				recordToMap(datasets),
				putDataset,
				deleteFrom("datasets")
			),

		loadEmbedInstances: async () =>
			upgraded({
				collection: "embed-instances",
				raw: await loadCollection<Record<string, EmbedInstance>>(
					"embed-instances"
				),
				baseline: baselines.embedInstances,
				entries: recordToMap,
				putOne: putJson("embed-instances"),
				deleteOne: deleteFrom("embed-instances"),
			}),
		saveEmbedInstances: (instances) =>
			syncCollection(
				baselines.embedInstances,
				recordToMap(instances),
				putJson("embed-instances"),
				deleteFrom("embed-instances")
			),

		// An empty server means "no themes saved yet", which the themes atom
		// maps to its local first-run seeding — mirroring loadThemes()'s null.
		loadThemes: async () => {
			const themes = await upgraded({
				collection: "themes",
				raw: await loadCollection<SavedTheme[]>("themes"),
				baseline: baselines.themes,
				entries: toMap,
				putOne: putJson("themes"),
				deleteOne: deleteFrom("themes"),
			})
			return themes.length === 0 ? null : themes
		},
		saveThemes: (themes) =>
			syncCollection(
				baselines.themes,
				toMap(themes),
				putJson("themes"),
				deleteFrom("themes")
			),

		loadUserFonts: async () =>
			upgraded({
				collection: "fonts",
				raw: await loadCollection<UserFont[]>("fonts"),
				baseline: baselines.fonts,
				entries: toMap,
				putOne: putJson("fonts"),
				deleteOne: deleteFrom("fonts"),
			}),
		saveUserFonts: (fonts) =>
			syncCollection(
				baselines.fonts,
				toMap(fonts),
				putJson("fonts"),
				deleteFrom("fonts")
			),

		// Per-person preference on a server with no notion of persons — stays
		// device-local (decided at design sign-off, 2026-08-19).
		loadUserDefaultThemeId: async () => loadUserDefaultThemeId(),
		saveUserDefaultThemeId: async (id) => {
			saveUserDefaultThemeId(id)
		},
	}
}
