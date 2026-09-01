import { atom, type Atom, type Getter, type Setter } from "jotai"
import {
	type AnnotationsConfig,
} from "../lib/annotationsConfig"
import { type CaptionConfig } from "../lib/captionConfig"
import {
	type ChannelConfigs,
	type DataLabelsConfig,
} from "../lib/channelConfig"
import {
	type LabelsConfig,
	type LegendConfig,
	type TooltipConfig,
} from "../lib/labelsConfig"
import { type MapConfig } from "../lib/mapConfig"
import { type ReshapeConfig } from "../lib/reshape"
import {
	loadCurrentAnnotations,
	loadCurrentCaption,
	loadCurrentChannelConfigs,
	loadCurrentDataLabelsConfig,
	loadCurrentDataLabelsEncodings,
	loadCurrentDatasetId,
	loadCurrentEncodings,
	loadCurrentFieldLevelOrders,
	loadCurrentFieldOverrides,
	loadCurrentLabels,
	loadCurrentLegend,
	loadCurrentMapConfig,
	loadCurrentReshapeConfig,
	loadCurrentTooltip,
	loadCurrentVisualId,
	loadCurrentVisualName,
	loadDatasets,
	loadDrawerHeight,
	loadEmbedInstances,
	loadExportSizes,
	loadExportUnit,
	loadFolders,
	loadLibraryCollapsedFolders,
	loadLibrarySidebarWidth,
	loadPreviewVersionId,
	loadSidebarCollapsed,
	loadSidebarWidth,
	loadTheme,
	loadThemes,
	loadUserDefaultThemeId,
	loadUserFonts,
	loadVisuals,
	mergeThumbnails,
	saveCurrentAnnotations,
	saveCurrentCaption,
	saveCurrentChannelConfigs,
	saveCurrentDataLabelsConfig,
	saveCurrentDataLabelsEncodings,
	saveCurrentDatasetId,
	saveCurrentEncodings,
	saveCurrentFieldLevelOrders,
	saveCurrentFieldOverrides,
	saveCurrentLabels,
	saveCurrentLegend,
	saveCurrentMapConfig,
	saveCurrentReshapeConfig,
	saveCurrentTooltip,
	saveCurrentVisualId,
	saveCurrentVisualName,
	saveDrawerHeight,
	saveExportSizes,
	saveExportUnit,
	saveLibraryCollapsedFolders,
	saveLibrarySidebarWidth,
	savePreviewVersionId,
	saveSidebarCollapsed,
	saveSidebarWidth,
	saveTheme,
	type ExportSize,
	type ExportUnit,
} from "../lib/storage"
import { datasetIndexFrom } from "../lib/datasetMeta"
import { resolveVersionIdFromMeta } from "../lib/resolveDatasetVersion"
import { idbAvailable } from "../lib/storage/idb"
import {
	overlayThemes,
	seedUserDefaultThemeId,
	stripSeedVisuals,
} from "../lib/exampleOverlay"
import type { UserFont } from "../lib/fontLibrary"
import type { StorageContentAdapter } from "../lib/storage/adapter"
import { getStorageAdapter } from "../lib/storage/registry"
import {
	LIGHT_THEME_BASE,
	normalizeSavedThemes,
	SYSTEM_LIGHT_THEME,
	SYSTEM_THEMES,
} from "../lib/systemThemes"
import {
	type DataLabelsEncodings,
	type Dataset,
	type DatasetMeta,
	type EmbedInstance,
	type Encodings,
	type FieldType,
	type Folder,
	type ParsedUpload,
	type SavedTheme,
	type Theme,
	type Visual,
} from "../lib/types"

/** The functional-update half of a Jotai setter — same shape Recoil's
 * `SetterOrUpdater` had, kept as a local alias so prop types read cleanly. */
export type SetterOrUpdater<T> = (update: T | ((prev: T) => T)) => void

/** Sentinel for "no write has happened in this store yet" — distinguishes the
 * pre-bootstrap state from every legitimate atom value (including null). */
const UNSET = Symbol("visComponents:unset")
type Unset = typeof UNSET

const resolveUpdate = <T>(update: T | ((prev: T) => T), prev: T): T =>
	typeof update === "function" ? (update as (prev: T) => T)(prev) : update

/** Persisted atom: the first read in a store lazily bootstraps from `load()`
 * (Jotai caches the read until the first write, so `load` runs once per
 * store), and every write saves through `save`. This mirrors the old Recoil
 * `persistEffect` — storage is read on first `get`, not at module load, so
 * tests that seed localStorage before mounting keep working. */
const persistedAtom = <T>(load: () => T, save: (v: T) => void) => {
	const base = atom<T | Unset>(UNSET)
	return atom(
		(get) => {
			const v = get(base)
			return v === UNSET ? load() : v
		},
		(get, set, update: T | ((prev: T) => T)) => {
			const raw = get(base)
			const next = resolveUpdate(update, raw === UNSET ? load() : raw)
			set(base, next)
			save(next)
		}
	)
}

/** Content atom: persisted through the swappable `StorageContentAdapter`
 * rather than a fixed storage function, so a hosted build can back it with a
 * server (see lib/storage/adapter.ts).
 *  - `bootstrap` is the SYNCHRONOUS first-paint read from the local cache —
 *    identical to `persistedAtom`'s `load`, so first render stays instant and
 *    tests that seed localStorage keep working.
 *  - Writes go through `save(adapter, next)`. The local adapter writes
 *    synchronously, so write timing is unchanged.
 *  - `onMount` fetches the authoritative copy via `remoteLoad` ONLY when the
 *    adapter reports `remoteLoad` (a backend). The default local adapter skips
 *    it, so behaviour is byte-identical to the pre-adapter build. The
 *    `touched` guard (mirroring `datasetsAtom`) prevents an in-flight load
 *    from clobbering a write the user made first. */
const contentAtom = <T>(
	bootstrap: () => T,
	remoteLoad: (adapter: StorageContentAdapter) => Promise<T>,
	save: (adapter: StorageContentAdapter, value: T) => Promise<void>
) => {
	const base = atom<{ value: T | Unset; touched: boolean }>({
		value: UNSET,
		touched: false,
	})
	base.onMount = (setSelf) => {
		const adapter = getStorageAdapter()
		if (!adapter.capabilities.remoteLoad) return
		void remoteLoad(adapter).then((value) => {
			setSelf((prev) => (prev.touched ? prev : { ...prev, value }))
		})
	}
	return atom(
		(get) => {
			const s = get(base)
			return s.value === UNSET ? bootstrap() : s.value
		},
		(get, set, update: T | ((prev: T) => T)) => {
			const s = get(base)
			const next = resolveUpdate(
				update,
				s.value === UNSET ? bootstrap() : s.value
			)
			set(base, { value: next, touched: true })
			void save(getStorageAdapter(), next)
		}
	)
}

/** Visuals persist to localStorage, but their thumbnails live in IndexedDB
 * (inline PNG data URLs are what used to blow the shared ~5MB quota and get
 * previews stripped). The base atom's `onMount`:
 *  1. Leaves the synchronous bootstrap to the lazy first read, so the first
 *     render is instant — thumbnail-less on post-migration stores, inline on
 *     legacy.
 *  2. Asynchronously merges thumbnails in from IndexedDB. Unlike the datasets
 *     atom, no userTouched guard: the merge only fills entries that are
 *     currently null, so it can't clobber a save that raced ahead of it.
 *  3. One-time migration: a bootstrap that still carries inline thumbnails
 *     (pre-IndexedDB) is re-saved once, which strips the localStorage copy
 *     and seeds the IndexedDB side-table. */
const visualsBaseAtom = atom<Visual[] | Unset>(UNSET)
visualsBaseAtom.onMount = (setSelf) => {
	const adapter = getStorageAdapter()
	// Hosted build: the backend is authoritative and carries thumbnails inline,
	// so skip the local IndexedDB merge and load straight from the adapter.
	if (adapter.capabilities.remoteLoad) {
		void adapter
			.loadVisuals()
			.then((visuals) => {
				setSelf(() => visuals)
			})
			.catch((error) => {
				// eslint-disable-next-line no-console
				console.error("[vis-components] visuals failed to load:", error)
				// Settle on the bootstrap rather than staying UNSET forever:
				// `visualsHydratedAtom` gates the deep-link not-found redirect,
				// and a permanently un-hydrated list would leave that page stuck.
				setSelf((prev) => (prev === UNSET ? loadVisuals() : prev))
			})
		return
	}
	if (!idbAvailable()) return
	const boot = loadVisuals()
	// Ephemeral seed examples always carry their thumbnail inline (it's served
	// from the bundle, never from the side-table), so they must not be read as
	// the legacy pre-IndexedDB shape — that would fire the migration re-save on
	// every single boot.
	const legacyInline = stripSeedVisuals(boot).some((v) => v.thumbnail !== null)
	void adapter.loadThumbnails().then((thumbnails) => {
		let merged: Visual[] = boot
		setSelf((prev) => {
			merged = mergeThumbnails(prev === UNSET ? boot : prev, thumbnails)
			return merged
		})
		// Writing the base atom directly bypasses the saving write above, so
		// trigger the migration save explicitly. Only needed once — afterwards
		// the localStorage blob never carries inline thumbnails again.
		if (legacyInline) void adapter.saveVisuals(merged)
	})
}

export const visualsAtom = atom(
	(get) => {
		const v = get(visualsBaseAtom)
		return v === UNSET ? loadVisuals() : v
	},
	(get, set, update: Visual[] | ((prev: Visual[]) => Visual[])) => {
		const raw = get(visualsBaseAtom)
		const next = resolveUpdate(update, raw === UNSET ? loadVisuals() : raw)
		set(visualsBaseAtom, next)
		void getStorageAdapter().saveVisuals(next)
	}
)

/** True once the visuals list is authoritative. Local mode bootstraps
 * synchronously from localStorage, so it is hydrated from the first read.
 * Server mode starts UNSET and fills in when the base atom's `onMount`
 * fetch resolves — until then `visualsAtom` reads as an empty list that
 * says nothing about what exists. Anything that treats "id not in the
 * list" as "no such visual" (deep links, embeds) must wait for this, or a
 * cold server-mode load of /editor/$visualId bounces to the library
 * before the fetch lands. Reading this atom also subscribes
 * `visualsBaseAtom`, which is what kicks off that fetch. */
export const visualsHydratedAtom = atom((get) => {
	const v = get(visualsBaseAtom)
	return v !== UNSET || !getStorageAdapter().capabilities.remoteLoad
})

export const foldersAtom = contentAtom<Folder[]>(
	loadFolders,
	(adapter) => adapter.loadFolders(),
	(adapter, folders) => adapter.saveFolders(folders)
)

/** Datasets are split in two, because a library's row data can run to
 * hundreds of megabytes and almost nothing needs it.
 *
 *  - `datasetIndexAtom` — row-free metadata for EVERY dataset. This is what
 *    boots, and it is the authoritative list of which datasets exist. The
 *    library grid, the header, sort/filter, and the version badge read only
 *    this.
 *  - `loadedDatasetsAtom` — the bodies actually pulled into memory so far,
 *    which is normally just the one a visualization is drawing. NOT the whole
 *    store: never infer "this dataset was deleted" from its absence here.
 *
 * Deletion is therefore explicit (`deleteDatasetsAtom`) rather than implied
 * by a dataset missing from a whole-map save. With lazy bodies, an implicit
 * whole-collection diff would read every un-loaded dataset as deleted and
 * destroy the library on the next save. */
/** Synchronous localStorage bootstrap of the legacy dataset blob (plus the
 * ephemeral seed overlay). Cached per store — `loadDatasets()` parses the
 * whole blob and builds a fresh object every call, so reading it from atom
 * getters directly would re-parse on every recompute and hand consumers an
 * unstable identity. One-shot per store is exactly right: the blob is
 * read-only after the one-time split, and in-session writes flow through
 * `loadedDatasetsBaseAtom`, which wins in every merge below.
 *
 * Empty in server mode: there the server is the store, and nothing ever
 * clears a leftover browser-local blob on the same origin (dual-mode dev,
 * or history predating the IndexedDB move) — merging it resurrected ghost
 * datasets in every read, and the first save then uploaded them to the
 * server. The ephemeral seed overlay is browser-local-only too, so nothing
 * legitimate is lost by skipping the read. */
const bootDatasetsAtom = atom(() =>
	getStorageAdapter().capabilities.remoteLoad ? {} : loadDatasets()
)

const datasetIndexBaseAtom = atom<{
	value: Record<string, DatasetMeta> | Unset
	touched: boolean
	/** True once the authoritative async index read has resolved (or was
	 * never needed — sync environments). Until then, an id missing from the
	 * index means "unknown yet", NOT "not split" or "deleted", and nothing
	 * may act on its absence. */
	ready: boolean
}>({ value: UNSET, touched: false, ready: false })
datasetIndexBaseAtom.onMount = (setSelf) => {
	const adapter = getStorageAdapter()
	// No async source to wait for (SSR / happy-dom tests without a remote
	// adapter): the synchronous bootstrap IS the store, so the index is ready
	// immediately.
	if (!adapter.capabilities.remoteLoad && !idbAvailable()) {
		setSelf((prev) => (prev.ready ? prev : { ...prev, ready: true }))
		return
	}
	void adapter
		.loadDatasetIndex()
		.then((index) => {
			setSelf((prev) =>
				prev.touched ? { ...prev, ready: true } : { ...prev, value: index, ready: true }
			)
		})
		.catch((error) => {
			// eslint-disable-next-line no-console
			console.error("[vis-components] dataset index failed to load:", error)
			// Ready-with-bootstrap beats waiting forever: the ensure path may
			// fall back to whole-body reads, which is slow but correct.
			setSelf((prev) => ({ ...prev, ready: true }))
		})
}

/** True once the dataset index is authoritative. The ensure path refuses to
 * fetch anything before this: acting on a not-yet-loaded index is what used
 * to download the entire upload history on every cold open. */
export const datasetIndexReadyAtom = atom((get) => get(datasetIndexBaseAtom).ready)

/** Dataset bodies held in memory. Written by the upload/version flows and
 * filled in by `ensureDatasetLoadedAtom`; every write persists. Upsert-only —
 * removing an id here just drops it from the cache, it does not delete
 * anything. */
const loadedDatasetsBaseAtom = atom<Record<string, Dataset>>({})

/** Ids deleted this session that the read-only bootstrap blob still contains.
 * `bootDatasetsAtom` is a cached derived read with no setter, so deletion
 * records a tombstone here instead; every boot merge filters through them.
 * Without this, a deleted dataset resurfaced in the next merged read and the
 * next functional write copied it back into the base map and re-persisted it
 * — the explicit deletion silently undone. */
const deletedBootIdsAtom = atom<ReadonlySet<string>>(new Set<string>())

/** The bootstrap blob minus this session's deletions. */
const liveBootDatasetsAtom = atom((get) => {
	const boot = get(bootDatasetsAtom)
	const deleted = get(deletedBootIdsAtom)
	if (deleted.size === 0 || Object.keys(boot).length === 0) return boot
	return Object.fromEntries(
		Object.entries(boot).filter(([id]) => !deleted.has(id))
	)
})

export const datasetIndexAtom = atom(
	(get) => {
		const s = get(datasetIndexBaseAtom)
		const stored =
			s.value === UNSET ? datasetIndexFrom(get(liveBootDatasetsAtom)) : s.value
		// A body in memory is by definition a dataset that exists, and its
		// metadata is fresher than anything stored — an in-flight upload is
		// visible in the library before its write lands. Deriving rather than
		// mirroring on write also means the two can never disagree.
		const loaded = get(loadedDatasetsBaseAtom)
		return Object.keys(loaded).length === 0
			? stored
			: { ...stored, ...datasetIndexFrom(loaded) }
	},
	(
		get,
		set,
		update:
			| Record<string, DatasetMeta>
			| ((prev: Record<string, DatasetMeta>) => Record<string, DatasetMeta>)
	) => {
		const s = get(datasetIndexBaseAtom)
		const next = resolveUpdate(
			update,
			s.value === UNSET ? datasetIndexFrom(get(liveBootDatasetsAtom)) : s.value
		)
		set(datasetIndexBaseAtom, { ...s, value: next, touched: true })
	}
)

export const loadedDatasetsAtom = atom(
	(get) => {
		const loaded = get(loadedDatasetsBaseAtom)
		// Synchronous fallback to the localStorage copy, mirroring every other
		// persisted atom. Covers environments with no IndexedDB to lazily load
		// FROM — SSR, the happy-dom tests, privacy modes — and a store that
		// hasn't been split into per-dataset keys yet. Lazily-loaded bodies win.
		const boot = get(liveBootDatasetsAtom)
		return Object.keys(boot).length === 0 ? loaded : { ...boot, ...loaded }
	},
	(
		get,
		set,
		update:
			| Record<string, Dataset>
			| ((prev: Record<string, Dataset>) => Record<string, Dataset>)
	) => {
		// prev must be the same merged value the getter reports — resolving
		// against the bare base atom would hand functional updates an empty
		// record in bootstrap-only environments and silently drop datasets.
		// Reading our own atom guarantees the two can never drift.
		const next = resolveUpdate(update, get(loadedDatasetsAtom))
		set(loadedDatasetsBaseAtom, next)
		void getStorageAdapter().saveDatasets(next)
	}
)

/** The full body of one dataset: from memory when this session already holds
 * it, else fetched from the adapter. Read-only — the caller decides what (if
 * anything) to write back. The ONE way to get a body outside the ensure/render
 * path; hand-rolled copies of this lookup drifted into divergent error and
 * concurrency rules. Throws when the store cannot answer. */
export const getDatasetBody = (
	get: Getter,
	id: string
): Promise<Dataset | null> => {
	const inMemory = get(loadedDatasetsAtom)[id]
	return inMemory ? Promise.resolve(inMemory) : getStorageAdapter().loadDataset(id)
}

/** Apply `mutate` to a dataset's full body, loading it first when this
 * session holds only the lazy per-version rows. The freshly-read body is only
 * the fallback: `prev` wins inside the write, because a concurrent edit that
 * landed during the await is newer than our read. Resolves false when the
 * dataset can't be found; rejects when the load fails. */
export const mutateDatasetBodyAtom = atom(
	null,
	async (
		get,
		set,
		id: string,
		mutate: (d: Dataset) => Dataset
	): Promise<boolean> => {
		const body = await getDatasetBody(get, id)
		if (!body) return false
		set(loadedDatasetsAtom, (prev) => ({ ...prev, [id]: mutate(prev[id] ?? body) }))
		return true
	}
)

/** Terminal failure states of a dataset load, per dataset id. Absence means
 * "fine so far" — in-flight tracking lives in `datasetLoadsInFlightAtom`,
 * and success needs no entry because the resolved view itself is the
 * evidence. `missing` = the store answered and the dataset isn't there;
 * `error` = the read itself failed (network, server) and may work on retry. */
export type DatasetLoadState = "missing" | "error"

export const datasetLoadStatesAtom = atom<Record<string, DatasetLoadState>>({})

/** Load requests currently running, keyed by `versionRowsKey` (or dataset id
 * for whole-body loads). Per-store — module scope would leak between test
 * stores and embed iframes and permanently block their fetches. */
const datasetLoadsInFlightAtom = atom<ReadonlySet<string>>(new Set<string>())

/** Rows of individual dataset versions, keyed by `<datasetId>:<versionId>`.
 * A chart draws exactly one version, so this is what the render path loads —
 * a dataset with a long upload history costs one version, not all of them. */
const loadedVersionRowsBaseAtom = atom<
	Record<string, Array<Record<string, string>>>
>({})

export const versionRowsKey = (datasetId: string, versionId: string): string =>
	`${datasetId}:${versionId}`

const datasetIdOfRowsKey = (key: string): string =>
	key.slice(0, key.lastIndexOf(":"))

export const loadedVersionRowsAtom = atom((get) =>
	get(loadedVersionRowsBaseAtom)
)

/** Most-recently-ensured dataset ids, newest first — the basis for evicting
 * everything else below. */
const datasetLoadRecencyAtom = atom<readonly string[]>([])

/** Whole bodies that the ensure path itself loaded, by id. Only these are
 * eviction candidates, and only while the body in the store IS the loaded
 * object — a body the user has since edited (new identity) may hold work a
 * failed save hasn't persisted, so it is never evicted. */
const ensureLoadedBodiesAtom = atom<ReadonlyMap<string, Dataset>>(
	new Map<string, Dataset>()
)

/** How many datasets' lazily-loaded rows stay in memory. Without a bound the
 * caches only ever grew, so a long session switching between visuals
 * converged right back on the full-corpus footprint lazy loading exists to
 * avoid. Refetch on switch-back is cheap and idempotent (this same ensure
 * path). */
const LOADED_DATASET_CACHE_SIZE = 4

/** Bump `id` to the front of the recency list and drop the lazily-loaded
 * rows and bodies of every dataset that fell off it. */
const evictColdDatasets = (
	get: Getter,
	set: Setter,
	id: string
): void => {
	const recency = get(datasetLoadRecencyAtom)
	if (recency[0] !== id) {
		set(datasetLoadRecencyAtom, [
			id,
			...recency.filter((r) => r !== id),
		].slice(0, LOADED_DATASET_CACHE_SIZE))
	}
	const keep = new Set(get(datasetLoadRecencyAtom))

	const rows = get(loadedVersionRowsBaseAtom)
	if (Object.keys(rows).some((key) => !keep.has(datasetIdOfRowsKey(key)))) {
		set(loadedVersionRowsBaseAtom, (prev) =>
			Object.fromEntries(
				Object.entries(prev).filter(([key]) => keep.has(datasetIdOfRowsKey(key)))
			)
		)
	}

	const ensureLoaded = get(ensureLoadedBodiesAtom)
	const bodies = get(loadedDatasetsBaseAtom)
	const evictIds = [...ensureLoaded].filter(
		([bodyId, body]) => !keep.has(bodyId) && bodies[bodyId] === body
	)
	if (evictIds.length > 0) {
		const doomed = new Set(evictIds.map(([bodyId]) => bodyId))
		set(loadedDatasetsBaseAtom, (prev) =>
			Object.fromEntries(
				Object.entries(prev).filter(([bodyId]) => !doomed.has(bodyId))
			)
		)
		set(ensureLoadedBodiesAtom, (prev) => {
			const next = new Map(prev)
			for (const bodyId of doomed) next.delete(bodyId)
			return next
		})
	}
}

/** Pull in the rows a visualization is about to draw — one version of one
 * dataset — if they aren't already in memory. Idempotent per version per
 * session; a previous failure is cleared and retried. Write-only action.
 *
 * Which version to fetch is answered from metadata alone, so nothing is
 * transferred to find out what to transfer. Refuses to run before the index
 * is ready: before then, an id the index doesn't know might simply not have
 * arrived yet, and the whole-body fallback would download the entire upload
 * history — on exactly the cold-open paths (editor refresh, embeds, capture
 * iframes) this design exists to make cheap. `useEnsureCurrentDatasetLoaded`
 * re-fires when readiness flips. */
export const ensureDatasetLoadedAtom = atom(
	null,
	(get, set, id: string | null) => {
		if (!id) return
		// Every ensure — cache hit or not — refreshes the recency list and
		// drops the datasets that fell off it, so the caches stay bounded.
		evictColdDatasets(get, set, id)
		// A whole body already in memory (a fresh upload, an import, a seeded
		// example) serves the render path directly — no fetch of any kind.
		if (get(loadedDatasetsBaseAtom)[id] || get(liveBootDatasetsAtom)[id]) return
		if (!get(datasetIndexBaseAtom).ready) return

		const meta = get(datasetIndexAtom)[id]
		// No usable metadata: the index is authoritative and doesn't know this
		// dataset (or knows it un-hydrated). The whole-body read is the honest
		// cost here, and it is also what reports a dataset as missing.
		const versionId = resolveVersionIdFromMeta(meta, get(previewVersionIdAtom))
		const key = versionId ? versionRowsKey(id, versionId) : id
		if (versionId && get(loadedVersionRowsBaseAtom)[key]) return
		const inFlight = get(datasetLoadsInFlightAtom)
		if (inFlight.has(key)) return
		set(datasetLoadsInFlightAtom, new Set(inFlight).add(key))

		// A stale terminal state must not survive into this attempt — entering
		// here IS the retry path (dataset/version switch, remount).
		if (get(datasetLoadStatesAtom)[id]) {
			set(datasetLoadStatesAtom, ({ [id]: _stale, ...rest }) => rest)
		}

		const load = async (): Promise<boolean> => {
			if (versionId) {
				const rows = await getStorageAdapter().loadDatasetVersion(id, versionId)
				if (rows) {
					set(loadedVersionRowsBaseAtom, (prev) => ({ ...prev, [key]: rows }))
					return true
				}
				// Fall through to the whole body. The version id came from the
				// index metadata, so the store refusing it means the entry has
				// drifted from the body — a stale index, not a deleted dataset.
				// The body is the authoritative record: with it in memory the
				// view resolves a version that exists (and the storage layer
				// repairs the index entry), instead of reporting the dataset
				// deleted.
			}
			const dataset = await getStorageAdapter().loadDataset(id)
			if (!dataset) return false
			// Straight to the base atom: this is a read completing, not an
			// edit, and routing it through the saving setter would write the
			// dataset back out again on every open.
			set(loadedDatasetsBaseAtom, (prev) => ({ ...prev, [id]: dataset }))
			// Recorded as evictable: this body came FROM storage, so dropping
			// it later loses nothing (an edit replaces the identity and takes
			// it off the eviction list).
			set(ensureLoadedBodiesAtom, (prev) => new Map(prev).set(id, dataset))
			return true
		}

		void load()
			.then((found) => {
				if (!found) {
					set(datasetLoadStatesAtom, (prev) => ({ ...prev, [id]: "missing" }))
				}
			})
			.catch((error) => {
				// eslint-disable-next-line no-console
				console.error(`[vis-components] dataset ${id} failed to load:`, error)
				set(datasetLoadStatesAtom, (prev) => ({ ...prev, [id]: "error" }))
			})
			.finally(() => {
				set(datasetLoadsInFlightAtom, (prev) => {
					const next = new Set(prev)
					next.delete(key)
					return next
				})
			})
	}
)

/** Delete datasets outright — the only path that removes them from storage.
 * Explicit because absence from `loadedDatasetsAtom` means "not loaded", not
 * "deleted". */
export const deleteDatasetsAtom = atom(
	null,
	(get, set, ids: readonly string[]) => {
		if (ids.length === 0) return
		const doomed = new Set(ids)
		// The bootstrap blob is read-only, so ids it holds are tombstoned —
		// without this the boot merge resurfaced the dataset and the next
		// write re-persisted it.
		const boot = get(bootDatasetsAtom)
		const bootDoomed = ids.filter((id) => id in boot)
		if (bootDoomed.length > 0) {
			set(deletedBootIdsAtom, (prev) => {
				const next = new Set(prev)
				for (const id of bootDoomed) next.add(id)
				return next
			})
		}
		set(ensureLoadedBodiesAtom, (prev) => {
			if (!ids.some((id) => prev.has(id))) return prev
			const next = new Map(prev)
			for (const id of ids) next.delete(id)
			return next
		})
		set(datasetIndexAtom, (prev) =>
			Object.fromEntries(
				Object.entries(prev).filter(([id]) => !doomed.has(id))
			)
		)
		set(loadedDatasetsBaseAtom, (prev) =>
			Object.fromEntries(
				Object.entries(prev).filter(([id]) => !doomed.has(id))
			)
		)
		set(datasetLoadStatesAtom, (prev) =>
			Object.fromEntries(
				Object.entries(prev).filter(([id]) => !doomed.has(id))
			)
		)
		set(loadedVersionRowsBaseAtom, (prev) =>
			Object.fromEntries(
				Object.entries(prev).filter(
					([key]) => !doomed.has(datasetIdOfRowsKey(key))
				)
			)
		)
		void getStorageAdapter().deleteDatasets(ids)
	}
)

/** Lightweight record of every embed snippet the user has copied. Keyed by
 * the instance's own id; the dedup invariant (at most one per visualId +
 * versionId) is maintained at the write site via `upsertEmbedInstance`. */
export const embedInstancesAtom = contentAtom<Record<string, EmbedInstance>>(
	loadEmbedInstances,
	(adapter) => adapter.loadEmbedInstances(),
	(adapter, instances) => adapter.saveEmbedInstances(instances)
)

/** Last-exported dimensions per visual id — the Export modal restores these
 * on open so a figure comes back at the size it was exported at last time. */
export const exportSizesAtom = persistedAtom<Record<string, ExportSize>>(
	loadExportSizes,
	saveExportSizes
)

/** Unit the Export modal's dimension inputs display in (px / in / cm).
 * Persists on change so the picked unit is the default next export. */
export const exportUnitAtom = persistedAtom<ExportUnit>(
	loadExportUnit,
	saveExportUnit
)

/** Extract the value type `T` from a Jotai atom (`Atom<T>`).
 *  Use to type a prop that holds an atom's *value*, not the atom itself:
 *  `configs: AtomValueType<typeof currentChannelConfigsAtom>`. Pairs with
 *  `SetterOrUpdater<AtomValueType<typeof atom>>` for the setter half of a
 *  `useAtom` tuple. Replaces the broken
 *  `ReturnType<typeof useAtomValue<typeof atom>>` idiom, which resolved to
 *  the atom type itself (the generic arg was being set to the atom, not its
 *  value), so every `.field` access on it failed to typecheck. */
export type AtomValueType<A> = A extends Atom<infer T> ? T : never

export const currentVisualIdAtom = persistedAtom<string | null>(
	loadCurrentVisualId,
	saveCurrentVisualId
)

export const currentEncodingsAtom = persistedAtom<Encodings>(
	loadCurrentEncodings,
	saveCurrentEncodings
)

export const currentDatasetIdAtom = persistedAtom<string | null>(
	loadCurrentDatasetId,
	saveCurrentDatasetId
)

/** When set, the editor canvas previews the visualization at this dataset
 * version instead of the latest. Read-only preview — does not modify or
 * persist anything on the visualization. Set to null to view latest. */
export const previewVersionIdAtom = persistedAtom<string | null>(
	loadPreviewVersionId,
	savePreviewVersionId
)

/** A CSV upload awaiting the user's decision (new data set vs. new version of
 * an existing one). Set by the sidebar Upload button and by the data-drawer
 * drag-and-drop. Consumed by the shared upload-prompt modal in DataUpload. */
export const pendingUploadAtom = atom<ParsedUpload | null>(null)

/** An advisory note about the upload that just landed — a big file, or a
 * column too wide to chart quickly (`lib/datasetLimits.ts`). Deliberately
 * NOT component state: the "start a new visualization" path navigates, which
 * remounts the sidebar, and a note held in DataUpload vanished before it
 * could be read. Deliberately NOT persisted either — it belongs to the
 * upload that just happened, not to the next session. Rendered by
 * `UploadNoticeModal` from RootLayout, above the router outlet, and cleared
 * only when the user dismisses it. */
export const uploadNoticeAtom = atom<string | null>(null)

export const currentFieldOverridesAtom = persistedAtom<
	Record<string, FieldType>
>(loadCurrentFieldOverrides, saveCurrentFieldOverrides)

/** Per-field user-pinned ordering of categorical / ordinal levels. Maps
 * field name → array of level values in the desired axis order. The chart
 * pipeline (aggregateStacks, makePositionScale) consults this when present
 * and falls back to smart-sort otherwise. Levels NOT listed in the
 * override appear after the listed ones in their natural smart-sort
 * order — so users can pin only the levels they care about. */
export const currentFieldLevelOrdersAtom = persistedAtom<
	Record<string, string[]>
>(loadCurrentFieldLevelOrders, saveCurrentFieldLevelOrders)

export const drawerHeightAtom = persistedAtom<number>(
	loadDrawerHeight,
	saveDrawerHeight
)

export const sidebarWidthAtom = persistedAtom<number>(
	loadSidebarWidth,
	saveSidebarWidth
)

/** Width of the landing page's folder sidebar (px). Separate from the
 * editor's sidebarWidthAtom — the two panels are resized independently. */
export const librarySidebarWidthAtom = persistedAtom<number>(
	loadLibrarySidebarWidth,
	saveLibrarySidebarWidth
)

/** Collapsed state for named sidebar sections, keyed by the section's title
 * string. Missing key = expanded. Persisted across reloads. */
export const sidebarCollapsedAtom = persistedAtom<Record<string, boolean>>(
	loadSidebarCollapsed,
	saveSidebarCollapsed
)

/** Which library folders are collapsed. Missing id = expanded. Persisted so
 * the tree keeps its shape across editor round-trips and reloads. */
export const libraryCollapsedFoldersAtom = persistedAtom<ReadonlySet<string>>(
	loadLibraryCollapsedFolders,
	saveLibraryCollapsedFolders
)

/** The default theme — same object the "System (Light)" theme is built
 * from, so the fallback baseline and the bundled system theme can never
 * drift apart. Declared once in `lib/systemThemes.ts`. */
export const DEFAULT_THEME: Theme = LIGHT_THEME_BASE

/** Migrate old theme (single palette/gradient) to new multi-palette format. */
const migrateTheme = (raw: Record<string, unknown>): Theme => {
	const base = { ...DEFAULT_THEME, ...raw } as Theme

	// Migrate legacy categoricalPalette → categoricalPalettes array
	if (raw.categoricalPalette && !raw.categoricalPalettes) {
		const colors = raw.categoricalPalette as string[]
		base.categoricalPalettes = [{ id: "migrated", name: "My palette", colors }]
		base.defaultCategoricalPaletteId = "migrated"
	}

	// Migrate legacy customLinearGradient → linearGradients array
	if (raw.customLinearGradient && !raw.linearGradients) {
		const g = raw.customLinearGradient as { low: string; high: string }
		base.linearGradients = [
			{ id: "migrated-linear", name: "My gradient", low: g.low, high: g.high },
		]
		// If the default was "customLinear", point to the migrated gradient
		if (raw.defaultGradientPalette === "customLinear") {
			base.defaultGradientPalette = "migrated-linear"
		}
	}

	// Migrate legacy customDivergingGradient → divergingGradients array
	if (raw.customDivergingGradient && !raw.divergingGradients) {
		const g = raw.customDivergingGradient as {
			low: string
			mid: string
			high: string
		}
		base.divergingGradients = [
			{
				id: "migrated-diverging",
				name: "My diverging",
				low: g.low,
				mid: g.mid,
				high: g.high,
			},
		]
		if (raw.defaultGradientPalette === "customDiverging") {
			base.defaultGradientPalette = "migrated-diverging"
		}
	}

	return base
}

export const themeAtom = persistedAtom<Theme>(() => {
	const raw = loadTheme()
	if (!raw) return DEFAULT_THEME
	return migrateTheme(raw as unknown as Record<string, unknown>)
}, saveTheme)

const newThemeId = (): string =>
	`th-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Ensure the read-only system themes exist in the array, in case a user
 *  wiped them or an older save dropped them. Applies to BOTH the local
 *  bootstrap and a remote load — a backend's themes collection can be missing
 *  them just as easily, and readers assume they're present. */
const withSystemThemes = (themes: SavedTheme[]): SavedTheme[] => {
	const result = [...themes]
	if (!result.some((t) => t.id === "system-light")) result.unshift(SYSTEM_THEMES[0])
	if (!result.some((t) => t.id === "system-dark")) {
		const lightIdx = result.findIndex((t) => t.id === "system-light")
		result.splice(lightIdx + 1, 0, SYSTEM_THEMES[1])
	}
	return result
}

/** First-load migration: if the user has an old single-theme blob in
 * `localStorage`, wrap it as a user theme alongside the bundled system
 * themes so multi-theme UI sees both. Without this, returning users
 * would lose their customized theme on first launch of the multi-theme
 * build. */
const buildInitialThemes = (): SavedTheme[] => {
	const stored = loadThemes()
	if (stored && stored.length > 0) {
		// Backfill fields the stored themes predate (and refresh the read-only
		// system entries from the bundled copies) — readers take this atom's
		// entries as-is, so sparse persisted themes must be completed here.
		return withSystemThemes(normalizeSavedThemes(stored))
	}
	const legacy = loadTheme()
	if (legacy) {
		const migrated = migrateTheme(legacy as unknown as Record<string, unknown>)
		const userTheme: SavedTheme = {
			id: newThemeId(),
			name: "My theme",
			isSystem: false,
			...migrated,
		}
		return [...SYSTEM_THEMES, userTheme]
	}
	return [...SYSTEM_THEMES]
}

/** All saved themes (system + user-defined). Loaded eagerly so the
 * multi-theme UI in Settings and the editor sidebar always has a
 * stable list to render. */
export const themesAtom = contentAtom<SavedTheme[]>(
	// Themes the ephemeral example overlay contributes join the list here
	// rather than inside `loadThemes()`: that function's `null` return is what
	// tells `buildInitialThemes` a library has never been initialized, and an
	// overlay must not disguise a first run as an existing one.
	() => overlayThemes(buildInitialThemes()),
	// A hosted backend stores the raw saved-themes list. What's local-only is
	// the one-shot legacy single-`theme`-key upgrade inside
	// `buildInitialThemes` (a backend never held that key). Normalization and
	// the system-theme guarantee apply to BOTH paths — remote lists can be
	// just as sparse as local ones (they're the same JSON, synced) — and the
	// `_v` content migrations are handled a layer down, in httpAdapter.
	async (adapter) => {
		const stored = await adapter.loadThemes()
		return stored
			? withSystemThemes(normalizeSavedThemes(stored))
			: buildInitialThemes()
	},
	(adapter, themes) => adapter.saveThemes(themes)
)

/** The user's font library — Google Fonts added via Settings → Fonts.
 * Every Family picker appends these to the built-in FONT_FAMILY_OPTIONS
 * (useFontOptions.ts), and RootLayout registers their cached woff2 binaries
 * as FontFaces so charts render them everywhere, embeds included. */
export const userFontsAtom = contentAtom<UserFont[]>(
	loadUserFonts,
	(adapter) => adapter.loadUserFonts(),
	(adapter, fonts) => adapter.saveUserFonts(fonts)
)

/** Which theme is starred as the default applied to new visualizations.
 * `null` means no explicit pick, in which case `system-light` is used as
 * the implicit default. Browser-local builds keep this per-browser; in
 * server mode it is a SHARED, server-stored setting — everyone on the
 * server starts new visualizations from the same theme. */
export const userDefaultThemeIdAtom = contentAtom<string | null>(
	// A user pick wins; failing that the ephemeral examples' own default (so
	// the sandbox opens looking the way it shipped); failing that, system light.
	() =>
		loadUserDefaultThemeId() ?? seedUserDefaultThemeId() ?? SYSTEM_LIGHT_THEME.id,
	async (adapter) => (await adapter.loadUserDefaultThemeId()) ?? SYSTEM_LIGHT_THEME.id,
	(adapter, id) => adapter.saveUserDefaultThemeId(id)
)

/** Which theme is currently being edited in the Settings → Themes page.
 * Not persisted. Defaults to `null` so callers resolve the active theme
 * dynamically — system themes are read-only, so the resolver prefers the
 * first custom theme and only falls back to a system theme when no
 * custom theme exists yet. */
export const editingThemeIdAtom = atom<string | null>(null)

/** Which single managed theme the user has been granted edit access to,
 * after answering the administrator dialog for it.
 *
 * The honor-system half of managed themes: the app has no accounts, so the
 * gate is a dialog rather than an authorization check. Scoped to ONE theme
 * on purpose — a session-wide "unlocked" latch would let one "Yes,
 * proceed" quietly disarm the warning for every shared theme afterwards.
 * Deliberately NOT persisted, so a fresh tab re-locks. The two `isSystem`
 * themes are read-only regardless of what this holds. */
export const unlockedThemeIdAtom = atom<string | null>(null)

/** Which saved theme is applied to the visual currently being edited.
 * Persisted to the visual via {@link Visual.themeId}; the editor mirrors
 * the value here so the sidebar dropdown can read/write it without going
 * through the visuals atom. */
export const currentThemeIdAtom = atom<string | null>(null)

export const drawerOpenAtom = atom<boolean>(true)

/** Whether the Reshape (wide→long) options panel is showing under Data.
 * Toggled by the data tray's "Reshape" button and the panel's own "Save and
 * close" button. Intentionally NOT persisted: this is transient menu
 * visibility — the reshape itself lives in `currentReshapeConfigAtom` and
 * applies whenever columns are combined, menu open or not. */
export const reshapePanelOpenAtom = atom<boolean>(false)

/** Black-and-white preview toggle. Wraps the chart canvas in `filter:
 * grayscale(1)` so the user can spot color-only encodings during an
 * accessibility pass. Intentionally NOT persisted: this is a transient
 * "what would this look like in B&W?" check, not a saved theme setting. */
export const blackAndWhiteModeAtom = atom<boolean>(false)

/** The categorical legend entry the pointer is currently hovering, used to
 * highlight matching marks and dim the rest (the "hover over legend to
 * highlight visual elements" option). `field` is the encoded field NAME and
 * `value` its stringified category. Intentionally NOT persisted: transient
 * pointer state, cleared on mouse-leave. `null` = nothing hovered. */
export const hoveredLegendEntryAtom = atom<{ field: string; value: string } | null>(
	null
)

export const currentVisualNameAtom = persistedAtom<string>(
	loadCurrentVisualName,
	saveCurrentVisualName
)

export const currentChannelConfigsAtom = persistedAtom<ChannelConfigs>(
	loadCurrentChannelConfigs,
	saveCurrentChannelConfigs
)

export const currentMapConfigAtom = persistedAtom<MapConfig>(
	loadCurrentMapConfig,
	saveCurrentMapConfig
)

/** Per-visual wide→long reshape (melt) of the bound dataset: which columns
 * are kept as IDs, which combine into the variable/value pair, and the two
 * new column names. Applied at view-resolution time (see
 * `currentDatasetViewAtom`); the stored dataset rows stay wide. */
export const currentReshapeConfigAtom = persistedAtom<ReshapeConfig>(
	loadCurrentReshapeConfig,
	saveCurrentReshapeConfig
)

export const currentLabelsAtom = persistedAtom<LabelsConfig>(
	loadCurrentLabels,
	saveCurrentLabels
)

export const currentLegendConfigAtom = persistedAtom<LegendConfig>(
	loadCurrentLegend,
	saveCurrentLegend
)

export const currentTooltipConfigAtom = persistedAtom<TooltipConfig>(
	loadCurrentTooltip,
	saveCurrentTooltip
)

/** Per-visual Data Labels encoding (which dataset fields drive label x,
 * y, hue, size, text). Independent from `currentEncodingsAtom` so the
 * label layer can encode different fields than the main viz. */
export const currentDataLabelsEncodingsAtom =
	persistedAtom<DataLabelsEncodings>(
		loadCurrentDataLabelsEncodings,
		saveCurrentDataLabelsEncodings
	)

/** Per-visual Data Labels appearance + offsets + per-channel scale knobs
 * (color, font weight, x/y offset, size range, hue config). */
export const currentDataLabelsConfigAtom = persistedAtom<DataLabelsConfig>(
	loadCurrentDataLabelsConfig,
	saveCurrentDataLabelsConfig
)

/** Per-chart rectangle annotations (user-defined shaded regions or
 * highlight boxes overlaid on the plot). See `lib/annotationsConfig.ts`
 * for the data shape. */
export const currentAnnotationsAtom = persistedAtom<AnnotationsConfig>(
	loadCurrentAnnotations,
	saveCurrentAnnotations
)

/** Per-visual caption — a free-floating text box (long text) rendered inside
 * the plot SVG, defaulting to a centered position below the x-axis title. See
 * `lib/captionConfig.ts` for the data shape. */
export const currentCaptionConfigAtom = persistedAtom<CaptionConfig>(
	loadCurrentCaption,
	saveCurrentCaption
)

export const lastSavedAtAtom = atom<number | null>(null)

export const saveStatusAtom = atom<"idle" | "saving">("idle")

/** Last rendered panel inner dimensions (in px). PlotCanvas writes this
 *  after each layout pass; the facet options sidebar reads it so the
 *  Panel width / Panel height inputs can step UP/DOWN from the current
 *  auto-sized value instead of jumping to 0/1 on the first arrow press.
 *  Null when no faceted chart is currently rendered. */
export const currentRenderedPanelInnerDimsAtom = atom<{
	widthPx: number
	heightPx: number
} | null>(null)

/** Inner-grid slack the fixed-aspect-ratio shrink freed, published by
 *  PlotCanvas after each layout pass (mirrors
 *  `currentRenderedPanelInnerDimsAtom`). ChartCanvas pulls edge legends
 *  inward by half of it so they hug the figure instead of the canvas
 *  edge. Always {0,0} when the ratio is off. */
export const currentRenderedFigureSlackAtom = atom<{
	x: number
	y: number
}>({ x: 0, y: 0 })

/** Last rendered gradient-bar length (px along the bar's axis — height when
 *  the legend is stacked, width when horizontal). The legend's
 *  `GradientBarRamp` publishes it after each render so the Legend panel's
 *  "Bar length" input can show the auto size as its placeholder and step
 *  UP/DOWN from it instead of jumping to 0 on the first spinner press.
 *  Null until a gradient bar has rendered. */
export const currentRenderedGradientBarLengthAtom = atom<number | null>(null)

/** Last rendered caption box dimensions (in px) plus the canvas dims they
 *  were measured against. PlotCanvas writes this after each layout pass so the
 *  Caption panel's Width / Height inputs can step UP/DOWN from the current
 *  rendered size (converting to percent when that unit is selected) instead of
 *  jumping to 0/1 on the first arrow press. Null when no caption is rendered. */
export const currentRenderedCaptionBoxAtom = atom<{
	widthPx: number
	heightPx: number
	canvasWidth: number
	canvasHeight: number
} | null>(null)

/** Quick-start icon bar state. Tracks per-chart-type cycle position and a
 * "last set by scaffold" flag used to decide whether clicking another icon
 * needs a confirm prompt.
 *
 * Intentionally NOT persisted: each session starts at cycle position 0 for
 * every chart type, and the scaffold flag resets on reload. This keeps the
 * cycle predictable and avoids cross-session surprises. */
export type QuickStartState = {
	cyclePositions: Record<string, number>
	lastSetByScaffold: boolean
}

export const EMPTY_QUICK_START_STATE: QuickStartState = {
	cyclePositions: {},
	lastSetByScaffold: false,
}

export const quickStartStateAtom = atom<QuickStartState>(
	EMPTY_QUICK_START_STATE
)
