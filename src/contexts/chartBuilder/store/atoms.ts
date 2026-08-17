import { atom, type Atom } from "jotai"
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
import { idbAvailable } from "../lib/storage/idb"
import type { StorageContentAdapter } from "../lib/storage/adapter"
import { getStorageAdapter } from "../lib/storage/registry"
import {
	LIGHT_THEME_BASE,
	SYSTEM_LIGHT_THEME,
	SYSTEM_THEMES,
} from "../lib/systemThemes"
import {
	type DataLabelsEncodings,
	type Dataset,
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
		void adapter.loadVisuals().then((visuals) => {
			setSelf(() => visuals)
		})
		return
	}
	if (!idbAvailable()) return
	const boot = loadVisuals()
	const legacyInline = boot.some((v) => v.thumbnail !== null)
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

export const foldersAtom = contentAtom<Folder[]>(
	loadFolders,
	(adapter) => adapter.loadFolders(),
	(adapter, folders) => adapter.saveFolders(folders)
)

/** Datasets live in IndexedDB (durable, large quota) rather than the shared
 * ~5 MB localStorage bucket.
 *  1. The lazy first read synchronously bootstraps from the legacy
 *     localStorage copy so the first render — and the IndexedDB-less
 *     test/SSR environment — sees datasets immediately.
 *  2. `onMount` asynchronously loads the authoritative IndexedDB copy
 *     (migrating the legacy localStorage blob into IDB on first run),
 *     overriding the bootstrap — unless the user already changed datasets
 *     this session (`touched`), so a fresh upload is never clobbered by the
 *     in-flight load.
 *  3. Every write persists to IndexedDB. */
const datasetsBaseAtom = atom<{
	value: Record<string, Dataset> | Unset
	touched: boolean
}>({ value: UNSET, touched: false })
datasetsBaseAtom.onMount = (setSelf) => {
	const adapter = getStorageAdapter()
	// Skip the async load where IndexedDB is absent (SSR / happy-dom tests) so
	// those keep the synchronous bootstrap and don't fire a post-mount state
	// update — unless a hosted adapter is the source of truth, which must load
	// regardless of local IndexedDB.
	if (!adapter.capabilities.remoteLoad && !idbAvailable()) return
	void adapter.loadDatasets().then((datasets) => {
		setSelf((prev) => (prev.touched ? prev : { ...prev, value: datasets }))
	})
}

export const datasetsAtom = atom(
	(get) => {
		const s = get(datasetsBaseAtom)
		return s.value === UNSET ? loadDatasets() : s.value
	},
	(
		get,
		set,
		update:
			| Record<string, Dataset>
			| ((prev: Record<string, Dataset>) => Record<string, Dataset>)
	) => {
		const s = get(datasetsBaseAtom)
		const next = resolveUpdate(
			update,
			s.value === UNSET ? loadDatasets() : s.value
		)
		set(datasetsBaseAtom, { value: next, touched: true })
		void getStorageAdapter().saveDatasets(next)
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

/** First-load migration: if the user has an old single-theme blob in
 * `localStorage`, wrap it as a user theme alongside the bundled system
 * themes so multi-theme UI sees both. Without this, returning users
 * would lose their customized theme on first launch of the multi-theme
 * build. */
const buildInitialThemes = (): SavedTheme[] => {
	const stored = loadThemes()
	if (stored && stored.length > 0) {
		// Ensure system themes always exist in the array, in case a future
		// user wipes them or an older save dropped them.
		const haveLight = stored.some((t) => t.id === "system-light")
		const haveDark = stored.some((t) => t.id === "system-dark")
		const result = [...stored]
		if (!haveLight) result.unshift(SYSTEM_THEMES[0])
		if (!haveDark) {
			const lightIdx = result.findIndex((t) => t.id === "system-light")
			result.splice(lightIdx + 1, 0, SYSTEM_THEMES[1])
		}
		return result
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
	buildInitialThemes,
	// A hosted backend stores the raw saved-themes list; the local first-run
	// migration in `buildInitialThemes` only applies to the synchronous local
	// bootstrap.
	async (adapter) => (await adapter.loadThemes()) ?? buildInitialThemes(),
	(adapter, themes) => adapter.saveThemes(themes)
)

/** Which theme the user has starred as their default — applied to new
 * visualizations. `null` means no explicit pick, in which case
 * `system-light` is used as the implicit default. */
export const userDefaultThemeIdAtom = contentAtom<string | null>(
	() => loadUserDefaultThemeId() ?? SYSTEM_LIGHT_THEME.id,
	async (adapter) => (await adapter.loadUserDefaultThemeId()) ?? SYSTEM_LIGHT_THEME.id,
	(adapter, id) => adapter.saveUserDefaultThemeId(id)
)

/** Which theme is currently being edited in the Settings → Themes page.
 * Not persisted. Defaults to `null` so callers resolve the active theme
 * dynamically — system themes are read-only, so the resolver prefers the
 * first custom theme and only falls back to a system theme when no
 * custom theme exists yet. */
export const editingThemeIdAtom = atom<string | null>(null)

/** Which saved theme is applied to the visual currently being edited.
 * Persisted to the visual via {@link Visual.themeId}; the editor mirrors
 * the value here so the sidebar dropdown can read/write it without going
 * through the visuals atom. */
export const currentThemeIdAtom = atom<string | null>(null)

export const drawerOpenAtom = atom<boolean>(true)

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
