import type { AestheticScales } from "../store/useAestheticScales"

import { DEFAULT_SHAPE_CONFIG, type ChannelConfigs } from "./channelConfig"
import { resolveConnectionThickness } from "./connectionThickness"
import { slotModulationResolver, slotOpacityResolver } from "./resolveLayerColor"
import { applyHueScale } from "./scales"
import { resolveRuleColor, type RuleRows } from "./textColorRules"

/** How one mark's own outline draws. */
export type MarkOutline = {
	/** The stroke color: a matching outline color rule, else the Outline
	 *  variable's color for the mark, else the one outline color — shaded by
	 *  the outline's Saturation and Brightness. */
	stroke: string
	/** The outline's Opacity, a single level or varied by a field. */
	strokeOpacity: number
	/** The outline's thickness (px), single or varied by a field. 0 = no
	 *  outline. */
	strokeWidth: number
}

/** The thickness of a mark's own outline: its level's thickness when the
 *  outline varies by a variable (Size → *Mark* outline → "Vary by"), else
 *  the one outline thickness. The same lookup a line's thickness uses, off
 *  the mark's row (its first row, for a mark built from many). */
export const outlineWidthResolver = (
	channelConfigs: ChannelConfigs
): ((row: Record<string, unknown> | undefined) => number) => {
	const shape = channelConfigs.shape
	const thickness = shape?.outlineWidth ?? DEFAULT_SHAPE_CONFIG.outlineWidth
	const field = shape?.outlineWidthField ?? null
	const byValue = shape?.outlineWidthByValue
	if (!field || !byValue) return () => thickness
	return (row) => resolveConnectionThickness({ groupKey: null, thickness, byValue, field, row })
}

/** The marks' own outline, resolved the same way for EVERY mark that has
 *  one — a point's ring, a bar's, a slice's, a cell's, a region's.
 *
 *  Each renderer used to assemble this by hand, and each copy read a
 *  different subset: pies ignored the Outline variable, cells and nodes the
 *  outline's opacity, and only scatter and radar its saturation and
 *  brightness. One resolver, so an option the menus offer for an outline
 *  reaches every outline:
 *
 *   - **Color** — an outline color rule that matches, else the Outline
 *     ("Vary by") variable's scale, else `shape.outlineColor`;
 *   - **Saturation / Brightness** — the Outline targets, applied to that
 *     color;
 *   - **Opacity** — the Outline (`border`) target, level or "Vary by";
 *   - **Thickness** — the one outline thickness, or "Vary by".
 *
 *  A mark built from many rows resolves off its FIRST row (the convention
 *  every per-part target follows), while `{Variable}` color rules test all
 *  of its rows.
 *
 *  Returns `(row, opts) => MarkOutline`. Pass `opts.color` when the caller
 *  has already resolved the variable / rule color (`resolveLayerColor`'s
 *  `outline`, which reads a slice's group value) — `undefined` means "work
 *  it out from the row", `null` means "resolved: none matched". */
export const markOutlineResolver = (
	channelConfigs: ChannelConfigs,
	aestheticScales: AestheticScales
): ((
	row: Record<string, unknown>,
	opts?: { color?: string | null; rows?: RuleRows }
) => MarkOutline) => {
	const base =
		channelConfigs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor
	const field = aestheticScales.outlineHue?.field ?? null
	const scale = aestheticScales.outlineHue?.scale ?? null
	const rules = channelConfigs.shape?.outlineColorRules
	const opacityFor = slotOpacityResolver("border", channelConfigs, aestheticScales)
	const shade = slotModulationResolver("outline", channelConfigs, aestheticScales)
	const widthFor = outlineWidthResolver(channelConfigs)

	const colorFromRow = (
		row: Record<string, unknown>,
		rows: RuleRows | undefined
	): string | null => {
		const value = field ? row[field.name] : undefined
		const ruleColor = resolveRuleColor(rules, value, rows ?? [row])
		if (ruleColor) return ruleColor
		if (scale && field && value !== undefined && value !== null)
			return applyHueScale(scale, value, field.type)
		return null
	}

	return (row, opts) => {
		const resolved =
			opts?.color !== undefined ? opts.color : colorFromRow(row, opts?.rows)
		return {
			stroke: shade(resolved ?? base, row),
			strokeOpacity: opacityFor(row),
			strokeWidth: widthFor(row),
		}
	}
}
