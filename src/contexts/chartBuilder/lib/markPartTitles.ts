import type { ChannelConfigs } from "./channelConfig"
import type { ChartModeDef, MarkKind } from "./chartModes/types"
import { segmentsDrawn } from "./segmentsDrawn"
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

/** The one word for a connecting line — a line chart's, an area's edge, a
 *  radar polygon's outline. */
export const LINE_TITLE = "Line"

/** What a mode's marks are called (`canvas.mark`), capitalized to lead a
 *  section title. */
const MARK_NOUN: Record<MarkKind, string> = {
	point: "Point",
	bar: "Bar",
	area: "Area",
	slice: "Slice",
	cell: "Cell",
	region: "Region",
	circle: "Circle",
	node: "Node",
}

/** A mark's name on its own, to title what belongs to the whole mark (its
 *  size): "Point", "Circle". */
export const markNoun = (mark: MarkKind): string => MARK_NOUN[mark]

/** A part's title: the mark, then which part of it — "Bar fill", "Slice
 *  outline". */
export const partTitle = (mark: MarkKind, part: "fill" | "outline"): string =>
	`${MARK_NOUN[mark]} ${part}`

/** The titles ALWAYS name the mark: "Point fill" and "Point outline" on a
 * scatter, line chart or radar; "Bar fill" / "Bar outline", "Slice fill" /
 * "Slice outline", "Cell …", "Region …" elsewhere — never a bare "Fill"
 * that leaves the reader to work out which fill. The connecting line is
 * the "Line" on every chart that draws one. A chart with a second filled
 * part names that one too (a combo's and a bubble map's "Point fill", a
 * radar's "Polygon fill", a violin's "Violin / box fill"), in the slot
 * registries.
 *
 * Two marks have no fill-and-outline pair:
 *  - an area chart (the layer role): the body is the "Area fill" and its
 *    edge IS the "Line" (plain "Fill" while the area is unfilled — the
 *    series color);
 *  - line segments (Length on a scatter): one stroke, the "Segment".
 * One rule for every menu, so the titles can't drift between them. */
export const markPartTitles = (
	modeDef: Pick<ChartModeDef, "canvas">,
	configs: ChannelConfigs,
	encodings: Partial<Pick<Encodings, "connection" | "length">>
): MarkPartTitles => {
	const { canvas } = modeDef
	if (canvas.connectionRole === "layer")
		return {
			fill: configs.connection?.fill === "area" ? partTitle("area", "fill") : "Fill",
			outline: LINE_TITLE,
			line: LINE_TITLE,
		}
	if (segmentsDrawn(canvas.lengthRole, encodings, configs))
		return { fill: "Segment", outline: "Segment outline", line: LINE_TITLE }
	return {
		fill: partTitle(canvas.mark, "fill"),
		outline: partTitle(canvas.mark, "outline"),
		line: LINE_TITLE,
	}
}
