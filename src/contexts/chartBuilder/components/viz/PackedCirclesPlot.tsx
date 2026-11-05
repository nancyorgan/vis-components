import { max } from "d3-array"
import { hierarchy, pack, type HierarchyCircularNode } from "d3-hierarchy"

import type { HierarchyNode } from "../../lib/buildHierarchy"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import {
	planArcLabel,
	type ArcBand,
	type Disk,
	type Rect,
} from "../../lib/packArcLabels"
import { ptToPx } from "../../lib/fontUnit"
import { PatternDefs, type PatternDefSpec } from "../../lib/patternDefs"
import type { HierarchyLabelLine } from "../../lib/hierarchyLabels"

import { DataLabelsLayer, type DataLabelAnchor } from "./DataLabelsLayer"

import { Plot, type PlotContext } from "./Plot"
import {
	HIERARCHY_PARENT_FILL,
	hierarchyLabelFits,
	hierarchyLabelWidth,
	useHierarchyScaffold,
} from "./useHierarchyScaffold"

type PackedCirclesPlotProps = ChartRendererBaseProps

/** Whitespace (px) the layout keeps between tangent circles and inside
 * each parent's rim. */
const PACK_PADDING = 3

/** Line pitch of a node's stacked labels, in em of the label size. */
const LABEL_LINE_EM = 1.2

type PackNode = HierarchyCircularNode<HierarchyNode>

/** A group whose ONLY child is an anonymous leaf (grouped mode with one row
 * per group, e.g. connection = the row's own name): the two are a single
 * drawn circle (no padding between them — see the pack call), so they label
 * as one — the leaf takes the group's name and the group draws no label of
 * its own. Returns that leaf, or null. */
const soloAnonymousLeaf = (node: PackNode): PackNode | null => {
	const only = node.children?.length === 1 ? node.children[0] : undefined
	if (!only || (only.children && only.children.length > 0)) return null
	return only.data.label === "" ? only : null
}

/**
 * Packed circles renderer. One circle per dataset row, area-proportional to
 * the row's `area` value, positioned by d3-hierarchy's pack layout:
 *
 *  - `area` alone → all rows pack as siblings (flat).
 *  - `+ connection` → rows nest one level under their connection value.
 *  - `+ hierarchy id field` (Connection panel) → connection values matching
 *    another row's id nest recursively (see `lib/buildHierarchy.ts`).
 *
 * Tree building, derived channel sources, per-node styling, and tooltips
 * live in `useHierarchyScaffold` (shared with TreemapPlot / SunburstPlot);
 * this component owns only the pack layout and circle emission.
 */
export const PackedCirclesPlot = (props: PackedCirclesPlotProps = {}) => {
	const scaffold = useHierarchyScaffold(props)
	const { channelConfigs, labelStyle } = scaffold
	const labelCfg = labelStyle.cfg

	if (!scaffold.ready) return null

	const marksBody = (ctx: PlotContext) => {
		const { inner } = ctx
		const w = Math.max(inner.x1 - inner.x0, 1)
		const h = Math.max(inner.y1 - inner.y0, 1)

		// Leaves size by their own (non-negative) value; containers size
		// from their descendants — a value on an internal node was already
		// nulled by the tree builder. Sibling sort keeps the layout stable
		// and dense (d3's recommended big-circles-first order).
		//
		// `sizeBy` (the Area channel's Scale-by option): pack radii grow
		// with √(packed value), so feeding the raw value keeps circle AREA
		// ∝ value (the honest default, where a container reads as the sum
		// of its children). "diameter" squares the value first, making the
		// RADIUS ∝ value — exaggerated, but legible on narrow-range data.
		const sizeBy = channelConfigs.area?.sizeBy ?? "area"
		const packValue = (d: HierarchyNode): number => {
			const v = Math.max(d.value ?? 0, 0)
			return sizeBy === "diameter" ? v * v : v
		}
		// Wrapping TOP-LEVEL labels around the outside of their circles needs
		// breathing room beyond the pack extent (the layout otherwise fills
		// the panel edge-to-edge and the arc text would clip). Deeper wrap
		// levels sit inside their parents, so only level 1 reserves a gutter.
		const wrapLevels = labelCfg.arcWrapLevels ?? []
		const labelGutter = wrapLevels.includes(1)
			? ptToPx(labelCfg.fontSize) * 1.8
			: 0
		const packed = pack<HierarchyNode>()
			.size([
				Math.max(w - 2 * labelGutter, 1),
				Math.max(h - 2 * labelGutter, 1),
			])
			// Padding separates siblings and keeps a container's rim visible
			// around its contents. A container holding exactly ONE leaf has
			// neither job — padding would only shrink the leaf and expose the
			// container's wash as a ring the outline controls can't remove
			// (e.g. connection = the row's own name, one row per group). Such
			// a group lays its leaf out at full size; the container's rim
			// label still draws on top.
			.padding((n) =>
				n.children?.length === 1 && !n.children[0].children
					? 0
					: PACK_PADDING
			)(
			hierarchy<HierarchyNode>(scaffold.root)
				.sum((d) => (d.children.length === 0 ? packValue(d) : 0))
				.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
		)

		const nodes = (
			packed.descendants() as Array<HierarchyCircularNode<HierarchyNode>>
		).filter((n) => n.depth > 0)
		const { styleFor, markStroke, patternFor } =
			scaffold.makeStyleResolvers()
		const patternDefs: PatternDefSpec[] = []

		const offX = inner.x0 + labelGutter
		const offY = inner.y0 + labelGutter

		// Rim-label pre-pass: which NON-wrapped containers will draw the
		// default inside-the-rim label, and where. Computed before any arc
		// label is planned so wrapped labels can dodge them (a depth-2 arc
		// label sits INSIDE its parent, where the parent's rim label lives —
		// the parent is exempt from the disk checks, so its rim label needs
		// its own obstacle box).
		const rimLabels = new Map<
			PackNode,
			{ x: number; top: number; size: number; lines: HierarchyLabelLine[]; box: Rect }
		>()
		for (const node of nodes) {
			const isContainer = node.children !== undefined && node.children.length > 0
			if (!isContainer || node.r <= 0) continue
			if (wrapLevels.includes(node.depth)) continue
			if (soloAnonymousLeaf(node)) continue // its leaf carries the label
			const lines = labelStyle.linesFor(node)
			const size = labelStyle.sizeFor(node)
			const blockH = lines.length * size * LABEL_LINE_EM
			if (
				lines.length === 0 ||
				!lines.every((l) => hierarchyLabelFits(l.text, size, 2 * node.r * 0.9)) ||
				node.r <= size * 1.5 ||
				blockH > node.r
			) {
				continue
			}
			const x = offX + node.x
			// The first line sits where the single rim label always has
			// (baseline ~1.4em under the rim); more lines stack downward.
			const top = offY + node.y - node.r + size * 0.45
			const w = max(lines, (l) => hierarchyLabelWidth(l.text, size)) ?? 0
			rimLabels.set(node, {
				x,
				top,
				size,
				lines,
				box: { x0: x - w / 2, y0: top, x1: x + w / 2, y1: top + blockH },
			})
		}
		const rimBoxes = [...rimLabels.values()].map((r) => r.box)
		// Arc labels placed so far this panel — later labels dodge them.
		const placedArcBands: ArcBand[] = []

		const circles: React.ReactNode[] = []
		// Arc-wrapped rim labels (<textPath>) draw here; every other label
		// is an anchor for the shared label layer, which composes and styles
		// it (per-variable color / size / font, backgrounds, nudges).
		const circleLabels: React.ReactNode[] = []
		const labelAnchors: DataLabelAnchor[] = []
		/** One-row groups whose wrapped arc drew their leaf's first label
		 * line — the leaf draws only the lines after it. (Parents come before
		 * children in `descendants()`, so the arc is decided first.) */
		const arcTakenLine = new Map<PackNode, HierarchyLabelLine>()
		/** One node's label block: its lines stacked from `top`, one composed
		 * label per line (a single-field label is one line). */
		const pushLabelAnchor = (
			node: PackNode,
			lines: HierarchyLabelLine[],
			x: number,
			top: number,
			size: number,
			fadeMul: number | undefined,
			nameFrom: PackNode = node
		) => {
			const pitch = size * LABEL_LINE_EM
			const lineY = (i: number) => top + (i + 0.5) * pitch
			const row = node.data.row
			const multi = lines.some((l) => l.key !== null)
			labelAnchors.push({
				cx: x,
				cy: lineY(0),
				key: `lbl-${node.data.key}`,
				label: lines.map((l) => l.text).join(" "),
				labelValue: labelStyle.valueFor(node, undefined, nameFrom),
				// `{Variable}` rules test the node's own row (none on an
				// implicit container).
				sourceRows: row ? [row] : undefined,
				fill: labelStyle.fillFor(node),
				fontSize: size,
				opacityMul: fadeMul,
				...(multi
					? {
							row: labelStyle.rowFor(node, nameFrom),
							labelKeys: lines.map((l) => l.key as string),
							fieldPlacements: Object.fromEntries(
								lines.map((l, i) => [l.key as string, { cx: x, cy: lineY(i) }])
							),
						}
					: {}),
			})
		}
		for (const node of nodes) {
			if (node.r <= 0) continue // zero-value
			const cx = offX + node.x
			const cy = offY + node.y
			const d = node.data
			const isLeaf = node.children === undefined || node.children.length === 0
			const style = styleFor(node, isLeaf)
			const { stroke, strokeWidth } = markStroke(node, style)

			if (!isLeaf) {
				const containerPattern = patternFor(node, style)
				if (containerPattern) patternDefs.push(containerPattern)
				// Containers are hoverable marks too: the band of a circle its
				// children don't cover IS the container, and the children (drawn
				// later, on top) take the pointer wherever they overlap it. A
				// row-backed container gets the row tooltip; an implicit one
				// just highlights.
				circles.push(
					<circle
						key={d.key}
						cx={cx}
						cy={cy}
						r={node.r}
						fill={
							containerPattern
								? `url(#${containerPattern.svgId})`
								: style
									? style.fill
									: HIERARCHY_PARENT_FILL
						}
						fillOpacity={style ? style.opacity : undefined}
						stroke={stroke}
						strokeWidth={strokeWidth}
						onMouseEnter={scaffold.hoverLeaf(d.row ?? null, node)}
					/>
				)
				// Container label. Two placements, per the Data Labels panel's
				// "Text Position" checkboxes:
				//  - default: along the top rim, INSIDE the circle (position
				//    precomputed in the rim pre-pass above);
				//  - wrapped (this depth in `arcWrapLevels`): on an arc AROUND
				//    the outside of the circle via <textPath>. Placement is
				//    collision-aware (`planArcLabel`): the label starts from
				//    the circle's most exposed side (away from its parent's
				//    center) and rotates around the rim until it clears every
				//    non-ancestor circle, every already-placed arc label, and
				//    every rim label; lower-half spots flip the path so the
				//    text stays upright; no clear window → no label (the
				//    fit-check convention).
				// The text follows the Data Labels Value mapping like every
				// other label (the name by default); a wrapped label draws it
				// as one run in the layer-wide style. A one-row group
				// (`soloAnonymousLeaf`) is one circle with one set of labels:
				// the arc takes its FIRST label and the rest stay inside, so
				// each label draws once.
				const containerSize = labelStyle.sizeFor(node)
				const solo = soloAnonymousLeaf(node)
				const soloFirst = solo
					? labelStyle.linesFor(solo, node)[0]
					: undefined
				const arcText = !wrapLevels.includes(node.depth)
					? null
					: solo
						? (soloFirst?.text ?? null)
						: labelStyle.textFor(node)
				if (arcText) {
					// Obstacle disks: every circle that could touch the label's
					// annular band. Ancestors are exempt (they CONTAIN the label
					// by construction — a depth-2 label lives inside its parent);
					// circles inside the labeled node can't reach the outside
					// band; far circles can't either.
					const ancestorSet = new Set(node.ancestors())
					const reach = node.r + containerSize * 1.1 + 6
					const disks: Disk[] = []
					for (const o of nodes) {
						if (o.r <= 0 || ancestorSet.has(o)) continue
						const dist = Math.hypot(o.x - node.x, o.y - node.y)
						if (dist + o.r <= node.r + 0.5) continue
						if (dist - o.r > reach) continue
						disks.push({ x: offX + o.x, y: offY + o.y, r: o.r })
					}
					const parent = node.parent
					const pdx = parent ? node.x - parent.x : 0
					const pdy = parent ? node.y - parent.y : 0
					const plan = planArcLabel({
						cx,
						cy,
						r: node.r,
						fontSize: containerSize,
						textWidth: hierarchyLabelWidth(arcText, containerSize),
						preferredPhi:
							Math.hypot(pdx, pdy) < 1 ? 0 : Math.atan2(pdx, -pdy),
						obstacles: {
							disks,
							bands: placedArcBands,
							rects: rimBoxes,
						},
					})
					if (plan) {
						placedArcBands.push(plan.band)
						if (solo && soloFirst) arcTakenLine.set(solo, soloFirst)
						// Ids resolve document-wide: key alone repeats across facet
						// panels, so bake the panel-local center in. Non-id-safe
						// key characters (spaces, "|") flatten to underscores.
						const pathId = `vc-pack-arc-${d.key.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Math.round(cx)}-${Math.round(cy)}`
						circleLabels.push(
							<path
								key={`lblp-${d.key}`}
								id={pathId}
								d={plan.pathD}
								fill="none"
								pointerEvents="none"
							/>,
							<text
								key={`lbl-${d.key}`}
								// Recedes with its own container on legend hover
								// (containers only carry a fade when a derived
								// color makes them painted marks).
								opacity={
									style && style.fadeMul < 1 ? style.fadeMul : undefined
								}
								fill={labelStyle.fillFor(node)}
								fontFamily={labelCfg.fontFamily}
								fontSize={containerSize}
								fontWeight={labelCfg.fontWeight}
								fontStyle={labelCfg.italic ? "italic" : undefined}
								textDecoration={labelCfg.underline ? "underline" : undefined}
								textAnchor="middle"
								pointerEvents="none"
							>
								<textPath href={`#${pathId}`} startOffset="50%">
									{arcText}
								</textPath>
							</text>
						)
					}
					continue
				}
				const rim = rimLabels.get(node)
				if (rim) {
					pushLabelAnchor(
						node,
						rim.lines,
						rim.x,
						rim.top,
						rim.size,
						style && style.fadeMul < 1 ? style.fadeMul : undefined
					)
				}
				continue
			}

			// Row-backed leaf: the standard mark fill chain with derived
			// sources swapped in (radius comes from the pack layout, not the
			// area scale — circle AREAS must stay proportional to values for
			// the packing to be honest).
			// styleFor only returns null for containers; leaves always style.
			if (style === null) continue
			const row = d.row ?? {}
			const pattern = patternFor(node, style)
			if (pattern) patternDefs.push(pattern)
			circles.push(
				<circle
					key={d.key}
					cx={cx}
					cy={cy}
					r={node.r}
					fill={pattern ? `url(#${pattern.svgId})` : style.fill}
					fillOpacity={style.opacity}
					stroke={stroke}
					strokeWidth={strokeWidth}
					onMouseEnter={scaffold.hoverLeaf(row, node)}
				/>
			)
			// Leaf label, centered: the Data Labels Value mapping over the
			// leaf's row (the name by default). An anonymous only child
			// speaks for its group (`soloAnonymousLeaf`) — same circle.
			const nameFrom =
				node.parent && soloAnonymousLeaf(node.parent) === node
					? node.parent
					: node
			const taken = arcTakenLine.get(node)
			const leafLines = labelStyle
				.linesFor(node, nameFrom)
				.slice(taken ? 1 : 0)
			const leafSize = labelStyle.sizeFor(node)
			const leafBlockH = leafLines.length * leafSize * LABEL_LINE_EM
			if (
				leafLines.length > 0 &&
				leafLines.every((l) =>
					hierarchyLabelFits(l.text, leafSize, 2 * node.r * 0.9)
				) &&
				leafBlockH <= 2 * node.r * 0.9
			) {
				pushLabelAnchor(
					node,
					leafLines,
					cx,
					cy - leafBlockH / 2,
					leafSize,
					style.fadeMul < 1 ? style.fadeMul : undefined,
					nameFrom
				)
			}
		}
		return (
			<g onMouseLeave={scaffold.clearHover}>
				<PatternDefs defs={patternDefs} />
				{circles}
				{circleLabels}
				<DataLabelsLayer
					rows={[]}
					xScale={null}
					yScale={null}
					xType={null}
					yType={null}
					positionGate="layout"
					anchors={labelAnchors}
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
