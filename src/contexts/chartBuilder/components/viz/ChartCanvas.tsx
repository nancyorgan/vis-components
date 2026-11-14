import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import useMeasure from "react-use-measure"
import { useAtomValue, useSetAtom } from "jotai"
import type { CanvasMargins } from "../../lib/channelConfig"
import type { TitleOverhang } from "../../lib/facetLayoutSolver"
import {
	inkSlack,
	MARGIN_MAX_PASSES,
	measureInkExtent,
	nextMarginCorrection,
	ZERO_SIDES,
	type SideValues,
} from "../../lib/inkExtent"
import {
	DEFAULT_LABELS_CONFIG,
	hasChartTitle,
	DEFAULT_LEGEND_CONFIG,
	resolveTitleFont,
	type LegendConfig,
} from "../../lib/labelsConfig"
import { INSIDE_AUTO_X_INSET } from "../../lib/legendSections"
import {
	BASE_MARGIN,
	CHART_PAD,
	INSIDE_LEGEND_EDGE_BUFFER,
	subtitleReserve,
	titleReserve,
} from "../../lib/plotLayout"
import { resolveCanvasMargins } from "../../lib/themeConfig"
import { ALL_ENCODING_CHANNELS } from "../../lib/types"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import {
	currentEncodingsAtom,
	renderedLabelsAtom,
	currentRenderedCanvasSlackAtom,
	currentRenderedFigureSlackAtom,
	currentRenderedFitFloorAtom,
	currentRenderedInsideAutoXAtom,
	currentRenderedLayoutVersionAtom,
} from "../../store/atoms"
import {
	renderChannelConfigsAtom,
	renderLegendConfigAtom,
} from "../../store/renderConfigs"
import {
	useCurrentDatasetStatus,
	useCurrentDatasetView,
} from "../../store/useCurrentDatasetView"

import { useInEditorCanvas } from "./EditorCanvasContext"
import { Legend, type InsideExtras } from "./Legend"
import { PlotCanvas } from "./PlotCanvas"

const SpinnerIcon = () => (
	<svg
		width="14"
		height="14"
		viewBox="0 0 16 16"
		fill="none"
		aria-hidden="true"
	>
		<circle
			cx="8"
			cy="8"
			r="6"
			stroke="currentColor"
			strokeWidth="2"
			opacity="0.25"
		/>
		<path
			d="M14 8a6 6 0 0 0-6-6"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
		/>
	</svg>
)

export const ChartBody = ({
	titleOverhang,
}: {
	/** Room beside the chart area (the legend column) the chart title /
	 *  subtitle may paint into — measured by ChartCanvasBody; see PlotCanvas. */
	titleOverhang?: TitleOverhang
} = {}) => {
	const dataset = useCurrentDatasetView()
	const status = useCurrentDatasetStatus()
	const channelConfigs = useAtomValue(renderChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const inEditor = useInEditorCanvas()
	const bgStyle: React.CSSProperties | undefined =
		channelConfigs.backgroundColor
			? { backgroundColor: channelConfigs.backgroundColor }
			: undefined
	if (!dataset) {
		return (
			<div
				className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center vc-muted"
				style={bgStyle}
			>
				{status === "loading" ? (
					// Rows are in flight. Blank at first — the CSS delay keeps a
					// fast load from flashing a spinner — then an acknowledged
					// wait. Pure CSS rather than a timer in state, so no effect
					// churn on every load.
					//
					// Whatever this renders must never mount the plot SVG:
					// `chartLayoutReady` treats any non-zero-sized
					// `#PLOT_SVG_ID` as a finished chart, so drawing an empty
					// one here would let the thumbnail pipeline capture it as a
					// stable frame and save a blank preview.
					<div
						role="status"
						className="flex items-center gap-2 text-sm opacity-0"
						style={{
							animation: "vc-delayed-reveal 0s linear 500ms both",
						}}
						data-dataset-loading
					>
						<style>{"@keyframes vc-delayed-reveal { to { opacity: 1 } }"}</style>
						<span className="animate-spin">
							<SpinnerIcon />
						</span>
						Loading data…
					</div>
				) : status === "error" ? (
					<>
						<div className="text-sm">Couldn&apos;t load this data set.</div>
						<div className="text-sm">
							Check your connection and reload to try again.
						</div>
					</>
				) : status === "missing" ? (
					<>
						<div className="text-sm">This data set could not be loaded.</div>
						<div className="text-sm">
							It may have been deleted from another session.
						</div>
					</>
				) : (
					<>
						<div className="text-sm">No data set loaded.</div>
					</>
				)}
			</div>
		)
	}
	// Data but nothing mapped yet: point the editor user at the two ways in.
	// An overlay, not a replacement — the (blank) plot stays mounted so
	// layout readiness behaves as it does for any other chart.
	const showHint =
		inEditor && ALL_ENCODING_CHANNELS.every((ch) => encodings[ch]?.field == null)
	// PlotCanvas handles BOTH faceted and single-panel cases — single is
	// just a 1×1 facet grid.
	if (!bgStyle && !showHint) return <PlotCanvas titleOverhang={titleOverhang} />
	return (
		<div
			className={showHint ? "relative h-full w-full" : "h-full w-full"}
			style={bgStyle}
		>
			<PlotCanvas titleOverhang={titleOverhang} />
			{showHint && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm vc-muted">
					Assign variables to visual elements in the Encodings section, or
					use a Quickstart chart to get started.
				</div>
			)}
		</div>
	)
}

export const ChartCanvas = () => {
	const dataset = useCurrentDatasetView()
	const channelConfigs = useAtomValue(renderChannelConfigsAtom)
	const theme = useCurrentTheme()
	const bgStyle: React.CSSProperties | undefined =
		channelConfigs.backgroundColor
			? { backgroundColor: channelConfigs.backgroundColor }
			: undefined

	if (!dataset) {
		return <ChartBody />
	}
	// Fixed canvas size (Aesthetics → Canvas size): the chart box sits inside
	// a frame that enforces the user's margins against the RENDERED ink. The
	// body element is created here, so the frame's own re-renders (every
	// layout pass) never re-render the chart tree underneath.
	const canvasSize = channelConfigs.canvasSize
	const body = <ChartCanvasBody bgStyle={bgStyle} />
	if (!canvasSize?.enabled) return body
	// Sides the visual leaves blank inherit the theme's Exporting defaults
	// (live — the theme is the current `themesAtom` entry, not a snapshot).
	return (
		<CanvasMarginFrame
			margins={resolveCanvasMargins(theme, canvasSize.margins)}
			bgStyle={bgStyle}
		>
			{body}
		</CanvasMarginFrame>
	)
}

/** Enforces fixed-canvas margins (`CanvasSizeConfig.margins`) by measuring
 *  the rendered ink and moving the chart box's edges so the nearest painted
 *  content on each SET side lands exactly `margin` px from the canvas edge
 *  (auto sides keep the inset at 0 — today's layout slack). The layout
 *  solver's bands leave slack nobody asked for, so this is a measure →
 *  correct → re-solve loop: each layout pass (`currentRenderedLayoutVersionAtom`)
 *  re-measures, and a side settles once its slack is within
 *  `MARGIN_TOLERANCE_PX` of the correction — normally on the second pass.
 *  `MARGIN_MAX_PASSES` self-induced passes cap a layout that flips with
 *  the box size. The measured slack is published for the sidebar's
 *  placeholders whether or not any side is set.
 *
 *  Measuring happens ONLY on a layout bump, never on the correction's own
 *  render: right after an inset changes the SVG is still the previous
 *  solve's size, so a measurement then would read stale slack. */
const CanvasMarginFrame = ({
	margins,
	bgStyle,
	children,
}: {
	margins: CanvasMargins
	bgStyle: React.CSSProperties | undefined
	children: React.ReactNode
}) => {
	const boxRef = useRef<HTMLDivElement>(null)
	const [correction, setCorrection] = useState<SideValues>({ ...ZERO_SIDES })
	// Refs, not deps: the effect below must run on layout bumps ONLY. A
	// margin edit changes the inset in the same render, which re-solves and
	// bumps on its own; measuring at edit time would read the previous
	// solve's SVG against the new box and chase a bogus slack first.
	const correctionRef = useRef(correction)
	const marginsRef = useRef(margins)
	// Synced in a layout effect (never during render), declared BEFORE the
	// measuring effect so it always sees the committed values.
	useLayoutEffect(() => {
		correctionRef.current = correction
		marginsRef.current = margins
	})
	const layoutVersion = useAtomValue(currentRenderedLayoutVersionAtom)
	const setSlack = useSetAtom(currentRenderedCanvasSlackAtom)
	// Passes this frame caused itself (a correction → re-solve → bump), so a
	// layout that never settles stops being chased.
	const selfPasses = useRef(0)
	const pending = useRef(false)

	useLayoutEffect(() => {
		const box = boxRef.current
		if (!box) return
		const ink = measureInkExtent(box)
		if (!ink) return
		const slack = inkSlack(ink, box.offsetWidth, box.offsetHeight)
		const rounded: SideValues = {
			top: Math.round(slack.top),
			right: Math.round(slack.right),
			bottom: Math.round(slack.bottom),
			left: Math.round(slack.left),
		}
		setSlack((prev) =>
			prev &&
			prev.top === rounded.top &&
			prev.right === rounded.right &&
			prev.bottom === rounded.bottom &&
			prev.left === rounded.left
				? prev
				: rounded,
		)
		if (pending.current) {
			pending.current = false
			selfPasses.current += 1
		} else {
			selfPasses.current = 0
		}
		const next = nextMarginCorrection(
			marginsRef.current,
			slack,
			correctionRef.current,
		)
		if (!next || selfPasses.current >= MARGIN_MAX_PASSES) return
		pending.current = true
		setCorrection(next)
	}, [layoutVersion, setSlack])

	useEffect(() => () => setSlack(null), [setSlack])

	const inset = (side: keyof SideValues): number =>
		margins[side] == null ? 0 : margins[side] - correction[side]

	return (
		<div
			className="relative h-full w-full overflow-hidden"
			style={bgStyle}
			data-canvas-margin-frame
		>
			<div
				ref={boxRef}
				className="absolute"
				data-canvas-margin-box
				style={{
					top: inset("top"),
					right: inset("right"),
					bottom: inset("bottom"),
					left: inset("left"),
				}}
			>
				{children}
			</div>
		</div>
	)
}

const ChartCanvasBody = ({
	bgStyle,
}: {
	bgStyle: React.CSSProperties | undefined
}) => {
	const legendCfg: LegendConfig = {
		...DEFAULT_LEGEND_CONFIG,
		...useAtomValue(renderLegendConfigAtom),
	}
	const figureSlack = useAtomValue(currentRenderedFigureSlackAtom)
	const fitFloor = useAtomValue(currentRenderedFitFloorAtom)

	const pos = legendCfg.position

	// Chart title / subtitle overhang: beside a left / right legend the band
	// above the legend is blank, and PlotCanvas lets those two texts paint
	// past the SVG box into it (LAYOUT.md §7). The room is MEASURED, not
	// derived from the legend's sizing rules: the column is whatever the flex
	// row gave the legend (content width, fixed width, multi-column cap,
	// margins), so row − chart area is exact. Layout sizes (`offsetSize`),
	// like PlotCanvas's own bounds; the figure-slack pull below is paint-only
	// and never changes them. The hooks run unconditionally; only a side
	// legend reports any room, and the inside layout never reads it.
	const [rowRef, rowBounds] = useMeasure({ offsetSize: true })
	const [chartRef, chartBounds] = useMeasure({ offsetSize: true })
	const legendColumn =
		(pos === "left" || pos === "right") &&
		rowBounds.width > 0 &&
		chartBounds.width > 0
			? Math.max(0, rowBounds.width - chartBounds.width)
			: 0
	// The SVG sits inside the chart area's own `p-3`, so that pad is room too.
	const overhang = legendColumn > 0 ? CHART_PAD + legendColumn : 0
	const titleOverhang = useMemo<TitleOverhang>(
		() => ({
			left: pos === "left" ? overhang : 0,
			right: pos === "right" ? overhang : 0,
		}),
		[pos, overhang],
	)

	if (pos === "inside") {
		return <InsideLegendLayout legendCfg={legendCfg} bgStyle={bgStyle} />
	}

	const stacked = pos === "top" || pos === "bottom"
	const flexDirection = stacked ? "flex-col" : "flex-row"
	const legendFirst = pos === "top" || pos === "left"
	// The legend and the chart share the page along one axis, and both ask
	// for room on it (LAYOUT.md §2). The chart takes what the legend leaves,
	// down to the smallest area it still fits (`fitFloor`: its titles and
	// base margins around a plot squeezed to nothing). Past that the legend
	// is what gives way: it may shrink and scrolls inside itself
	// (`legendSections`), so the chart area is never left smaller than its
	// canvas — which is what used to push the plot off the page and raise a
	// scrollbar under a legend taller than the page. The floor is the
	// solver's, plus this area's own pad; a legend that fits is untouched.
	const floor = stacked ? fitFloor.height : fitFloor.width
	const chartFloor: React.CSSProperties | undefined =
		floor > 0
			? stacked
				? { minHeight: floor + 2 * CHART_PAD }
				: { minWidth: floor + 2 * CHART_PAD }
			: undefined
	const chart = (
		// data-editor-chart-plot: the Export modal's Embed tab measures this
		// (the plot area sans legend) to size the split-legend "chart" iframe,
		// so the snippet inherits the on-screen chart dimensions.
		<div
			ref={chartRef}
			className="min-h-0 min-w-0 flex-1 p-3"
			style={chartFloor}
			key="chart"
			data-editor-chart-plot
		>
			<ChartBody titleOverhang={titleOverhang} />
		</div>
	)
	// Fixed aspect ratio: the figure is centered in the chart area, so the
	// solver's slack sits as blank SVG between figure and legend. Pull the
	// legend inward by half of it → it hugs the figure at its normal
	// distance, and the [figure][legend] ensemble centers in the viewport.
	// The pull is a paint-only `transform`: it moves pixels without touching
	// flex layout, so the chart's measured width never changes — no
	// measure→solve feedback, the slack atom publishes once per real resize,
	// and the [slack/2][figure][legend][slack/2] ensemble-centering math
	// holds exactly. (Margins were rejected: a negative main-axis margin on
	// a flex item frees up main-axis space, which the `flex-1` chart absorbs
	// — growing the chart instead of moving the legend, and re-triggering
	// the solve.) zIndex keeps the legend painted above the (blank) SVG edge
	// it now genuinely overlaps. The pull goes on the Legend root via
	// `pullStyle` rather than a wrapper div: the root's flex-sensitive
	// classes (`flex-shrink-0`, `self-end`/`self-center`, cross-axis
	// stretch, `maxWidth: 100%`-based caps) must stay direct flex items of
	// this container or ratio-off layouts would shift. When the slack is 0
	// the transform is `translate(0px)` → no-op.
	const pull: React.CSSProperties =
		pos === "right"
			? { transform: `translateX(${-figureSlack.x / 2}px)` }
			: pos === "left"
				? { transform: `translateX(${figureSlack.x / 2}px)` }
				: pos === "bottom"
					? { transform: `translateY(${-figureSlack.y / 2}px)` }
					: { transform: `translateY(${figureSlack.y / 2}px)` }
	const legend = (
		<Legend
			key="legend"
			pullStyle={{ position: "relative", zIndex: 10, ...pull }}
		/>
	)

	return (
		<div
			ref={rowRef}
			className={`flex h-full w-full ${flexDirection}`}
			style={bgStyle}
		>
			{legendFirst ? legend : chart}
			{legendFirst ? chart : legend}
		</div>
	)
}

/** Breathing room (px) kept between an inside legend and the canvas edge. The
 *  reservation below solves for the legend landing this far short of the
 *  edge, and the legend's own position clamp (`legendSections`) uses the same
 *  inset, so a corner/edge legend never sits right against the boundary. */
export const EDGE_BUFFER = INSIDE_LEGEND_EDGE_BUFFER

/** Inside-position layout: legend overlays the chart canvas at user-supplied
 *  plot-area-normalized coords. When the (top-left-anchored) legend's body
 *  spills past the canvas — whether the coord is out of the plot rectangle
 *  (`insideY < 0`, `insideY > 1`, …) OR just an in-bounds coord near the
 *  right/bottom edge whose legend runs off-canvas (e.g. a top-right legend at
 *  X≈0.96) — shrink the chart side that overflows so the legend has visible
 *  room instead of getting clipped or pushing the viewport into scroll.
 *  Mirrors what the "bottom" preset does, but driven by the user's exact
 *  coords. */
const InsideLegendLayout = ({
	legendCfg,
	bgStyle,
}: {
	legendCfg: LegendConfig
	bgStyle: React.CSSProperties | undefined
}) => {
	// `offsetSize`: measure LAYOUT size (offsetWidth/Height), not the
	// bounding rect. On narrow screens the editor shrinks a fixed-size
	// canvas with a display-only CSS transform (EditorLayout); the rect
	// would report the shrunken size and the chart would solve for it,
	// then be scaled down again. Same in PlotCanvas.
	const [canvasRef, canvasBounds] = useMeasure({ offsetSize: true })
	const [legendRef, legendBounds] = useMeasure({ offsetSize: true })
	const labels = useAtomValue(renderedLabelsAtom)
	const hasTitle = hasChartTitle(labels)
	const hasSubtitle = !!(labels.subtitle ?? DEFAULT_LABELS_CONFIG.subtitle)
	// Font-derived, matching the solver's bands (see plotLayout.titleReserve)
	// so the inside-legend plot mapping stays glued to the real plot top.
	const titleReserves =
		(hasTitle
			? titleReserve(
					resolveTitleFont(labels.baseFont, "primary", labels.fontOverrides?.title)
						.size
				)
			: 0) +
		(hasSubtitle
			? subtitleReserve(
					resolveTitleFont(
						labels.baseFont,
						"subtitle",
						labels.fontOverrides?.subtitle
					).size
				)
			: 0)
	const extras = computeInsideExtras({
		insideX: legendCfg.insideX,
		insideY: legendCfg.insideY,
		canvasW: canvasBounds.width,
		canvasH: canvasBounds.height,
		legendW: legendBounds.width,
		legendH: legendBounds.height,
		titleReserves,
	})
	const figureSlack = useAtomValue(currentRenderedFigureSlackAtom)
	// The legend's inside coords map over the plot area via insideExtras.
	// With the grid centered, the plot edges moved inward by slack/2 per
	// side — reflect that ONLY in the legend's mapping extras, never in
	// the chart padding (which would trigger a measure→solve feedback loop).
	const legendExtras: InsideExtras = {
		top: extras.top + figureSlack.y / 2,
		right: extras.right + figureSlack.x / 2,
		bottom: extras.bottom + figureSlack.y / 2,
		left: extras.left + figureSlack.x / 2,
	}
	// When X is auto (null = right-edge-anchored upper-right corner), publish
	// the equivalent top-left-anchored X so the Legend panel's X input can
	// show it as its placeholder — typing/stepping then starts from where the
	// legend actually sits instead of jumping it back to the left. Mirrors
	// the legend's own calc(): plot width = canvas minus the same horizontal
	// reserve (extras.left/right are 0 in the auto case).
	const setRenderedAutoX = useSetAtom(currentRenderedInsideAutoXAtom)
	const autoPlotW =
		canvasBounds.width -
		(2 * CHART_PAD + BASE_MARGIN.left + BASE_MARGIN.right) -
		figureSlack.x
	const autoX =
		legendCfg.insideX == null && autoPlotW > 0 && legendBounds.width > 0
			? 1 - INSIDE_AUTO_X_INSET - legendBounds.width / autoPlotW
			: null
	useEffect(() => {
		setRenderedAutoX(autoX)
		return () => setRenderedAutoX(null)
	}, [autoX, setRenderedAutoX])
	return (
		<div
			ref={canvasRef}
			className="relative h-full w-full overflow-hidden"
			style={bgStyle}
		>
			<div
				className="h-full w-full"
				style={{
					paddingTop: CHART_PAD + extras.top,
					paddingRight: CHART_PAD + extras.right,
					paddingBottom: CHART_PAD + extras.bottom,
					paddingLeft: CHART_PAD + extras.left,
				}}
			>
				<ChartBody />
			</div>
			<Legend
				insideExtras={legendExtras}
				insideMeasureRef={legendRef}
				insideSize={{ width: legendBounds.width, height: legendBounds.height }}
			/>
		</div>
	)
}

/** Below this efficiency, padding a side stops being worth it — see
 *  `reserveGain`. The one tunable here. Lower keeps the exact fit over more
 *  of the plot but steepens the taper (the padding then changes faster as
 *  the legend moves through it): at 0.5 a legend as tall as the canvas moved
 *  the plot about 5 px per px of its own movement; at 0.7 about 2. */
const MIN_RESERVE_EFFICIENCY = 0.7

/** Padding per pixel of spill, given how efficiently padding a side moves
 *  the legend (`efficiency` = px the legend's edge moves per px of padding).
 *
 *  The legend's position is a FRACTION of the plot, so padding the chart by
 *  `e` on a side moves the legend by only `efficiency × e`: 1 when it is
 *  anchored at that edge of the plot, falling to 0 at the opposite edge.
 *  Clearing a spill exactly therefore takes `spill / efficiency` — and near
 *  efficiency 0 that asks for the whole chart to make room for one more
 *  legend row (at the default Y of 0.98 the bottom's efficiency is 0.02: fifty
 *  pixels of padding per pixel of legend).
 *
 *  So the exact answer is used only where padding is efficient. Below
 *  `MIN_RESERVE_EFFICIENCY` the gain falls smoothly to 0 instead, the plot
 *  keeps its size, and the legend's own position clamp (`legendSections`)
 *  holds it in view by sliding it to the edge. Continuous in the efficiency,
 *  and never more than `1 / MIN_RESERVE_EFFICIENCY` px of padding per px of
 *  legend. */
const reserveGain = (efficiency: number): number =>
	efficiency >= MIN_RESERVE_EFFICIENCY
		? 1 / efficiency
		: Math.max(0, efficiency) / MIN_RESERVE_EFFICIENCY ** 2

/** Room the chart gives up on each side so an inside legend placed past (or
 *  against) the canvas edge stays in view. Each side is solved independently
 *  (assuming the perpendicular sides need no extras), which leaves a tiny
 *  slack when both X and Y are outside the plot rectangle — acceptable for
 *  the use case (legend in a corner). Returns 0 on first paint while
 *  measurements are still `0`.
 *
 *  The legend is anchored by its TOP-LEFT corner at plot-relative
 *  (insideX, insideY) — (0, 0) the plot's bottom-left, (1, 1) its top-right —
 *  and extends right and down. With no extras its box is
 *
 *      left = plotLeft + insideX × plotW        top = plotBottom − insideY × plotH
 *
 *  and each side's SPILL is how far that box passes the canvas edge (less
 *  `EDGE_BUFFER`). A side's padding is `spill × reserveGain(efficiency)`:
 *
 *      side     efficiency   exact when
 *      right    insideX      insideX ≥ 0.7
 *      bottom   1 − insideY  insideY ≤ 0.3
 *      left     1 − insideX  always (it only spills when insideX < 0)
 *      top      insideY      always (it only spills when insideY > 1)
 *
 *  No side is switched on by a threshold: each is 0 exactly while its spill
 *  is, and grows from there, so moving the legend or growing it never steps
 *  the padding. And no side can take more than the plot has. */
export const computeInsideExtras = ({
	insideX,
	insideY,
	canvasW,
	canvasH,
	legendW,
	legendH,
	titleReserves,
}: {
	/** `null` = auto: right-edge-anchored in the plot's upper-right corner,
	 *  which by construction never extends past the plot horizontally — no
	 *  left/right reservation needed. */
	insideX: number | null
	insideY: number
	canvasW: number
	canvasH: number
	legendW: number
	legendH: number
	titleReserves: number
}): InsideExtras => {
	if (canvasW <= 0 || canvasH <= 0) {
		return { top: 0, right: 0, bottom: 0, left: 0 }
	}
	const horizontalConst = 2 * CHART_PAD + BASE_MARGIN.left + BASE_MARGIN.right
	const verticalConst =
		2 * CHART_PAD + BASE_MARGIN.top + BASE_MARGIN.bottom + titleReserves
	// The plot with no extras. A side can give up at most all of it.
	const plotW = Math.max(0, canvasW - horizontalConst)
	const plotH = Math.max(0, canvasH - verticalConst)
	const reserve = (spill: number, efficiency: number, available: number): number =>
		Math.min(available, Math.max(0, spill) * reserveGain(efficiency))

	const boxTop = canvasH - CHART_PAD - BASE_MARGIN.bottom - insideY * plotH
	const bottom = reserve(boxTop + legendH - (canvasH - EDGE_BUFFER), 1 - insideY, plotH)
	const top = reserve(EDGE_BUFFER - boxTop, insideY, plotH)
	if (insideX == null) return { top, right: 0, bottom, left: 0 }

	const boxLeft = CHART_PAD + BASE_MARGIN.left + insideX * plotW
	const right = reserve(boxLeft + legendW - (canvasW - EDGE_BUFFER), insideX, plotW)
	const left = reserve(EDGE_BUFFER - boxLeft, 1 - insideX, plotW)
	return { top, right, bottom, left }
}
