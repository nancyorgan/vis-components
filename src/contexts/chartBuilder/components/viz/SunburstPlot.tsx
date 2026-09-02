import {
	hierarchy,
	partition,
	type HierarchyRectangularNode,
} from "d3-hierarchy"
import { arc } from "d3-shape"

import type { HierarchyNode } from "../../lib/buildHierarchy"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import { PatternDefs, type PatternDefSpec } from "../../lib/patternDefs"

import { Plot, type PlotContext } from "./Plot"
import {
	HIERARCHY_PARENT_FILL,
	hierarchyLabelFits,
	useHierarchyScaffold,
} from "./useHierarchyScaffold"

type SunburstPlotProps = ChartRendererBaseProps

/** Radial gap (px) between rings, and angular padding baked into each
 * arc via the arc generator (radians). */
const RING_GAP = 2
const ARC_PAD_ANGLE = 0.005

/**
 * Sunburst renderer: the hierarchy encoding signature rendered as
 * concentric rings (d3-hierarchy `partition` in polar coordinates —
 * angle span ∝ value, one ring per depth level). Unlike packed circles /
 * treemap, containers here are first-class arcs (the inner rings), so
 * they hover-tooltip too when row-backed. The Area channel's Scale-by
 * option doesn't apply (angular spans are proportional by construction).
 * Tree building, derived channel sources, styling, and tooltips come
 * from `useHierarchyScaffold`; canvas traits stay cartesian — the
 * renderer owns its own polar geometry, like the pie renderer does.
 */
export const SunburstPlot = (props: SunburstPlotProps = {}) => {
	const scaffold = useHierarchyScaffold(props)
	const { labelStyle } = scaffold
	const labelCfg = labelStyle.cfg

	if (!scaffold.ready) return null

	const marksBody = (ctx: PlotContext) => {
		const { inner } = ctx
		const w = Math.max(inner.x1 - inner.x0, 1)
		const h = Math.max(inner.y1 - inner.y0, 1)
		const cx = inner.x0 + w / 2
		const cy = inner.y0 + h / 2
		const radius = Math.min(w, h) / 2

		// partition: x ∈ [0, 2π] is the angle span, y ∈ [0, radius] the
		// radial extent — one ring per depth. The root's disc (y0=0 ring)
		// is skipped like every other synthetic-root mark.
		const laid = partition<HierarchyNode>().size([2 * Math.PI, radius])(
			hierarchy<HierarchyNode>(scaffold.root)
				.sum((d) => (d.children.length === 0 ? Math.max(d.value ?? 0, 0) : 0))
				.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
		)

		const nodes = (
			laid.descendants() as Array<HierarchyRectangularNode<HierarchyNode>>
		).filter((n) => n.depth > 0)
		const { styleFor, markStroke, patternFor } =
			scaffold.makeStyleResolvers()
		const patternDefs: PatternDefSpec[] = []

		const arcGen = arc<HierarchyRectangularNode<HierarchyNode>>()
			.startAngle((n) => n.x0)
			.endAngle((n) => n.x1)
			.padAngle(ARC_PAD_ANGLE)
			.innerRadius((n) => n.y0)
			.outerRadius((n) => Math.max(n.y0, n.y1 - RING_GAP))

		const arcs: React.ReactNode[] = []
		const arcLabels: React.ReactNode[] = []
		for (const node of nodes) {
			if (node.x1 - node.x0 <= 0) continue // zero-value
			const d = node.data
			const isLeaf = node.children === undefined || node.children.length === 0
			const style = styleFor(node, isLeaf)
			const { stroke, strokeWidth } = markStroke(node, style)
			const path = arcGen(node)
			if (!path) continue

			// Row-backed arcs (leaves AND named containers) hover-tooltip —
			// in a sunburst the inner rings are real marks, not backdrops.
			const row = d.row
			const pattern = patternFor(node, style)
			if (pattern) patternDefs.push(pattern)
			arcs.push(
				<path
					key={d.key}
					d={path}
					transform={`translate(${cx}, ${cy})`}
					fill={
						pattern
							? `url(#${pattern.svgId})`
							: style
								? style.fill
								: HIERARCHY_PARENT_FILL
					}
					fillOpacity={style ? style.opacity : undefined}
					stroke={stroke}
					strokeWidth={strokeWidth}
					onMouseEnter={scaffold.hoverLeaf(row ?? null, node)}
				/>
			)

			// Label at the arc's centroid when the arc's ANGULAR length at
			// that radius can hold it. Kept horizontal (no per-arc rotation)
			// for legibility; tight arcs simply go unlabeled. Text / color /
			// size come from the Data Labels section (leaves show the value
			// field when mapped; containers keep their names).
			const midAngle = (node.x0 + node.x1) / 2
			const midRadius = (node.y0 + Math.max(node.y0, node.y1 - RING_GAP)) / 2
			const arcLength = (node.x1 - node.x0) * midRadius
			const arcText = labelStyle.textFor(node, isLeaf)
			const arcFontSize = labelStyle.sizeFor(node)
			if (
				arcText &&
				midRadius > 0 &&
				hierarchyLabelFits(arcText, arcFontSize, arcLength * 0.9)
			) {
				arcLabels.push(
					<text
						key={`lbl-${d.key}`}
						x={cx + Math.sin(midAngle) * midRadius}
						y={cy - Math.cos(midAngle) * midRadius}
						// Recedes with its own arc on legend hover.
						opacity={
							style && style.fadeMul < 1 ? style.fadeMul : undefined
						}
						fill={labelStyle.fillFor(node)}
						fontFamily={labelCfg.fontFamily}
						fontSize={arcFontSize}
						fontWeight={labelCfg.fontWeight}
						fontStyle={labelCfg.italic ? "italic" : undefined}
						textDecoration={labelCfg.underline ? "underline" : undefined}
						textAnchor="middle"
						dominantBaseline="middle"
						pointerEvents="none"
					>
						{arcText}
					</text>
				)
			}
		}

		return (
			<g onMouseLeave={scaffold.clearHover}>
				<PatternDefs defs={patternDefs} />
				{arcs}
				{arcLabels}
			</g>
		)
	}

	return (
		<Plot inner={props.inner} coord={scaffold.coord} tooltip={scaffold.tooltip}>
			{marksBody}
		</Plot>
	)
}
