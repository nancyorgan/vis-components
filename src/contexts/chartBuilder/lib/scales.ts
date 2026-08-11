import { extent } from "d3-array"
import { hsl } from "d3-color"
import {
	type scaleBand,
	scaleDiverging,
	scaleLinear,
	scaleOrdinal,
	scalePoint,
	scalePow,
	scaleSequential,
	scaleSqrt,
	scaleTime,
} from "d3-scale"
import {
	interpolateBlues,
	interpolateBrBG,
	interpolateInferno,
	interpolateMagma,
	interpolatePiYG,
	interpolatePlasma,
	interpolatePRGn,
	interpolatePuOr,
	interpolateRdBu,
	interpolateRdYlBu,
	interpolateSpectral,
	interpolateViridis,
} from "d3-scale-chromatic"

// RColorBrewer Set3 — 12-color qualitative palette.
export const CATEGORICAL_HUE_PALETTE: readonly string[] = [
	"#8DD3C7",
	"#FFFFB3",
	"#BEBADA",
	"#FB8072",
	"#80B1D3",
	"#FDB462",
	"#B3DE69",
	"#FCCDE5",
	"#D9D9D9",
	"#BC80BD",
	"#CCEBC5",
	"#FFED6F",
]
import {
	symbol,
	symbolCircle,
	symbolCross,
	symbolDiamond,
	symbolSquare,
	symbolStar,
	symbolTriangle,
} from "d3-shape"

import type {
	AreaConfig,
	BrightnessConfig,
	HueConfig,
	OpacityConfig,
	PaletteName,
	PatternConfig,
	SaturationConfig,
	ShapeConfig,
} from "./channelConfig"
import {
	DEFAULT_AREA_CONFIG,
	DEFAULT_BRIGHTNESS_CONFIG,
	DEFAULT_OPACITY_QUANTITATIVE,
	DEFAULT_SATURATION_CONFIG,
} from "./channelConfig"
import { gradientInterpolator } from "./colorInterpolate"
import { applyLevelOrder } from "./smartSort"
import type { FieldType } from "./types"

export const PALETTE_INTERPOLATORS: Record<PaletteName, (t: number) => string> = {
	viridis: interpolateViridis,
	plasma: interpolatePlasma,
	inferno: interpolateInferno,
	magma: interpolateMagma,
	blues: interpolateBlues,
	BrBG: interpolateBrBG,
	PiYG: interpolatePiYG,
	PRGn: interpolatePRGn,
	PuOr: interpolatePuOr,
	RdBu: interpolateRdBu,
	RdYlBu: interpolateRdYlBu,
	Spectral: interpolateSpectral,
}

/** Diverging d3 presets — three-anchor palettes whose midpoint is a
 * meaningful neutral. When the data spans 0 these center at 0 (via
 * scaleDiverging); the hue panel renders them with Low/Mid/High rows. */
export const DIVERGING_PRESET_PALETTES: readonly PaletteName[] = [
	"BrBG",
	"PiYG",
	"PRGn",
	"PuOr",
	"RdBu",
	"RdYlBu",
	"Spectral",
]

/** Auto midpoint for a diverging scale over [lo, hi]: 0 when the data
 * spans it (the conventional diverging center), else the domain midpoint. */
export const autoDivergingMid = (lo: number, hi: number): number =>
	lo < 0 && hi > 0 ? 0 : (lo + hi) / 2

export type ParsedValue = number | Date | string | null

export const parseValue = (raw: unknown, type: FieldType): ParsedValue => {
	if (raw === undefined || raw === null) return null
	const s = String(raw)
	if (s.trim() === "") return null
	if (type === "quantitative") {
		const n = Number(s)
		return Number.isFinite(n) ? n : null
	}
	if (type === "temporal") {
		const d = new Date(s)
		return Number.isNaN(d.getTime()) ? null : d
	}
	// ordinal: try numeric, else string
	if (type === "ordinal") {
		const n = Number(s)
		return Number.isFinite(n) ? n : s
	}
	return s
}

/** Numeric coercion for aggregators. Returns null for missing / blank /
 * non-numeric cells — unlike bare `Number()`, where `Number("")`,
 * `Number("  ")`, and `Number(null)` are all 0, silently turning blank
 * cells into legitimate-looking zeros in sums and means. */
export const parseNumericCell = (raw: unknown): number | null => {
	const v = parseValue(raw, "quantitative")
	return typeof v === "number" ? v : null
}

const isNumericOrdinal = (vals: ParsedValue[]) =>
	vals.every((v) => typeof v === "number")

export type PositionScale =
	| ReturnType<typeof scaleLinear<number, number>>
	| ReturnType<typeof scaleTime<number, number>>
	| ReturnType<typeof scalePoint<string>>
	| ReturnType<typeof scaleBand<string>>

/** When `firstTickPxOffset` is set on a categorical / non-numeric ordinal
 *  scale, this helper insets the range by that many pixels on each end
 *  and switches to `padding(0)`. Net effect: the first AND last ticks
 *  always land at `range_edge ± offset`, regardless of how many domain
 *  values there are. This is what fixes the "title-to-first-tick distance
 *  varies per panel" facet bug (see AUDIT.md P1.6) — under the default
 *  `padding(0.5)`, that distance depends on `plot_area / N`, so any
 *  panel-size variation drifts the offset.
 *
 *  Non-categorical axes are untouched: `firstTickPxOffset` only matters
 *  for scales where d3 places ticks via `padding`. Quantitative / temporal
 *  scales use a continuous domain that anchors naturally. */
const insetRangeForFixedTickOffset = (
	range: [number, number],
	offset: number
): [number, number] => {
	const [r0, r1] = range
	// Range can be reversed (y-axis convention: top-to-bottom, so r0 > r1).
	// Inset INWARD on both ends regardless of direction.
	return r0 > r1 ? [r0 - offset, r1 + offset] : [r0 + offset, r1 - offset]
}

/** Numeric-ordinal axes use a linear scale (so positions still reflect
 *  magnitude), but like categorical axes they should leave a little
 *  breathing room before the first value and after the last instead of
 *  butting them against the plot edges. Inset the range so the data span
 *  doesn't reach the edges: by `firstTickPxOffset` when faceting demands a
 *  fixed offset, otherwise by half a step (`R / 2N`) — matching the outer
 *  padding a `scalePoint` with `padding(0.5)` gives a categorical axis of
 *  N values, so numeric-ordinal and categorical axes pad identically. */
const insetNumericOrdinalRange = (
	range: [number, number],
	distinctCount: number,
	options: MakePositionScaleOptions | undefined
): [number, number] => {
	const offset = options?.firstTickPxOffset
	if (typeof offset === "number" && offset > 0) {
		return insetRangeForFixedTickOffset(range, offset)
	}
	if (distinctCount < 2) return range
	const halfStep = Math.abs(range[1] - range[0]) / (2 * distinctCount)
	return insetRangeForFixedTickOffset(range, halfStep)
}

export type MakePositionScaleOptions = {
	/** Pixel offset from each range edge for the first/last categorical
	 *  tick. When provided, the scale uses `padding(0)` with an insetted
	 *  range so first/last positions are FIXED regardless of N. When
	 *  undefined, the default `padding(0.5)` places ticks at `step/2`
	 *  from each edge (the historical behavior for non-faceted charts). */
	firstTickPxOffset?: number
}

export const makePositionScale = (
	rawValues: unknown[],
	type: FieldType,
	range: [number, number],
	pinnedOrder?: readonly string[],
	options?: MakePositionScaleOptions
): PositionScale => {
	if (type === "quantitative") {
		const nums = rawValues
			.map((v) => parseValue(v, "quantitative"))
			.filter((v): v is number => typeof v === "number")
		const [lo = 0, hi = 1] = extent(nums) as [number, number]
		return scaleLinear().domain([lo, hi]).range(range).nice()
	}
	if (type === "temporal") {
		const dates = rawValues
			.map((v) => parseValue(v, "temporal"))
			.filter((v): v is Date => v instanceof Date)
		const [lo = new Date(0), hi = new Date(1)] = extent(dates) as [Date, Date]
		return scaleTime().domain([lo, hi]).range(range).nice()
	}
	if (type === "ordinal") {
		const parsed = rawValues
			.map((v) => parseValue(v, "ordinal"))
			.filter((v) => v !== null) as Array<number | string>
		if (isNumericOrdinal(parsed)) {
			const nums = parsed as number[]
			const [lo = 0, hi = 1] = extent(nums) as [number, number]
			const insetRange = insetNumericOrdinalRange(
				range,
				new Set(nums).size,
				options
			)
			return scaleLinear().domain([lo, hi]).range(insetRange).nice()
		}
		// Honor the user's pinned ordering; fall back to smart-sort.
		const uniqueStrings = applyLevelOrder(
			[...new Set(parsed.map(String))],
			"ordinal",
			pinnedOrder
		)
		return buildCategoricalScale(uniqueStrings, range, options)
	}
	// categorical — pinned order wins; otherwise discovery order.
	const uniqueStrings = applyLevelOrder(
		[
			...new Set(
				rawValues
					.map((v) => parseValue(v, "categorical"))
					.filter((v): v is string => typeof v === "string")
			),
		],
		"categorical",
		pinnedOrder
	)
	return buildCategoricalScale(uniqueStrings, range, options)
}

/** Replace a position scale's domain with user-supplied bounds. Valid for
 * quantitative (or numeric-ordinal) scales — which use scaleLinear under the
 * hood — and temporal scales (scaleTime), whose domain is a [Date, Date] pair;
 * for temporal axes the bounds arrive as epoch milliseconds and get wrapped
 * back into Dates. Categorical / string-ordinal axes return unchanged. When
 * only one of min/max is set, the other is preserved. `nice()` is
 * intentionally NOT re-applied: user-set bounds should be respected exactly.
 * Used by ScatterPlot and HexbinPlot (whose data-space binning replicates
 * the same domain math — see lib/hexbins.ts). */
export const overrideLinearDomain = (
	scale: PositionScale,
	type: FieldType,
	min: number | undefined,
	max: number | undefined
): PositionScale => {
	if (min === undefined && max === undefined) return scale
	if (type === "temporal") {
		const timeScale = scale as { domain: (d?: [Date, Date]) => unknown }
		const [loCur, hiCur] = (timeScale.domain as () => [Date, Date])()
		timeScale.domain([
			min === undefined ? loCur : new Date(min),
			max === undefined ? hiCur : new Date(max),
		])
		return scale
	}
	if (type !== "quantitative" && type !== "ordinal") return scale
	const linear = scale as { domain: (d?: [number, number]) => unknown }
	const [loCur, hiCur] = (linear.domain as () => [number, number])()
	linear.domain([min ?? loCur, max ?? hiCur])
	return scale
}

/** Construct a scalePoint for a categorical (or string-ordinal) axis.
 *  With `firstTickPxOffset` set, switches from the historical
 *  `padding(0.5)` (first/last at `step/2` from range edges) to a fixed
 *  inset + `padding(0)` (first/last at exact pixel offset from edges).
 *  The fixed variant keeps tick positions stable across panels of
 *  different sizes — see `insetRangeForFixedTickOffset` for the bug
 *  context. */
const buildCategoricalScale = (
	domain: string[],
	range: [number, number],
	options: MakePositionScaleOptions | undefined
): PositionScale => {
	const offset = options?.firstTickPxOffset
	if (typeof offset === "number" && offset > 0) {
		const insetRange = insetRangeForFixedTickOffset(range, offset)
		// d3's scalePoint puts a SINGLE-domain point at the midpoint of
		// its range — not at range[0] as the formula would suggest. That
		// midpoint behavior is what surfaced the facet bug: a one-category
		// panel placed its single category in the middle while multi-
		// category panels placed first/last at the edges. Collapsing the
		// range to a single point (range[0] === range[1]) forces d3 to
		// place the only value at that exact pixel, matching where the
		// first tick of a multi-category panel would land.
		const stableRange: [number, number] =
			domain.length === 1 ? [insetRange[0], insetRange[0]] : insetRange
		return scalePoint<string>().domain(domain).range(stableRange).padding(0)
	}
	return scalePoint<string>().domain(domain).range(range).padding(0.5)
}

export const applyPositionScale = (
	scale: PositionScale,
	raw: unknown,
	type: FieldType
): number | null => {
	const v = parseValue(raw, type)
	if (v === null) return null
	if (
		type === "quantitative" ||
		(type === "ordinal" && typeof v === "number")
	) {
		const linScale = scale as ReturnType<typeof scaleLinear<number, number>>
		return linScale(v as number)
	}
	if (type === "temporal" && v instanceof Date) {
		const timeScale = scale as ReturnType<typeof scaleTime<number, number>>
		return timeScale(v)
	}
	const pointScale = scale as ReturnType<typeof scalePoint<string>>
	const out = pointScale(String(v))
	return out === undefined ? null : out
}

// Area → radius. Quantitative and NUMERIC-ordinal fields drive a continuous
// scalePow (√value keeps circle AREA ∝ value; see `AreaConfig.sizeBy`). A
// NON-numeric ordinal (e.g. low/medium/high) has no meaningful magnitude, so
// instead of coercing every category to 0 and collapsing all marks to the
// default size, it maps each distinct category to a discrete radius — spread
// evenly across [minRadius, maxRadius] through the same area/diameter
// transform, with optional per-category overrides.
export type AreaScale =
	| { kind: "numeric"; scale: ReturnType<typeof scaleSqrt<number, number>> }
	| { kind: "ordinal"; radiusFor: (raw: unknown) => number | null }

/** Distinct categories of a NON-numeric ordinal, in first-seen order — the
 *  exact order `makeAreaScale` spreads them across the radius range. Returns
 *  null when the values are empty or all-numeric (those size continuously
 *  from the value, not by category rank). Shared by the area size legend and
 *  the sidebar per-category editor so both agree on which categories exist
 *  and in what order. */
export const ordinalAreaCategories = (
	rawValues: unknown[],
): string[] | null => {
	const parsed = rawValues
		.map((v) => parseValue(v, "ordinal"))
		.filter((v) => v !== null) as Array<number | string>
	if (parsed.length === 0) return null
	if (parsed.every((v) => typeof v === "number")) return null
	return [...new Set(parsed.map(String))]
}

export const makeAreaScale = (
	rawValues: unknown[],
	type: FieldType,
	config: AreaConfig = DEFAULT_AREA_CONFIG,
	domainOverride?: [number, number],
	clamp = true,
): AreaScale => {
	if (type === "ordinal") {
		const unique = ordinalAreaCategories(rawValues)
		if (unique) {
			// A non-numeric ordinal has no magnitude, only rank order, so the
			// area/diameter (√ vs. linear) distinction is meaningless — spread
			// the categories at EVEN radius steps across [minRadius, maxRadius]
			// (first → min, last → max), matching how the length/angle channels
			// handle ordinals. Per-category overrides win.
			const n = Math.max(1, unique.length - 1)
			const { minRadius, maxRadius } = config
			const overrides = config.overrides ?? {}
			return {
				kind: "ordinal",
				radiusFor: (raw) => {
					const v = parseValue(raw, "ordinal")
					if (v === null) return null
					const key = String(v)
					if (overrides[key] !== undefined) return overrides[key]
					const idx = unique.indexOf(key)
					return idx === -1
						? null
						: minRadius + (idx / n) * (maxRadius - minRadius)
				},
			}
		}
	}

	const nums = rawValues
		.map((v) => parseValue(v, type === "ordinal" ? "ordinal" : "quantitative"))
		.filter((v): v is number => typeof v === "number")
	const [dataLo = 0, dataHi = 1] = extent(nums) as [number, number]
	const [lo, hi] = domainOverride ?? [dataLo, dataHi]
	// Exponent 0.5 (√, the scaleSqrt default) keeps circle AREA proportional
	// to the value; "diameter" mode drives the radius linearly instead —
	// perceptually exaggerated, but legible on narrow-range data. See
	// `AreaConfig.sizeBy`.
	return {
		kind: "numeric",
		scale: scalePow()
			.exponent(config.sizeBy === "diameter" ? 1 : 0.5)
			.domain([lo, hi])
			.range([config.minRadius, config.maxRadius])
			.clamp(clamp),
	}
}

export const applyAreaScale = (
	areaScale: AreaScale,
	raw: unknown,
	type: FieldType
): number | null => {
	if (areaScale.kind === "ordinal") return areaScale.radiusFor(raw)
	const v = parseValue(raw, type === "ordinal" ? "ordinal" : "quantitative")
	return typeof v === "number" ? areaScale.scale(v) : null
}

// Hue → color scale (categorical or quantitative)
export type HueScale =
	| {
			kind: "categorical"
			scale: ReturnType<typeof scaleOrdinal<string, string>>
	  }
	| {
			kind: "sequential"
			scale: ReturnType<typeof scaleSequential<string>>
	  }
	| {
			kind: "diverging"
			scale: ReturnType<typeof scaleDiverging<string>>
	  }
	| {
			kind: "linear"
			scale: ReturnType<typeof scaleLinear<string, string>>
	  }

/** Pick the palette that should drive a hue scale based on the field
 *  type and the channel configs. Ordinal fields prefer the theme's
 *  ordinal palette (sequential); everything else uses the categorical
 *  palette. Callers can override by passing `customPalette` directly to
 *  `makeHueScale`. */
export const paletteForHueType = (
	type: FieldType,
	configs: {
		categoricalPalette?: readonly string[]
		ordinalPalette?: readonly string[]
	},
): readonly string[] | undefined => {
	if (type === "ordinal") {
		return configs.ordinalPalette ?? configs.categoricalPalette
	}
	return configs.categoricalPalette
}

/** Palette array driving the `outlineHue` categorical/ordinal scale. Outline
 *  keeps its OWN palette selection (`outlineCategoricalPalette` /
 *  `outlineOrdinalPalette`) so changing it never disturbs the fill-hue
 *  palette; falls back to the shared fill palette when the user hasn't picked
 *  an outline-specific one (the pre-picker default). */
export const outlinePaletteForHueType = (
	type: FieldType,
	configs: {
		categoricalPalette?: readonly string[]
		ordinalPalette?: readonly string[]
		outlineCategoricalPalette?: readonly string[]
		outlineOrdinalPalette?: readonly string[]
	},
): readonly string[] | undefined => {
	if (type === "ordinal") {
		return (
			configs.outlineOrdinalPalette ??
			configs.outlineCategoricalPalette ??
			configs.ordinalPalette ??
			configs.categoricalPalette
		)
	}
	return configs.outlineCategoricalPalette ?? configs.categoricalPalette
}

export const makeHueScale = (
	rawValues: unknown[],
	type: FieldType,
	config?: HueConfig,
	customPalette?: readonly string[],
	domainOverride?: [number, number],
	clamp = true,
): HueScale => {
	const isQuantitative = type === "quantitative" || type === "temporal"
	// Pull numeric domain for quantitative/temporal modes (needed whether or not
	// the user supplied anchor values).
	const temporalNums = (): number[] =>
		rawValues
			.map((v) => parseValue(v, "temporal"))
			.filter((v): v is Date => v instanceof Date)
			.map((d) => d.getTime())
	const quantitativeNums = (): number[] =>
		rawValues
			.map((v) => parseValue(v, "quantitative"))
			.filter((v): v is number => typeof v === "number")
	let nums: number[]
	if (!isQuantitative) nums = []
	else if (type === "temporal") nums = temporalNums()
	else nums = quantitativeNums()
	const [dataLoRaw = 0, dataHiRaw = 1] = isQuantitative
		? (extent(nums) as [number, number])
		: [0, 1]
	// Legend-breaks override the data extent for the scale's domain, so the
	// gradient bar visually spans the user-chosen range and marks get colors
	// from that scale. `clamp=true` keeps out-of-range data pinned to endpoints.
	const [dataLo, dataHi] = domainOverride ?? [dataLoRaw, dataHiRaw]

	if (isQuantitative) {
		// Quantitative: either a named palette or a custom domain-anchored scale.
		if (
			config?.kind === "quantitative" &&
			config.palette === "custom" &&
			config.customStops &&
			config.customStops.length >= 2
		) {
			// N-stop custom gradient. Each stop has an optional `value`; null
			// stops get auto-positioned (first → dataLo, last → dataHi,
			// middles spread evenly across the remaining indices).
			const stops = config.customStops
			const n = stops.length
			const domain = stops.map((s, i) => {
				if (s.value !== null && Number.isFinite(s.value)) return s.value
				if (i === 0) return dataLo
				if (i === n - 1) return dataHi
				return dataLo + ((dataHi - dataLo) * i) / (n - 1)
			})
			const range = stops.map((s) => s.color)
			return {
				kind: "linear",
				scale: scaleLinear<string, string>()
					.domain(domain)
					.range(range)
					.interpolate(gradientInterpolator(config.interpolation) as never)
					.clamp(clamp),
			}
		}
		if (
			config?.kind === "quantitative" &&
			(config.palette === "custom" ||
				config.palette === "customLinear" ||
				config.palette === "customDiverging")
		) {
			const lo = config.lowValue ?? dataLo
			const hi = config.highValue ?? dataHi
			const midV = config.midValue ?? autoDivergingMid(lo, hi)
			const hasMid = config.midColor !== null
			const domain = hasMid ? [lo, midV, hi] : [lo, hi]
			const range = hasMid
				? [config.lowColor, config.midColor as string, config.highColor]
				: [config.lowColor, config.highColor]
			return {
				kind: "linear",
				scale: scaleLinear<string, string>()
					.domain(domain)
					.range(range)
					.interpolate(gradientInterpolator(config.interpolation) as never)
					.clamp(clamp),
			}
		}
		const paletteName: PaletteName =
			config?.kind === "quantitative"
				? (config.palette as PaletteName)
				: "viridis"
		const interpolator =
			PALETTE_INTERPOLATORS[paletteName] ?? interpolateViridis
		// Diverging presets center on 0 when the data spans it — the palette's
		// neutral midpoint then marks the sign change, not the domain midpoint.
		if (
			DIVERGING_PRESET_PALETTES.includes(paletteName) &&
			dataLo < 0 &&
			dataHi > 0
		) {
			const divScale = scaleDiverging(interpolator)
				.domain([dataLo, 0, dataHi])
				.clamp(clamp)
			return { kind: "diverging", scale: divScale }
		}
		const seqScale = scaleSequential(interpolator).domain([dataLo, dataHi])
		// scaleSequential normalizes internally; `clamp(false)` lets t escape
		// [0,1] and produces extrapolated/out-of-gamut colors. Default keeps
		// the historical behavior (implicit clamp via t-normalization).
		if (!clamp) seqScale.clamp(false)
		return { kind: "sequential", scale: seqScale }
	}

	// Categorical
	const uniqueStrings = [
		...new Set(
			rawValues
				.map((v) => parseValue(v, type))
				.filter((v) => v !== null)
				.map(String)
		),
	]
	const scheme = customPalette ?? CATEGORICAL_HUE_PALETTE
	const baseRange = uniqueStrings.map((_, i) => scheme[i % scheme.length])
	// Apply per-value overrides on top of the default assignment.
	const overrides = config?.kind === "categorical" ? config.colors : undefined
	const finalRange = baseRange.map((c, i) => {
		const v = uniqueStrings[i]
		return overrides && overrides[v] ? overrides[v] : c
	})
	return {
		kind: "categorical",
		scale: scaleOrdinal<string, string>()
			.domain(uniqueStrings)
			.range(finalRange),
	}
}

export const applyHueScale = (
	hs: HueScale,
	raw: unknown,
	type: FieldType
): string | null => {
	const v = parseValue(raw, type)
	if (v === null) return null
	if (hs.kind === "sequential" || hs.kind === "diverging" || hs.kind === "linear") {
		const n = v instanceof Date ? v.getTime() : typeof v === "number" ? v : null
		return n === null ? null : hs.scale(n)
	}
	return hs.scale(String(v))
}

// Saturation / brightness: modulate a base color via HSL. Both channels now
// accept a config that determines the output HSL-component range; defaults
// preserve the earlier behavior (saturation 0.2–1.0, brightness 0.25–0.85).
export type UnitScale = (raw: unknown) => number | null

const makeUnitScaleInner = (
	rawValues: unknown[],
	type: FieldType,
	outRange: [number, number] = [0, 1],
	domainOverride?: [number, number],
	clamp = true,
): UnitScale => {
	if (type === "quantitative" || type === "temporal") {
		const nums =
			type === "temporal"
				? rawValues
						.map((v) => parseValue(v, "temporal"))
						.filter((v): v is Date => v instanceof Date)
						.map((d) => d.getTime())
				: rawValues
						.map((v) => parseValue(v, "quantitative"))
						.filter((v): v is number => typeof v === "number")
		const [dataLo = 0, dataHi = 1] = extent(nums) as [number, number]
		const [lo, hi] = domainOverride ?? [dataLo, dataHi]
		const s = scaleLinear().domain([lo, hi]).range(outRange).clamp(clamp)
		return (raw) => {
			const v = parseValue(raw, type)
			if (v === null) return null
			const n = v instanceof Date ? v.getTime() : (v as number)
			return typeof n === "number" ? s(n) : null
		}
	}
	if (type === "ordinal") {
		const parsed = rawValues
			.map((v) => parseValue(v, "ordinal"))
			.filter((v) => v !== null) as Array<number | string>
		const numericOrdinal = parsed.every((v) => typeof v === "number")
		if (numericOrdinal) {
			const nums = parsed as number[]
			const [lo = 0, hi = 1] = extent(nums) as [number, number]
			const s = scaleLinear().domain([lo, hi]).range(outRange).clamp(true)
			return (raw) => {
				const v = parseValue(raw, "ordinal")
				return typeof v === "number" ? s(v) : null
			}
		}
		const unique = [...new Set(parsed.map(String))]
		const n = Math.max(1, unique.length - 1)
		return (raw) => {
			const v = parseValue(raw, "ordinal")
			if (v === null) return null
			const idx = unique.indexOf(String(v))
			return idx === -1
				? null
				: outRange[0] + (idx / n) * (outRange[1] - outRange[0])
		}
	}
	// categorical: evenly spaced positions across outRange
	const unique = [
		...new Set(
			rawValues
				.map((v) => parseValue(v, "categorical"))
				.filter((v): v is string => typeof v === "string")
		),
	]
	const n = Math.max(1, unique.length - 1)
	return (raw) => {
		const v = parseValue(raw, "categorical")
		if (v === null) return null
		const idx = unique.indexOf(String(v))
		return idx === -1
			? null
			: outRange[0] + (idx / n) * (outRange[1] - outRange[0])
	}
}

// Per-value overrides win for categorical / ordinal fields (set in the
// sidebar's per-category editor, and by the packed-circles derived panels);
// an unset value keeps the even min→max spread. Quantitative / temporal
// fields modulate continuously and ignore overrides entirely.
const withModulationOverrides = (
	base: UnitScale,
	type: FieldType,
	overrides: Record<string, number> | undefined
): UnitScale => {
	if (
		!overrides ||
		Object.keys(overrides).length === 0 ||
		type === "quantitative" ||
		type === "temporal"
	)
		return base
	return (raw) => {
		const v = parseValue(raw, type)
		if (v === null) return null
		const o = overrides[String(v)]
		return o !== undefined ? o : base(raw)
	}
}

export const makeSaturationScale = (
	rawValues: unknown[],
	type: FieldType,
	config: SaturationConfig = DEFAULT_SATURATION_CONFIG
): UnitScale =>
	withModulationOverrides(
		makeUnitScaleInner(rawValues, type, [config.min, config.max]),
		type,
		config.overrides
	)

export const makeBrightnessScale = (
	rawValues: unknown[],
	type: FieldType,
	config: BrightnessConfig = DEFAULT_BRIGHTNESS_CONFIG
): UnitScale =>
	withModulationOverrides(
		makeUnitScaleInner(rawValues, type, [config.min, config.max]),
		type,
		config.overrides
	)

// Opacity — quantitative scales to [min, max] (default 0.2–1); categorical /
// ordinal reads each category's override (default 1 if unset).
export const makeOpacityScale = (
	rawValues: unknown[],
	type: FieldType,
	config?: OpacityConfig,
	domainOverride?: [number, number],
	clamp = true,
): UnitScale => {
	const isQuantitative = type === "quantitative" || type === "temporal"
	if (isQuantitative) {
		const effective =
			config?.kind === "quantitative" ? config : DEFAULT_OPACITY_QUANTITATIVE
		return makeUnitScaleInner(
			rawValues,
			type,
			[effective.min, effective.max],
			domainOverride,
			clamp,
		)
	}
	// Categorical / ordinal: distribute opacity across the same default
	// range as quantitative (0.2 → 1.0) so mapping any field type to
	// opacity produces a visible effect. Per-category overrides win.
	// Without this, every category collapsed to opacity=1 unless the
	// user explicitly set an override — making the encoding feel
	// "broken" the moment a non-numeric field was dropped on it.
	const overrides = config?.kind === "categorical" ? config.overrides : {}
	const fallbackScale = makeUnitScaleInner(rawValues, type, [
		DEFAULT_OPACITY_QUANTITATIVE.min,
		DEFAULT_OPACITY_QUANTITATIVE.max,
	])
	return (raw) => {
		const v = parseValue(raw, type)
		if (v === null) return null
		const str = String(v)
		if (overrides[str] !== undefined) return overrides[str]
		return fallbackScale(raw)
	}
}

// Modulate a base color using saturation/brightness scale outputs. The scale
// outputs are already in their final HSL-component range (set by config), so
// assign directly — no additional remapping.
export const modulateColor = (
	base: string,
	satOut: number | null,
	briOut: number | null
): string => {
	if (satOut === null && briOut === null) return base
	const c = hsl(base)
	if (satOut !== null) c.s = satOut
	if (briOut !== null) c.l = briOut
	return c.formatHex()
}

// Shape: ordered palette of d3 symbol types. Index 0 is the default (circle).
// All shapes are filled — the user customizes hollow / outline-only looks
// via the per-shape fill / outline color controls (set fill to "none" for
// an outlined-only mark, or pair a light fill with a dark stroke).
export const SHAPE_PALETTE = [
	symbolCircle,
	symbolSquare,
	symbolTriangle,
	symbolDiamond,
	symbolCross,
	symbolStar,
]

// Returns an SVG path `d` string for the given shape index and circle-equivalent radius.
export const symbolPath = (shapeIdx: number, radius: number): string => {
	const type = SHAPE_PALETTE[shapeIdx % SHAPE_PALETTE.length]
	const area = Math.PI * radius * radius
	return symbol().type(type).size(area)() ?? ""
}

// For a shape encoding: given all raw values + their type, return a lookup from
// raw value → shape palette index. Config lets the user pin specific values to
// specific palette indices; unmapped values fall back to the default ordering.
export const makeShapeIndexer = (
	rawValues: unknown[],
	type: FieldType,
	config?: ShapeConfig
): ((raw: unknown) => number) => {
	const domain = [
		...new Set(
			rawValues
				.map((v) => parseValue(v, type))
				.filter((v) => v !== null)
				.map(String)
		),
	]
	return (raw) => {
		const v = parseValue(raw, type)
		if (v === null) return 0
		const str = String(v)
		if (config?.overrides && config.overrides[str] !== undefined) {
			return config.overrides[str]
		}
		const idx = domain.indexOf(str)
		return Math.max(idx, 0)
	}
}

// Re-export config types used by scales consumers.
export type { PatternConfig }

/**
 * Estimate the maximum number of tick marks that are "meaningful" given the
 * data granularity — i.e. the smallest step between consecutive unique values
 * in the domain. Returns a finite positive integer (at least 2).
 */
export const maxMeaningfulTicks = (
	rawValues: unknown[],
	type: FieldType
): number => {
	if (type === "categorical" || type === "ordinal") {
		const unique = [
			...new Set(
				rawValues
					.map((v) => parseValue(v, type))
					.filter((v) => v !== null)
					.map(String)
			),
		]
		return Math.max(2, unique.length)
	}
	const nums: number[] =
		type === "temporal"
			? rawValues
					.map((v) => parseValue(v, "temporal"))
					.filter((v): v is Date => v instanceof Date)
					.map((d) => d.getTime())
			: rawValues
					.map((v) => parseValue(v, "quantitative"))
					.filter((v): v is number => typeof v === "number")
	if (nums.length < 2) return 12
	const unique = [...new Set(nums)].sort((a, b) => a - b)
	if (unique.length < 2) return 12
	const range = unique[unique.length - 1] - unique[0]
	if (range <= 0) return 2
	let minStep = Infinity
	for (let i = 1; i < unique.length; i++) {
		const step = unique[i] - unique[i - 1]
		if (step > 0 && step < minStep) minStep = step
	}
	if (!Number.isFinite(minStep) || minStep <= 0) return 12
	return Math.max(2, Math.floor(range / minStep) + 1)
}

// Length: quantitative/ordinal → scale to pixel length. Used when the mark
// becomes a line segment.
export const LENGTH_RANGE: [number, number] = [4, 40]

export const makeLengthScale = (
	rawValues: unknown[],
	type: FieldType,
	config?: { minLength: number; maxLength: number },
	domainOverride?: [number, number],
	clamp = true,
): ((raw: unknown) => number | null) => {
	const range: [number, number] = config
		? [config.minLength, config.maxLength]
		: LENGTH_RANGE
	if (type === "quantitative" || type === "temporal") {
		const nums =
			type === "temporal"
				? rawValues
						.map((v) => parseValue(v, "temporal"))
						.filter((v): v is Date => v instanceof Date)
						.map((d) => d.getTime())
				: rawValues
						.map((v) => parseValue(v, "quantitative"))
						.filter((v): v is number => typeof v === "number")
		const [dataLo = 0, dataHi = 1] = extent(nums) as [number, number]
		const [lo, hi] = domainOverride ?? [dataLo, dataHi]
		const s = scaleLinear().domain([lo, hi]).range(range).clamp(clamp)
		return (raw) => {
			const v = parseValue(raw, type)
			if (v === null) return null
			const n = v instanceof Date ? v.getTime() : (v as number)
			return typeof n === "number" ? s(n) : null
		}
	}
	// ordinal / categorical: distribute evenly across the length range
	const unit = makeUnitScaleInner(rawValues, type)
	return (raw) => {
		const u = unit(raw)
		return u === null ? null : range[0] + u * (range[1] - range[0])
	}
}

// Angle: radians output. Config accepts degrees (-180 to 180 default).
export const makeAngleScale = (
	rawValues: unknown[],
	type: FieldType,
	config?: { minAngle: number; maxAngle: number },
	domainOverride?: [number, number],
	clamp = true,
): ((raw: unknown) => number | null) => {
	const minRad = config ? (config.minAngle * Math.PI) / 180 : 0
	const maxRad = config ? (config.maxAngle * Math.PI) / 180 : 2 * Math.PI
	const unit = makeUnitScaleInner(rawValues, type, [0, 1], domainOverride, clamp)
	return (raw) => {
		const u = unit(raw)
		return u === null ? null : minRad + u * (maxRad - minRad)
	}
}
