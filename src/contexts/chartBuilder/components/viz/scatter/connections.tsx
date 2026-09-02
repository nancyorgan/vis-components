import { buildLinePath } from "../../../lib/linePath"
import {
	DEFAULT_CONNECTION_CONFIG,
	type ChannelConfigs,
	type ColorSlotConfig,
	type LineDashPattern,
} from "../../../lib/channelConfig"
import { resolveConnectionStroke } from "../../../lib/connectionStroke"
import { resolveConnectionThickness } from "../../../lib/connectionThickness"
import {
	dashArrayFor,
	dashSpecForPatternValue,
	resolveDashGapColor,
	resolveDashGapFill,
	sanitizeCustomDasharray,
	splitIntoValueRuns,
} from "../../../lib/dashPatterns"
import { inkPaletteForHue, type ThemeInkFallback } from "../../../lib/patterns"
import { sortByDrawOrder } from "../../../lib/drawOrder"
import { resolveSlotColor } from "../../../lib/resolveLayerColor"
import {
	applyHueScale,
	applyPositionScale,
	CATEGORICAL_HUE_PALETTE,
	makeHueScale,
	type PositionScale,
} from "../../../lib/scales"
import { splitPolylineAtRange } from "../../../lib/dashRange"
import type { DatasetView, Encodings, FieldType } from "../../../lib/types"
import type { AestheticScales } from "../../../store/useAestheticScales"
import {
	rowHighlight,
	type LegendHighlight,
} from "../../../store/useLegendHighlight"
import type { HoverState, Mark } from "./types"

/** Group marks by connection-field value and draw one polyline per group.
 * Min 2-point groups only; points sorted by cx; stroke resolves through the
 * shared `resolveConnectionStroke` chain (per-value override → line palette
 * → global stroke override → theme connection color, with the Line color
 * slot owning the color when configured).
 *
 * Each line can carry a per-group dash pattern. Non-solid dashes render
 * via TWO stacked polylines: an "alternate" (gap-filling) underlay drawn
 * solid in the alternate color, and the dashed top line drawn in the
 * usual line color. The visual result is alternating two-color dashes —
 * the user's stated requirement for distinguishing line groups beyond
 * color alone. */
/** Stroke props shared by a connection line whether it renders as a
 *  `<polyline>` (straight) or a `<path>` (smoothed) — see `renderLine`. */
type LineVisualProps = {
	fill?: "none"
	stroke?: string
	strokeWidth?: number
	strokeLinecap?: "round" | "butt" | "square"
	strokeLinejoin?: "round"
	strokeDasharray?: string
	opacity?: number
	/** `vc-line-hit`, on the invisible hover-hit overlay only — lets tests
	 *  (and any styling) tell hit strokes apart from visible lines. */
	className?: string
	/** Set on the invisible hover-hit overlay so its (transparent) stroke
	 *  still captures pointer events; visible lines never set this. */
	pointerEvents?: "stroke"
	onMouseMove?: (e: React.MouseEvent<SVGElement>) => void
	onMouseEnter?: () => void
	onMouseLeave?: () => void
}

export const renderConnectionLines = (
	marks: Mark[],
	encodings: Encodings,
	channelConfigs: ChannelConfigs,
	/** Opacity for every connection line, from the Line opacity slot (absolute:
	 *  a single level for all lines, since a polyline spans many rows). */
	lineOpacity: number,
	/** Line color slot scale (present only when "vary by" a field). */
	lineSlot: AestheticScales["colorSlots"]["line"],
	/** Theme default single color for lines — used in single-color mode or when
	 *  no per-value override / slot field applies (a real color, not the fill). */
	connectionColor: string,
	/** X scale + field type, for resolving the dash-range From/To values
	 *  ("Apply pattern to range") to pixel boundaries. */
	xScale: PositionScale,
	xType: FieldType,
	/** Active dataset — lets the "Draw order" setting rank the SERIES paint
	 *  order the same way it ranks overlapping points. */
	dataset: DatasetView | undefined,
	/** User-defined category order for the draw-order field (if any), so
	 *  series rank by legend order rather than alphabetically. */
	drawOrderLevels: readonly string[] | undefined,
	/** The hue field's type — picks the palette whose paired pattern inks
	 *  the dash-gap color resolves from (ordinal hue fields render from the
	 *  ordinal palette; see `inkPaletteForHue`). */
	hueType: FieldType | undefined,
	/** Cross-palette ink table (`AestheticScales.themeInkFallback`) so lines
	 *  colored with swatches borrowed from other theme palettes still find
	 *  their paired dash-gap ink. */
	themeInkFallback?: ThemeInkFallback,
	/** Tooltip hook: when provided, each line group gets an invisible wide
	 *  hit stroke that publishes a HoverTooltip showing the connection value
	 *  plus every field constant across the series. Omitted = lines stay
	 *  non-interactive (export/thumbnail captures). */
	setHovered?: (h: HoverState | null) => void,
	/** Legend / mark-hover highlight. A line recedes with its series when
	 *  another one is hovered — fade only, since a line's color comes from
	 *  its own independent Line color slot (same reasoning as the stems). */
	highlight: LegendHighlight | null = null,
	/** Publish the hovered LINE's series to the highlight atom, so pointing
	 *  at a line highlights it exactly like pointing at one of its points.
	 *  On a line chart the line IS the mark the user aims for — the points
	 *  are often small or sampled away entirely. */
	publishHover?: (row: Record<string, unknown>) => void
) => {
	const connectionField = encodings.connection?.field ?? null
	if (!connectionField) return null
	const cfg = {
		...DEFAULT_CONNECTION_CONFIG,
		...channelConfigs.connection,
	}
	// "Apply pattern to range": resolve From/To to pixel boundaries once —
	// raw axis values parsed like value-mode annotation coordinates. A value
	// that doesn't parse = unbounded on that side; neither parsing = the
	// range is inert (dash the whole line, same as off).
	const dashRange = cfg.dashRange
	const rangeBoundaryPx = (v: number | string | null): number | null =>
		v === null || v === "" ? null : applyPositionScale(xScale, v, xType)
	const rangeMinPx = dashRange?.enabled ? rangeBoundaryPx(dashRange.min) : null
	const rangeMaxPx = dashRange?.enabled ? rangeBoundaryPx(dashRange.max) : null
	const rangeActive =
		dashRange?.enabled === true && (rangeMinPx !== null || rangeMaxPx !== null)
	// Per-line thickness overrides (keyed by connection group value). Empty /
	// absent → every line uses the single `cfg.thickness`, byte-identical to
	// before. Resolved per group inside the flatMap below.
	const thicknessByValue = cfg.thicknessByValue
	// "square" maps to SVG's butt cap so lines and dash segments end flush
	// at the data position instead of extending half a stroke-width past it.
	const strokeCap = cfg.lineCap === "square" ? "butt" : "round"
	// Line smoothing: 0 (default) keeps the plain straight-segment <polyline>
	// so existing visuals + tests render byte-identically; > 0 swaps in a
	// cardinal-spline <path> through the same points. `renderLine` picks the
	// right element so every solid/dashed/range branch below stays uniform.
	const smoothing = cfg.smoothing ?? 0
	const renderLine = (
		key: string,
		points: Array<{ x: number; y: number }>,
		props: LineVisualProps
	): React.ReactElement =>
		smoothing > 0 ? (
			<path key={key} d={buildLinePath(points, smoothing)} {...props} />
		) : (
			<polyline
				key={key}
				points={points.map((p) => `${p.x},${p.y}`).join(" ")}
				{...props}
			/>
		)
	const lineColors = cfg.lineColors
	const dashPatterns = cfg.dashPatterns ?? {}
	const dashAlternateColors = cfg.dashAlternateColors ?? {}
	const defaultDash: LineDashPattern = cfg.defaultDashPattern ?? "solid"
	// The panel's "Custom" default dash: a user-typed dasharray that wins
	// over the swatch pick when it parses; per-group `dashPatterns`
	// overrides still win over both.
	const defaultDashArray =
		(cfg.customDashPattern
			? sanitizeCustomDasharray(cfg.customDashPattern)
			: null) ?? dashArrayFor(defaultDash)
	// "Blank" dash pick: within the range window the line doesn't draw at
	// all — a true gap, or the gap-color underlay alone when "Fill dash
	// gaps" is on. A parsed custom dasharray wins over the swatch pick
	// (defaultDashArray is non-null then), same precedence as the other
	// swatches; without an active range blank is inert (falls through to
	// solid below, since its dasharray is null).
	const defaultBlank = defaultDash === "blank" && defaultDashArray === null
	// Dash-gap color inputs — the same palette-paired pattern-ink options
	// area patterns resolve their ink from (see `resolveDashGapColor`).
	const { palette: inkPalette, inks: palettePatternInks } = inkPaletteForHue(
		channelConfigs,
		hueType
	)
	const patternInkColors = channelConfigs.pattern?.inkColors ?? {}
	const defaultPatternInk = channelConfigs.defaultPatternInk ?? null
	const dashGapColor = cfg.dashGapColor ?? null
	// The panel's gap swatches key `dashAlternateColors` by HUE value (the
	// color encoding's categories); each line samples its hue value from its
	// first row. The connection-group key is tried second for saved visuals
	// keyed the old way.
	const hueField = encodings.hue?.field ?? null
	// Pattern encoding on line charts drives the LINE DASH STYLE. When the
	// pattern field varies WITHIN a connection group (e.g. a known-vs-
	// projected column on a series that spans both), the polyline splits
	// into runs of constant pattern value and each run renders with its own
	// category's dash — see `splitIntoValueRuns`. Per-category resolution
	// (custom dasharray > swatch override > DASH_CYCLE auto-cycle) is the
	// shared `dashSpecForPatternValue`. Point-fill patterns are tracked
	// SEPARATELY in `pattern.overrides` and resolved in the point render
	// loop above; the two effects don't share storage.
	const patternField = encodings.pattern?.field ?? null
	const dashOverrides = channelConfigs.pattern?.dashOverrides ?? {}
	const customDashOverrides = channelConfigs.pattern?.customDashOverrides ?? {}
	const patternValues = patternField
		? [
				...new Set(
					marks
						.map((m) => m.row[patternField])
						.filter((v) => v !== undefined && v !== null)
						.map(String)
				),
			]
		: []
	// Whether dash gaps get the alternate-color underlay (connected
	// two-color line) or stay empty (truly dashed). Auto unless the user
	// chose: filled, except when pattern and hue map the same field.
	const gapFill = resolveDashGapFill({
		configured: cfg.dashGapFill ?? null,
		patternField,
		hueField: encodings.hue?.field ?? null,
	})
	const groups = new Map<string, Mark[]>()
	marks.forEach((m) => {
		const raw = m.row[connectionField]
		if (raw === undefined || raw === null) return
		const key = String(raw)
		if (key === "") return
		const list = groups.get(key) ?? []
		list.push(m)
		groups.set(key, list)
	})
	// Line-palette index by the group's position in encounter order —
	// counted over ALL groups (including <2-point ones the filter below
	// drops) so a group keeps its palette color as points come and go.
	// Mirrors RadarPlot's groupIdx counting.
	const groupKeys = [...groups.keys()]
	// Series paint order. Palette indices count over `groupKeys` (encounter
	// order) so a line keeps its color regardless of paint order, but WHICH
	// line draws on top follows the Aesthetics "Draw order" setting — ranking
	// each series by its representative row (its connection value and any
	// field constant within the series). Later in the array = painted last =
	// on top, matching the point-mark sort. No setting → encounter order.
	const orderedEntries = sortByDrawOrder(
		[...groups.entries()],
		([, groupMarks]) => groupMarks[0]?.row ?? {},
		channelConfigs.drawOrder,
		dataset,
		drawOrderLevels
	)
	// Invisible hover-hit overlays, one per line group. Collected during the
	// same pass that builds the visible segments and appended AFTER all of
	// them (in the same paint order), so at a crossing the hover goes to the
	// line drawn on top — and the visible strokes never sit above a hit line
	// to swallow its events. Points render in a later <g>, so hovering a
	// marker still wins with its richer per-row tooltip.
	const hitLines: React.ReactElement[] = []
	const lines = orderedEntries
		.filter(([, groupMarks]) => groupMarks.length >= 2)
		.flatMap(([groupValue, groupMarks]) => {
			const sorted = [...groupMarks].sort((a, b) => a.cx - b.cx)
			const ptObjs = sorted.map((m) => ({ x: m.cx, y: m.cy }))
			const lineThickness = resolveConnectionThickness({
				groupKey: groupValue,
				thickness: cfg.thickness,
				byValue: thicknessByValue,
			})
			if (setHovered) {
				// Tooltip fields: the connection value plus every dataset field
				// whose value is constant across the series (hue, series-level
				// attributes, …). Per-point fields (x/y) vary, so they drop out —
				// a line spans many rows and showing one arbitrary row would
				// mislead. Computed lazily on first hover and cached: groups can
				// be large and mousemove fires continuously.
				let cachedFields: HoverState["fields"] = undefined
				const tooltipFields = (): NonNullable<HoverState["fields"]> => {
					if (cachedFields) return cachedFields
					const rows = sorted.map((m) => m.row)
					const constant = (dataset?.fields ?? [])
						.map((f) => ({ name: f.name, value: rows[0]?.[f.name] }))
						.filter(
							({ name, value }) =>
								value !== undefined &&
								value !== null &&
								value !== "" &&
								rows.every((r) => r[name] === value)
						)
					cachedFields = constant.some((f) => f.name === connectionField)
						? constant
						: [{ name: connectionField, value: groupValue }, ...constant]
					return cachedFields
				}
				hitLines.push(
					renderLine(`conn-${groupValue}-hit`, ptObjs, {
						className: "vc-line-hit",
						fill: "none",
						stroke: "transparent",
						// Generous hit target — a 1–2px stroke is unhoverable.
						strokeWidth: Math.max(lineThickness + 8, 12),
						strokeLinecap: strokeCap,
						strokeLinejoin: "round",
						pointerEvents: "stroke",
						// The highlight publishes ONCE on enter; the tooltip
						// tracks the pointer on move (below).
						onMouseEnter: () => publishHover?.(sorted[0]?.row ?? {}),
						// mousemove (not enter) so the tooltip follows the pointer
						// along the line instead of sticking at the entry point.
						onMouseMove: (e) =>
							setHovered({
								i: null,
								row: sorted[0]?.row ?? {},
								clientX: e.clientX,
								clientY: e.clientY,
								fields: tooltipFields(),
							}),
						onMouseLeave: () => setHovered(null),
					})
				)
			}
			// Line color: the shared connection-stroke chain. The Line color
			// slot owns it when configured — "vary by" a field runs the scale
			// per group, "single color" returns the slot's color. The legacy
			// fallback chain runs per-value override → theme line palette →
			// global stroke override → theme connection color (a real single
			// color, NOT the point fill).
			const stroke = resolveConnectionStroke({
				groupKey: groupValue,
				lineColors,
				linePalette: cfg.linePalette ?? null,
				paletteIdx: groupKeys.indexOf(groupValue),
				strokeColor: cfg.strokeColor ?? null,
				fallback: connectionColor,
				lineSlotCfg: channelConfigs.colorSlots?.line,
				lineSlot,
				slotRow: sorted[0]?.row ?? { [connectionField]: groupValue },
			})
			// Legend / mark-hover highlight for this SERIES, resolved off its
			// representative row — the same first-row convention `stroke` and
			// the dash-gap hue sampling already use (the hovered field is a
			// series-level attribute in practice). The matched line takes the
			// same treatment as its points: recolored to the highlight fill,
			// outlined-and-thickened when outline is on, and faded when it's
			// another series. Mirrors AreaPlot's `effStroke` / `effThickness`
			// so a line and an area edge highlight identically.
			const mh = rowHighlight(
				highlight,
				sorted[0]?.row ?? { [connectionField]: groupValue }
			)
			const effStroke = mh.outline ?? mh.fill ?? stroke
			const effThickness = mh.outline
				? Math.max(lineThickness, mh.outlineWidth)
				: lineThickness
			// Folded into the shared `lineProps` so every branch below —
			// solid, dashed, the gap-fill underlay, per-pattern runs, range
			// segments — inherits it, and nothing changes when nothing is
			// hovered.
			const lineProps = {
				fill: "none",
				strokeWidth: effThickness,
				strokeLinecap: strokeCap,
				strokeLinejoin: "round",
				opacity: lineOpacity * mh.opacityMul,
			} as const
			// One segment of this group's line. Solid: a single polyline.
			// Non-solid: a dashed top line, stacked on an underlay (the
			// palette-paired gap color, solid, same thickness) when `gapFill`
			// is on so the gaps between dashes show as the paired color and
			// the line reads as one connected two-color line; with `gapFill`
			// off the gaps stay empty (truly dashed). `blank` = the segment is
			// ALL gap: no top line at all, just the underlay when `gapFill` is
			// on (nothing otherwise) — the range window's "Blank" pick.
			const renderSegment = (
				keyBase: string,
				pts: Array<{ x: number; y: number }>,
				dashArray: string | null,
				patternValue: string | null = null,
				blank = false
			): React.ReactElement[] => {
				if (pts.length < 2) return []
				if (dashArray === null && !blank) {
					return [renderLine(keyBase, pts, { stroke: effStroke, ...lineProps })]
				}
				const els: React.ReactElement[] = []
				if (gapFill) {
					const hueValueRaw = hueField ? sorted[0]?.row[hueField] : null
					els.push(
						renderLine(`${keyBase}-bg`, pts, {
							stroke: resolveDashGapColor({
								// The pre-highlight stroke — the hue/palette color the
								// line inherits — so the ink pairing lookup can hit.
								overrideKeys: [
									hueValueRaw === null || hueValueRaw === undefined
										? null
										: String(hueValueRaw),
									groupValue,
								],
								patternValue,
								lineColor: stroke,
								overrides: dashAlternateColors,
								singleOverride: dashGapColor,
								inkColors: patternInkColors,
								palette: inkPalette,
								patternInks: palettePatternInks,
								themeInkFallback,
								defaultInk: defaultPatternInk,
							}),
							...lineProps,
						})
					)
				}
				if (dashArray !== null) {
					els.push(
						renderLine(keyBase, pts, {
							stroke: effStroke,
							strokeDasharray: dashArray,
							...lineProps,
						})
					)
				}
				return els
			}
			// Pattern encoding mapped: split the line into runs of constant
			// pattern value; each run renders with its category's dash.
			// Dash precedence per run: per-line override (legacy data, no UI,
			// kept for back-compat) > Pattern encoding (custom dasharray >
			// swatch override > DASH_CYCLE auto-cycle) > global default.
			// "Apply pattern to range" is IGNORED here — the pattern variable
			// already says where each dash applies, and the two windows would
			// conflict (the panel hides the range rows in this state too).
			if (patternField) {
				const runs = splitIntoValueRuns(sorted, (m) => {
					const raw = m.row[patternField]
					return raw === undefined || raw === null ? null : String(raw)
				})
				return runs.flatMap((run, ri) => {
					const spec =
						run.value !== null
							? dashSpecForPatternValue(
									run.value,
									dashOverrides,
									customDashOverrides,
									patternValues
								)
							: null
					const dashArray =
						spec?.kind === "custom"
							? spec.dasharray
							: dashPatterns[groupValue] !== undefined
								? dashArrayFor(dashPatterns[groupValue] ?? "solid")
								: spec?.kind === "pattern"
									? dashArrayFor(spec.pattern)
									: defaultDashArray
					return renderSegment(
						runs.length === 1
							? `conn-${groupValue}`
							: `conn-${groupValue}-r${ri}`,
						run.items.map((m) => ({ x: m.cx, y: m.cy })),
						dashArray,
						run.value
					)
				})
			}
			// No pattern encoding: one dash for the whole line (per-line
			// override > global default, custom dasharray included).
			const groupDash = dashPatterns[groupValue]
			const dashArray =
				groupDash !== undefined
					? dashArrayFor(groupDash ?? "solid")
					: defaultDashArray
			const blank = groupDash !== undefined ? groupDash === "blank" : defaultBlank
			// "Apply pattern to range": dash only within [From, To] — the
			// parts outside render solid (known vs forecast). Boundary
			// points are interpolated so the segments meet exactly; the
			// alternate-color underlay only backs the dashed segment. A
			// "Blank" pick draws no line inside the window at all — a true
			// gap, or the gap-color underlay alone when `gapFill` is on.
			if ((dashArray !== null || blank) && rangeActive) {
				const segs = splitPolylineAtRange(
					sorted.map((m) => ({ x: m.cx, y: m.cy })),
					rangeMinPx,
					rangeMaxPx,
					"x"
				)
				return [
					...renderSegment(`conn-${groupValue}-pre`, segs.before, null),
					...renderSegment(`conn-${groupValue}-post`, segs.after, null),
					...renderSegment(
						`conn-${groupValue}-in`,
						segs.inside,
						dashArray,
						null,
						blank
					),
				]
			}
			return renderSegment(`conn-${groupValue}`, ptObjs, dashArray)
		})
	return (
		<g>
			{lines}
			{hitLines}
		</g>
	)
}

/** Draw a per-point stem from each mark to an axis line — the primitive
 *  behind lollipop charts. This is a DERIVED per-point mark, not the
 *  connection-group polyline: it needs no connection field and ignores
 *  grouping. The stem lands on the axis line itself (the plot-area edge),
 *  so it reads as a lollipop regardless of whether the value axis starts
 *  at zero — or, in the custom modes, on a user-typed data-value line
 *  (`axisStemCustomX` / `axisStemCustomY`) that needn't be an axis at
 *  all. Stem color matches each point's fill; thickness reuses the
 *  connection `thickness`. Rendered before the points so dots sit on top. */
export const renderAxisStems = (
	marks: Mark[],
	channelConfigs: ChannelConfigs,
	xScale: PositionScale,
	yScale: PositionScale,
	stemSlot: AestheticScales["colorSlots"]["stem"],
	stemSlotCfg: ColorSlotConfig | undefined,
	/** Per-row stem opacity from the Stem opacity slot. */
	stemOpacity: (row: Record<string, unknown>) => number,
	/** Theme default single color for stems (used when the slot is in
	 *  single-color mode or unconfigured) — a real color, not the point fill. */
	connectionColor: string,
	/** Legend / mark-hover highlight. A stem is part of its point's mark, so
	 *  it takes the same treatment: recolored with the point when recolor is
	 *  on, thickened when outline is on, faded when another series is
	 *  hovered. A recolored dot on an un-recolored stem reads as a bug. */
	highlight: LegendHighlight | null = null
) => {
	const cfg = { ...DEFAULT_CONNECTION_CONFIG, ...channelConfigs.connection }
	const stem = cfg.axisStem ?? "none"
	if (stem === "none") return null
	const thickness = cfg.thickness
	// The axis line sits at the plot-area edge: the x-axis along the bottom
	// (largest y pixel), the y-axis along the left (smallest x pixel).
	// Reading the edge off the scale's range keeps us agnostic to range
	// direction (the y-scale's range is inverted top-to-bottom).
	const baselineY = Math.max(...yScale.range())
	const baselineX = Math.min(...xScale.range())
	// Custom-threshold stems land on a DATA value instead of the plot edge —
	// e.g. stems from y = 1 on a ratio chart whose axis still sits at 0. The
	// typed value runs through the position scale as a quantitative; the
	// landing pixel clamps to the plot area so an off-domain threshold can't
	// draw past the panel. A value the scale can't place (categorical axis)
	// falls back to the edge, matching the plain axis-stem look.
	const clampToRange = (px: number, range: number[]): number =>
		Math.min(Math.max(px, Math.min(...range)), Math.max(...range))
	const customPx = (scale: PositionScale, value: number | null): number | null => {
		const px = applyPositionScale(scale, value ?? 0, "quantitative")
		return px !== null && Number.isFinite(px)
			? clampToRange(px, scale.range() as number[])
			: null
	}
	const customY =
		stem === "custom-y" ? customPx(yScale, cfg.axisStemCustomY ?? null) : null
	const customX =
		stem === "custom-x" ? customPx(xScale, cfg.axisStemCustomX ?? null) : null
	// Optional INDEPENDENT stem-color encoding:
	//   - "point" (default): each stem inherits its point's fill.
	//   - "single": every stem uses the one `stemColor` swatch.
	//   - "field": stems are colored by `stemColorField` through the
	//     user-picked categorical palette (colors snapshotted on the config).
	const stemMode = cfg.stemColorMode ?? "point"
	const stemColorField = cfg.stemColorField ?? null
	const stemPalette =
		cfg.stemColorPalette && cfg.stemColorPalette.length > 0
			? cfg.stemColorPalette
			: CATEGORICAL_HUE_PALETTE
	const stemHueScale =
		stemMode === "field" && stemColorField
			? makeHueScale(
					marks.map((m) => m.row[stemColorField]),
					"categorical",
					undefined,
					stemPalette
				)
			: null
	const colorFor = (m: Mark): string => {
		// The stem color slot, when configured, owns the color (independent
		// field mapping or single color). In single-color mode (or with no
		// slot) stems draw the theme connection color — a real single color
		// matching the swatch — NOT the point fill.
		if (stemSlotCfg)
			return resolveSlotColor(stemSlot, stemSlotCfg, m.row, connectionColor)
		if (stemMode === "single") return cfg.stemColor ?? connectionColor
		if (stemMode === "field" && stemColorField && stemHueScale) {
			return (
				applyHueScale(stemHueScale, m.row[stemColorField], "categorical") ??
				connectionColor
			)
		}
		return connectionColor
	}
	const stems = marks.map((m) => {
		// Vertical stems (to a horizontal line): x-axis edge or custom y.
		// Horizontal stems (to a vertical line): y-axis edge or custom x.
		const [x2, y2] =
			stem === "x-axis" || stem === "custom-y"
				? [m.cx, customY ?? baselineY]
				: [customX ?? baselineX, m.cy]
		const mh = rowHighlight(highlight, m.row)
		return (
			<line
				key={`stem-${m.i}`}
				className="vc-axis-stem"
				x1={m.cx}
				y1={m.cy}
				x2={x2}
				y2={y2}
				stroke={mh.outline ?? mh.fill ?? colorFor(m)}
				strokeWidth={
					mh.outline ? Math.max(thickness, mh.outlineWidth) : thickness
				}
				strokeLinecap="round"
				opacity={stemOpacity(m.row) * mh.opacityMul}
			/>
		)
	})
	return <g>{stems}</g>
}
