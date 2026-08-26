import useMeasure from "react-use-measure"
import { useAtomValue } from "jotai"
import {
	DEFAULT_LABELS_CONFIG,
	DEFAULT_LEGEND_CONFIG,
	resolveTitleFont,
	type LegendConfig,
} from "../../lib/labelsConfig"
import { BASE_MARGIN, subtitleReserve, titleReserve } from "../../lib/plotLayout"
import {
	currentChannelConfigsAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentRenderedFigureSlackAtom,
} from "../../store/atoms"
import {
	useCurrentDatasetStatus,
	useCurrentDatasetView,
} from "../../store/useCurrentDatasetView"

import { Legend, type InsideExtras } from "./Legend"
import { PlotCanvas } from "./PlotCanvas"

/** Just the plot region — no legend. Used by the embed split-iframe option
 * (`?part=chart`) and as the building block for ChartCanvas. */
export const ChartBody = () => {
	const dataset = useCurrentDatasetView()
	const status = useCurrentDatasetStatus()
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const bgStyle: React.CSSProperties | undefined =
		channelConfigs.backgroundColor
			? { backgroundColor: channelConfigs.backgroundColor }
			: undefined
	if (!dataset) {
		return (
			<div
				className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-stone-600 dark:text-stone-400"
				style={bgStyle}
			>
				{status === "loading" ? (
					// Rows are in flight. This branch must never mount the plot
					// SVG: `chartLayoutReady` treats any non-zero-sized
					// `#PLOT_SVG_ID` as a finished chart, so drawing an empty
					// one here would let the thumbnail pipeline capture it as a
					// stable frame and save a blank preview.
					<div className="text-sm">Loading data…</div>
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
						<div className="text-sm">
							Upload a CSV from the sidebar to get started.
						</div>
					</>
				)}
			</div>
		)
	}
	// PlotCanvas handles BOTH faceted and single-panel cases — single is
	// just a 1×1 facet grid.
	if (!bgStyle) return <PlotCanvas />
	return (
		<div className="h-full w-full" style={bgStyle}>
			<PlotCanvas />
		</div>
	)
}

export const ChartCanvas = () => {
	const dataset = useCurrentDatasetView()
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const legendCfg: LegendConfig = {
		...DEFAULT_LEGEND_CONFIG,
		...useAtomValue(currentLegendConfigAtom),
	}
	const figureSlack = useAtomValue(currentRenderedFigureSlackAtom)
	const bgStyle: React.CSSProperties | undefined =
		channelConfigs.backgroundColor
			? { backgroundColor: channelConfigs.backgroundColor }
			: undefined

	if (!dataset) {
		return <ChartBody />
	}

	const pos = legendCfg.position

	if (pos === "inside") {
		return <InsideLegendLayout legendCfg={legendCfg} bgStyle={bgStyle} />
	}

	const flexDirection =
		pos === "top" || pos === "bottom" ? "flex-col" : "flex-row"
	const legendFirst = pos === "top" || pos === "left"
	const chart = (
		// data-editor-chart-plot: the Export modal's Embed tab measures this
		// (the plot area sans legend) to size the split-legend "chart" iframe,
		// so the snippet inherits the on-screen chart dimensions.
		<div
			className="min-h-0 min-w-0 flex-1 p-3"
			key="chart"
			data-editor-chart-plot
		>
			<ChartBody />
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
		<div className={`flex h-full w-full ${flexDirection}`} style={bgStyle}>
			{legendFirst ? legend : chart}
			{legendFirst ? chart : legend}
		</div>
	)
}

const CHART_PAD = 12

/** Breathing room (px) kept between an inside legend's far edge and the canvas
 *  edge. The reservation math below solves for the legend landing FLUSH with
 *  the edge; feeding it a legend that's `EDGE_BUFFER` px larger in the
 *  reserving dimension makes the far edge land this many px short instead, so a
 *  corner/edge legend never sits right against the viewport boundary. Purely a
 *  reservation nudge — it never fires when the legend already sits comfortably
 *  inside (the `Math.max(0, …)` clamps it away). */
export const EDGE_BUFFER = 10

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
	const [canvasRef, canvasBounds] = useMeasure()
	const [legendRef, legendBounds] = useMeasure()
	const labels = useAtomValue(currentLabelsAtom)
	const hasTitle = !!(labels.title ?? DEFAULT_LABELS_CONFIG.title)
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
			<Legend insideExtras={legendExtras} insideMeasureRef={legendRef} />
		</div>
	)
}

/** Exact-fit reservation: solve for the extra padding such that the legend's
 *  far edge lands flush with the canvas's far edge, given the user-supplied
 *  coord and the legend's measured size. Each side is solved independently
 *  (assuming the perpendicular sides need no extras), which leaves a tiny
 *  slack when both X and Y are outside the plot rectangle — acceptable for
 *  the use case (legend in a corner). Returns 0 on first paint while
 *  measurements are still `0`. */
export const computeInsideExtras = ({
	insideX,
	insideY,
	canvasW,
	canvasH,
	legendW,
	legendH,
	titleReserves,
}: {
	insideX: number
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
	// For each side, derive `extras` so the legend's far edge meets the
	// canvas edge. Formula derivation (bottom case): with extras.bottom = e,
	//   new_plot_bottom + |insideY| * new_plot_height + legendH = canvasH
	// Substituting and solving for e yields the expression below. The
	// symmetric formulae apply for top, left, right.
	//
	// The legend is anchored by its TOP-LEFT corner, so it only ever extends
	// DOWN and to the RIGHT of the anchor point. That means an in-bounds coord
	// near the plot's right/bottom edge (e.g. a top-right legend at insideX
	// 0.96) overflows the canvas just like an out-of-plot coord does — the
	// legend body runs off-canvas even though the anchor sits inside [0,1].
	// So `right`/`bottom` fire for the whole extending range (insideX > 0 /
	// insideY < 1), not just out-of-bounds coords; the `Math.max(0, …)` makes
	// each a no-op when the legend already fits. `left`/`top` stay gated on the
	// out-of-bounds case only: with top-left anchoring the legend never extends
	// past the left or top canvas edge unless the anchor itself is out there
	// (insideX < 0 / insideY > 1).
	const bottom =
		insideY < 1
			? Math.max(
					0,
					(-CHART_PAD -
						BASE_MARGIN.bottom +
						-insideY * (canvasH - verticalConst) +
						legendH +
						EDGE_BUFFER) /
						(1 + -insideY)
				)
			: 0
	const top =
		insideY > 1
			? Math.max(
					0,
					(-CHART_PAD -
						BASE_MARGIN.top -
						titleReserves +
						(insideY - 1) * (canvasH - verticalConst) +
						legendH +
						EDGE_BUFFER) /
						(1 + (insideY - 1))
				)
			: 0
	const left =
		insideX < 0
			? Math.max(
					0,
					(-CHART_PAD -
						BASE_MARGIN.left +
						-insideX * (canvasW - horizontalConst) +
						legendW +
						EDGE_BUFFER) /
						(1 + -insideX)
				)
			: 0
	const right =
		insideX > 0
			? Math.max(
					0,
					(-CHART_PAD -
						BASE_MARGIN.right +
						(insideX - 1) * (canvasW - horizontalConst) +
						legendW +
						EDGE_BUFFER) /
						(1 + (insideX - 1))
				)
			: 0
	return { top, right, bottom, left }
}
