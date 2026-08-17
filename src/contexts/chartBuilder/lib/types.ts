// The channel/field-type name unions live in `lib/channelNames.ts` so the
// channel registry can import them without importing this module — otherwise
// `types.ts` and `channels.ts` form an import cycle. Re-exported here because
// this module is the barrel everything else imports them from.
import type { EncodingChannel, FieldType } from "./channelNames"
export type { EncodingChannel, FieldType }

// Re-exported from the channel registry so there's one source of truth.
// Adding a new channel is a single entry in `lib/channels.ts`.
export { ALL_ENCODING_CHANNELS } from "./channels"

import { CHANNELS, type ChannelDef } from "./channels"

export const ENCODING_CHANNEL_LABELS: Record<EncodingChannel, string> =
	Object.fromEntries(
		(Object.values(CHANNELS) as ChannelDef[]).map((c) => [c.id, c.label])
	) as Record<EncodingChannel, string>

export type Field = {
	name: string
	inferredType: FieldType
}

/** A CSV the user has dropped/selected but not yet committed — sits in state
 * while the upload prompt decides whether to create a new Dataset or append
 * a new version to an existing one. */
export type ParsedUpload = {
	filename: string
	fields: Field[]
	rows: Array<Record<string, string>>
}

/** A single uploaded snapshot of a data set. The columns + types are
 * invariant across all versions of a Dataset (enforced at upload time), so
 * `fields` lives on Dataset, not on each version. */
export type DatasetVersion = {
	id: string // "dv-<ts>-<rand>"
	filename: string // original filename for this upload
	rows: Array<Record<string, string>>
	createdAt: number
	note?: string // optional changelog note from the upload prompt
}

/** A data set is a named, versioned collection of CSV uploads sharing the same
 * column shape. The visualization editor renders the latest version by default;
 * iframes pin to specific versions via URL params. */
export type Dataset = {
	id: string // stable across versions
	name: string // user-editable, defaults to first filename
	fields: Field[] // shared across all versions (invariant)
	versions: DatasetVersion[] // ordered oldest → newest
	latestVersionId: string // pointer to the most recent version
	createdAt: number // first-version timestamp
	/** Optional cached content hash (see datasetDedupe.datasetContentHash). Lets
	 *  upload-time dedup compare in O(1) without rehashing the whole store.
	 *  Optional/derivable: absent on legacy data, backfilled by the dedup
	 *  coordinator and set on every new/append write. */
	contentHash?: string
}

/** A flattened view of a Dataset at a specific version, suitable for
 * rendering. Returned by `resolveDatasetView()` and consumed by the chart
 * canvas, encoding shelves, and panels. */
export type DatasetView = {
	id: string // dataset id
	name: string // dataset name
	filename: string // current version's filename (for display)
	fields: Field[] // dataset fields (invariant)
	rows: Array<Record<string, string>> // current version's rows
	createdAt: number // dataset's first-version timestamp
	versionId: string // current version id
	versionIndex: number // 1-based position in versions array
	totalVersions: number
	isLatest: boolean // false when previewing an older version
	versionCreatedAt: number
	versionNote?: string
}

/** A single channel mapping. `field` names the dataset column driving the
 *  channel (null = unmapped).
 *
 *  `measureSource` is the DERIVED-value escape hatch: instead of a dataset
 *  field, the channel varies by a quantity the renderer computes. It's
 *  mutually exclusive with `field` (the sidebar clears one when the other is
 *  set), so a channel never carries both at once. Optional and absent by
 *  default, so existing saved encodings are unaffected. Sources by mode:
 *
 *  Histograms — `hue` (Fill color) and `opacity` (Fill opacity):
 *   - "count": rows per bin.
 *   - "density": the bin's share of the total (matches the measure mode).
 *
 *  Packed circles — values derived from the hierarchy, so they never need
 *  denormalized Root/Depth columns in the data:
 *   - "rootGroup" (`hue` only): each circle's OUTERMOST ancestor group —
 *     categorical, colored through the normal palette machinery.
 *   - "depth" (`saturation` / `brightness` / `opacity`): the circle's
 *     nesting level (1 = top-level), through the channel's normal
 *     quantitative min→max range.
 *
 *  Hexbins — `hue` (Fill color) only:
 *   - "hexCount": points-per-hexagon when both x and y are quantitative.
 *     Deliberately distinct from the histogram's "count" so detection and
 *     fallback logic can never confuse the two. */
export type Encoding = {
	field: string | null
	measureSource?: "count" | "density" | "rootGroup" | "depth" | "hexCount"
}
export type Encodings = Record<EncodingChannel, Encoding>

export const emptyEncodings = (): Encodings => ({
	x: { field: null },
	y: { field: null },
	r: { field: null },
	length: { field: null },
	angle: { field: null },
	area: { field: null },
	saturation: { field: null },
	hue: { field: null },
	outlineHue: { field: null },
	brightness: { field: null },
	opacity: { field: null },
	shape: { field: null },
	pattern: { field: null },
	connection: { field: null },
	facet: { field: null },
	facetRow: { field: null },
	facetCol: { field: null },
	// `text` is a LEGACY channel kept for back-compat with visuals saved
	// before the Data Labels system existed. Since the rebuild it's hidden
	// from the main encoding shelf (see HIDDEN_FROM_MAIN_SHELF in
	// `EncodingShelves.tsx`) — new visuals drive labels through the
	// `DataLabelsEncodings` atom + the dedicated "Data Labels" sidebar
	// section instead. The renderer still honors `encodings.text.field`
	// when a saved visual carries it so old work continues to display.
	text: { field: null },
})

/** Encodings for the Data Labels layer. The labels render on top of the
 * main visualization — `x`/`y` decide where each label sits, `hue` colors
 * them, and `size` scales their font size. `value` is the field whose
 * row value gets rendered as the label's text. Mapping no fields hides
 * the layer entirely.
 *
 * `angle`/`r` are the polar position channels — the panel swaps the `x`/`y`
 * rows for these when the chart is a pie. They mirror `x`/`y`: mapping them
 * gates the layer on. The actual placement still comes from slice geometry,
 * nudged by `polarLabelAngle` / `polarLabelRadius` in the config. */
export type DataLabelsEncodings = {
	x: { field: string | null }
	y: { field: string | null }
	angle: { field: string | null }
	r: { field: string | null }
	/** `measureSource` (tree layouts only — packed circles / treemap /
	 * sunburst): label color varies by a hierarchy-derived value instead
	 * of a dataset column — "rootGroup" (the node's outermost ancestor,
	 * categorical) or "depth" (nesting level, ordinal). Mutually exclusive
	 * with `field` (the panel writes one and clears the other), mirroring
	 * the main shelf's derived variables. Optional so saved visuals from
	 * before the option load unchanged. */
	hue: { field: string | null; measureSource?: "rootGroup" | "depth" }
	/** Size supports only "depth" — root-group is categorical, and a font
	 * size needs an ordered value. Top level renders BIGGEST (sizeMax),
	 * the deepest level smallest (sizeMin); swap Min/Max to invert. */
	size: { field: string | null; measureSource?: "depth" }
	/** The label's text content.
	 *
	 * Single-field mode (`multiField` falsy): `field`'s row value is the
	 * label text. When `field` is unmapped, the label falls back to the `x`
	 * field's value (or `y`'s if x isn't mapped) so the user can scaffold
	 * position-only labels.
	 *
	 * Multi-field mode (`multiField === true`): the label combines several
	 * fields. `fields` is the ordered selection (A = fields[0], B =
	 * fields[1], …); the arrangement comes from `DataLabelsConfig.labelTemplate`
	 * (a string with `{Field}` tokens; empty = join the selected fields with
	 * ", ") and each field's number format from `DataLabelsConfig.fieldFormats`.
	 * `field` is null in this mode. Both are optional so visuals saved before
	 * the feature load unchanged (single-field). */
	value: { field: string | null; multiField?: boolean; fields?: string[] }
}

export const emptyDataLabelsEncodings = (): DataLabelsEncodings => ({
	x: { field: null },
	y: { field: null },
	angle: { field: null },
	r: { field: null },
	hue: { field: null },
	size: { field: null },
	value: { field: null },
})

import type { AnnotationsConfig } from "./annotationsConfig"
import type { CaptionConfig } from "./captionConfig"
import type { ChannelConfigs, DataLabelsConfig } from "./channelConfig"
import type { LabelsConfig, LegendConfig, TooltipConfig } from "./labelsConfig"
import type { MapConfig } from "./mapConfig"

export type Visual = {
	id: string
	name: string
	folderId: string | null // null = root level
	datasetId: string | null
	/** The dataset version present when this visualization was first saved.
	 * Informational/audit only — the editor always renders the latest version
	 * unless the user is actively previewing a different version, and iframes
	 * pin via the URL `?v=` param. May be null for visuals migrated from the
	 * pre-versioning data model when ambiguous. */
	createdAtVersionId: string | null
	fieldTypeOverrides: Record<string, FieldType>
	encodings: Encodings
	channelConfigs: ChannelConfigs
	labelsConfig: LabelsConfig
	/** Per-visual legend layout (position, orientation, border, hidden
	 * channels). Optional for back-compat with visuals saved before this
	 * field existed — falls back to DEFAULT_LEGEND_CONFIG on load. */
	legendConfig?: LegendConfig
	/** Per-visual tooltip config (enabled, visible fields, custom HTML/CSS).
	 * Same back-compat treatment as `legendConfig`. */
	tooltipConfig?: TooltipConfig
	/** Per-visual map config (coordinate system, projection, geography level,
	 * focus region / custom viewport, no-data fill). Optional for back-compat
	 * with visuals saved before maps existed — falls back to DEFAULT_MAP_CONFIG
	 * on load. Without this the map state (e.g. Geographic on) wouldn't persist
	 * per visual and would reset to "No map" when reopened. */
	mapConfig?: MapConfig
	/** Per-visual Data Labels encodings — which fields drive the label
	 * layer's x, y, hue, size, text. Optional for back-compat. */
	dataLabelsEncodings?: DataLabelsEncodings
	/** Per-visual Data Labels appearance + offsets + scale knobs. Optional
	 * for back-compat. */
	dataLabelsConfig?: DataLabelsConfig
	/** Saved-theme ID this visual was last themed under. Informational —
	 * tells the editor which entry in `themesAtom` to highlight in the
	 * "Theme" dropdown. The actual theme values that were applied are
	 * snapshotted into `channelConfigs` / `labelsConfig` at the moment
	 * the user picks the theme, so editing the saved theme later does
	 * NOT silently re-theme the visual. */
	themeId?: string
	/** Per-field user-pinned ordering of categorical / ordinal levels.
	 * Maps field name → ordered list of level values. The chart pipeline
	 * (aggregateStacks, makePositionScale) consults this when present and
	 * falls back to smart-sort otherwise. Optional for back-compat with
	 * visuals saved before this feature shipped. */
	fieldLevelOrders?: Record<string, string[]>
	/** Per-visual rectangle annotations (shaded regions / highlight boxes
	 * overlaid on the plot). Optional for back-compat with visuals saved
	 * before annotations existed — falls back to DEFAULT_ANNOTATIONS_CONFIG
	 * on load. */
	annotationsConfig?: AnnotationsConfig
	/** Per-visual caption — a free-floating text box rendered below the
	 * x-axis title. Optional for back-compat with visuals saved before
	 * captions existed; falls back to DEFAULT_CAPTION_CONFIG on load. */
	captionConfig?: CaptionConfig
	thumbnail: string | null
	createdAt: number
	updatedAt: number
}

export type Folder = {
	id: string
	name: string
	parentId: string | null // null = root level
	createdAt: number
}

/** A lightweight record of an embed code the user has copied. The landing
 * page derives its rows from these: one row per instance, plus a
 * "not-yet-embedded" placeholder for Visuals with zero instances.
 *
 * Deduped per `(visualId, versionId)` — re-copying the same embed updates
 * `lastExportedAt` but does not create a duplicate. `versionId === null`
 * encodes the "Live" (always-latest) variant. */
export type EmbedInstance = {
	id: string // "ei-<ts>-<rand>"
	visualId: string
	versionId: string | null
	createdAt: number
	lastExportedAt: number
}

// Named palette types — stored in the theme, selectable per chart.
export type SavedCategoricalPalette = {
	id: string
	name: string
	colors: string[]
	/** Optional per-color pattern-ink default. Same length as `colors` when
	 * present; missing entries (`undefined`/empty) fall back to the theme's
	 * global `patternInkColor`. Lets users say "this shade of blue → that
	 * shade of darker blue for the pattern overlay". */
	patternInks?: Array<string | null>
}

export type SavedLinearGradient = {
	id: string
	name: string
	low: string
	high: string
}

export type SavedDivergingGradient = {
	id: string
	name: string
	low: string
	mid: string
	high: string
}

/** User-level aesthetic theme. Applied as defaults when creating new
 * visualizations so users don't have to reconfigure every chart from scratch. */
export type Theme = {
	// Mark defaults
	defaultFill: string
	defaultRadius: number
	defaultOpacity: number
	defaultShape: number
	outlineColor: string
	outlineWidth: number
	// Font
	titleFontFamily: string
	titleFontColor: string
	titlePrimarySize: number
	titleSubtitleSize: number
	titleSecondarySize: number
	/** Theme-level bold / italic / underline defaults for title-style
	 * text (chart title, subtitle, axis titles, legend section titles).
	 * Per-visual `labelsConfig.baseFont.titles` and per-label overrides
	 * inherit these unless the user explicitly toggles them off / on. */
	titleFontBold?: boolean
	titleFontItalic?: boolean
	titleFontUnderline?: boolean
	/** Numeric title font weight. Wins over the legacy `titleFontBold` flag
	 * when set; themes saved before the Weight picker existed carry only the
	 * boolean. Doubles as the fallback for the three per-slot weights below,
	 * which refine individual title tiers when set. */
	titleFontWeight?: number
	subtitleFontWeight?: number
	/** Axis titles + facet titles (the `secondary` title tier). */
	axisTitleFontWeight?: number
	/** Legend section titles — same size tier as axis titles, weight only. */
	legendTitleFontWeight?: number
	/** Per-slot font families for the subtitle / legend section titles.
	 * Unset falls back to the shared `titleFontFamily` (which axis and facet
	 * titles always follow). */
	subtitleFontFamily?: string
	legendTitleFontFamily?: string
	/** Default alignments for the chart title / subtitle / legend section
	 * titles. Unset = "center". Per-visual alignment edits override these. */
	titleAlignment?: "left" | "center" | "right"
	subtitleAlignment?: "left" | "center" | "right"
	legendTitleAlignment?: "left" | "center" | "right"
	/** Legend entry-label font overrides. Unset falls back to the shared
	 * text font (axis tick labels), which legend labels historically shared. */
	legendTextFontFamily?: string
	legendTextFontSize?: number
	legendTextFontWeight?: number
	legendTextColor?: string
	textFontFamily: string
	textFontSize: number
	textFontColor: string
	/** Theme-level bold / italic / underline defaults for body-style
	 * text (axis tick labels, legend swatch labels). */
	textFontBold?: boolean
	textFontItalic?: boolean
	textFontUnderline?: boolean
	/** Numeric text font weight. Wins over the legacy `textFontBold` flag
	 * when set. */
	textFontWeight?: number
	// Named palettes
	categoricalPalettes: SavedCategoricalPalette[]
	/** Discrete palettes applied when a user maps an ORDINAL field to hue.
	 *  Separate list from `categoricalPalettes` so themes can supply
	 *  sequential palettes (lighter→darker) that read as ordered rather
	 *  than as the arbitrary categories the categorical palettes target. */
	ordinalPalettes: SavedCategoricalPalette[]
	linearGradients: SavedLinearGradient[]
	divergingGradients: SavedDivergingGradient[]
	// Which palette/gradient is the default (by ID, or a preset name like "viridis")
	defaultCategoricalPaletteId: string
	/** Default ordinal palette ID. Mirrors `defaultCategoricalPaletteId`
	 *  but targets the `ordinalPalettes` list. */
	defaultOrdinalPaletteId: string
	/** Default palette used to color text labels per category. `null` means
	 * "no palette" — text falls back to the single color in `textEncodingColor`.
	 * Otherwise one of the `categoricalPalettes` IDs. */
	defaultTextPaletteId: string | null
	defaultGradientPalette: string // preset name, or ID of a saved linear/diverging
	// Legacy single palette fields (kept for back-compat on load, mapped to palettes)
	categoricalPalette?: string[]
	customLinearGradient?: { low: string; high: string }
	customDivergingGradient?: { low: string; mid: string; high: string }
	// Pattern defaults
	patternInkColor: string
	patternBackgroundColor: string
	// Gridline defaults. Count is intentionally omitted — it defaults to
	// "one gridline per axis tick" and is adjusted per-visualization only.
	// `gridlineColor` / `gridlineThickness` are the LEGACY shared fields;
	// the per-axis fields below take precedence when set so users can
	// style x, y, and r gridlines independently. Old themes that only
	// carry the shared values still render correctly via the fallback.
	// `r` is radar's radial axis (concentric rings).
	gridlineColor: string
	gridlineThickness: number
	xGridlineColor?: string
	xGridlineThickness?: number
	yGridlineColor?: string
	yGridlineThickness?: number
	rGridlineColor?: string
	rGridlineThickness?: number
	// Tickmark defaults
	tickmarkColor: string
	tickmarkThickness: number
	tickmarkLength: number
	// Axis spine defaults (the single line drawn along each axis)
	spineColor: string
	spineThickness: number
	// Text encoding defaults — used as the starting point for the `text`
	// channel's font/color when a user maps a field to it. Per-chart edits
	// in the sidebar override these.
	textEncodingFontFamily: string
	textEncodingFontSize: number
	textEncodingFontWeight: number
	textEncodingColor: string
	// Data label defaults — seed the Data Labels layer's font when a chart
	// is created or re-themed. Optional: themes saved before these fields
	// existed fall back to the built-in defaults (11pt / 500 / plain).
	dataLabelsFontSize?: number
	dataLabelsFontWeight?: number
	dataLabelsFontFamily?: string
	/** Default single-color for data labels (the fallback when no palette /
	 * gradient / per-value override applies). */
	dataLabelsColor?: string
	dataLabelsItalic?: boolean
	dataLabelsUnderline?: boolean
	// Distribution overlay defaults — stroke + fill used by the violin /
	// box-plot overlays when first enabled on a chart's value axis.
	distributionOverlayStroke: string
	distributionOverlayFill: string
	// Regression overlay defaults — line stroke + confidence-band fill used
	// by the scatter regression line when first enabled.
	regressionStroke: string
	regressionCiFill: string
	// Connection-line default — initial line thickness when a connection
	// encoding is first mapped (line/area chart strokes).
	connectionThickness: number
	/** Default single color for connection lines + lollipop stems (scatter).
	 * Used as the "single color" default for the Line / Stem color slots so a
	 * freshly-added connection draws one consistent color instead of inheriting
	 * the fill/hue color. */
	connectionColor: string
	// Aesthetic-channel range defaults — used to seed each channel's
	// `{min, max}` config when the user first maps a field to it.
	lengthMin: number
	lengthMax: number
	angleMin: number
	angleMax: number
	areaMin: number
	areaMax: number
	saturationMin: number
	saturationMax: number
	brightnessMin: number
	brightnessMax: number
	/** Default chart-area background color used when a new visualization is
	 * created. `null` means transparent (host page shows through). */
	chartBackgroundColor: string | null
	/** Default background color for the legend box. `null` means transparent. */
	legendBackgroundColor: string | null
	/** Color used for length / angle / area / opacity legend swatches when
	 * they render as a STANDALONE section (no hue gradient to inherit
	 * from). Per-visual override lives in `LegendConfig.auxLegendSwatchColor`
	 * — that field's null value falls back to this theme default. */
	legendSwatchColor: string
	/** Default OUTLINE color for the area / size legend swatch (a filled
	 * circle). Per-visual override lives in `LegendConfig.auxLegendSwatchStroke`
	 * — that field's null value falls back to this theme default. Historical
	 * look is a white outline. */
	legendSwatchStroke: string
}

/** Identity attached to a saved theme so the editor can list them, set
 * defaults, and reference them per-visual. `isSystem` themes are read-
 * only; we ship them with the app and the user can pick from / star them
 * but not edit or delete them. */
export type SavedThemeMeta = {
	id: string
	name: string
	isSystem: boolean
}

/** A user-saveable theme combines a SavedThemeMeta with the underlying
 * `Theme` knobs. The user can have many of these. */
export type SavedTheme = SavedThemeMeta & Theme
