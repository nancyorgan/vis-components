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
 *  append and a panicked half-day of "what shape did we ship?" */

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
	legendMigrations,
	LEGEND_VERSION,
	themesMigrations,
	THEMES_VERSION,
	tooltipMigrations,
	TOOLTIP_VERSION,
	visualsMigrations,
	VISUALS_VERSION,
} from "./storage/migrations"
import { idbAvailable, idbGet, idbSet } from "./storage/idb"
import {
	loadVersioned,
	migrateVersioned,
	saveVersioned,
} from "./storage/versioning"
import type {
	DataLabelsEncodings,
	Dataset,
	EmbedInstance,
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
const KEY_EMBED_INSTANCES = "vis-components:embedInstances"
const KEY_CURRENT_VISUAL = "vis-components:currentVisualId"
const KEY_CURRENT_DATASET = "vis-components:currentDatasetId"
const KEY_CURRENT_VISUAL_NAME = "vis-components:currentVisualName"
const KEY_CURRENT_ENCODINGS = "vis-components:currentEncodings"
const KEY_CURRENT_FIELD_OVERRIDES = "vis-components:currentFieldOverrides"
const KEY_CURRENT_FIELD_LEVEL_ORDERS = "vis-components:currentFieldLevelOrders"
const KEY_CURRENT_CHANNEL_CONFIGS = "vis-components:currentChannelConfigs"
const KEY_CURRENT_MAP_CONFIG = "vis-components:currentMapConfig"
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

/** Read visuals. Handles the legacy "projects" key rename and the
 *  versioned upgrade from pre-versioning shapes via the migrations
 *  registry in storage/migrations.ts. */
export const loadVisuals = (): Visual[] => {
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
 *  now always written thumbnail-free, so it can't outgrow quota on previews. */
export const saveVisuals = (visuals: Visual[]): Promise<void> => {
	saveVersioned({
		key: KEY_VISUALS,
		currentVersion: VISUALS_VERSION,
		data: visuals.map((v) =>
			v.thumbnail === null ? v : { ...v, thumbnail: null }
		),
	})
	// Returned so callers that must observe the thumbnail side-table write
	// (the example-seed bootstrap, which runs before first render) can await
	// it; regular save paths ignore the promise as before.
	return saveThumbnailsAsync(visuals)
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

export const loadFolders = (): Folder[] => safeGet<Folder[]>(KEY_FOLDERS, [])
export const saveFolders = (folders: Folder[]): void =>
	safeSet(KEY_FOLDERS, folders)

/** Synchronous read of the LEGACY localStorage copy of datasets. Datasets now
 * live in IndexedDB (`loadDatasetsAsync`), but this is still used as a fast
 * synchronous bootstrap on first render and as the source for the one-time
 * localStorage → IndexedDB migration. */
export const loadDatasets = (): Record<string, Dataset> =>
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
 * Load datasets, preferring IndexedDB (the durable store — far larger quota
 * than localStorage, and datasets can be big). Falls back to the legacy
 * localStorage blob and, when found, migrates it into IndexedDB and clears the
 * localStorage copy (only on a confirmed write, so we never drop the legacy
 * data when the IDB write fails).
 */
export const loadDatasetsAsync = async (): Promise<Record<string, Dataset>> => {
	const fromIdb = await idbGet<unknown>(KEY_DATASETS)
	if (fromIdb !== null) {
		// Stored as a `{ _v, data }` wrapper; migrate forward defensively.
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
	// Nothing in IndexedDB yet — migrate the legacy localStorage copy if present.
	const legacy = loadDatasets()
	if (Object.keys(legacy).length > 0) {
		const wrote = await idbSet(KEY_DATASETS, {
			_v: DATASETS_VERSION,
			data: legacy,
		})
		if (wrote) clearLegacyDatasets()
	}
	return legacy
}

/** Persist datasets to IndexedDB. No-op (without error noise) when IndexedDB
 * is unavailable — the SSR/test environments, where cross-reload persistence
 * isn't expected. */
export const saveDatasetsAsync = async (
	datasets: Record<string, Dataset>
): Promise<void> => {
	if (!idbAvailable()) return
	const wrote = await idbSet(KEY_DATASETS, {
		_v: DATASETS_VERSION,
		data: datasets,
	})
	if (!wrote) {
		// eslint-disable-next-line no-console
		console.error(
			"[vis-components] failed to persist datasets to IndexedDB — your data may not survive a reload"
		)
	}
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

export const loadSidebarWidth = (): number =>
	safeGet<number>(KEY_SIDEBAR_WIDTH, 320)
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
		data: themes,
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
		data: datasets,
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
