/** A point's shape and colors.
 *
 *  A scatter's points, the points along a line (a line chart's, a combo's),
 *  a radar's and the markers on an area chart's edges are the same part —
 *  the "Point" — set by the same controls: Shape picks the glyph, Color's
 *  Point outline colors the ring, and a Shape category can carry a fill and
 *  an outline of its own. Each renderer used to work that out for itself,
 *  in a copy of the same lines. The rule lives here now.
 *
 *  What stays with a renderer is where the point sits and which element it
 *  is drawn with. Pure: no store, no React. */

import type { AestheticScales } from "../store/useAestheticScales"

import { DEFAULT_SHAPE, DEFAULT_SHAPE_CONFIG, type ChannelConfigs } from "./channelConfig"
import { slotModulationResolver } from "./resolveLayerColor"
import { applyHueScale } from "./scales"
import { resolveShapeColors } from "./shapeColors"
import { resolveRuleColor } from "./textColorRules"

type Row = Record<string, unknown>

export type PointStyle = {
	/** The point's glyph, as an index into the shape palette: its Shape
	 *  category's when Shape is mapped, else the default shape. */
	shapeIndex: (row: Row) => number
	/** The point's fill and outline color, given the fill the Color mapping
	 *  resolved for it.
	 *
	 *  Fill: the Shape category's own fill when it has one, else `hueFill`.
	 *  Outline, first that applies: the Shape category's own outline; a
	 *  matching outline color rule; the Outline variable's color for the row;
	 *  the single outline color. The outline is then shaded by the Point
	 *  outline's Saturation / Brightness. */
	colors: (row: Row, hueFill: string) => { fill: string; stroke: string }
}

export const pointStyleResolver = (
	channelConfigs: ChannelConfigs,
	aestheticScales: AestheticScales
): PointStyle => {
	const shape = aestheticScales.shape
	const defaultShape = channelConfigs.defaultShape ?? DEFAULT_SHAPE
	const outlineHue = aestheticScales.outlineHue
	const hueMapped = !!aestheticScales.hue
	const fallbackOutline =
		channelConfigs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor
	// The outline's own shading, apart from the fill's (identity when unset).
	const modulateOutline = slotModulationResolver("outline", channelConfigs, aestheticScales)
	return {
		shapeIndex: (row) => (shape ? shape.idx(row[shape.field.name]) : defaultShape),
		colors: (row, hueFill) => {
			const { fill, stroke } = resolveShapeColors({
				hueFill,
				// Keyed by the Shape variable's value, so one category can be
				// given a look of its own without leaving the Color palette.
				shapeCategoryValue: shape ? String(row[shape.field.name] ?? "") : null,
				shapeConfig: channelConfigs.shape,
				hueMapped,
				fallbackOutline,
				outlineScaleColor: outlineHue
					? applyHueScale(outlineHue.scale, row[outlineHue.field.name], outlineHue.field.type)
					: null,
				// An implicit rule tests the mapped Outline variable's value
				// (nothing to compare while unmapped); a `{Variable}` rule tests
				// the row and fires with or without an Outline variable.
				outlineRuleColor: resolveRuleColor(
					channelConfigs.shape?.outlineColorRules,
					outlineHue ? row[outlineHue.field.name] : undefined,
					[row]
				),
			})
			return { fill, stroke: modulateOutline(stroke, row) }
		},
	}
}
