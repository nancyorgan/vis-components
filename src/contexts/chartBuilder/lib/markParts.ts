/** The mark parts each aesthetic menu shows, in display order.
 *
 *  Color, Opacity, Saturation and Brightness each list the chart's parts —
 *  the points' fill and outline, the line, an area or polygon body, the
 *  overlays — as subsections. This module is the ONE place that decides
 *  which subsections a menu shows for a chart, what each is titled, and in
 *  what order. The panels render what it returns; they no longer assemble
 *  the list themselves.
 *
 *  Why one place: the question "does this chart offer that option on that
 *  part?" has to have the same answer everywhere it is asked — the panel,
 *  the "edited" dots, the options matrix test. When each panel composed its
 *  own list the answers drifted (see `partsOffered`, and the matrix
 *  snapshot in `markParts.matrix.smoke.test.tsx`).
 *
 *  The per-part targets themselves — what each is called, which part it
 *  styles, when the chart draws it — are one table, `PART_TARGETS`
 *  (lib/partTargets); `colorSlots`, `opacitySlots` and `modulationSlots`
 *  are each menu's view of it, and this module arranges what they offer.
 *  (The Pattern menu's sections are `patternMenu`, in `lib/patternMenu` —
 *  apart only because it reads the pattern tiles, which this module, shared
 *  with the server, must not import.) Pure: no store, no React. */

import type { ChannelConfigs } from "./channelConfig"
import { getChartModeDef } from "./chartMode"
import type { ChartModeDef, FieldTypeLookup } from "./chartModes/types"
import { colorSlotsFor, type ColorSlotDef } from "./colorSlots"
import { markNoun, markPartTitles, partTitle } from "./markPartTitles"
import { modulationSlotsFor, type ModulationSlotDef } from "./modulationSlots"
import { opacitySlotsFor, type OpacitySlotDef } from "./opacitySlots"
import type { MapConfig } from "./mapConfig"
import { rugOn, type PartId, type TargetContext, type TargetPart } from "./partTargets"
import { RADAR_LINE_INHERIT } from "./radarLineSlot"
import { segmentsDrawn } from "./segmentsDrawn"
import type { Encodings } from "./types"

/** Everything the menus need to know about the chart being edited. */
export type PartsContext = {
	modeDef: ChartModeDef
	encodings: Encodings
	configs: ChannelConfigs
	/** The standalone "Density" display: the curve is drawn and the marks
	 *  themselves are not (`store/usePureDensityCurve`), so the marks' own
	 *  fill and outline have nothing to style. */
	pureDensityCurve: boolean
}

/** True when the chart is a PURE density curve — the standalone "Density"
 *  display on a lone quantitative position axis (mirrors ScatterPlot's
 *  single-variable-distribution detection, field-type check included). The
 *  renderer suppresses the marks while the standalone curve is on, so the
 *  marks' Fill and Outline have nothing to style and the Density curve
 *  targets take over. A histogram WITH a density overlay is different (its
 *  bars still render), and so is a stale `showDensityCurve` flag with both
 *  position axes mapped (the points render again). Without a type lookup the
 *  answer is false. */
export const isPureDensityCurve = (
	modeDef: Pick<ChartModeDef, "canvas">,
	encodings: Encodings,
	configs: ChannelConfigs,
	getType: FieldTypeLookup | undefined
): boolean => {
	// The standalone curve is one of scatter's axis overlays — declared per
	// mode as `canvas.statOverlays`, never compared by id.
	if (!modeDef.canvas.statOverlays || !getType) return false
	const loneQuantCurve = (axis: "x" | "y"): boolean => {
		const field = encodings[axis]?.field ?? null
		const other = encodings[axis === "x" ? "y" : "x"]?.field ?? null
		return (
			!!field &&
			!other &&
			getType(field) === "quantitative" &&
			configs[axis]?.distributionOverlay?.showDensityCurve === true
		)
	}
	return loneQuantCurve("x") || loneQuantCurve("y")
}

/** The context for a chart, from the same inputs the render path detects
 *  its mode from. */
export const partsContext = ({
	encodings,
	configs,
	mapConfig,
	getType,
}: {
	encodings: Encodings
	configs: ChannelConfigs
	mapConfig?: MapConfig
	/** The effective type of a field, respecting the user's overrides. */
	getType: FieldTypeLookup | undefined
}): PartsContext => {
	const modeDef = getChartModeDef(encodings, getType, configs, mapConfig)
	return {
		modeDef,
		encodings,
		configs,
		pureDensityCurve: isPureDensityCurve(modeDef, encodings, configs, getType),
	}
}

// ---------------------------------------------------------------------------
// What the chart draws

/** Which of the marks' parts the chart is drawing NOW. A control styles a
 *  part; when the part is absent the control has nothing to act on, so it
 *  is not offered. Every "should this control show?" question about a
 *  mark's part is answered here, from the mode's declared traits and the
 *  settings that switch a part on — never from a list of chart types. */
export type DrawnParts = {
	/** The chart's own marks are drawn at all. False only for the pure
	 *  density curve, which draws the curve in their place. */
	marks: boolean
	/** Point markers, sized by the Size row: a scatter's points, the markers
	 *  along a line, an area's edge or a radar polygon, a combo's points, a
	 *  map's dots and bubbles. */
	points: boolean
	/** The point markers are glyphs: they take a Shape and turn by Angle. */
	glyphs: boolean
	/** The marks are line segments (Length on a scatter): no glyph, and no
	 *  outline of their own. */
	segments: boolean
	/** The marks carry an outline of their own. */
	outline: boolean
	/** A connecting line: a line chart's, an area's edge, a radar polygon's
	 *  outline. */
	line: boolean
	/** Stems from each mark to an axis. They run from every mark, whether
	 *  or not its point marker is shown. */
	stems: boolean
	/** The rug along a histogram's or a density curve's axis. */
	rug: boolean
}

export const drawnParts = (ctx: PartsContext): DrawnParts => {
	const { modeDef, encodings, configs, pureDensityCurve } = ctx
	const { canvas } = modeDef
	const connected = !!encodings.connection?.field
	// A line chart and a radar draw their line once Connection is mapped; an
	// area chart's layers always carry their edge.
	const line =
		canvas.connectionRole === "layer" ||
		((canvas.connectionRole === "line" || canvas.connectionRole === "polygon") &&
			connected)
	const marks = !pureDensityCurve
	const segments = marks && segmentsDrawn(canvas.lengthRole, encodings, configs)
	// The Size row sizes point markers wherever the mode reads it as a mark
	// trait. Segments have a length, not a size; an area chart's markers
	// ride its Connection lines; and "Show points: No points" hides the
	// markers along any line.
	const points =
		marks &&
		!segments &&
		canvas.areaRole === "mark" &&
		(canvas.connectionRole !== "layer" || connected) &&
		!(line && (configs.connection?.pointSampling ?? "all") === "none")
	return {
		marks,
		points,
		glyphs: points && canvas.shapeRole === "glyph",
		segments,
		outline: marks && !segments,
		line,
		stems:
			marks &&
			canvas.connectionRole === "line" &&
			(configs.connection?.axisStem ?? "none") !== "none",
		rug: rugOn(configs),
	}
}

// ---------------------------------------------------------------------------
// The parts, and the one order every menu lists them in

export type { PartId } from "./partTargets"

/** THE order. Every menu lists the parts it offers in this order, so a part
 *  sits in the same place in Color, Opacity, Saturation and Brightness:
 *  the marks that are bodies (fill, then outline); then the line, what it
 *  encloses and the points on it; then the overlays. */
export const PART_ORDER: readonly PartId[] = [
	"markFill",
	"markOutline",
	"ribbon",
	"line",
	"body",
	"pointFill",
	"pointOutline",
	"stem",
	"regressionLine",
	"regressionBand",
	"violinFill",
	"violinOutline",
	"densityFill",
	"densityOutline",
	"rug",
]

/** The parts that are BODIES under a line or under points: an area's or a
 *  radar polygon's fill, a violin / box, a density curve's fill, a
 *  confidence band. They sit behind the marks they belong to, so their
 *  palette is the theme's FILL palette (pale versions of the marks'
 *  colors); every other part — lines, outlines, points — takes Color's own
 *  palette. One rule by the part's kind, so no menu picks a palette per
 *  target by hand. */
const BODY_PARTS: ReadonlySet<PartId> = new Set<PartId>([
	"body",
	"violinFill",
	"densityFill",
	"regressionBand",
])

/** Which theme palette a part's color control seeds and leads with. */
export const partPaletteKind = (part: PartId): "fill" | "categorical" =>
	BODY_PARTS.has(part) ? "fill" : "categorical"

/** `sections` in `PART_ORDER`. */
export const inPartOrder = <T extends { part: PartId }>(sections: T[]): T[] =>
	// Stable: two sections of one part keep the order they were listed in.
	sections
		.map((section, i) => ({ section, i }))
		.sort(
			(a, b) =>
				PART_ORDER.indexOf(a.section.part) - PART_ORDER.indexOf(b.section.part) ||
				a.i - b.i
		)
		.map(({ section }) => section)

/** The marks are stacked layers — an area chart: its own outline is its
 *  Line, its fill is the body under it, and its points are a second part. */
export const isLayered = (modeDef: Pick<ChartModeDef, "canvas">): boolean =>
	modeDef.canvas.connectionRole === "layer"

/** The parts the marks' own fill and outline are, for this chart: an area
 *  chart's fill is the body under its Line; point marks are the points;
 *  everything else is a body of its own. */
export const ownParts = (
	modeDef: Pick<ChartModeDef, "canvas">
): { fill: PartId; outline: PartId } => {
	if (isLayered(modeDef)) return { fill: "body", outline: "line" }
	if (modeDef.canvas.mark === "point") return { fill: "pointFill", outline: "pointOutline" }
	return { fill: "markFill", outline: "markOutline" }
}

/** The part a target styles on this chart. The table names it, except for
 *  the marks' own outline (Opacity's `border`, the modulation `outline`),
 *  which is whichever part `ownParts` says — on an area chart, its Line. */
const partOf = (part: TargetPart, own: { outline: PartId }): PartId =>
	part === "ownOutline" ? own.outline : part

/** The table answers "does the chart draw this target's part?" from the
 *  mode and the setting that switches the part on. Whether the MARKS are
 *  drawn at all — they are not on a pure density curve — is known only
 *  here, and stems run from the marks: no marks, no stems to style. So
 *  the Stem is listed exactly where the Size menu lists its thickness. */
const targetDrawn = (def: { part: TargetPart }, parts: DrawnParts): boolean =>
	def.part !== "stem" || parts.stems

/** The chart, as the target table asks about it. */
const targetContext = ({ modeDef, encodings, configs }: PartsContext): TargetContext => ({
	canvas: modeDef.canvas,
	encodings,
	configs,
})

/** The title of the ring around the point markers of a chart whose marks
 *  are not points (an area chart's, whose own outline is its Line). */
const POINT_OUTLINE_TITLE = partTitle("point", "outline")

// ---------------------------------------------------------------------------
// Color

/** One subsection of the Color menu. */
export type ColorSection = { part: PartId } & (
	/** The marks' fill: the Color encoding itself. */
	| { kind: "fill"; title: string; hideVaryBy: boolean }
	/** The marks' own outline: the `outlineHue` encoding / `shape.outlineColor`. */
	| { kind: "outline"; title: string }
	/** An area chart's Line: colored per layer through the linked
	 *  line-palette editor rather than a slot. */
	| { kind: "areaLine"; title: string }
	/** A per-part color target. `radarLine` marks the radar's connection
	 *  line, which reads (and clears) the polygon outline's legacy fields. */
	| { kind: "slot"; def: ColorSlotDef; radarLine: boolean }
)

/** The Color menu's subsections, in `PART_ORDER`. */
export const colorSections = (ctx: PartsContext): ColorSection[] => {
	const { modeDef, encodings, configs } = ctx
	const titles = markPartTitles(modeDef, configs, encodings)
	const isArea = isLayered(modeDef)
	const isPolygon = modeDef.canvas.connectionRole === "polygon"
	const parts = drawnParts(ctx)
	const slots = colorSlotsFor(targetContext(ctx)).filter((d) => targetDrawn(d, parts))
	const own = ownParts(modeDef)

	const out: ColorSection[] = []
	if (isArea) out.push({ part: "line", kind: "areaLine", title: titles.outline })
	// The area modes set the color field on the shelf row (fill and outline
	// are linked to the series), so the in-panel selector would repeat it.
	if (parts.marks)
		out.push({ part: own.fill, kind: "fill", title: titles.fill, hideVaryBy: isArea })
	if (!isArea && parts.outline)
		out.push({ part: own.outline, kind: "outline", title: titles.outline })
	// Area-chart points carry the marks' own outline, the same control (and
	// theme defaults) as a scatter or line chart's.
	if (isArea && parts.outline && slots.some((d) => d.key === "areaPointFill"))
		out.push({ part: "pointOutline", kind: "outline", title: POINT_OUTLINE_TITLE })
	for (const def of slots) {
		const radarLine = isPolygon && def.key === "line"
		out.push({
			part: partOf(def.part, own),
			kind: "slot",
			// The radar's Line is its polygon outline: untouched, it matches
			// each polygon's fill.
			def: radarLine ? { ...def, label: titles.line, inherit: RADAR_LINE_INHERIT } : def,
			radarLine,
		})
	}
	return inPartOrder(out)
}

// ---------------------------------------------------------------------------
// Opacity

/** One subsection of the Opacity menu. */
export type OpacitySection = { part: PartId } & (
	/** The marks' fill: the Opacity encoding itself. */
	| { kind: "fill"; title: string; hideVaryBy: boolean }
	/** A per-part opacity target, titled for this chart. */
	| { kind: "slot"; def: OpacitySlotDef; hideVaryBy: boolean }
)

/** The Opacity menu's subsections, in `PART_ORDER`. */
export const opacitySections = (ctx: PartsContext): OpacitySection[] => {
	const { modeDef, encodings, configs } = ctx
	const titles = markPartTitles(modeDef, configs, encodings)
	const parts = drawnParts(ctx)
	const own = ownParts(modeDef)
	// The area modes link fill and outline to the series (one layer = one
	// value): the in-panel "Vary by" repeats the shelf's Opacity row, and
	// the outline's opacity is resolved per layer, so both selectors go.
	const linked = isLayered(modeDef)
	// Marks with no outline of their own (the pure density curve, which
	// draws none; line segments) leave the Border nothing to act on.
	const slots = opacitySlotsFor(targetContext(ctx)).filter(
		(d) => (parts.outline || d.key !== "border") && targetDrawn(d, parts)
	)
	const section = (def: OpacitySlotDef): OpacitySection => ({
		// The Border target is the marks' own outline (an area's Line).
		part: partOf(def.part, own),
		kind: "slot",
		// The Border target is the marks' outline and the Line target the
		// connection line — titled per chart, like the Fill.
		def:
			def.key === "border"
				? { ...def, label: titles.outline }
				: def.key === "line"
					? { ...def, label: titles.line }
					: def,
		hideVaryBy: linked,
	})
	// Flow diagrams draw nothing from the overall opacity (nodes and ribbons
	// each read their own target), and the pure density curve's fill is the
	// Density curve fill target.
	const hideFill = modeDef.canvas.flowGeometry !== undefined || !parts.marks
	return inPartOrder([
		...(hideFill
			? []
			: [{ part: own.fill, kind: "fill" as const, title: titles.fill, hideVaryBy: linked }]),
		...slots.map(section),
	])
}

// ---------------------------------------------------------------------------
// Saturation / Brightness

/** One subsection of the Saturation or Brightness menu. */
export type ModulationSection = { part: PartId } & (
	/** The marks' fill: the channel's own encoding. */
	| { kind: "fill"; title: string }
	/** A per-part target, titled for this chart. */
	| { kind: "slot"; def: ModulationSlotDef }
)

/** The Saturation / Brightness menu's subsections (the two channels offer
 *  the same parts), in `PART_ORDER`. */
export const modulationSections = (ctx: PartsContext): ModulationSection[] => {
	const { modeDef, encodings, configs } = ctx
	const titles = markPartTitles(modeDef, configs, encodings)
	const own = ownParts(modeDef)
	const parts = drawnParts(ctx)
	// No outline drawn (the pure density curve, line segments): no outline
	// to shade.
	const slots = modulationSlotsFor(targetContext(ctx)).filter(
		(d) => (parts.outline || d.key !== "outline") && targetDrawn(d, parts)
	)
	const section = (def: ModulationSlotDef): ModulationSection => ({
		part: partOf(def.part, own),
		kind: "slot",
		def:
			def.key === "outline"
				? { ...def, label: titles.outline }
				: def.key === "line"
					? { ...def, label: titles.line }
					: def,
	})
	return inPartOrder([
		// The pure density curve draws no marks to shade.
		...(parts.marks ? [{ part: own.fill, kind: "fill" as const, title: titles.fill }] : []),
		...slots.map(section),
	])
}

// ---------------------------------------------------------------------------
// Size

/** One subsection of the Size menu: a stroke the chart draws, whose
 *  thickness is set there. (The points' size is the Size encoding itself
 *  and leads the menu.) */
export type SizeSection = {
	part: PartId
	title: string
	/** Which stored thickness the section edits:
	 *  - `outline`: the marks' own outline (`shape.outlineWidth`) — a
	 *    point's ring, a bar's, slice's, cell's, region's or node's outline;
	 *  - `line`: the connecting line (`connection.thickness`, with its
	 *    "Vary by");
	 *  - `stem`: the stems (`connection.stemThickness`; untouched, the
	 *    line's thickness);
	 *  - `densityOutline`: the density curve's line
	 *    (`shape.densityCurveOutlineWidth`);
	 *  - `segment`: line segments (`length.segmentThickness`, with its
	 *    "Vary by");
	 *  - `violinOutline`: the violin / box overlay's strokes
	 *    (`shape.distributionOutlineWidth`);
	 *  - `regressionLine`: the regression line
	 *    (`x.regression.strokeWidth`);
	 *  - `regionOutline`: a dot map's regions, behind its points
	 *    (`shape.regionOutlineWidth`; untouched, the points' thickness). */
	kind:
		| "outline"
		| "line"
		| "stem"
		| "segment"
		| "violinOutline"
		| "densityOutline"
		| "regressionLine"
		| "regionOutline"
	/** The stroke can differ from mark to mark on this chart, so the section
	 *  offers "Vary by": the marks' own outline, lines grouped by the
	 *  Connection variable (a line chart's, a radar's — an area chart's
	 *  layers are grouped by Color and take one thickness) and line
	 *  segments. The overlays' strokes take one thickness. */
	varyBy: boolean
}

/** The title of the Size menu's leading section — the marks the Size
 *  encoding sizes: the "Point" wherever point markers are drawn (a
 *  scatter's, a line's, a combo's, a map's dots and bubbles), the "Circle"
 *  of a packed-circles chart, whose radii the layout computes. */
export const sizedMarkTitle = (modeDef: Pick<ChartModeDef, "canvas">): string =>
	markNoun(modeDef.canvas.areaRole === "layoutRadius" ? modeDef.canvas.mark : "point")

/** The title of a chart's stems, wherever a menu lists them. */
export const STEM_TITLE = "Stem"

/** The Size menu's thickness subsections, in `PART_ORDER`. Every stroke
 *  the chart draws has one; a stroke it does not draw has none. The overlay
 *  strokes are listed exactly when Color lists them, under the same title. */
export const sizeSections = (ctx: PartsContext): SizeSection[] => {
	const { modeDef, encodings, configs } = ctx
	const titles = markPartTitles(modeDef, configs, encodings)
	const parts = drawnParts(ctx)
	const own = ownParts(modeDef)
	const isArea = isLayered(modeDef)
	const colorTitles = new Map(colorSections(ctx).map((s) => [s.part, sectionTitle(s)]))

	const out: SizeSection[] = []
	// An area chart's own outline is its Line (below); the ring this
	// thickness draws there is around its point markers.
	if (isArea ? parts.points : parts.outline)
		out.push({
			part: isArea ? "pointOutline" : own.outline,
			kind: "outline",
			title: isArea ? POINT_OUTLINE_TITLE : titles.outline,
			varyBy: true,
		})
	// Segments are one stroke: the mark itself.
	if (parts.segments)
		out.push({ part: own.fill, kind: "segment", title: titles.fill, varyBy: true })
	if (parts.line) {
		const role = modeDef.canvas.connectionRole
		out.push({
			part: "line",
			kind: "line",
			title: titles.line,
			varyBy: !!encodings.connection?.field && (role === "line" || role === "polygon"),
		})
	}
	if (parts.stems)
		out.push({ part: "stem", kind: "stem", title: STEM_TITLE, varyBy: false })
	for (const [part, kind] of [
		["violinOutline", "violinOutline"],
		["densityOutline", "densityOutline"],
		["regressionLine", "regressionLine"],
	] as const) {
		const title = colorTitles.get(part)
		if (title !== undefined) out.push({ part, kind, title, varyBy: false })
	}
	// A dot map's regions: listed when Color lists their outline.
	const regionOutline = colorSections(ctx).find(
		(s) => s.kind === "slot" && s.def.key === "geoRegionStroke"
	)
	if (regionOutline)
		out.push({
			part: regionOutline.part,
			kind: "regionOutline",
			title: sectionTitle(regionOutline),
			varyBy: false,
		})
	return inPartOrder(out)
}

// ---------------------------------------------------------------------------
// Across the menus

/** The parts each menu offers for this chart, by title, in display order. */
export type PartsOffered = {
	color: string[]
	opacity: string[]
	saturation: string[]
	brightness: string[]
}

const sectionTitle = (
	section: ColorSection | OpacitySection | ModulationSection
): string => (section.kind === "slot" ? section.def.label : section.title)

/** The per-part targets each menu offers for a chart, by storage key. The
 *  stored targets of a part the chart does not show are leftovers from
 *  another chart type: nothing draws them and no control can clear them, so
 *  anything asking "has this menu been edited?" must not count them. */
export type OfferedTargets = {
	/** Keys of `colorSlots`. */
	color: ReadonlySet<string>
	/** Keys of `opacitySlots`. */
	opacity: ReadonlySet<string>
	/** Keys of `saturationSlots` / `brightnessSlots`. */
	modulation: ReadonlySet<string>
	/** The Size menu's thickness sections, by kind. */
	size: ReadonlyMap<SizeSection["kind"], SizeSection>
	/** Which parts the chart draws: a setting that styles an absent part is
	 *  a leftover too (a line thickness on a chart with no line). */
	parts: DrawnParts
}

const slotKeys = (
	sections: ReadonlyArray<ColorSection | OpacitySection | ModulationSection>
): Set<string> => {
	const keys = new Set<string>()
	for (const section of sections) if (section.kind === "slot") keys.add(section.def.key)
	return keys
}

export const offeredTargets = (ctx: PartsContext): OfferedTargets => ({
	color: slotKeys(colorSections(ctx)),
	opacity: slotKeys(opacitySections(ctx)),
	modulation: slotKeys(modulationSections(ctx)),
	size: new Map(sizeSections(ctx).map((section) => [section.kind, section])),
	parts: drawnParts(ctx),
})

/** Which parts each menu lists for a chart. The rule is that these four
 *  lists are the same list: a part that can be colored can be made
 *  transparent, saturated and brightened. The only differences allowed are
 *  the written ones in `PART_EXCEPTIONS`. */
export const partsOffered = (ctx: PartsContext): PartsOffered => {
	const modulation = modulationSections(ctx).map(sectionTitle)
	return {
		color: colorSections(ctx).map(sectionTitle),
		opacity: opacitySections(ctx).map(sectionTitle),
		saturation: modulation,
		brightness: modulation,
	}
}

/** The menus that list parts. */
export type PartMenu = keyof PartsOffered

/** A part a menu deliberately does NOT list, and why. The rule is "every
 *  part in every menu"; an exception has to be written down here with its
 *  reason, so a gap is a decision rather than something that drifted. */
export const PART_EXCEPTIONS: ReadonlyArray<{
	part: PartId
	menus: readonly PartMenu[]
	reason: string
}> = [
	{
		part: "ribbon",
		menus: ["color", "saturation", "brightness"],
		reason:
			"A flow diagram's ribbon takes its SOURCE node's fill — color, saturation and brightness alike — so a ribbon reads as belonging to the node it leaves. Only its opacity is its own (ribbons are drawn translucent over each other).",
	},
]

/** The same lists as `partsOffered`, by part instead of by title. */
export const partIdsOffered = (ctx: PartsContext): Record<PartMenu, PartId[]> => {
	const modulation = modulationSections(ctx).map((s) => s.part)
	return {
		color: colorSections(ctx).map((s) => s.part),
		opacity: opacitySections(ctx).map((s) => s.part),
		saturation: modulation,
		brightness: modulation,
	}
}
