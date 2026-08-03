import type { ReactNode } from "react"
import type { CoordSystem } from "../../lib/coords"
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
 *  + labels on top). Emits SVG fragments only — no `<svg>` wrapper, no
 *  measurement, no title rendering. The outer `<svg>` is owned by
 *  PlotCanvas; this is the per-panel rendering body.
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
	const resolvedInner = inner ?? DEFAULT_RENDERER_INNER
	const resolvedCoord = coord(resolvedInner)
	const ctx: PlotContext = { inner: resolvedInner, coord: resolvedCoord }
	return (
		<>
			{patternDefs && patternDefs.length > 0 && (
				<PatternDefs defs={patternDefs} />
			)}
			{resolvedCoord.renderAxes("back", resolvedInner)}
			{children(ctx)}
			{resolvedCoord.renderAxes("front", resolvedInner)}
			{tooltip}
		</>
	)
}
