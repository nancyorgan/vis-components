import { useMemo } from "react"

import { sankey, sankeyLinkHorizontal, type SankeyNode } from "d3-sankey"

import { breakCycles, flowEdgeKey, type FlowEdge } from "../../lib/buildFlowGraph"
import { ptToPx } from "../../lib/fontUnit"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"

import { Plot, type PlotContext } from "./Plot"
import { useFlowScaffold } from "./useFlowScaffold"

type SankeyPlotProps = ChartRendererBaseProps

type SankeyNodeDatum = { name: string }
type SankeyLinkDatum = {
	source: string
	target: string
	value: number
	edge: FlowEdge
}
type LayoutNode = SankeyNode<SankeyNodeDatum, SankeyLinkDatum>

/** Width of the node rects, vertical padding between nodes in a column,
 * and the margin reserved right of the layout so last-column labels
 * (drawn outside their rects, anchored end) have room to render. */
const NODE_WIDTH = 12
const NODE_PADDING = 10
const LABEL_GUTTER = 24

// Links read as translucent runs of their source node's color while node
// rects anchor the eye — both opacities come from the Nodes / Ribbons
// opacity slots via the scaffold (ribbons default 0.45).

/**
 * Sankey renderer: the flow encoding signature rendered as columns of
 * node rects joined by horizontal links (d3-sankey). d3-sankey requires
 * an acyclic graph, so unlike chord — which draws the full edge list —
 * this renderer first runs `breakCycles`: self-loops and the smallest
 * cycle-closing back-edges drop, and a muted notice reports how many
 * flows are hidden. Links take their SOURCE node's color. Graph
 * building, node/edge styling, and tooltips come from `useFlowScaffold`.
 */
export const SankeyPlot = (props: SankeyPlotProps = {}) => {
	const scaffold = useFlowScaffold(props)
	const {
		nodes,
		edges,
		outlineColor,
		outlineWidth,
		nodeLabelFont,
		nodeLabelColorFor,
		nodeLabelAlignment,
		nodeLabelOffset,
	} = scaffold

	const { kept, droppedSelfLoops, droppedCycleEdges } = useMemo(
		() => breakCycles(edges),
		[edges]
	)

	if (!scaffold.ready) return null

	const marksBody = (ctx: PlotContext) => {
		const { inner } = ctx
		const droppedCount = droppedSelfLoops.length + droppedCycleEdges.length
		const notice =
			droppedCount > 0 ? (
				<text
					x={inner.x0}
					y={inner.y1 - 4}
					fontSize={ptToPx(11)}
					fill="#78716c"
					pointerEvents="none"
				>
					{`${droppedCount} flow${droppedCount === 1 ? "" : "s"} hidden to break cycles`}
				</text>
			) : null

		// All self-loops (or an empty graph) can leave nothing to lay out —
		// d3-sankey NaNs on an all-zero node column, so bail to the notice.
		if (kept.length === 0) return <g>{notice}</g>

		// Degenerate-panel guard: keep the extent at least 1px each way.
		const extentRight = Math.max(inner.x1 - LABEL_GUTTER, inner.x0 + 1)
		const extentBottom = Math.max(inner.y1, inner.y0 + 1)

		// d3-sankey MUTATES its input (it rewrites link endpoints into node
		// objects and annotates geometry), so build fresh node/link objects
		// on every render. All of scaffold.nodes go in — d3-sankey tolerates
		// nodes with no kept links (verified: they lay out as zero-height
		// rects rather than throwing), so a node whose every edge dropped
		// still holds its palette slot; its label is skipped below.
		const layout = sankey<SankeyNodeDatum, SankeyLinkDatum>()
			.nodeId((d) => d.name)
			.nodeWidth(NODE_WIDTH)
			.nodePadding(NODE_PADDING)
			.extent([
				[inner.x0, inner.y0],
				[extentRight, extentBottom],
			])({
			nodes: nodes.map((name) => ({ name })),
			links: kept.map((e) => ({
				source: e.source,
				target: e.target,
				value: Math.max(e.value, 0),
				edge: e,
			})),
		})

		const linkPath = sankeyLinkHorizontal<SankeyNodeDatum, SankeyLinkDatum>()
		const linkMarks: React.ReactNode[] = []
		for (const link of layout.links) {
			const sourceName = (link.source as LayoutNode).name
			const targetName = (link.target as LayoutNode).name
			const path = linkPath(link)
			if (!path) continue
			const style = scaffold.edgeStyleFor(link.edge)
			linkMarks.push(
				<path
					key={`link-${flowEdgeKey(sourceName, targetName)}`}
					d={path}
					data-kind="sankey-link"
					data-source={sourceName}
					data-target={targetName}
					fill="none"
					stroke={style.fill}
					strokeWidth={Math.max(1, link.width ?? 1)}
					strokeOpacity={style.opacity}
					onMouseEnter={scaffold.hoverEdge(link.edge)}
				/>
			)
		}

		const nodeRects: React.ReactNode[] = []
		const nodeLabels: React.ReactNode[] = []
		for (const node of layout.nodes) {
			const { name } = node
			const x0 = node.x0 ?? 0
			const y0 = node.y0 ?? 0
			const width = (node.x1 ?? 0) - x0
			const height = (node.y1 ?? 0) - y0
			nodeRects.push(
				<rect
					key={`node-${name}`}
					x={x0}
					y={y0}
					width={width}
					height={height}
					data-kind="sankey-node"
					data-node={name}
					fill={scaffold.nodeFillFor(name)}
					fillOpacity={scaffold.nodeOpacity}
					stroke={outlineColor}
					strokeWidth={outlineWidth}
					onMouseEnter={scaffold.hoverNode(name, node.value ?? 0)}
				/>
			)

			// Label beside the rect: last-column nodes read leftward from
			// their rect (anchor end), everything else reads to the right.
			// Zero-height nodes (all edges dropped) go unlabeled — there's
			// no mark to point at.
			if (height <= 0) continue
			const lastColumn = (node.x1 ?? 0) >= extentRight - 1
			// "center" = automatic side-dependent anchoring; a Node-titles
			// Align pick forces every label's anchor (the anchor POINT stays
			// beside the rect, so left/right reads as text direction).
			const autoAnchor = lastColumn ? "end" : "start"
			const anchor =
				nodeLabelAlignment === "left"
					? "start"
					: nodeLabelAlignment === "right"
						? "end"
						: autoAnchor
			// The Distance offset moves the label along its away-from-the-rect
			// direction (leftward for last-column labels, rightward otherwise);
			// x / y then shift in screen space.
			const gap = 6 + nodeLabelOffset.distance
			nodeLabels.push(
				<text
					key={`lbl-${name}`}
					x={
						(lastColumn ? x0 - gap : (node.x1 ?? 0) + gap) + nodeLabelOffset.x
					}
					y={(y0 + (node.y1 ?? 0)) / 2 + nodeLabelOffset.y}
					fill={nodeLabelColorFor(name)}
					fontFamily={nodeLabelFont.family}
					fontSize={nodeLabelFont.size}
					fontWeight={nodeLabelFont.fontWeight}
					fontStyle={nodeLabelFont.fontStyle}
					textDecoration={nodeLabelFont.textDecoration}
					textAnchor={anchor}
					dominantBaseline="middle"
					pointerEvents="none"
				>
					{name}
				</text>
			)
		}

		return (
			<g onMouseLeave={scaffold.clearHover}>
				{linkMarks}
				{nodeRects}
				{nodeLabels}
				{notice}
			</g>
		)
	}

	return (
		<Plot
			inner={props.inner}
			coord={scaffold.coord}
			tooltip={scaffold.tooltip}
			patternDefs={scaffold.patternDefs}
		>
			{marksBody}
		</Plot>
	)
}
