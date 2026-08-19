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
 *  (see lib/appOrigin.ts), never for reaching the API. */

import { stringifyJsonDangerous } from "../../../../lib/json"
import { loadUserDefaultThemeId, saveUserDefaultThemeId } from "../storage"
import type {
	Dataset,
	EmbedInstance,
	Folder,
	SavedTheme,
	Visual,
} from "../types"
import type { StorageContentAdapter } from "./adapter"

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
	}

	const putJson = (collection: string) => (id: string, serialized: string) =>
		request("PUT", collection, id, serialized, JSON_HEADERS)
	const deleteFrom = (collection: string) => (id: string) =>
		request("DELETE", collection, id)

	return {
		capabilities: { remoteLoad: true },

		loadVisuals: async () => {
			const visuals = await loadCollection<Visual[]>("visuals")
			setBaseline(baselines.visuals, toMap(visuals))
			return visuals
		},
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

		loadDatasets: async () => {
			const datasets = await loadCollection<Record<string, Dataset>>("datasets")
			setBaseline(baselines.datasets, recordToMap(datasets))
			return datasets
		},
		saveDatasets: (datasets) =>
			syncCollection(
				baselines.datasets,
				recordToMap(datasets),
				async (id, serialized) => {
					const { body, headers } = await datasetBody(serialized)
					await request("PUT", "datasets", id, body, headers)
				},
				deleteFrom("datasets")
			),

		loadEmbedInstances: async () => {
			const instances =
				await loadCollection<Record<string, EmbedInstance>>("embed-instances")
			setBaseline(baselines.embedInstances, recordToMap(instances))
			return instances
		},
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
			const themes = await loadCollection<SavedTheme[]>("themes")
			setBaseline(baselines.themes, toMap(themes))
			return themes.length === 0 ? null : themes
		},
		saveThemes: (themes) =>
			syncCollection(
				baselines.themes,
				toMap(themes),
				putJson("themes"),
				deleteFrom("themes")
			),

		// Per-person preference on a server with no notion of persons — stays
		// device-local (decided at design sign-off, 2026-08-19).
		loadUserDefaultThemeId: async () => loadUserDefaultThemeId(),
		saveUserDefaultThemeId: async (id) => {
			saveUserDefaultThemeId(id)
		},
	}
}
