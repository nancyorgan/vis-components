import { rgb as d3Rgb } from "d3-color"
import { scalePow } from "d3-scale"
import { useEffect, useRef } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import {
	DEFAULT_AREA_CONFIG,
	DEFAULT_FILL,
	DEFAULT_OPACITY,
	DEFAULT_SHAPE_CONFIG,
	type LineDashPattern,
} from "../../lib/channelConfig"
import { LEGEND_SWATCH_OUTLINE } from "../../lib/previewInk"
import type { ColorSlotKey } from "../../lib/channelConfig"
import {
	densityCurveGroupField,
	densityCurveOn,
} from "../../lib/colorSlots"
import {
	flowNodeNames,
	resolveFlowEndpoints,
} from "../../lib/buildFlowGraph"
import { isFlowModeId } from "../../lib/packedMeasure"
import { DASH_CYCLE, dashArrayFor } from "../../lib/dashPatterns"
import { resolveRuleColor } from "../../lib/textColorRules"
import { LEGEND_CANDIDATE_CHANNELS } from "../../lib/channels"
import { useChartModeDef } from "../../store/useChartModeDef"
import { DEFAULT_TOOLTIP_CONFIG } from "../../lib/labelsConfig"
import {
	DEFAULT_LEGEND_CONFIG,
	LEGEND_FRIENDLY_NAME,
	legendFontKey,
	legendSwatchOutlineColor,
	legendSwatchOutlineWidth,
	legendSwatchShape,
	legendSwatchSize,
	type LegendSwatchShape,
	resolveLegendTextFont,
	resolveTitleFont,
	titleAlignmentOf,
	type FontConfig,
	type GradientBarStyle,
	type LegendChannel,
	type LegendChannelConfig,
	type LegendConfig,
	QUANTITATIVE_LEGEND_CHANNELS,
	type QuantitativeLegendChannel,
	resolveGradientBarStyle,
	resolveLegendHidden,
	type SwatchShapeChannel,
} from "../../lib/labelsConfig"
import { histogramMeasureDomain } from "../../lib/histogramBins"
import { resolveHistogramMeasure } from "../../lib/histogramMeasure"
import {
	DEFAULT_HEXBIN_BIN_COUNT,
	resolveHexbinCells,
} from "../../lib/hexbins"
import { HEXBIN_COUNT_LABEL, hexbinEligible } from "../../lib/hexbinMeasure"
import {
	buildLegendFormatter,
	decorateOpenEndLabel,
	legendDataExtent,
	resolveLegendBreaks,
	resolveLegendChannelConfig,
	resolveLegendDomain,
} from "../../lib/legendBreaks"
import {
	inkForHueColor,
	inkPaletteForHue,
	PATTERN_PALETTE,
	patternCategoriesFor,
	resolvePatternForCategory,
	resolvePatternForMark,
} from "../../lib/patterns"
import {
	BASE_MARGIN,
	subtitleReserve,
	titleReserve,
} from "../../lib/plotLayout"
import {
	applyAreaScale,
	applyHueScale,
	makeAngleScale,
	makeAreaScale,
	makeBrightnessScale,
	makeHueScale,
	makeLengthScale,
	makeOpacityScale,
	makeSaturationScale,
	makeShapeIndexer,
	modulateColor,
	ordinalAreaCategories,
	outlinePaletteForHueType,
	parseValue,
	symbolPath,
} from "../../lib/scales"
import type { HueScale } from "../../lib/scales"
import { applyLevelOrder } from "../../lib/smartSort"
import type { EncodingChannel, FieldType } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentRenderedGradientBarLengthAtom,
	currentThemeIdAtom,
	currentTooltipConfigAtom,
	hoveredLegendEntryAtom,
	type AtomValueType,
	themeAtom,
	themesAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

const effectiveType = (
	inferred: FieldType | undefined,
	override: FieldType | undefined
): FieldType => override ?? inferred ?? "categorical"

const uniqueValues = (values: unknown[], type: FieldType): string[] => [
	...new Set(
		values
			.map((v) => parseValue(v, type))
			.filter((v) => v !== null)
			.map(String)
	),
]

/** Reorder a discovery-ordered category list to follow the user's pinned
 *  field ordering (from the Fields reorder UI), so the legend lists values
 *  in the same order the axis / marks already use via `makePositionScale`.
 *
 *  No pinned order → discovery order is returned UNCHANGED. This preserves
 *  the historical behavior (and keeps the legend consistent with the marks)
 *  for every field the user hasn't explicitly reordered — in particular we
 *  do NOT smart-sort here, since the per-value color/opacity/etc. scales the
 *  legend reads are themselves built in discovery order. */
const orderCategories = (
	discovered: string[],
	type: FieldType,
	pinnedOrder: readonly string[] | undefined
): string[] =>
	pinnedOrder && pinnedOrder.length > 0
		? applyLevelOrder(discovered, type, pinnedOrder)
		: discovered

/** Pixel offsets the chart wrapper must reserve on each side to make room
 *  for an inside-positioned legend that the user's coords pushed past the
 *  plot rectangle. ChartCanvas owns the computation; Legend just receives
 *  it and adjusts its calc() position so the user's `insideX/Y` map to the
 *  reduced plot. */
export type InsideExtras = {
	top: number
	right: number
	bottom: number
	left: number
}

type LegendOuterProps = {
	/** Set by ChartCanvas for `position === "inside"` — extra margin the
	 *  chart wrapper has reserved on each side because the legend would
	 *  otherwise overflow the canvas. The legend's calc() incorporates
	 *  these so the user's plot-normalized coord maps to the reduced
	 *  plot rectangle. */
	insideExtras?: InsideExtras
	/** Measurement callback ChartCanvas attaches when it needs the
	 *  legend's size to compute `insideExtras`. */
	insideMeasureRef?: (el: HTMLElement | null) => void
	/** Set by ChartCanvas for edge positions when the fixed aspect ratio
	 *  leaves slack: a pulling negative margin (plus relative z-index) that
	 *  moves the legend flush against the centered figure. Applied directly
	 *  to the OUTER element — a wrapper div would drop the root's
	 *  flex-sensitive classes (`flex-shrink-0`, `self-end`/`self-center`,
	 *  cross-axis stretch) and shift ratio-off layouts. Each position's pull
	 *  margin uses a side the position styles leave unset, so merging after
	 *  them never collides. */
	pullStyle?: React.CSSProperties
}

const ZERO_EXTRAS: InsideExtras = { top: 0, right: 0, bottom: 0, left: 0 }

/** Wraps a single categorical legend entry so hovering it publishes
 * `{ field, value }` to `hoveredLegendEntryAtom` — the plot renderers read
 * that and highlight matching marks (the "hover over legend to highlight visual
 * elements" option). The wrapper also fades the OTHER legend entries to match
 * the marks when "Fade other elements" is on, so the legend and chart read as
 * one gesture. When `field` is undefined (feature off, or a quantitative/slot
 * section) it renders the entry untouched. */
const EntryHoverWrap = ({
	field,
	value,
	children,
}: {
	field: string | undefined
	value: string
	children: React.ReactNode
}) => {
	const hovered = useAtomValue(hoveredLegendEntryAtom)
	const setHovered = useSetAtom(hoveredLegendEntryAtom)
	const cfg = { ...DEFAULT_TOOLTIP_CONFIG, ...useAtomValue(currentTooltipConfigAtom) }
	if (!field) return <>{children}</>
	const fadeOn = (cfg.hoverEnabled ?? true) && (cfg.hoverFade ?? true)
	const isThisHovered =
		hovered !== null && hovered.field === field && hovered.value === value
	// Fade this entry when SOMETHING else is hovered (in this legend or another
	// section) and fade is on — mirroring the marks' fade so the two agree.
	const faded = fadeOn && hovered !== null && !isThisHovered
	const fadedOpacity =
		1 - Math.min(Math.max(cfg.hoverFadeAmount ?? 0.85, 0), 1)
	return (
		<div
			onMouseEnter={() => setHovered({ field, value })}
			onMouseLeave={() => setHovered(null)}
			style={{
				opacity: faded ? fadedOpacity : 1,
				transition: "opacity 120ms ease",
			}}
		>
			{children}
		</div>
	)
}

export const Legend = ({
	insideExtras = ZERO_EXTRAS,
	insideMeasureRef,
	pullStyle,
}: LegendOuterProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const labels = useAtomValue(currentLabelsAtom)
	// Legend-hover highlighting is on only when BOTH the "Show hover" master
	// toggle and its "highlight visual elements" sub-option are enabled (both
	// default on; back-compat undefined → on). When off, entries never publish
	// a hovered value, so the plots stay un-dimmed.
	const tooltipCfg = {
		...DEFAULT_TOOLTIP_CONFIG,
		...useAtomValue(currentTooltipConfigAtom),
	}
	const legendHighlightEnabled =
		(tooltipCfg.hoverEnabled ?? true) && (tooltipCfg.legendHighlight ?? true)
	// When opacity is NOT mapped to a field, every mark renders at the global
	// `defaultOpacity` (see ScatterPlot). Mirror that on the legend swatches so
	// a dialed-down opacity reads the same in the legend as on the chart. When
	// opacity IS encoded, marks vary per-value and the opacity channel gets its
	// own legend section — leave the other swatches fully opaque.
	const opacityFieldMapped = !!encodings.opacity?.field
	const defaultSwatchOpacity = opacityFieldMapped
		? 1
		: (configs.defaultOpacity ?? DEFAULT_OPACITY)
	// Prefer the LIVE theme from `themesAtom` (Settings-edited values
	// take effect immediately); fall back to the legacy `themeAtom` only
	// when the chart's themeId isn't in `themesAtom`.
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const liveTheme = allThemes.find((t) => t.id === currentThemeId)
	const theme = liveTheme ?? storedTheme
	const legendCfg: LegendConfig = {
		...DEFAULT_LEGEND_CONFIG,
		...useAtomValue(currentLegendConfigAtom),
	}
	// Effective auxiliary swatch color: per-visual override wins, theme
	// default is the fallback (every theme defines `legendSwatchColor`).
	const resolvedAuxSwatchColor =
		legendCfg.auxLegendSwatchColor ?? theme.legendSwatchColor
	// Size-swatch border: per-visual override wins, else the theme default
	// (`?? "#ffffff"` keeps the historical white outline for saved themes
	// predating the `legendSwatchStroke` field).
	const resolvedAuxSwatchStroke =
		legendCfg.auxLegendSwatchStroke ?? theme.legendSwatchStroke ?? "#ffffff"
	const dataset = useCurrentDatasetView()
	const modeDef = useChartModeDef()
	// Fold the mode's default-hidden channels (e.g. the Size legend starts
	// off in flow / hierarchy modes) into the effective map so every
	// `legendCfg.hidden` read below is mode-aware. An explicit user toggle
	// (stored true OR false) still wins — see resolveLegendHidden.
	legendCfg.hidden = resolveLegendHidden(legendCfg.hidden, modeDef.legend)

	if (!dataset) return null
	// The legend renders whenever ≥1 section ends up visible; per-channel
	// hide toggles in the sidebar control visibility. `legendCfg.enabled`
	// is vestigial — kept on the type for back-compat with saved visuals
	// but no longer consulted.

	const hideLength = modeDef.legend.hideLengthInThisMode
	const hideAngle = modeDef.legend.hideAngleInThisMode
	// In geographic modes (choropleth) the connection channel is the region
	// key — which feature each row is — not a visual series. Suppress any
	// connection-driven legend treatment so the user doesn't see a meaningless
	// per-region legend (and no line-dash overlay logic, which is a line-chart
	// concept that has no meaning on a map).
	const hideConnection = modeDef.legend.hideConnectionInThisMode
	// In stacked bars, the first-encountered value goes at the BOTTOM of the
	// stack, so reading the legend top-down would land at the bottom slice
	// first. Flip categorical legend order in bar mode so legend top matches
	// stack top.
	const reverseCategorical = modeDef.legend.reverseCategoricalOrder

	// Flow modes (chord / sankey): hue OR pattern on EITHER endpoint column
	// means "style by node", and the renderers build those categorical
	// scales over the UNION of both endpoint columns in first-appearance
	// order (see useFlowScaffold's `scaleDomainNodes`). An endpoint field's
	// own column alone misses destination-only nodes and can order the rest
	// differently, so the legend would drop entries and shift the others
	// onto the wrong palette / pattern slots. Override any endpoint-field
	// section's values with the same union domain (full dataset rows,
	// matching the scaffold, so facet panels and the legend agree).
	const flowNodeUnion = (() => {
		if (!isFlowModeId(modeDef.id)) return null
		const { sourceField, targetField } = resolveFlowEndpoints(
			encodings,
			configs.connection,
			dataset
		)
		if (!sourceField || !targetField) return null
		return {
			fields: new Set([sourceField, targetField]),
			values: flowNodeNames(dataset.rows, sourceField, targetField) as unknown[],
		}
	})()

	// Group encodings (hue, saturation, brightness, pattern, opacity, shape)
	// that share a field get combined into a single swatch list whose swatches
	// show the net visual (color + pattern + opacity + shape glyph). The user
	// reported "hue + shape legends not combining when on the same field" —
	// adding shape here is what fixes that. Shape is a categorical-only
	// encoding so the combined-quantitative branch (gradient bar) remains
	// hue-only as before.
	// Channels eligible for grouping into a single combined legend section
	// when they share a field. Hue/sat/bri/pattern/opacity/shape compose
	// into a per-stop swatch; length/angle compose into a line-segment
	// swatch when the shared field is quantitative (the vector-field
	// case); area composes into a sized-circle swatch (heatmap/bubble
	// case) — all of these collapse N parallel legends into one column.
	const GROUP_CHANNELS = [
		"hue",
		"outlineHue",
		"saturation",
		"brightness",
		"pattern",
		"opacity",
		"shape",
		"length",
		"angle",
		"area",
	] as const
	type GroupChannel = (typeof GROUP_CHANNELS)[number]
	const groupsByField = new Map<string, GroupChannel[]>()
	for (const ch of GROUP_CHANNELS) {
		if (ch === "length" && hideLength) continue
		if (ch === "angle" && hideAngle) continue
		const f = encodings[ch]?.field
		if (!f) continue
		const list = groupsByField.get(f) ?? []
		list.push(ch)
		groupsByField.set(f, list)
	}

	type SingleSection = {
		kind: "single"
		channel: EncodingChannel
		field: string
		type: FieldType
		values: unknown[]
		/** When this section was carved out of a shared-field group, the
		 * channel whose legend-title / font override drives this section's
		 * header. Lets a split-out section show its own title rather than the
		 * group's first channel. */
		titleChannel?: GroupChannel
	}
	type CombinedSection = {
		kind: "combined"
		channels: GroupChannel[]
		field: string
		type: FieldType
		values: unknown[]
		/** Channel whose legend-title / font override drives this section's
		 * header. Defaults to the leading group channel; set explicitly when a
		 * shared-field group is split or when only a non-leading channel is
		 * titled. */
		titleChannel?: GroupChannel
	}
	// A color slot (e.g. the rug) mapped to a field. Slots live outside the
	// encodings map, so they're built separately below and rendered as a
	// categorical color legend using the slot's own palette.
	type SlotSection = {
		kind: "slot"
		/** Legend pseudo-channel for hide / title / font lookups (rug |
		 * densityCurve). */
		legendKey: LegendChannel
		/** Which `colorSlots` entry drives the swatch colors (its hue config +
		 * palette). May differ from `legendKey` — the density curve coalesces its
		 * fill/outline slots into one section keyed by `densityCurve`. */
		slotKey: ColorSlotKey
		field: string
		type: FieldType
		values: unknown[]
	}
	type SectionInfo = SingleSection | CombinedSection | SlotSection

	const emittedCombinedFields = new Set<string>()
	const sections: SectionInfo[] = []
	for (const ch of LEGEND_CANDIDATE_CHANNELS) {
		const name = encodings[ch]?.field
		if (!name) continue
		// Mode-specific suppression: length is meaningless in bar mode
		// (the measure IS the bar length) and angle is meaningless in
		// pie mode (the angle IS the slice). Everywhere else — including
		// vector fields where hue/length/angle all share a field — show
		// the legend so the user can read the encoding's mapping. The
		// per-channel `legendCfg.hidden` toggle below is the user's
		// override if a legend really is redundant.
		if (ch === "length" && hideLength) continue
		if (ch === "angle" && hideAngle) continue
		// User-driven per-channel hide toggle from the Legend sidebar section.
		if (legendCfg.hidden[ch as LegendChannel]) continue

		if (GROUP_CHANNELS.includes(ch as GroupChannel)) {
			// Combine all group encodings on this field into one section,
			// emitted at the position of its first mapped channel. Channels
			// hidden via the sidebar toggles drop out of the combined visual —
			// e.g. unchecking "pattern" while hue stays on yields a hue-only
			// swatch, even though both share a field.
			//
			// When the user turns off "Combine legends with same variables",
			// skip the field-level merge entirely: each channel emits its own
			// section (as if it were the only encoding on that field).
			const combine = legendCfg.combineSameVariable !== false
			if (combine && emittedCombinedFields.has(name)) continue
			if (combine) emittedCombinedFields.add(name)
			const allChannels = combine
				? (groupsByField.get(name) ?? [ch as GroupChannel])
				: [ch as GroupChannel]
			const visibleChannels = allChannels.filter(
				(c) => !legendCfg.hidden[c as LegendChannel]
			)
			if (visibleChannels.length === 0) continue
			const fieldMeta = dataset.fields.find((f) => f.name === name)
			const fieldType = effectiveType(fieldMeta?.inferredType, overrides[name])
			// Flow node styling: an endpoint field's section reads the endpoint
			// UNION (see `flowNodeUnion` above) so the legend's items and
			// palette / pattern slots match the chart's node scales.
			const fieldValues =
				flowNodeUnion && flowNodeUnion.fields.has(name)
					? flowNodeUnion.values
					: dataset.rows.map((r) => r[name])
			// Solo group channels with a standalone renderer fall through
			// to that renderer rather than CombinedGroupLegend — its
			// "composed swatch" output doesn't know how to draw a shape /
			// length / angle alone. CombinedGroupLegend kicks in only when
			// the section combines ≥2 visible channels (or when hue is
			// present, which can render a gradient bar on its own).
			const STANDALONE_SOLO = new Set<GroupChannel>([
				"shape",
				"length",
				"angle",
				"area",
			])
			const pushGroupSection = (
				chans: GroupChannel[],
				titleChannel: GroupChannel,
			) => {
				const solo = chans.length === 1 ? chans[0] : undefined
				if (solo !== undefined && STANDALONE_SOLO.has(solo)) {
					sections.push({
						kind: "single",
						channel: solo,
						field: name,
						type: fieldType,
						values: fieldValues,
						titleChannel,
					})
				} else {
					sections.push({
						kind: "combined",
						channels: chans,
						field: name,
						type: fieldType,
						values: fieldValues,
						titleChannel,
					})
				}
			}
			// User-set legend title for a group channel (trimmed; "" = none).
			const titleOf = (c: GroupChannel): string =>
				labels.legendTitles?.[c as LegendChannel]?.trim() ?? ""
			const distinctTitles = new Set(
				visibleChannels.map(titleOf).filter((t) => t !== ""),
			)
			// Title-driven splitting: channels sharing a field normally collapse
			// into ONE legend. But if the user gives them ≥2 DISTINCT titles,
			// that's the signal to break them apart into a legend per title —
			// e.g. fill "Region" + outline "Status" on the same field shows two
			// legends. Giving them the same title, or titling only one, keeps
			// them combined (distinctTitles ≤ 1).
			if (distinctTitles.size >= 2) {
				// Partition by title; untitled channels collect under the
				// field-name group (their fallback header).
				const byTitle = new Map<string, GroupChannel[]>()
				for (const c of visibleChannels) {
					const key = titleOf(c) || name
					const list = byTitle.get(key) ?? []
					list.push(c)
					byTitle.set(key, list)
				}
				for (const [, chans] of byTitle) {
					// Drive each section's header off a channel that carries the
					// override (falling back to the first channel for the
					// untitled field-name group).
					const titled = chans.find((c) => titleOf(c) !== "") ?? chans[0]
					if (titled !== undefined) pushGroupSection(chans, titled)
				}
				continue
			}
			// 0 or 1 distinct title → one combined/standalone section. Drive its
			// header off whichever channel carries the title so titling only the
			// outline (with fill left blank) still labels the combined legend.
			const titled =
				visibleChannels.find((c) => titleOf(c) !== "") ?? visibleChannels[0]
			if (titled !== undefined) pushGroupSection(visibleChannels, titled)
			continue
		}

		const fieldMeta = dataset.fields.find((f) => f.name === name)
		sections.push({
			kind: "single",
			channel: ch,
			field: name,
			type: effectiveType(fieldMeta?.inferredType, overrides[name]),
			values: dataset.rows.map((r) => r[name]),
		})
	}

	// --- Histogram measure (Count / Density) sections ---
	// Fill color / opacity can vary by the bins' DERIVED measure instead of a
	// field; that has no `encodings[ch].field`, so the loop above skips it. Add
	// a synthetic quantitative section per active measure source: a gradient /
	// opacity ramp titled "Count" / "Density" spanning [0, max], where `max`
	// matches the bars (shared `histogramMeasureDomain`). Honors the per-channel
	// hide toggle just like a field-backed section.
	const measureGetType = (n: string) =>
		effectiveType(
			dataset.fields.find((f) => f.name === n)?.inferredType,
			overrides[n]
		)
	const measureSources = (
		[
			["hue", encodings.hue?.measureSource],
			["opacity", encodings.opacity?.measureSource],
		] as const
	).filter(
		// Explicit count/density check (not just truthy): the shared
		// `measureSource` slot also carries the packed (rootGroup/depth) and
		// hexbin (hexCount) sources, which have their own sections.
		(e): e is [("hue" | "opacity"), "count" | "density"] =>
			(e[1] === "count" || e[1] === "density") &&
			!legendCfg.hidden[e[0] as LegendChannel]
	)
	if (measureSources.length > 0) {
		const hm = resolveHistogramMeasure(encodings, measureGetType, configs)
		if (hm) {
			const axisCfg = configs[hm.categoryChannel]
			const hist = axisCfg?.histogram
			const domain = histogramMeasureDomain(
				dataset.rows.map((r) => r[hm.categoryField]),
				hist?.binCount ?? 10,
				hm.mode,
				{ min: axisCfg?.min ?? null, max: axisCfg?.max ?? null },
				hist?.labelMode ?? "range"
			)
			if (domain && domain.max > 0) {
				for (const [channel, source] of measureSources) {
					sections.push({
						kind: "single",
						channel,
						field: source === "density" ? "Density" : "Count",
						type: "quantitative",
						values: [domain.min, domain.max],
					})
				}
			}
		}
	}

	// --- Hexbin measure (Point count) section ---
	// Same shape as the histogram measure above: a synthetic quantitative
	// gradient over [0, maxCount]. Data-space binning means this needs no
	// plot dimensions — the SAME `resolveHexbinCells` call the renderer
	// makes, so the legend ramp and the cell colors can't disagree.
	const hexXField = encodings.x?.field
	const hexYField = encodings.y?.field
	if (
		encodings.hue?.measureSource === "hexCount" &&
		!legendCfg.hidden.hue &&
		hexXField &&
		hexYField &&
		hexbinEligible(encodings, measureGetType)
	) {
		const xField = hexXField
		const yField = hexYField
		const hex = resolveHexbinCells(
			dataset.rows.map((r) => r[xField]),
			dataset.rows.map((r) => r[yField]),
			configs.hexbin?.binCount ?? DEFAULT_HEXBIN_BIN_COUNT,
			{ min: configs.x?.min ?? undefined, max: configs.x?.max ?? undefined },
			{ min: configs.y?.min ?? undefined, max: configs.y?.max ?? undefined }
		)
		if (hex && hex.maxCount > 0) {
			sections.push({
				kind: "single",
				channel: "hue",
				field: HEXBIN_COUNT_LABEL,
				type: "quantitative",
				values: [0, hex.maxCount],
			})
		}
	}

	// --- Color-slot sections (e.g. the rug colored by a field) ---
	// Color slots are a parallel color-encoding system that lives outside the
	// encodings map, so the channel loop never sees them. Surface a categorical
	// legend for the rug slot when it's mapped to a field AND a rug is actually
	// drawn (a histogram or density curve is active with its rug on).
	const rugVisible = (
		c: AtomValueType<typeof currentChannelConfigsAtom>["x"]
	): boolean =>
		c?.histogram?.showRug === true &&
		(c?.histogram?.enabled === true ||
			c?.distributionOverlay?.showDensityCurve === true)
	const rugSlot = configs.colorSlots?.rug
	if (
		rugSlot?.field &&
		!legendCfg.hidden.rug &&
		(rugVisible(configs.x) || rugVisible(configs.y))
	) {
		const fieldMeta = dataset.fields.find((f) => f.name === rugSlot.field)
		sections.push({
			kind: "slot",
			legendKey: "rug",
			slotKey: "rug",
			field: rugSlot.field,
			type: effectiveType(fieldMeta?.inferredType, overrides[rugSlot.field]),
			values: dataset.rows.map((r) => r[rugSlot.field as string]),
		})
	}

	// Density curve grouped by a field: one KDE per category. Coalesce the
	// fill/outline slots into a single "Density Curve" section (they're the same
	// grouping field); the swatch colors come from whichever slot carries the
	// field — outline preferred, mirroring densityCurveGroupField.
	const densityGroupField = densityCurveGroupField(configs)
	if (
		densityGroupField &&
		densityCurveOn(configs) &&
		!legendCfg.hidden.densityCurve
	) {
		const slotKey: ColorSlotKey = configs.colorSlots?.densityCurveStroke?.field
			? "densityCurveStroke"
			: "densityCurveFill"
		const fieldMeta = dataset.fields.find((f) => f.name === densityGroupField)
		sections.push({
			kind: "slot",
			legendKey: "densityCurve",
			slotKey,
			field: densityGroupField,
			type: effectiveType(fieldMeta?.inferredType, overrides[densityGroupField]),
			values: dataset.rows.map((r) => r[densityGroupField]),
		})
	}

	if (sections.length === 0) return null

	const textFont = resolveLegendTextFont(labels.baseFont)
	const bodyStyle: React.CSSProperties = {
		fontFamily: textFont.family,
		color: textFont.color,
	}

	// Compute the widest legend label so the legend can size itself to fit
	// its content rather than the fixed 224px column the old `w-56` reserved.
	// Heuristic: longest stringified value across all visible sections, times
	// the 0.55-char-px constant we use elsewhere for estimating proportional
	// font widths. Add the swatch width, gap, inner padding, and a small
	// safety pad so labels don't bump the legend border. Capped at
	// LEGEND_MAX_WIDTH_PX so a single very long value doesn't blow out the
	// chart area; anything longer gets `truncate` ellipsis as before.
	const LEGEND_MIN_WIDTH_PX = 100
	const LEGEND_MAX_WIDTH_PX = 560
	// Per-channel swatch widths. ComposedSwatch / hue / shape glyphs cap at
	// 22px. Length / area / angle / vector-field swatches scale with their
	// data — length and area widths are driven by user-configurable
	// channel-config ranges, so read the actual maxima here rather than
	// guessing. We pick the widest swatch across all visible sections so
	// the legend column makes room for the worst-case row without
	// truncating its label.
	const COMPOSED_SWATCH_W = 22
	const SWATCH_PAD = 4
	const ANGLE_SWATCH_W = 24
	const OPACITY_SWATCH_W = 22
	const lengthMax = configs.length?.maxLength ?? 40
	const LENGTH_SWATCH_W = Math.max(24, lengthMax + SWATCH_PAD)
	const areaMaxRadius = configs.area?.maxRadius ?? 18
	const AREA_SWATCH_W = Math.max(24, areaMaxRadius * 2 + SWATCH_PAD)
	const channelSwatchW = (
		ch:
			| "hue"
			| "outlineHue"
			| "saturation"
			| "brightness"
			| "pattern"
			| "opacity"
			| "shape"
			| "length"
			| "angle"
			| "area",
	) => {
		switch (ch) {
			case "length":
				return LENGTH_SWATCH_W
			case "area":
				return AREA_SWATCH_W
			case "angle":
				return ANGLE_SWATCH_W
			case "opacity":
				return OPACITY_SWATCH_W
			default:
				return COMPOSED_SWATCH_W
		}
	}
	const maxSwatchW = sections.reduce((max, s) => {
		if (s.kind === "single") {
			return Math.max(
				max,
				channelSwatchW(
					s.channel as Parameters<typeof channelSwatchW>[0],
				),
			)
		}
		// Slot sections render categorical color swatches (like hue) → the
		// composed-swatch width.
		if (s.kind === "slot") return Math.max(max, COMPOSED_SWATCH_W)
		// Combined section: widest channel in the group wins. Vector-field
		// combinations (hue + length/angle) collapse to a single line-segment
		// swatch whose width is driven by the length scale's range; hue+area
		// uses AREA_SWATCH_W.
		return s.channels.reduce((m, c) => Math.max(m, channelSwatchW(c)), max)
	}, COMPOSED_SWATCH_W)
	const SWATCH_W = maxSwatchW
	const SWATCH_GAP = 8
	const INNER_PAD = 32 // matches the `p-4` on the inner div
	const SAFETY_PAD = 6
	const longestLabelChars = sections.reduce((max, s) => {
		const uniques = new Set<string>()
		for (const v of s.values) {
			if (v === undefined || v === null) continue
			uniques.add(String(v))
		}
		// Quant sections render labels from RESOLVED BREAKS through the
		// user's chosen formatter — not from raw data values. A user-set
		// break of "100" or a format that adds " · 2024" can produce
		// labels longer than anything in the data. Compute the actual
		// labels for quant sections so the legend column makes room.
		const channelKey: QuantitativeLegendChannel | null =
			s.kind === "single"
				? QUANTITATIVE_LEGEND_CHANNELS.includes(
						s.channel as QuantitativeLegendChannel,
					)
					? (s.channel as QuantitativeLegendChannel)
					: null
				: s.kind === "combined"
					? ((QUANTITATIVE_LEGEND_CHANNELS.find((c) =>
							s.channels.includes(c as never),
						) as QuantitativeLegendChannel | undefined) ?? null)
					: null
		if (channelKey && (s.type === "quantitative" || s.type === "temporal")) {
			const cfg = legendCfg.channels?.[channelKey]
			const breaks = resolveLegendBreaks(s.values, s.type, cfg, 5, 2)
			const merged = resolveLegendChannelConfig(cfg)
			const customFmt = buildLegendFormatter(merged.format)
			const fallbackFmt = (n: number) =>
				s.type === "temporal"
					? new Date(n).toLocaleDateString()
					: Number.isFinite(n)
						? n.toFixed(2)
						: String(n)
			const fmt = customFmt ?? fallbackFmt
			const dataExt = legendDataExtent(s.values, s.type)
			breaks.forEach((b, i) => {
				uniques.add(decorateOpenEndLabel(fmt(b), i, breaks, dataExt))
			})
		}
		const localMax = [...uniques].reduce(
			(m, str) => Math.max(m, str.length),
			0
		)
		return Math.max(max, localMax)
	}, 0)
	const estimatedLabelPx = longestLabelChars * textFont.size * 0.55
	// Legend section TITLES (the field name OR the user's per-channel
	// override) are often longer than the LABELS, and render at the
	// secondary-title font size (larger than text). Without measuring
	// them, a long title like "silliness_score" overflows past the
	// legend column's right edge. Walk each section's title text and
	// estimate its pixel width at the SAME resolved per-legend font the
	// section renders with (base secondary size + the per-legend size
	// override) so the legend column grows to fit. Falls back to the
	// field name when no override is set — same logic LegendSection uses.
	const estimatedTitlePx = sections.reduce((max, s) => {
		const keyChannel =
			s.kind === "single"
				? (s.titleChannel ?? s.channel)
				: s.kind === "combined"
					? (s.titleChannel ?? s.channels[0])
					: s.legendKey
		const override =
			labels.legendTitles?.[keyChannel as keyof typeof labels.legendTitles]
		const fallback =
			s.kind === "slot" ? LEGEND_FRIENDLY_NAME[s.legendKey] : s.field
		// Three-state: undefined → fallback name, "" → no header (0 width).
		const titleText = override === undefined ? fallback : override
		const titleFontSize = resolveTitleFont(
			labels.baseFont,
			"legend",
			labels.fontOverrides?.[legendFontKey(keyChannel as LegendChannel)]
		).size
		return Math.max(max, titleText.length * titleFontSize * 0.55)
	}, 0)
	// When the user picks Horizontal orientation, size-style legends
	// (area / length / angle) lay every swatch out in one no-wrap row.
	// Estimate the row width by summing the ACTUAL per-stop swatch
	// widths — not N × max — so the column doesn't reserve dead space
	// for the small-value swatches. The legend's hidden width budget
	// previously used the worst-case swatch for every stop, leaving a
	// big empty right-hand gap inside the legend's border box.
	let horizontalRowEstimate = 0
	if (legendCfg.orientation === "horizontal") {
		const HORIZONTAL_INTER_SWATCH_GAP = 12
		for (const s of sections) {
			const channelKey =
				s.kind === "single"
					? (s.channel as
							| "hue"
							| "saturation"
							| "brightness"
							| "pattern"
							| "opacity"
							| "shape"
							| "length"
							| "angle"
							| "area")
					: s.kind === "combined"
						? // Combined sections always carry ≥1 channel; "hue" fallback
							// matches the slot default's fixed-width sizing path.
							(s.channels[0] ?? "hue")
						: // Slot sections are categorical color swatches — size them
							// like hue (the else branch's fixed-width path).
							("hue" as const)
			// Compute per-stop widths matching what the renderer actually
			// draws. Area uses `2 * areaScale(v)`, length uses the length
			// scale's output, angle is fixed 24px. Categorical sections fall
			// back to the channel's upper-bound width.
			let perStopWidths: number[]
			if (channelKey === "area") {
				const domain = resolveLegendDomain(
					s.values,
					s.type,
					legendCfg.channels?.area,
				) ?? undefined
				const scale = makeAreaScale(
					s.values,
					s.type,
					undefined,
					domain,
				)
				const breaks = resolveLegendBreaks(
					s.values,
					s.type,
					legendCfg.channels?.area,
					3,
					3,
				)
				perStopWidths = breaks.map((v) => {
					const r = applyAreaScale(scale, v, s.type) ?? 4
					return Math.max(24, Math.ceil(r * 2) + 4)
				})
			} else if (channelKey === "length") {
				const domain = resolveLegendDomain(
					s.values,
					s.type,
					legendCfg.channels?.length,
				) ?? undefined
				const scale = makeLengthScale(s.values, s.type, undefined, domain)
				const breaks = resolveLegendBreaks(
					s.values,
					s.type,
					legendCfg.channels?.length,
					3,
					3,
				)
				perStopWidths = breaks.map((v) => {
					const len = scale(v) ?? 10
					return Math.max(24, Math.ceil(len) + 4)
				})
			} else {
				// Angle / shape / etc.: every swatch the same fixed width.
				const uniques = new Set<string>()
				for (const v of s.values) {
					if (v !== undefined && v !== null) uniques.add(String(v))
				}
				const stopCount = Math.max(uniques.size, 5)
				const w = channelSwatchW(channelKey)
				perStopWidths = Array.from({ length: stopCount }, () => w)
			}
			if (perStopWidths.length === 0) continue
			const row =
				perStopWidths.reduce((a, b) => a + b, 0) +
				(perStopWidths.length - 1) * HORIZONTAL_INTER_SWATCH_GAP
			horizontalRowEstimate = Math.max(horizontalRowEstimate, row)
		}
	}
	const estimatedLegendWidth = Math.ceil(
		Math.max(
			SWATCH_W + SWATCH_GAP + estimatedLabelPx,
			estimatedTitlePx,
			horizontalRowEstimate,
		) +
			INNER_PAD +
			SAFETY_PAD,
	)
	const dynamicVerticalLegendWidth = Math.max(
		LEGEND_MIN_WIDTH_PX,
		Math.min(LEGEND_MAX_WIDTH_PX, estimatedLegendWidth),
	)
	// If a horizontal-on-right/left legend's content still exceeds the
	// capped column width (rare — would need a section with many breaks
	// or unusually wide swatches), let the column scroll horizontally
	// rather than clipping silently.
	const wantsInnerXScroll =
		legendCfg.orientation === "horizontal" &&
		(legendCfg.position === "right" || legendCfg.position === "left") &&
		horizontalRowEstimate + INNER_PAD + SAFETY_PAD > LEGEND_MAX_WIDTH_PX

	const isOutsideHorizontal =
		legendCfg.position === "top" || legendCfg.position === "bottom"
	const isInside = legendCfg.position === "inside"
	// Section layout: rows when the legend itself sits horizontally OR when
	// the user explicitly picked horizontal orientation; columns otherwise.
	const horizontalSections =
		isOutsideHorizontal || legendCfg.orientation === "horizontal"

	// --- Multi-column layout (user's "Legend columns" ticker) ---
	// Two shapes, per the requested behavior:
	//   • ≥2 legend sections  → pack whole sections into their own columns,
	//     each kept intact (`break-inside-avoid`) and balanced by the CSS
	//     column filler so the columns end up roughly the same length.
	//   • exactly 1 section    → wrap that legend's ENTRY ROWS across the
	//     columns (handled inside the sub-legend via `entryColumns`).
	// Columns TAKE PRECEDENCE over the horizontal orientation / top-bottom
	// position: within each column entries always stack vertically (matching
	// the matplotlib `ncol` mental model), so the feature works no matter the
	// orientation the user picked. Quantitative gradient/ramp single sections
	// (a bar, not a list) still opt out — there are no rows to wrap.
	const requestedColumns = Math.max(
		1,
		Math.min(6, Math.round(legendCfg.columns ?? 1)),
	)
	const sectionIsCategorical = (s: SectionInfo | undefined): boolean =>
		s !== undefined && s.type !== "quantitative" && s.type !== "temporal"
	const columnsApply =
		requestedColumns > 1 &&
		(sections.length >= 2 ||
			(sections.length === 1 && sectionIsCategorical(sections[0])))
	// Whole-section packing (≥2 legends) vs. entry-wrapping (1 legend).
	const packSections = columnsApply && sections.length >= 2
	const wrapEntries = columnsApply && sections.length === 1
	// Never reserve more columns than there is content to fill them.
	const effectiveCols = !columnsApply
		? 1
		: packSections
			? Math.min(requestedColumns, sections.length)
			: requestedColumns
	const entryColumns = wrapEntries ? effectiveCols : 1
	// Align the legend's edge against the chart's *plot area* (where the
	// gridlines actually live), not the wrapper edge. Pixel offsets mirror
	// ChartCanvas's `p-3` (12px) plus `BASE_MARGIN`/title reserves — keep
	// these in lockstep with `computePlotLayout`.
	const CHART_PAD = 12
	const hasTitle = !!labels.title
	const hasSubtitle = !!labels.subtitle
	const plotTopOffset =
		CHART_PAD +
		BASE_MARGIN.top +
		(hasTitle
			? titleReserve(
					resolveTitleFont(labels.baseFont, "primary", labels.fontOverrides?.title)
						.size
				)
			: 0) +
		(hasSubtitle
			? subtitleReserve(
					resolveTitleFont(
						labels.baseFont,
						"subtitle",
						labels.fontOverrides?.subtitle
					).size
				)
			: 0)
	const plotRightOffset = CHART_PAD + BASE_MARGIN.right
	// The OUTER element only reserves layout space (or, for "inside" mode,
	// anchors absolutely-positioned coords). Background, padding, and border
	// live on the INNER element so the visible legend hugs its content
	// instead of stretching to fill the reserved column.
	//  - right/left: stretches vertically (so `overflow-y-auto` works), then
	//    `paddingTop` pushes the visible legend down to the plot's top edge.
	//  - top: `self-end` pulls the legend to the cross-axis (right) edge,
	//    then a right margin offsets back so the legend's right side
	//    aligns with the plot's right gridline instead of the wrapper edge.
	//  - bottom: `self-center` so the legend sits centered below the chart.
	const positionExtraClass = (() => {
		if (isInside) return ""
		if (legendCfg.position === "top") return "self-end"
		if (legendCfg.position === "bottom") return "self-center"
		return ""
	})()
	const outerClass = isInside
		? "absolute z-10"
		: isOutsideHorizontal
			? `flex-shrink-0 overflow-x-auto overflow-y-hidden ${positionExtraClass}`
			: `flex-shrink-0 overflow-y-auto overflow-x-hidden ${positionExtraClass}`
	// Inside legends are unconstrained — let the inline-block box shrink
	// to its content so the floating legend hugs its labels. Outside
	// legends have an explicit `width: dynamicVerticalLegendWidth` on the
	// outer; the inner needs to fill that width (block, not inline-block)
	// so long labels truncate via the swatch's `truncate` class instead
	// of overflowing past the legend column's right edge.
	const innerClass = isInside
		? "inline-block p-3"
		: wantsInnerXScroll
			? "block p-4 overflow-x-auto"
			: "block p-4"
	const sectionLayoutClass = horizontalSections
		? "flex flex-row flex-wrap gap-6"
		: "flex flex-col gap-4"
	// Inter-column gutter for both packed sections and wrapped entries — the
	// user's "Column gap" control. Published to descendants as the
	// `--vc-legend-col-gap` CSS variable (see `innerStyle`); the flex column
	// layouts apply it as a `marginLeft`, which — unlike CSS `column-gap` —
	// accepts NEGATIVE values, so the columns can be pulled together or made to
	// overlap. May be negative.
	const COLUMN_GAP_PX = Math.round(legendCfg.columnGap ?? 24)
	// Breathing room from the viewport edges. Left/top would otherwise cling
	// to the wrapper edge and read as cramped — these offsets give the legend
	// a consistent gap before the chart starts.
	const OUTER_LEGEND_GAP_PX = 30
	// Upper bound for a content-sized multi-column legend, expressed against the
	// chart+legend flex container (`100%`; the app chrome / sidebar sit outside
	// it). Reserve room for the viewport gap AND a still-usable chart so a wide
	// legend can grow to fit its text but never runs off the edge and clips its
	// own padding. `undefined` when columns are inactive — single-column legends
	// keep their existing sizing untouched.
	//   • left/right: the legend competes with the chart for horizontal space,
	//     so reserve the gap + a chart minimum.
	//   • top/bottom/inside: the legend sits on the cross axis, so only the two
	//     edge gaps need reserving.
	const MIN_CHART_WIDTH_PX = 200
	const columnMaxWidth: string | undefined = !columnsApply
		? undefined
		: legendCfg.position === "left" || legendCfg.position === "right"
			? `calc(100% - ${OUTER_LEGEND_GAP_PX + MIN_CHART_WIDTH_PX}px)`
			: `calc(100% - ${2 * OUTER_LEGEND_GAP_PX}px)`
	// Plot-area-normalized inside coords:
	//   (insideX, insideY) = (0, 0) is the bottom-left corner of the plot
	//   (where the two axis spines meet); (1, 1) is the top-right.
	// CSS calc() lets the browser resolve the chart's actual pixel size
	// without us having to measure — the constants mirror `computePlotLayout`
	// (BASE_MARGIN + p-3 wrapper padding + title/subtitle reserves), so the
	// legend's anchor stays glued to the spines as the container resizes.
	const insideStyle = (): React.CSSProperties => {
		// `insideExtras` come from ChartCanvas — it has shrunk the chart by
		// these amounts to make room for an out-of-plot legend, so the
		// legend's calc() must reference the REDUCED plot rectangle for the
		// user's normalized coord to land where they expect.
		const plotLeftPx = CHART_PAD + BASE_MARGIN.left + insideExtras.left
		const plotRightPx = CHART_PAD + BASE_MARGIN.right + insideExtras.right
		const plotTopPx = plotTopOffset + insideExtras.top
		const plotBottomPx = CHART_PAD + BASE_MARGIN.bottom + insideExtras.bottom
		const horizontalReserve = plotLeftPx + plotRightPx
		const verticalReserve = plotTopPx + plotBottomPx
		return {
			left: `calc(${plotLeftPx}px + ${legendCfg.insideX} * (100% - ${horizontalReserve}px))`,
			top: `calc((100% - ${plotBottomPx}px) - ${legendCfg.insideY} * (100% - ${verticalReserve}px))`,
		}
	}
	// Bottom legend centers on the *plot's* horizontal midpoint, not the
	// wrapper's — the asymmetric base margins (76 left / 24 right, to leave
	// room for the y-axis title + tick labels) shift the plot center
	// rightward by (left - right) / 2 from the wrapper center, so we add
	// the equivalent marginLeft on top of `self-center` to compensate.
	const plotCenterShiftPx = BASE_MARGIN.left - BASE_MARGIN.right
	const outerStyle: React.CSSProperties | undefined = isInside
		? {
				...insideStyle(),
				...(columnMaxWidth ? { maxWidth: columnMaxWidth } : {}),
			}
		: legendCfg.position === "left"
			? {
					paddingTop: plotTopOffset,
					marginLeft: OUTER_LEGEND_GAP_PX,
					// Multi-column legends size to their content (capped by
					// `columnMaxWidth`); single-column keeps the width estimate.
					...(columnsApply
						? {}
						: { width: dynamicVerticalLegendWidth }),
					...(columnMaxWidth ? { maxWidth: columnMaxWidth } : {}),
				}
			: legendCfg.position === "right"
				? {
						paddingTop: plotTopOffset,
						marginRight: OUTER_LEGEND_GAP_PX,
						...(columnsApply
							? {}
							: { width: dynamicVerticalLegendWidth }),
						...(columnMaxWidth ? { maxWidth: columnMaxWidth } : {}),
					}
				: legendCfg.position === "top"
					? {
							marginRight: plotRightOffset,
							marginTop: OUTER_LEGEND_GAP_PX,
							...(columnMaxWidth ? { maxWidth: columnMaxWidth } : {}),
						}
					: legendCfg.position === "bottom"
						? {
								marginLeft: plotCenterShiftPx,
								marginBottom: OUTER_LEGEND_GAP_PX,
								...(columnMaxWidth ? { maxWidth: columnMaxWidth } : {}),
							}
						: undefined
	const innerStyle: React.CSSProperties = {
		...bodyStyle,
		backgroundColor: legendCfg.backgroundColor ?? "transparent",
		...(legendCfg.showBorder
			? {
					border: `1px solid ${legendCfg.borderColor}`,
					borderRadius: `${legendCfg.borderRadius}px`,
				}
			: {}),
		// Multi-column legends hug their content (`fit-content`) so the columns
		// sit as close as their widths allow; `maxWidth: 100%` keeps the inner
		// within the outer, which carries the viewport cap (`columnMaxWidth`).
		// `--vc-legend-col-gap` cascades the user's column gap down to the flex
		// column layouts (`LegendColumns`), applied there as a NEGATIVE-capable
		// `marginLeft`.
		...(columnsApply
			? {
					width: "fit-content",
					maxWidth: "100%",
					["--vc-legend-col-gap" as string]: `${COLUMN_GAP_PX}px`,
				}
			: {}),
	}

	return (
		// data-legend-root: image export walks this subtree to recreate the
		// legend as SVG (see serializeEmbedCapture in captureThumbnail.ts).
		<div
			ref={insideMeasureRef}
			data-legend-root
			className={outerClass}
			style={pullStyle ? { ...outerStyle, ...pullStyle } : outerStyle}
		>
			<div className={innerClass} style={innerStyle}>
				{(() => {
					const sectionNodes = sections.map((s) => {
						// Pick a channel key for font / title override lookups. A
						// section split out of a shared-field group carries its own
						// `titleChannel`; combined sections otherwise fall back to
						// their first mapped group channel; slot sections use their
						// slot key (a LegendChannel).
						const keyChannel =
							s.kind === "single"
								? (s.titleChannel ?? s.channel)
								: s.kind === "combined"
									? (s.titleChannel ?? s.channels[0])
									: s.legendKey
						const perLegendFont = resolveTitleFont(
							labels.baseFont,
							"legend",
							labels.fontOverrides?.[legendFontKey(keyChannel as LegendChannel)]
						)
						const sectionKey =
							s.kind === "single"
								? `single:${s.channel}`
								: s.kind === "combined"
									? `combined:${s.field}:${s.titleChannel ?? s.channels[0]}`
									: `slot:${s.legendKey}`
						// Categorical sections publish their field so each entry can
						// highlight matching marks on hover. Quantitative / temporal
						// (gradient) and slot sections opt out — there are no discrete
						// category rows to hover, and slots aren't the main marks.
						const highlightField =
							legendHighlightEnabled &&
							(s.kind === "single" || s.kind === "combined") &&
							s.type !== "quantitative" &&
							s.type !== "temporal"
								? s.field
								: undefined
						const node = (
							<LegendSection
								key={sectionKey}
								section={s}
								highlightField={highlightField}
								configs={configs}
								textFontSize={textFont.size}
								textWeight={textFont.weight}
								textItalic={textFont.italic}
								textUnderline={textFont.underline}
								titleOverride={
									labels.legendTitles?.[
										keyChannel as keyof typeof labels.legendTitles
									]
								}
								titleFont={perLegendFont}
								titleAlignment={titleAlignmentOf(
									labels,
									legendFontKey(keyChannel as LegendChannel)
								)}
								titleOffset={
									labels.titleOffsets?.[
										legendFontKey(keyChannel as LegendChannel)
									]
								}
								reverseCategorical={reverseCategorical}
								orientation={columnsApply ? "vertical" : legendCfg.orientation}
								gradientLegendStyle={legendCfg.gradientLegendStyle ?? "bar"}
								gradientBarStyle={resolveGradientBarStyle(legendCfg)}
								legendFillColor={legendCfg.shapeLegendFillColor}
								legendStrokeColor={legendCfg.shapeLegendStrokeColor}
								connectionMapped={
									!hideConnection && !!encodings.connection?.field
								}
								channelLegendCfgs={legendCfg.channels}
								auxSwatchColor={resolvedAuxSwatchColor}
								auxSwatchStroke={resolvedAuxSwatchStroke}
								splitOutlineEligible={
									modeDef.id === "areas-x" ||
									modeDef.id === "areas-y" ||
									modeDef.id === "radar"
								}
								proportionalSizeExponent={
									// Packed circles honor the Area Scale-by option (√ or
									// linear); treemap / sunburst are inherently
									// area-proportional so always √. Chord / sankey marks are
									// one-dimensional (ribbon / link WIDTH ∝ value), so their
									// size reads linearly. Other modes keep the min→max range
									// mapping their marks actually use.
									modeDef.id === "packed-circles"
										? configs.area?.sizeBy === "diameter"
											? 1
											: 0.5
										: modeDef.id === "treemap" || modeDef.id === "sunburst"
											? 0.5
											: isFlowModeId(modeDef.id)
												? 1
												: undefined
								}
								hueSwatchShape={legendSwatchShape(
									legendCfg,
									// Sections keyed by a non-swatch-shape channel (shape /
									// length / …) just resolve to null — no entry is ever
									// written for those keys.
									keyChannel as SwatchShapeChannel
								)}
								hueSwatchSize={legendSwatchSize(
									legendCfg,
									keyChannel as SwatchShapeChannel
								)}
								swatchOutline={(() => {
									// Width 0 / unset = no outline. The user's swatch
									// outline also stays inert while the outline-color
									// encoding is mapped — those strokes are a faithful
									// key for that encoding. Resolved per section (keyed
									// like the swatch shape, legacy globals as fallback);
									// color pipes from the marks' outline color (Color
									// menu → Outline) unless the user picked one; same
									// chain the panel displays.
									const key = keyChannel as SwatchShapeChannel
									const width = legendSwatchOutlineWidth(legendCfg, key) ?? 0
									return width > 0 && !encodings.outlineHue?.field
										? {
												color:
													legendSwatchOutlineColor(legendCfg, key) ??
													configs.shape?.outlineColor ??
													theme.outlineColor ??
													"#cccccc",
												width,
											}
										: null
								})()}
								defaultSwatchOpacity={defaultSwatchOpacity}
								entryColumns={entryColumns}
							/>
						)
						return node
					})
					// ≥2 legends: distribute whole sections into content-hugging flex
					// columns (balanced by count). 1 legend: its sub-legend already
					// laid its entries out in columns, so just render it in the normal
					// stack container.
					return packSections ? (
						<LegendColumns
							groups={chunkColumns(sectionNodes, effectiveCols)}
							stackGapClass="gap-4"
						/>
					) : (
						<div className={columnsApply ? undefined : sectionLayoutClass}>
							{sectionNodes}
						</div>
					)
				})()}
			</div>
		</div>
	)
}

type SingleSectionLike = {
	kind: "single"
	channel: EncodingChannel
	field: string
	type: FieldType
	values: unknown[]
}
type CombinedSectionLike = {
	kind: "combined"
	channels: ReadonlyArray<
		| "area"
		| "hue"
		| "outlineHue"
		| "saturation"
		| "brightness"
		| "pattern"
		| "opacity"
		| "shape"
		| "length"
		| "angle"
	>
	field: string
	type: FieldType
	values: unknown[]
}
type SlotSectionLike = {
	kind: "slot"
	legendKey: LegendChannel
	slotKey: ColorSlotKey
	field: string
	type: FieldType
	values: unknown[]
}

type LegendSectionProps = {
	section: SingleSectionLike | CombinedSectionLike | SlotSectionLike
	configs: AtomValueType<typeof currentChannelConfigsAtom>
	textFontSize: number
	/** Body-text weight/italic/underline (mirror the title styling for
	 * legend swatch labels). `textWeight` unset = the browser default. */
	textWeight?: number
	textItalic?: boolean
	textUnderline?: boolean
	titleOverride?: string
	titleFont: FontConfig
	titleAlignment?: "left" | "center" | "right"
	/** Per-legend title x/y pixel nudge (mirrors chart/axis title offsets).
	 * `+x` shifts the title right, `+y` down. Applied as a CSS transform so
	 * it does not reflow the legend box. */
	titleOffset?: { x?: number; y?: number }
	reverseCategorical: boolean
	orientation: "vertical" | "horizontal"
	gradientLegendStyle?: "bar" | "swatches"
	/** Resolved gradient-bar display options (length / radius / ticks /
	 * label alignment) from the legend config. Only consulted when a
	 * quantitative color section renders in `"bar"` style. */
	gradientBarStyle?: GradientBarStyle
	legendFillColor?: string | null
	legendStrokeColor?: string | null
	connectionMapped?: boolean
	/** Per-quantitative-channel break + format overrides. Sparse: only
	 * channels the user has touched appear here; missing channels resolve
	 * to defaults via `resolveLegendChannelConfig`. */
	channelLegendCfgs?: Partial<Record<QuantitativeLegendChannel, LegendChannelConfig>>
	/** Color used for the length / angle / area / opacity legend
	 * swatches when they render as standalone sections. `null` / undefined
	 * uses the historical `#4f8eda`. */
	auxSwatchColor?: string | null
	/** Border (stroke) color for the area (size) legend swatch circles.
	 * `null` / undefined uses the historical white outline. */
	auxSwatchStroke?: string | null
	/** Whether the chart mode (areas-x / areas-y / radar) exposes a separate
	 *  line/outline palette — drives the HueLegend split-outline rendering.
	 *  Computed by the parent, where the chart mode is resolved (modeDef is
	 *  not in scope inside this component). */
	splitOutlineEligible?: boolean
	/** Hierarchy modes: the size (area) legend renders swatch radii in the
	 *  chart's TRUE proportions — value^exponent, zero-anchored — instead
	 *  of the min→max px range mapping. `0.5` = area-true; `1` = packed
	 *  circles' Scale-by-diameter. Undefined = historical mapping (bubble
	 *  charts). Computed by the parent, same reason as
	 *  `splitOutlineEligible`. */
	proportionalSizeExponent?: number
	/** `SHAPE_PALETTE` index drawn for each hue (color) legend swatch
	 *  instead of the default rectangle. `null` / undefined keeps the
	 *  rectangle. */
	hueSwatchShape?: LegendSwatchShape
	/** Symbol radius (px) for hue swatch shapes. `null` / undefined → 5. */
	hueSwatchSize?: number | null
	/** User-chosen outline drawn around color swatches (`swatchOutlineColor` /
	 *  `swatchOutlineWidth`). The parent resolves it to `null` when the
	 *  outline-color encoding is mapped — the swatch strokes are then a
	 *  faithful key for that encoding. */
	swatchOutline?: { color: string; width: number } | null
	/** Opacity applied to swatch graphics (not labels) so they match marks
	 *  drawn at the global `defaultOpacity` when opacity isn't encoded. `1`
	 *  when opacity IS encoded (the opacity legend shows the real values). */
	defaultSwatchOpacity?: number
	/** When >1, a categorical section's entry rows wrap across this many CSS
	 * columns instead of a single stack (the "one legend → N columns" case).
	 * Undefined / 1 keeps the classic single vertical list. */
	entryColumns?: number
	/** Encoded field name for legend-hover highlighting. When set, each
	 * categorical entry publishes `{ field, value }` on hover so the plots dim
	 * non-matching marks. Undefined disables the behavior for this section. */
	highlightField?: string
}

/** Split `items` into `cols` balanced, contiguous groups (reading order
 * preserved: fill column 1 top-to-bottom, then column 2, …). Column sizes
 * differ by at most one so the columns end up roughly the same height. */
const chunkColumns = <T,>(items: T[], cols: number): T[][] => {
	if (cols <= 1 || items.length <= 1) return [items]
	const n = items.length
	const base = Math.floor(n / cols)
	const extra = n % cols
	const groups: T[][] = []
	let idx = 0
	for (let c = 0; c < cols; c++) {
		const size = base + (c < extra ? 1 : 0)
		if (size > 0) groups.push(items.slice(idx, idx + size))
		idx += size
	}
	return groups
}

/** Lay `groups` out as side-by-side flex columns. Each column hugs its own
 * content width (so columns can differ in width and sit close together), and
 * the gap between them is a NEGATIVE-capable `marginLeft` driven by the
 * `--vc-legend-col-gap` CSS variable the parent `Legend` sets from the user's
 * "Column gap" control (`margin` accepts negative values, unlike CSS
 * `column-gap`, which is why this uses flex rather than multi-column). Columns
 * keep `min-w-0` so their labels truncate gracefully only when the whole legend
 * is squeezed against its viewport cap. */
const LegendColumns = ({
	groups,
	stackGapClass = "gap-1",
}: {
	groups: React.ReactNode[][]
	stackGapClass?: string
}) => (
	<div className="flex flex-row items-start">
		{groups.map((group, ci) => (
			<div
				// eslint-disable-next-line react/no-array-index-key -- columns are positional chunks; never reordered
				key={ci}
				className={`flex min-w-0 flex-col ${stackGapClass}`}
				style={ci > 0 ? { marginLeft: "var(--vc-legend-col-gap, 24px)" } : undefined}
			>
				{group}
			</div>
		))}
	</div>
)

/** Render a categorical entry list: a single stacked column normally, or
 * content-hugging flex columns when `cols > 1`. */
const renderEntryList = (
	rows: React.ReactNode[],
	cols?: number,
): React.ReactElement =>
	cols && cols > 1 ? (
		<LegendColumns groups={chunkColumns(rows, cols)} />
	) : (
		<div className="flex flex-col gap-1">{rows}</div>
	)

/** Fallback style for callers (smoke tests prop-driving the sub-legends)
 * that don't thread the legend config's gradient-bar options through. */
const DEFAULT_GRADIENT_BAR_STYLE: GradientBarStyle =
	resolveGradientBarStyle(DEFAULT_LEGEND_CONFIG)

type GradientRampStop = {
	/** Proportional position along the bar, 0 (lo) → 1 (hi). */
	t: number
	color: string
	label: string
	key: number
}

/** Densely-sampled stops for the bar's CSS gradient. CSS blends between
 * `linear-gradient` stops in sRGB, so emitting a stop only at each break
 * misdraws any scale that doesn't blend in sRGB between breaks — custom
 * gradients set to HSB/OKLCH interpolation, preset ramps like viridis,
 * pinned custom stops sitting between breaks. 32 samples make the CSS
 * approximation visually indistinguishable from the true ramp. Ticks and
 * labels keep rendering from the break stops. */
const sampleRampCssStops = (
	scale: HueScale,
	lo: number,
	hi: number,
	type: FieldType,
): { t: number; color: string }[] =>
	Array.from({ length: 32 }, (_, i) => {
		const t = i / 31
		return {
			t,
			color: applyHueScale(scale, lo + (hi - lo) * t, type) ?? "#888",
		}
	})

/** The quantitative color legend's gradient strip: the bar itself, optional
 * tick marks at each break stop, and the break labels. Shared by the
 * hue-only combined section and HueLegend so the two bar render paths can't
 * drift. Vertical bars run hi-on-top (`to top`) so reading top-to-bottom
 * matches a y-axis; horizontal bars run lo-on-left. */
const GradientBarRamp = ({
	stops,
	cssStops,
	orientation,
	barStyle,
}: {
	stops: GradientRampStop[]
	/** Optional denser sampling for the CSS gradient only (see
	 * `sampleRampCssStops`); ticks/labels always render from `stops`. */
	cssStops?: { t: number; color: string }[]
	orientation: "vertical" | "horizontal"
	barStyle: GradientBarStyle
}) => {
	const { length, radius, tickLength, tickThickness, tickColor } = barStyle
	const hasTicks = tickLength > 0 && tickThickness > 0
	const isVertical = orientation === "vertical"
	// Publish the rendered length (px along the bar's axis) after every
	// render so the Legend panel's "Bar length" input can placeholder the
	// auto size and step from it ([[auto-input-step-from-displayed]])
	// instead of jumping to 0 on the first spinner press. Last ramp wins
	// when several render — they share the legend's orientation + config,
	// so their lengths agree in practice.
	const barRef = useRef<HTMLDivElement | null>(null)
	const setRenderedLength = useSetAtom(currentRenderedGradientBarLengthAtom)
	useEffect(() => {
		const el = barRef.current
		if (!el) return
		const px = isVertical ? el.offsetHeight : el.offsetWidth
		if (px > 0) setRenderedLength(Math.round(px))
	})
	const gradientDirection = isVertical ? "to top" : "to right"
	const gradientCss = `linear-gradient(${gradientDirection}, ${(
		cssStops ?? stops
	)
		.map((s) => `${s.color} ${s.t * 100}%`)
		.join(", ")})`
	if (isVertical) {
		const align = barStyle.labelAlign ?? "left"
		// A fixed length pins the bar (and the label column tracking it);
		// auto keeps the historical stretch-with-siblings minimum.
		const sizing =
			length !== null
				? { height: `${length}px` }
				: { minHeight: "8rem" as const }
		return (
			<div className="flex flex-row items-stretch">
				<div
					ref={barRef}
					className="w-3 flex-shrink-0"
					style={{ background: gradientCss, borderRadius: radius, ...sizing }}
				/>
				{hasTicks && (
					<div
						className="relative flex-shrink-0"
						style={{ width: tickLength }}
						aria-hidden="true"
					>
						{stops.map((s) => (
							<div
								key={s.key}
								className="absolute left-0"
								style={{
									bottom: `calc(${s.t * 100}% - ${tickThickness / 2}px)`,
									width: tickLength,
									height: tickThickness,
									background: tickColor,
								}}
							/>
						))}
					</div>
				)}
				<div className="relative ml-2 flex flex-col" style={sizing}>
					{/* Invisible zero-height in-flow copies give the column the
					 *  width of its widest label, so the absolutely-positioned
					 *  visible labels below can align (left/center/right) within
					 *  a real box instead of shrink-wrapping at the left edge. */}
					{stops.map((s) => (
						<div
							key={s.key}
							className="invisible h-0 overflow-hidden whitespace-nowrap"
							aria-hidden="true"
						>
							{s.label}
						</div>
					))}
					{/* Each label sits at its proportional break position,
					 *  measured from the BOTTOM (hi-on-top matches the `to top`
					 *  gradient). translate-y-1/2 drops the label by half its own
					 *  height so its vertical center lands exactly on the tick. */}
					{stops.map((s) => (
						<span
							key={s.key}
							className="absolute left-0 right-0 translate-y-1/2 whitespace-nowrap"
							style={{
								bottom: `${s.t * 100}%`,
								textAlign: align,
							}}
						>
							{s.label}
						</span>
					))}
				</div>
			</div>
		)
	}
	const align = barStyle.labelAlign ?? "center"
	// Anchor each label's left edge / center / right edge at its break stop.
	const labelTranslate =
		align === "left" ? "" : align === "right" ? "-translate-x-full" : "-translate-x-1/2"
	return (
		<div
			className={
				length !== null ? "flex flex-col" : "flex w-full min-w-32 flex-col"
			}
			style={length !== null ? { width: `${length}px` } : undefined}
		>
			<div
				ref={barRef}
				className="h-3 w-full"
				style={{ background: gradientCss, borderRadius: radius }}
			/>
			{hasTicks && (
				<div
					className="relative w-full"
					style={{ height: tickLength }}
					aria-hidden="true"
				>
					{stops.map((s) => (
						<div
							key={s.key}
							className="absolute top-0"
							style={{
								left: `calc(${s.t * 100}% - ${tickThickness / 2}px)`,
								width: tickThickness,
								height: tickLength,
								background: tickColor,
							}}
						/>
					))}
				</div>
			)}
			<div className="relative mt-1 h-5 w-full">
				{stops.map((s) => (
					<span
						key={s.key}
						className={`absolute whitespace-nowrap ${labelTranslate}`}
						style={{ left: `${s.t * 100}%` }}
					>
						{s.label}
					</span>
				))}
			</div>
		</div>
	)
}

const LegendSection = ({
	section,
	configs,
	textFontSize,
	textWeight,
	textItalic,
	textUnderline,
	titleOverride,
	titleFont,
	titleAlignment = "center",
	titleOffset,
	reverseCategorical,
	orientation,
	gradientLegendStyle = "bar",
	gradientBarStyle = DEFAULT_GRADIENT_BAR_STYLE,
	legendFillColor,
	legendStrokeColor,
	connectionMapped = false,
	channelLegendCfgs,
	auxSwatchColor,
	auxSwatchStroke,
	splitOutlineEligible = false,
	proportionalSizeExponent,
	hueSwatchShape,
	hueSwatchSize,
	swatchOutline = null,
	defaultSwatchOpacity = 1,
	entryColumns,
	highlightField,
}: LegendSectionProps) => {
	const { field, type, values } = section
	// User-pinned level ordering for this section's field (Fields reorder
	// UI). Passed to each categorical sub-legend so its entries list in the
	// same order the axis / marks already use.
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const pinnedOrder = levelOrders[field]
	// Slot sections title with the feature's name ("Rug" / "Density Curve") by
	// default, not the field name — the section is "the rug, colored by <field>".
	const titleFallback =
		section.kind === "slot" ? LEGEND_FRIENDLY_NAME[section.legendKey] : field
	// Three-state legend title: `undefined` = not customized → field/feature
	// name; `""` = user cleared it → no header drawn; other = custom text.
	const header = titleOverride === undefined ? titleFallback : titleOverride
	const textAlign: "left" | "center" | "right" =
		titleAlignment === "left"
			? "left"
			: titleAlignment === "right"
				? "right"
				: "center"
	// Each sub-legend honors `orientation` directly so its swatches lay
	// out in the right axis (vertical = stacked rows, horizontal = single
	// row) WITHOUT wrapping. No CSS override needed.
	const innerClass = ""
	return (
		// `gap-2.5` (10 px) puts a comfortable air-gap between the section
		// title and the legend content below it — `gap-1.5` (6 px) crowded
		// the title against the top of a gradient bar.
		<div className="flex flex-col gap-2.5">
			{header !== "" && (
				<div
					className="font-medium"
					style={{
						fontSize: titleFont.size,
						fontFamily: titleFont.family,
						color: titleFont.color,
						textAlign,
						whiteSpace: "pre-line",
						fontWeight: titleFont.weight ?? undefined,
						fontStyle: titleFont.italic ? "italic" : undefined,
						textDecoration: titleFont.underline ? "underline" : undefined,
						transform:
							titleOffset && (titleOffset.x || titleOffset.y)
								? `translate(${titleOffset.x ?? 0}px, ${titleOffset.y ?? 0}px)`
								: undefined,
					}}
				>
					{header}
				</div>
			)}
			<div
				className={innerClass}
				style={{
					fontSize: textFontSize,
					fontWeight: textWeight ?? undefined,
					fontStyle: textItalic ? "italic" : undefined,
					textDecoration: textUnderline ? "underline" : undefined,
				}}
			>
				{section.kind === "combined" && (
					<CombinedGroupLegend
						channels={section.channels}
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						reverseCategorical={reverseCategorical}
						gradientLegendStyle={gradientLegendStyle}
						gradientBarStyle={gradientBarStyle}
						orientation={orientation}
						entryColumns={entryColumns}
						highlightField={highlightField}
						connectionMapped={connectionMapped}
						defaultSwatchOpacity={defaultSwatchOpacity}
						auxSwatchColor={auxSwatchColor}
						auxSwatchStroke={auxSwatchStroke}
						shapeLegendFillColor={legendFillColor}
						shapeLegendStrokeColor={legendStrokeColor}
						channelCfg={
							// Combined sections always include hue as the leading
							// visual cue, so the user's hue overrides drive the
							// quant break behavior. opacity-without-hue combined
							// legends are categorical-only today so this never
							// fires for them.
							channelLegendCfgs?.hue
						}
						swatchShape={hueSwatchShape}
						swatchSize={hueSwatchSize}
						swatchOutline={swatchOutline}
						// Area / radar: the fill (hue) and the line/outline use the
						// same field but separate palettes, so outline each swatch in
						// its line color. Same chain the renderer uses.
						splitOutline={
							splitOutlineEligible
								? {
										linePalette: configs.connection?.linePalette ?? null,
										lineColors: configs.connection?.lineColors ?? {},
										strokeOverride: configs.connection?.strokeColor ?? null,
									}
								: null
						}
					/>
				)}
				{section.kind === "single" && section.channel === "hue" && (
					<HueLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						reverseCategorical={reverseCategorical}
						gradientLegendStyle={gradientLegendStyle}
						gradientBarStyle={gradientBarStyle}
						orientation={orientation}
						entryColumns={entryColumns}
						highlightField={highlightField}
						channelCfg={channelLegendCfgs?.hue}
						swatchShape={hueSwatchShape}
						swatchSize={hueSwatchSize}
						swatchOutline={swatchOutline}
						defaultSwatchOpacity={defaultSwatchOpacity}
						// Area + radar charts expose a separate line/outline
						// palette in the Hue panel. When non-null, HueLegend
						// draws each categorical swatch outlined in the
						// matching stroke color so the user sees "filled with
						// X, outlined with Y" in the legend.
						splitOutline={
							splitOutlineEligible
								? {
										linePalette: configs.connection?.linePalette ?? null,
										lineColors:
											configs.connection?.lineColors ?? {},
										strokeOverride:
											configs.connection?.strokeColor ?? null,
									}
								: null
						}
					/>
				)}
				{section.kind === "slot" &&
					(() => {
						// Render the slot's categorical colors via HueLegend by
						// pointing its hue inputs at the slot's own config + palette,
						// so the swatches match the colors the feature actually draws.
						//
						// Density curve: when BOTH fill and outline vary by the field
						// (and the curve is filled), each swatch shows the FILL color
						// outlined in the OUTLINE color — mirroring the rendered curve,
						// so neither mapping is hidden. Falls back to a single slot
						// (the rug, or one mapped density slot) otherwise.
						const isDensity = section.legendKey === "densityCurve"
						const fillCfg = configs.colorSlots?.densityCurveFill
						const strokeCfg = configs.colorSlots?.densityCurveStroke
						const densityFilled =
							configs.x?.histogram?.densityFill === true ||
							configs.y?.histogram?.densityFill === true
						const splitDensity =
							isDensity && !!fillCfg?.field && !!strokeCfg?.field && densityFilled
						const fillSlot = splitDensity
							? fillCfg
							: configs.colorSlots?.[section.slotKey]
						const outlineSlot = splitDensity ? strokeCfg : null
						const slotConfigs = {
							...configs,
							hue: fillSlot?.hue,
							categoricalPalette: fillSlot?.palette ?? configs.categoricalPalette,
							ordinalPalette: fillSlot?.palette ?? configs.ordinalPalette,
						}
						// Per-category outline colors for the swatch border, resolved
						// from the outline slot's scale (covers palette OR explicit
						// per-value colors).
						let splitOutline: Parameters<typeof HueLegend>[0]["splitOutline"] =
							null
						if (outlineSlot) {
							const outlineScale = makeHueScale(
								values,
								type,
								outlineSlot.hue,
								outlineSlot.palette ?? undefined,
							)
							const lineColors: Record<string, string> = {}
							if (outlineScale.kind === "categorical") {
								for (const v of uniqueValues(values, type)) {
									const c = applyHueScale(outlineScale, v, type)
									if (c) lineColors[v] = c
								}
							}
							splitOutline = {
								linePalette: null,
								lineColors,
								strokeOverride: outlineSlot.singleColor ?? null,
							}
						}
						return (
							<HueLegend
								type={type}
								values={values}
								configs={slotConfigs}
								pinnedOrder={pinnedOrder}
								reverseCategorical={reverseCategorical}
								gradientLegendStyle={gradientLegendStyle}
								gradientBarStyle={gradientBarStyle}
								orientation={orientation}
								entryColumns={entryColumns}
								channelCfg={undefined}
								swatchShape={hueSwatchShape}
								swatchSize={hueSwatchSize}
								swatchOutline={swatchOutline}
								defaultSwatchOpacity={defaultSwatchOpacity}
								splitOutline={splitOutline}
							/>
						)
					})()}
				{section.kind === "single" && section.channel === "shape" && (
					<ShapeLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						legendFillColor={legendFillColor}
						legendStrokeColor={legendStrokeColor}
						orientation={orientation}
						entryColumns={entryColumns}
						defaultSwatchOpacity={defaultSwatchOpacity}
					/>
				)}
				{section.kind === "single" && section.channel === "pattern" && (
					<PatternLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						reverseCategorical={reverseCategorical}
						orientation={orientation}
						entryColumns={entryColumns}
						defaultSwatchOpacity={defaultSwatchOpacity}
					/>
				)}
				{section.kind === "single" && section.channel === "area" && (
					<AreaLegend
						type={type}
						values={values}
						configs={configs}
						channelCfg={channelLegendCfgs?.area}
						swatchColor={auxSwatchColor}
						swatchStroke={auxSwatchStroke}
						orientation={orientation}
						defaultSwatchOpacity={defaultSwatchOpacity}
						proportionalSizeExponent={proportionalSizeExponent}
					/>
				)}
				{section.kind === "single" && section.channel === "opacity" && (
					<OpacityLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						reverseCategorical={reverseCategorical}
						channelCfg={channelLegendCfgs?.opacity}
						swatchColor={auxSwatchColor}
						orientation={orientation}
						entryColumns={entryColumns}
					/>
				)}
				{section.kind === "single" && section.channel === "length" && (
					<LengthLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						channelCfg={channelLegendCfgs?.length}
						swatchColor={auxSwatchColor}
						orientation={orientation}
					/>
				)}
				{section.kind === "single" && section.channel === "angle" && (
					<AngleLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						channelCfg={channelLegendCfgs?.angle}
						swatchColor={auxSwatchColor}
						orientation={orientation}
					/>
				)}
			</div>
		</div>
	)
}

type LegendProps = {
	type: FieldType
	values: unknown[]
	configs: LegendSectionProps["configs"]
	/** Per-channel break + format overrides for this legend's channel.
	 * `undefined` = use defaults (toFixed-style numeric, 5-stop gradient
	 * for hue / 3-stop swatches for area/length/angle). When set, the
	 * scale builders and legend layout both consult it. */
	channelCfg?: LegendChannelConfig
	/** Standalone-swatch color override for the length / angle / area /
	 * opacity legends (used when there's no hue gradient to inherit
	 * from). `null` / `undefined` falls back to the historical
	 * `#4f8eda`. */
	swatchColor?: string | null
	/** Border (stroke) color for the area (size) legend swatch circles.
	 * Only consumed by `AreaLegend`. `null` / `undefined` falls back to the
	 * historical white outline. */
	swatchStroke?: string | null
	/** Layout direction: `vertical` (stacked) renders one swatch per row
	 * with the label to the right; `horizontal` lays all swatches out in
	 * a single row with labels below. Legends NEVER line-wrap — the
	 * legend column grows to accommodate. */
	orientation?: "vertical" | "horizontal"
	/** User-pinned ordering for this field's categorical/ordinal levels
	 * (from the Fields reorder UI, `currentFieldLevelOrdersAtom`). When set,
	 * categorical legend entries list in this order — matching the axis /
	 * marks. `undefined` keeps discovery order. */
	pinnedOrder?: readonly string[]
	/** When >1, a categorical entry list wraps its rows across this many CSS
	 * columns (the "one legend → N columns" layout). Undefined / 1 keeps the
	 * classic single stack. Gradient / ramp (quantitative) renderings ignore
	 * it — only the categorical swatch lists split. */
	entryColumns?: number
	/** Encoded field name for legend-hover highlighting. When set, each
	 * categorical entry publishes `{ field, value }` to `hoveredLegendEntryAtom`
	 * on hover so the plots dim non-matching marks. Undefined = feature off for
	 * this legend (quantitative sections and the disabled state). */
	highlightField?: string
}

type ReversibleLegendProps = LegendProps & { reverseCategorical: boolean }

const Swatch = ({
	color,
	strokeColor,
	strokeWidth,
	shape,
	size,
	children,
	horizontal,
	opacity = 1,
}: {
	color: string
	/** Optional border color drawn AROUND the fill. Set by area / radar
	 *  charts where the user has chosen a separate palette for the
	 *  line/outline so the legend can reflect "filled with X, outlined
	 *  with Y" at a glance. Omit (or pass null) for the default no-
	 *  border swatch. */
	strokeColor?: string | null
	/** Border width (px) for `strokeColor`. Defaults to 1.5 (the historical
	 *  split-outline width); the user's Swatch outline setting passes its own. */
	strokeWidth?: number | null
	/** Optional swatch glyph: a `SHAPE_PALETTE` index draws that symbol
	 *  (filled with `color`), `"line"` draws a short line segment, `null` keeps
	 *  the default rounded rectangle. */
	shape?: LegendSwatchShape
	/** Swatch size (px, radius-like). Defaults to 5. Symbol radius when
	 *  `shape` is set; scales the default rectangle proportionally otherwise. */
	size?: number | null
	children: React.ReactNode
	/** When true, render with no width-min / no truncate so the row's
	 * labels keep their natural width — used by horizontal legend rows
	 * where the parent container is `flex-nowrap`. */
	horizontal?: boolean
	/** Opacity applied to the swatch GRAPHIC only (never the label) so it can
	 *  match marks drawn at a reduced global opacity. Defaults to 1. */
	opacity?: number
}) => (
	<div
		className={
			horizontal
				? "flex flex-shrink-0 items-center gap-1.5"
				: "flex items-center gap-2"
		}
	>
		{shape == null ? (
			<span
				className="block flex-shrink-0 rounded-sm"
				style={{
					// The size picker (radius-like, 5 = historical) scales the
					// default 16×12 rectangle so it isn't glyph-only.
					width: Math.round(16 * ((size ?? 5) / 5)),
					height: Math.round(12 * ((size ?? 5) / 5)),
					backgroundColor: color,
					opacity,
					...(strokeColor
						? {
								borderColor: strokeColor,
								borderStyle: "solid",
								borderWidth: strokeWidth ?? 1.5,
							}
						: undefined),
				}}
			/>
		) : (
			(() => {
				const r = size ?? 5
				const side = (r + 3) * 2
				return (
					<svg
						width={side}
						height={side}
						viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`}
						aria-hidden="true"
						className="flex-shrink-0"
						opacity={opacity}
					>
						{shape === "line" ? (
							<line
								x1={-r}
								y1={0}
								x2={r}
								y2={0}
								stroke={color}
								strokeWidth={Math.max(2, Math.round(r / 2))}
								strokeLinecap="round"
							/>
						) : (
							<path
								d={symbolPath(shape, r)}
								fill={color}
								stroke={strokeColor ?? undefined}
								strokeWidth={strokeColor ? (strokeWidth ?? 1.5) : undefined}
							/>
						)}
					</svg>
				)
			})()
		)}
		<span
			className={
				horizontal ? "whitespace-nowrap" : "min-w-0 truncate"
			}
			title={String(children)}
		>
			{children}
		</span>
	</div>
)

/** Swatch that composes color, opacity, optional pattern overlay, and an
 * optional shape glyph — mirrors what a mark/slice looks like in the chart.
 * Used by the combined group legend when 2+ group encodings share the same
 * field. When `shape` is provided, the swatch draws the symbol path
 * (colored by the hue) instead of a rectangle, so that hue+shape on the
 * same field collapses into one row per category. `shapeFill === "none"`
 * routes through to render an outline-only glyph. */
const ComposedSwatch = ({
	color,
	opacity,
	pattern,
	shape,
	dash,
	swatchShape,
	swatchSize,
	outlineStroke,
	outlineWidth,
}: {
	color: string
	opacity: number
	pattern: { bg: string; ink: string; paletteIdx: number; svgId: string } | null
	shape?: {
		idx: number
		fill: string // "none" or a color
		stroke: string
		/** Glyph radius (px). Defaults to 5. Set by synthesized outline-only
		 *  swatches so the user's swatch-size choice applies. */
		size?: number
		/** Draw a line segment instead of the symbol glyph (the "line" swatch
		 *  shape), stroked in `stroke`. */
		line?: boolean
	}
	/** When set, draws a horizontal line segment across the swatch with
	 *  the given SVG stroke-dasharray. Used to show line-chart dash
	 *  patterns alongside the shape pattern in a combined legend. `null`
	 *  for the array means solid. */
	dash?: { strokeDashArray: string | null; stroke: string } | null
	/** Hue-legend swatch shape (a `SHAPE_PALETTE` index). When set — and no
	 *  per-mark `shape` encoding is present — the otherwise-rectangular
	 *  swatch is drawn as this symbol, filled with the swatch color (or
	 *  pattern overlay). `null` / undefined keeps the rectangle. */
	swatchShape?: LegendSwatchShape
	/** Swatch size (px, radius-like). Defaults to 5. Symbol radius for the
	 *  `swatchShape` glyph; scales the default / pattern rectangle otherwise. */
	swatchSize?: number | null
	/** Border color drawn around the swatch — the area/radar line color when it
	 *  differs from the fill. `null` / undefined → no border. */
	outlineStroke?: string | null
	/** Border width (px) for `outlineStroke`. Defaults to 1.5 (the historical
	 *  split-outline width); the user's Swatch outline setting passes its own. */
	outlineWidth?: number | null
}) => {
	// Default-rectangle dimensions. The swatch-size picker (radius-like, 5 =
	// historical) scales them proportionally so the rectangle honors the size
	// control just like the shaped glyphs do.
	const rectScale = (swatchSize ?? 5) / 5
	const w = Math.round(18 * rectScale)
	const h = Math.round(12 * rectScale)
	// Line chart context: mirror the rendered visual — dash line passing
	// behind a (patterned) point. Shape uses the encoded shape index when
	// available, otherwise defaults to a circle. Pattern fills the shape.
	if (dash) {
		// Glyph radius honors the user's swatch-size choice — `shape.size` when
		// a shape channel is mapped, otherwise the hue swatch-size picker. 4.5
		// stays the baseline so existing line charts don't shift.
		const r = shape?.size ?? swatchSize ?? 4.5
		// Grow the swatch box with the glyph; keep extra horizontal room so the
		// dashed line still reads as a line beside larger symbols.
		const lh = Math.max(14, (r + 3) * 2)
		const lw = Math.max(22, (r + 3) * 2 + 8)
		const cx = lw / 2
		const cy = lh / 2
		// The "line" swatch shape (or a synthesized line descriptor) reads as a
		// pure dashed stroke — skip the point glyph behind it.
		const showGlyph = swatchShape !== "line" && !shape?.line
		// The dash (line-chart) context draws a point glyph behind the line; a
		// "line" swatch shape has no point form here, so fall back to a circle.
		const shapeIdx =
			shape?.idx ?? (typeof swatchShape === "number" ? swatchShape : 0)
		const symbolD = symbolPath(shapeIdx, r)
		const def = pattern
			? PATTERN_PALETTE[pattern.paletteIdx % PATTERN_PALETTE.length]
			: null
		const patId = pattern ? `legend-combined-${pattern.svgId}` : null
		const shapeFill = pattern
			? `url(#${patId})`
			: (shape?.fill ?? color)
		const shapeStroke = shape?.stroke ?? color
		return (
			<svg
				width={lw}
				height={lh}
				viewBox={`0 0 ${lw} ${lh}`}
				className="flex-shrink-0"
				style={{ opacity }}
				aria-hidden="true"
			>
				{pattern && def && patId && (
					<defs>
						<pattern
							id={patId}
							patternUnits="userSpaceOnUse"
							width={def.size}
							height={def.size}
						>
							<rect
								width={def.size}
								height={def.size}
								fill={pattern.bg}
							/>
							{def.render(pattern.ink)}
						</pattern>
					</defs>
				)}
				<line
					x1={0}
					y1={cy}
					x2={lw}
					y2={cy}
					stroke={dash.stroke}
					strokeWidth={1.5}
					strokeLinecap="butt"
					strokeDasharray={dash.strokeDashArray ?? undefined}
				/>
				{showGlyph && (
					<g transform={`translate(${cx}, ${cy})`}>
						<path
							d={symbolD}
							fill={shapeFill}
							fillOpacity={shape?.fill === "none" && !pattern ? 0 : 1}
							stroke={shapeStroke}
							strokeWidth={1}
						/>
					</g>
				)}
			</svg>
		)
	}
	if (shape) {
		// Shape route: emit the symbol path filled with hue color (or
		// outlined-only when fill === "none"). Pattern overlay still
		// applies as a fill via `<defs>` if present, but the simpler
		// path here covers the user-reported case (hue + shape on same
		// field). Synthesized outline swatches may carry a `size` (from the
		// swatch-size picker) and a `line` flag (the "line" swatch shape).
		const r = shape.size ?? 5
		const side = Math.max(16, (r + 3) * 2)
		return (
			<svg
				width={side}
				height={side}
				viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`}
				aria-hidden="true"
				className="flex-shrink-0"
				style={{ opacity }}
			>
				{shape.line ? (
					<line
						x1={-r}
						y1={0}
						x2={r}
						y2={0}
						stroke={shape.stroke}
						strokeWidth={Math.max(2, Math.round(r / 2))}
						strokeLinecap="round"
					/>
				) : (
					<path
						d={symbolPath(shape.idx, r)}
						fill={shape.fill}
						fillOpacity={shape.fill === "none" ? 0 : 1}
						stroke={shape.stroke}
						strokeWidth={1}
					/>
				)}
			</svg>
		)
	}
	if (swatchShape != null) {
		// Hue-legend swatch shape: no per-mark shape encoding, but the user
		// picked a glyph for the color swatches. Draw the symbol filled with
		// the swatch color — or a pattern overlay when a pattern channel
		// shares the field, so the composed visual is preserved.
		const def = pattern
			? PATTERN_PALETTE[pattern.paletteIdx % PATTERN_PALETTE.length]
			: null
		const patId = pattern ? `legend-combined-${pattern.svgId}` : null
		const fill = pattern && patId ? `url(#${patId})` : color
		const r = swatchSize ?? 5
		const side = (r + 3) * 2
		return (
			<svg
				width={side}
				height={side}
				viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`}
				aria-hidden="true"
				className="flex-shrink-0"
				style={{ opacity }}
			>
				{pattern && def && patId && (
					<defs>
						<pattern
							id={patId}
							patternUnits="userSpaceOnUse"
							width={def.size}
							height={def.size}
						>
							<rect width={def.size} height={def.size} fill={pattern.bg} />
							{def.render(pattern.ink)}
						</pattern>
					</defs>
				)}
				{swatchShape === "line" ? (
					<line
						x1={-r}
						y1={0}
						x2={r}
						y2={0}
						stroke={pattern ? color : (outlineStroke ?? color)}
						strokeWidth={Math.max(2, Math.round(r / 2))}
						strokeLinecap="round"
					/>
				) : (
					<path
						d={symbolPath(swatchShape, r)}
						fill={fill}
						stroke={outlineStroke ?? undefined}
						strokeWidth={outlineStroke ? (outlineWidth ?? 1.5) : undefined}
					/>
				)}
			</svg>
		)
	}
	if (pattern) {
		const def = PATTERN_PALETTE[pattern.paletteIdx % PATTERN_PALETTE.length]
		const patId = `legend-combined-${pattern.svgId}`
		return (
			<svg
				width={w}
				height={h}
				className="flex-shrink-0 rounded-sm"
				style={{ opacity }}
				aria-hidden="true"
			>
				<defs>
					<pattern
						id={patId}
						patternUnits="userSpaceOnUse"
						width={def.size}
						height={def.size}
					>
						<rect width={def.size} height={def.size} fill={pattern.bg} />
						{def.render(pattern.ink)}
					</pattern>
				</defs>
				<rect
					width={w}
					height={h}
					fill={`url(#${patId})`}
					stroke={outlineStroke ?? undefined}
					strokeWidth={outlineStroke ? (outlineWidth ?? 1.5) : undefined}
				/>
			</svg>
		)
	}
	return (
		<span
			className="block flex-shrink-0 rounded-sm"
			style={{
				width: w,
				height: h,
				backgroundColor: color,
				opacity,
				...(outlineStroke
					? {
							borderColor: outlineStroke,
							borderStyle: "solid",
							borderWidth: outlineWidth ?? 1.5,
						}
					: undefined),
			}}
		/>
	)
}

type CombinedGroupLegendProps = ReversibleLegendProps & {
	channels: ReadonlyArray<
		| "area"
		| "hue"
		| "outlineHue"
		| "saturation"
		| "brightness"
		| "pattern"
		| "opacity"
		| "shape"
		| "length"
		| "angle"
	>
	/** When the section's only group channel is hue and the field is
	 * quantitative, this controls whether the legend renders as a
	 * gradient bar or as five sampled swatches. Mirrors HueLegend's
	 * behavior — `CombinedGroupLegend` is the renderer that actually
	 * fires for hue-only quantitative encodings (hue is a group channel,
	 * so it always routes through the combined branch). */
	gradientLegendStyle?: "bar" | "swatches"
	/** Resolved gradient-bar display options (length / radius / ticks /
	 * label alignment). Only consulted when the bar branch fires. */
	gradientBarStyle?: GradientBarStyle
	/** Drives the gradient bar's orientation: `vertical` lays the bar
	 * top-to-bottom (hi-on-top) so it visually matches stacked swatches;
	 * `horizontal` lays it left-to-right. Mirrors the swatch flow direction
	 * the legend's parent picks based on its position + orientation
	 * settings. */
	orientation?: "vertical" | "horizontal"
	/** True when a connection encoding is mapped — line chart context.
	 *  Triggers a dash-line overlay on combined swatches so the legend
	 *  reflects both the shape pattern fill and the line dash style. */
	connectionMapped?: boolean
	/** Per-channel break + format overrides for the quantitative branch
	 * (gradient bar / swatch stops). When hue is the leading channel this
	 * is typically `legendCfg.channels.hue`. */
	channelCfg?: LegendChannelConfig
	/** Hue-legend swatch shape (`SHAPE_PALETTE` index). Reshapes the color
	 *  swatches when no per-mark shape encoding is present. `null` /
	 *  undefined keeps the default rectangle. */
	swatchShape?: LegendSwatchShape
	/** Symbol radius (px) for the swatch shape. `null` / undefined → 5. */
	swatchSize?: number | null
	/** Aux-swatch fill/stroke from the Legend "Size" submenu
	 *  (`auxLegendSwatchColor` / `auxLegendSwatchStroke`). Used for the
	 *  area/angle glyphs when the section has NO hue color to inherit —
	 *  mirroring the standalone `AreaLegend`. When hue drives the color the
	 *  glyph keeps the hue scale as a faithful key and these are ignored. */
	auxSwatchColor?: string | null
	auxSwatchStroke?: string | null
	/** Shape-swatch fill/stroke from the Legend "Shape swatch" submenu
	 *  (`shapeLegendFillColor` / `shapeLegendStrokeColor`). Used for the shape
	 *  glyph fill/stroke when shape shares the combined section and there's NO
	 *  hue color to inherit — mirroring the standalone `ShapeLegend`. Takes
	 *  precedence over the aux-swatch color since the glyph IS a shape. When hue
	 *  drives the color the glyph keeps the hue scale as a faithful key and
	 *  these are ignored. */
	shapeLegendFillColor?: string | null
	shapeLegendStrokeColor?: string | null
	/** Opacity for swatch graphics, matching marks at the global default
	 *  opacity when opacity isn't encoded. Folds into each entry's opacity
	 *  unless the opacity channel is itself part of the combined group. */
	defaultSwatchOpacity?: number
	/** Area / radar split outline: when set, each categorical swatch is
	 *  bordered in its line color (resolved per category via the same chain as
	 *  the renderer: per-value override → line palette → global stroke), so the
	 *  legend reflects "filled with X, outlined with Y". `null` = no border. */
	splitOutline?: {
		linePalette: ReadonlyArray<string> | null
		lineColors: Record<string, string>
		strokeOverride: string | null
	} | null
	/** User-chosen outline drawn around every color swatch (the Legend panel's
	 *  "Swatch outline" controls). Applies only where no encoded stroke — a
	 *  shape/outline descriptor or the area/radar `splitOutline` — already
	 *  claims the border. `null` = none. */
	swatchOutline?: { color: string; width: number } | null
}

// Exported so smoke tests can prop-drive the component without spinning
// up the full Legend / Jotai tree. Internal callers stay unchanged.
export const CombinedGroupLegend = ({
	channels,
	type,
	values,
	configs,
	pinnedOrder,
	reverseCategorical,
	gradientLegendStyle = "bar",
	gradientBarStyle = DEFAULT_GRADIENT_BAR_STYLE,
	orientation = "vertical",
	connectionMapped = false,
	channelCfg,
	swatchShape,
	swatchSize,
	auxSwatchColor = null,
	auxSwatchStroke = null,
	shapeLegendFillColor = null,
	shapeLegendStrokeColor = null,
	defaultSwatchOpacity = 1,
	splitOutline = null,
	swatchOutline = null,
	entryColumns,
	highlightField,
}: CombinedGroupLegendProps) => {
	const hasHue = channels.includes("hue")
	const hasOutline = channels.includes("outlineHue")
	const hasSat = channels.includes("saturation")
	const hasBri = channels.includes("brightness")
	const hasPat = channels.includes("pattern")
	const hasOp = channels.includes("opacity")
	const hasShape = channels.includes("shape")

	const hueDomain =
		(type === "quantitative" || type === "temporal") && hasHue
			? (resolveLegendDomain(values, type, channelCfg) ?? undefined)
			: undefined
	const hueScale = hasHue
		? makeHueScale(
				values,
				type,
				configs.hue,
				type === "ordinal"
					? (configs.ordinalPalette ?? configs.categoricalPalette)
					: configs.categoricalPalette,
				hueDomain,
			)
		: null
	// Outline-color scale (`outlineHue` channel). Drives the swatch STROKE,
	// independently of hue (fill). When outline is the only color channel in
	// the section, it also becomes the gradient/quant color via `colorScale`.
	const outlineScale = hasOutline
		? makeHueScale(
				values,
				type,
				configs.outlineHue,
				outlinePaletteForHueType(type, configs),
				type === "quantitative" || type === "temporal"
					? (resolveLegendDomain(values, type, channelCfg) ?? undefined)
					: undefined,
			)
		: null
	// The scale that drives a continuous gradient / quant swatch color when a
	// single color channel owns the section. Hue wins when both are present
	// (it's the fill); outline stands in for a solo outline-color section.
	const colorScale = hueScale ?? outlineScale
	const satScale = hasSat
		? makeSaturationScale(values, type, configs.saturation)
		: null
	const briScale = hasBri
		? makeBrightnessScale(values, type, configs.brightness)
		: null
	const opScale = hasOp ? makeOpacityScale(values, type, configs.opacity) : null
	// Area (size) channel in an ORDINAL combined section. Quantitative area is
	// handled by the shape-glyph path below; an ordinal area field falls
	// through to the categorical renderer, where each category's swatch should
	// be sized by its rank radius (mirroring the standalone AreaLegend). Area
	// only accepts quantitative / ordinal fields, so `type === "ordinal"` is
	// the exact non-quant case that reaches here.
	const areaSizeScale =
		channels.includes("area") && type === "ordinal"
			? makeAreaScale(values, type, configs.area)
			: null
	const areaRadiusFor = (v: string): number | null =>
		areaSizeScale ? applyAreaScale(areaSizeScale, v, type) : null
	const patCategories = hasPat ? patternCategoriesFor(values, type) : null
	const patBg = configs.pattern?.backgroundColor ?? "#e2e8f0"
	// Line dash overlay only meaningful when connection is mapped AND a
	// pattern field shares this section's variable. Auto-cycle through
	// DASH_CYCLE by category position; per-category overrides win.
	// Mirrors `dashFromPatternField` in ScatterPlot.renderConnectionLines.
	const dashOverrides = configs.pattern?.dashOverrides ?? {}
	const showDash = connectionMapped && hasPat && patCategories !== null
	const dashFor = (v: string, idx: number): LineDashPattern => {
		const override = dashOverrides[v]
		if (override === "none") return "solid"
		if (typeof override === "number") {
			return DASH_CYCLE[override % DASH_CYCLE.length] ?? "solid"
		}
		return DASH_CYCLE[idx % DASH_CYCLE.length] ?? "solid"
	}
	const defaultFill = configs.defaultFill ?? DEFAULT_FILL
	// When no hue color drives the swatch, the user's Legend swatch pickers
	// choose the fill: the "Shape swatch" fill wins (the combined glyph IS a
	// shape), then the "Size" aux-swatch color (which itself carries the
	// theme's `legendSwatchColor` default), then the mark's default fill. This
	// keeps the shared-field shape+size legend in sync with the standalone
	// ShapeLegend / AreaLegend pickers instead of silently using defaultFill.
	const noHueSwatchFill =
		shapeLegendFillColor ?? auxSwatchColor ?? defaultFill
	// Area / radar split-outline: resolve each category's line color the same
	// way AreaPlot/RadarPlot do (per-value override → line palette by category
	// position → global stroke). Discovery order matches the renderer's group
	// iteration. Returns null when no split outline applies or it equals fill.
	const splitOutlineOrder = splitOutline ? uniqueValues(values, type) : []
	const splitOutlineStrokeFor = (v: string, fill: string): string | null => {
		if (!splitOutline) return null
		const override = splitOutline.lineColors[v]
		if (override) return override === fill ? null : override
		const palette = splitOutline.linePalette
		if (palette && palette.length > 0) {
			const c = palette[splitOutlineOrder.indexOf(v) % palette.length]
			if (c) return c === fill ? null : c
		}
		const g = splitOutline.strokeOverride
		if (g) return g === fill ? null : g
		return null
	}
	// Shape index resolver — only built when shape is part of the combined
	// section. Mirrors what `ShapeLegend` does: `makeShapeIndexer` returns
	// a function from category-value → palette index. Fill / stroke
	// overrides are read directly from `configs.shape` per category.
	const shapeIndexer = hasShape
		? makeShapeIndexer(values, type, configs.shape)
		: null
	const shapeFillOverrides = configs.shape?.fillOverrides ?? {}
	const shapeStrokeOverrides = configs.shape?.strokeOverrides ?? {}
	const shapeOutlineColor =
		configs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor

	const buildEntry = (v: string) => {
		let color = hasHue ? defaultFill : noHueSwatchFill
		if (hueScale) {
			const c = applyHueScale(hueScale, v, type)
			if (c) color = c
		}
		const satU = satScale ? satScale(v) : null
		const briU = briScale ? briScale(v) : null
		if (satU !== null || briU !== null) {
			color = modulateColor(color, satU, briU)
		}
		const opacity = opScale ? (opScale(v) ?? 1) : defaultSwatchOpacity
		let pattern: Parameters<typeof ComposedSwatch>[0]["pattern"] = null
		if (patCategories) {
			const catIdx = patCategories.indexOf(v)
			if (catIdx !== -1) {
				const bg = hasHue ? color : patBg
				// Mirror ScatterPlot's preferredInk lookup so the legend
				// swatch's ink matches the mark's ink when the categorical
				// palette pairs a hue color with a custom pattern ink.
				const huePalette = inkPaletteForHue(configs, type)
				const preferredInk = hasHue
					? inkForHueColor(bg, huePalette.palette, huePalette.inks)
					: null
				const resolved = resolvePatternForMark(
					v,
					catIdx,
					bg,
					configs.pattern,
					preferredInk
				)
				if (resolved !== null) {
					pattern = {
						bg: resolved.bgColor,
						ink: resolved.inkColor,
						paletteIdx: resolved.paletteIdx,
						svgId: resolved.svgId,
					}
				}
			}
		}
		// Build the shape descriptor when shape is in the combined section.
		// Hue acts as the FILL (so each category's swatch shows its color
		// in the right shape). Per-category overrides win — including the
		// literal "none" → outline-only.
		// Outline-color scale value for this category (the `outlineHue`
		// channel). Per-category shape stroke overrides still win on top.
		const outlineScaleColor =
			outlineScale ? applyHueScale(outlineScale, v, type) : null
		// Conditional outline rules override the scale color when this
		// category's outline value matches a rule, mirroring ScatterPlot
		// (resolveRuleColor over `configs.shape.outlineColorRules`). Sits
		// below per-category stroke overrides and above the scale color.
		const outlineRuleColor = hasOutline
			? resolveRuleColor(configs.shape?.outlineColorRules, v)
			: null
		let shape: Parameters<typeof ComposedSwatch>[0]["shape"]
		if (shapeIndexer) {
			const fillOverride = shapeFillOverrides[v]
			const strokeOverride = shapeStrokeOverrides[v]
			shape = {
				idx: shapeIndexer(v),
				fill: fillOverride === "none" ? "none" : (fillOverride ?? color),
				stroke:
					strokeOverride ??
					outlineRuleColor ??
					outlineScaleColor ??
					(hasHue ? color : (shapeLegendStrokeColor ?? shapeOutlineColor)),
			}
		} else if (hasOutline) {
			// No shape channel, but outline color IS encoded — draw a glyph so the
			// varying stroke color is visible. The user's swatch-shape / size
			// picker for the Outline section drives the glyph (a SHAPE_PALETTE
			// index, or "line"); falls back to the default shape. Fill follows the
			// hue color when hue is also shown (matching the marks); outline-only
			// (no hue) stays unfilled so the swatch reads as a stroke.
			shape = {
				idx: typeof swatchShape === "number" ? swatchShape : (configs.defaultShape ?? 0),
				fill: hasHue ? color : "none",
				stroke: outlineRuleColor ?? outlineScaleColor ?? shapeOutlineColor,
				size: swatchSize ?? undefined,
				line: swatchShape === "line",
			}
		}
		// Line dash overlay — in line chart context, draw a horizontal
		// stroke across the swatch so users can see both the shape
		// pattern fill AND the line's dash style at a glance. The dash
		// is drawn on top of a white underlay band so it stays legible
		// regardless of the swatch's pattern fill.
		let dash: Parameters<typeof ComposedSwatch>[0]["dash"] = null
		if (showDash && patCategories) {
			const catIdx = patCategories.indexOf(v)
			if (catIdx !== -1) {
				const dashStyle = dashFor(v, catIdx)
				dash = {
					strokeDashArray: dashArrayFor(dashStyle),
					// Hue color matches what the actual polyline strokes
					// look like in the chart.
					stroke: color,
				}
			}
		}
		// Size the glyph by the area channel (ordinal combined section). Force a
		// glyph so the varying radius is visible — reuse the shape descriptor
		// when one exists (shape / outline channel), else synthesize the
		// default (or the user's swatch-shape) glyph filled with the category
		// color. Mirrors the quantitative shape-glyph path's size composition.
		const areaR = areaRadiusFor(v)
		if (areaR !== null) {
			shape = shape
				? { ...shape, size: areaR }
				: {
						idx:
							typeof swatchShape === "number"
								? swatchShape
								: (configs.defaultShape ?? 0),
						fill: hasHue ? color : noHueSwatchFill,
						stroke:
							outlineRuleColor ??
							outlineScaleColor ??
							(hasHue ? color : shapeOutlineColor),
						size: areaR,
						line: swatchShape === "line",
					}
		}
		// Area / radar line color → swatch border. Only when there's no per-mark
		// `shape` descriptor (that already carries its own stroke); for the
		// rectangle / swatch-shape glyph the border shows the line color. The
		// user's Swatch outline fills in when no encoded stroke claims the border.
		const splitStroke = shape ? null : splitOutlineStrokeFor(v, color)
		const outlineStroke =
			splitStroke ?? (shape ? null : (swatchOutline?.color ?? null))
		const outlineWidth = splitStroke ? null : (swatchOutline?.width ?? null)
		return { color, opacity, pattern, shape, dash, outlineStroke, outlineWidth }
	}

	const hasLength = channels.includes("length")
	const hasAngle = channels.includes("angle")
	const hasArea = channels.includes("area")
	const isQuant = type === "quantitative" || type === "temporal"

	// Shape-glyph combined legend: when area / angle (and/or shape) share
	// the section with hue on a quantitative field — but length isn't in
	// the mix — render each break as a shape glyph that composes EVERY
	// visual encoding the chart uses for that break:
	//   - glyph     = configs.defaultShape (square / circle / etc.)
	//   - size      = areaScale(break) when area is mapped, else default radius
	//   - rotation  = angleScale(break) when angle is mapped, else 0
	//   - fill      = hueScale(break) when hue is mapped, else fallback
	//   - stroke    = configs.shape.outlineColor
	// This matches what the chart actually draws for marks at that value,
	// so the legend reads as a faithful key.
	if (isQuant && !hasLength && (hasArea || hasAngle)) {
		const merged = resolveLegendChannelConfig(channelCfg)
		const stops = resolveLegendBreaks(values, type, channelCfg, 5, 2)
		if (stops.length === 0) return null
		const dataExt = legendDataExtent(values, type)
		const customFmt = buildLegendFormatter(merged.format)
		const fallbackFmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "")
		const rawFmt = customFmt ?? fallbackFmt
		const fmt = (v: number, i: number) =>
			decorateOpenEndLabel(rawFmt(v), i, stops, dataExt)
		const domainOverride =
			resolveLegendDomain(values, type, channelCfg) ?? undefined
		const areaScale = hasArea
			? makeAreaScale(values, type, configs.area, domainOverride)
			: null
		const angleScale = hasAngle
			? makeAngleScale(values, type, configs.angle, domainOverride)
			: null
		const FALLBACK_R = 8
		const shapeIdx = configs.defaultShape ?? 0
		const strokeColor =
			configs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor
		const strokeWidth = configs.shape?.outlineWidth ?? 1
		// When no hue drives the glyph color, the Legend "Size" submenu's aux
		// swatch fill/stroke apply — mirroring the standalone AreaLegend so a
		// combined size legend honors the same picker. With hue present the
		// glyph keeps the hue scale as a faithful key.
		// Shape sharing the section makes the glyph a shape swatch, so its
		// "Shape swatch" fill/stroke win over the aux (Size) swatch color.
		const noHueFill =
			(hasShape ? shapeLegendFillColor : null) ?? auxSwatchColor ?? "#4f8eda"
		const noHueStroke =
			(hasShape ? shapeLegendStrokeColor : null) ?? auxSwatchStroke ?? strokeColor
		const maxR = stops.reduce((m, v) => {
			const r = areaScale ? (applyAreaScale(areaScale, v, type) ?? FALLBACK_R) : FALLBACK_R
			return Math.max(m, r)
		}, FALLBACK_R)
		const colWidth = Math.max(24, Math.ceil(maxR * 2) + 4)
		if (orientation === "horizontal") {
			// Single row: each stop becomes a column with the glyph above
			// its label.
			const cellH = Math.max(24, Math.ceil(maxR * 2) + 4)
			return (
				<div className="flex flex-row flex-nowrap items-end gap-3">
					{stops.map((v, i) => {
						const color = hueScale
							? (applyHueScale(hueScale, v, type) ?? "#4f8eda")
							: noHueFill
						const r = areaScale
							? (applyAreaScale(areaScale, v, type) ?? FALLBACK_R)
							: FALLBACK_R
						const rad = angleScale ? (angleScale(v) ?? 0) : 0
						const deg = (rad * 180) / Math.PI
						const cellW = Math.max(24, Math.ceil(r * 2) + 4)
						return (
							<div
								key={v}
								className="flex flex-shrink-0 flex-col items-center gap-1"
							>
								<svg width={cellW} height={cellH} aria-hidden="true">
									<path
										d={symbolPath(shapeIdx, r)}
										transform={`translate(${cellW / 2},${cellH / 2})${deg ? ` rotate(${deg})` : ""}`}
										fill={color}
										fillOpacity={0.85 * defaultSwatchOpacity}
										stroke={hueScale ? strokeColor : noHueStroke}
										strokeWidth={strokeWidth}
									/>
								</svg>
								<span>{fmt(v, i)}</span>
							</div>
						)
					})}
				</div>
			)
		}
		return (
			<div className="flex flex-col gap-1">
				{stops.map((v, i) => {
					const color = hueScale
						? (applyHueScale(hueScale, v, type) ?? "#4f8eda")
						: noHueFill
					const r = areaScale
						? (applyAreaScale(areaScale, v, type) ?? FALLBACK_R)
						: FALLBACK_R
					const rad = angleScale ? (angleScale(v) ?? 0) : 0
					const deg = (rad * 180) / Math.PI
					const rowH = Math.max(24, Math.ceil(r * 2) + 4)
					return (
						<div key={v} className="flex items-center gap-2">
							<svg
								width={colWidth}
								height={rowH}
								aria-hidden="true"
								className="flex-shrink-0"
							>
								<path
									d={symbolPath(shapeIdx, r)}
									transform={`translate(${colWidth / 2},${rowH / 2})${deg ? ` rotate(${deg})` : ""}`}
									fill={color}
									fillOpacity={0.85 * defaultSwatchOpacity}
									stroke={hueScale ? strokeColor : noHueStroke}
									strokeWidth={strokeWidth}
								/>
							</svg>
							<span className="min-w-0 truncate">{fmt(v, i)}</span>
						</div>
					)
				})}
			</div>
		)
	}

	// Vector-field combined legend: when length is mapped on the shared
	// field, the chart's marks become LINE SEGMENTS (not glyphs) — so the
	// legend matches with one line-segment swatch per break. Length
	// dominates because it geometrically replaces the shape glyph.
	if (isQuant && hasLength) {
		const merged = resolveLegendChannelConfig(channelCfg)
		const stops = resolveLegendBreaks(values, type, channelCfg, 5, 2)
		if (stops.length === 0) return null
		const dataExt = legendDataExtent(values, type)
		const customFmt = buildLegendFormatter(merged.format)
		const fallbackFmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "")
		const rawFmt = customFmt ?? fallbackFmt
		const fmt = (v: number, i: number) =>
			decorateOpenEndLabel(rawFmt(v), i, stops, dataExt)
		const domainOverride =
			resolveLegendDomain(values, type, channelCfg) ?? undefined
		const lengthScale = hasLength
			? makeLengthScale(values, type, configs.length, domainOverride)
			: null
		const angleScale = hasAngle
			? makeAngleScale(values, type, configs.angle, domainOverride)
			: null
		const FALLBACK_LEN = 16
		// Reserve the same horizontal slot for every row's swatch (the
		// widest segment across all stops) so labels line up vertically.
		// Row HEIGHT stays per-row — short segments sit in compact rows;
		// long ones get a taller row only when their rotation actually
		// needs the vertical space. Uniform-square SVGs would force every
		// row to the worst-case height even when the segment is short.
		const maxLen = stops.reduce(
			(m, v) =>
				Math.max(
					m,
					lengthScale ? (lengthScale(v) ?? FALLBACK_LEN) : FALLBACK_LEN,
				),
			FALLBACK_LEN,
		)
		const colWidth = Math.max(24, Math.ceil(maxLen) + 4)
		return (
			<div className="flex flex-col gap-1">
				{stops.map((v, i) => {
					const color = hueScale
						? (applyHueScale(hueScale, v, type) ?? "#4f8eda")
						: "#4f8eda"
					const len = lengthScale ? (lengthScale(v) ?? FALLBACK_LEN) : FALLBACK_LEN
					const rad = angleScale ? (angleScale(v) ?? 0) : 0
					const half = Math.max(6, len / 2)
					const dx = Math.cos(rad) * half
					const dy = Math.sin(rad) * half
					// Row height tracks the segment's actual vertical extent —
					// near-horizontal lines stay compact; only steeply-tilted
					// lines need taller rows.
					const rowH = Math.max(24, Math.ceil(Math.abs(dy) * 2) + 4)
					const cy = rowH / 2
					const cx = colWidth / 2
					return (
						<div key={v} className="flex items-center gap-2">
							<svg
								width={colWidth}
								height={rowH}
								aria-hidden="true"
								className="flex-shrink-0"
							>
								<line
									x1={cx - dx}
									y1={cy + dy}
									x2={cx + dx}
									y2={cy - dy}
									stroke={color}
									strokeWidth={2.5}
									strokeOpacity={defaultSwatchOpacity}
									strokeLinecap="round"
								/>
							</svg>
							<span className="min-w-0 truncate">{fmt(v, i)}</span>
						</div>
					)
				})}
			</div>
		)
	}

	if (isQuant) {
		// Sample numeric stops along the value range. We use these for both
		// the swatch list and the gradient strip so the two render paths
		// stay in sync (same values, same colors). Custom user breaks win;
		// otherwise breakCount evenly spans the data extent (or the user's
		// chosen domain when they've set custom breaks elsewhere).
		const merged = resolveLegendChannelConfig(channelCfg)
		const stops = resolveLegendBreaks(values, type, channelCfg, 5, 2)
		const lo = stops[0]
		const hi = stops.at(-1)
		if (lo === undefined || hi === undefined) return null
		const dataExt = legendDataExtent(values, type)
		const customFmt = buildLegendFormatter(merged.format)
		const fallbackFmt = (n: number) =>
			type === "temporal"
				? new Date(n).toLocaleDateString()
				: Number.isFinite(n)
					? n.toFixed(2)
					: String(n)
		const rawFmt = customFmt ?? fallbackFmt
		const fmt = (v: number, i: number) =>
			decorateOpenEndLabel(rawFmt(v), i, stops, dataExt)
		// Gradient bar mode is only meaningful when hue is the ONLY mapped
		// group channel — once saturation / brightness / pattern / opacity
		// pile on, the per-stop visual differs in more than just hue and a
		// continuous strip can't represent that. Fall back to swatches.
		const onlyColor =
			channels.length === 1 &&
			(channels[0] === "hue" || channels[0] === "outlineHue") &&
			colorScale !== null
		if (gradientLegendStyle === "bar" && onlyColor && colorScale) {
			const gradientStops = stops.map((val, i) => ({
				t: (val - lo) / (hi - lo || 1),
				color: applyHueScale(colorScale, val, type) ?? "#888",
				label: fmt(val, i),
				key: i,
			}))
			return (
				<GradientBarRamp
					stops={gradientStops}
					cssStops={sampleRampCssStops(colorScale, lo, hi, type)}
					orientation={orientation}
					barStyle={gradientBarStyle}
				/>
			)
		}
		if (orientation === "horizontal") {
			return (
				<div className="flex flex-row flex-nowrap items-center gap-3">
					{stops.map((s, i) => {
						const entry = buildEntry(String(s))
						return (
							<div
								key={s}
								className="flex flex-shrink-0 flex-row items-center gap-1.5"
							>
								<ComposedSwatch {...entry} swatchShape={swatchShape} swatchSize={swatchSize} />
								<span className="whitespace-nowrap">{fmt(s, i)}</span>
							</div>
						)
					})}
				</div>
			)
		}
		return (
			<div className="flex flex-col gap-1">
				{stops.map((s, i) => {
					const entry = buildEntry(String(s))
					return (
						<div key={s} className="flex items-center gap-2">
							<ComposedSwatch {...entry} swatchShape={swatchShape} swatchSize={swatchSize} />
							<span className="min-w-0 truncate">{fmt(s, i)}</span>
						</div>
					)
				})}
			</div>
		)
	}

	const rawUnique = orderCategories(uniqueValues(values, type), type, pinnedOrder)
	const unique = reverseCategorical ? [...rawUnique].reverse() : rawUnique
	// When area sizes the swatches, their SVG widths vary by category, which
	// would ragged-left the labels in a stacked list. Reserve a fixed column
	// (the widest swatch) and center each swatch in it so labels align.
	const areaSwatchColWidth = areaSizeScale
		? Math.max(
				16,
				(Math.max(...unique.map((v) => areaRadiusFor(v) ?? 5)) + 3) * 2,
			)
		: null
	if (orientation === "horizontal") {
		return (
			<div className="flex flex-row flex-nowrap items-center gap-3">
				{unique.map((v) => {
					const entry = buildEntry(v)
					return (
						<EntryHoverWrap key={v} field={highlightField} value={v}>
							<div className="flex flex-shrink-0 flex-row items-center gap-1.5">
								<ComposedSwatch {...entry} swatchShape={swatchShape} swatchSize={swatchSize} />
								<span className="whitespace-nowrap" title={v}>
									{v}
								</span>
							</div>
						</EntryHoverWrap>
					)
				})}
			</div>
		)
	}
	return renderEntryList(
		unique.map((v) => {
			const entry = buildEntry(v)
			const swatch = (
				<ComposedSwatch {...entry} swatchShape={swatchShape} swatchSize={swatchSize} />
			)
			return (
				<EntryHoverWrap key={v} field={highlightField} value={v}>
					<div className="flex items-center gap-2">
						{areaSwatchColWidth != null ? (
							<div
								className="flex flex-shrink-0 justify-center"
								style={{ width: areaSwatchColWidth }}
							>
								{swatch}
							</div>
						) : (
							swatch
						)}
						<span className="min-w-0 truncate" title={v}>
							{v}
						</span>
					</div>
				</EntryHoverWrap>
			)
		}),
		entryColumns,
	)
}

const HueLegend = ({
	type,
	values,
	configs,
	pinnedOrder,
	reverseCategorical,
	gradientLegendStyle = "bar",
	gradientBarStyle = DEFAULT_GRADIENT_BAR_STYLE,
	orientation = "vertical",
	channelCfg,
	splitOutline,
	swatchShape,
	swatchSize,
	swatchOutline = null,
	defaultSwatchOpacity = 1,
	entryColumns,
	highlightField,
}: ReversibleLegendProps & {
	gradientLegendStyle?: "bar" | "swatches"
	/** Resolved gradient-bar display options (length / radius / ticks /
	 * label alignment). Only consulted when the bar branch fires. */
	gradientBarStyle?: GradientBarStyle
	orientation?: "vertical" | "horizontal"
	/** User-chosen outline drawn around every color swatch (the Legend panel's
	 *  "Swatch outline" controls). Applies only where no encoded stroke (the
	 *  area/radar `splitOutline`) already claims the border. `null` = none. */
	swatchOutline?: { color: string; width: number } | null
	/** Opacity for swatch graphics, matching marks at the global default
	 *  opacity when opacity isn't encoded. */
	defaultSwatchOpacity?: number
	/** `SHAPE_PALETTE` index to draw for each swatch instead of the
	 *  default rectangle. `null` / undefined keeps the rectangle. */
	swatchShape?: LegendSwatchShape
	/** Symbol radius (px) for the swatch shape. `null` / undefined → 5. */
	swatchSize?: number | null
	/** Area + radar charts pass the line/outline palette so each
	 *  categorical swatch can draw a border in the matching stroke color.
	 *  `null` (non area/radar modes) → no border, identical to the old
	 *  fill-only swatches. */
	splitOutline?: {
		linePalette: ReadonlyArray<string> | null
		lineColors: Record<string, string>
		/** Global outline color (`connection.strokeColor`) — the renderer's
		 *  stroke fallback after per-value overrides and the line palette. */
		strokeOverride: string | null
	} | null
}) => {
	const merged = resolveLegendChannelConfig(channelCfg)
	const domain = resolveLegendDomain(values, type, channelCfg) ?? undefined
	const scale = makeHueScale(
		values,
		type,
		configs.hue,
		type === "ordinal"
			? (configs.ordinalPalette ?? configs.categoricalPalette)
			: configs.categoricalPalette,
		domain,
	)
	if (scale.kind === "categorical") {
		// `raw` stays in discovery order so `strokeFor` indexes the line
		// palette against the renderer's group iteration; only the displayed
		// order follows the user's pinned field ordering.
		const raw = uniqueValues(values, type)
		const ordered = orderCategories(raw, type, pinnedOrder)
		const unique = reverseCategorical ? [...ordered].reverse() : ordered
		// Stroke resolution per category — matches AreaPlot/RadarPlot's
		// layer-stroke chain: per-value override → palette by index →
		// fall back to fill (returns null when fill = stroke so no
		// border is drawn).
		const strokeFor = (v: string, _i: number, fill: string): string | null => {
			if (!splitOutline) return null
			const override = splitOutline.lineColors[v]
			if (override) return override === fill ? null : override
			const palette = splitOutline.linePalette
			if (palette && palette.length > 0) {
				// Index against the original (pre-reverse) order so palette
				// position lines up with the renderer's group iteration.
				const origIdx = raw.indexOf(v)
				const paletteColor = palette[origIdx % palette.length]
				if (paletteColor) return paletteColor === fill ? null : paletteColor
			}
			// Global outline color (matches AreaPlot/RadarPlot's `strokeColor`
			// fallback). Without this, an area whose lines use one outline color
			// set globally showed no border in the legend.
			const globalStroke = splitOutline.strokeOverride
			if (globalStroke) return globalStroke === fill ? null : globalStroke
			return null
		}
		if (orientation === "horizontal") {
			return (
				<div className="flex flex-row flex-nowrap items-center gap-3">
					{unique.map((v, i) => {
						const c = applyHueScale(scale, v, type) ?? "#888"
						const split = strokeFor(v, i, c)
						return (
							<EntryHoverWrap key={v} field={highlightField} value={v}>
								<Swatch
									color={c}
									strokeColor={split ?? swatchOutline?.color}
									strokeWidth={split ? undefined : swatchOutline?.width}
									shape={swatchShape}
									size={swatchSize}
									opacity={defaultSwatchOpacity}
									horizontal
								>
									{v}
								</Swatch>
							</EntryHoverWrap>
						)
					})}
				</div>
			)
		}
		return renderEntryList(
			unique.map((v, i) => {
				const c = applyHueScale(scale, v, type) ?? "#888"
				const split = strokeFor(v, i, c)
				return (
					<EntryHoverWrap key={v} field={highlightField} value={v}>
						<Swatch
							color={c}
							strokeColor={split ?? swatchOutline?.color}
							strokeWidth={split ? undefined : swatchOutline?.width}
							shape={swatchShape}
							size={swatchSize}
							opacity={defaultSwatchOpacity}
						>
							{v}
						</Swatch>
					</EntryHoverWrap>
				)
			}),
			entryColumns,
		)
	}
	// Quantitative gradient. Break values come from the merged channel
	// config — either the user's custom list or `breakCount` evenly spaced
	// across the data extent (or user-supplied domain if set).
	const breaks = resolveLegendBreaks(values, type, channelCfg, 5, 2)
	const lo = breaks[0]
	const hi = breaks.at(-1)
	if (lo === undefined || hi === undefined) return null
	const dataExt = legendDataExtent(values, type)
	const customFmt = buildLegendFormatter(merged.format)
	const fallbackFmt = (n: number) =>
		type === "temporal"
			? new Date(n).toLocaleDateString()
			: Number.isFinite(n)
				? n.toFixed(2)
				: String(n)
	const fmt = customFmt ?? fallbackFmt
	// When the user's chosen top break sits below the data max, append a
	// "+" to that label — signals "this value or higher, all the same
	// color" (matches the clamp-out-of-range behavior).
	const labelAt = (v: number, i: number) =>
		decorateOpenEndLabel(fmt(v), i, breaks, dataExt)
	if (gradientLegendStyle === "swatches") {
		if (orientation === "horizontal") {
			return (
				<div className="flex flex-row flex-nowrap items-center gap-3">
					{breaks.map((v, i) => (
						<Swatch
							key={v}
							color={applyHueScale(scale, v, type) ?? "#888"}
							strokeColor={swatchOutline?.color}
							strokeWidth={swatchOutline?.width}
							shape={swatchShape}
							size={swatchSize}
							opacity={defaultSwatchOpacity}
							horizontal
						>
							{labelAt(v, i)}
						</Swatch>
					))}
				</div>
			)
		}
		return (
			<div className="flex flex-col gap-1">
				{breaks.map((v, i) => (
					<Swatch
						key={v}
						color={applyHueScale(scale, v, type) ?? "#888"}
						strokeColor={swatchOutline?.color}
						strokeWidth={swatchOutline?.width}
						shape={swatchShape}
						size={swatchSize}
						opacity={defaultSwatchOpacity}
					>
						{labelAt(v, i)}
					</Swatch>
				))}
			</div>
		)
	}
	// Gradient bar: sample colors at each break and emit one stop per break
	// (so the visual gradient transitions are evenly spaced even when the
	// breaks aren't — matches the user's mental model of "this band of
	// color spans from break N to break N+1"). Labels render at the same
	// proportional positions as the break stops.
	const gradientStops = breaks.map((v, i) => ({
		t: (v - lo) / (hi - lo || 1),
		color: applyHueScale(scale, v, type) ?? "#888",
		label: labelAt(v, i),
		key: i,
	}))
	return (
		<GradientBarRamp
			stops={gradientStops}
			cssStops={sampleRampCssStops(scale, lo, hi, type)}
			orientation={orientation}
			barStyle={gradientBarStyle}
		/>
	)
}

export const ShapeLegend = ({
	type,
	values,
	configs,
	pinnedOrder,
	legendFillColor,
	legendStrokeColor,
	orientation = "vertical",
	defaultSwatchOpacity = 1,
	entryColumns,
}: LegendProps & {
	legendFillColor: string | null | undefined
	legendStrokeColor: string | null | undefined
	defaultSwatchOpacity?: number
}) => {
	const unique = orderCategories(uniqueValues(values, type), type, pinnedOrder)
	const indexer = makeShapeIndexer(values, type, configs.shape)
	const outlineColor =
		configs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor
	const fillOverrides = configs.shape?.fillOverrides ?? {}
	const strokeOverrides = configs.shape?.strokeOverrides ?? {}
	// Fallback fill/stroke for the legend swatches. The legend doesn't
	// know which hue color to inherit when shape and hue encode different
	// fields (no single answer), so we read a user-set legend-level color
	// or fall back to a default.
	//
	// Default fill is NEUTRAL LIGHT GRAY (#9ca3af, ~Tailwind gray-400).
	// The historic default was a light blue (#4f8eda) which made the
	// legend look like the shape was encoding a color, even when no hue
	// channel was mapped — a neutral default makes the lack of a color
	// encoding visually obvious.
	//
	// Default stroke is a DARK contrast (#1f2937). The chart's
	// `outlineColor` defaults to "#ffffff" (white) so chart marks contrast
	// against colored fills, but a white stroke against a white legend
	// background disappears entirely — that was a separate bug.
	const fallbackFill = legendFillColor ?? "#9ca3af"
	const fallbackStroke = legendStrokeColor ?? "#1f2937"
	void outlineColor
	const isHorizontal = orientation === "horizontal"
	const cellClass = isHorizontal
		? "flex flex-shrink-0 items-center gap-1.5"
		: "flex items-center gap-2"
	const labelClass = isHorizontal ? "whitespace-nowrap" : "min-w-0 truncate"
	const rows = unique.map((v) => {
		const idx = indexer(v)
		const fillOverride = fillOverrides[v]
		const fill =
			fillOverride === "none" ? "none" : (fillOverride ?? fallbackFill)
		const stroke = strokeOverrides[v] ?? fallbackStroke
		return (
			<div key={v} className={cellClass}>
				<svg
					width={16}
					height={16}
					viewBox="-8 -8 16 16"
					aria-hidden="true"
					className="flex-shrink-0"
				>
					<path
						d={symbolPath(idx, 5)}
						fill={fill}
						fillOpacity={fill === "none" ? 0 : defaultSwatchOpacity}
						stroke={stroke}
						strokeWidth={1}
					/>
				</svg>
				<span className={labelClass} title={v}>
					{v}
				</span>
			</div>
		)
	})
	return isHorizontal ? (
		<div className="flex flex-row flex-nowrap items-center gap-3">{rows}</div>
	) : (
		renderEntryList(rows, entryColumns)
	)
}

const PatternLegend = ({
	type,
	values,
	configs,
	pinnedOrder,
	reverseCategorical,
	orientation = "vertical",
	defaultSwatchOpacity = 1,
	entryColumns,
}: ReversibleLegendProps & { defaultSwatchOpacity?: number }) => {
	const rawCategories = patternCategoriesFor(values, type)
	// Preserve the original palette index so colors/patterns stay stable even
	// when we reorder (pinned field order) or reverse the display order.
	const entries = orderCategories(rawCategories, type, pinnedOrder).map((v) => ({
		v,
		i: rawCategories.indexOf(v),
	}))
	const display = reverseCategorical ? [...entries].reverse() : entries
	const bgColor = configs.pattern?.backgroundColor ?? "#e2e8f0"
	const isHorizontal = orientation === "horizontal"
	const cellClass = isHorizontal
		? "flex flex-shrink-0 items-center gap-1.5"
		: "flex items-center gap-2"
	const labelClass = isHorizontal ? "whitespace-nowrap" : "min-w-0 truncate"
	const rows = display.map(({ v, i }) => {
				const resolved = resolvePatternForCategory(
					v,
					i,
					configs.pattern,
					bgColor
				)
				// When the category is opted out via PATTERN_NONE, render a plain
				// background-colored swatch (no pattern overlay) so the legend
				// matches what the chart draws.
				if (resolved === null) {
					return (
						<div key={v} className={cellClass}>
							<svg
								width={20}
								height={14}
								aria-hidden="true"
								className="flex-shrink-0"
								opacity={defaultSwatchOpacity}
							>
								<rect
									x={0}
									y={0}
									width={20}
									height={14}
									fill={bgColor}
									stroke={LEGEND_SWATCH_OUTLINE}
									strokeWidth={0.5}
								/>
							</svg>
							<span className={labelClass} title={v}>
								{v}
							</span>
						</div>
					)
				}
				const { paletteIdx, inkColor, svgId } = resolved
				const def = PATTERN_PALETTE[paletteIdx % PATTERN_PALETTE.length]
				const patId = `legend-${svgId}`
				return (
					<div key={v} className={cellClass}>
						<svg
							width={20}
							height={14}
							aria-hidden="true"
							className="flex-shrink-0"
							opacity={defaultSwatchOpacity}
						>
							<defs>
								<pattern
									key={patId}
									id={patId}
									patternUnits="userSpaceOnUse"
									width={def.size}
									height={def.size}
								>
									<rect
										x={0}
										y={0}
										width={def.size}
										height={def.size}
										fill={bgColor}
									/>
									{def.render(inkColor)}
								</pattern>
							</defs>
							<rect
								x={0}
								y={0}
								width={20}
								height={14}
								fill={`url(#${patId})`}
								stroke={LEGEND_SWATCH_OUTLINE}
								strokeWidth={0.5}
							/>
						</svg>
						<span className={labelClass} title={v}>
							{v}
						</span>
					</div>
				)
			})
	return isHorizontal ? (
		<div className="flex flex-row flex-nowrap items-center gap-3">{rows}</div>
	) : (
		renderEntryList(rows, entryColumns)
	)
}

export const AreaLegend = ({
	type,
	values,
	configs,
	channelCfg,
	swatchColor,
	swatchStroke,
	orientation = "vertical",
	defaultSwatchOpacity = 1,
	proportionalSizeExponent,
}: LegendProps & {
	defaultSwatchOpacity?: number
	/** Hierarchy modes: swatch radii mirror the layout's TRUE proportions —
	 * zero-anchored value^exponent scaled so the largest break fills the
	 * maxRadius budget — instead of the min→max px range mapping (which
	 * stretches a narrow data range across the full swatch ramp and
	 * promises size differences the chart correctly refuses to draw).
	 * `0.5` = area-true (√); `1` = packed circles' Scale-by-diameter.
	 * Undefined = the historical range mapping (bubble charts, where the
	 * marks themselves use it). Computed by the parent, which knows the
	 * mode. */
	proportionalSizeExponent?: number
}) => {
	const merged = resolveLegendChannelConfig(channelCfg)
	const domain = resolveLegendDomain(values, type, channelCfg) ?? undefined
	const dataExt = legendDataExtent(values, type)
	const scale =
		proportionalSizeExponent !== undefined
			? ({
					kind: "numeric" as const,
					scale: scalePow()
						.exponent(proportionalSizeExponent)
						.domain([0, domain?.[1] ?? dataExt?.[1] ?? 1])
						.range([
							0,
							configs.area?.maxRadius ?? DEFAULT_AREA_CONFIG.maxRadius,
						])
						.clamp(true),
				} satisfies ReturnType<typeof makeAreaScale>)
			: makeAreaScale(values, type, configs.area, domain)
	const color = swatchColor ?? "#4f8eda"
	const stroke = swatchStroke ?? "#ffffff"
	// Each swatch to draw: its radius + its label. Numeric fields sample
	// value breaks; a NON-numeric ordinal draws one swatch per category
	// (sized by the category's rank), so the size key reads the same way the
	// per-category sidebar editor does.
	const ordinalCats = type === "ordinal" ? ordinalAreaCategories(values) : null
	let entries: Array<{ key: string; label: string; r: number }>
	if (ordinalCats) {
		entries = ordinalCats.map((c) => ({
			key: c,
			label: c,
			r: applyAreaScale(scale, c, type) ?? 4,
		}))
	} else {
		// Size legends historically showed 3 stops (lo/mid/hi); keep that as the
		// floor so a user typing breakCount=1 doesn't degenerate to a single
		// circle that reads as "show all marks at one size".
		const breaks = resolveLegendBreaks(values, type, channelCfg, 3, 3)
		if (breaks.length === 0) return null
		const customFmt = buildLegendFormatter(merged.format)
		const fmt =
			customFmt ?? ((n: number) => (Number.isFinite(n) ? n.toFixed(2) : ""))
		entries = breaks.map((s, i) => ({
			key: String(s),
			label: decorateOpenEndLabel(fmt(s), i, breaks, dataExt),
			r: applyAreaScale(scale, s, type) ?? 4,
		}))
	}
	if (entries.length === 0) return null
	const maxR = entries.reduce((m, e) => Math.max(m, e.r), 4)
	const colWidth = Math.max(24, Math.ceil(maxR * 2) + 4)
	if (orientation === "horizontal") {
		// Single row of swatches, NO wrap. The legend's outer container
		// expands to accommodate; horizontal layouts get a long row, not
		// a wrapped grid.
		return (
			<div className="flex flex-row flex-nowrap items-end gap-3">
				{entries.map((e) => (
					<div
						key={e.key}
						className="flex flex-shrink-0 flex-col items-center gap-1"
					>
						<svg
							width={Math.max(24, e.r * 2 + 4)}
							height={Math.max(24, e.r * 2 + 4)}
							aria-hidden="true"
						>
							<circle
								cx={Math.max(12, e.r + 2)}
								cy={Math.max(12, e.r + 2)}
								r={e.r}
								fill={color}
								fillOpacity={0.8 * defaultSwatchOpacity}
								stroke={stroke}
							/>
						</svg>
						<span>{e.label}</span>
					</div>
				))}
			</div>
		)
	}
	// Vertical (stacked): one swatch per row, label sits to the right.
	// All circles share the same SVG width so labels align in a column.
	return (
		<div className="flex flex-col gap-1">
			{entries.map((e) => {
				const rowH = Math.max(24, Math.ceil(e.r * 2) + 4)
				return (
					<div key={e.key} className="flex items-center gap-2">
						<svg
							width={colWidth}
							height={rowH}
							aria-hidden="true"
							className="flex-shrink-0"
						>
							<circle
								cx={colWidth / 2}
								cy={rowH / 2}
								r={e.r}
								fill={color}
								fillOpacity={0.8 * defaultSwatchOpacity}
								stroke={stroke}
							/>
						</svg>
						<span className="min-w-0 truncate">{e.label}</span>
					</div>
				)
			})}
		</div>
	)
}

const OpacityLegend = ({
	type,
	values,
	configs,
	pinnedOrder,
	reverseCategorical,
	channelCfg,
	swatchColor,
	entryColumns,
}: ReversibleLegendProps) => {
	const merged = resolveLegendChannelConfig(channelCfg)
	const isQuantitative = type === "quantitative" || type === "temporal"
	const domain = isQuantitative
		? (resolveLegendDomain(values, type, channelCfg) ?? undefined)
		: undefined
	const scale = makeOpacityScale(values, type, configs.opacity, domain)
	const swatchHex = swatchColor ?? "#4f8eda"
	// Resolve the swatch color to its r/g/b channels once so the per-stop
	// gradient string can interpolate opacity without re-parsing each time.
	const swatchRgb = d3Rgb(swatchHex)
	const rgbTriple = swatchRgb && !Number.isNaN(swatchRgb.r)
		? `${swatchRgb.r}, ${swatchRgb.g}, ${swatchRgb.b}`
		: "79, 142, 218"
	if (!isQuantitative) {
		const raw = orderCategories(uniqueValues(values, type), type, pinnedOrder)
		const unique = reverseCategorical ? [...raw].reverse() : raw
		return renderEntryList(
			unique.map((v) => {
				const o = scale(v) ?? 1
				return (
					<div key={v} className="flex items-center gap-2">
						<span
							className="block h-3 w-4 rounded-sm"
							style={{ backgroundColor: swatchHex, opacity: o }}
						/>
						<span className="min-w-0 truncate" title={v}>
							{v} ({o.toFixed(2)})
						</span>
					</div>
				)
			}),
			entryColumns,
		)
	}
	const breaks = resolveLegendBreaks(values, type, channelCfg, 5, 2)
	const lo = breaks[0]
	const hi = breaks.at(-1)
	if (lo === undefined || hi === undefined) return null
	const dataExt = legendDataExtent(values, type)
	const customFmt = buildLegendFormatter(merged.format)
	const fallbackFmt = (n: number) =>
		type === "temporal" ? new Date(n).toLocaleDateString() : n.toFixed(2)
	const fmt = customFmt ?? fallbackFmt
	const gradientStops = breaks.map((v, i) => {
		const t = (v - lo) / (hi - lo || 1)
		return {
			t,
			opacity: scale(v) ?? 1,
			label: decorateOpenEndLabel(fmt(v), i, breaks, dataExt),
			i,
		}
	})
	const gradientCss = `linear-gradient(to right, ${gradientStops
		.map((s) => `rgba(${rgbTriple}, ${s.opacity}) ${s.t * 100}%`)
		.join(", ")})`
	return (
		<div className="flex flex-col gap-1">
			<div className="h-3 rounded-sm" style={{ background: gradientCss }} />
			<div className="relative h-5 w-full">
				{gradientStops.map((s) => (
					<span
						key={s.i}
						className="absolute -translate-x-1/2"
						style={{ left: `${s.t * 100}%` }}
					>
						{s.label}
					</span>
				))}
			</div>
		</div>
	)
}

const LengthLegend = ({
	type,
	values,
	configs,
	pinnedOrder,
	channelCfg,
	swatchColor,
	orientation = "vertical",
}: LegendProps) => {
	const merged = resolveLegendChannelConfig(channelCfg)
	const domain = resolveLegendDomain(values, type, channelCfg) ?? undefined
	const scale = makeLengthScale(values, type, configs.length, domain)
	const color = swatchColor ?? "#4f8eda"
	// Categorical / ordinal length: one swatch per unique category, sized
	// by the length scale (which distributes evenly across categories).
	if (type === "categorical" || type === "ordinal") {
		const unique = orderCategories(uniqueValues(values, type), type, pinnedOrder)
		if (unique.length === 0) return null
		// Pin every row to the max swatch width so labels line up in a
		// consistent column (per-row sizing pushes long-segment rows'
		// labels past the legend's width budget and triggers truncation).
		const maxLen = unique.reduce((m, v) => Math.max(m, scale(v) ?? 10), 0)
		const svgWidth = Math.max(24, maxLen + 4)
		return (
			<div className="flex flex-col gap-1">
				{unique.map((v) => {
					const len = scale(v) ?? 10
					return (
						<div key={v} className="flex items-center gap-2">
							<svg
								width={svgWidth}
								height={8}
								aria-hidden="true"
								className="flex-shrink-0"
							>
								<line
									x1={2}
									y1={4}
									x2={2 + len}
									y2={4}
									stroke={color}
									strokeWidth={3}
									strokeLinecap="round"
								/>
							</svg>
							<span className="min-w-0 truncate" title={v}>
								{v}
							</span>
						</div>
					)
				})}
			</div>
		)
	}
	const breaks = resolveLegendBreaks(values, type, channelCfg, 3, 3)
	if (breaks.length === 0) return null
	const dataExt = legendDataExtent(values, type)
	const customFmt = buildLegendFormatter(merged.format)
	const fmt = customFmt ?? ((n: number) => (Number.isFinite(n) ? n.toFixed(1) : ""))
	const maxBreakLen = breaks.reduce((m, s) => Math.max(m, scale(s) ?? 10), 0)
	const svgWidth = Math.max(24, maxBreakLen + 4)
	if (orientation === "horizontal") {
		return (
			<div className="flex flex-row flex-nowrap items-end gap-3">
				{breaks.map((s, i) => {
					const len = scale(s) ?? 10
					return (
						<div
							key={s}
							className="flex flex-shrink-0 flex-col items-center gap-1"
						>
							<svg width={svgWidth} height={8} aria-hidden="true">
								<line
									x1={2}
									y1={4}
									x2={2 + len}
									y2={4}
									stroke={color}
									strokeWidth={3}
									strokeLinecap="round"
								/>
							</svg>
							<span>{decorateOpenEndLabel(fmt(s), i, breaks, dataExt)}</span>
						</div>
					)
				})}
			</div>
		)
	}
	// Vertical (stacked): label sits to the right of each segment.
	return (
		<div className="flex flex-col gap-1">
			{breaks.map((s, i) => {
				const len = scale(s) ?? 10
				return (
					<div key={s} className="flex items-center gap-2">
						<svg
							width={svgWidth}
							height={8}
							aria-hidden="true"
							className="flex-shrink-0"
						>
							<line
								x1={2}
								y1={4}
								x2={2 + len}
								y2={4}
								stroke={color}
								strokeWidth={3}
								strokeLinecap="round"
							/>
						</svg>
						<span className="min-w-0 truncate">
							{decorateOpenEndLabel(fmt(s), i, breaks, dataExt)}
						</span>
					</div>
				)
			})}
		</div>
	)
}

const AngleLegend = ({
	type,
	values,
	configs,
	pinnedOrder,
	channelCfg,
	swatchColor,
	orientation = "vertical",
}: LegendProps) => {
	const merged = resolveLegendChannelConfig(channelCfg)
	const domain = resolveLegendDomain(values, type, channelCfg) ?? undefined
	const scale = makeAngleScale(values, type, configs.angle, domain)
	const color = swatchColor ?? "#4f8eda"
	// Categorical / ordinal angle: one swatch per category, rotated by the
	// angle scale (which evenly distributes categories across the range).
	if (type === "categorical" || type === "ordinal") {
		const unique = orderCategories(uniqueValues(values, type), type, pinnedOrder)
		if (unique.length === 0) return null
		const lineLen = 10
		return (
			<div className="flex flex-col gap-1">
				{unique.map((v) => {
					const rad = scale(v) ?? 0
					const dx = Math.cos(rad) * lineLen
					const dy = Math.sin(rad) * lineLen
					return (
						<div key={v} className="flex items-center gap-2">
							<svg width={24} height={24} aria-hidden="true">
								<line
									x1={12 - dx}
									y1={12 + dy}
									x2={12 + dx}
									y2={12 - dy}
									stroke={color}
									strokeWidth={2}
									strokeLinecap="round"
								/>
							</svg>
							<span className="min-w-0 truncate" title={v}>
								{v}
							</span>
						</div>
					)
				})}
			</div>
		)
	}
	const breaks = resolveLegendBreaks(values, type, channelCfg, 3, 3)
	if (breaks.length === 0) return null
	const dataExt = legendDataExtent(values, type)
	const customFmt = buildLegendFormatter(merged.format)
	const lineLen = 10
	const angleSvgFor = (s: number) => {
		const rad = scale(s) ?? 0
		const dx = Math.cos(rad) * lineLen
		const dy = Math.sin(rad) * lineLen
		// Default angle label is the resolved degrees, not the raw input
		// value — degrees are what the swatch actually shows so the label
		// reading "0°", "45°", "90°" matches the rotation visually. Users
		// who want raw-value labels can pick a custom d3-format and the
		// raw break value is fed through it instead.
		const rawLabel = customFmt
			? customFmt(s)
			: Number.isFinite(s)
				? `${((rad * 180) / Math.PI).toFixed(0)}°`
				: ""
		return { dx, dy, rawLabel }
	}
	if (orientation === "horizontal") {
		return (
			<div className="flex flex-row flex-nowrap items-end gap-3">
				{breaks.map((s, i) => {
					const { dx, dy, rawLabel } = angleSvgFor(s)
					const label = decorateOpenEndLabel(rawLabel, i, breaks, dataExt)
					return (
						<div
							key={s}
							className="flex flex-shrink-0 flex-col items-center gap-1"
						>
							<svg width={24} height={24} aria-hidden="true">
								<line
									x1={12 - dx}
									y1={12 + dy}
									x2={12 + dx}
									y2={12 - dy}
									stroke={color}
									strokeWidth={2}
									strokeLinecap="round"
								/>
							</svg>
							<span>{label}</span>
						</div>
					)
				})}
			</div>
		)
	}
	return (
		<div className="flex flex-col gap-1">
			{breaks.map((s, i) => {
				const { dx, dy, rawLabel } = angleSvgFor(s)
				const label = decorateOpenEndLabel(rawLabel, i, breaks, dataExt)
				return (
					<div key={s} className="flex items-center gap-2">
						<svg
							width={24}
							height={24}
							aria-hidden="true"
							className="flex-shrink-0"
						>
							<line
								x1={12 - dx}
								y1={12 + dy}
								x2={12 + dx}
								y2={12 - dy}
								stroke={color}
								strokeWidth={2}
								strokeLinecap="round"
							/>
						</svg>
						<span className="min-w-0 truncate">{label}</span>
					</div>
				)
			})}
		</div>
	)
}
