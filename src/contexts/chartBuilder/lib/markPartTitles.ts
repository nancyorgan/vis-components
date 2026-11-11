import type { ChannelConfigs } from "./channelConfig"
import type { ChartModeDef } from "./chartModes/types"
import { overlayOn } from "./colorSlots"
import type { Encodings } from "./types"

/** The subheader titles of the mark parts every aesthetic menu (Color,
 * Opacity, Saturation, Brightness, Pattern) shares. */
export type MarkPartTitles = {
	/** The marks' fill — the channel's own encoding (Color's hue, the overall
	 *  opacity, …). */
	fill: string
	/** The marks' outline — `outlineHue` / the Border opacity slot / the
	 *  Outline modulation slot. */
	outline: string
	/** The connection line — the Line slots (and, for color, the linked
	 *  line-palette editor). */
	line: string
}

/** Plain "Fill" / "Outline" / "Line" on their own. Where a SECOND filled
 * body sits beside the marks the plain names would be ambiguous, so the
 * marks' parts are named as the POINTS':
 *  - the polygon mode (radar): the series polygon has a body (Polygon fill)
 *    and an outline, which is the connection line — so its four targets read
 *    Point fill / Point outline / Connection line / Polygon fill;
 *  - a violin / box overlay: its body and outline sit beside the points'
 *    (Point fill / Point outline / Violin-box fill / Violin-box outline);
 *  - a line chart (points joined by a Connection line): the fill and
 *    outline style the POINTS on the line, beside the Line itself.
 *  - an area chart (the layer role): the body is the "Area fill" (plain
 *    "Fill" while the area is unfilled — the series color), the layer
 *    edge is the "Line", and the point markers on it are their own
 *    Point fill / Point outline targets (slots, gated on `areaPointsOn`).
 * One rule for every menu, so the titles can't drift between them. */
export const markPartTitles = (
	modeDef: Pick<ChartModeDef, "canvas">,
	configs: ChannelConfigs,
	encodings: Pick<Encodings, "connection">
): MarkPartTitles => {
	if (modeDef.canvas.connectionRole === "polygon")
		return { fill: "Point fill", outline: "Point outline", line: "Connection line" }
	if (overlayOn(configs))
		return { fill: "Point fill", outline: "Point outline", line: "Line" }
	if (modeDef.canvas.connectionRole === "layer")
		return {
			fill: configs.connection?.fill === "area" ? "Area fill" : "Fill",
			outline: "Line",
			line: "Line",
		}
	// The bar + line combo is a line role too, but its Fill is the BARS'
	// (its points have their own "Point fill" slot), so it keeps plain names.
	if (
		modeDef.canvas.connectionRole === "line" &&
		modeDef.canvas.lengthRole !== "measure" &&
		!!encodings.connection?.field
	)
		return { fill: "Point fill", outline: "Point outline", line: "Line" }
	return { fill: "Fill", outline: "Outline", line: "Line" }
}
