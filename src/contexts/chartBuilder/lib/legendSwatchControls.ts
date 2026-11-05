/** The one rule for which swatch controls a legend section offers.
 *
 *  A legend section is every channel the renderer folds into one swatch list
 *  (channels sharing a field, with "Combine legends with same variables" on).
 *  Each visual property of the swatch is either ENCODED by one of those
 *  channels — the swatch must show the mapping, so the panel offers no
 *  control — or free, and then the user picks it:
 *
 *    Shape          encoded by Shape; Length swatches are line segments
 *                   (no glyph to reshape). Where the swatch must be a glyph
 *                   the rectangle drops out: Size / Angle glyphs take
 *                   glyphs only; Outline-color glyphs and line-chart dash
 *                   swatches take glyphs or a line.
 *    Size           encoded by Size (area); Length segments size themselves.
 *    Fill           encoded by Color (Saturation / Brightness / Opacity only
 *                   modulate it). Without Color, a Pattern member makes the
 *                   tiles the fill (Background + Pattern color); an Outline
 *                   color section without Color or Shape draws hollow glyphs
 *                   (the stroke IS the key); otherwise a Swatch color.
 *    Outline color  encoded by Outline color.
 *    Outline width  always free (glyph / rectangle swatches).
 *
 *  Channels on OTHER fields never add or remove a section's controls, and
 *  Saturation / Brightness / Opacity / Pattern never touch the shape, size or
 *  outline rows. Renderers honor every control this offers. */

import {
	legendSwatchOutlineWidth,
	legendSwatchShape,
	resolveLegendSwatchShape,
	type LegendConfig,
	type LegendSwatchShape,
	type SwatchShapeChannel,
} from "./labelsConfig"
import type { Theme } from "./types"

/** A section member: any legend channel that can fold into a swatch list,
 *  plus the rug color slot (its slot palette colors the fill). */
export type SwatchMember =
	| "hue"
	| "outlineHue"
	| "saturation"
	| "brightness"
	| "pattern"
	| "opacity"
	| "shape"
	| "length"
	| "angle"
	| "area"
	| "rug"

export type SwatchFillControl = "encoded" | "pattern" | "hollow" | "color"

/** Which swatch shapes the picker offers (see the rule above). */
export type SwatchShapeOptions = "all" | "glyphs" | "noRect"

/** Context outside the section's members that changes what a swatch draws. */
export type SwatchContext = {
	/** Line-chart context: a Pattern member draws the dash overlay through a
	 *  point glyph. */
	connection?: boolean
}

export type SwatchControls = {
	shape: boolean
	shapeOptions: SwatchShapeOptions
	size: boolean
	fill: SwatchFillControl
	outlineColor: boolean
	outlineWidth: boolean
}

export const legendSwatchControls = (
	members: ReadonlyArray<SwatchMember>,
	ctx: SwatchContext = {}
): SwatchControls => {
	const has = (c: SwatchMember) => members.includes(c)
	const lines = has("length")
	return {
		shape: !has("shape") && !lines,
		shapeOptions: isGlyphSection(members)
			? "glyphs"
			: (has("outlineHue") && !has("shape")) || (ctx.connection && has("pattern"))
				? "noRect"
				: "all",
		size: !has("area") && !lines,
		fill:
			has("hue") || has("rug")
				? "encoded"
				: has("pattern")
					? "pattern"
					: has("outlineHue") && !has("shape")
						? "hollow"
						: "color",
		outlineColor: !has("outlineHue") && !lines,
		outlineWidth: !lines,
	}
}

/** A section whose swatches are mark-like GLYPHS sized / rotated by the data
 *  (Size or Angle folded in, no Length): the glyph defaults to the marks'
 *  own shape, not the theme's swatch rectangle. */
export const isGlyphSection = (members: ReadonlyArray<SwatchMember>): boolean =>
	(members.includes("area") || members.includes("angle")) &&
	!members.includes("length")

/** Outline width a section starts from when the visual sets none: an
 *  Outline-color section must draw its encoded stroke (1px, the glyph's
 *  historical width); a quantitative glyph section mirrors the marks'
 *  outline width; everything else follows the theme (`null`). */
export const sectionOutlineWidthAuto = (
	members: ReadonlyArray<SwatchMember>,
	quantitative: boolean,
	marksOutlineWidth: number | null | undefined
): number | null => {
	if (members.includes("outlineHue")) return 1
	if (quantitative && isGlyphSection(members)) return marksOutlineWidth ?? 1
	return null
}

/** Swatch shape a section renders with — what the picker highlights, so it
 *  is always a shape the picker offers (legendSwatchControls' shapeOptions):
 *    glyphs  the visual's explicit glyph, else the marks' own shape (a
 *            rectangle / line can't carry a size or rotation; the theme's
 *            rectangle default doesn't apply);
 *    noRect  the visual's / theme's choice, with the rectangle standing in
 *            for the glyph those swatches draw instead — the marks' shape
 *            for Outline-color glyphs, the circle behind a dash line;
 *    all     the visual's / theme's choice as is. */
export const resolveSectionSwatchShape = (
	cfg: Pick<LegendConfig, "swatchShapes" | "hueLegendSwatchShape">,
	theme: Pick<Theme, "legendSwatchShape">,
	key: SwatchShapeChannel,
	members: ReadonlyArray<SwatchMember>,
	marksShape: number,
	ctx: SwatchContext = {}
): LegendSwatchShape => {
	const options = legendSwatchControls(members, ctx).shapeOptions
	if (options === "glyphs") {
		const choice = legendSwatchShape(cfg, key)
		return typeof choice === "number" ? choice : marksShape
	}
	const resolved = resolveLegendSwatchShape(cfg, theme, key)
	if (options === "noRect" && resolved === null)
		return members.includes("outlineHue") ? marksShape : 0
	return resolved
}

/** Outline width a section renders with: the visual's value, else the
 *  section's auto width (`sectionOutlineWidthAuto`), else the theme's. */
export const resolveSectionOutlineWidth = (
	cfg: Pick<LegendConfig, "swatchOutlineWidths" | "swatchOutlineWidth">,
	theme: Pick<Theme, "legendSwatchOutlineWidth">,
	key: SwatchShapeChannel,
	auto: number | null
): number => legendSwatchOutlineWidth(cfg, key) ?? auto ?? theme.legendSwatchOutlineWidth
