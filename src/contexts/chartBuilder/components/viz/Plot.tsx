import { useAtomValue } from "jotai"
import type { ReactNode } from "react"
import type { CoordSystem } from "./coords"
import { renderChannelConfigsAtom } from "../../store/renderConfigs"
import { PatternDefs, type PatternDefSpec } from "../../lib/patternDefs"
import { DEFAULT_RENDERER_INNER, type PlotInner } from "../../lib/plotLayout"

/** Factory that, given the inner plot rect, returns a fully-configured
 *  coord system. Mark renderers build position scales against the inner
 *  rect here — this keeps the scales and the rect in sync. */
export type CoordFactory = (inner: PlotInner) => CoordSystem

/** Values passed to the children render callback. Mark renderers read
 *  `ctx.coord.scales` (after narrowing by `ctx.coord.kind`) to place
 *  marks and `ctx.inner` for any rect-relative geometry. */
export type PlotContext = {
	inner: PlotInner
	/** The resolved coord system. */
	coord: CoordSystem
}

/** Minimal rendering body for a single plot: back-layer axes (gridlines
 *  under marks), the mark renderer, then front-layer axes (spine + ticks
 *  + labels on top). Aesthetics → Draw order → "Draw axes behind marks"
 *  (`ChannelConfigs.axesBehindMarks`) moves the front layer under the
 *  marks too, so marks crossing an axis cover its spine and text. Emits
 *  SVG fragments only — no `<svg>` wrapper, no measurement, no title
 *  rendering. The outer `<svg>` is owned by PlotCanvas; this is the
 *  per-panel rendering body.
 *
 *  Tooltip is rendered as a sibling of the axis sandwich. Tooltips use
 *  `createPortal(document.body)` internally, so embedding inside an
 *  outer `<svg>` works — React reconciles the portal target, not the
 *  call site. */
export type PlotProps = {
	/** Plot rect in canvas coordinates. Optional — when omitted, falls back
	 *  to `DEFAULT_RENDERER_INNER` (a 600×400-sized default). PlotCanvas
	 *  always passes an explicit inner from the solver; the default is for
	 *  unit tests that mount a renderer without the canvas wrapper. */
	inner?: PlotInner
	coord: CoordFactory
	children: (ctx: PlotContext) => ReactNode
	tooltip?: ReactNode
	/** Pattern defs to register so mark fills can reference them. The
	 *  `PatternDefs` component dedups by svgId, so emitting per-panel
	 *  inside one outer SVG is safe (the duplicate ids collapse to one
	 *  `<defs>` entry the browser reuses). */
	patternDefs?: PatternDefSpec[]
}

export const Plot = ({
	inner,
	coord,
	children,
	tooltip,
	patternDefs,
}: PlotProps) => {
	const channelConfigs = useAtomValue(renderChannelConfigsAtom)
	const axesBehindMarks = channelConfigs.axesBehindMarks ?? false
	const panelBorder = channelConfigs.panelBorder
	const resolvedInner = inner ?? DEFAULT_RENDERER_INNER
	const resolvedCoord = coord(resolvedInner)
	const ctx: PlotContext = { inner: resolvedInner, coord: resolvedCoord }
	// The two axis passes keep their relative order (gridlines, then spine
	// + ticks + labels) either way; the setting only decides whether the
	// front pass paints before or after the marks. The panel border rides
	// with the front pass, painted after it so it caps the spines.
	const frontAxes = (
		<>
			{resolvedCoord.renderAxes("front", resolvedInner)}
			{panelBorder?.enabled && panelBorder.width > 0 && (
				<rect
					data-panel-border=""
					x={resolvedInner.x0}
					y={resolvedInner.y0}
					width={Math.max(0, resolvedInner.x1 - resolvedInner.x0)}
					height={Math.max(0, resolvedInner.y1 - resolvedInner.y0)}
					fill="none"
					stroke={panelBorder.color}
					strokeWidth={panelBorder.width}
					pointerEvents="none"
				/>
			)}
		</>
	)
	return (
		<>
			{patternDefs && patternDefs.length > 0 && (
				<PatternDefs defs={patternDefs} />
			)}
			{resolvedCoord.renderAxes("back", resolvedInner)}
			{axesBehindMarks && frontAxes}
			{children(ctx)}
			{!axesBehindMarks && frontAxes}
			{tooltip}
		</>
	)
}
