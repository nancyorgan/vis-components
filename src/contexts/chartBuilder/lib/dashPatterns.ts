import type { LineDashPattern } from "./channelConfig"

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

/** Resolve the alternate color for a non-solid line: per-group override
 *  if set, otherwise the visualization background color, otherwise white
 *  (the user-facing rule from the goals doc).
 *
 *  The alternate color is what shows in the GAP between dashes — a
 *  separate "underlay" polyline gets stroked in this color and the
 *  dashed pattern is drawn on top. With background = transparent the
 *  underlay falling back to white keeps the dashes visually crisp
 *  rather than blending into the chart's pattern fills. */
export const resolveDashAlternateColor = ({
	groupKey,
	overrides,
	visualizationBackground,
}: {
	groupKey: string
	overrides: Record<string, string>
	visualizationBackground: string | null
}): string => {
	const override = overrides[groupKey]
	if (override) return override
	if (visualizationBackground) return visualizationBackground
	return "#ffffff"
}
