/** The Pattern menu's sections: which parts of a chart it styles, what each
 *  is titled, and in what order — decided here, once, like the other menus'
 *  sections in `lib/markParts`. The panel renders what this returns.
 *
 *  Pattern is the one menu whose meaning depends on the chart: a fill
 *  pattern on marks that are bodies, a dash on a line, both on a line with
 *  points. Pure: no store, no React. */

import {
	inPartOrder,
	isLayered,
	ownParts,
	type PartId,
	type PartsContext,
} from "./markParts"
import { LINE_TITLE, markPartTitles, partTitle } from "./markPartTitles"
import { overlayOn, regressionOn } from "./partTargets"
import { resolveSegmentPatternContext, type SegmentPatternContext } from "./segmentPattern"

/** How the Pattern menu reads the chart — what a "pattern" IS there:
 *  - `fill`: no line drawn. Pattern is the marks' fill pattern (bars,
 *    slices, points, an area with no Connection).
 *  - `compound`: a line with points on it. Pattern drives both the Line's
 *    dash and the fill of the marks, each in its own section.
 *  - `dashOnly`: a line with its points hidden ("Show points: No points").
 *    Pattern is the Line's dash; only bodies are left to fill.
 *  - `segmentDash`: thin line segments (Length on a scatter, no
 *    Connection). Pattern is the segments' dash. */
export type PatternMode = "fill" | "compound" | "dashOnly" | "segmentDash"

/** One part the Pattern menu styles. */
export type PatternSection = {
	part: PartId
	/** What its picks are:
	 *  - `fill`: the fill pattern of the marks themselves (the Pattern
	 *    encoding's own picks) — on an area chart, the body's;
	 *  - `lineDash`: the Line's dash, with its range and gap fill;
	 *  - `segmentDash`: the dash of thin line segments;
	 *  - `pointOutlineDash`: the dash of the ring around a radar's points;
	 *  - `polygonFill`, `areaPointFill`, `violinFill`: a second filled
	 *    part with picks of its own (`pattern.polygon*` / `areaPoint*` /
	 *    `violin*`);
	 *  - `regressionDash`: the regression line's dash. */
	kind:
		| "fill"
		| "lineDash"
		| "segmentDash"
		| "pointOutlineDash"
		| "polygonFill"
		| "areaPointFill"
		| "violinFill"
		| "regressionDash"
	title: string
	/** The section sits under its title. False where it is the menu's one
	 *  kind of control and is listed bare, with no header. */
	titled: boolean
}

/** The Pattern menu for a chart: how it reads Pattern, and its sections in
 *  the order it shows them. */
export type PatternMenu = {
	mode: PatternMode
	sections: PatternSection[]
	/** The segments' pattern state, while line segments draw and no line
	 *  owns the dash (the "Segments" toggle: dash or fill); else null. */
	segments: SegmentPatternContext | null
}

/** The points on a chart whose marks are not points (an area chart's), and
 *  the ring around a radar's. */
const POINT_FILL_TITLE = partTitle("point", "fill")
const POINT_OUTLINE_TITLE = partTitle("point", "outline")
const POLYGON_FILL_TITLE = "Polygon fill"
const VIOLIN_FILL_TITLE = "Violin / box fill"
const REGRESSION_LINE_TITLE = "Regression line"

/** The Pattern menu's sections. The panel renders what this returns; like
 *  the other menus' `*Sections`, it is the one place that decides which
 *  parts the menu offers for a chart and what each is titled.
 *
 *  `patternMapped`: a variable drives Pattern — a field on the Pattern row,
 *  or a hierarchy's derived source. It changes which form the menu takes
 *  (per-category rows), never which parts it styles.
 *
 *  The sections are in `PART_ORDER`, like every menu's. */
export const patternMenu = (ctx: PartsContext, patternMapped: boolean): PatternMenu => {
	const { modeDef, encodings, configs } = ctx
	const { canvas } = modeDef
	const titles = markPartTitles(modeDef, configs, encodings)
	const own = ownParts(modeDef)
	const layered = isLayered(modeDef)
	// Connection draws a line except where it is a KEY — a map's region
	// join, a tree's parent, a flow's source. There the marks take fill
	// patterns only.
	const lineDrawn =
		!!encodings.connection?.field &&
		!(canvas.coordFamily === "geo" || canvas.connectionRole === "key")
	const pointsHidden = (configs.connection?.pointSampling ?? "all") === "none"
	// With a line drawn the line owns the dash; segments are asked about
	// only without one.
	const segments = lineDrawn
		? null
		: resolveSegmentPatternContext({
				lengthRole: canvas.lengthRole,
				encodings,
				channelConfigs: configs,
				patternMapped,
			})
	const mode: PatternMode =
		segments?.mode === "dash"
			? "segmentDash"
			: !lineDrawn
				? "fill"
				: pointsHidden
					? "dashOnly"
					: "compound"

	const isPolygon = canvas.connectionRole === "polygon"
	// A filled radar's polygons have a body to pattern, apart from their
	// points.
	const polygonFilled = isPolygon && lineDrawn && configs.connection?.fillPolygon === true
	// An area chart's body is what the base fill picks pattern; an unfilled
	// area has none. Its points, while they draw, are a part of their own.
	const areaFilled = layered && configs.connection?.fill === "area"
	const areaPoints = layered && lineDrawn && !pointsHidden
	// The violin / box body: listed exactly when the chart draws one — the
	// overlay is switched on, on a chart that draws overlays. (A switch left
	// on from when the chart was a scatter draws nothing on a bar chart.)
	const violin = canvas.statOverlays && overlayOn(configs)
	const baseFillTitle = layered ? partTitle("area", "fill") : titles.fill

	const out: PatternSection[] = []
	const add = (
		part: PartId,
		kind: PatternSection["kind"],
		title: string,
		titled = true
	): void => {
		out.push({ part, kind, title, titled })
	}
	const addViolin = (): void => {
		if (violin) add("violinFill", "violinFill", VIOLIN_FILL_TITLE)
	}
	switch (mode) {
		case "compound":
			add("line", "lineDash", LINE_TITLE)
			if (!layered || areaFilled) add(own.fill, "fill", baseFillTitle)
			if (isPolygon) add("pointOutline", "pointOutlineDash", POINT_OUTLINE_TITLE)
			if (polygonFilled) add("body", "polygonFill", POLYGON_FILL_TITLE)
			if (areaPoints) add("pointFill", "areaPointFill", POINT_FILL_TITLE)
			addViolin()
			break
		case "dashOnly":
			// One kind of control once a variable is mapped (a dash per
			// category), so the list goes bare.
			add("line", "lineDash", LINE_TITLE, !patternMapped)
			if (polygonFilled) add("body", "polygonFill", POLYGON_FILL_TITLE)
			// No points, but a filled area still has a body to pattern.
			if (areaFilled) add("body", "fill", baseFillTitle)
			addViolin()
			break
		case "segmentDash":
			add(own.fill, "segmentDash", titles.fill, false)
			addViolin()
			break
		case "fill":
			// Beside the Violin / box fill the marks' own picks get a header
			// too, so the two read as peers; alone they are listed bare.
			add(own.fill, "fill", titles.fill, violin)
			addViolin()
			break
	}
	// The regression line's dash, where the other menus list the line.
	if (canvas.statOverlays && regressionOn(configs))
		add("regressionLine", "regressionDash", REGRESSION_LINE_TITLE)
	return { mode, sections: inPartOrder(out), segments }
}
