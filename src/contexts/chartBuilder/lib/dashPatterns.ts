import type { LineDashPattern, PatternOverride } from "./channelConfig"
import { DEFAULT_PATTERN_INK, inkForHueColor } from "./patterns"

/** Auto-cycle of dash styles applied to lines when a `pattern` field is
 *  mapped to a connection (line chart). Categories cycle through this
 *  array by their position in the field's unique-values list; the
 *  GlyphPickerPanel dash swatches MUST render in the same order so a
 *  swatch at index N maps to a value's dash at cycle position N.
 *
 *  "solid" is intentionally omitted — the Pattern panel's "None" button
 *  already represents a solid stroke, so listing solid here would create
 *  a duplicate first swatch. */
export const DASH_CYCLE: readonly LineDashPattern[] = [
	"dashed",
	"dotted",
	"dash-dot",
] as const

/** Map each dash pattern to an SVG `stroke-dasharray` value. `null` means
 *  "no dasharray attribute" (i.e. solid stroke). Centralized here so the
 *  panel preview and the renderer agree on the exact recipe. */
export const dashArrayFor = (pattern: LineDashPattern): string | null => {
	switch (pattern) {
		case "solid": {
			return null
		}
		case "dashed": {
			return "8,4"
		}
		case "dotted": {
			return "2,3"
		}
		case "dash-dot": {
			return "8,3,2,3"
		}
		// "blank" has no dasharray recipe — the range-aware renderers detect
		// it themselves and skip the stroke entirely (gap in the line, or the
		// gap-fill underlay alone). Everywhere else null = solid, which is the
		// deliberate fallback: blank without an active range window is inert.
		case "blank": {
			return null
		}
		// Default-case unreachable when callers respect the union, but
		// guards against future-pattern strings sneaking through and
		// silently rendering as solid.
		default: {
			return null
		}
	}
}

/** Sanitize a user-typed custom dasharray string. Accepts comma- or
 *  space-separated positive numbers (`"2,2"`, `"2 4 5 2"`). Returns
 *  `null` when the input doesn't parse to at least one positive value —
 *  the caller treats that as "no custom override, fall back to the
 *  built-in palette." Keeps the parsed numbers as a normalized
 *  comma-separated string suitable for `stroke-dasharray`. */
export const sanitizeCustomDasharray = (raw: string): string | null => {
	if (!raw) return null
	const parts = raw
		.split(/[\s,]+/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0)
	const nums: number[] = []
	for (const p of parts) {
		const n = Number(p)
		if (!Number.isFinite(n) || n < 0) return null
		nums.push(n)
	}
	if (nums.length === 0) return null
	return nums.join(",")
}

/** How a pattern-channel category value renders as a line dash. `custom` is
 *  a user-typed dasharray; `pattern` is a built-in `LineDashPattern`
 *  (including `"solid"` for an explicit "None" pick). `null` = the pattern
 *  channel has no opinion for this value (value missing from the domain) —
 *  the caller falls back to its own default chain. */
export type PatternDashSpec =
	| { kind: "custom"; dasharray: string }
	| { kind: "pattern"; pattern: LineDashPattern }

/** Resolve the line dash the PATTERN CHANNEL assigns to one category value.
 *  Precedence: per-category custom dasharray > explicit swatch override
 *  (number → DASH_CYCLE entry, "none" → solid) > auto-cycle through
 *  DASH_CYCLE by the value's position in `domain` (the pattern field's
 *  unique-values list, dataset order — the same order the panel's rows and
 *  the legend use). Shared by ScatterPlot's connection polylines and
 *  AreaPlot's line-mode layer edges so the two renderers can't drift. */
export const dashSpecForPatternValue = (
	value: string,
	dashOverrides: Record<string, PatternOverride>,
	customDashOverrides: Record<string, string>,
	domain: readonly string[]
): PatternDashSpec | null => {
	const raw = customDashOverrides[value]
	if (raw) {
		const dasharray = sanitizeCustomDasharray(raw)
		if (dasharray) return { kind: "custom", dasharray }
	}
	const override = dashOverrides[value]
	if (override === "none") return { kind: "pattern", pattern: "solid" }
	if (typeof override === "number") {
		const pattern = DASH_CYCLE[override % DASH_CYCLE.length]
		return pattern ? { kind: "pattern", pattern } : null
	}
	const idx = domain.indexOf(value)
	if (idx < 0) return null
	const pattern = DASH_CYCLE[idx % DASH_CYCLE.length]
	return pattern ? { kind: "pattern", pattern } : null
}

/** Whether dash gaps get painted (the alternate-color underlay that keeps a
 *  dashed line reading as one CONNECTED two-color line) or stay empty (a
 *  truly dashed line). An explicit user choice wins; `null` = AUTO: paint
 *  the gaps UNLESS the pattern encoding maps the same field as the hue
 *  encoding — there the dash restates the color split, so true gaps are the
 *  default and painting is opt-in via the panel checkbox. */
export const resolveDashGapFill = ({
	configured,
	patternField,
	hueField,
}: {
	configured: boolean | null | undefined
	patternField: string | null
	hueField: string | null
}): boolean => {
	if (configured !== null && configured !== undefined) return configured
	return !(patternField !== null && patternField === hueField)
}

/** Split an ordered polyline's items into runs of a constant value — the
 *  per-line segmentation behind "pattern varies WITHIN a line" (e.g. a
 *  known-vs-projected column on a series that spans both). Every run after
 *  the first starts with the PREVIOUS run's last item, so consecutive
 *  segments share their boundary point and the drawn line stays connected;
 *  the connecting span belongs to the LATER run (the segment from the last
 *  known point into the first projected one IS projection, so it takes the
 *  projected styling). Items whose value is `null` form their own runs and
 *  fall back to the caller's default dash. */
export const splitIntoValueRuns = <T>(
	items: readonly T[],
	valueOf: (item: T) => string | null
): Array<{ value: string | null; items: T[] }> => {
	const runs: Array<{ value: string | null; items: T[] }> = []
	for (const item of items) {
		const value = valueOf(item)
		const last = runs[runs.length - 1]
		if (last && last.value === value) {
			last.items.push(item)
			continue
		}
		const boundary = last?.items[last.items.length - 1]
		runs.push({
			value,
			items: boundary === undefined ? [item] : [boundary, item],
		})
	}
	return runs
}

/** Resolve the color that fills the GAP between dashes — a separate
 *  "underlay" polyline gets stroked in this color and the dashed pattern is
 *  drawn on top, so the line reads as one connected two-color line.
 *
 *  The chain mirrors how AREA PATTERNS pick their ink (the same "palette
 *  color options" pairing, see `resolvePatternForMark`):
 *    1. per-category `dashAlternateColors` override — the Pattern panel's
 *       gap swatches, keyed by HUE value (the color encoding's categories);
 *       the line's legacy group key is tried second for saved visuals;
 *    2. the single `dashGapColor` override (the one-swatch no-hue case);
 *    3. the pattern channel's per-category Color pick
 *       (`pattern.inkColors[patternValue]`);
 *    4. the palette-paired pattern ink for the line's drawn color
 *       (`inkForHueColor` against the same palette the hue scale used);
 *    5. the default pattern ink (`configs.defaultPatternInk`, theme-seeded),
 *       else the built-in near-black.
 *  Deliberately NOT the chart background — background-colored gaps are
 *  indistinguishable from empty gaps, which is what the separate
 *  "Fill dash gaps" opt-out is for. */
export const resolveDashGapColor = ({
	overrideKeys,
	patternValue,
	lineColor,
	overrides,
	singleOverride,
	inkColors,
	palette,
	patternInks,
	defaultInk,
}: {
	/** Override keys to try IN ORDER against `overrides` — the line's hue
	 *  value first (what the panel's gap swatches write), then the legacy
	 *  connection-group key. Nullish entries are skipped. */
	overrideKeys: ReadonlyArray<string | null | undefined>
	/** The line/run's pattern-channel category value (null when the pattern
	 *  channel is unmapped or the value is missing). */
	patternValue: string | null
	/** The line's resolved stroke color — the pre-modulation hue/palette
	 *  color, so the palette pairing lookup can hit. */
	lineColor: string
	overrides: Record<string, string>
	singleOverride: string | null | undefined
	inkColors: Record<string, string>
	palette: readonly string[] | undefined
	patternInks: ReadonlyArray<string | null> | undefined
	defaultInk: string | null | undefined
}): string => {
	for (const key of overrideKeys) {
		if (key === null || key === undefined) continue
		const override = overrides[key]
		if (override) return override
	}
	if (singleOverride) return singleOverride
	const categoryInk = patternValue !== null ? inkColors[patternValue] : undefined
	if (categoryInk) return categoryInk
	const paired = inkForHueColor(lineColor, palette, patternInks)
	if (paired) return paired
	return defaultInk ?? DEFAULT_PATTERN_INK
}
