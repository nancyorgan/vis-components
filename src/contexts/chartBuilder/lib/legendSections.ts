import type { CSSProperties } from "react"
import type { ChannelConfigs, ColorSlotKey } from "./channelConfig"
import { densityCurveGroupField, densityCurveOn } from "./colorSlots"
import { flowNodeNames, resolveFlowEndpoints } from "./buildFlowGraph"
import { isFlowModeId } from "./packedMeasure"
import { LEGEND_CANDIDATE_CHANNELS } from "./channels"
import type { ChartModeDef } from "./chartModes/types"
import {
	LEGEND_FRIENDLY_NAME,
	legendFontKey,
	type LabelsConfig,
	type LegendChannel,
	type LegendConfig,
	QUANTITATIVE_LEGEND_CHANNELS,
	type QuantitativeLegendChannel,
	resolveLegendTextFont,
	resolveTitleFont,
	type TextFontConfig,
} from "./labelsConfig"
import { histogramMeasureDomain } from "./histogramBins"
import { resolveHistogramMeasure } from "./histogramMeasure"
import { DEFAULT_HEXBIN_BIN_COUNT, resolveHexbinCells } from "./hexbins"
import { HEXBIN_COUNT_LABEL, hexbinEligible } from "./hexbinMeasure"
import {
	buildLegendFormatter,
	decorateOpenEndLabel,
	legendDataExtent,
	resolveLegendBreaks,
	resolveLegendChannelConfig,
	resolveLegendDomain,
} from "./legendBreaks"
import { BASE_MARGIN, subtitleReserve, titleReserve } from "./plotLayout"
import {
	applyAreaScale,
	applyHueScale,
	makeAreaScale,
	makeLengthScale,
	parseValue,
} from "./scales"
import type { HueScale } from "./scales"
import { applyLevelOrder } from "./smartSort"
import type { DatasetView, EncodingChannel, Encodings, FieldType } from "./types"

const effectiveType = (
	inferred: FieldType | undefined,
	override: FieldType | undefined
): FieldType => override ?? inferred ?? "categorical"

export const uniqueValues = (
	values: unknown[],
	type: FieldType
): string[] => [
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
export const orderCategories = (
	discovered: string[],
	type: FieldType,
	pinnedOrder: readonly string[] | undefined
): string[] =>
	pinnedOrder && pinnedOrder.length > 0
		? applyLevelOrder(discovered, type, pinnedOrder)
		: discovered

/** Split `items` into `cols` balanced, contiguous groups (reading order
 * preserved: fill column 1 top-to-bottom, then column 2, …). Column sizes
 * differ by at most one so the columns end up roughly the same height. */
export const chunkColumns = <T,>(items: T[], cols: number): T[][] => {
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

/** Densely-sampled stops for the bar's CSS gradient. CSS blends between
 * `linear-gradient` stops in sRGB, so emitting a stop only at each break
 * misdraws any scale that doesn't blend in sRGB between breaks — custom
 * gradients set to HSB/OKLCH interpolation, preset ramps like viridis,
 * pinned custom stops sitting between breaks. 32 samples make the CSS
 * approximation visually indistinguishable from the true ramp. Ticks and
 * labels keep rendering from the break stops. */
export const sampleRampCssStops = (
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
export type GroupChannel = (typeof GROUP_CHANNELS)[number]

export type SingleSection = {
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
export type CombinedSection = {
	kind: "combined"
	channels: ReadonlyArray<GroupChannel>
	field: string
	type: FieldType
	values: unknown[]
	/** Channel whose legend-title / font override drives this section's
	 * header. Defaults to the leading group channel; set explicitly when a
	 * shared-field group is split or when only a non-leading channel is
	 * titled. */
	titleChannel?: GroupChannel
}
/** A color slot (e.g. the rug) mapped to a field. Slots live outside the
 * encodings map, so they're built separately and rendered as a categorical
 * color legend using the slot's own palette. */
export type SlotSection = {
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
export type SectionInfo = SingleSection | CombinedSection | SlotSection

export type PlanLegendSectionsInput = {
	encodings: Encodings
	configs: ChannelConfigs
	dataset: DatasetView
	overrides: Record<string, FieldType>
	labels: LabelsConfig
	/** The legend config with `hidden` already folded through
	 *  `resolveLegendHidden` (mode-aware defaults). */
	legendCfg: LegendConfig
	modeDef: ChartModeDef
	insideExtras: { top: number; right: number; bottom: number; left: number }
}

export type LegendPlan = {
	sections: SectionInfo[]
	textFont: TextFontConfig
	outerClass: string
	outerStyle: CSSProperties | undefined
	innerClass: string
	innerStyle: CSSProperties
	sectionLayoutClass: string
	columnsApply: boolean
	packSections: boolean
	effectiveCols: number
	entryColumns: number
}

/** Pure section planning + legend-box sizing for the `Legend` component.
 *  Walks the encodings, colors slots, and synthetic measure sources into the
 *  ordered `SectionInfo[]` the legend renders, then derives the outer/inner
 *  box classes and styles (width budget, column packing, position offsets).
 *  Returns `null` when no section ends up visible. */
export const planLegendSections = ({
	encodings,
	configs,
	dataset,
	overrides,
	labels,
	legendCfg,
	modeDef,
	insideExtras,
}: PlanLegendSectionsInput): LegendPlan | null => {
	const hideLength = modeDef.legend.hideLengthInThisMode
	const hideAngle = modeDef.legend.hideAngleInThisMode

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
	const rugVisible = (c: ChannelConfigs["x"]): boolean =>
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
	const bodyStyle: CSSProperties = {
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
	const insideStyle = (): CSSProperties => {
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
	const outerStyle: CSSProperties | undefined = isInside
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
	const innerStyle: CSSProperties = {
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

	return {
		sections,
		textFont,
		outerClass,
		outerStyle,
		innerClass,
		innerStyle,
		sectionLayoutClass,
		columnsApply,
		packSections,
		effectiveCols,
		entryColumns,
	}
}
