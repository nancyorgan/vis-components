import { max } from "d3-array"
import { useAtomValue } from "jotai"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelAlignment,
	type DataLabelsConfig,
	type HueConfig,
	type LabelPointsScope,
} from "../../lib/channelConfig"
import { resolveOutwardAlignment } from "../../lib/polarLabelAlignment"
import {
	alignBoxToAnchorEdge,
	labelBlockHeight,
	labelHeight,
	labelWidth,
	leaderLineSegment,
	nudgeOverlaps,
	selectEndpointsPerSeries,
	spreadOverlaps2D,
	type LabelBox,
	type LabelVAlign,
} from "../../lib/dataLabelsLayout"
import {
	labelKeysFor,
	labelPieceSplit,
	labelScopeFor,
	normalizeComposedLabels,
	pieceKey,
	populationOverrides,
	populationsAtTag,
	resolveLabelSelection,
	templateFields,
	type LabelPopulation,
	type LabelSelection,
} from "../../lib/dataLabelsSelection"
import { labelEntries, labelEntry } from "../../lib/labelPieces"
import {
	buildLabelSegments,
	labelHueScaleParts,
	resolveFieldBackground,
	resolveFieldFont,
	resolveFieldFontOver,
	resolveFieldSizePx,
	resolveLabelFill,
	resolveLabelSize,
	resolveLayerBackground,
	sameBackground,
	type ResolvedLabelBackground,
	type ResolvedLabelFont,
} from "../../lib/dataLabelsStyle"
import { ptToPx } from "../../lib/fontUnit"
import { effectiveType } from "../../lib/fieldType"
import { composedLabelOnPanel, dataLabelsOnPanel } from "../../lib/facetScope"
import {
	colorLinkSource,
	linkedCategoryColors,
	withLinkedColors,
} from "../../lib/linkedHueColors"
import {
	renderMultilineTspans,
	wrapByCharCount,
	wrapSegments,
} from "../../lib/multilineText"
import {
	applyHueScale,
	applyPositionScale,
	makeHueScale,
	type HueScale,
	type PositionScale,
} from "../../lib/scales"
import {
	firstMatchingRule,
	resolveRuleColor,
	type RuleRows,
} from "../../lib/textColorRules"
import {
	emptyDataLabelsEncodings,
	type DataLabelsEncodings,
	type FieldType,
} from "../../lib/types"
import {
	currentEncodingsAtom,
	currentFieldOverridesAtom,
} from "../../store/atoms"
import {
	renderChannelConfigsAtom,
	renderDataLabelsConfigAtom,
	renderDataLabelsEncodingsAtom,
} from "../../store/renderConfigs"
import { rowHighlight, useLegendHighlight } from "../../store/useLegendHighlight"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useFacetPanelKey } from "./plotCanvas/FacetPanelContext"

/** A pre-computed label position. Renderers like BarPlot / AreaPlot
 * compute these from their aggregation slices so labels sit at slice
 * centers (respecting stack / group / overlay layout) instead of being
 * placed at every raw row's (x, y) — which would clump labels into a
 * single category band. */
export type DataLabelAnchor = {
	cx: number
	cy: number
	/** Stable key for React reconciliation. */
	key: string
	/** Pre-formatted label text. When `null`, the layer skips this anchor.
	 * Bar / area renderers format the slice's measure (or the user's value
	 * field) into a string up-front. */
	label: string | null
	/** Raw value used when the user has mapped a hue field — looked up
	 * against the layer's hue scale. `undefined` when no hue is involved
	 * (e.g. position-only labels). */
	hueValue?: unknown
	/** Raw value used when the user has mapped a size field. */
	sizeValue?: unknown
	/** Explicit series identity for the "Which labels" endpoint ranking.
	 *  Bars set it from their stack / group layout per the label scope
	 *  (`DataLabelsConfig.labelPointsScope`); renderers that don't set it
	 *  fall back to the hue value (every slice in a stack shares one hue). */
	series?: string
	/** Explicit order within `series` (see `LabelBox.rank`). Set together
	 *  with `series`; absent → pixel-position ranking. */
	rank?: number
	/** The same identity resolved under EVERY scope, so each composed label
	 *  can be ranked by its own "Of each" choice
	 *  (`DataLabelsConfig.fieldLabelPointsScope`). `series` / `rank` above
	 *  stay the layer-wide scope's pair — what single-field labels and
	 *  renderers that set no map use. Bars / areas / pies set it via
	 *  `labelSeriesResolverAll`. */
	seriesByScope?: Record<LabelPointsScope, { series: string; rank: number }>
	/** Raw numeric value backing the label, when known. Feeds the
	 * conditional text-color rules — the formatted `label` string isn't
	 * sufficient because rules compare against the underlying number, not
	 * its rounded/decimaled display form. */
	labelValue?: unknown
	/** Legend-hover fade multiplier for this anchor's mark (1 = fully
	 * opaque). Aggregating renderers resolve it from their own slice
	 * highlight so a label recedes with the slice it annotates instead of
	 * staying bright over a faded bar / area / wedge. Unset → no fade. */
	opacityMul?: number
	/** Pre-resolved label fill. Layout renderers (`positionGate: "layout"`)
	 * resolve color themselves — their hierarchy-derived sources (top-level
	 * group / nesting depth) have no row value to look up — so the layer
	 * takes this verbatim instead of running its hue lookup. */
	fill?: string
	/** Pre-resolved font size in PX, same reason as `fill` (depth-driven
	 * sizing lives in the layout renderer's style resolvers). */
	fontSize?: number
	/** Multi-field labels: the row the layer composes the label from — one
	 * synthetic record per slice carrying the category, the group (hue /
	 * pattern / …) values, the measure, and every selected label field
	 * aggregated over the slice's rows (numeric → sum, else first non-empty;
	 * the same rule as `textValue`). When present and the Value mapping is
	 * multi-field, the layer arranges it with the templates and ignores
	 * `label`; without it the anchor stays pre-formatted and draws its
	 * `label` wherever any composed label is shown. Bars and pies set it;
	 * area / tile anchors don't yet. */
	row?: Record<string, unknown>
	/** Multi-field, layout renderers only: the composed labels (ids) THIS
	 * anchor draws — the layout already dropped the ones with nothing to
	 * say for the node and stacked the rest (`fieldPlacements`). Absent =
	 * every label. */
	labelKeys?: readonly string[]
	/** The dataset rows behind the anchor's mark (a bar slice's, an area
	 * layer cell's, a wedge's, a map shape's) — what `{Variable}` position /
	 * text-color rules test, passing only when every row does. Absent → such
	 * rules don't fire on this anchor. */
	sourceRows?: readonly Record<string, unknown>[]
	/** Which edge of the label block sits on `cy`. Renderers that place
	 * labels against a mark edge set it so a tall (wrapped) label stays on
	 * the intended side: an area's "inside, near end" anchors the TOP of the
	 * block just under the layer's edge; "inside, near base" / "outside the
	 * top edge" anchor the BOTTOM. Applied by the layer after wrapping and
	 * before overlap avoidance (`alignBoxToAnchorEdge`). Absent = centered,
	 * the historical placement. */
	vAlign?: LabelVAlign
	/** Forced text alignment: a bar label placed BESIDE a vertical bar
	 * (`DataLabelsConfig.barLabelSide`) hangs away from the bar — "left"
	 * starts the text at the anchor (right of the bar), "right" ends it
	 * there (left of the bar). Wins over the layer / per-variable /
	 * series-end Alignment settings, which the panel hides while a side is
	 * set. Absent = the user's alignment. */
	hAlign?: "left" | "right"
	/** What the "outward" Alignment resolves to for THIS label: the side
	 * away from the figure's center at the label's angle
	 * (`lib/polarLabelAlignment.ts`). Set by the polar renderers (pies,
	 * sunburst rings); absent, outward reads as centered. Unlike `hAlign`
	 * it only applies when the user picked outward. */
	outwardAlign?: "left" | "center" | "right"
	/** Separate-variables mode on bars / pies: a variable's OWN resolved
	 * point and hanging alignment (`DataLabelsConfig.fieldBarPlacements` /
	 * `fieldPolarPlacements`), keyed by field. The layer builds that
	 * variable's box from this instead of the anchor's `cx` / `cy` /
	 * `hAlign` / `vAlign` / `outwardAlign`; fields without an entry use the
	 * anchor's base point. */
	fieldPlacements?: Record<
		string,
		{
			cx: number
			cy: number
			hAlign?: "left" | "right"
			vAlign?: LabelVAlign
			outwardAlign?: "left" | "center" | "right"
		}
	>
}

type Props = {
	/** Raw dataset rows. Used when `anchors` is omitted — one label per
	 * row at (xScale(row[xField]), yScale(row[yField])). */
	rows: ReadonlyArray<Record<string, unknown>>
	xScale: PositionScale | null
	yScale: PositionScale | null
	xType: FieldType | null
	yType: FieldType | null
	/** Optional row filter — used by faceted panels so each panel only
	 * draws its own subset of labels. Ignored when `anchors` is set. */
	rowFilter?: (row: Record<string, unknown>) => boolean
	/** Pre-computed label positions. When provided, the layer iterates
	 * `anchors` instead of `rows` — used by aggregating renderers (bars,
	 * areas) so labels sit at slice centers and respect stack / group
	 * layout instead of clumping at raw row positions. */
	anchors?: readonly DataLabelAnchor[]
	/** Which position channels gate the layer on. `"xy"` (default) wants
	 * `x` + `y` mapped; `"polar"` (pies) wants `angle` + `r` mapped — though
	 * legacy `x` + `y` still satisfy it so saved pie visuals keep working.
	 * `"geo"` (maps) wants `geography` mapped — anchors arrive pre-positioned
	 * at region centroids, and the per-series `labelPoints` selection stands
	 * down (there are no series ends on a map). `"layout"` (hierarchy
	 * layouts — sunburst) wants nothing mapped: the renderer's layout places
	 * AND styles every anchor (text, fill, size) and decides which nodes get
	 * a label at all, so the layer only applies the fine-tuning — offsets,
	 * position rules, alignment, wrap, rotation, text background, and a 2-D
	 * overlap spread (no series → `labelPoints` stands down here too). */
	positionGate?: "xy" | "polar" | "geo" | "layout"
	/** Which labels THIS layer instance draws, when a chart splits its
	 * labels over several layers (a bar + marks combo draws the bars' labels
	 * from slice anchors and the marks' from rows). Called per label key
	 * (`labelKeysFor`; `null` = the single-field label) with the variables
	 * the label shows; a label it rejects is left to another instance.
	 * Omitted = every label. */
	labelFilter?: (key: string | null, fields: ReadonlyArray<string>) => boolean
	/** Row path: the fields the labels position by, in place of the Data
	 * Labels X / Y mapping. A combo's marks layer passes the CHART's x / y
	 * (the category and the position variable drawn as marks) so its labels
	 * sit at the points whatever the mapping says — the bars' layer never
	 * read the mapping either. Omitted = the mapping. */
	positionFields?: { x: string | null; y: string | null }
	/** Geo only: "is this pixel open map space?" (ocean / no-data regions).
	 * Handed to the 2-D overlap spread so displaced labels prefer landing
	 * there over covering data-carrying regions. Unset → no preference. */
	preferOpenSpace?: (x: number, y: number) => boolean
}

// Text formatting, size interpolation, hue-scale assembly, and the fill
// precedence chain live in `lib/dataLabelsStyle.ts` — shared with the
// hierarchy renderers, whose labels are placed by their layouts but
// styled by the same Data Labels options.

/** A render-ready label box: a positioned, colored, formatted label. Both
 * the anchor-based and row-based paths build this shape so they can share
 * the SVG emission below. */
/** A variable's effective text layout: its own `fieldLayouts` entry (only
 *  ever consulted for a separate variable — `own` is null otherwise) over
 *  the layer-wide values. */
const resolveFieldLayout = (
	cfg: DataLabelsConfig,
	own: string | null
): {
	textAngle: number
	wrapText: boolean
	wrapMaxChars: number
	avoidOverlaps: boolean
} => {
	const o = own === null ? undefined : cfg.fieldLayouts?.[own]
	return {
		textAngle: o?.textAngle ?? cfg.textAngle ?? 0,
		wrapText: o?.wrapText ?? cfg.wrapText === true,
		wrapMaxChars:
			o?.wrapMaxChars ??
			cfg.wrapMaxChars ??
			DEFAULT_DATA_LABELS_CONFIG.wrapMaxChars ??
			20,
		avoidOverlaps: o?.avoidOverlaps ?? cfg.avoidOverlaps === true,
	}
}

type RenderableLabel = {
	cx: number
	cy: number
	text: string
	/** LAYOUT font size (px): the size the collision / edge-alignment boxes
	 *  measure with. Equals the label's own size, except for a label whose
	 *  pieces carry per-variable sizes, where it's the LARGEST piece so the
	 *  box stays conservative. */
	fontSize: number
	/** The `<text>` element's own font size (px) — the label's resolved
	 *  size before any per-variable override. Pieces whose size differs
	 *  carry their own. Unset → `fontSize`. */
	baseFontSize?: number
	/** Separate-variables mode: the one variable this label shows — its own
	 *  angle / wrapping (`DataLabelsConfig.fieldLayouts`) apply at paint. */
	ownField?: string
	fill: string
	label: string
	key: string
	/** Per-variable styled pieces (multi-field labels with per-variable
	 *  colors / sizes / fonts / backgrounds). When present, each piece
	 *  renders as its own `<tspan>`; with wrapping on, pieces line-break at
	 *  the plain label's wrap points via `wrapSegments`. */
	segments?: LabelPiece[]
	/** Per-box alignment override (endpoint labels). Unset → `cfg.alignment`.
	 *  "outward" is resolved to a side before the boxes reach the renderer
	 *  (`selectAndSpread`); one that slips through renders centered. */
	alignment?: DataLabelAlignment
	/** Legend-hover fade for this label (1 / unset = no fade). Mirrors the
	 * fade applied to the mark the label annotates. */
	opacityMul?: number
}

/** Map an alignment value onto the SVG `text-anchor` it renders as. */
const alignmentAnchor = (
	alignment: DataLabelsConfig["alignment"]
): "start" | "middle" | "end" =>
	alignment === "left" ? "start" : alignment === "right" ? "end" : "middle"

/** Positioning inputs the population pass needs beyond the layout box:
 *  the RAW anchor coords (pre-offset), so an endpoint's offset override can
 *  REPLACE the layer-wide offset instead of stacking on top of it. */
type EndpointAwareBox = LabelBox & {
	label: string
	key: string
	anchorX: number
	anchorY: number
	alignment?: DataLabelAlignment
	/** A position rule matched this label and set its offsets — they win
	 *  over the first / last label's own X / Y. */
	ruleOffset?: boolean
}

/** Apply the label selection: expand each anchor box into one label per
 *  population it carries (`populationsAtTag`), dropping anchors that carry
 *  none. In a split selection the series-end populations restyle from their
 *  override block (offset replaces, alignment replaces; unset fields inherit
 *  the layer values the box was built with) and recompose their text through
 *  `recompose` (multi-field templates — a no-op for single-field labels and
 *  for anchors that arrive pre-formatted). The all-labels population keeps
 *  the box as built: its text was composed with the all-labels template up
 *  front. Classification runs on the already-offset positions — the base
 *  offset is uniform, so the per-series ranking is unaffected.
 *
 *  Fast path: an all-labels-only selection returns the boxes untouched. */
const expandLabelPopulations = <T extends EndpointAwareBox>(
	boxes: T[],
	cfg: DataLabelsConfig,
	sel: LabelSelection,
	axis: "x" | "y",
	recompose?: (box: T, pop: LabelPopulation) => T | null
): T[] => {
	// (Everything present — a combination's own series-end selection counts
	// too, so its empty all-labels boxes still reach the recomposition.)
	if (sel.present.all && !sel.present.first && !sel.present.last) return boxes
	const tags = selectEndpointsPerSeries(boxes, axis)
	const out: T[] = []
	for (const b of boxes) {
		for (const pop of populationsAtTag(sel, tags.get(b))) {
			if (pop === "all") {
				out.push(b)
				continue
			}
			const ov = populationOverrides(cfg, sel, pop)
			// A matching position rule wins over the endpoint's own X / Y: the
			// rule is the exception the user added, so `{sex} == Male` moves the
			// Male end labels even when First / Last label carry offsets. Without
			// a rule, an unset endpoint offset inherits the box's EFFECTIVE
			// offset (its already-applied cx/cy). The key gains a population
			// suffix so an anchor's several labels reconcile independently.
			const keepX = b.ruleOffset || ov.xOffset == null
			const keepY = b.ruleOffset || ov.yOffset == null
			let next: T = {
				...b,
				key: `${b.key}:${pop}`,
				cx: keepX ? b.cx : b.anchorX + (ov.xOffset ?? 0),
				cy: keepY ? b.cy : b.anchorY + (ov.yOffset ?? 0),
				alignment: ov.alignment ?? b.alignment,
			}
			if (recompose) {
				const r = recompose(next, pop)
				if (!r) continue
				next = r
			}
			out.push(next)
		}
	}
	return out
}

/** One styled piece of a multi-variable label: a variable's (or literal)
 *  text with its resolved fill, size, font, and background. Pieces are
 *  carried only when some piece differs from the label's base styling —
 *  a uniformly styled label keeps the plain render path. */
type LabelPiece = {
	text: string
	field: string | null
	fill: string
	/** px */
	fontSize: number
	font: ResolvedLabelFont
	bg: ResolvedLabelBackground | null
}

/** The text-background rect's border, as SVG stroke props — none at all
 *  (not a 0-width stroke) when the border is off, so the historical render
 *  is unchanged. */
const bgBorderProps = (
	bg: ResolvedLabelBackground
): { stroke?: string; strokeWidth?: number } =>
	bg.borderWidth > 0
		? { stroke: bg.borderColor, strokeWidth: bg.borderWidth }
		: {}

/** A line of a segmented label laid out for drawing: each piece's start x
 *  and width (the same CHAR_WIDTH_RATIO heuristic the layout boxes use),
 *  the line's start x per the label's alignment, and its total width. */
type PieceLine = {
	pieces: { piece: LabelPiece; x: number; width: number }[]
	startX: number
	width: number
}

const layoutPieceLines = (
	segLines: LabelPiece[][],
	cx: number,
	anchor: "start" | "middle" | "end"
): PieceLine[] =>
	segLines.map((pieces) => {
		const widths = pieces.map((p) =>
			labelWidth({ text: p.text, fontSize: p.fontSize })
		)
		const width = widths.reduce((a, b) => a + b, 0)
		const startX =
			anchor === "start" ? cx : anchor === "end" ? cx - width : cx - width / 2
		let x = startX
		const laid = pieces.map((piece, i) => {
			const out = { piece, x, width: widths[i] }
			x += widths[i]
			return out
		})
		return { pieces: laid, startX, width }
	})

/** The tspan attributes a piece needs beyond the parent `<text>`'s: only
 *  what differs from the label's base styling, so a plain piece stays a
 *  bare `<tspan fill>` (and the DOM of existing visuals is unchanged). */
const pieceStyleAttrs = (
	p: LabelPiece,
	baseFontSize: number,
	baseFont: ResolvedLabelFont
) => ({
	fontSize: p.fontSize !== baseFontSize ? p.fontSize : undefined,
	fontFamily:
		p.font.fontFamily !== baseFont.fontFamily ? p.font.fontFamily : undefined,
	fontWeight:
		p.font.fontWeight !== baseFont.fontWeight ? p.font.fontWeight : undefined,
	fontStyle:
		p.font.italic !== baseFont.italic
			? p.font.italic
				? "italic"
				: "normal"
			: undefined,
	textDecoration:
		p.font.underline !== baseFont.underline
			? p.font.underline
				? "underline"
				: "none"
			: undefined,
})

/** Emit the tspans for a WRAPPED segmented (per-variable styled) label:
 *  one entry per line, each piece carrying its own styling. Every line
 *  anchors its FIRST tspan at the line's computed start x with
 *  `textAnchor="start"`, so center / right alignment positions the whole
 *  line rather than just its first piece (an x-anchored tspan is
 *  positioned individually by SVG; inline followers just flow after it).
 *  Line steps are in px off the label's base size — an `em` step would
 *  follow whichever piece happens to start the line. */
const renderSegmentedLines = (
	lines: PieceLine[],
	baseFontSize: number,
	baseFont: ResolvedLabelFont,
	keyBase: string
): React.ReactNode[] => {
	// Same vertical-centering shift as `renderMultilineTspans` — the parent
	// `<text>` anchors with dominantBaseline="middle".
	const firstDy = -0.6 * (lines.length - 1) * baseFontSize
	const step = 1.2 * baseFontSize
	return lines.flatMap((line, i) => {
		const dy = i === 0 ? firstDy : step
		// An empty line still contributes vertical space (same convention as
		// renderMultilineTspans — an empty tspan would collapse).
		if (line.pieces.length === 0) {
			return [
				<tspan
					// Line index IS its identity.
					// eslint-disable-next-line react/no-array-index-key
					key={`${keyBase}-l${i}`}
					x={line.startX}
					dy={dy}
					textAnchor="start"
				>
					{" "}
				</tspan>,
			]
		}
		return line.pieces.map(({ piece }, j) => (
			<tspan
				// Piece order is stable → position is its identity.
				// eslint-disable-next-line react/no-array-index-key
				key={`${keyBase}-l${i}-s${j}`}
				x={j === 0 ? line.startX : undefined}
				dy={j === 0 ? dy : undefined}
				textAnchor={j === 0 ? "start" : undefined}
				fill={piece.fill}
				{...pieceStyleAttrs(piece, baseFontSize, baseFont)}
			>
				{piece.text}
			</tspan>
		))
	})
}

/** Background rects for a segmented label whose pieces DON'T all share
 *  the layer background: per line, contiguous pieces with the same
 *  background form one run and draw one rect (so two variables with the
 *  same background still share a box; a variable without one leaves a
 *  gap). A run's rect is as tall as its tallest piece plus the padding,
 *  centered on its line. */
const renderPieceBackgrounds = (
	lines: PieceLine[],
	cy: number,
	baseFontSize: number,
	keyBase: string
): React.ReactNode[] => {
	const step = 1.2 * baseFontSize
	const firstCy = cy - ((lines.length - 1) / 2) * step
	return lines.flatMap((line, li) => {
		const lineCy = firstCy + li * step
		const rects: React.ReactNode[] = []
		let run: PieceLine["pieces"] = []
		const flush = () => {
			const bg = run[0]?.piece.bg
			if (run.length > 0 && bg) {
				const x0 = run[0].x
				const x1 = run[run.length - 1].x + run[run.length - 1].width
				const tallest = max(run, (r) => r.piece.fontSize) as number
				const h = tallest * 1.1 + bg.padY * 2
				rects.push(
					<rect
						// Runs are ordered along the line → position is identity.
						// eslint-disable-next-line react/no-array-index-key
						key={`${keyBase}-bg-l${li}-${rects.length}`}
						x={x0 - bg.padX}
						y={lineCy - h / 2}
						width={x1 - x0 + bg.padX * 2}
						height={h}
						rx={bg.radius}
						fill={bg.color}
						{...bgBorderProps(bg)}
					/>
				)
			}
			run = []
		}
		for (const entry of line.pieces) {
			if (run.length > 0 && !sameBackground(run[0].piece.bg, entry.piece.bg)) {
				flush()
			}
			run.push(entry)
		}
		flush()
		return rects
	})
}

/** Emit the `<text>` elements (plus optional background rects) for a list of
 * resolved label boxes. Shared by the anchor-based and row-based paths so the
 * text-background, alignment, and font handling stay in one place.
 * `data-vc-data-labels` marks the layer for the accessibility check
 * (collectAccessibilityDom), which words its findings by text role. */
const renderLabels = (
	boxes: RenderableLabel[],
	cfg: DataLabelsConfig,
	layerBg: ResolvedLabelBackground | null
): React.ReactElement => {
	const baseAnchor = alignmentAnchor(cfg.alignment)
	const baseFont = resolveFieldFont(cfg, null)
	return (
		<g aria-hidden="true" pointerEvents="none" data-vc-data-labels>
			{boxes.map((b) => {
				// A separate variable's own wrapping / angle, else the layer's.
				// Text angle rotates each label (and its background rect) around
				// its own anchor point — same convention as the axes'
				// tickLabelAngle (positive = clockwise). Paint-time only: the
				// overlap / reserve passes keep measuring the unrotated footprint.
				const {
					wrapText: wrap,
					wrapMaxChars,
					textAngle,
				} = resolveFieldLayout(cfg, b.ownField ?? null)
				// Endpoint labels can carry their own alignment (first vs last
				// labels typically hang off opposite sides of their point).
				const textAnchor = b.alignment
					? alignmentAnchor(b.alignment)
					: baseAnchor
				// Per-variable styled pieces render as their own tspans; when
				// wrapping is on they line-break at the same points the plain
				// label would (`wrapSegments` splits straddling pieces).
				const segs = b.segments ?? []
				const segmented = segs.length > 0
				const baseFontSize = b.baseFontSize ?? b.fontSize
				// Split into lines up-front so the background rect and the
				// `<tspan>` emission agree on the label's footprint. A short
				// label (or wrapping off) yields a single line, keeping the
				// non-wrapped render byte-identical to before.
				const lines = wrap ? wrapByCharCount(b.label, wrapMaxChars) : [b.label]
				const multiline = lines.length > 1
				const pieceLines = segmented
					? layoutPieceLines(
							multiline ? wrapSegments(segs, wrapMaxChars) : [segs],
							b.cx,
							textAnchor
						)
					: []
				// Pieces whose backgrounds all match the layer's share the one
				// whole-label rect below (the historical render); any piece
				// with its own background switches the label to per-run rects.
				const perPieceBg =
					segmented && segs.some((p) => !sameBackground(p.bg, layerBg))
				let rect: React.ReactNode = null
				if (perPieceBg) {
					rect = renderPieceBackgrounds(pieceLines, b.cy, baseFontSize, b.key)
				} else if (layerBg) {
					const { padX, padY } = layerBg
					// Size to the widest wrapped line; height grows per line at
					// the same 1.2em step `renderMultilineTspans` uses. A label
					// with mixed-size pieces measures its pieces individually.
					const w =
						(segmented
							? (max(pieceLines, (l) => l.width) as number)
							: (max(lines, (l) => labelWidth({ text: l, fontSize: b.fontSize })) as number)) +
						padX * 2
					const h = labelBlockHeight({ text: lines.join("\n"), fontSize: b.fontSize }) + padY * 2
					// Align the rect's left edge to the text's start the same way
					// the text-anchor positions the glyphs, so the box hugs the
					// label regardless of alignment.
					const rx =
						textAnchor === "start"
							? b.cx - padX
							: textAnchor === "end"
								? b.cx - w + padX
								: b.cx - w / 2
					rect = (
						<rect
							x={rx}
							y={b.cy - h / 2}
							width={w}
							height={h}
							rx={layerBg.radius}
							fill={layerBg.color}
							{...bgBorderProps(layerBg)}
						/>
					)
				}
				return (
					<g
						key={b.key}
						// Legend-hover fade: a label recedes with its mark, so
						// hovering one series leaves only that series' labels
						// legible. Left off entirely at full opacity so the
						// non-hover render is unchanged.
						opacity={
							b.opacityMul != null && b.opacityMul < 1
								? b.opacityMul
								: undefined
						}
						transform={
							textAngle !== 0
								? `rotate(${textAngle} ${b.cx} ${b.cy})`
								: undefined
						}
					>
						{rect}
						<text
							x={b.cx}
							y={b.cy}
							fill={b.fill}
							fontFamily={cfg.fontFamily}
							fontSize={baseFontSize}
							fontWeight={cfg.fontWeight}
							fontStyle={cfg.italic ? "italic" : undefined}
							textDecoration={cfg.underline ? "underline" : undefined}
							textAnchor={textAnchor}
							dominantBaseline="middle"
						>
							{segmented
								? multiline
									? renderSegmentedLines(
											pieceLines,
											baseFontSize,
											baseFont,
											b.key
										)
									: segs.map((s, i) => (
											<tspan
												// Segment order is stable → index is its identity.
												// eslint-disable-next-line react/no-array-index-key
												key={`${b.key}-s${i}`}
												fill={s.fill}
												{...pieceStyleAttrs(s, baseFontSize, baseFont)}
											>
												{s.text}
											</tspan>
										))
								: multiline
									? renderMultilineTspans(lines.join("\n"), b.cx, {
											verticallyCentered: true,
											lineAnchor: textAnchor,
										})
									: b.label}
						</text>
					</g>
				)
			})}
		</g>
	)
}

/** Renders a layer of `<text>` elements on top of the main visualization
 * marks. Operates in one of two modes:
 *   - Row-based (default): one label per row in `rows`, positioned via
 *     `xScale`/`yScale` from the row's mapped fields. Used by
 *     ScatterPlot and any chart whose label anchors are raw points.
 *   - Anchor-based: caller pre-computes `anchors` (slice centers, layer
 *     centroids, etc.) and the layer just renders them. Used by bars
 *     and areas so labels respect stack / group / overlay layout. */
export const DataLabelsLayer = ({
	rows,
	xScale,
	yScale,
	xType,
	yType,
	rowFilter,
	anchors,
	positionGate = "xy",
	labelFilter,
	positionFields,
	preferOpenSpace,
}: Props) => {
	const encodings: DataLabelsEncodings = {
		...emptyDataLabelsEncodings(),
		...useAtomValue(renderDataLabelsEncodingsAtom),
	}
	// Normalized: a visual saved before composed labels derives its label
	// list (and the derived labels' which-labels / overrides) here, so the
	// layer only ever deals with the list.
	const cfg: DataLabelsConfig = normalizeComposedLabels(
		{
			...DEFAULT_DATA_LABELS_CONFIG,
			...useAtomValue(renderDataLabelsConfigAtom),
		},
		encodings.value.fields ?? []
	)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	// Legend / mark hover: a label must fade with the mark it annotates. The
	// row-based path resolves it per row here; the anchor path can't (a slice
	// spans many rows), so aggregating renderers hand the fade down on each
	// anchor's `opacityMul`.
	const legendHighlight = useLegendHighlight()
	const facetPanelKey = useFacetPanelKey()
	// When wrapping is on, the overlap pass (`nudgeOverlaps`) must reserve
	// each label's WRAPPED footprint — narrower and taller than the raw
	// single-line string — or it would collide-check a phantom one-line box.
	// Encode the wrapped lines into `text` (newline-joined); labelWidth /
	// labelHeight treat `\n` as line breaks. `label` stays the raw string —
	// `renderLabels` re-wraps it for the actual `<tspan>` emission, so the
	// layout box and the drawn text agree.
	// A separate variable wraps per its own layout entry.
	const wrapBoxForLayout = <
		T extends { text: string; label: string; ownField?: string },
	>(
		box: T
	): T => {
		const { wrapText, wrapMaxChars } = resolveFieldLayout(
			cfg,
			box.ownField ?? null
		)
		return wrapText
			? { ...box, text: wrapByCharCount(box.label, wrapMaxChars).join("\n") }
			: box
	}
	// Pull the main chart's connection field so the row-based path (scatter
	// + connection = line chart) can group rows into "lines" for the
	// `labelPoints` filter. This atom is independent from the data-labels
	// encodings atom; we just read it for series-grouping context.
	const chartEncodings = useAtomValue(currentEncodingsAtom)
	const connectionField = chartEncodings.connection?.field ?? null
	// Read the chart's channel configs so we can FALL BACK to the chart's
	// categorical palette when the user maps DataLabels.hue but hasn't
	// picked a separate palette in the Data Labels panel. The user
	// reported "I added a categorical hue to data labels but it didn't
	// apply" — root cause was `cfg.palette.length === 0` causing
	// `buildLabelHueConfig` to return null. Falling back here means the
	// labels inherit the chart's hue colors automatically.
	const chartChannelConfigs = useAtomValue(renderChannelConfigsAtom)
	// Text-background fill: an explicit override wins, else inherit the
	// visualization's own background (white when that's transparent) so the
	// rect masks gridlines by blending into the chart canvas.
	const vizBackground = chartChannelConfigs.backgroundColor ?? "#ffffff"
	const layerBg = resolveLayerBackground(cfg, vizBackground)

	const xField = positionFields ? positionFields.x : encodings.x.field
	const yField = positionFields ? positionFields.y : encodings.y.field
	const angleField = encodings.angle.field
	const valueField = encodings.value.field
	const hueField = encodings.hue.field
	const sizeField = encodings.size.field
	// Hue field's effective type drives whether labels color through a
	// categorical palette or a quantitative gradient.
	const hueFieldType: FieldType =
		dataset && hueField
			? effectiveType(dataset, hueField, overrides)
			: "categorical"
	const isHueQuant =
		hueFieldType === "quantitative" || hueFieldType === "temporal"
	// Palette / gradient assembly + the inherit-chart-palette fallback
	// (and its "None (single color)" suppression) live in
	// `labelHueScaleParts` — shared with the hierarchy renderers.
	const { hueConfig: partsHueConfig, customPalette } = labelHueScaleParts(
		cfg,
		hueFieldType,
		chartChannelConfigs
	)
	const hueConfig: HueConfig | null = hueField ? partsHueConfig : null
	// A label color varying by the chart's Color variable takes each value's
	// palette POSITION from the Color mapping (see `linkedCategoryColors`).
	const chartHueField = chartEncodings.hue?.field ?? null
	const colorLink =
		dataset && chartHueField
			? colorLinkSource(
					chartEncodings,
					chartChannelConfigs,
					effectiveType(dataset, chartHueField, overrides)
				)
			: null
	const linkHue = (
		hue: HueConfig | undefined,
		field: string,
		palette: readonly string[] | undefined
	): HueConfig | undefined =>
		withLinkedColors(hue, linkedCategoryColors(colorLink, field, palette))

	// Gate: data labels only render when the user has explicitly mapped
	// the position field(s) AND the value field. Without this, labels would
	// "guess" a value from the position field — appearing the moment one
	// encoding is set, which is confusing during chart setup. Polar charts
	// (pies) gate on `angle` alone — there is no R row; labels sit at the
	// wedge midpoint and the R% nudge moves them radially (a retired
	// `r` slot in old saves is ignored). Legacy `x` + `y` still satisfy it so saved pie
	// visuals from before the polar channels keep rendering.
	// Layout-placed anchors (`"layout"`) skip both gates: the renderer has
	// already chosen the labeled nodes and their text (names by default, the
	// Value field when mapped), so an unmapped Value must not blank them.
	const positionMapped =
		positionGate === "layout"
			? true
			: positionGate === "polar"
				? Boolean(angleField) || (Boolean(xField) && Boolean(yField))
				: positionGate === "geo"
					? Boolean(encodings.geography?.field)
					: Boolean(xField) && Boolean(yField)
	// "Value" is satisfied by a single mapped field OR multi-field mode with
	// at least one field checked (multi-field mode leaves `value.field` null).
	const valueMapped =
		positionGate === "layout" ||
		Boolean(valueField) ||
		(encodings.value.multiField === true &&
			(encodings.value.fields?.length ?? 0) > 0)
	if (!positionMapped || !valueMapped) return null
	// Facet scope: "Label all facets" unchecked ⇒ only the ticked panels
	// draw labels. Outside PlotCanvas (no panel key) and on an unfaceted
	// chart's single panel the scope never applies. Multi-field labels scope
	// per composed label (each has its own "Label all facets"), so the gate
	// moves to `ownKeys` below; the layer-wide value is only a wholesale
	// skip for the single-field label.
	if (
		encodings.value.multiField !== true &&
		!dataLabelsOnPanel(cfg, facetPanelKey)
	) {
		return null
	}
	// Anchors without per-series endpoints: maps (regions) and layout-placed
	// labels (tree nodes). The `labelPoints` selection is skipped for them —
	// a stored "last per series" from a previous chart must not silently
	// drop every label but one — and colliding labels spread in ANY
	// direction, since their anchors scatter over a plane rather than
	// lining up along a series.
	const seriesless = positionGate === "geo" || positionGate === "layout"
	const multi = encodings.value.multiField === true
	// Which label populations exist (all / first / last) and whether the
	// endpoint override blocks apply. Seriesless anchors read every field as
	// "all": a stored "last per series" from a previous chart must not
	// silently drop every label but one.
	const selection = resolveLabelSelection(cfg, encodings.value, { seriesless })
	// Primary axis for endpoint-per-series ranking. When the chart's
	// categorical axis is x (vertical bars/areas, scatter), the "last" anchor
	// is the rightmost (largest cx). When it's y (horizontal bars/areas), use
	// cy. xType/yType arrive from the caller via props so we don't need to
	// know the chart mode here.
	const lastAxis: "x" | "y" =
		yType === "categorical" || yType === "ordinal" ? "y" : "x"
	const candidateRows = rowFilter ? rows.filter(rowFilter) : rows

	// Per-variable label color (multi-field): one color slot per shown field
	// (`cfg.fieldColors[field]`, plus each split piece's `pieces` entry),
	// mirroring the mark color slots. A slot with no field → its single
	// color; a slot varying by a field → a hue scale over that field.
	// Prebuild each slot's scale once (few slots), then look up per row. No
	// slot for a field → that segment uses the label's base fill.
	const fieldColorScales = new Map<
		string,
		{ scale: HueScale; field: string; type: FieldType }
	>()
	for (const [fieldName, slotCfg] of labelEntries(cfg, "fieldColors")) {
		const varyField = slotCfg?.field
		if (!varyField) continue
		const t: FieldType = dataset
			? effectiveType(dataset, varyField, overrides)
			: "categorical"
		const values = (dataset?.rows ?? candidateRows).map((r) => r[varyField])
		fieldColorScales.set(fieldName, {
			scale: makeHueScale(
				values,
				t,
				linkHue(
					slotCfg.hue,
					varyField,
					slotCfg.palette && slotCfg.palette.length > 0
						? slotCfg.palette
						: undefined
				),
				slotCfg.palette && slotCfg.palette.length > 0
					? slotCfg.palette
					: undefined
			),
			field: varyField,
			type: t,
		})
	}
	// One label segment's fill. Literal (fieldless) segments and unconfigured
	// fields use the label's base fill; a configured slot uses its scale (vary
	// by a field) or its single color. The variable's own text-color rules
	// come first, compared against ITS value in the row — the slot is the
	// "else".
	/** A composed label's own fill (by key): its text-color rules — read
	 *  against the row's value for the key when the key IS a variable (the
	 *  default `{A}` label), else against the label's first variable — then
	 *  its color slot, else the label's base fill. */
	const resolveSegmentFill = (
		key: string | null,
		row: Record<string, unknown>,
		baseFill: string,
		/** A piece's variable — its rules compare against THAT value. Omitted
		 *  for a whole label, whose rules read its key (the default `{A}`
		 *  label) or its first variable. */
		pieceField?: string,
		/** The mark's dataset rows, for `{Variable}` rules. */
		ruleRows?: RuleRows
	): string => {
		if (!key) return baseFill
		const ruleField =
			pieceField ?? (key in row ? key : firstFieldOfLabel.get(key))
		const ruleColor = resolveRuleColor(
			labelEntry(cfg, "fieldColorRules", key),
			ruleField === undefined ? undefined : row[ruleField],
			ruleRows
		)
		if (ruleColor) return ruleColor
		const slotCfg = labelEntry(cfg, "fieldColors", key)
		if (!slotCfg) return baseFill
		if (slotCfg.field) {
			const s = fieldColorScales.get(key)
			const c = s ? applyHueScale(s.scale, row[s.field], s.type) : null
			return c ?? slotCfg.singleColor ?? baseFill
		}
		return slotCfg.singleColor ?? baseFill
	}
	const baseFont = resolveFieldFont(cfg, null)
	/** Compose one label from a row: single-field formats the one field;
	 *  multi-field arranges the selected fields per `template`. Returns the
	 *  joined text plus per-variable styled pieces — only carried when some
	 *  piece's fill / size / font / background differs from the label's base,
	 *  so uniformly styled labels keep the plain (wrappable) render path —
	 *  and the LAYOUT font size: the largest piece when pieces are carried,
	 *  else the label's own. Null when nothing renders. */
	const composeLabel = (
		row: Record<string, unknown>,
		template: string,
		baseFill: string,
		baseFontSize: number,
		/** The composed label's id (multi-field): its own Color / Size / Text
		 *  properties / Text background entries style the whole label —
		 *  every piece alike. */
		ownKey: string | null = null,
		/** The mark's dataset rows, for `{Variable}` text-color rules. */
		ruleRows?: RuleRows
	): { label: string; segments?: LabelPiece[]; fontSize: number } | null => {
		const segs = buildLabelSegments(
			row,
			encodings.value,
			multi ? { ...cfg, labelTemplate: template } : cfg,
			xField ?? yField
		)
		if (!segs) return null
		const label = segs.map((s) => s.text).join("")
		const ownFill = resolveSegmentFill(ownKey, row, baseFill, undefined, ruleRows)
		const ownSize = resolveFieldSizePx(cfg, ownKey, baseFontSize)
		const ownFont = resolveFieldFont(cfg, ownKey)
		const ownBg = resolveFieldBackground(cfg, ownKey, vizBackground)
		// "Split into individual variables": a split section resolves per
		// PIECE — the variable's own entry (`pieceKey`) laid over the label's
		// — so a label can bold its series name while its value stays
		// regular, or colour just the value by sign. Unsplit sections (and
		// the text background, which draws one rect per label) stay uniform.
		const splitColor = labelPieceSplit(cfg, ownKey, "color")
		const splitSize = labelPieceSplit(cfg, ownKey, "size")
		const splitText = labelPieceSplit(cfg, ownKey, "text")
		const pieceKeyOf = (field: string | null): string | null =>
			ownKey !== null && field !== null ? pieceKey(ownKey, field) : null
		const pieces: LabelPiece[] = segs.map((s) => {
			const pk = pieceKeyOf(s.field)
			return {
				text: s.text,
				field: s.field,
				fill:
					splitColor && pk && s.field
						? resolveSegmentFill(pk, row, ownFill, s.field, ruleRows)
						: ownFill,
				fontSize: splitSize ? resolveFieldSizePx(cfg, pk, ownSize) : ownSize,
				font: splitText ? resolveFieldFontOver(cfg, pk, ownFont) : ownFont,
				bg: ownBg,
			}
		})
		const styled = pieces.some(
			(p) =>
				p.fill !== baseFill ||
				p.fontSize !== baseFontSize ||
				p.font.fontFamily !== baseFont.fontFamily ||
				p.font.fontWeight !== baseFont.fontWeight ||
				p.font.italic !== baseFont.italic ||
				p.font.underline !== baseFont.underline ||
				!sameBackground(p.bg, layerBg)
		)
		if (!styled) return { label, fontSize: baseFontSize }
		return {
			label,
			segments: pieces,
			fontSize: Math.max(baseFontSize, max(pieces, (p) => p.fontSize) ?? baseFontSize),
		}
	}
	// The labels each anchor carries: multi-field, one per composed label
	// (`labelKeysFor` — its id keys every per-label map, its template is
	// what it composes); single-field, the one label (`null`, the layer-wide
	// controls and the series-end override blocks). A label outside a
	// population composes nothing there; an empty template composes nothing.
	const labelKeys = labelKeysFor(cfg, encodings.value)
	// Each composed label draws only on the panels its own "Label all
	// facets" names (`fieldFacetKeys`, falling back to the layer's
	// `facetKeys`), so one label can run across every panel while another is
	// kept to a few. Nothing left to draw here → the layer stands down.
	const ownKeys: (string | null)[] = (
		multi
			? labelKeys.keys.filter((k) => composedLabelOnPanel(cfg, k, facetPanelKey))
			: [null]
	).filter((k) =>
		labelFilter
			? labelFilter(
					k,
					k === null
						? [valueField ?? xField ?? yField].filter((f): f is string => !!f)
						: (labelKeys.pieces[k] ?? [])
				)
			: true
	)
	if (ownKeys.length === 0) return null
	const labelTemplates = new Map(
		labelKeys.labels.map((l) => [l.id, l.template] as const)
	)
	// Labels not keyed by a variable's name (hand-added combinations) have no
	// single value of their own.
	const comboIds = new Set(
		labelKeys.keys.filter((k) => !(encodings.value.fields ?? []).includes(k))
	)
	const firstFieldOfLabel = new Map(
		labelKeys.labels.map(
			(l) =>
				[l.id, templateFields(l.template, encodings.value.fields ?? [])[0]] as const
		)
	)
	// Composed labels position per key: the key's own alignment / X / Y
	// (else the layer's), never the endpoint override blocks — those belong
	// to the single-field label alone, so the expansion sees no overrides
	// for them.
	const ownAlignment = (own: string | null) =>
		own === null ? undefined : cfg.fieldAlignments?.[own]
	const ownOffset = (own: string | null) => ({
		x: (own === null ? undefined : cfg.fieldOffsets?.[own]?.xOffset) ?? cfg.xOffset,
		y: (own === null ? undefined : cfg.fieldOffsets?.[own]?.yOffset) ?? cfg.yOffset,
	})
	// The position rule that applies to one label: the arranged label walks
	// the layer's list (`positionRules`), an own label its own
	// (`fieldPositionRules[key]`). A standalone variable's rules compare
	// against ITS value in the row — the same convention the per-variable
	// text-color rules follow; a combination arranges several variables, so
	// it has no single value and falls back to the layer's backing value. A
	// match REPLACES that label's base offsets (first match wins).
	const ownPositionRule = (
		own: string | null,
		row: Record<string, unknown> | undefined,
		labelValue: unknown,
		ruleRows: RuleRows
	) =>
		own === null
			? firstMatchingRule(cfg.positionRules, labelValue, ruleRows)
			: firstMatchingRule(
					cfg.fieldPositionRules?.[own],
					!comboIds.has(own) && row && own in row ? row[own] : labelValue,
					ruleRows
				)
	const noOverridesCfg: DataLabelsConfig = { ...cfg, firstLabel: {}, lastLabel: {} }
	const ownTemplate = (
		own: string | null,
		pop: LabelPopulation
	): string | null => {
		// Single-field: no arrangement to compose (the one field formats
		// itself); the populations apply at the expansion.
		if (own === null) return ""
		if (!selection.labels[pop].includes(own)) return null
		const template = labelTemplates.get(own) ?? ""
		return template.trim() === "" ? null : template
	}

	type RenderBox = EndpointAwareBox & {
		fill: string
		/** See `RenderableLabel.baseFontSize`. */
		baseFontSize: number
		opacityMul?: number
		/** Per-variable styled pieces (multi-field mode with per-variable
		 *  colors / sizes / fonts / backgrounds). When set, `renderLabels`
		 *  draws one `<tspan>` per piece instead of the plain `label`. */
		segments?: LabelPiece[]
		/** The row the label composes from (multi-field): the dataset row on
		 *  the row path, the slice's synthetic row on bar anchors. Absent for
		 *  pre-formatted anchors, which keep their text through the pass. */
		row?: Record<string, unknown>
		/** The mark's dataset rows (`DataLabelAnchor.sourceRows`; the one row
		 *  on the row path), so a re-compose keeps `{Variable}` rules. */
		ruleRows?: RuleRows
		/** See `DataLabelAnchor.vAlign`; row-based boxes never carry one. */
		vAlign?: LabelVAlign
		/** See `DataLabelAnchor.hAlign`; re-applied after the series-end
		 *  expansion so an endpoint's own alignment can't undo it. */
		hAlign?: "left" | "right"
		/** See `DataLabelAnchor.outwardAlign`: the side an "outward"
		 *  alignment takes for this box. */
		outwardAlign?: "left" | "center" | "right"
		/** Separate-variables mode: the one variable this box shows. */
		ownField?: string
		/** See `DataLabelAnchor.seriesByScope` — the box's identity under
		 *  every "Of each" scope, swapped into `series` / `rank` before the
		 *  expansion ranks this label's endpoints. */
		seriesByScope?: Record<LabelPointsScope, { series: string; rank: number }>
	}
	// Series-end label recomposition (multi-field): rebuild the box's text —
	// and its per-variable colored segments — from the population's template.
	// Runs BEFORE `nudgeOverlaps` so collision boxes measure the final (often
	// wider) text. Boxes without a row (single-field, pre-formatted anchors)
	// pass through unchanged.
	const recomposeForPopulation = (
		box: RenderBox,
		pop: LabelPopulation
	): RenderBox | null => {
		if (!multi || !box.row) return box
		const template = ownTemplate(box.ownField ?? null, pop)
		if (template === null) return null
		const composed = composeLabel(
			box.row,
			template,
			box.fill,
			box.baseFontSize,
			box.ownField ?? null,
			box.ruleRows
		)
		if (!composed) return null
		return wrapBoxForLayout({
			...box,
			label: composed.label,
			text: composed.label,
			fontSize: composed.fontSize,
			segments: composed.segments,
		})
	}
	// Selection, then overlap. A multi-field box whose all-labels text is
	// empty still enters the pass — its series-end populations may compose
	// something — and empties are dropped here.
	const selectAndSpread = (boxes: RenderBox[]): RenderBox[] => {
		// Edge alignment runs LAST in the positioning chain — after wrapping
		// and population recomposition settle each label's final line count,
		// so the half-block shift is the drawn block's — and before the
		// overlap pass, so collisions see the block where it lands.
		// Separate variables expand per variable: each variable's boxes are
		// one per anchor, so the endpoint ranking sees the same anchors it
		// would for a combined label (two boxes on one anchor would tie and
		// only one could be tagged "last").
		const wrapped = boxes.map(wrapBoxForLayout)
		// Expanded per label key, so the endpoint ranking sees one box per
		// anchor per key (two keys on one anchor would tie and only one could
		// be tagged "last"). Only the arranged label (`null`) takes the
		// series-end override blocks.
		// Each label's series ends are ranked under ITS "Of each" scope
		// (`fieldLabelPointsScope`): the anchors carry a series + rank per
		// scope, so the key's pair is swapped in before the endpoints are
		// classified. Anchors without the map (renderers that rank by hue +
		// position) keep what they were built with.
		const atScope = (b: RenderBox, own: string | null): RenderBox => {
			const pair = b.seriesByScope?.[labelScopeFor(cfg, own)]
			return pair ? { ...b, series: pair.series, rank: pair.rank } : b
		}
		const expand = (bs: RenderBox[], own: string | null) =>
			expandLabelPopulations(
				bs.map((b) => atScope(b, own)),
				own === null && !multi ? cfg : noOverridesCfg,
				selection,
				lastAxis,
				recomposeForPopulation
			)
		// Multi-field mode with anchors that carry no row (a renderer that
		// doesn't build one yet): their boxes are keyed to no composed label,
		// so they'd match none of `ownKeys` and vanish. They keep their
		// pre-formatted text under the `null` key instead, expanded like the
		// composed labels — a stored "Multiple variables…" from another chart
		// must not blank a chart that can't compose yet.
		const preformatted = multi && wrapped.some((b) => b.ownField === undefined)
		const expandKeys: (string | null)[] = preformatted
			? [...ownKeys, null]
			: ownKeys
		const filtered = expandKeys
			.flatMap((k) =>
				expand(
					wrapped.filter((b) => (b.ownField ?? null) === k),
					k
				)
			)
			.filter((b) => b.label !== "")
			.map(alignBoxToAnchorEdge)
			// A forced side alignment outranks the series-end override the
			// expansion may have applied: beside a bar, every label hangs
			// away from it.
			.map((b) => (b.hAlign ? { ...b, alignment: b.hAlign } : b))
			// "Outward" resolves per label HERE — after the series-end override
			// and the forced side have had their say, before the overlap pass
			// measures the block — to the side the renderer worked out for
			// this anchor (centered where it worked out none).
			.map((b) =>
				(b.alignment ?? cfg.alignment) === "outward"
					? {
							...b,
							alignment: resolveOutwardAlignment("outward", b.outwardAlign),
						}
					: b
			)
		// Overlap pass: seriesless anchors (maps, layout-placed labels) spread
		// colliding labels in ANY direction (a downward-only pile looks
		// lopsided around a ring or with leader lines); series charts keep the
		// vertical-only nudge, which preserves the reading order of stacked
		// end-of-line labels.
		const spread = (bs: RenderBox[]) =>
			seriesless
				? spreadOverlaps2D(bs, { prefer: preferOpenSpace })
				: nudgeOverlaps(bs)
		// Each label key's own toggle (the layer's for the arranged label)
		// decides whether its labels take part — the participating labels
		// avoid each other, the rest never move. Keys are unique per box, so
		// the moved copies slot back into the original order.
		const movable = filtered.filter(
			(b) => resolveFieldLayout(cfg, b.ownField ?? null).avoidOverlaps
		)
		if (movable.length === 0) return filtered
		if (movable.length === filtered.length) return spread(filtered)
		const moved = new Map(spread(movable).map((b) => [b.key, b]))
		return filtered.map((b) => moved.get(b.key) ?? b)
	}

	// --- Anchor-based path (bars/areas). --------------------------------
	if (anchors) {
		if (anchors.length === 0) return null
		// The hue field's effective type decides whether the scale is
		// categorical (using `cfg.palette`) or quantitative (using
		// `cfg.gradient*`). The DOMAIN comes from the full dataset (not the
		// anchor list) so the category → color assignment matches the chart's
		// own hue scale and legend: anchors iterate stacks/slices in layout
		// order, which can differ from dataset row order — building the
		// ordinal domain from them shuffled label colors relative to the
		// marks. Falls back to the anchors' values when the dataset view
		// isn't available.
		let hueScale: HueScale | null = null
		if (hueField && hueConfig) {
			const values = dataset?.rows
				? dataset.rows.map((r) => r[hueField])
				: anchors.map((a) => a.hueValue)
			hueScale = makeHueScale(
				values,
				hueFieldType,
				linkHue(hueConfig, hueField, customPalette),
				customPalette
			)
		}
		const sizeValues = sizeField
			? anchors
					.map((a) => Number(a.sizeValue))
					.filter((n) => Number.isFinite(n))
			: []
		// Build per-anchor render boxes once so the post-passes (selection +
		// `avoidOverlaps`) operate on a stable shape and the downstream
		// `<text>` map can read its already-resolved fields.
		const renderBoxes: RenderBox[] = anchors.flatMap((a, i) => {
			// Pre-formatted anchors (single-field, or renderers that don't carry
			// a row) skip when their renderer produced no text. Multi-field
			// anchors with a row compose below instead — one box per label
			// key (the arranged label, each standalone variable, each
			// combination).
			const composes = multi && a.row !== undefined
			if (!composes && a.label === null) return []
			const anchorKeys = composes
				? a.labelKeys
					? ownKeys.filter((k) => k !== null && !!a.labelKeys?.includes(k))
					: ownKeys
				: [null]
			return anchorKeys.flatMap((own) => {
			const hueColor =
				hueScale && a.hueValue !== undefined
					? (applyHueScale(hueScale, a.hueValue, hueFieldType) ?? null)
					: null
			// A pre-resolved fill / size (layout renderers) wins over the
			// layer's own lookup.
			const fill =
				a.fill ??
				resolveLabelFill(cfg, a.hueValue, hueColor, a.labelValue, a.sourceRows)
			const fontSize =
				a.fontSize ??
				(sizeField
					? resolveLabelSize(a.sizeValue, cfg, sizeValues)
					: ptToPx(cfg.fontSize))
			// Multi-field: arrange the slice's row with the all-labels template
			// (empty when that population has nothing to say here — the
			// selection pass may still add a series-end label).
			const template = composes ? ownTemplate(own, "all") : null
			const composed =
				composes && a.row && template !== null
					? composeLabel(a.row, template, fill, fontSize, own, a.sourceRows)
					: null
			const label = composes ? (composed?.label ?? "") : (a.label ?? "")
			// A matching position rule REPLACES the base offsets for this label
			// (same first-match-wins walk as the text-color rules, against this
			// label's own backing value).
			const posRule = ownPositionRule(own, a.row, a.labelValue, a.sourceRows)
			const off = ownOffset(own)
			// A separate variable with its own bar placement sits on ITS
			// resolved point (and hangs per its own side); otherwise the
			// anchor's base point.
			const place =
				(own === null ? undefined : a.fieldPlacements?.[own]) ?? a
			return [
				{
					cx: place.cx + (posRule?.xOffset ?? off.x),
					cy: place.cy + (posRule?.yOffset ?? off.y),
					ruleOffset: posRule !== null,
					anchorX: place.cx,
					anchorY: place.cy,
					text: label,
					fontSize: composed?.fontSize ?? fontSize,
					baseFontSize: fontSize,
					// Bars hand over an explicit series + rank (their stack /
					// group layout, per the label scope). Other anchor-based
					// renderers (areas, pies) carry the hue value as the de-facto
					// "series" identity — every slice in the same stack/layer
					// shares the same hue. Falls back to "" when no hue is
					// mapped, which the endpoint ranking interprets as "all
					// anchors are one big group" (single-survivor fallback).
					series:
						a.series ??
						(a.hueValue === undefined ? "" : String(a.hueValue ?? "")),
					rank: a.rank,
					seriesByScope: a.seriesByScope,
					index: i,
					key: own === null ? a.key : `${a.key}#${own}`,
					fill,
					label,
					segments: composed?.segments,
					row: composes ? a.row : undefined,
					ruleRows: a.sourceRows,
					opacityMul: a.opacityMul,
					vAlign: place.vAlign,
					hAlign: place.hAlign,
					outwardAlign: place.outwardAlign ?? a.outwardAlign,
					ownField: own ?? undefined,
					alignment: place.hAlign ?? ownAlignment(own),
				},
			]
			})
		})
		const finalBoxes = selectAndSpread(renderBoxes)
		const labels = renderLabels(finalBoxes, cfg, layerBg)
		// Maps only: leader lines from each region's centroid (the raw anchor)
		// to its label's box edge, drawn UNDER the labels. A label still on its
		// centroid produces no line (`leaderLineSegment` returns null when the
		// anchor sits inside the box), so lines only appear where offsets or
		// the overlap pass actually moved a label.
		const leaderWidth = cfg.leaderLineWidth ?? 1
		if (positionGate !== "geo" || cfg.leaderLines !== true || leaderWidth <= 0) {
			return labels
		}
		const leaderAnchor = alignmentAnchor(cfg.alignment)
		// The box the line stops at: the text footprint plus the background
		// rect's padding when one is drawn, plus a small breathing gap so the
		// line never kisses the glyphs.
		const leaderPadX = (layerBg?.padX ?? 0) + 2
		const leaderPadY = (layerBg?.padY ?? 0) + 2
		const leaderLines = finalBoxes.flatMap((b) => {
			const w = labelWidth(b)
			const left =
				leaderAnchor === "start"
					? b.cx
					: leaderAnchor === "end"
						? b.cx - w
						: b.cx - w / 2
			const seg = leaderLineSegment({
				anchorX: b.anchorX,
				anchorY: b.anchorY,
				left: left - leaderPadX,
				right: left + w + leaderPadX,
				top: b.cy - labelHeight(b) / 2 - leaderPadY,
				bottom: b.cy + labelHeight(b) / 2 + leaderPadY,
			})
			if (!seg) return []
			return [
				<line
					key={`leader-${b.key}`}
					x1={seg.x1}
					y1={seg.y1}
					x2={seg.x2}
					y2={seg.y2}
					stroke={cfg.leaderLineColor ?? "#999999"}
					strokeWidth={leaderWidth}
					// Fades with the label it points at (legend hover).
					opacity={
						b.opacityMul != null && b.opacityMul < 1 ? b.opacityMul : undefined
					}
				/>,
			]
		})
		return (
			<g aria-hidden="true" pointerEvents="none" data-vc-data-labels>
				<g data-testid="geo-leader-lines">{leaderLines}</g>
				{labels}
			</g>
		)
	}

	// --- Row-based path (scatter / fallback). ---------------------------
	// At least one position field must be mapped — without that, there's
	// nothing to anchor labels to. The label content falls back to the
	// position field's value when no explicit value field is mapped.
	if (!xField && !yField) return null
	if ((xField && (!xScale || !xType)) || (yField && (!yScale || !yType))) {
		return null
	}

	let hueScale: HueScale | null = null
	if (hueField && hueConfig) {
		// Build the hue domain from the FULL dataset, not the (possibly
		// faceted / filtered) rows we're about to draw. This mirrors the
		// load-bearing invariant the marks' hue scale relies on (see
		// useAestheticScales): a chart faceted by — or otherwise narrowed to —
		// a single hue value would give each panel a one-entry domain,
		// collapsing every label to the palette's first color while the marks
		// stayed correctly varied. Falls back to the panel rows when the full
		// dataset view isn't available.
		const hueValues = (dataset?.rows ?? candidateRows).map((r) => r[hueField])
		const rowPalette =
			!isHueQuant && cfg.palette.length > 0 ? cfg.palette : undefined
		hueScale = makeHueScale(
			hueValues,
			hueFieldType,
			linkHue(hueConfig, hueField, rowPalette),
			rowPalette
		)
	}
	const sizeValues: number[] = sizeField
		? candidateRows
				.map((r) => Number(r[sizeField]))
				.filter((n) => Number.isFinite(n))
		: []

	// Build the row-based render boxes through the same shape the anchor path
	// uses, so the same selection / `nudgeOverlaps` passes apply. Series
	// identity for line charts comes from the connection field — each
	// connection group is one polyline, so its "last label" sits at the
	// rightmost data point of that line.
	const renderBoxes: RenderBox[] = candidateRows.flatMap((row, i) => {
		const cx =
			xField && xScale && xType
				? applyPositionScale(xScale, row[xField], xType)
				: null
		const cy =
			yField && yScale && yType
				? applyPositionScale(yScale, row[yField], yType)
				: null
		if (cx === null && cy === null) return []
		const anchorX = cx ?? 0
		const anchorY = cy ?? 0
		// Numeric backing for the label-level text-color rules: the value field
		// (or, in multi-field mode, the first selected field) — rules compare
		// against a number, not the composed string.
		const primaryField = multi
			? (encodings.value.fields?.[0] ?? null)
			: (valueField ?? xField ?? yField)
		const labelValue = primaryField ? row[primaryField] : undefined
		// One label per row: `{Variable}` rules test this row alone.
		const ruleRows = [row]
		const hueColor =
			hueScale && hueField
				? (applyHueScale(hueScale, row[hueField], hueFieldType) ?? null)
				: null
		const fill = resolveLabelFill(
			cfg,
			hueField ? row[hueField] : undefined,
			hueColor,
			labelValue,
			ruleRows
		)
		const fontSize = sizeField
			? resolveLabelSize(row[sizeField], cfg, sizeValues)
			: ptToPx(cfg.fontSize)
		// Connection field → series for line charts; fall back to hue when
		// connection isn't mapped (multi-line scatter could be hue-grouped).
		const seriesField = connectionField ?? hueField
		const series = seriesField ? String(row[seriesField] ?? "") : ""
		return ownKeys.flatMap((own) => {
		// Position rules evaluate against the same backing value the text-color
		// rules use; a match replaces the base offsets for this label. Resolved
		// per label key, so a separate variable's own rules see ITS value.
		const posRule = ownPositionRule(own, row, labelValue, ruleRows)
		// Text: single-field formats one field's value (nothing to show →
		// no box); multi-field composes the all-labels arrangement (or this
		// one standalone variable / combination), keeping an empty box so a
		// series-end population can still label the point.
		const template = ownTemplate(own, "all")
		const composed =
			template !== null
				? composeLabel(row, template, fill, fontSize, own, ruleRows)
				: null
		if (!composed && !multi) return []
		const label = composed?.label ?? ""
		const off = ownOffset(own)
		return [
			{
				cx: anchorX + (posRule?.xOffset ?? off.x),
				cy: anchorY + (posRule?.yOffset ?? off.y),
				ruleOffset: posRule !== null,
				anchorX,
				anchorY,
				text: label,
				fontSize: composed?.fontSize ?? fontSize,
				baseFontSize: fontSize,
				series,
				index: i,
				// Rows lack a stable id, so the existing renderer keys by index
				// (which was already eslint-disabled below). We carry that
				// through here.
				key: own === null ? `row-${i}` : `row-${i}#${own}`,
				fill,
				label,
				segments: composed?.segments,
				row,
				ruleRows,
				// `rowHighlight` guards on the hovered field being a column of
				// the row, so an unrelated legend hover leaves labels alone.
				opacityMul: rowHighlight(legendHighlight, row).opacityMul,
				ownField: own ?? undefined,
				alignment: ownAlignment(own),
			},
		]
		})
	})
	return renderLabels(selectAndSpread(renderBoxes), cfg, layerBg)
}
