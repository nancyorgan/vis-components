// ---------------------------------------------------------------------------
// Font types
// ---------------------------------------------------------------------------

/** Shared font-styling knobs used by every font config in this file.
 * `weight` is a numeric font weight (100–900); italic / underline are
 * optional booleans so older saved visuals without these flags load with
 * both off — matching their previous look. `weight` is likewise optional:
 * an unset weight falls through to each render site's own default weight
 * (e.g. axis titles render at 500, the chart title at normal). Replaces the
 * old boolean `bold` flag — see migrateLabelsConfig for the bold→weight
 * translation of saved visuals. */
export type FontStyles = {
	weight?: number
	italic?: boolean
	underline?: boolean
}

/** Per-label override shape. Any subset of family / size / color / style
 * may be set; unset fields fall through to the appropriate base. */
export type FontConfig = FontStyles & {
	family: string
	color: string
	size: number
}

export const DEFAULT_FONT_CONFIG: FontConfig = {
	family: "system-ui, sans-serif",
	color: "#111827",
	size: 12,
	italic: false,
	underline: false,
}

/** Base font for "title-like" text: chart title, subtitle, axis titles,
 * legend section titles. One family + color, three sizes for the different
 * title roles. */
export type TitlesFontConfig = FontStyles & {
	family: string
	/** Main chart title. */
	primarySize: number
	/** Subtitle under the main title. */
	subtitleSize: number
	/** Axis titles + legend section titles. */
	secondarySize: number
	color: string
}

/** Base font for body-ish text: axis tick labels, legend swatch labels. */
export type TextFontConfig = FontStyles & {
	family: string
	size: number
	color: string
}

export type BaseFontConfig = {
	titles: TitlesFontConfig
	text: TextFontConfig
}

export const DEFAULT_BASE_FONT_CONFIG: BaseFontConfig = {
	titles: {
		family: "system-ui, sans-serif",
		primarySize: 20,
		subtitleSize: 14,
		secondarySize: 13,
		color: "#111827",
		italic: false,
		underline: false,
	},
	text: {
		family: "system-ui, sans-serif",
		size: 12,
		color: "#4a5568",
		italic: false,
		underline: false,
	},
}

/** SVG-text attributes derived from a FontConfig/Titles/Text config's
 * bold/italic/underline flags. Use as `<text {...applyFontStyles(font)}/>`
 * to attach `fontWeight`, `fontStyle`, and `textDecoration` consistently
 * across every text render site (titles, axis labels, legend labels). */
export type FontStyleAttrs = {
	fontWeight?: number
	fontStyle?: "italic"
	textDecoration?: "underline"
}
export const fontStyleAttrs = (font: FontStyles | undefined): FontStyleAttrs => {
	const out: FontStyleAttrs = {}
	if (font?.weight) out.fontWeight = font.weight
	if (font?.italic) out.fontStyle = "italic"
	if (font?.underline) out.textDecoration = "underline"
	return out
}

// ---------------------------------------------------------------------------
// Font family presets offered in the Base font / per-label UI.
// ---------------------------------------------------------------------------

export const FONT_FAMILY_OPTIONS: Array<{ label: string; value: string }> = [
	{ label: "System Sans", value: "system-ui, sans-serif" },
	{ label: "Serif", value: "Georgia, 'Times New Roman', serif" },
	{
		label: "Monospace",
		value: "ui-monospace, SFMono-Regular, Menlo, monospace",
	},
	{ label: "DM Sans", value: "'DM Sans', ui-sans-serif, sans-serif" },
	{ label: "DM Mono", value: "'DM Mono', ui-monospace, monospace" },
	{ label: "Inter", value: "Inter, system-ui, sans-serif" },
]

// ---------------------------------------------------------------------------
// Legend channel helpers
// ---------------------------------------------------------------------------

export type LegendChannel =
	| "hue"
	| "outlineHue"
	| "area"
	| "shape"
	| "pattern"
	| "opacity"
	| "length"
	| "angle"
	// Color-slot legends: not encoding channels, so they're NOT in
	// LEGEND_CHANNELS (the encoding-backed iterator). They participate in the
	// hidden / title / font systems, which key off this union. The rug and a
	// field-grouped density curve surface here.
	| "rug"
	| "densityCurve"

// `outlineHue` follows `hue` here so its "Legends shown" / legend-title rows
// sit next to the fill-color ones. It's a first-class legend candidate
// (see CHANNELS.outlineHue.legendCandidate), so it MUST appear in this list
// too — otherwise the legend section renders with no hide toggle, and a
// histogram/scatter whose fill and outline share a field can't turn the
// (outline half of the) color legend off.
// Every legend channel EXCEPT the color-slot pseudo-channels (e.g. "rug"),
// which aren't encodings — `encodings[ch]` indexing in the sidebars relies on
// this exclusion.
export type EncodingLegendChannel = Exclude<LegendChannel, "rug" | "densityCurve">

export const LEGEND_CHANNELS: EncodingLegendChannel[] = [
	"hue",
	"outlineHue",
	"area",
	"shape",
	"pattern",
	"opacity",
	"length",
	"angle",
]

export const LEGEND_FRIENDLY_NAME: Record<LegendChannel, string> = {
	hue: "Color",
	outlineHue: "Outline color",
	area: "Size",
	shape: "Shape",
	pattern: "Pattern",
	opacity: "Opacity",
	length: "Length",
	angle: "Angle",
	rug: "Rug",
	densityCurve: "Density Curve",
}

/** The slice of a chart mode's `legend` traits that drives DEFAULT legend
 * visibility (see `ChartModeLegendConfig` in chartModes/types.ts — kept
 * structural here so this config module doesn't depend on the mode
 * registry). Unlike `hideLengthInThisMode`-style flags, a default-hidden
 * channel keeps its "Legends shown" toggle — the user can turn it back on. */
export type LegendDefaultTraits = { areaHiddenByDefault?: boolean }

/** Whether `channel`'s legend defaults to hidden in the current mode (i.e.
 * what an ABSENT `LegendConfig.hidden[channel]` key means). The sidebar's
 * hide toggle uses this to keep the persisted `hidden` map sparse: a key is
 * stored only when the user departs from the mode default. */
export const legendChannelHiddenByDefault = (
	channel: LegendChannel,
	traits: LegendDefaultTraits
): boolean => channel === "area" && traits.areaHiddenByDefault === true

/** Fold the mode's default-hidden channels into a sparse `hidden` map,
 * producing the EFFECTIVE per-channel visibility: an explicit user choice
 * (true or false) always wins; absent keys fall back to the mode default.
 * Both legend consumers (the Legend renderer and the sidebar panel) resolve
 * through this so their notion of "visible" can't drift; the result is for
 * READS only — never persist it, or the mode default would get baked into
 * the saved visual (and light the panel's "changed" dot on a fresh chart). */
export const resolveLegendHidden = (
	hidden: Partial<Record<LegendChannel, boolean>>,
	traits: LegendDefaultTraits
): Partial<Record<LegendChannel, boolean>> =>
	traits.areaHiddenByDefault === true && hidden.area === undefined
		? { ...hidden, area: true }
		: hidden

/** Channels whose legends represent quantitative encodings (gradient bar,
 * sized swatches, etc.). These are the channels that accept break-count
 * and break-value configuration. shape + pattern are categorical-only and
 * don't appear here. */
export type QuantitativeLegendChannel =
	| "hue"
	| "outlineHue"
	| "area"
	| "opacity"
	| "length"
	| "angle"

export const QUANTITATIVE_LEGEND_CHANNELS: QuantitativeLegendChannel[] = [
	"hue",
	"outlineHue",
	"area",
	"opacity",
	"length",
	"angle",
]

/** A legend swatch's glyph: `null` = rounded rectangle (default), a
 * `SHAPE_PALETTE` index = that symbol, `"line"` = a short line segment. */
export type LegendSwatchShape = number | "line" | null

/** Color channels that draw solid color swatches and so accept a per-section
 * swatch shape (Color / Outline color / Rug). */
export const SWATCH_SHAPE_CHANNELS: readonly LegendChannel[] = [
	"hue",
	"outlineHue",
	"rug",
]

/** Per-channel quantitative-legend display config. Controls how break
 * labels are formatted, how many break stops appear on the gradient /
 * swatch list, and what their values are. Data values that fall outside
 * the user's chosen break range are always pinned to the endpoint
 * color/size — that's what makes the "5,000+" top-break label sensible. */
export type LegendChannelConfig = {
	/** d3-format spec applied to each break label. Empty string = use the
	 * legend's historical default (toFixed(2) for numeric, locale-date for
	 * temporal). Mirrors AxisConfig.customFormat from the axis tick UI so
	 * the user reuses the same mental model. */
	format: string
	/** Number of break stops shown along the gradient / swatch list when
	 * `breaks` is empty. Ignored when `breaks` is non-empty (custom values
	 * override count). The legend's renderer may clamp this to a sensible
	 * minimum (typically 2). */
	breakCount: number
	/** Explicit break values. When non-empty, defines BOTH the labels and
	 * the underlying scale's domain — the encoded mark color/size will
	 * span `[min(breaks), max(breaks)]` instead of the data's natural
	 * extent. Empty array = use `breakCount` with uniform interpolation
	 * across the data extent. */
	breaks: number[]
}

export const DEFAULT_LEGEND_CHANNEL_CONFIG: LegendChannelConfig = {
	format: "",
	breakCount: 5,
	breaks: [],
}

// ---------------------------------------------------------------------------
// Legend layout config (sidebar-driven)
// ---------------------------------------------------------------------------

/** Where the legend column/row sits relative to the chart. The chart and
 * legend share a flex container for the four "outside" presets; `inside`
 * absolutely-positions the legend over the plot area at user-supplied
 * pixel coordinates. */
export type LegendPosition = "right" | "left" | "top" | "bottom" | "inside"

/** How swatches lay out *within* a legend section.
 * - `vertical` (default): each swatch + label on its own row, sections stack.
 * - `horizontal`: each swatch + label flows left-to-right, wrapping as
 *   needed. Useful for footer-style legends or compact in-chart placements. */
export type LegendOrientation = "vertical" | "horizontal"

export type LegendConfig = {
	/** Master toggle. When false, the legend doesn't render at all. */
	enabled: boolean
	position: LegendPosition
	/** Layout direction within each section's swatch list. */
	orientation: LegendOrientation
	/** When `position === "inside"`, plot-area-normalized coordinates of the
	 * legend's top-left corner. (0, 0) is the bottom-left corner of the plot
	 * (where the two axis spines meet); (1, 1) is the top-right. Values may
	 * exceed [0, 1] to position the legend outside the plot rectangle. For
	 * polar charts (pies) the same rectangle is the pie's bounding box, so
	 * (0, 0) is the bottom-left of that box. Ignored for the four outside
	 * presets. */
	insideX: number
	insideY: number
	/** Per-channel hide flags. A channel set to `true` is suppressed even
	 * when its encoding is mapped (handy for hiding redundant hue legends
	 * when hue and facet share a field). */
	hidden: Partial<Record<LegendChannel, boolean>>
	/** Wrap the legend in a border box. */
	showBorder: boolean
	/** Border-box stroke color. Only consulted when `showBorder` is true. */
	borderColor: string
	/** Border-box corner radius in pixels. */
	borderRadius: number
	/** Background color for the legend box. `null` means transparent — useful
	 * for inside legends that should let the chart show through. */
	backgroundColor: string | null
	/** How a quantitative hue legend renders. `"bar"` (default) shows a
	 * single gradient strip with min / max labels — compact, classic
	 * scientific-paper look. `"swatches"` samples five points along the
	 * scale and renders one labeled swatch per stop, matching the
	 * categorical-legend cadence (handy when the chart's other legends
	 * are also swatch-based). The setting is only meaningful when at
	 * least one hue legend is quantitative — the sidebar control gates
	 * itself on that. */
	gradientLegendStyle?: "bar" | "swatches"
	/** Default fill color for shape legend swatches when the shape and
	 *  hue encodings are different fields (so there's no single hue color
	 *  to inherit). Per-category `shape.fillOverrides[value]` takes
	 *  precedence when set; this just controls the otherwise-neutral
	 *  fallback. `null` falls back to the historical `#4f8eda` so users
	 *  who haven't customized see the previous behavior. */
	shapeLegendFillColor?: string | null
	/** Companion stroke color for shape legend swatches. `null` falls
	 *  back to the theme's `shape.outlineColor`. Useful when the shape
	 *  legend's swatch color needs to read distinctly against the
	 *  legend background. */
	shapeLegendStrokeColor?: string | null
	/** Shape drawn for each color (hue) legend swatch. `null` / undefined
	 *  renders the historical rounded rectangle. A `0`-based index into
	 *  `SHAPE_PALETTE` (circle, square, triangle, …) swaps the rectangle
	 *  for that symbol, filled with the swatch's hue color — handy when
	 *  the chart's marks are a particular glyph and the legend should
	 *  match. Applies only to swatch-style hue legends (categorical, or a
	 *  quantitative legend rendered as swatches); a gradient bar ignores
	 *  it. */
	hueLegendSwatchShape?: number | null
	/** Symbol radius (px) for hue legend swatches when `hueLegendSwatchShape`
	 *  is set. `null` / undefined uses the default radius (5). Only affects
	 *  shape swatches — the default rectangle ignores it. */
	hueLegendSwatchSize?: number | null
	/** Per-color-section swatch shape, keyed by the color channel (hue /
	 *  outlineHue / rug). Lets each color legend draw a distinct glyph so the
	 *  user can tell them apart when several are mapped at once. `null` / absent
	 *  = the default rectangle; a `SHAPE_PALETTE` index = that symbol; `"line"`
	 *  = a short line segment (natural for the rug). For `hue` this supersedes
	 *  the legacy global `hueLegendSwatchShape`. */
	swatchShapes?: Partial<Record<LegendChannel, LegendSwatchShape>>
	/** Per-section swatch radius (px), paired with `swatchShapes`. */
	swatchSizes?: Partial<Record<LegendChannel, number>>
	/** Color used for length / angle / area / opacity legend swatches
	 * when they render as a STANDALONE section (no hue gradient to
	 * inherit from). `null` falls back to the historical `#4f8eda`. The
	 * sidebar exposes one picker that controls all four channels at
	 * once — they all use the same hardcoded blue today, and the most
	 * common need is "pick one color that reads well against my chart
	 * background" rather than per-channel customization. */
	auxLegendSwatchColor?: string | null
	/** Border (stroke) color for the AREA (size) legend swatch circles.
	 * Only the area swatch is a filled shape with a meaningful outline —
	 * length / angle swatches are lines (their stroke IS the swatch color)
	 * and opacity swatches are borderless fills. `null` falls back to the
	 * historical white (`#ffffff`) outline, which reads the marks apart
	 * against a colored background. */
	auxLegendSwatchStroke?: string | null
	/** Per-quantitative-channel break + format overrides. Sparse: channels
	 * not present here fall back to `DEFAULT_LEGEND_CHANNEL_CONFIG`. The
	 * scale-building code reads `breaks` to override its domain; the legend
	 * renderer reads `format` + `breakCount` to lay out labels. */
	channels?: Partial<Record<QuantitativeLegendChannel, LegendChannelConfig>>
	/** How many columns the legend lays its content out in. `1` (default)
	 * is the classic single stack. With ≥2 legends mapped (e.g. color +
	 * shape), each legend section is packed into its own column, balanced
	 * so the columns stay roughly the same length. With a single legend,
	 * its entries wrap across the columns instead. Columns take precedence
	 * over the horizontal orientation (entries stack within each column). */
	columns?: number
	/** Horizontal gap, in pixels, between legend columns. Only meaningful when
	 * `columns > 1`. Defaults to 24. */
	columnGap?: number
	/** When multiple encodings map to the SAME field, merge them into one
	 * legend section (a composed swatch + a single title) instead of drawing
	 * a separate legend per channel. `true` (default) preserves the historical
	 * auto-combine behavior; `false` splits each channel into its own legend
	 * and, in the sidebar, its own swatch + title subsection. */
	combineSameVariable?: boolean
}

export const DEFAULT_LEGEND_CONFIG: LegendConfig = {
	enabled: true,
	position: "right",
	orientation: "vertical",
	// Top-left of the plot area, with a small inset so the legend doesn't
	// kiss the y-axis spine. Plot-area normalized: (0, 0) bottom-left,
	// (1, 1) top-right.
	insideX: 0.02,
	insideY: 0.98,
	hidden: {},
	showBorder: false,
	borderColor: "#e2e8f0",
	borderRadius: 6,
	backgroundColor: "#ffffff",
	gradientLegendStyle: "bar",
	shapeLegendFillColor: null,
	shapeLegendStrokeColor: null,
	hueLegendSwatchShape: null,
	hueLegendSwatchSize: null,
	auxLegendSwatchColor: null,
	auxLegendSwatchStroke: null,
	channels: {},
	columns: 1,
	columnGap: 24,
	combineSameVariable: true,
}

// ---------------------------------------------------------------------------
// Tooltip config
// ---------------------------------------------------------------------------

export type TooltipConfig = {
	enabled: boolean
	/** Field names to show in the tooltip. Empty array = show every field
	 * present in the hovered row. */
	visibleFields: string[]
	/** Optional CSS rules applied to a wrapping `<div class="vc-tooltip">`.
	 * Fully user-controlled — no sanitization, no fallback. */
	customCss: string
	/** Optional HTML template for tooltip content. When `useCustomHtml` is
	 * true, this template replaces the default field-list layout —
	 * `{{fieldName}}` placeholders are substituted with the hovered row's
	 * values (HTML-escaped to prevent injection). When false, the textarea
	 * acts as a drafting area; the tooltip uses the field-list layout
	 * filtered by `visibleFields`. */
	customHtml: string
	/** When true, the tooltip renders `customHtml` instead of the
	 * checkbox-driven field list. Opt-in so "Load default" can populate
	 * the textarea as a starter template without immediately switching
	 * modes. Optional for back-compat with visuals saved before this
	 * field existed — `undefined` is treated as `false`. */
	useCustomHtml?: boolean
	/** Master toggle for pointer-hover interactions (the "Show hover"
	 * checkbox under the Hover subsection). When off, the legend-highlight
	 * behavior below is disabled regardless of its own flag. Independent of
	 * `enabled`, which gates the mark tooltip. Optional for back-compat —
	 * `undefined` is treated as `true`. */
	hoverEnabled?: boolean
	/** When true (and `hoverEnabled`), hovering a categorical legend entry
	 * highlights the matching marks per the appearance options below.
	 * Optional for back-compat — `undefined` is treated as `true`. */
	legendHighlight?: boolean
	/** Recolor (fill) color applied to hovered marks when `hoverRecolor` is on.
	 * `undefined` → `DEFAULT_HOVER_HIGHLIGHT_COLOR`. */
	hoverHighlightColor?: string
	/** Repaint hovered marks' fill with `hoverHighlightColor` on hover — the
	 * opt-in "highlight with a color" toggle (reveals the color picker).
	 * `undefined` → `false`. */
	hoverRecolor?: boolean
	/** Outline hovered marks on hover. `undefined` → `false`. */
	hoverOutline?: boolean
	/** Outline (stroke) color, independent of the recolor fill. `undefined`
	 * → `DEFAULT_HOVER_OUTLINE_COLOR`. */
	hoverOutlineColor?: string
	/** Outline stroke width in px when `hoverOutline` is on. `undefined`
	 * → `DEFAULT_HOVER_OUTLINE_WIDTH` (2). */
	hoverOutlineWidth?: number
	/** Fade the non-matched marks on hover. `undefined` → `true`. */
	hoverFade?: boolean
	/** How strongly non-matched marks fade, 0–1 (0 = no change, 1 = fully
	 * transparent). Resulting opacity multiplier is `1 - hoverFadeAmount`.
	 * `undefined` → `0.85` (matched marks stay, others drop to ~15%). */
	hoverFadeAmount?: number
}

/** Default recolor (fill) color for hover highlighting — a strong gold that
 * reads against most palettes. Users override it in the Hover panel. */
export const DEFAULT_HOVER_HIGHLIGHT_COLOR = "#FFD400"

/** Default outline (stroke) color for hover highlighting — a near-black that
 * reads as a crisp border on most fills. Independent of the recolor color. */
export const DEFAULT_HOVER_OUTLINE_COLOR = "#111827"

/** Default outline stroke width (px) for hover highlighting. */
export const DEFAULT_HOVER_OUTLINE_WIDTH = 2

export const DEFAULT_TOOLTIP_CONFIG: TooltipConfig = {
	enabled: true,
	visibleFields: [],
	customCss: "",
	customHtml: "",
	useCustomHtml: false,
	hoverEnabled: true,
	legendHighlight: true,
	hoverHighlightColor: DEFAULT_HOVER_HIGHLIGHT_COLOR,
	// Recolor + outline are opt-in (a color is a deliberate choice); fade is
	// the default emphasis so hovering "just works" out of the box.
	hoverRecolor: false,
	hoverOutline: false,
	hoverOutlineColor: DEFAULT_HOVER_OUTLINE_COLOR,
	hoverOutlineWidth: DEFAULT_HOVER_OUTLINE_WIDTH,
	hoverFade: true,
	hoverFadeAmount: 0.85,
}

// ---------------------------------------------------------------------------
// Labels config
// ---------------------------------------------------------------------------

export type LabelFontKey =
	| "title"
	| "subtitle"
	| "xAxisTitle"
	| "yAxisTitle"
	// Shared facet-title styling. Used directly for wrap mode and for
	// single-axis grids (col-only / row-only). In a both-axes grid it acts as
	// the base that the two per-strip slots below layer on top of.
	| "facetTitle"
	// Per-strip facet-title slots, only meaningful (and only surfaced in the UI)
	// when BOTH facetCol and facetRow are mapped, so the top column-header strip
	// and left row-header strip can be styled independently. Each layers over
	// `facetTitle`, so a visual that only ever set `facetTitle` keeps its look.
	| "facetColTitle"
	| "facetRowTitle"
	// Per-panel title slot for hide-empty compacted grids (panels get a title
	// band showing the compacted dimension's value). Layers over `facetTitle`
	// like the per-strip slots, so unset = today's look. Wrap-mode per-panel
	// titles keep using `facetTitle` directly — this key styles ONLY the
	// compact-grid panel titles.
	| "facetPanelTitle"
	// Flow-layout (chord / sankey) node labels — the names drawn beside each
	// node arc / bar. Textless (names come from the data); each set field
	// layers over the legacy Text-channel config (`channelConfigs.text`), so
	// visuals styled through the old Text panel keep their look until a field
	// here overrides it.
	| "nodeTitle"
	| `legend:${LegendChannel}`

export const legendFontKey = (ch: LegendChannel): LabelFontKey => `legend:${ch}`

/** Resolve a color section's swatch shape: the per-channel `swatchShapes`
 * entry, falling back to the legacy global `hueLegendSwatchShape` for `hue`
 * (so visuals saved before per-section shapes keep their hue glyph). */
export const legendSwatchShape = (
	cfg: Pick<LegendConfig, "swatchShapes" | "hueLegendSwatchShape">,
	ch: LegendChannel
): LegendSwatchShape => {
	const perChannel = cfg.swatchShapes?.[ch]
	if (perChannel !== undefined) return perChannel
	return ch === "hue" ? (cfg.hueLegendSwatchShape ?? null) : null
}

/** Resolve a color section's swatch size (px), paired with the shape. */
export const legendSwatchSize = (
	cfg: Pick<LegendConfig, "swatchSizes" | "hueLegendSwatchSize">,
	ch: LegendChannel
): number | null => {
	const perChannel = cfg.swatchSizes?.[ch]
	if (perChannel !== undefined) return perChannel
	return ch === "hue" ? (cfg.hueLegendSwatchSize ?? null) : null
}

export type LabelAlignment = "left" | "center" | "right"

/** Vertical placement of a title within its band / strip. Today only the
 * facet ROW-title strip honors it (rows can differ in height, so the title
 * can hug the top / center / bottom of each row's own plot rect). Missing
 * entries fall back to "middle" (the previous hard-coded default). */
export type VerticalAlignment = "top" | "middle" | "bottom"

export type LabelsConfig = {
	title: string
	subtitle: string
	/** Axis title text as a THREE-STATE value:
	 *   • `undefined` — never customized → renderers fall back to the field
	 *     name (the sidebar shows that field name as a grayed placeholder).
	 *   • `""` — user explicitly cleared it → NO title is drawn.
	 *   • any other string — custom title.
	 * `migrateLabelsConfig` collapses legacy `""` (which used to mean "use the
	 * field name") back to `undefined` so pre-versioning visuals keep their
	 * field-name titles. */
	xAxisTitle?: string
	yAxisTitle?: string
	/** Legend title overrides, same three-state semantics as the axis titles:
	 * a missing entry falls back to the field / feature name; an entry set to
	 * `""` draws no legend header. */
	legendTitles: Partial<Record<LegendChannel, string>>
	baseFont: BaseFontConfig
	fontOverrides: Partial<Record<LabelFontKey, Partial<FontConfig>>>
	/** Horizontal alignment per title slot. Missing entries fall back to
	 * "center" (the previous hard-coded default). Renderers consult this to
	 * place chart title / subtitle inside `width`, axis titles along the
	 * axis's spine, and legend titles inside the legend column. */
	titleAlignments?: Partial<Record<LabelFontKey, LabelAlignment>>
	/** Vertical alignment per title slot. Missing entries fall back to
	 * "middle". Only the facet row-title strip consumes this today: it moves
	 * each row's title to the top / center / bottom of that row's plot rect,
	 * so rows of different heights line their titles up as chosen. */
	titleVerticalAlignments?: Partial<Record<LabelFontKey, VerticalAlignment>>
	/** When true, the y-axis title is drawn upright (0°) instead of rotated
	 * -90°. Pairs with the auto-margin logic so a long horizontal title can
	 * push the plot rightward to fit. */
	yAxisTitleHorizontal?: boolean
	/** Per-title pixel offset applied AFTER the solver computes anchor
	 * positions. `+x` moves right, `+y` moves down (SVG convention). The
	 * solver also feeds these offsets into margin estimation so titles
	 * pushed outward grow the canvas reserve rather than clipping.
	 * `distance` is honored only by the `nodeTitle` slot: it moves flow
	 * node labels along their away-from-the-figure direction (radially
	 * outward for chord, away from the rect for sankey) — `+` is further
	 * out, `-` is closer in. */
	titleOffsets?: Partial<
		Record<LabelFontKey, { x?: number; y?: number; distance?: number }>
	>
	/** Schema version for this labels blob. Bumped when the MEANING of a
	 * stored value changes so `migrateLabelsConfig` can distinguish a legacy
	 * blob (no version) from a current one. v2 introduced the three-state
	 * axis / legend title model (undefined = fallback, "" = blank). */
	configVersion?: number
}

/** Current labels-config schema version. See `configVersion`. */
export const LABELS_CONFIG_VERSION = 2

export const DEFAULT_LABELS_CONFIG: LabelsConfig = {
	title: "",
	subtitle: "",
	// xAxisTitle / yAxisTitle intentionally omitted: `undefined` = "never
	// customized" so a fresh chart falls back to the field name. `""` is
	// reserved for "user explicitly cleared it → no title".
	legendTitles: {},
	configVersion: LABELS_CONFIG_VERSION,
	baseFont: {
		titles: { ...DEFAULT_BASE_FONT_CONFIG.titles },
		text: { ...DEFAULT_BASE_FONT_CONFIG.text },
	},
	fontOverrides: {},
	titleAlignments: {},
	titleVerticalAlignments: {},
	yAxisTitleHorizontal: false,
	titleOffsets: {},
}

/** Resolve a stored alignment for a title slot, defaulting to "center". */
export const titleAlignmentOf = (
	labels: LabelsConfig,
	key: LabelFontKey
): LabelAlignment => labels.titleAlignments?.[key] ?? "center"

/** Map an alignment to an SVG `text-anchor` value. */
export const textAnchorFromAlignment = (
	a: LabelAlignment
): "start" | "middle" | "end" =>
	a === "left" ? "start" : a === "right" ? "end" : "middle"

/** Resolve the stored offset for a title slot, defaulting to zeros.
 * `distance` only ever holds a value for `nodeTitle` (see LabelsConfig). */
export const titleOffsetOf = (
	labels: LabelsConfig,
	key: LabelFontKey
): { x: number; y: number; distance: number } => {
	const o = labels.titleOffsets?.[key]
	return { x: o?.x ?? 0, y: o?.y ?? 0, distance: o?.distance ?? 0 }
}

// ---------------------------------------------------------------------------
// Font resolution
// ---------------------------------------------------------------------------

/**
 * Build the effective FontConfig for a title-like slot by combining the base
 * titles config (picking the right size for the slot) with the per-label
 * override (if any).
 */
export const resolveTitleFont = (
	base: BaseFontConfig,
	slot: "primary" | "subtitle" | "secondary",
	override: Partial<FontConfig> | undefined
): FontConfig => {
	const size =
		slot === "primary"
			? base.titles.primarySize
			: slot === "subtitle"
				? base.titles.subtitleSize
				: base.titles.secondarySize
	return {
		family: override?.family ?? base.titles.family,
		color: override?.color ?? base.titles.color,
		size: override?.size ?? size,
		weight: override?.weight ?? base.titles.weight,
		italic: override?.italic ?? base.titles.italic ?? false,
		underline: override?.underline ?? base.titles.underline ?? false,
	}
}

/**
 * Layer a per-strip facet override (facetColTitle / facetRowTitle) on top of
 * the shared `facetTitle` override. Grid-mode column / row strips inherit the
 * shared facet-title styling and then apply their own tweaks, so a visual that
 * only ever set `facetTitle` keeps its look on both strips. Only DEFINED keys
 * in `over` win — an explicitly-`undefined` field (produced by a field-level
 * "reset" in the font editor) falls back to `base` rather than blanking it.
 */
export const layerFacetOverride = (
	base: Partial<FontConfig> | undefined,
	over: Partial<FontConfig> | undefined
): Partial<FontConfig> | undefined => {
	const out: Partial<FontConfig> = { ...(base ?? {}) }
	for (const [k, v] of Object.entries(over ?? {})) {
		if (v !== undefined) (out as Record<string, unknown>)[k] = v
	}
	return Object.keys(out).length > 0 ? out : undefined
}

/** Build the effective text font (axis tick labels, legend swatch labels). */
export const resolveTextFont = (base: BaseFontConfig): TextFontConfig => ({
	family: base.text.family,
	size: base.text.size,
	color: base.text.color,
	weight: base.text.weight,
	italic: base.text.italic ?? false,
	underline: base.text.underline ?? false,
})

// ---------------------------------------------------------------------------
// Migration — older visualizations shipped a flat `font: FontConfig` on LabelsConfig.
// Translate that into a BaseFontConfig that preserves the prior visuals as
// closely as possible (titles were rendered at font.size * 1.6, subtitle at
// 1.15, axis titles at size + 1).
// ---------------------------------------------------------------------------
type LegacyLabelsConfig = Omit<LabelsConfig, "baseFont"> & {
	font?: Partial<FontConfig>
}

/** Translate a saved font object's legacy boolean `bold` flag into the
 * numeric `weight` field: `bold: true` → 700, absent/false → unset (so the
 * slot inherits its render-site default weight). A `weight` already present
 * always wins — visuals saved after the numeric-weight change never had a
 * `bold` to begin with, but guarding keeps the migration idempotent. The
 * `bold` key is stripped either way so it doesn't linger in storage. */
const migrateBoldToWeight = (
	font: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
	if (!font || typeof font !== "object") return font
	const { bold, ...rest } = font
	if (rest.weight === undefined && bold === true) rest.weight = 700
	return rest
}

export const migrateLabelsConfig = (
	// Accepts either a legacy config (pre-baseFont) or an already-migrated
	// one — the `raw.baseFont` check below distinguishes them — so the param
	// must allow the new-shape `baseFont` that LegacyLabelsConfig omits.
	raw: (Partial<LegacyLabelsConfig> & { baseFont?: BaseFontConfig }) | undefined | null
): LabelsConfig => {
	if (!raw) return { ...DEFAULT_LABELS_CONFIG }
	const base =
		raw.baseFont && typeof raw.baseFont === "object"
			? (raw.baseFont as BaseFontConfig)
			: (() => {
					const legacy: FontConfig = {
						family: raw.font?.family ?? DEFAULT_FONT_CONFIG.family,
						color: raw.font?.color ?? DEFAULT_FONT_CONFIG.color,
						size: raw.font?.size ?? DEFAULT_FONT_CONFIG.size,
					}
					return {
						titles: {
							family: legacy.family,
							color: legacy.color,
							primarySize: Math.round(legacy.size * 1.6),
							subtitleSize: Math.round(legacy.size * 1.15),
							secondarySize: legacy.size + 1,
						},
						text: {
							family: legacy.family,
							size: legacy.size,
							color: legacy.color,
						},
					}
				})()
	// Translate the legacy boolean `bold` flag → numeric `weight` everywhere
	// it could have been stored: the two base-font slots and every per-label
	// override.
	const migratedBase: BaseFontConfig = {
		titles: migrateBoldToWeight(
			base.titles as unknown as Record<string, unknown>
		) as unknown as TitlesFontConfig,
		text: migrateBoldToWeight(
			base.text as unknown as Record<string, unknown>
		) as unknown as TextFontConfig,
	}
	const migratedOverrides: LabelsConfig["fontOverrides"] = {}
	for (const [key, override] of Object.entries(raw.fontOverrides ?? {})) {
		migratedOverrides[key as LabelFontKey] = migrateBoldToWeight(
			override as Record<string, unknown>
		) as Partial<FontConfig>
	}
	// Three-state title migration. Current blobs (configVersion set) store the
	// three states verbatim: undefined = fallback, "" = blank, string = custom.
	// Legacy blobs (no configVersion) predate the "blank" state — their "" (and
	// undefined) always meant "use the field name", so collapse empties back to
	// undefined; otherwise every un-customized axis / legend on an old visual
	// would suddenly lose its title.
	const isLegacy = (raw as { configVersion?: number }).configVersion === undefined
	const migrateTitle = (v: string | undefined): string | undefined =>
		isLegacy ? (v ? v : undefined) : v
	const migratedLegendTitles: LabelsConfig["legendTitles"] = {}
	for (const [ch, v] of Object.entries(raw.legendTitles ?? {})) {
		const migrated = migrateTitle(v as string | undefined)
		if (migrated !== undefined)
			migratedLegendTitles[ch as LegendChannel] = migrated
	}
	return {
		title: raw.title ?? "",
		subtitle: raw.subtitle ?? "",
		xAxisTitle: migrateTitle(raw.xAxisTitle),
		yAxisTitle: migrateTitle(raw.yAxisTitle),
		legendTitles: migratedLegendTitles,
		configVersion: LABELS_CONFIG_VERSION,
		baseFont: migratedBase,
		fontOverrides: migratedOverrides,
		// Preserve newer fields when present. Without these, loading an older
		// visual (or any visual whose migration ran before these fields
		// existed) silently dropped the user's alignment/rotation settings.
		// `titleOffsets` belongs to this same set — omitting it made every
		// export/embed re-hydration (which runs through this migration) lose
		// all title offsets, incl. the facet panel title, even though the
		// live editor kept them (it never re-migrates the in-session value).
		titleAlignments: raw.titleAlignments ?? {},
		titleVerticalAlignments:
			(raw as { titleVerticalAlignments?: LabelsConfig["titleVerticalAlignments"] })
				.titleVerticalAlignments ?? {},
		yAxisTitleHorizontal: raw.yAxisTitleHorizontal ?? false,
		titleOffsets: raw.titleOffsets ?? {},
	}
}
