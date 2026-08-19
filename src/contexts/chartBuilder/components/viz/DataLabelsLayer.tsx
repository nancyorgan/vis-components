import { useAtomValue } from "jotai"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	effectiveLabelPoints,
	type DataLabelsConfig,
	type HueConfig,
} from "../../lib/channelConfig"
import {
	labelHeight,
	labelWidth,
	leaderLineSegment,
	nudgeOverlaps,
	selectEndpointsPerSeries,
	spreadOverlaps2D,
	type LabelBox,
} from "../../lib/dataLabelsLayout"
import {
	buildLabelSegments,
	labelHueScaleParts,
	resolveLabelFill,
	resolveLabelSize,
} from "../../lib/dataLabelsStyle"
import { ptToPx } from "../../lib/fontUnit"
import { effectiveType } from "../../lib/fieldType"
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
	emptyDataLabelsEncodings,
	type DataLabelsEncodings,
	type FieldType,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

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
	/** Raw numeric value backing the label, when known. Feeds the
	 * conditional text-color rules — the formatted `label` string isn't
	 * sufficient because rules compare against the underlying number, not
	 * its rounded/decimaled display form. */
	labelValue?: unknown
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
	 * down (there are no series ends on a map). */
	positionGate?: "xy" | "polar" | "geo"
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
type RenderableLabel = {
	cx: number
	cy: number
	text: string
	fontSize: number
	fill: string
	label: string
	key: string
	/** Per-variable colored pieces (multi-field labels with field colors).
	 *  When present, each piece renders as its own `<tspan>` fill; with
	 *  wrapping on, pieces line-break at the plain label's wrap points via
	 *  `wrapSegments`. */
	segments?: { text: string; fill: string }[]
	/** Per-box alignment override (endpoint labels). Unset → `cfg.alignment`. */
	alignment?: "left" | "center" | "right"
}

/** Map an alignment value onto the SVG `text-anchor` it renders as. */
const alignmentAnchor = (
	alignment: DataLabelsConfig["alignment"]
): "start" | "middle" | "end" =>
	alignment === "left" ? "start" : alignment === "right" ? "end" : "middle"

/** Positioning inputs the `labelPoints` pass needs beyond the layout box:
 *  the RAW anchor coords (pre-offset), so an endpoint's offset override can
 *  REPLACE the layer-wide offset instead of stacking on top of it. */
type EndpointAwareBox = LabelBox & {
	label: string
	anchorX: number
	anchorY: number
	alignment?: "left" | "center" | "right"
}

/** Apply the effective `labelPoints` selection: drop unselected boxes and —
 *  in `"first-last"` mode only — restyle the survivors from their endpoint's
 *  override block (offset replaces, alignment replaces; unset fields inherit
 *  the layer values the box was built with). The single `"first"` / `"last"`
 *  modes keep the layer-wide styling untouched: only one label population
 *  renders there, so the base controls ARE its controls (and the panel only
 *  splits into First/Last pairs when both ends are shown). Classification
 *  runs on the already-offset positions — the base offset is uniform, so
 *  the per-series ranking is unaffected.
 *
 *  `recomposeText` (row-based path only) rebuilds a box's text when the
 *  endpoint block carries its own template — anchor-based labels arrive
 *  pre-formatted from their renderer and never had templates, so they skip
 *  it by construction. */
const applyLabelPoints = <T extends EndpointAwareBox>(
	boxes: T[],
	cfg: DataLabelsConfig,
	axis: "x" | "y",
	recomposeText?: (box: T, template: string) => T
): T[] => {
	const mode = effectiveLabelPoints(cfg)
	if (mode === "all") return boxes
	const tags = selectEndpointsPerSeries(boxes, axis)
	const out: T[] = []
	for (const b of boxes) {
		const tag = tags.get(b)
		if (!tag) continue
		// A single-anchor series tags "both". It counts as the FIRST label
		// only when the user asked for firsts alone; in "last" and
		// "first-last" modes it takes the last-label styling — direct
		// labeling is the dominant intent for those modes.
		const end: "first" | "last" =
			tag === "both" ? (mode === "first" ? "first" : "last") : tag
		if (mode === "first" && end !== "first") continue
		if (mode === "last" && end !== "last") continue
		if (mode !== "first-last") {
			out.push(b)
			continue
		}
		const ov = (end === "first" ? cfg.firstLabel : cfg.lastLabel) ?? {}
		let next: T = {
			...b,
			cx: b.anchorX + (ov.xOffset ?? cfg.xOffset),
			cy: b.anchorY + (ov.yOffset ?? cfg.yOffset),
			alignment: ov.alignment ?? undefined,
		}
		// Empty string means "inherit", not "blank label" — hiding an
		// endpoint is `labelPoints`' job.
		const template = ov.labelTemplate ?? ""
		if (template !== "" && recomposeText) next = recomposeText(next, template)
		out.push(next)
	}
	return out
}

/** Emit the tspans for a WRAPPED segmented (per-variable colored) label:
 *  one entry per line, each piece carrying its own fill. Every line anchors
 *  its FIRST tspan at the line's computed start x — estimated from the same
 *  CHAR_WIDTH_RATIO heuristic the layout boxes use — with
 *  `textAnchor="start"`, so center / right alignment positions the whole
 *  line rather than just its first colored piece (an x-anchored tspan is
 *  positioned individually by SVG; inline followers just flow after it). */
const renderSegmentedLines = (
	segLines: { text: string; fill: string }[][],
	cx: number,
	fontSize: number,
	anchor: "start" | "middle" | "end",
	keyBase: string
): React.ReactNode[] => {
	// Same vertical-centering shift as `renderMultilineTspans` — the parent
	// `<text>` anchors with dominantBaseline="middle".
	const firstDy = `${-0.6 * (segLines.length - 1)}em`
	return segLines.flatMap((pieces, i) => {
		const lineText = pieces.map((p) => p.text).join("")
		const w = labelWidth({ text: lineText, fontSize })
		const startX =
			anchor === "start" ? cx : anchor === "end" ? cx - w : cx - w / 2
		const dy = i === 0 ? firstDy : "1.2em"
		// An empty line still contributes vertical space (same convention as
		// renderMultilineTspans — an empty tspan would collapse).
		if (pieces.length === 0) {
			return [
				<tspan
					// Line index IS its identity.
					// eslint-disable-next-line react/no-array-index-key
					key={`${keyBase}-l${i}`}
					x={startX}
					dy={dy}
					textAnchor="start"
				>
					{" "}
				</tspan>,
			]
		}
		return pieces.map((p, j) => (
			<tspan
				// Piece order is stable → position is its identity.
				// eslint-disable-next-line react/no-array-index-key
				key={`${keyBase}-l${i}-s${j}`}
				x={j === 0 ? startX : undefined}
				dy={j === 0 ? dy : undefined}
				textAnchor={j === 0 ? "start" : undefined}
				fill={p.fill}
			>
				{p.text}
			</tspan>
		))
	})
}

/** Fallback padding (px) for the text-background rect when the config hasn't
 * set explicit values — matches the historical baked-in look. */
const DEFAULT_BG_PAD_X = 3
const DEFAULT_BG_PAD_Y = 1.5

/** Emit the `<text>` elements (plus optional background rects) for a list of
 * resolved label boxes. Shared by the anchor-based and row-based paths so the
 * text-background, alignment, and font handling stay in one place. */
const renderLabels = (
	boxes: RenderableLabel[],
	cfg: DataLabelsConfig,
	bgColor: string
): React.ReactElement => {
	const baseAnchor = alignmentAnchor(cfg.alignment)
	const padX = cfg.textBackgroundPadX ?? DEFAULT_BG_PAD_X
	const padY = cfg.textBackgroundPadY ?? DEFAULT_BG_PAD_Y
	const wrap = cfg.wrapText === true
	const wrapMaxChars = cfg.wrapMaxChars ?? DEFAULT_DATA_LABELS_CONFIG.wrapMaxChars ?? 20
	return (
		<g aria-hidden="true" pointerEvents="none">
			{boxes.map((b) => {
				// Endpoint labels can carry their own alignment (first vs last
				// labels typically hang off opposite sides of their point).
				const textAnchor = b.alignment
					? alignmentAnchor(b.alignment)
					: baseAnchor
				// Per-variable colored segments render as colored tspans; when
				// wrapping is on they line-break at the same points the plain
				// label would (`wrapSegments` splits straddling pieces).
				const segs = b.segments ?? []
				const segmented = segs.length > 0
				// Split into lines up-front so the background rect and the
				// `<tspan>` emission agree on the label's footprint. A short
				// label (or wrapping off) yields a single line, keeping the
				// non-wrapped render byte-identical to before.
				const lines = wrap ? wrapByCharCount(b.label, wrapMaxChars) : [b.label]
				const multiline = lines.length > 1
				let rect: React.ReactElement | null = null
				if (cfg.textBackground) {
					// Size to the widest wrapped line; height grows per line at
					// the same 1.2em step `renderMultilineTspans` uses.
					const w =
						Math.max(...lines.map((l) => labelWidth({ text: l, fontSize: b.fontSize }))) +
						padX * 2
					const h =
						(multiline ? lines.length * b.fontSize * 1.2 : labelHeight(b)) + padY * 2
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
							rx={cfg.textBackgroundRadius ?? 0}
							fill={bgColor}
						/>
					)
				}
				return (
					<g key={b.key}>
						{rect}
						<text
							x={b.cx}
							y={b.cy}
							fill={b.fill}
							fontFamily={cfg.fontFamily}
							fontSize={b.fontSize}
							fontWeight={cfg.fontWeight}
							fontStyle={cfg.italic ? "italic" : undefined}
							textDecoration={cfg.underline ? "underline" : undefined}
							textAnchor={textAnchor}
							dominantBaseline="middle"
						>
							{segmented
								? multiline
									? renderSegmentedLines(
											wrapSegments(segs, wrapMaxChars),
											b.cx,
											b.fontSize,
											textAnchor,
											b.key
										)
									: segs.map((s, i) => (
											<tspan
												// Segment order is stable → index is its identity.
												// eslint-disable-next-line react/no-array-index-key
												key={`${b.key}-s${i}`}
												fill={s.fill}
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
	preferOpenSpace,
}: Props) => {
	const encodings: DataLabelsEncodings = {
		...emptyDataLabelsEncodings(),
		...useAtomValue(currentDataLabelsEncodingsAtom),
	}
	const cfg: DataLabelsConfig = {
		...DEFAULT_DATA_LABELS_CONFIG,
		...useAtomValue(currentDataLabelsConfigAtom),
	}
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	// When wrapping is on, the overlap pass (`nudgeOverlaps`) must reserve
	// each label's WRAPPED footprint — narrower and taller than the raw
	// single-line string — or it would collide-check a phantom one-line box.
	// Encode the wrapped lines into `text` (newline-joined); labelWidth /
	// labelHeight treat `\n` as line breaks. `label` stays the raw string —
	// `renderLabels` re-wraps it for the actual `<tspan>` emission, so the
	// layout box and the drawn text agree.
	const layoutWrapMaxChars =
		cfg.wrapMaxChars ?? DEFAULT_DATA_LABELS_CONFIG.wrapMaxChars ?? 20
	const wrapBoxForLayout = <T extends { text: string; label: string }>(
		box: T
	): T =>
		cfg.wrapText === true
			? { ...box, text: wrapByCharCount(box.label, layoutWrapMaxChars).join("\n") }
			: box
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
	const chartChannelConfigs = useAtomValue(currentChannelConfigsAtom)
	// Text-background fill: an explicit override wins, else inherit the
	// visualization's own background (white when that's transparent) so the
	// rect masks gridlines by blending into the chart canvas.
	const textBgColor =
		cfg.textBackgroundColor ?? chartChannelConfigs.backgroundColor ?? "#ffffff"

	const xField = encodings.x.field
	const yField = encodings.y.field
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

	// Gate: data labels only render when the user has explicitly mapped
	// the position field(s) AND the value field. Without this, labels would
	// "guess" a value from the position field — appearing the moment one
	// encoding is set, which is confusing during chart setup. Polar charts
	// (pies) gate on `angle` alone — `r` is optional (unmapped → labels sit
	// on the pie's border). Legacy `x` + `y` still satisfy it so saved pie
	// visuals from before the polar channels keep rendering.
	const positionMapped =
		positionGate === "polar"
			? Boolean(angleField) || (Boolean(xField) && Boolean(yField))
			: positionGate === "geo"
				? Boolean(encodings.geography?.field)
				: Boolean(xField) && Boolean(yField)
	// "Value" is satisfied by a single mapped field OR multi-field mode with
	// at least one field checked (multi-field mode leaves `value.field` null).
	const valueMapped =
		Boolean(valueField) ||
		(encodings.value.multiField === true &&
			(encodings.value.fields?.length ?? 0) > 0)
	if (!positionMapped || !valueMapped) return null

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
			hueScale = makeHueScale(values, hueFieldType, hueConfig, customPalette)
		}
		const sizeValues = sizeField
			? anchors
					.map((a) => Number(a.sizeValue))
					.filter((n) => Number.isFinite(n))
			: []
		// Build per-anchor render boxes once so the post-passes (`labelPoints`
		// + `avoidOverlaps`) operate on a stable shape and the downstream
		// `<text>` map can read its already-resolved fields.
		type RenderBox = EndpointAwareBox & {
			key: string
			fill: string
		}
		const renderBoxes: RenderBox[] = anchors.flatMap((a, i) => {
			if (a.label === null) return []
			const hueColor =
				hueScale && a.hueValue !== undefined
					? (applyHueScale(hueScale, a.hueValue, hueFieldType) ?? null)
					: null
			const fill = resolveLabelFill(cfg, a.hueValue, hueColor, a.labelValue)
			const fontSize = sizeField
				? resolveLabelSize(a.sizeValue, cfg, sizeValues)
				: ptToPx(cfg.fontSize)
			return [
				{
					cx: a.cx + cfg.xOffset,
					cy: a.cy + cfg.yOffset,
					anchorX: a.cx,
					anchorY: a.cy,
					text: a.label,
					fontSize,
					// Anchor-based renderers (bars/areas) carry the hue value as
					// the de-facto "series" identity — every slice in the same
					// stack/layer shares the same hue. Falls back to "" when
					// no hue is mapped, which `keepLastPerSeries` interprets as
					// "all anchors are one big group" (single-survivor fallback).
					series: a.hueValue === undefined ? "" : String(a.hueValue ?? ""),
					index: i,
					key: a.key,
					fill,
					label: a.label,
				},
			]
		})
		// Pick the primary axis for endpoint-per-series ranking. When the
		// chart's categorical axis is x (vertical bars/areas, scatter), the
		// "last" anchor is the rightmost (largest cx). When it's y
		// (horizontal bars/areas), use cy. xType/yType arrive from the
		// caller via props so we don't need to know the chart mode here.
		const lastAxis: "x" | "y" =
			yType === "categorical" || yType === "ordinal" ? "y" : "x"
		const layoutBoxes = renderBoxes.map(wrapBoxForLayout)
		// Maps have no per-series endpoints, so the `labelPoints` selection is
		// skipped there — a stored "last per series" from a previous chart must
		// not silently drop every region label but one.
		const filtered =
			positionGate === "geo"
				? layoutBoxes
				: applyLabelPoints(layoutBoxes, cfg, lastAxis)
		// Overlap pass: maps spread colliding labels in ANY direction (their
		// anchors scatter over a plane, and a downward-only pile looks lopsided
		// with leader lines); series charts keep the vertical-only nudge, which
		// preserves the reading order of stacked end-of-line labels.
		const finalBoxes = cfg.avoidOverlaps
			? positionGate === "geo"
				? spreadOverlaps2D(filtered, { prefer: preferOpenSpace })
				: nudgeOverlaps(filtered)
			: filtered
		const labels = renderLabels(finalBoxes, cfg, textBgColor)
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
		const leaderPadX =
			(cfg.textBackground ? (cfg.textBackgroundPadX ?? DEFAULT_BG_PAD_X) : 0) + 2
		const leaderPadY =
			(cfg.textBackground ? (cfg.textBackgroundPadY ?? DEFAULT_BG_PAD_Y) : 0) + 2
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
				/>,
			]
		})
		return (
			<g aria-hidden="true" pointerEvents="none">
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

	const candidateRows = rowFilter ? rows.filter(rowFilter) : rows

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
		hueScale = makeHueScale(
			hueValues,
			hueFieldType,
			hueConfig,
			!isHueQuant && cfg.palette.length > 0 ? cfg.palette : undefined
		)
	}
	const sizeValues: number[] = sizeField
		? candidateRows
				.map((r) => Number(r[sizeField]))
				.filter((n) => Number.isFinite(n))
		: []

	type RenderBox = EndpointAwareBox & {
		key: string
		fill: string
		/** Per-variable colored pieces (multi-field mode with field colors).
		 *  When set, `renderLabels` draws one `<tspan>` per segment with its
		 *  own fill instead of the single-color `label`. */
		segments?: { text: string; fill: string }[]
	}

	// Per-variable label color (multi-field): one color slot per shown field
	// (`cfg.fieldColors[field]`), mirroring the mark color slots. A slot with
	// no field → its single color; a slot varying by a field → a hue scale
	// over that field. Prebuild each slot's scale once (few slots), then look
	// up per row. No slot for a field → that segment uses the label's base fill.
	const fieldColorScales = new Map<
		string,
		{ scale: HueScale; field: string; type: FieldType }
	>()
	for (const [fieldName, slotCfg] of Object.entries(cfg.fieldColors ?? {})) {
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
				slotCfg.hue,
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
	// by a field) or its single color.
	const resolveSegmentFill = (
		field: string | null,
		row: Record<string, unknown>,
		baseFill: string
	): string => {
		if (!field) return baseFill
		const slotCfg = cfg.fieldColors?.[field]
		if (!slotCfg) return baseFill
		if (slotCfg.field) {
			const s = fieldColorScales.get(field)
			const c = s ? applyHueScale(s.scale, row[s.field], s.type) : null
			return c ?? slotCfg.singleColor ?? baseFill
		}
		return slotCfg.singleColor ?? baseFill
	}

	// Build the row-based render boxes through the same shape the anchor path
	// uses, so the same `keepLastPerSeries` / `nudgeOverlaps` passes apply.
	// Series identity for line charts comes from the connection field —
	// each connection group is one polyline, so its "last label" sits at
	// the rightmost data point of that line.
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
		// Text: single-field formats one field's value; multi-field composes
		// several from the template. `buildLabelSegments` returns the ordered
		// pieces (value segments carry their field name; literals don't) so we
		// can color each variable independently. Fall back to the position
		// field when no value field is mapped.
		const segs = buildLabelSegments(row, encodings.value, cfg, xField ?? yField)
		if (!segs) return []
		const label = segs.map((s) => s.text).join("")
		// Numeric backing for the label-level text-color rules: the value field
		// (or, in multi-field mode, the first selected field) — rules compare
		// against a number, not the composed string.
		const primaryField = encodings.value.multiField
			? (encodings.value.fields?.[0] ?? null)
			: (valueField ?? xField ?? yField)
		const labelValue = primaryField ? row[primaryField] : undefined
		const hueColor =
			hueScale && hueField
				? (applyHueScale(hueScale, row[hueField], hueFieldType) ?? null)
				: null
		const fill = resolveLabelFill(
			cfg,
			hueField ? row[hueField] : undefined,
			hueColor,
			labelValue
		)
		// Resolve each segment's color; only carry `segments` when at least one
		// differs from the base fill, so single-color labels keep the plain
		// (wrappable) render path.
		const coloredSegs = segs.map((s) => ({
			text: s.text,
			fill: resolveSegmentFill(s.field, row, fill),
		}))
		const segments = coloredSegs.some((s) => s.fill !== fill)
			? coloredSegs
			: undefined
		const fontSize = sizeField
			? resolveLabelSize(row[sizeField], cfg, sizeValues)
			: ptToPx(cfg.fontSize)
		// Connection field → series for line charts; fall back to hue when
		// connection isn't mapped (multi-line scatter could be hue-grouped).
		const seriesField = connectionField ?? hueField
		const series = seriesField ? String(row[seriesField] ?? "") : ""
		return [
			{
				cx: anchorX + cfg.xOffset,
				cy: anchorY + cfg.yOffset,
				anchorX,
				anchorY,
				text: label,
				fontSize,
				series,
				index: i,
				// Rows lack a stable id, so the existing renderer keys by index
				// (which was already eslint-disabled below). We carry that
				// through here.
				key: `row-${i}`,
				fill,
				label,
				segments,
			},
		]
	})
	const lastAxis: "x" | "y" =
		yType === "categorical" || yType === "ordinal" ? "y" : "x"
	const layoutBoxes = renderBoxes.map(wrapBoxForLayout)
	// Endpoint template override (multi-field mode): rebuild the box's text —
	// and its per-variable colored segments — from the endpoint's template.
	// `index` is the box's position in `candidateRows`, so the source row is
	// still at hand. Runs BEFORE `nudgeOverlaps` so collision boxes measure
	// the final (often wider) text.
	const recomposeForEndpoint = (box: RenderBox, template: string): RenderBox => {
		if (encodings.value.multiField !== true) return box
		const row = candidateRows[box.index]
		if (!row) return box
		const segs = buildLabelSegments(
			row,
			encodings.value,
			{ ...cfg, labelTemplate: template },
			xField ?? yField
		)
		if (!segs) return box
		const label = segs.map((s) => s.text).join("")
		const coloredSegs = segs.map((s) => ({
			text: s.text,
			fill: resolveSegmentFill(s.field, row, box.fill),
		}))
		const segments = coloredSegs.some((s) => s.fill !== box.fill)
			? coloredSegs
			: undefined
		return wrapBoxForLayout({ ...box, label, text: label, segments })
	}
	const filtered = applyLabelPoints(
		layoutBoxes,
		cfg,
		lastAxis,
		recomposeForEndpoint
	)
	const finalBoxes = cfg.avoidOverlaps ? nudgeOverlaps(filtered) : filtered

	return renderLabels(finalBoxes, cfg, textBgColor)
}
