import { useMemo, useState } from "react"
import { useAtomValue } from "jotai"
import {
	buildFlowGraph,
	flowNodeNames,
	resolveFlowEndpoints,
	type FlowEdge,
} from "../../lib/buildFlowGraph"
import {
	DEFAULT_FILL,
	DEFAULT_SHAPE_CONFIG,
	DEFAULT_TEXT_CONFIG,
	type TextConfig,
} from "../../lib/channelConfig"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import { ptToPx } from "../../lib/fontUnit"
import { cartesian } from "./coords"
import {
	fontStyleAttrs,
	resolveTextFont,
	titleOffsetOf,
	type FontStyleAttrs,
	type LabelAlignment,
} from "../../lib/labelsConfig"
import { resolveTextColor } from "../../lib/textEncoding"
import { OPACITY_SLOT_DEFS } from "../../lib/opacitySlots"
import { dedupPatternDefs, type PatternDefSpec } from "../../lib/patternDefs"
import {
	inkForHueColor,
	inkPaletteForHue,
	resolvePatternForMark,
} from "../../lib/patterns"
import { applyHueScale, makeHueScale } from "../../lib/scales"
import {
	currentEncodingsAtom,
	currentLabelsAtom,
} from "../../store/atoms"
import {
	renderChannelConfigsAtom,
} from "../../store/renderConfigs"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useThemeInkFallback } from "../../store/useThemeInkFallback"
import {
	NEUTRAL_HIGHLIGHT,
	unmatchedHighlight,
	useLegendHighlight,
	useMarkHoverHighlight,
	type MarkHighlight,
} from "../../store/useLegendHighlight"

import { HoverTooltip, type TooltipState } from "./HoverTooltip"
import type { CoordFactory } from "./Plot"

export type FlowEdgeStyle = { fill: string; opacity: number }

/**
 * Shared scaffolding for the flow renderers (chord, sankey): edge-list →
 * directed graph via `buildFlowGraph` (the `connection` field flows into
 * the resolved `flowTargetField` column, weighted by `area`), node
 * coloring over the endpoint-UNION domain, per-edge style resolution,
 * the axis-less cartesian coord, and hover-tooltip state. Renderers own
 * only their d3 layout call and mark emission — the flow sibling of
 * `useHierarchyScaffold`.
 */
export const useFlowScaffold = (props: ChartRendererBaseProps = {}) => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(renderChannelConfigsAtom)
	const labels = useAtomValue(currentLabelsAtom)
	const dataset = useCurrentDatasetView()
	const themeInkFallback = useThemeInkFallback()
	const [hovered, setHovered] = useState<TooltipState | null>(null)

	const rowsForChart = useMemo(
		() => props.rowsOverride ?? dataset?.rows ?? [],
		[props.rowsOverride, dataset?.rows]
	)

	// Endpoint resolution is shared with the Connection panel and the hue
	// legend via `resolveFlowEndpoints` — one recipe (full-dataset rows, not
	// the facet subset) so the drawn graph, the sidebar's "Auto" label, and
	// the legend domain can't drift apart.
	const { sourceField, targetField, valueField } = useMemo(
		() => resolveFlowEndpoints(encodings, channelConfigs.connection, dataset),
		[encodings, channelConfigs.connection, dataset]
	)

	const { nodes, edges, diagnostics } = useMemo(
		() =>
			sourceField && targetField && valueField
				? buildFlowGraph(rowsForChart, { sourceField, targetField, valueField })
				: {
						nodes: [] as string[],
						edges: [] as FlowEdge[],
						diagnostics: { droppedValuelessRows: 0 },
					},
		[rowsForChart, sourceField, targetField, valueField]
	)

	// Scale domain from the FULL dataset (not the facet subset) so every
	// panel — and the hue legend — assigns each node the same palette slot;
	// first-appearance order is positional, so a per-panel domain would
	// recolor nodes between panels. The drawn graph stays on `rowsForChart`.
	const scaleDomainNodes = useMemo(
		() =>
			sourceField && targetField
				? flowNodeNames(dataset?.rows ?? [], sourceField, targetField)
				: [],
		[dataset?.rows, sourceField, targetField]
	)

	// Node color: hue mapped to EITHER endpoint column means "color by
	// node" — one categorical scale over the node UNION, so a node that
	// only ever appears as a destination still gets a stable palette slot.
	// Hue unmapped (or on some other column) → the theme default fill.
	const hueField = encodings.hue?.field ?? null
	const hueOnNodes =
		!!hueField && (hueField === sourceField || hueField === targetField)
	const nodeHueScale = hueOnNodes
		? makeHueScale(
				scaleDomainNodes,
				"categorical",
				// Node names are categorical whichever endpoint the user
				// mapped; a leftover quantitative config would confuse the
				// scale builder.
				channelConfigs.hue?.kind === "categorical"
					? channelConfigs.hue
					: undefined,
				channelConfigs.categoricalPalette
			)
		: null
	const nodeColorFor = (name: string): string =>
		(nodeHueScale ? applyHueScale(nodeHueScale, name, "categorical") : null) ??
		(channelConfigs.defaultFill ?? DEFAULT_FILL)

	// Pattern mapped to EITHER endpoint column means "pattern by node" —
	// mirrors the hue treatment above, indexing into the same node-UNION
	// domain so the auto-cycled pattern for a node can't drift from the
	// sidebar / legend. Flows never sat/bri-modulate, so `nodeColorFor` IS
	// the pre-modulation hue the ink lookup requires.
	const patternField = encodings.pattern?.field ?? null
	const patternOnNodes =
		!!patternField &&
		(patternField === sourceField || patternField === targetField)
	const patternBg = channelConfigs.pattern?.backgroundColor ?? "#e2e8f0"
	const nodePatternFor = (name: string) => {
		if (!patternOnNodes) return null
		const idx = scaleDomainNodes.indexOf(name)
		if (idx === -1) return null
		const bgColor = hueOnNodes ? nodeColorFor(name) : patternBg
		const huePalette = inkPaletteForHue(channelConfigs, "categorical")
		const preferredInk = inkForHueColor(
			bgColor,
			huePalette.palette,
			huePalette.inks,
			themeInkFallback
		)
		return resolvePatternForMark(
			name,
			idx,
			bgColor,
			channelConfigs.pattern,
			preferredInk
		)
	}
	/** All `<pattern>` defs the drawn nodes (and hence ribbons — they reuse
	 * their source node's def) will reference. Pass to `<Plot patternDefs>`. */
	const patternDefs: PatternDefSpec[] = patternOnNodes
		? dedupPatternDefs(
				nodes
					.map(nodePatternFor)
					.filter((d): d is NonNullable<typeof d> => d !== null)
			)
		: []
	/** Pattern-aware paint for a node mark: the pattern tile URL when the
	 * pattern channel targets the node columns, else the plain node color. */
	const nodeFillFor = (name: string): string => {
		const pattern = nodePatternFor(name)
		return pattern ? `url(#${pattern.svgId})` : nodeColorFor(name)
	}

	// Node / ribbon opacity come from their opacity SLOTS (Opacity menu →
	// Nodes / Ribbons), not the overall `defaultOpacity` — slots are absolute
	// (see OpacitySlotConfig), and the panel hides Fill for flow modes so the
	// displayed levels are exactly what draws.
	const nodeOpacity =
		channelConfigs.opacitySlots?.node?.level ??
		OPACITY_SLOT_DEFS.node.defaultLevel
	const ribbonOpacity =
		channelConfigs.opacitySlots?.ribbon?.level ??
		OPACITY_SLOT_DEFS.ribbon.defaultLevel

	// --- Legend-hover highlight ---------------------------------------------
	// A flow legend is the node UNION (hue and/or pattern mapped to an endpoint
	// column), so a hovered entry names a NODE. Node marks take the same
	// treatment as any other mark — fade / recolor / outline per the user's
	// Hover options — and the links follow the flow convention below.
	const legendHighlight = useLegendHighlight()
	const nodeEntryHovered =
		legendHighlight !== null &&
		(legendHighlight.field === sourceField ||
			legendHighlight.field === targetField)
	const hoveredNode = nodeEntryHovered ? legendHighlight.value : null
	/** How one node mark (chord arc / sankey rect) should render under the
	 * current hover. Neutral when the hovered entry belongs to some other
	 * field — nodes aren't colored by it, so nothing should change. */
	const nodeHighlight = (name: string): MarkHighlight =>
		nodeEntryHovered && legendHighlight
			? legendHighlight.resolve(name)
			: NEUTRAL_HIGHLIGHT
	// The fade every non-matching mark drops to (1 when the user turned fade
	// off, or nothing is hovered).
	const fadeMul = unmatchedHighlight(legendHighlight).opacityMul
	/** LINK rule: a flow TOUCHING the hovered node (as source OR target) stays
	 * fully visible — that's what "highlight this node" means on a flow diagram,
	 * where a node's meaning IS its flows — and every unrelated link fades by
	 * the same amount non-matching marks do. Links keep their own paint (no
	 * recolor / outline): a ribbon is not the node, and repainting a wide
	 * translucent flow in the highlight color would swamp the node it belongs
	 * to. */
	const edgeFadeMul = (edge: FlowEdge): number =>
		hoveredNode === null ||
		edge.source === hoveredNode ||
		edge.target === hoveredNode
			? 1
			: fadeMul
	// Reverse direction (hover a mark → highlight it exactly like its legend
	// entry), published on whichever field carries the node legend entries.
	// Hovering a LINK publishes its source node: links take their source's
	// paint, so that's the series they belong to.
	const nodeHoverField = hueOnNodes
		? hueField
		: patternOnNodes
			? patternField
			: null
	const markHover = useMarkHoverHighlight(nodeHoverField)

	/** Per-edge fill + opacity: ribbons / links take their SOURCE node's
	 * paint (pattern-aware) at the Ribbons slot's opacity. No derived
	 * sources in flows — the graph has no depth levels or top-level groups
	 * to vary by. A legend hover folds its fade into the opacity, so both
	 * renderers pick it up through the value they already read. */
	const edgeStyleFor = (edge: FlowEdge): FlowEdgeStyle => ({
		fill: nodeFillFor(edge.source),
		opacity: ribbonOpacity * edgeFadeMul(edge),
	})

	const tickFont = resolveTextFont(labels.baseFont)
	const textCfg: TextConfig = { ...DEFAULT_TEXT_CONFIG, ...channelConfigs.text }

	// Node-label styling: the Labels panel's "Node titles" slot layered over
	// the legacy Text-channel config, field by field — an unset field falls
	// through to `textCfg`, so visuals styled via the old Text panel render
	// unchanged until a Node-titles field overrides it.
	const nodeTitleOverride = labels.fontOverrides?.nodeTitle
	const nodeLabelFont = {
		family: nodeTitleOverride?.family ?? textCfg.fontFamily,
		// Config sizes are pt; rendering is px (lib/fontUnit).
		size: ptToPx(nodeTitleOverride?.size ?? textCfg.fontSize),
		// fontStyleAttrs supplies weight/italic/underline; weight falls back to
		// the Text channel's weight so the pre-slot rendering is preserved.
		...fontStyleAttrs({
			weight: nodeTitleOverride?.weight ?? textCfg.fontWeight,
			italic: nodeTitleOverride?.italic,
			underline: nodeTitleOverride?.underline,
		}),
	} satisfies { family: string; size: number } & FontStyleAttrs
	/** Per-node label color: a Node-titles color override beats the Text
	 * channel's per-value / palette / fallback resolution. */
	const nodeLabelColorFor = (name: string): string =>
		nodeTitleOverride?.color ?? resolveTextColor(name, textCfg)
	/** "center" = the renderer's automatic anchoring (away from the ring for
	 * chord, side-dependent for sankey); left/right force start/end anchors. */
	const nodeLabelAlignment: LabelAlignment =
		labels.titleAlignments?.nodeTitle ?? "center"
	const nodeLabelOffset = titleOffsetOf(labels, "nodeTitle")
	const outlineColor =
		channelConfigs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor
	const outlineWidth =
		channelConfigs.shape?.outlineWidth ?? DEFAULT_SHAPE_CONFIG.outlineWidth

	// Axis-less cartesian panel: null scales render no axes (tile-style
	// panels do the same when a scale is missing).
	const coord: CoordFactory = () =>
		cartesian({
			xScale: null,
			yScale: null,
			xLabel: "",
			yLabel: "",
			xFieldType: null,
			yFieldType: null,
			showXAxis: false,
			showYAxis: false,
			tickFont,
			xAxisTitleFont: tickFont,
			yAxisTitleFont: tickFont,
		})

	const tooltip = hovered ? <HoverTooltip state={hovered} /> : null
	const clearHover = () => {
		setHovered(null)
		markHover.leave()
	}
	/** Standard edge hover: source / target / summed value. */
	const hoverEdge = (edge: FlowEdge) => (e: React.MouseEvent) => {
		const fields: TooltipState["fields"] = []
		if (sourceField) fields.push({ name: sourceField, value: edge.source })
		if (targetField) fields.push({ name: targetField, value: edge.target })
		if (valueField) fields.push({ name: valueField, value: edge.value })
		setHovered({ clientX: e.clientX, clientY: e.clientY, fields })
		markHover.enter(edge.source)
	}
	/** Standard node hover: name (under the source column's label) and the
	 * node's total flow. */
	const hoverNode = (name: string, total: number) => (e: React.MouseEvent) => {
		const fields: TooltipState["fields"] = []
		if (sourceField) fields.push({ name: sourceField, value: name })
		if (valueField) fields.push({ name: valueField, value: total })
		setHovered({ clientX: e.clientX, clientY: e.clientY, fields })
		markHover.enter(name)
	}

	return {
		encodings,
		channelConfigs,
		dataset,
		rowsForChart,
		sourceField,
		targetField,
		valueField,
		nodes,
		edges,
		diagnostics,
		nodeColorFor,
		nodeFillFor,
		nodeOpacity,
		patternDefs,
		edgeStyleFor,
		nodeHighlight,
		textCfg,
		tickFont,
		nodeLabelFont,
		nodeLabelColorFor,
		nodeLabelAlignment,
		nodeLabelOffset,
		outlineColor,
		outlineWidth,
		coord,
		/** False until a dataset + all three fields exist — renderers return null. */
		ready: !!dataset && !!valueField && !!sourceField && !!targetField,
		tooltip,
		hoverEdge,
		hoverNode,
		clearHover,
		inner: props.inner,
	}
}
