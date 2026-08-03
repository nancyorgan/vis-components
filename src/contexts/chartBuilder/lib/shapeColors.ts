import type { ShapeConfig } from "./channelConfig"

/** Strip every per-category override (shape choice + fill + stroke) for a
 *  single category off a `ShapeConfig`, returning the patch the sidebar
 *  should apply to clear that row "back to defaults". The previous flow
 *  surfaced three separate reset links — only one of which was visible
 *  at a time, depending on which override the user had set — so the path
 *  back to a clean slate felt arbitrary. This helper consolidates the
 *  three resets into one, and is exported so the rule is testable
 *  independent of the sidebar's React tree. */
export const resetShapeCategoryOverrides = (
	cfg: Pick<ShapeConfig, "overrides" | "fillOverrides" | "strokeOverrides">,
	value: string
): Pick<ShapeConfig, "overrides" | "fillOverrides" | "strokeOverrides"> => {
	const { [value]: _shape, ...overrides } = cfg.overrides
	const { [value]: _fill, ...fillOverrides } = cfg.fillOverrides ?? {}
	const { [value]: _stroke, ...strokeOverrides } = cfg.strokeOverrides ?? {}
	return { overrides, fillOverrides, strokeOverrides }
}

/** True when the category has any per-row override set (shape, fill, or
 *  stroke). Used by the sidebar to decide whether to surface the reset
 *  link for the row — without overrides, there's nothing to reset. */
export const shapeCategoryHasOverride = (
	cfg: Pick<ShapeConfig, "overrides" | "fillOverrides" | "strokeOverrides">,
	value: string
): boolean =>
	cfg.overrides[value] !== undefined ||
	cfg.fillOverrides?.[value] !== undefined ||
	cfg.strokeOverrides?.[value] !== undefined

/** Resolve the fill and stroke colors for a single shape mark, given the
 *  hue-derived `fill`, the (optional) shape encoding's value for the row,
 *  the user's `ShapeConfig`, and whether hue is currently mapped.
 *
 *  Used by ScatterPlot's `buildMarks`. Extracted so the resolution rules
 *  are testable without spinning up the whole chart pipeline — the
 *  precedence order is deceptively easy to get wrong.
 *
 *  Rules (highest to lowest):
 *    Fill:
 *      1. `shape.fillOverrides[category]` if set (literal `"none"` makes
 *         the shape hollow)
 *      2. The hue-derived `fill` (or `defaultFill` when hue is unmapped)
 *    Stroke:
 *      1. `shape.strokeOverrides[category]` if set
 *      2. `outlineRuleColor` — a conditional rule's color when the row's
 *         `outlineHue` value matches a rule (caller resolves it)
 *      3. `outlineScaleColor` — the color from the `outlineHue` encoding's
 *         scale for this row, when an outline-color field is mapped
 *      4. `shape.outlineColor` as a final fallback (theme color, typically
 *         white) — keeps filled shapes' crisp separator without forcing the
 *         user to set per-category strokes
 */
export const resolveShapeColors = (input: {
	hueFill: string
	shapeCategoryValue: string | null
	shapeConfig: ShapeConfig | undefined
	hueMapped: boolean
	/** Final fallback for stroke when no per-category override exists and no
	 * outline-color field is mapped. Caller passes `shape.outlineColor ?? "#fff"`. */
	fallbackOutline: string
	/** Color resolved from the `outlineHue` channel's scale for this row, or
	 * `null`/absent when no outline-color field is mapped (or the row's value
	 * doesn't resolve). Sits between the per-category override and the
	 * universal fallback. */
	outlineScaleColor?: string | null
	/** Color from a matching conditional outline rule for this row, or
	 * `null`/absent when no rule matches. Wins over `outlineScaleColor` so a
	 * rule can override the palette — but still yields to a per-category
	 * `strokeOverride`. */
	outlineRuleColor?: string | null
}): { fill: string; stroke: string } => {
	const {
		hueFill,
		shapeCategoryValue,
		shapeConfig,
		fallbackOutline,
		outlineScaleColor,
		outlineRuleColor,
	} = input
	const fillOverride = shapeCategoryValue
		? shapeConfig?.fillOverrides?.[shapeCategoryValue]
		: undefined
	const strokeOverride = shapeCategoryValue
		? shapeConfig?.strokeOverrides?.[shapeCategoryValue]
		: undefined
	const fill = fillOverride ?? hueFill
	// Stroke priority:
	//   1. Per-category strokeOverrides[value] (always wins)
	//   2. A matching conditional outline rule's color
	//   3. The mapped outline-color scale's color for this row
	//   4. The user's explicit outlineColor (seeded from the theme on
	//      chart creation, editable per-chart). Set outlineWidth to 0 to
	//      hide the stroke entirely.
	const stroke =
		strokeOverride ?? outlineRuleColor ?? outlineScaleColor ?? fallbackOutline
	return { fill, stroke }
}
