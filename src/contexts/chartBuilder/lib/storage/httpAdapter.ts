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

import { isEmbedDocument } from "../../../../lib/embedPath"
import { stringifyJsonDangerous } from "../../../../lib/json"
import { datasetMetaFrom, isDatasetMeta } from "../datasetMeta"
import { loadUserDefaultThemeId, saveUserDefaultThemeId } from "../storage"
import type { UserFont } from "../fontLibrary"
import type {
	Dataset,
	DatasetMeta,
	EmbedInstance,
	Folder,
	SavedTheme,
	Visual,
} from "../types"
import type { StorageContentAdapter } from "./adapter"
import { CONTENT_MIGRATIONS } from "./migrations"
import { syncDatasetVersions } from "./syncDatasetVersions"
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
 *  rethrown after everything settles.
 *
 *  Without `deleteOne` this PUTs what changed and NOTHING else — no delete
 *  inference. That is the mode for collections whose in-memory copy is a
 *  subset of the store (datasets, whose bodies load on demand), where an
 *  absent id means "not loaded", never "deleted". */
const syncCollection = async (
	baseline: Baseline,
	next: Map<string, string>,
	putOne: (id: string, serialized: string) => Promise<void>,
	deleteOne?: (id: string) => Promise<void>
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
	if (deleteOne) {
		for (const id of baseline.keys()) {
			if (next.has(id)) continue
			ops.push(
				deleteOne(id).then(() => {
					baseline.delete(id)
				})
			)
		}
	}
	const results = await Promise.allSettled(ops)
	const failure = results.find((r) => r.status === "rejected")
	if (failure) throw (failure as PromiseRejectedResult).reason
}

/** Last-serialized object reference per id, per collection. Serializing is
 *  the expensive half of a diff — a dataset body can be hundreds of megabytes
 *  — and the atoms treat content immutably, so an unchanged reference is a
 *  sound proxy for an unchanged serialization. Without this, renaming one
 *  dataset re-stringifies the entire store just to discover that nothing else
 *  moved. */
const serializedCache = new WeakMap<object, string>()

const serializeCached = (item: unknown): string => {
	if (typeof item !== "object" || item === null) return serialize(item)
	const hit = serializedCache.get(item)
	if (hit !== undefined) return hit
	const text = serialize(item)
	serializedCache.set(item, text)
	return text
}

const toMap = (items: { id: string }[]): Map<string, string> =>
	new Map(items.map((item) => [item.id, serializeCached(item)]))

const recordToMap = (record: Record<string, unknown>): Map<string, string> =>
	new Map(Object.entries(record).map(([id, item]) => [id, serializeCached(item)]))

const setBaseline = (baseline: Baseline, entries: Map<string, string>): void => {
	baseline.clear()
	for (const [id, serialized] of entries) baseline.set(id, serialized)
}

const JSON_HEADERS = { "content-type": "application/json" }

/** Whether this document will ever render a thumbnail.
 *
 *  An embed is its own document — it shows one chart and never the library —
 *  so it has no use for a single base64 PNG, let alone every one of them.
 *  That covers user-facing embeds AND the hidden capture iframes the
 *  thumbnail pipeline boots, which are the heaviest repeat offenders. The
 *  route knowledge lives in `lib/embedPath` beside the route itself, not
 *  here — a rename can't silently change this adapter's payload shape.
 *
 *  Saving back a visual read this way is safe: the server distinguishes an
 *  absent `thumbnail` key ("leave the stored one alone") from an explicit
 *  null ("clear it"). */
const wantsThumbnails = (): boolean => !isEmbedDocument()

/** The ONE content-version stamp policy, shared by the eager path
 *  (`upgraded`) and the lazy gate (`ensureDatasetsCurrent`) so the two can
 *  never drift on a load-bearing invariant:
 *   - absent stamp → "adopt": the rows were written by a build at the
 *     CURRENT shape, so stamp it. NEVER v0 — reading absent as v0 would
 *     re-run every migration over already-current data.
 *   - stamped ahead → throw: written by a newer build; migrations only run
 *     forward, and saving back what an old build makes of a new shape drops
 *     whatever the new shape added.
 *   - stamped behind → "behind": migrate forward, once per server. */
const stampAction = (
	collection: string,
	stored: number | undefined,
	currentVersion: number
): "current" | "adopt" | "behind" => {
	if (stored === undefined) return "adopt"
	if (stored > currentVersion) {
		throw new Error(
			`Server "${collection}" is at content version ${stored}, but this ` +
				`build only understands ${currentVersion}. Refusing to load ` +
				`rather than risk overwriting newer data — reload to pick up the ` +
				`newer build.`
		)
	}
	return stored === currentVersion ? "current" : "behind"
}

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

/** Store one dataset's derived metadata. Sub-resource routes go through
 *  `request()` like everything else (the path prefix carries the parent id),
 *  so any future hardening of the shared helper covers these writes too. */
const putDatasetMeta = (id: string, meta: DatasetMeta): Promise<void> =>
	request(
		"PUT",
		`datasets/${encodeURIComponent(id)}`,
		"meta",
		serialize(meta),
		JSON_HEADERS
	)

const putDatasetVersion = async (
	datasetId: string,
	version: { id: string; rows: Array<Record<string, string>> }
): Promise<void> => {
	const { body, headers } = await datasetBody(serialize(version))
	await request(
		"PUT",
		`datasets/${encodeURIComponent(datasetId)}/versions`,
		version.id,
		body,
		headers
	)
}

/** Run `work` over `items` at most `limit` at a time. The hydration pass
 *  downloads full dataset bodies — unbounded parallelism would inflate the
 *  whole corpus at once, and strictly serial made the first post-deploy boot
 *  take the sum of every download. */
const boundedMap = async <T, R>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<R>
): Promise<R[]> => {
	const results: R[] = Array.from({ length: items.length })
	let nextIndex = 0
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (nextIndex < items.length) {
				const i = nextIndex++
				results[i] = await work(items[i] as T)
			}
		}
	)
	await Promise.all(workers)
	return results
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

	/** Version ids the server is known to hold per dataset, maintained from
	 *  every index load, hydration and save. This is what lets a save DELETE
	 *  the per-version bodies of versions the user removed — the upsert diff
	 *  can't infer them, and leaving them meant the server kept serving
	 *  deleted rows forever. */
	const knownVersionIds = new Map<string, Set<string>>()

	/** Last-written ROWS array per `<datasetId>:<versionId>`, held weakly.
	 *  The atoms treat datasets immutably, so an unchanged rows reference
	 *  means the stored body is current and the PUT can be skipped — keyed on
	 *  the rows rather than the version object so a metadata-only edit (a
	 *  version note) doesn't re-upload them — without pinning row arrays in
	 *  memory for the tab's life. A GC'd entry just re-PUTs. Maintained by
	 *  the shared `syncDatasetVersions`. */
	const writtenVersions = new Map<string, WeakRef<object>>()

	const putJson = (collection: string) => (id: string, serialized: string) =>
		request("PUT", collection, id, serialized, JSON_HEADERS)
	const deleteFrom = (collection: string) => (id: string) =>
		request("DELETE", collection, id)
	const putDataset = async (id: string, serialized: string): Promise<void> => {
		const { body, headers } = await datasetBody(serialized)
		// The header tells the server this client manages the per-version
		// bodies itself (the PUTs/DELETEs that follow this write). Without it —
		// a body PUT from the previous bundle during a rolling deploy — the
		// server purges the stored per-version rows, because they describe the
		// PREVIOUS body and would otherwise keep serving versions the write
		// may have removed.
		await request("PUT", "datasets", id, body, {
			...headers,
			"x-vis-versions-managed": "1",
		})
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

	/** The migration gate for every lazy dataset read.
	 *
	 *  The eager path got `CONTENT_MIGRATIONS`, the newer-than-this-build
	 *  refusal, and version stamping for free by flowing through `upgraded()`.
	 *  The lazy paths (index, per-version rows, single body) don't — so they
	 *  all await this first. Cheap in the steady state: the versions record is
	 *  fetched once per session, and matching stamps resolve immediately.
	 *  A behind-stamp triggers ONE full `loadDatasets()` pass — the same
	 *  migrate-and-write-back the eager path always did — and an ahead-stamp
	 *  refuses, exactly like `upgraded()`. Memoized; reset on failure so a
	 *  transient error doesn't wedge every later read. */
	let datasetsCurrentPromise: Promise<void> | null = null
	const ensureDatasetsCurrent = (): Promise<void> => {
		datasetsCurrentPromise ??= (async () => {
			const spec = CONTENT_MIGRATIONS["datasets"]
			if (!spec) return
			const action = stampAction(
				"datasets",
				(await contentVersions())["datasets"],
				spec.currentVersion
			)
			if (action === "adopt") {
				await stampVersion("datasets", spec.currentVersion)
			} else if (action === "behind") {
				// The one expensive case: migrate the whole collection forward,
				// write it back, stamp — once per server per version bump.
				await adapter.loadDatasets()
			}
		})()
		datasetsCurrentPromise.catch(() => {
			datasetsCurrentPromise = null
		})
		return datasetsCurrentPromise
	}

	/** One whole dataset body, or null when the server doesn't have it. Also
	 *  seeds the diff baseline: a body read into memory is exactly what a
	 *  later save will diff against, so recording it here means an unchanged
	 *  dataset is never re-uploaded. */
	const loadWholeDataset = async (id: string): Promise<Dataset | null> => {
		const response = await fetch(`/api/datasets/${encodeURIComponent(id)}`)
		if (response.status === 404) return null
		if (!response.ok) {
			throw new Error(`GET /api/datasets/${id} failed: ${response.status}`)
		}
		// The response text IS the serialization to diff against — bodies are
		// written by this client's own serializer, so re-stringifying the parsed
		// object (a second full traversal of a possibly-hundreds-of-MB body, on
		// the interactive open path) only reproduced it. Seeding the cache keeps
		// serializeCached agreeing with the baseline.
		const text = await response.text()
		const dataset = JSON.parse(text) as Dataset
		serializedCache.set(dataset, text)
		baselines.datasets.set(id, text)
		return dataset
	}

	/** PUT the versions whose rows actually changed since this adapter last
	 *  wrote them, DELETE the per-version bodies of versions that no longer
	 *  exist (without which the server kept serving deleted rows forever — a
	 *  privacy problem for data the user believes removed), and record what
	 *  the server now holds. The diff/delete rules live in the shared
	 *  `syncDatasetVersions`; this wires them to the API.
	 *
	 *  The prior version set is snapshotted BEFORE the sync so the removed
	 *  set is computed against what the server actually held, and
	 *  `knownVersionIds` advances only on success — a failed sync retries in
	 *  full on the next save. THROWS on failure: callers that write metadata
	 *  afterwards must let this abort them, because fresh meta over a failed
	 *  sync would mask the stale version bodies from every repair pass. */
	/** The write triplet every dataset save must issue, in this order: the
	 *  whole body (old clients and the export path read that file), the
	 *  per-version sync, and the metadata LAST — a crash or a failed version
	 *  sync (which throws past the meta write) then reads as un-hydrated,
	 *  repaired on the next boot, never as fresh-meta-over-stale-versions.
	 *  The ordering is load-bearing; both the normal save and the migration
	 *  write-back go through here so it can't drift. */
	const putDatasetTriplet = async (
		dataset: Dataset,
		serialized: string
	): Promise<void> => {
		await putDataset(dataset.id, serialized)
		await splitDatasetVersions(dataset)
		await putDatasetMeta(dataset.id, datasetMetaFrom(dataset))
	}

	const splitDatasetVersions = async (dataset: Dataset): Promise<void> => {
		await syncDatasetVersions(
			dataset,
			knownVersionIds.get(dataset.id),
			{
				putVersion: async (version) => {
					await putDatasetVersion(dataset.id, version)
					return true
				},
				deleteVersion: async (versionId) => {
					await request(
						"DELETE",
						`datasets/${encodeURIComponent(dataset.id)}/versions`,
						versionId
					)
				},
			},
			writtenVersions
		)
		knownVersionIds.set(
			dataset.id,
			new Set((dataset.versions ?? []).map((v) => v.id))
		)
	}

	/** Repair one dataset's missing metadata: read the body, derive from it,
	 *  and store the result so no later session pays this again. ALSO re-splits
	 *  the per-version bodies: a null meta means something wrote the body
	 *  without the follow-ups — an old bundle during a rolling deploy — so any
	 *  stored version bodies describe the previous rows. A failure to store is
	 *  non-fatal (the metadata in hand is correct either way), but the meta
	 *  PUT only follows a SUCCESSFUL re-split — persisting meta over a failed
	 *  split would mask the stale version bodies from every later repair.
	 *  Null only when the body itself can't be read (retried once: a single
	 *  transient blip here would otherwise drop the dataset from the whole
	 *  session's index). */
	const hydrateDatasetMeta = async (
		id: string
	): Promise<DatasetMeta | null> => {
		let whole: Dataset | null
		try {
			whole = await loadWholeDataset(id).catch(() => loadWholeDataset(id))
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error(
				`[vis-components] could not derive metadata for dataset ${id}`,
				error
			)
			return null
		}
		if (!whole) return null
		const meta = datasetMetaFrom(whole)
		try {
			await splitDatasetVersions(whole)
			await putDatasetMeta(id, meta)
		} catch (error) {
			// eslint-disable-next-line no-console
			console.warn(
				`[vis-components] could not store derived metadata for dataset ${id}`,
				error
			)
		}
		return meta
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

		// The stamp policy (adopt an absent stamp — an example of why: the
		// px→pt font reset re-firing over already-current data would visibly
		// wreck every saved visual — refuse a newer one, migrate an older one)
		// is shared with the lazy gate; see `stampAction`.
		const action = stampAction(collection, stored, spec.currentVersion)
		if (action === "adopt") {
			await stampVersion(collection, spec.currentVersion)
			return raw
		}
		if (action === "current") return raw

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

	const adapter: StorageContentAdapter = {
		capabilities: { remoteLoad: true },

		loadVisuals: async () =>
			upgraded({
				collection: "visuals",
				raw: await loadCollection<Visual[]>(
					wantsThumbnails() ? "visuals" : "visuals?thumbnails=0"
				),
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

		// The boot read. `?view=index` is a pure SQLite lookup on the server —
		// no dataset file is opened, so this stays fast however much row data
		// the library holds.
		//
		// A `null` entry means the server holds no metadata for that dataset:
		// rows written before the metadata column existed, or a body write
		// whose metadata follow-up never landed. It NEVER means the dataset is
		// gone. Those are repaired here — fetch the body, derive, PUT it back —
		// so the first load after a deploy costs what today's load costs, and
		// every load after it is cheap. Sequential on purpose: these are the
		// full-size bodies, and inflating all of them at once is the very
		// thing this change exists to stop.
		loadDatasetIndex: async () => {
			await ensureDatasetsCurrent()
			const raw = await loadCollection<Record<string, unknown>>(
				"datasets?view=index"
			)
			const index: Record<string, DatasetMeta> = {}
			const needHydration: string[] = []
			for (const [id, value] of Object.entries(raw)) {
				if (isDatasetMeta(value)) {
					index[id] = value
					knownVersionIds.set(id, new Set(value.versions.map((v) => v.id)))
				} else {
					needHydration.push(id)
				}
			}
			// Bounded, not serial: these are full-body downloads (the first
			// boot after a deploy hydrates the whole library), and one at a
			// time made that wait the sum of every download.
			const hydrated = await boundedMap(needHydration, 4, async (id) =>
				[id, await hydrateDatasetMeta(id)] as const
			)
			for (const [id, meta] of hydrated) {
				if (meta) index[id] = meta
			}
			// A dataset absent from the returned index is invisible for the whole
			// session — the library hides it, and a same-named re-upload then
			// sails past the collision guard. One more delayed round before
			// giving up turns a transient blip into a slow boot instead.
			const failed = hydrated.filter(([, meta]) => !meta).map(([id]) => id)
			if (failed.length > 0) {
				await new Promise((resolve) => setTimeout(resolve, 1500))
				const retried = await boundedMap(failed, 4, async (id) =>
					[id, await hydrateDatasetMeta(id)] as const
				)
				const dropped: string[] = []
				for (const [id, meta] of retried) {
					if (meta) index[id] = meta
					else dropped.push(id)
				}
				if (dropped.length > 0) {
					// eslint-disable-next-line no-console
					console.error(
						`[vis-components] could not hydrate ${dropped.join(", ")} — ` +
							`hidden from the library until the next reload`
					)
				}
			}
			return index
		},

		// A 404 here means this version has no stored body of its own — every
		// version of every dataset written before the split. That is the
		// signal to fall back to the whole dataset and split it as we go, so
		// the next open of the same dataset costs one version.
		loadDatasetVersion: async (id, versionId) => {
			await ensureDatasetsCurrent()
			const response = await fetch(
				`/api/datasets/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`
			)
			if (response.ok) {
				const body = (await response.json()) as {
					rows?: Array<Record<string, string>>
				}
				return body.rows ?? []
			}
			if (response.status !== 404) {
				throw new Error(
					`GET /api/datasets/${id}/versions/${versionId} failed: ${response.status}`
				)
			}
			const whole = await loadWholeDataset(id)
			if (!whole) return null
			// Awaited, not fired and forgotten: a split PUT still in flight when
			// the user edits this dataset would land after their save and
			// overwrite fresh rows with the ones it started from. This is
			// already the slow path — it just downloaded the whole dataset —
			// and it runs once per dataset, ever. A failed split is non-fatal
			// HERE (the rows in hand are correct and no meta write follows);
			// the next reader just falls back to the whole body again.
			try {
				await splitDatasetVersions(whole)
			} catch (error) {
				// eslint-disable-next-line no-console
				console.warn(
					`[vis-components] could not split dataset ${id} into per-version bodies`,
					error
				)
			}
			return whole.versions.find((v) => v.id === versionId)?.rows ?? null
		},

		loadDataset: async (id) => {
			await ensureDatasetsCurrent()
			return loadWholeDataset(id)
		},

		loadDatasets: async () => {
			// The migration pass rewrites bodies, so each rewritten dataset goes
			// through the same write triplet a normal save issues. The migrated
			// record is captured here so putOne never round-trips the serialized
			// string back through JSON.parse (three full passes per dataset,
			// over the whole corpus, on the first post-deploy boot).
			let migrated: Record<string, Dataset> = {}
			return upgraded({
				collection: "datasets",
				raw: await loadCollection<Record<string, Dataset>>("datasets"),
				baseline: baselines.datasets,
				entries: (record) => {
					migrated = record
					return recordToMap(record)
				},
				putOne: (id, serialized) =>
					putDatasetTriplet(
						migrated[id] ?? (JSON.parse(serialized) as Dataset),
						serialized
					),
				deleteOne: deleteFrom("datasets"),
			})
		},
		// Per changed dataset, the shared triplet: whole body, then the
		// per-version sync — only the VERSIONS whose rows actually changed
		// (weak-identity diff — a rename re-uploads nothing) plus DELETEs for
		// versions the user removed (or the server keeps serving deleted rows)
		// — and last the metadata (see `putDatasetTriplet` for why the order
		// is load-bearing). No `deleteOne`: bodies load on demand, so this map
		// is a subset of the store and deletion is explicit (`deleteDatasets`).
		saveDatasets: (datasets) =>
			syncCollection(
				baselines.datasets,
				recordToMap(datasets),
				async (id, serialized) => {
					const dataset = datasets[id]
					if (!dataset) return
					await putDatasetTriplet(dataset, serialized)
				}
			),

		deleteDatasets: async (ids) => {
			await Promise.all(
				ids.map((id) =>
					deleteFrom("datasets")(id).then(() => {
						for (const versionId of knownVersionIds.get(id) ?? []) {
							writtenVersions.delete(`${id}:${versionId}`)
						}
						knownVersionIds.delete(id)
						// Drop it from the diff baseline too, or the next save
						// would see a baseline entry with no current value and
						// issue a second, redundant DELETE.
						baselines.datasets.delete(id)
					})
				)
			)
		},

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
	return adapter
}
