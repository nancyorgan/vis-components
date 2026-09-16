import {
	hierarchy,
	partition,
	type HierarchyRectangularNode,
} from "d3-hierarchy"
import { arc } from "d3-shape"

import type { HierarchyNode } from "../../lib/buildHierarchy"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import { DEFAULT_DATA_LABELS_CONFIG } from "../../lib/channelConfig"
import { wrapByCharCount } from "../../lib/multilineText"
import { PatternDefs, type PatternDefSpec } from "../../lib/patternDefs"

import { DataLabelsLayer, type DataLabelAnchor } from "./DataLabelsLayer"
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
 *
 * Labels: the layout PLACES them (one anchor per arc that can hold its
 * text) and the scaffold's `labelStyle` resolves text / fill / size, but
 * the emission goes through the shared `DataLabelsLayer` in its
 * `"layout"` gate — so the Data Labels fine-tuning (offsets, position
 * rules, alignment, wrap, rotation, text background, overlap spread)
 * applies here exactly as on a pie.
 */
export const SunburstPlot = (props: SunburstPlotProps = {}) => {
	const scaffold = useHierarchyScaffold(props)
	const { labelStyle } = scaffold
	const labelCfg = labelStyle.cfg
	// Polar placement nudges (Data Labels → Adjust position): Angle rotates
	// every label off its arc's midpoint (degrees, positive = clockwise, the
	// pie's convention); R places it across the ring's thickness (percent
	// from the inner edge, 50 = the middle).
	const labelAngleOffset = ((labelCfg.polarLabelAngle ?? 0) * Math.PI) / 180
	const ringPct =
		(labelCfg.ringLabelRadius ??
			DEFAULT_DATA_LABELS_CONFIG.ringLabelRadius ??
			50) / 100
	// The fit gate measures the label's WIDEST line: with wrapping on, a
	// long name that would overflow its arc as one run can still fit once
	// broken — which is the whole point of turning wrapping on here.
	const wrapMaxChars =
		labelCfg.wrapMaxChars ?? DEFAULT_DATA_LABELS_CONFIG.wrapMaxChars ?? 20
	const fitLines = (text: string): string[] =>
		labelCfg.wrapText === true ? wrapByCharCount(text, wrapMaxChars) : [text]

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
		const arcLabels: DataLabelAnchor[] = []
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

			// Label anchor on the arc's mid-angle, `ringPct` of the way across
			// the ring (the centroid by default), when the arc's ANGULAR
			// length at that radius can hold the text's widest line. Kept
			// horizontal by default (per-arc rotation hurts legibility; the
			// Data Labels Angle control rotates every label uniformly); tight
			// arcs simply go unlabeled. Text / color / size come from the
			// Data Labels section (leaves show the value field when mapped;
			// containers keep their names); the layer below applies the
			// placement fine-tuning.
			const innerR = node.y0
			const outerR = Math.max(node.y0, node.y1 - RING_GAP)
			const labelRadius = innerR + (outerR - innerR) * ringPct
			const arcLength = (node.x1 - node.x0) * labelRadius
			const arcText = labelStyle.textFor(node, isLeaf)
			const arcFontSize = labelStyle.sizeFor(node)
			if (
				arcText &&
				labelRadius > 0 &&
				fitLines(arcText).every((line) =>
					hierarchyLabelFits(line, arcFontSize, arcLength * 0.9)
				)
			) {
				const midAngle = (node.x0 + node.x1) / 2 + labelAngleOffset
				arcLabels.push({
					cx: cx + Math.sin(midAngle) * labelRadius,
					cy: cy - Math.cos(midAngle) * labelRadius,
					key: `lbl-${d.key}`,
					label: arcText,
					// Backing value for the conditional position rules: the
					// leaf's Value cell when mapped, else the node's name —
					// the same value the text is composed from.
					labelValue: labelStyle.valueFor(node, isLeaf),
					fill: labelStyle.fillFor(node),
					fontSize: arcFontSize,
					// Recedes with its own arc on legend hover.
					opacityMul: style ? style.fadeMul : undefined,
				})
			}
		}

		return (
			<g onMouseLeave={scaffold.clearHover}>
				<PatternDefs defs={patternDefs} />
				{arcs}
				<DataLabelsLayer
					rows={[]}
					xScale={null}
					yScale={null}
					xType={null}
					yType={null}
					positionGate="layout"
					anchors={arcLabels}
				/>
			</g>
		)
	}

	return (
		<Plot inner={props.inner} coord={scaffold.coord} tooltip={scaffold.tooltip}>
			{marksBody}
		</Plot>
	)
}
