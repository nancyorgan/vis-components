import {
	chordDirected,
	ribbon,
	type Chord,
	type ChordGroup,
	type ChordSubgroup,
} from "d3-chord"
import { arc } from "d3-shape"

import { flowEdgeKey, type FlowEdge } from "../../lib/buildFlowGraph"
import {
	DEFAULT_SPINE_CONFIG,
	DEFAULT_TICKMARK_CONFIG,
} from "../../lib/channelConfig"
import { resolveTickFontSizePx } from "../../lib/fontUnit"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import {
	chordAxisStep,
	chordAxisTicks,
	chordTickFormatter,
	type ChordAxisTick,
} from "../../lib/chordAxis"
import { fontStyleAttrs } from "../../lib/labelsConfig"
import { chordAxisConfigFromTheme } from "../../lib/themeConfig"
import {} from "../../store/atoms"
import { useCurrentTheme } from "../../store/useCurrentTheme"

import { Plot, type PlotContext } from "./Plot"
import { useFlowScaffold } from "./useFlowScaffold"
import { hierarchyLabelFits, hierarchyLabelWidth } from "./useHierarchyScaffold"

type ChordPlotProps = ChartRendererBaseProps

/** Radial thickness of the node group arcs, the ring's angular padding
 * between groups (radians), and the margin reserved outside the ring for
 * node labels (px). */
const ARC_THICKNESS = 12
const PAD_ANGLE = 0.02
const LABEL_GUTTER = 24

/** Gap between the ring (or the tick marks' outer end) and the text that
 * follows it — tick labels sit this far past the marks, node labels this far
 * past whatever is outermost. */
const TEXT_GAP = 4

/** SVG arc along a circle of radius `r` from chord-angle `a0` to `a1`
 * (radians, 0 at 12 o'clock, clockwise) — the axis "spine" drawn along a
 * group's outer edge. Chord angles increase clockwise on screen, so the
 * sweep flag is 1. */
const spineArcPath = (r: number, a0: number, a1: number): string => {
	const x0 = Math.sin(a0) * r
	const y0 = -Math.cos(a0) * r
	const x1 = Math.sin(a1) * r
	const y1 = -Math.cos(a1) * r
	const large = a1 - a0 > Math.PI ? 1 : 0
	return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
}

/**
 * Chord renderer: the flow encoding signature rendered as a ring of node
 * arcs joined by ribbons (d3 `chordDirected` — each directed flow keeps
 * its own ribbon, where plain `chord()` would merge the two directions
 * of a node pair). Cycles and self-loops render natively — the FULL edge
 * list draws, no cycle-breaking (that's sankey-only). Ribbons take their
 * SOURCE node's color. Graph building, node/edge styling, and tooltips
 * come from `useFlowScaffold`; canvas traits stay cartesian — the
 * renderer owns its own polar geometry, like the sunburst renderer does.
 */
export const ChordPlot = (props: ChordPlotProps = {}) => {
	const scaffold = useFlowScaffold(props)
	const {
		nodes,
		edges,
		outlineColor,
		outlineWidth,
		tickFont,
		nodeLabelFont,
		nodeLabelColorFor,
		nodeLabelAlignment,
		nodeLabelOffset,
	} = scaffold

	// The ring's value axis (Connection panel → Show axis, chord only).
	// Tickmark / spine pieces seed from the THEME the same way the x / y
	// axes do (`chordAxisConfigFromTheme` is also the panel's fallback, so
	// what draws and what the panel displays can't drift); unset tick-label
	// fields inherit the base text font.
	const theme = useCurrentTheme()
	const axisCfg = {
		...chordAxisConfigFromTheme(theme),
		...scaffold.channelConfigs.connection?.chordAxis,
	}
	const axisOn = axisCfg.enabled
	const axisTickmarks = axisCfg.tickmarks ?? DEFAULT_TICKMARK_CONFIG
	const axisSpine = axisCfg.spine ?? DEFAULT_SPINE_CONFIG
	const axisLabelFont = {
		family: axisCfg.tickLabelFont?.family ?? tickFont.family,
		size: resolveTickFontSizePx(axisCfg.tickLabelFont?.size, tickFont.size),
		color: axisCfg.tickLabelFont?.color ?? tickFont.color,
		...fontStyleAttrs({
			weight: axisCfg.tickLabelFont?.weight ?? tickFont.weight,
			italic: axisCfg.tickLabelFont?.italic ?? tickFont.italic,
			underline: axisCfg.tickLabelFont?.underline ?? tickFont.underline,
		}),
	}

	if (!scaffold.ready) return null

	const marksBody = (ctx: PlotContext) => {
		const { inner } = ctx
		const w = Math.max(inner.x1 - inner.x0, 1)
		const h = Math.max(inner.y1 - inner.y0, 1)
		const cx = inner.x0 + w / 2
		const cy = inner.y0 + h / 2

		// Square flow matrix over the node union — one cell per directed
		// pair, self-loops on the diagonal. Negative weights clamp to 0
		// (d3 misbehaves on negative values, mirroring sunburst's clamp).
		// Built BEFORE the radius: the chord layout is radius-independent,
		// and the axis's tick labels (which depend on the group angles)
		// feed the gutter the radius must reserve.
		const indexOf = new Map(nodes.map((name, i) => [name, i]))
		const matrix = nodes.map(() => nodes.map(() => 0))
		const edgeByKey = new Map<string, FlowEdge>()
		for (const edge of edges) {
			const s = indexOf.get(edge.source)
			const t = indexOf.get(edge.target)
			if (s === undefined || t === undefined) continue
			matrix[s][t] += Math.max(edge.value, 0)
			edgeByKey.set(flowEdgeKey(edge.source, edge.target), edge)
		}

		const chords = chordDirected()
			.padAngle(PAD_ANGLE)
			.sortSubgroups((a, b) => b - a)(matrix)

		// Axis ticks per group (empty when the axis is off or there's no
		// flow to graduate). One shared step across every group so the ring
		// reads as a single scale.
		const total = matrix.reduce(
			(sum, row) => sum + row.reduce((s, v) => s + v, 0),
			0
		)
		const step = chordAxisStep(total, axisCfg.tickCount)
		const formatLabel =
			step !== null ? chordTickFormatter(axisCfg.customFormat, step) : null
		const ticksByIndex = new Map<number, ChordAxisTick[]>(
			axisOn && step !== null && formatLabel
				? chords.groups.map((g) => [
						g.index,
						chordAxisTicks(g, step, axisCfg.labelEvery, formatLabel),
					])
				: []
		)
		// Radial room the axis needs beyond the ring: tick marks plus the
		// widest tick label (labels run radially, so width IS radial extent).
		let maxTickLabelWidth = 0
		for (const ticks of ticksByIndex.values()) {
			for (const t of ticks) {
				if (t.label === null) continue
				maxTickLabelWidth = Math.max(
					maxTickLabelWidth,
					hierarchyLabelWidth(t.label, axisLabelFont.size)
				)
			}
		}
		const axisExtent = axisOn
			? axisTickmarks.length +
				(maxTickLabelWidth > 0 ? TEXT_GAP + maxTickLabelWidth : 0)
			: 0

		const radius = Math.min(w, h) / 2 - LABEL_GUTTER - axisExtent
		// Degenerate-panel guard: below this the ring's inner radius goes
		// negative and d3-path THROWS ("negative radius") — reachable via
		// the first pre-solver layout pass, thumbnail renders, and sliver
		// facet panels. Draw nothing; the next sized pass draws the ring.
		// (Sankey's analogue is its extent clamp.)
		if (radius <= ARC_THICKNESS) return null

		const arcGen = arc<ChordGroup>()
			.innerRadius(radius - ARC_THICKNESS)
			.outerRadius(radius)
		const ribbonGen = ribbon<Chord, ChordSubgroup>().radius(
			radius - ARC_THICKNESS
		)
		// Node labels clear whatever is outermost — the ring itself, or the
		// axis's tick labels when the axis is on.
		const labelInset = axisExtent + TEXT_GAP

		const groupArcs: React.ReactNode[] = []
		const groupLabels: React.ReactNode[] = []
		const axisMarks: React.ReactNode[] = []
		for (const group of chords.groups) {
			const name = nodes[group.index]
			const path = arcGen(group)
			if (!path) continue
			groupArcs.push(
				<path
					key={`arc-${name}`}
					d={path}
					transform={`translate(${cx}, ${cy})`}
					data-kind="chord-arc"
					data-node={name}
					fill={scaffold.nodeFillFor(name)}
					fillOpacity={scaffold.nodeOpacity}
					stroke={outlineColor}
					strokeWidth={outlineWidth}
					onMouseEnter={scaffold.hoverNode(name, group.value)}
				/>
			)

			// Axis: a spine arc along the group's outer edge, tick marks
			// radiating from it, and radial labels on the labeled ticks.
			if (axisOn) {
				if (axisSpine.thickness > 0) {
					axisMarks.push(
						<path
							key={`axis-spine-${name}`}
							d={spineArcPath(radius, group.startAngle, group.endAngle)}
							transform={`translate(${cx}, ${cy})`}
							data-kind="chord-axis-spine"
							data-node={name}
							fill="none"
							stroke={axisSpine.color}
							strokeWidth={axisSpine.thickness}
							strokeOpacity={axisSpine.opacity}
							pointerEvents="none"
						/>
					)
				}
				for (const tick of ticksByIndex.get(group.index) ?? []) {
					// rotate(deg) points this group's local +x axis outward at
					// the tick's angle (chord angle 0 = 12 o'clock → -90°).
					const deg = (tick.angle * 180) / Math.PI - 90
					const flip = tick.angle > Math.PI
					axisMarks.push(
						<g
							key={`axis-tick-${name}-${tick.value}`}
							transform={`translate(${cx}, ${cy}) rotate(${deg})`}
							data-kind="chord-axis-tick"
							data-node={name}
							pointerEvents="none"
						>
							<line
								x1={radius}
								x2={radius + axisTickmarks.length}
								stroke={axisTickmarks.color}
								strokeWidth={axisTickmarks.thickness}
							/>
							{tick.label !== null && (
								// Labels read outward along the tick; past 6
								// o'clock they flip 180° in place so they never
								// render upside-down (the d3 chord convention).
								<text
									transform={`translate(${radius + axisTickmarks.length + TEXT_GAP}, 0)${
										flip ? " rotate(180)" : ""
									}`}
									fill={axisLabelFont.color}
									fontFamily={axisLabelFont.family}
									fontSize={axisLabelFont.size}
									fontWeight={axisLabelFont.fontWeight}
									fontStyle={axisLabelFont.fontStyle}
									textDecoration={axisLabelFont.textDecoration}
									textAnchor={flip ? "end" : "start"}
									dominantBaseline="middle"
								>
									{tick.label}
								</text>
							)}
						</g>
					)
				}
			}

			// Label outside the ring (and outside the axis when shown) at the
			// group's mid-angle, anchored away from the center by default —
			// a Node-titles Align pick forces the anchor; names too long for
			// the gutter go unlabeled. The Distance offset moves the label
			// radially (out for +, in for -); x / y then shift in screen space.
			const midAngle = (group.startAngle + group.endAngle) / 2
			const anchor =
				nodeLabelAlignment === "left"
					? "start"
					: nodeLabelAlignment === "right"
						? "end"
						: midAngle > Math.PI
							? "end"
							: "start"
			if (hierarchyLabelFits(name, nodeLabelFont.size, LABEL_GUTTER * 3)) {
				groupLabels.push(
					<text
						key={`lbl-${name}`}
						x={
							cx +
							Math.sin(midAngle) * (radius + labelInset + nodeLabelOffset.distance) +
							nodeLabelOffset.x
						}
						y={
							cy -
							Math.cos(midAngle) * (radius + labelInset + nodeLabelOffset.distance) +
							nodeLabelOffset.y
						}
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
		}

		const ribbons: React.ReactNode[] = []
		for (const chord of chords) {
			const source = nodes[chord.source.index]
			const target = nodes[chord.target.index]
			const edge = edgeByKey.get(flowEdgeKey(source, target))
			// The typings' first overload returns void (canvas-context mode);
			// with no context the generator returns the path string.
			const path = ribbonGen(chord) as unknown as string | null
			if (!edge || !path) continue
			const style = scaffold.edgeStyleFor(edge)
			ribbons.push(
				<path
					key={`ribbon-${flowEdgeKey(source, target)}`}
					d={path}
					transform={`translate(${cx}, ${cy})`}
					data-kind="chord-ribbon"
					data-source={source}
					data-target={target}
					fill={style.fill}
					fillOpacity={style.opacity}
					stroke={outlineColor}
					strokeWidth={outlineWidth}
					onMouseEnter={scaffold.hoverEdge(edge)}
				/>
			)
		}

		return (
			<g onMouseLeave={scaffold.clearHover}>
				{ribbons}
				{groupArcs}
				{axisMarks}
				{groupLabels}
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
