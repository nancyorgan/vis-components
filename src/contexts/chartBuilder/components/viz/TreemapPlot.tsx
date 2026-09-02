import {
	hierarchy,
	treemap,
	type HierarchyRectangularNode,
} from "d3-hierarchy"

import type { HierarchyNode } from "../../lib/buildHierarchy"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import { PatternDefs, type PatternDefSpec } from "../../lib/patternDefs"

import { Plot, type PlotContext } from "./Plot"
import {
	hierarchyLabelFits,
	useHierarchyScaffold,
} from "./useHierarchyScaffold"

type TreemapPlotProps = ChartRendererBaseProps

/**
 * Treemap renderer: the hierarchy encoding signature rendered as a FLUSH
 * mosaic of leaf rectangles (d3-hierarchy `treemap`, squarified tiling,
 * zero padding). Rect AREA is proportional to the leaf's `area` value by
 * construction, so a group's tiles jointly read as the sum — the Area
 * channel's Scale-by option doesn't apply. No container marks, no header
 * strips, no padding gutters: grouping reads through color (the
 * "Top-level group" derived variable) and tile separation comes solely
 * from the user-controlled outline stroke (width 0 = fully flush). Only
 * leaves are labeled (centered, fit-gated). Tree building, derived
 * channel sources, styling, and tooltips come from
 * `useHierarchyScaffold`.
 */
export const TreemapPlot = (props: TreemapPlotProps = {}) => {
	const scaffold = useHierarchyScaffold(props)
	const { labelStyle } = scaffold
	const labelCfg = labelStyle.cfg

	if (!scaffold.ready) return null

	const marksBody = (ctx: PlotContext) => {
		const { inner } = ctx
		const w = Math.max(inner.x1 - inner.x0, 1)
		const h = Math.max(inner.y1 - inner.y0, 1)

		// ZERO padding: tiles sit flush and the ONLY separator is each
		// tile's outline stroke (user-controlled color + width; width 0 =
		// a completely flush mosaic). Padding gutters + container fills +
		// tile strokes were three separate line-drawing mechanisms that
		// compounded into uncontrollable multi-line borders.
		const laid = treemap<HierarchyNode>().size([w, h])(
			hierarchy<HierarchyNode>(scaffold.root)
				.sum((d) => (d.children.length === 0 ? Math.max(d.value ?? 0, 0) : 0))
				.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
		)

		const nodes = (
			laid.descendants() as Array<HierarchyRectangularNode<HierarchyNode>>
		).filter((n) => n.depth > 0)
		const { styleFor, markStroke, patternFor } =
			scaffold.makeStyleResolvers()

		const rects: React.ReactNode[] = []
		const rectLabels: React.ReactNode[] = []
		const patternDefs: PatternDefSpec[] = []
		for (const node of nodes) {
			const rw = node.x1 - node.x0
			const rh = node.y1 - node.y0
			if (rw <= 0 || rh <= 0) continue // zero-value
			const x = inner.x0 + node.x0
			const y = inner.y0 + node.y0
			const d = node.data
			const isLeaf = node.children === undefined || node.children.length === 0

			// LEAVES ONLY. With zero padding the child tiles cover their
			// container completely, so container rects have nothing to show —
			// group identity lives on the leaves (the "Top-level group"
			// derived fill colors them by group). Packed circles / sunburst
			// keep their container marks — there the enclosing circle /
			// inner rings ARE the chart.
			if (!isLeaf) continue
			const style = styleFor(node, true)
			// styleFor only returns null for containers; leaves always style.
			if (style === null) continue
			const { stroke, strokeWidth } = markStroke(node, style)
			const pattern = patternFor(node, style)
			if (pattern) patternDefs.push(pattern)
			rects.push(
				<rect
					key={d.key}
					x={x}
					y={y}
					width={rw}
					height={rh}
					fill={pattern ? `url(#${pattern.svgId})` : style.fill}
					fillOpacity={style.opacity}
					stroke={stroke}
					strokeWidth={strokeWidth}
					onMouseEnter={scaffold.hoverLeaf(d.row ?? null, node)}
				/>
			)

			// Leaf label: text / color / size from the Data Labels section
			// (value field when mapped, else the node's name — see
			// useHierarchyScaffold's labelStyle).
			const leafText = labelStyle.textFor(node, true)
			const leafSize = labelStyle.sizeFor(node)
			if (
				leafText &&
				hierarchyLabelFits(leafText, leafSize, rw - 6) &&
				rh > leafSize * 1.4
			) {
				rectLabels.push(
					<text
						key={`lbl-${d.key}`}
						x={x + rw / 2}
						y={y + rh / 2}
						// Recedes with its own tile on legend hover.
						opacity={style.fadeMul < 1 ? style.fadeMul : undefined}
						fill={labelStyle.fillFor(node)}
						fontFamily={labelCfg.fontFamily}
						fontSize={leafSize}
						fontWeight={labelCfg.fontWeight}
						fontStyle={labelCfg.italic ? "italic" : undefined}
						textDecoration={labelCfg.underline ? "underline" : undefined}
						textAnchor="middle"
						dominantBaseline="middle"
						pointerEvents="none"
					>
						{leafText}
					</text>
				)
			}
		}

		return (
			<g onMouseLeave={scaffold.clearHover}>
				<PatternDefs defs={patternDefs} />
				{rects}
				{rectLabels}
			</g>
		)
	}

	return (
		<Plot inner={props.inner} coord={scaffold.coord} tooltip={scaffold.tooltip}>
			{marksBody}
		</Plot>
	)
}
