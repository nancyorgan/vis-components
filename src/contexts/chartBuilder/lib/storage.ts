/** vis-components localStorage layer.
 *
 *  Persistence pattern:
 *   - Entities that carry rich shape (visuals, datasets, channelConfigs,
 *     labels, etc.) go through `loadVersioned` / `saveVersioned` (see
 *     ./storage/versioning.ts). Each declares a `*_VERSION` constant and
 *     a `*_Migrations` array in ./storage/migrations.ts. Bumping the
 *     version requires appending a new entry to that array — see the
 *     header comment in migrations.ts for the contract.
 *   - Trivial scalars (sidebar width, drawer height, current visual id,
 *     etc.) keep the older `safeGet`/`safeSet` pair below. They have
 *     no shape to migrate, and adding wrapper overhead would be churn
 *     without value.
 *   - Legacy renamed entities (`projects` -> `visuals`,
 *     `currentProjectId` -> `currentVisualId`) keep their one-shot
 *     transparent fallback in the load function; the migrated payload
 *     is rewritten under the new key in versioned form.
 *
 *  When adding a new persisted entity that carries shape, prefer the
 *  versioned pattern — even if the migrations array starts empty. It's
 *  the difference between a future schema change being a 2-minute
 *  append and a panicked half-day of "what shape did we ship?"
 *
 *  Ephemeral examples: when the public example overlay is installed (see
 *  ./exampleOverlay.ts), the shipped examples are merged into the visuals /
 *  folders / datasets reads and stripped out of the matching writes, so they
 *  behave like ordinary rows in memory and never reach durable storage. Any
 *  NEW read or write of those entities has to go through the same pair. */

import { stringifyJsonDangerous } from "../../../lib/json"
import {
	DEFAULT_ANNOTATIONS_CONFIG,
	type AnnotationsConfig,
} from "./annotationsConfig"
import { DEFAULT_CAPTION_CONFIG, type CaptionConfig } from "./captionConfig"

import type { ChannelConfigs, DataLabelsConfig } from "./channelConfig"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
} from "./channelConfig"
import { DEFAULT_MAP_CONFIG, type MapConfig } from "./mapConfig"
import { DEFAULT_RESHAPE_CONFIG, type ReshapeConfig } from "./reshape"
import type { LabelsConfig, LegendConfig, TooltipConfig } from "./labelsConfig"
import {
	DEFAULT_LABELS_CONFIG,
	DEFAULT_LEGEND_CONFIG,
	DEFAULT_TOOLTIP_CONFIG,
} from "./labelsConfig"
import {
	channelConfigsMigrations,
	CHANNEL_CONFIGS_VERSION,
	dataLabelsConfigMigrations,
	dataLabelsEncodingsMigrations,
	DATA_LABELS_CONFIG_VERSION,
	DATA_LABELS_ENCODINGS_VERSION,
	datasetBodyMigrations,
	datasetsMigrations,
	annotationsMigrations,
	ANNOTATIONS_VERSION,
	captionMigrations,
	CAPTION_VERSION,
	DATASETS_VERSION,
	embedInstancesMigrations,
	EMBED_INSTANCES_VERSION,
	encodingsMigrations,
	ENCODINGS_VERSION,
	fieldLevelOrdersMigrations,
	fieldOverridesMigrations,
	FIELD_LEVEL_ORDERS_VERSION,
	FIELD_OVERRIDES_VERSION,
	labelsMigrations,
	LABELS_VERSION,
	mapConfigMigrations,
	MAP_CONFIG_VERSION,
	reshapeConfigMigrations,
	RESHAPE_CONFIG_VERSION,
	legendMigrations,
	LEGEND_VERSION,
	themesMigrations,
	THEMES_VERSION,
	userFontsMigrations,
	USER_FONTS_VERSION,
	tooltipMigrations,
	TOOLTIP_VERSION,
	visualsMigrations,
	VISUALS_VERSION,
} from "./storage/migrations"
import { datasetIndexFrom, datasetMetaFrom } from "./datasetMeta"
import { syncDatasetVersions } from "./storage/syncDatasetVersions"
import { idbAvailable, idbDelete, idbGet, idbSet } from "./storage/idb"
import {
	overlayDatasets,
	overlayDatasetIndex,
	overlayFolders,
	overlayVisuals,
	promoteSeedReferences,
	seedDataset,
	stripSeedDatasets,
	stripSeedFolders,
	stripSeedThemes,
	stripSeedVisuals,
	type SeedPromotions,
} from "./exampleOverlay"
import type { UserFont } from "./fontLibrary"
import {
	loadVersioned,
	migrateVersioned,
	saveVersioned,
} from "./storage/versioning"
import type {
	DataLabelsEncodings,
	Dataset,
	EmbedInstance,
	DatasetMeta,
	Encodings,
	FieldType,
	Folder,
	SavedTheme,
	Theme,
	Visual,
} from "./types"
import { emptyDataLabelsEncodings, emptyEncodings } from "./types"

const KEY_VISUALS = "vis-components:visuals"
const KEY_THUMBNAILS = "vis-components:thumbnails"
const KEY_FOLDERS = "vis-components:folders"
const KEY_DATASETS = "vis-components:datasets"
/** Row-free metadata for every dataset, in one small record. Read at boot. */
const KEY_DATASET_INDEX = "vis-components:datasetIndex"
/** One key per dataset body, so opening a visualization reads only its own
 *  rows instead of structured-cloning the entire corpus. */
const datasetBodyKey = (id: string): string => `vis-components:dataset:${id}`
/** One key per dataset VERSION's rows, so opening a visualization reads the
 *  version it draws rather than the whole upload history. */
const datasetVersionKey = (id: string, versionId: string): string =>
	`vis-components:dataset:${id}:v:${versionId}`
const KEY_EMBED_INSTANCES = "vis-components:embedInstances"
const KEY_CURRENT_VISUAL = "vis-components:currentVisualId"
const KEY_CURRENT_DATASET = "vis-components:currentDatasetId"
const KEY_CURRENT_VISUAL_NAME = "vis-components:currentVisualName"
const KEY_CURRENT_ENCODINGS = "vis-components:currentEncodings"
const KEY_CURRENT_FIELD_OVERRIDES = "vis-components:currentFieldOverrides"
const KEY_CURRENT_FIELD_LEVEL_ORDERS = "vis-components:currentFieldLevelOrders"
const KEY_CURRENT_CHANNEL_CONFIGS = "vis-components:currentChannelConfigs"
const KEY_CURRENT_MAP_CONFIG = "vis-components:currentMapConfig"
const KEY_CURRENT_RESHAPE_CONFIG = "vis-components:currentReshapeConfig"
const KEY_CURRENT_LABELS = "vis-components:currentLabels"
const KEY_CURRENT_LEGEND = "vis-components:currentLegend"
const KEY_CURRENT_TOOLTIP = "vis-components:currentTooltip"
const KEY_CURRENT_DATA_LABELS_ENCODINGS =
	"vis-components:currentDataLabelsEncodings"
const KEY_CURRENT_DATA_LABELS_CONFIG = "vis-components:currentDataLabelsConfig"
const KEY_CURRENT_ANNOTATIONS = "vis-components:currentAnnotations"
const KEY_CURRENT_CAPTION = "vis-components:currentCaption"
const KEY_PREVIEW_VERSION_ID = "vis-components:previewVersionId"
const KEY_DRAWER_HEIGHT = "vis-components:drawerHeight"
const KEY_SIDEBAR_WIDTH = "vis-components:sidebarWidth"
const KEY_LIBRARY_SIDEBAR_WIDTH = "vis-components:librarySidebarWidth"
const KEY_LIBRARY_COLLAPSED_FOLDERS = "vis-components:libraryCollapsedFolders"
const KEY_LIBRARY_SELECTED_FOLDER = "vis-components:librarySelectedFolderId"
const KEY_SIDEBAR_COLLAPSED = "vis-components:sidebarCollapsed"
const KEY_EXPORT_SIZES = "vis-components:exportSizes"
const KEY_EXPORT_UNIT = "vis-components:exportUnit"
const KEY_THEME = "vis-components:theme"
const KEY_THEMES = "vis-components:themes"
const KEY_USER_FONTS = "vis-components:userFonts"
const KEY_USER_DEFAULT_THEME_ID = "vis-components:userDefaultThemeId"
const KEY_EXAMPLE_SEED_APPLIED = "vis-components:exampleSeedApplied"
const KEY_DATASET_CLEANUP_DONE = "vis-components:datasetCleanupDone"

// Legacy keys — read once on first load, then rewritten under new keys.
// Pre-rename, the entity was called "Project". Old localStorage data is
// migrated transparently so existing users don't lose work.
const LEGACY_KEY_PROJECTS = "vis-components:projects"
const LEGACY_KEY_CURRENT_PROJECT = "vis-components:currentProjectId"

// Direct localStorage is the intended persistence layer for vis-components;
// the restricted-globals rule from the shared ESLint config prefers a wrapped
// storage API we don't have here. Narrowly disable it for this file.
/* eslint-disable no-restricted-globals */

const safeGet = <T>(key: string, fallback: T): T => {
	try {
		const raw = localStorage.getItem(key)
		if (raw === null) return fallback
		return JSON.parse(raw) as T
	} catch {
		return fallback
	}
}

const safeRawGet = (key: string): string | null => {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

const safeSet = (key: string, value: unknown): void => {
	try {
		localStorage.setItem(key, stringifyJsonDangerous(value as never))
	} catch (error) {
		// Quota exceeded or localStorage unavailable. Log so the user can see
		// why a save isn't sticking — silent failure here would look like
		// "I hit save, but the visual disappears on refresh".
		// eslint-disable-next-line no-console
		console.error(`[vis-components] failed to write "${key}":`, error)
	}
}

/** Write an already-serialized string back verbatim (or remove the key when
 *  `null`) — the restore half of `snapshotDraftState`. */
const safeRawSet = (key: string, raw: string | null): void => {
	try {
		if (raw === null) localStorage.removeItem(key)
		else localStorage.setItem(key, raw)
	} catch {
		// best-effort — a failed restore just leaves the backfill's last
		// loaded visual as the draft, same as before the snapshot existed
	}
}

/* eslint-enable no-restricted-globals */

/** Read visuals — durable rows plus, when the ephemeral example overlay is
 *  installed, the shipped examples merged in from memory (see
 *  ./exampleOverlay.ts). The overlay is applied at the storage seam rather
 *  than in the atoms so the synchronous bootstrap read and the storage
 *  adapter's async read (which delegates here) see the same library. */
export const loadVisuals = (): Visual[] => overlayVisuals(loadPersistedVisuals())

/** Read visuals. Handles the legacy "projects" key rename and the
 *  versioned upgrade from pre-versioning shapes via the migrations
 *  registry in storage/migrations.ts. */
const loadPersistedVisuals = (): Visual[] => {
	const fromCurrent = safeRawGet(KEY_VISUALS)
	if (fromCurrent !== null) {
		return loadVersioned<Visual[]>({
			key: KEY_VISUALS,
			currentVersion: VISUALS_VERSION,
			migrations: visualsMigrations,
			fallback: [],
		})
	}
	// Renamed entity: pre-rename, visuals were stored under the "projects"
	// key. Transparently migrate on first read. After this one-shot copy,
	// subsequent loads go through the standard versioned path above.
	const legacyRaw = safeRawGet(LEGACY_KEY_PROJECTS)
	if (legacyRaw === null) return []
	try {
		const parsed = JSON.parse(legacyRaw)
		// Legacy pre-rename data is at v0 — run the FULL migration chain (not
		// just the first step) before stamping VISUALS_VERSION, or later
		// migrations would be silently skipped for this path.
		const migrated = migrateVersioned<Visual[]>(
			parsed,
			VISUALS_VERSION,
			visualsMigrations,
			[]
		)
		saveVersioned({
			key: KEY_VISUALS,
			currentVersion: VISUALS_VERSION,
			data: migrated,
		})
		return migrated
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("[vis-components] loadVisuals: legacy parse failed —", error)
		return []
	}
}

/** Thumbnails live in an IndexedDB side-table, NOT in the localStorage
 *  visuals blob. Inline PNG data URLs (~15KB each) were what pushed the
 *  shared ~5MB quota over the edge once enough visuals accumulated, and the
 *  old quota fallback stripped older previews to make the write fit — the
 *  recurring "all my thumbnails disappeared" bug. The localStorage payload is
 *  now always written thumbnail-free, so it can't outgrow quota on previews.
 *
 *  Ephemeral seed examples are dropped here (and so are their thumbnails,
 *  which stay served from the in-memory bundle) — editing one dirties memory
 *  only. A COPY of one is the user's own work and survives the strip, so
 *  whatever it still points at in the overlay is promoted to real storage
 *  first or it would dangle after the next reload. */
export const saveVisuals = (visuals: Visual[]): Promise<void> => {
	const own = stripSeedVisuals(visuals)
	saveVersioned({
		key: KEY_VISUALS,
		currentVersion: VISUALS_VERSION,
		data: own.map((v) => (v.thumbnail === null ? v : { ...v, thumbnail: null })),
	})
	// Returned so callers that must observe the thumbnail side-table write
	// (the example-seed bootstrap, which runs before first render) can await
	// it; regular save paths ignore the promise as before.
	return Promise.all([
		saveThumbnailsAsync(own),
		persistSeedPromotions(promoteSeedReferences({ visuals: own })),
	]).then(() => undefined)
}

/** Make promoted seed rows durable. Each collection is re-saved through its
 *  normal path: the ids are adopted by now, so the strip that path performs
 *  leaves them alone. No-op (and no reads) when nothing was promoted. */
const persistSeedPromotions = async (
	promotions: SeedPromotions | null
): Promise<void> => {
	if (promotions === null) return
	if (promotions.folders.length > 0) {
		const byId = new Map(loadFolders().map((f) => [f.id, f]))
		for (const folder of promotions.folders) byId.set(folder.id, folder)
		saveFolders([...byId.values()])
	}
	if (promotions.themes.length > 0) {
		const byId = new Map((loadThemes() ?? []).map((t) => [t.id, t]))
		for (const theme of promotions.themes) byId.set(theme.id, theme)
		saveThemes([...byId.values()])
	}
	if (Object.keys(promotions.datasets).length > 0) {
		if (idbAvailable()) {
			// Upsert-only save: it merges into the stored index and writes only
			// the bodies it is given, so the promoted datasets alone suffice —
			// no whole-corpus read.
			await saveDatasetsAsync(promotions.datasets)
		} else {
			saveDatasetsLocalFallback({
				...loadDatasets(),
				...promotions.datasets,
			})
		}
	}
}

/** Load the thumbnail side-table (visual id → PNG data URL) from IndexedDB. */
export const loadThumbnailsAsync = async (): Promise<
	Record<string, string>
> => (await idbGet<Record<string, string>>(KEY_THUMBNAILS)) ?? {}

/** Serialize thumbnail writes. Each write is a read-merge-prune-write cycle;
 *  two of them interleaving (autosave fires often) could resurrect a deleted
 *  entry or drop a fresh one. The queue never rejects — the idb wrapper
 *  swallows its own errors. */
let thumbnailWriteQueue: Promise<void> = Promise.resolve()

const saveThumbnailsAsync = (visuals: Visual[]): Promise<void> => {
	if (!idbAvailable()) return Promise.resolve()
	thumbnailWriteQueue = thumbnailWriteQueue.then(async () => {
		const stored =
			(await idbGet<Record<string, string>>(KEY_THUMBNAILS)) ?? {}
		// In-memory thumbnails win; fall back to the stored copy so a save that
		// fires before the async IndexedDB merge lands (when the in-memory list
		// still has nulls) can't wipe previews. Ids absent from `visuals` drop
		// out — that's how deleted visuals release their thumbnails.
		const next: Record<string, string> = {}
		for (const v of visuals) {
			const thumb = v.thumbnail ?? stored[v.id]
			if (thumb) next[v.id] = thumb
		}
		await idbSet(KEY_THUMBNAILS, next)
	})
	return thumbnailWriteQueue
}

/** Fill thumbnail-less visuals from the IndexedDB side-table. In-memory
 *  thumbnails are fresher and win; entries stay reference-equal when there is
 *  nothing to fill. */
export const mergeThumbnails = (
	visuals: Visual[],
	thumbnails: Record<string, string>
): Visual[] =>
	visuals.map((v) =>
		v.thumbnail || !thumbnails[v.id]
			? v
			: { ...v, thumbnail: thumbnails[v.id] }
	)

export const loadFolders = (): Folder[] =>
	overlayFolders(safeGet<Folder[]>(KEY_FOLDERS, []))

/** Ephemeral seed folders never persist; a folder of the user's own nested
 *  under one promotes that parent chain (see `persistSeedPromotions`) so the
 *  tree can't lose its root on reload. */
export const saveFolders = (folders: Folder[]): void => {
	const own = stripSeedFolders(folders)
	safeSet(KEY_FOLDERS, own)
	void persistSeedPromotions(promoteSeedReferences({ folders: own }))
}

/** Synchronous read of the LEGACY localStorage copy of datasets. Datasets now
 * live in IndexedDB (`loadDatasetsAsync`), but this is still used as a fast
 * synchronous bootstrap on first render and as the source for the one-time
 * localStorage → IndexedDB migration. */
export const loadDatasets = (): Record<string, Dataset> =>
	overlayDatasets(loadPersistedDatasets())

const loadPersistedDatasets = (): Record<string, Dataset> =>
	loadVersioned<Record<string, Dataset>>({
		key: KEY_DATASETS,
		currentVersion: DATASETS_VERSION,
		migrations: datasetsMigrations,
		fallback: {},
	})

/** Remove the legacy localStorage datasets blob (after a successful migration
 * to IndexedDB) so it stops consuming the shared ~5 MB localStorage quota. */
const clearLegacyDatasets = (): void => {
	try {
		// eslint-disable-next-line no-restricted-globals
		localStorage.removeItem(KEY_DATASETS)
	} catch {
		// ignore — nothing we can do, and it's only a cleanup step
	}
}

/**
 * EVERY dataset, rows included. Kept for the one caller that genuinely needs
 * the whole corpus — library bundle export, which is a full backup. Nothing on
 * a render path may call this: use `loadDatasetIndexAsync` to list, and
 * `loadDatasetAsync` to pull the one body a chart is about to draw.
 *
 * Seed datasets from the ephemeral overlay join the result in memory — they
 * are readable everywhere a stored dataset is, but the split (and every save)
 * works off the persisted copy alone.
 */
export const loadDatasetsAsync = async (): Promise<Record<string, Dataset>> => {
	if (!idbAvailable()) return loadDatasets()
	const index = await readStoredIndex()
	if (index === null) {
		// Not split yet (or nothing stored at all) — the legacy blob already
		// holds every body, and splitting it here means the next load is fast.
		return overlayDatasets(await splitLegacyDatasetBlob())
	}
	const bodies = await Promise.all(
		Object.keys(index).map(async (id) => [id, await loadDatasetAsync(id)] as const)
	)
	const datasets: Record<string, Dataset> = {}
	for (const [id, dataset] of bodies) if (dataset) datasets[id] = dataset
	// All-or-nothing, like the single-blob read this replaced: a dataset the
	// index lists but whose body can't be read means the corpus in hand is
	// incomplete, and returning it anyway would let an export silently omit a
	// dataset the library still shows — a backup discovered short only after
	// the original store is gone.
	const missing = Object.keys(index).filter((id) => !datasets[id])
	if (missing.length > 0) {
		throw new Error(
			`the stored body of ${missing.length === 1 ? "data set" : "data sets"} ` +
				`${missing.join(", ")} could not be read — refusing to return a ` +
				`partial library`
		)
	}
	return overlayDatasets(datasets)
}

/** WEAK references to the bodies currently on disk, by id. A whole-map save
 *  diffs against this and writes only the datasets whose object identity
 *  actually changed — without it, renaming one dataset would rewrite every
 *  body in the store. The atoms treat datasets immutably, so identity is a
 *  sound proxy for "changed". Weak so that merely OPENING datasets never pins
 *  their rows on the heap for the tab's life; a GC'd entry just re-writes,
 *  which is harmless. Seeded from every read. */
const persistedBodies = new Map<string, WeakRef<Dataset>>()

/** Same idea per version: the rows arrays this module last wrote, so a save
 *  skips version keys whose rows didn't change — a rename writes no rows at
 *  all. Keyed `<datasetId>:<versionId>`. */
const persistedVersionRows = new Map<string, WeakRef<object>>()

/** Persist datasets to IndexedDB, one key per body plus the shared index.
 *  No-op (without error noise) when IndexedDB is unavailable — the SSR/test
 *  environments, where cross-reload persistence isn't expected. Ephemeral
 *  seed datasets are stripped: they exist only in the overlay, so a whole-map
 *  save can't leak them into durable storage. */
export const saveDatasetsAsync = async (
	datasets: Record<string, Dataset>
): Promise<void> => {
	if (!idbAvailable()) return
	const own = stripSeedDatasets(datasets)

	// Read the stored index up front: it names the version keys each changed
	// dataset held before this write, which is how removed versions' keys get
	// deleted rather than lingering in IndexedDB forever.
	const storedIndex = (await readStoredIndex()) ?? {}

	const writes: Promise<boolean>[] = []
	for (const [id, dataset] of Object.entries(own)) {
		if (persistedBodies.get(id)?.deref() === dataset) continue
		writes.push(
			idbSet(datasetBodyKey(id), { _v: DATASETS_VERSION, data: dataset }).then(
				(wrote) => {
					if (wrote) persistedBodies.set(id, new WeakRef(dataset))
					return wrote
				}
			)
		)
		// Keep the per-version keys in step with the body, or a later
		// version read would serve rows from before this write.
		writes.push(splitDatasetVersions(dataset, storedIndex[id]).then(() => true))
	}
	const results = await Promise.all(writes)
	// Merged into the stored index, never substituted for it: `own` holds only
	// the bodies this session loaded, so replacing the index wholesale would
	// erase every dataset the user simply hadn't opened. Deletion goes through
	// `deleteDatasetsAsync`.
	const indexWritten = await idbSet(KEY_DATASET_INDEX, {
		_v: DATASETS_VERSION,
		data: { ...storedIndex, ...datasetIndexFrom(own) },
	})

	if (!indexWritten || results.some((wrote) => !wrote)) {
		// eslint-disable-next-line no-console
		console.error(
			"[vis-components] failed to persist datasets to IndexedDB — your data may not survive a reload"
		)
	}
}

/** The stored metadata index exactly as persisted — no seed overlay, no
 *  legacy split. `null` when nothing is stored yet.
 *
 *  The index (like the per-version keys) is a DERIVED CACHE of the body
 *  keys, which are the authoritative, migratable record. It is version-
 *  tagged but never migrated: on a tag mismatch it is rebuilt from the
 *  bodies — which flow through the real `datasetsMigrations` — and written
 *  back, so a `DATASETS_VERSION` bump can never leave stale-shaped metadata
 *  being served as current. */
const readStoredIndex = async (): Promise<Record<
	string,
	DatasetMeta
> | null> => {
	const stored = await idbGet<{
		_v?: number
		data?: Record<string, DatasetMeta>
	}>(KEY_DATASET_INDEX)
	if (stored === null) return null
	if (stored._v === DATASETS_VERSION && stored.data) return stored.data

	// Stale tag: rebuild from the bodies the stale index names. Ids are the
	// one thing safe to read out of an old-shaped index.
	const rebuilt: Record<string, DatasetMeta> = {}
	for (const id of Object.keys(stored.data ?? {})) {
		const body = await loadDatasetAsync(id)
		if (body) rebuilt[id] = datasetMetaFrom(body)
	}
	await idbSet(KEY_DATASET_INDEX, { _v: DATASETS_VERSION, data: rebuilt })
	return rebuilt
}

/** Remove datasets outright: their bodies and their index entries. The only
 *  path that deletes datasets — a whole-map save never does, because the map
 *  it is given holds only the bodies this session happened to load. */
export const deleteDatasetsAsync = async (
	ids: readonly string[]
): Promise<void> => {
	if (!idbAvailable() || ids.length === 0) return
	const doomed = new Set(ids)
	const storedIndexBefore = (await readStoredIndex()) ?? {}
	await Promise.all(
		ids.map(async (id) => {
			// Version keys first, while the index still names them — afterwards
			// they'd be unreachable and would sit in IndexedDB forever.
			for (const version of storedIndexBefore[id]?.versions ?? []) {
				await idbDelete(datasetVersionKey(id, version.id))
				persistedVersionRows.delete(`${id}:${version.id}`)
			}
			await idbDelete(datasetBodyKey(id))
			persistedBodies.delete(id)
		})
	)
	const storedIndex = storedIndexBefore
	await idbSet(KEY_DATASET_INDEX, {
		_v: DATASETS_VERSION,
		data: Object.fromEntries(
			Object.entries(storedIndex).filter(([id]) => !doomed.has(id))
		),
	})
}

/** One-time split of the legacy single-blob store into per-dataset keys.
 *  Runs when the index is absent but the old blob is present. The blob is
 *  removed only after every body and the index have been confirmed written,
 *  so an interrupted migration simply retries on the next load. */
const splitLegacyDatasetBlob = async (): Promise<Record<string, Dataset>> => {
	const legacy = await loadLegacyDatasetBlob()
	if (Object.keys(legacy).length === 0) return {}

	const wrote = await Promise.all(
		Object.entries(legacy).map(([id, dataset]) =>
			idbSet(datasetBodyKey(id), { _v: DATASETS_VERSION, data: dataset })
		)
	)
	const indexWritten = await idbSet(KEY_DATASET_INDEX, {
		_v: DATASETS_VERSION,
		data: datasetIndexFrom(legacy),
	})
	if (indexWritten && wrote.every(Boolean)) {
		for (const [id, dataset] of Object.entries(legacy)) {
			persistedBodies.set(id, new WeakRef(dataset))
		}
		await idbDelete(KEY_DATASETS)
		clearLegacyDatasets()
	}
	return legacy
}

/** The pre-split store: the IndexedDB blob if present, else the even older
 *  localStorage blob. Rows included. */
const loadLegacyDatasetBlob = async (): Promise<Record<string, Dataset>> => {
	const fromIdb = await idbGet<unknown>(KEY_DATASETS)
	if (fromIdb !== null) {
		return migrateVersioned<Record<string, Dataset>>(
			fromIdb,
			DATASETS_VERSION,
			datasetsMigrations,
			{},
			undefined,
			undefined,
			KEY_DATASETS
		)
	}
	return loadPersistedDatasets()
}

/** One VERSION's rows.
 *
 *  Reads the per-version key when it exists. When it doesn't — every version
 *  of every dataset stored before the split — the whole dataset is read once,
 *  its versions are written out individually, and the requested rows are
 *  returned. So the first open of an old dataset costs what it always did and
 *  every open after it costs one version. */
export const loadDatasetVersionAsync = async (
	id: string,
	versionId: string
): Promise<Array<Record<string, string>> | null> => {
	const seeded = seedDataset(id)
	if (seeded) {
		return seeded.versions.find((v) => v.id === versionId)?.rows ?? null
	}
	if (!idbAvailable()) {
		return (
			loadDatasets()[id]?.versions.find((v) => v.id === versionId)?.rows ?? null
		)
	}

	const stored = await idbGet<{
		_v?: number
		rows?: Array<Record<string, string>>
	}>(datasetVersionKey(id, versionId))
	// The tag gates the cache: per-version keys are never migrated, so a key
	// written under an older DATASETS_VERSION is treated as absent — the body
	// below flows through the real migrations and the re-split overwrites it.
	if (stored !== null && stored._v === DATASETS_VERSION) {
		return stored.rows ?? []
	}

	const dataset = await loadDatasetAsync(id)
	if (!dataset) return null
	await splitDatasetVersions(dataset)
	return dataset.versions.find((v) => v.id === versionId)?.rows ?? null
}

/** Write each of a dataset's versions to its own key and delete the keys of
 *  versions `priorMeta` names that no longer exist. The diff/delete rules
 *  live in the shared `syncDatasetVersions` (one implementation for this
 *  layer and the HTTP adapter); this wires it to IndexedDB. Best-effort: a
 *  failed idb write resolves false (nothing recorded, next read falls back
 *  to the whole body), and idb never throws. */
const splitDatasetVersions = (
	dataset: Dataset,
	priorMeta?: DatasetMeta
): Promise<void> =>
	syncDatasetVersions(
		dataset,
		priorMeta?.versions.map((v) => v.id),
		{
			putVersion: (version) =>
				idbSet(datasetVersionKey(dataset.id, version.id), {
					_v: DATASETS_VERSION,
					rows: version.rows,
				}),
			deleteVersion: async (versionId) => {
				await idbDelete(datasetVersionKey(dataset.id, versionId))
			},
		},
		persistedVersionRows
	)

/** Row-free metadata for every dataset. This is the boot read — it never
 *  touches a single body. Seeded overlay datasets join in memory, exactly as
 *  they do for the full load. */
export const loadDatasetIndexAsync = async (): Promise<
	Record<string, DatasetMeta>
> => {
	if (!idbAvailable()) return datasetIndexFrom(loadDatasets())
	const index = await readStoredIndex()
	if (index !== null) return overlayDatasetIndex(index)
	return overlayDatasetIndex(datasetIndexFrom(await splitLegacyDatasetBlob()))
}

/** One dataset's rows. `null` when the id isn't in the store. */
export const loadDatasetAsync = async (id: string): Promise<Dataset | null> => {
	const seeded = seedDataset(id)
	if (seeded) return seeded
	if (!idbAvailable()) return loadDatasets()[id] ?? null

	const stored = await idbGet<unknown>(datasetBodyKey(id))
	if (stored !== null) {
		// Per-BODY migrations: this key holds one Dataset, not the legacy
		// whole-record blob, so it must flow through the single-body steps
		// (datasetsMigrations is the record-shaped derivation of the same
		// steps and would corrupt a lone body).
		const dataset = migrateVersioned<Dataset | null>(
			stored,
			DATASETS_VERSION,
			datasetBodyMigrations,
			null,
			undefined,
			undefined,
			datasetBodyKey(id)
		)
		if (dataset) persistedBodies.set(id, new WeakRef(dataset))
		return dataset
	}
	// No per-key body yet — a store that hasn't been split, or a first read
	// racing the split. Fall back to the legacy blob rather than reporting the
	// dataset missing.
	return (await splitLegacyDatasetBlob())[id] ?? null
}

export const loadEmbedInstances = (): Record<string, EmbedInstance> =>
	loadVersioned<Record<string, EmbedInstance>>({
		key: KEY_EMBED_INSTANCES,
		currentVersion: EMBED_INSTANCES_VERSION,
		migrations: embedInstancesMigrations,
		fallback: {},
	})

export const saveEmbedInstances = (
	instances: Record<string, EmbedInstance>
): void =>
	saveVersioned({
		key: KEY_EMBED_INSTANCES,
		currentVersion: EMBED_INSTANCES_VERSION,
		data: instances,
	})

/** Read current visual id, transparently migrating from the legacy key. */
export const loadCurrentVisualId = (): string | null => {
	const current = safeRawGet(KEY_CURRENT_VISUAL)
	if (current !== null) {
		try {
			return JSON.parse(current) as string | null
		} catch {
			return null
		}
	}
	const legacy = safeGet<string | null>(LEGACY_KEY_CURRENT_PROJECT, null)
	if (legacy !== null) safeSet(KEY_CURRENT_VISUAL, legacy)
	return legacy
}
export const saveCurrentVisualId = (id: string | null): void =>
	safeSet(KEY_CURRENT_VISUAL, id)

export const loadDrawerHeight = (): number =>
	safeGet<number>(KEY_DRAWER_HEIGHT, 240)
export const saveDrawerHeight = (h: number): void =>
	safeSet(KEY_DRAWER_HEIGHT, h)

/** 344 = the sidebar content floor (Sidebar's `min-w-80`, 320px) + the
 * aside's `px-2` (16px) + 8px of slack, so a fresh editor opens showing every
 * control row in full rather than with a horizontal scrollbar. */
export const loadSidebarWidth = (): number =>
	safeGet<number>(KEY_SIDEBAR_WIDTH, 344)
export const saveSidebarWidth = (w: number): void =>
	safeSet(KEY_SIDEBAR_WIDTH, w)

export const loadLibrarySidebarWidth = (): number =>
	safeGet<number>(KEY_LIBRARY_SIDEBAR_WIDTH, 208)
export const saveLibrarySidebarWidth = (w: number): void =>
	safeSet(KEY_LIBRARY_SIDEBAR_WIDTH, w)

/** Which library-sidebar folders are collapsed (stored as an id array —
 * Sets don't survive JSON). Device-local UI state, like the widths above. */
export const loadLibraryCollapsedFolders = (): ReadonlySet<string> =>
	new Set(safeGet<string[]>(KEY_LIBRARY_COLLAPSED_FOLDERS, []))
export const saveLibraryCollapsedFolders = (v: ReadonlySet<string>): void =>
	safeSet(KEY_LIBRARY_COLLAPSED_FOLDERS, [...v])

/** Folder the library grid was last filtered to (null = all visuals). */
export const loadLibrarySelectedFolderId = (): string | null =>
	safeGet<string | null>(KEY_LIBRARY_SELECTED_FOLDER, null)
export const saveLibrarySelectedFolderId = (id: string | null): void =>
	safeSet(KEY_LIBRARY_SELECTED_FOLDER, id)

export const loadSidebarCollapsed = (): Record<string, boolean> =>
	safeGet<Record<string, boolean>>(KEY_SIDEBAR_COLLAPSED, {})
export const saveSidebarCollapsed = (v: Record<string, boolean>): void =>
	safeSet(KEY_SIDEBAR_COLLAPSED, v)

/** Last dimensions the user actually exported a visual at — the Export
 * modal reopens at these instead of the defaults. Keyed by visual id. */
export type ExportSize = {
	width: number
	height: number
	aspectLocked: boolean
}
export const loadExportSizes = (): Record<string, ExportSize> =>
	safeGet<Record<string, ExportSize>>(KEY_EXPORT_SIZES, {})
export const saveExportSizes = (v: Record<string, ExportSize>): void =>
	safeSet(KEY_EXPORT_SIZES, v)

/** Unit the Export modal's dimension inputs display in. Display-only — sizes
 * are stored and exported in px regardless. Device-local UI state, like the
 * sidebar widths. */
export type ExportUnit = "px" | "in" | "cm"
export const loadExportUnit = (): ExportUnit =>
	safeGet<ExportUnit>(KEY_EXPORT_UNIT, "px")
export const saveExportUnit = (v: ExportUnit): void =>
	safeSet(KEY_EXPORT_UNIT, v)

export const loadTheme = (): Theme | null =>
	safeGet<Theme | null>(KEY_THEME, null)
export const saveTheme = (theme: Theme | null): void =>
	safeSet(KEY_THEME, theme)

/** Saved-themes array (system + user-defined). Persists across sessions
 * so the user's named themes survive reloads. `null` means "not yet
 * initialized" — the caller seeds the bundled system themes on first
 * use. */
export const loadThemes = (): SavedTheme[] | null =>
	loadVersioned<SavedTheme[] | null>({
		key: KEY_THEMES,
		currentVersion: THEMES_VERSION,
		migrations: themesMigrations,
		fallback: null,
	})
export const saveThemes = (themes: SavedTheme[]): void =>
	saveVersioned({
		key: KEY_THEMES,
		currentVersion: THEMES_VERSION,
		// Themes the ephemeral overlay contributes are session-only. Note the
		// READ side is overlaid in the themes atom, not here: `null` from
		// `loadThemes` means "never initialized", which is what drives the
		// atom's first-run system-theme construction.
		data: stripSeedThemes(themes),
	})

/** The user's font library — Google Fonts added once and offered in every
 * Family picker. Metadata only; woff2 binaries cache in IndexedDB keyed by
 * face URL (fontBinaries.ts). */
export const loadUserFonts = (): UserFont[] =>
	loadVersioned<UserFont[]>({
		key: KEY_USER_FONTS,
		currentVersion: USER_FONTS_VERSION,
		migrations: userFontsMigrations,
		fallback: [],
	})
export const saveUserFonts = (fonts: UserFont[]): void =>
	saveVersioned({
		key: KEY_USER_FONTS,
		currentVersion: USER_FONTS_VERSION,
		data: fonts,
	})

export const loadUserDefaultThemeId = (): string | null =>
	safeGet<string | null>(KEY_USER_DEFAULT_THEME_ID, null)
export const saveUserDefaultThemeId = (id: string | null): void =>
	safeSet(KEY_USER_DEFAULT_THEME_ID, id)

/** `exportedAt` stamp of the example seed that was last applied in this
 * browser. Lets a recipient delete the bundled examples without them
 * resurrecting on the next load — the seed only re-applies when a NEW
 * export (different stamp) arrives AND the library is empty. */
export const loadExampleSeedApplied = (): string | null =>
	safeGet<string | null>(KEY_EXAMPLE_SEED_APPLIED, null)
export const saveExampleSeedApplied = (stamp: string): void =>
	safeSet(KEY_EXAMPLE_SEED_APPLIED, stamp)

/** Version of the one-shot dataset-store cleanup (duplicate collapse +
 * orphan removal) that has already run in this browser. Bump the version
 * passed by the runner to re-run a future, stricter cleanup once. */
export const loadDatasetCleanupDone = (): number =>
	safeGet<number>(KEY_DATASET_CLEANUP_DONE, 0)
export const saveDatasetCleanupDone = (version: number): void =>
	safeSet(KEY_DATASET_CLEANUP_DONE, version)

/** Synchronous localStorage write of datasets — ONLY for environments
 * without IndexedDB (the example-seed bootstrap falls back to this so
 * seeded datasets still survive a reload there). Everywhere else datasets
 * persist via {@link saveDatasetsAsync}. */
export const saveDatasetsLocalFallback = (
	datasets: Record<string, Dataset>
): void =>
	saveVersioned({
		key: KEY_DATASETS,
		currentVersion: DATASETS_VERSION,
		data: stripSeedDatasets(datasets),
	})

// Draft editor state — persisted so a page refresh doesn't wipe unsaved work.
// Each of these is overwritten wholesale on visual load/reset.
export const loadCurrentDatasetId = (): string | null =>
	safeGet<string | null>(KEY_CURRENT_DATASET, null)
export const saveCurrentDatasetId = (id: string | null): void =>
	safeSet(KEY_CURRENT_DATASET, id)

export const loadCurrentVisualName = (): string =>
	safeGet<string>(KEY_CURRENT_VISUAL_NAME, "Untitled")
export const saveCurrentVisualName = (name: string): void =>
	safeSet(KEY_CURRENT_VISUAL_NAME, name)

export const loadCurrentEncodings = (): Encodings =>
	loadVersioned<Encodings>({
		key: KEY_CURRENT_ENCODINGS,
		currentVersion: ENCODINGS_VERSION,
		migrations: encodingsMigrations,
		fallback: emptyEncodings(),
	})
export const saveCurrentEncodings = (e: Encodings): void =>
	saveVersioned({
		key: KEY_CURRENT_ENCODINGS,
		currentVersion: ENCODINGS_VERSION,
		data: e,
	})

export const loadCurrentFieldOverrides = (): Record<string, FieldType> =>
	loadVersioned<Record<string, FieldType>>({
		key: KEY_CURRENT_FIELD_OVERRIDES,
		currentVersion: FIELD_OVERRIDES_VERSION,
		migrations: fieldOverridesMigrations,
		fallback: {},
	})
export const saveCurrentFieldOverrides = (v: Record<string, FieldType>): void =>
	saveVersioned({
		key: KEY_CURRENT_FIELD_OVERRIDES,
		currentVersion: FIELD_OVERRIDES_VERSION,
		data: v,
	})

/** Per-field user-pinned ordering of levels for categorical / ordinal
 * fields. Maps field name → ordered list of level values. Levels not in
 * the list fall back to the smart-sort default (which only fires for
 * ordinal — categorical levels keep discovery order otherwise). */
export const loadCurrentFieldLevelOrders = (): Record<string, string[]> =>
	loadVersioned<Record<string, string[]>>({
		key: KEY_CURRENT_FIELD_LEVEL_ORDERS,
		currentVersion: FIELD_LEVEL_ORDERS_VERSION,
		migrations: fieldLevelOrdersMigrations,
		fallback: {},
	})
export const saveCurrentFieldLevelOrders = (
	v: Record<string, string[]>
): void =>
	saveVersioned({
		key: KEY_CURRENT_FIELD_LEVEL_ORDERS,
		currentVersion: FIELD_LEVEL_ORDERS_VERSION,
		data: v,
	})

export const loadCurrentChannelConfigs = (): ChannelConfigs =>
	loadVersioned<ChannelConfigs>({
		key: KEY_CURRENT_CHANNEL_CONFIGS,
		currentVersion: CHANNEL_CONFIGS_VERSION,
		migrations: channelConfigsMigrations,
		fallback: EMPTY_CHANNEL_CONFIGS,
	})
export const saveCurrentChannelConfigs = (c: ChannelConfigs): void =>
	saveVersioned({
		key: KEY_CURRENT_CHANNEL_CONFIGS,
		currentVersion: CHANNEL_CONFIGS_VERSION,
		data: c,
	})

export const loadCurrentMapConfig = (): MapConfig =>
	loadVersioned<MapConfig>({
		key: KEY_CURRENT_MAP_CONFIG,
		currentVersion: MAP_CONFIG_VERSION,
		migrations: mapConfigMigrations,
		fallback: DEFAULT_MAP_CONFIG,
	})
export const saveCurrentMapConfig = (c: MapConfig): void =>
	saveVersioned({
		key: KEY_CURRENT_MAP_CONFIG,
		currentVersion: MAP_CONFIG_VERSION,
		data: c,
	})

export const loadCurrentReshapeConfig = (): ReshapeConfig =>
	loadVersioned<ReshapeConfig>({
		key: KEY_CURRENT_RESHAPE_CONFIG,
		currentVersion: RESHAPE_CONFIG_VERSION,
		migrations: reshapeConfigMigrations,
		fallback: DEFAULT_RESHAPE_CONFIG,
	})
export const saveCurrentReshapeConfig = (c: ReshapeConfig): void =>
	saveVersioned({
		key: KEY_CURRENT_RESHAPE_CONFIG,
		currentVersion: RESHAPE_CONFIG_VERSION,
		data: c,
	})

export const loadCurrentLabels = (): LabelsConfig =>
	loadVersioned<LabelsConfig>({
		key: KEY_CURRENT_LABELS,
		currentVersion: LABELS_VERSION,
		migrations: labelsMigrations,
		fallback: DEFAULT_LABELS_CONFIG,
	})
export const saveCurrentLabels = (l: LabelsConfig): void =>
	saveVersioned({
		key: KEY_CURRENT_LABELS,
		currentVersion: LABELS_VERSION,
		data: l,
	})

export const loadCurrentLegend = (): LegendConfig =>
	loadVersioned<LegendConfig>({
		key: KEY_CURRENT_LEGEND,
		currentVersion: LEGEND_VERSION,
		migrations: legendMigrations,
		fallback: DEFAULT_LEGEND_CONFIG,
	})
export const saveCurrentLegend = (l: LegendConfig): void =>
	saveVersioned({
		key: KEY_CURRENT_LEGEND,
		currentVersion: LEGEND_VERSION,
		data: l,
	})

export const loadCurrentTooltip = (): TooltipConfig =>
	loadVersioned<TooltipConfig>({
		key: KEY_CURRENT_TOOLTIP,
		currentVersion: TOOLTIP_VERSION,
		migrations: tooltipMigrations,
		fallback: DEFAULT_TOOLTIP_CONFIG,
	})
export const saveCurrentTooltip = (t: TooltipConfig): void =>
	saveVersioned({
		key: KEY_CURRENT_TOOLTIP,
		currentVersion: TOOLTIP_VERSION,
		data: t,
	})

export const loadCurrentDataLabelsEncodings = (): DataLabelsEncodings =>
	loadVersioned<DataLabelsEncodings>({
		key: KEY_CURRENT_DATA_LABELS_ENCODINGS,
		currentVersion: DATA_LABELS_ENCODINGS_VERSION,
		migrations: dataLabelsEncodingsMigrations,
		fallback: emptyDataLabelsEncodings(),
	})
export const saveCurrentDataLabelsEncodings = (e: DataLabelsEncodings): void =>
	saveVersioned({
		key: KEY_CURRENT_DATA_LABELS_ENCODINGS,
		currentVersion: DATA_LABELS_ENCODINGS_VERSION,
		data: e,
	})

export const loadCurrentDataLabelsConfig = (): DataLabelsConfig =>
	loadVersioned<DataLabelsConfig>({
		key: KEY_CURRENT_DATA_LABELS_CONFIG,
		currentVersion: DATA_LABELS_CONFIG_VERSION,
		migrations: dataLabelsConfigMigrations,
		fallback: DEFAULT_DATA_LABELS_CONFIG,
	})
export const saveCurrentDataLabelsConfig = (c: DataLabelsConfig): void =>
	saveVersioned({
		key: KEY_CURRENT_DATA_LABELS_CONFIG,
		currentVersion: DATA_LABELS_CONFIG_VERSION,
		data: c,
	})

export const loadCurrentAnnotations = (): AnnotationsConfig =>
	loadVersioned<AnnotationsConfig>({
		key: KEY_CURRENT_ANNOTATIONS,
		currentVersion: ANNOTATIONS_VERSION,
		migrations: annotationsMigrations,
		fallback: DEFAULT_ANNOTATIONS_CONFIG,
	})
export const saveCurrentAnnotations = (a: AnnotationsConfig): void =>
	saveVersioned({
		key: KEY_CURRENT_ANNOTATIONS,
		currentVersion: ANNOTATIONS_VERSION,
		data: a,
	})

export const loadCurrentCaption = (): CaptionConfig =>
	loadVersioned<CaptionConfig>({
		key: KEY_CURRENT_CAPTION,
		currentVersion: CAPTION_VERSION,
		migrations: captionMigrations,
		fallback: DEFAULT_CAPTION_CONFIG,
	})
export const saveCurrentCaption = (c: CaptionConfig): void =>
	saveVersioned({
		key: KEY_CURRENT_CAPTION,
		currentVersion: CAPTION_VERSION,
		data: c,
	})

export const loadPreviewVersionId = (): string | null =>
	safeGet<string | null>(KEY_PREVIEW_VERSION_ID, null)
export const savePreviewVersionId = (id: string | null): void =>
	safeSet(KEY_PREVIEW_VERSION_ID, id)

/** Every localStorage key holding draft editor state — the `current*` atoms
 *  plus the preview-version pin. The embed page persists whatever visual it
 *  loads over these keys (its `useLoadVisual` runs the same persist effects),
 *  so anything that boots embeds in hidden same-origin iframes — the
 *  thumbnail backfill — must snapshot them first and restore after, or the
 *  user's unsaved draft would be replaced by the last visual rendered. */
const DRAFT_STATE_KEYS = [
	KEY_CURRENT_VISUAL,
	KEY_CURRENT_DATASET,
	KEY_CURRENT_VISUAL_NAME,
	KEY_CURRENT_ENCODINGS,
	KEY_CURRENT_FIELD_OVERRIDES,
	KEY_CURRENT_FIELD_LEVEL_ORDERS,
	KEY_CURRENT_CHANNEL_CONFIGS,
	KEY_CURRENT_MAP_CONFIG,
	KEY_CURRENT_RESHAPE_CONFIG,
	KEY_CURRENT_LABELS,
	KEY_CURRENT_LEGEND,
	KEY_CURRENT_TOOLTIP,
	KEY_CURRENT_DATA_LABELS_ENCODINGS,
	KEY_CURRENT_DATA_LABELS_CONFIG,
	KEY_CURRENT_ANNOTATIONS,
	KEY_CURRENT_CAPTION,
	KEY_PREVIEW_VERSION_ID,
]

export type DraftStateSnapshot = Record<string, string | null>

export const snapshotDraftState = (): DraftStateSnapshot => {
	const snapshot: DraftStateSnapshot = {}
	for (const key of DRAFT_STATE_KEYS) snapshot[key] = safeRawGet(key)
	return snapshot
}

export const restoreDraftState = (snapshot: DraftStateSnapshot): void => {
	for (const key of DRAFT_STATE_KEYS) safeRawSet(key, snapshot[key] ?? null)
}
