import { useMemo, useState } from "react"
import { useAtomValue } from "jotai"
import {
	buildFlowGraph,
	flowNodeNames,
	resolveFlowEndpoints,
	type FlowEdge,
} from "../../lib/buildFlowGraph"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_FILL,
	DEFAULT_SHAPE_CONFIG,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import { normalizeComposedLabels } from "../../lib/dataLabelsSelection"
import {
	buildLabelText,
	formatSingleLabel,
	labelHueScaleParts,
	resolveLabelFill,
} from "../../lib/dataLabelsStyle"
import {
	buildFlowNodeRows,
	flowNodeSourceRows,
	effectiveFlowLabelNodes,
	flowNodeLabeled,
	flowNodeTotals,
	type FlowGeometry,
} from "../../lib/flowNodeLabels"
import { ptToPx } from "../../lib/fontUnit"
import { cartesian } from "./coords"
import { resolveTextFont } from "../../lib/labelsConfig"
import { OPACITY_SLOT_DEFS } from "../../lib/opacitySlots"
import { dedupPatternDefs, type PatternDefSpec } from "../../lib/patternDefs"
import {
	inkForHueColor,
	inkPaletteForHue,
	resolveDefaultPatternForMark,
	resolveDefaultPatternInk,
	resolvePatternForMark,
} from "../../lib/patterns"
import { markOutlineResolver } from "../../lib/markOutline"
import { applyHueScale, makeHueScale, modulateColor } from "../../lib/scales"
import { emptyDataLabelsEncodings } from "../../lib/types"
import {
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	renderedLabelsAtom,
} from "../../store/atoms"
import {
	renderChannelConfigsAtom,
	renderDataLabelsConfigAtom,
} from "../../store/renderConfigs"
import { useAestheticScales } from "../../store/useAestheticScales"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useThemeInkFallback } from "../../store/useThemeInkFallback"
import {
	NEUTRAL_HIGHLIGHT,
	unmatchedHighlight,
	useLegendHighlight,
	useMarkHoverHighlight,
	type MarkHighlight,
} from "../../store/useLegendHighlight"

import type { DataLabelAnchor } from "./DataLabelsLayer"
import { HoverTooltip, type TooltipState } from "./HoverTooltip"
import type { CoordFactory } from "./Plot"
import { hierarchyLabelWidth } from "./useHierarchyScaffold"

export type FlowEdgeStyle = { fill: string; opacity: number }

/** Where a renderer puts one node's label: the anchor point, and which way
 *  the text reads from it when Alignment is left at its automatic
 *  "center" ("left" = text starts at the point, "right" = ends there). */
export type FlowLabelPlacement = {
	cx: number
	cy: number
	side: "left" | "right"
}

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
	const labels = useAtomValue(renderedLabelsAtom)
	const dataLabelsCfg: DataLabelsConfig = {
		...DEFAULT_DATA_LABELS_CONFIG,
		...useAtomValue(renderDataLabelsConfigAtom),
	}
	const dataLabelsEnc = {
		...emptyDataLabelsEncodings(),
		...useAtomValue(currentDataLabelsEncodingsAtom),
	}
	const dataset = useCurrentDatasetView()
	const aestheticScales = useAestheticScales()
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
	/** A node's Color BEFORE saturation / brightness — what pattern inks pair
	 * on (the palette's own swatch). */
	const nodeHueFor = (name: string): string =>
		(nodeHueScale ? applyHueScale(nodeHueScale, name, "categorical") : null) ??
		(channelConfigs.defaultFill ?? DEFAULT_FILL)

	/** A node read as a ROW: both endpoint columns hold its name. A node is
	 * not one dataset row, but anything that resolves "by a variable" — the
	 * outline's color and opacity, a saturation or brightness scale — can
	 * then answer for an endpoint column (it is "by node", like Color), and
	 * falls back to its single level for any other column, which has no one
	 * value per node. */
	const nodeRow = (name: string): Record<string, unknown> => ({
		...(sourceField ? { [sourceField]: name } : {}),
		...(targetField ? { [targetField]: name } : {}),
	})
	/** Saturation / Brightness level for a node: the channel's scale when it
	 * varies by an endpoint column, else the single default level. */
	const nodeUnit = (
		channel: "saturation" | "brightness",
		name: string
	): number | null => {
		const mapped = aestheticScales[channel]
		const fromScale = mapped
			? mapped.scale(nodeRow(name)[mapped.field.name] as never)
			: null
		return (
			fromScale ??
			(channel === "saturation"
				? channelConfigs.defaultSaturation
				: channelConfigs.defaultBrightness) ??
			null
		)
	}
	/** The node's drawn color: its Color, shaded by Saturation / Brightness
	 * like every other body. */
	const nodeColorFor = (name: string): string => {
		const sat = nodeUnit("saturation", name)
		const bri = nodeUnit("brightness", name)
		const hue = nodeHueFor(name)
		return sat === null && bri === null ? hue : modulateColor(hue, sat, bri)
	}

	// Pattern mapped to EITHER endpoint column means "pattern by node" —
	// mirrors the hue treatment above, indexing into the same node-UNION
	// domain so the auto-cycled pattern for a node can't drift from the
	// sidebar / legend. Flows never sat/bri-modulate, so `nodeColorFor` IS
	// the pre-modulation hue the ink lookup requires.
	const patternField = encodings.pattern?.field ?? null
	const patternOnNodes =
		!!patternField &&
		(patternField === sourceField || patternField === targetField)
	// The tile sits on the node's drawn color (its hue color, or the default
	// fill) unless no hue is on the nodes and the Pattern panel's Background
	// override replaces it — the shared `patternTile` rule. The ink pairs on
	// the PRE-shading color (`nodeHueFor`), which is the palette's swatch.
	const patternBgOverride = channelConfigs.pattern?.backgroundColor ?? null
	const nodePatternFor = (name: string) => {
		if (!patternOnNodes) {
			// No Pattern variable at all: the configured DEFAULT pattern tiles
			// every node (and so its ribbons), as it does bars and cells. A
			// variable on a non-endpoint column has no one value per node.
			if (patternField || channelConfigs.defaultPattern == null) return null
			return resolveDefaultPatternForMark(
				nodeColorFor(name),
				channelConfigs.defaultPattern,
				resolveDefaultPatternInk(
					channelConfigs,
					nodeHueFor(name),
					"categorical",
					themeInkFallback
				),
				channelConfigs.pattern?.defaultScale,
				channelConfigs.pattern?.defaultRotation
			)
		}
		const idx = scaleDomainNodes.indexOf(name)
		if (idx === -1) return null
		const bgColor =
			hueOnNodes || patternBgOverride === null
				? nodeColorFor(name)
				: patternBgOverride
		const huePalette = inkPaletteForHue(channelConfigs, "categorical")
		const preferredInk = inkForHueColor(
			hueOnNodes || patternBgOverride === null ? nodeHueFor(name) : bgColor,
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
	const patternDefs: PatternDefSpec[] = dedupPatternDefs(
		nodes.map(nodePatternFor).filter((d): d is NonNullable<typeof d> => d !== null)
	)
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

	// ── Node labels (Data Labels section) ───────────────────────────────
	// Renderers place each node's anchor (beside a sankey rect, outside the
	// chord ring); everything else is the Data Labels section, applied by
	// the shared `DataLabelsLayer`. Value picks the text — the node's name
	// by default, else a variable from the node's synthetic row
	// (`buildFlowNodeRows`: aggregated dataset variables + Flow in / Flow
	// out / Node total); "Multiple variables…" composes that row. Color
	// mapped to an endpoint column colors labels by node over the same
	// node-UNION domain the marks use (the layer's own scale would only see
	// the one column's values); any other Color / Size variable resolves in
	// the layer from the row's value.
	const datasetFieldNames = useMemo(
		() => (dataset?.fields ?? []).map((f) => f.name),
		[dataset?.fields]
	)
	const labelMulti = dataLabelsEnc.value.multiField === true
	// An unset Value is the source column — the node names (both endpoint
	// columns read as the name on a node's row). "— none —" (`none`) turns
	// node labels off.
	const labelsOff =
		!labelMulti &&
		dataLabelsEnc.value.field === null &&
		dataLabelsEnc.value.none === true
	const labelValueField =
		dataLabelsEnc.value.field ?? (labelMulti ? null : sourceField)
	const labelHueField = dataLabelsEnc.hue.field
	const labelSizeField = dataLabelsEnc.size.field
	const labelHueOnNodes =
		!!labelHueField &&
		(labelHueField === sourceField || labelHueField === targetField)
	const labelNodeHueScale = (() => {
		if (!labelHueOnNodes) return null
		const { hueConfig, customPalette } = labelHueScaleParts(
			dataLabelsCfg,
			"categorical",
			channelConfigs
		)
		if (!hueConfig) return null
		return makeHueScale(scaleDomainNodes, "categorical", hueConfig, customPalette)
	})()
	/** Labels for one drawn graph. `drawnEdges` is what the renderer actually
	 *  lays out (sankey drops cycle-closing edges), so a node's totals — and
	 *  hence "Which labels" and the flow-only values — match what's on
	 *  screen. `anchorFor` builds a node's anchor (`null` = no label: not
	 *  selected, or nothing to say); `widthFor` estimates the widest line
	 *  its label(s) will draw, so a renderer can reserve room before it
	 *  places anything (0 = no label). */
	const makeNodeLabeler = (
		drawnEdges: readonly FlowEdge[],
		geometry: FlowGeometry
	) => {
		const totals = flowNodeTotals(nodes, drawnEdges)
		const nodeRows =
			sourceField && targetField
				? buildFlowNodeRows(nodes, drawnEdges, {
						sourceField,
						targetField,
						fields: datasetFieldNames,
						geometry,
					})
				: new Map<string, Record<string, unknown>>()
		const nodeSourceRows = flowNodeSourceRows(nodes, drawnEdges)
		const which = effectiveFlowLabelNodes(dataLabelsCfg.flowLabelNodes, geometry)
		const autoAlign = (dataLabelsCfg.alignment ?? "center") === "center"
		const singleText = (name: string, row: Record<string, unknown>) =>
			labelValueField
				? formatSingleLabel(
						row[labelValueField],
						dataLabelsCfg.fieldFormats?.[labelValueField],
						dataLabelsCfg.decimals
					)
				: name
		// Measurement inputs: the composed labels the layer will draw, the
		// largest size a label can take, and the wrap width in characters.
		const composed = labelMulti
			? (normalizeComposedLabels(dataLabelsCfg, dataLabelsEnc.value.fields ?? [])
					.composedLabels ?? [])
			: []
		const measurePx = ptToPx(
			labelSizeField ? dataLabelsCfg.sizeMax : dataLabelsCfg.fontSize
		)
		const wrapChars =
			dataLabelsCfg.wrapText === true
				? Math.max(1, dataLabelsCfg.wrapMaxChars ?? 20)
				: Infinity
		const selected = (name: string) => {
			if (labelsOff) return false
			const t = totals.get(name)
			return !!t && flowNodeLabeled(which, t)
		}
		const widthFor = (name: string): number => {
			if (!selected(name)) return 0
			const row = nodeRows.get(name) ?? {}
			const texts = labelMulti
				? composed.map(
						(l) =>
							buildLabelText(row, dataLabelsEnc.value, {
								...dataLabelsCfg,
								labelTemplate: l.template,
							}) ?? ""
					)
				: [singleText(name, row) ?? ""]
			let widest = 0
			for (const text of texts) {
				for (const line of text.split("\n")) {
					widest = Math.max(
						widest,
						hierarchyLabelWidth(line.slice(0, wrapChars), measurePx)
					)
				}
			}
			return widest
		}
		const anchorFor = (
			name: string,
			at: FlowLabelPlacement,
			opacityMul?: number
		): DataLabelAnchor | null => {
			if (!selected(name)) return null
			const row = nodeRows.get(name) ?? {}
			const sourceRows = nodeSourceRows.get(name)
			const labelValue = labelValueField ? row[labelValueField] : name
			const label = singleText(name, row)
			const hueValue = labelHueField ? row[labelHueField] : undefined
			const hueColor =
				labelNodeHueScale && hueValue !== undefined
					? (applyHueScale(labelNodeHueScale, hueValue, "categorical") ?? null)
					: null
			return {
				cx: at.cx,
				cy: at.cy,
				key: `node-${name}`,
				label,
				labelValue,
				hueValue,
				sizeValue: labelSizeField ? row[labelSizeField] : undefined,
				// Endpoint-colored labels resolve here (node-union scale); the
				// rest leave fill to the layer.
				fill: labelHueOnNodes
					? resolveLabelFill(
							dataLabelsCfg,
							hueValue,
							hueColor,
							labelValue,
							sourceRows
						)
					: undefined,
				row: labelMulti ? row : undefined,
				sourceRows,
				// Automatic alignment reads away from the node; a left / right
				// pick is the user's and applies as-is.
				hAlign: autoAlign ? at.side : undefined,
				opacityMul,
			}
		}
		return { anchorFor, widthFor }
	}
	const outlineWidth =
		channelConfigs.shape?.outlineWidth ?? DEFAULT_SHAPE_CONFIG.outlineWidth
	// A node's outline — color (rule, Outline variable, or the one outline
	// color), saturation / brightness, opacity and thickness — through the resolver
	// every mark's outline shares, read off the node as a row. A ribbon's
	// outline follows its SOURCE node's, as its fill does.
	const outlineFor = markOutlineResolver(channelConfigs, aestheticScales)
	const nodeOutlineFor = (
		name: string
	): { stroke: string; strokeOpacity: number | undefined; strokeWidth: number } => {
		const outline = outlineFor(nodeRow(name))
		return {
			stroke: outline.stroke,
			// Full opacity sets no attribute, as before.
			strokeOpacity: outline.strokeOpacity === 1 ? undefined : outline.strokeOpacity,
			strokeWidth: outline.strokeWidth,
		}
	}

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
		tickFont,
		makeNodeLabeler,
		/** The largest label font size (px) — chord's vertical label room. */
		labelFontSizePx: ptToPx(
			labelSizeField ? dataLabelsCfg.sizeMax : dataLabelsCfg.fontSize
		),
		nodeOutlineFor,
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
