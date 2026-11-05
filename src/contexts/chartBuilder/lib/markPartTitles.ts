import type { ChannelConfigs } from "./channelConfig"
import type { ChartModeDef } from "./chartModes/types"
import { overlayOn } from "./colorSlots"

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
 *    (Point fill / Point outline / Violin-box fill / Violin-box outline).
 * One rule for every menu, so the titles can't drift between them. */
export const markPartTitles = (
	modeDef: Pick<ChartModeDef, "canvas">,
	configs: ChannelConfigs
): MarkPartTitles => {
	if (modeDef.canvas.connectionRole === "polygon")
		return { fill: "Point fill", outline: "Point outline", line: "Connection line" }
	if (overlayOn(configs))
		return { fill: "Point fill", outline: "Point outline", line: "Line" }
	return { fill: "Fill", outline: "Outline", line: "Line" }
}
