import { useMemo, useState } from "react"
import { useAtomValue } from "jotai"
import {
	buildHierarchyFromEdges,
	resolveHierarchyIdField,
	type HierarchyNode,
} from "../../lib/buildHierarchy"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_FILL,
	DEFAULT_OPACITY,
	DEFAULT_SHAPE_CONFIG,
	DEFAULT_TEXT_CONFIG,
	type DataLabelsConfig,
	type TextConfig,
} from "../../lib/channelConfig"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import { ptToPx } from "../../lib/fontUnit"
import { charWidthConservativeFactor } from "../../lib/estimateMargins"
import { cartesian } from "./coords"
import {
	labelHueScaleParts,
	resolveLabelFill,
	resolveLabelSize,
} from "../../lib/dataLabelsStyle"
import { effectiveType } from "../../lib/fieldType"
import {
	hierarchyLabelLines,
	hierarchyLabelRow,
	hierarchyNameField,
	hierarchySingleLabelField,
	type HierarchyLabelLine,
} from "../../lib/hierarchyLabels"
import { resolveTextFont } from "../../lib/labelsConfig"
import {
	hierarchyDepthLevels,
	hierarchyHighlightField,
	packedSourceOf,
	topLevelGroupNames,
	type PackedDerivedSource,
} from "../../lib/packedMeasure"
import {
	inkForHueColor,
	inkPaletteForHue,
	resolvePatternForMark,
	type ResolvedPattern,
} from "../../lib/patterns"
import { patternTile } from "../../lib/resolveLayerColor"
import {
	applyHueScale,
	makeBrightnessScale,
	makeHueScale,
	makeOpacityScale,
	makeSaturationScale,
	modulateColor,
	type UnitScale,
} from "../../lib/scales"
import { resolveShapeColors } from "../../lib/shapeColors"
import { resolveRuleColor } from "../../lib/textColorRules"
import {
	emptyDataLabelsEncodings,
	type FieldType,
} from "../../lib/types"
import {
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	renderedLabelsAtom,
} from "../../store/atoms"
import {
	renderChannelConfigsAtom,
	renderDataLabelsConfigAtom,
} from "../../store/renderConfigs"
import { useAestheticScales } from "../../store/useAestheticScales"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import {
	rowHighlight,
	useLegendHighlight,
	useMarkHoverHighlight,
	unmatchedHighlight,
	NEUTRAL_HIGHLIGHT,
	type MarkHighlight,
} from "../../store/useLegendHighlight"

import { HoverTooltip, type TooltipState } from "./HoverTooltip"
import type { CoordFactory } from "./Plot"

/** Container (non-leaf) marks when no derived color is active: a
 * barely-there wash so nesting reads without competing with the leaf
 * fills. Shared by all hierarchy layouts (circles, treemap rects,
 * sunburst arcs). The container BORDER is not special-cased — it goes
 * through the same outline chain as every mark, so the user's outline
 * color/width controls it. Follow-up: make the wash user-configurable
 * (it'd be a natural color slot). */
export const HIERARCHY_PARENT_FILL = "rgba(148, 163, 184, 0.12)" // stone-400 @ 12%

/** Labels only render when they fit their mark. This uses the CONSERVATIVE
 * char-width tier (0.6em), not the centered ~0.55em estimate the margin
 * estimators use: over-estimating here just skips a label that would barely
 * have fit, while under-estimating spills text outside its mark. */
const CHAR_WIDTH_EM = charWidthConservativeFactor
export const hierarchyLabelWidth = (label: string, fontSize: number): number =>
	label.length * fontSize * CHAR_WIDTH_EM
export const hierarchyLabelFits = (
	label: string,
	fontSize: number,
	maxWidthPx: number
): boolean => hierarchyLabelWidth(label, fontSize) <= maxWidthPx

/** Synthetic column name for the flat (no-connection) case: no row has it,
 * so every row's parent is blank and all leaves attach to the root — one
 * code path through the tree builder. */
const NO_PARENT = "no-parent"

/** The structural subset of a d3 layout node the style resolvers need —
 * satisfied by HierarchyCircularNode (pack) and HierarchyRectangularNode
 * (treemap / partition) alike, so one resolver serves every layout. */
export type HierarchyLayoutNode = {
	depth: number
	parent: HierarchyLayoutNode | null
	data: HierarchyNode
}

/** The depth-1 ancestor's name — what "Top-level group" varies by. A
 * root-level anonymous leaf has no name → the channel falls back. Shared by
 * the mark resolvers, the label styling, and the hover-highlight publisher so
 * all three agree on which group a node belongs to. */
const hierarchyRootNameOf = (
	node: HierarchyLayoutNode
): string | null => {
	let a = node
	while (a.depth > 1 && a.parent) a = a.parent
	return a.data.label || null
}

/** A node's value on a DERIVED color source — the group it sits in, or its
 * nesting level. */
const hierarchyDerivedValueOf = (
	source: PackedDerivedSource,
	node: HierarchyLayoutNode
): unknown => (source === "rootGroup" ? hierarchyRootNameOf(node) : node.depth)

export type HierarchyMarkStyle = {
	fill: string
	opacity: number
	/** The hue-chain color BEFORE sat/bri modulation. Pattern-ink lookups
	 * match against the theme palette's exact swatch hexes, so they must
	 * key on this (see `PatternDefItem.preModulationHue`). */
	preModulationFill: string
	/** The legend-hover fade alone (1 = not faded), already folded into
	 * `opacity`. Exposed separately so a node's LABEL can recede with its
	 * mark without also inheriting the mark's own opacity encoding. */
	fadeMul: number
}

/**
 * Shared scaffolding for the hierarchy renderers (packed circles, treemap,
 * sunburst): tree building (edge list → nodes via the connection field +
 * resolved id column), the derived channel sources (Top-level group /
 * Nesting depth), per-node fill/opacity/stroke resolution, the axis-less
 * cartesian coord, and hover-tooltip state. Renderers own only their d3
 * layout call and mark emission — the packed-circles sibling of
 * `useGeoMapScaffold`.
 */
export const useHierarchyScaffold = (props: ChartRendererBaseProps = {}) => {
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
	const fieldOverrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	const aestheticScales = useAestheticScales()
	const legendHighlight = useLegendHighlight()
	const [hovered, setHovered] = useState<TooltipState | null>(null)

	const rowsForChart = useMemo(
		() => props.rowsOverride ?? dataset?.rows ?? [],
		[props.rowsOverride, dataset?.rows]
	)

	const parentField = encodings.connection?.field ?? null
	const valueField = encodings.area?.field ?? null
	// Id column: explicit pick > "None" sentinel (forces one grouping
	// level) > auto-detection. Inference runs on the FULL dataset (not the
	// facet subset) so every panel — and the sidebar's "Auto" label —
	// agrees on the same column.
	const explicitIdField = channelConfigs.connection?.hierarchyIdField ?? null
	const idField = useMemo(
		() =>
			parentField
				? resolveHierarchyIdField(
						explicitIdField,
						dataset?.rows ?? [],
						(dataset?.fields ?? []).map((f) => f.name),
						parentField,
						valueField
					)
				: null,
		[parentField, explicitIdField, valueField, dataset?.fields, dataset?.rows]
	)

	// Hierarchy-derived channel sources (see `lib/packedMeasure.ts`): each
	// of hue / saturation / brightness / opacity can vary by "rootGroup"
	// (the outermost ancestor, categorical) or "depth" (nesting level,
	// ordinal) instead of a field. Mutually exclusive with a field on the
	// same channel (the sidebar clears one when the other is set). Gated on
	// a mapped connection — a flat layout is uniformly depth 1, no groups.
	const hueSource = parentField ? packedSourceOf(encodings.hue) : null
	const satSource = parentField ? packedSourceOf(encodings.saturation) : null
	const briSource = parentField ? packedSourceOf(encodings.brightness) : null
	const opaSource = parentField ? packedSourceOf(encodings.opacity) : null
	const patternSource = parentField ? packedSourceOf(encodings.pattern) : null

	// --- Hover highlight ----------------------------------------------------
	// Which "series" a node belongs to depends on where its color comes from:
	// a mapped hue FIELD (the row's value, exactly like every cartesian mark)
	// or a DERIVED source — its top-level group / its depth — which no column
	// carries. The derived case is the common one for these charts, so it gets
	// the sentinel field above rather than being left out.
	const highlightField = hueSource
		? hierarchyHighlightField(hueSource)
		: (aestheticScales.hue?.field.name ?? null)
	/** How one node should render under the current hover.
	 *  - A DIRECT mark hover (the entry carries a node key) emphasizes that
	 *    one node alone — not its group, not even its own children — and
	 *    fades everything else. In a nested chart the series is already a
	 *    contiguous region on screen, so lighting the whole group would
	 *    paint over the very circle the pointer is on and tell the user
	 *    nothing; a container's children are their own marks, and the
	 *    pointer is on the container's uncovered band, not on them.
	 *  - A LEGEND hover highlights the series. Derived colors compare the
	 *    node's own group / depth (so CONTAINERS recede with their group
	 *    too — with a derived color they're painted marks, not a wash); a
	 *    hue field defers to the row, which leaves rowless containers
	 *    untouched.
	 *  Neutral when the hovered entry belongs to some other field — this
	 *  chart isn't colored by it, so nothing should change. */
	const nodeHighlight = (node: HierarchyLayoutNode): MarkHighlight => {
		if (!legendHighlight) return NEUTRAL_HIGHLIGHT
		if (legendHighlight.node !== undefined) {
			if (legendHighlight.field !== highlightField) return NEUTRAL_HIGHLIGHT
			return node.data.key === legendHighlight.node
				? legendHighlight.resolve(legendHighlight.value)
				: unmatchedHighlight(legendHighlight)
		}
		if (hueSource) {
			return legendHighlight.field === highlightField
				? legendHighlight.resolve(hierarchyDerivedValueOf(hueSource, node))
				: NEUTRAL_HIGHLIGHT
		}
		return rowHighlight(legendHighlight, node.data.row ?? {})
	}
	// Reverse direction: hovering a mark publishes its series (so the legend
	// entry lights up, as on the cartesian renderers) together with the
	// node's own key, which is what the marks here key on.
	const markHover = useMarkHoverHighlight(highlightField)

	// STABLE derived-scale domains, from the FULL dataset in tree order —
	// the same recipe the sidebar panels use (`topLevelGroupNames` /
	// `hierarchyDepthLevels`), NOT the laid-out nodes. The layout sorts
	// siblings by value (big circles first) and holds only the facet
	// subset, so a layout-derived domain would shuffle palette / pattern
	// slots between panels and away from the sidebar's override swatches.
	const derivedRootNames = useMemo(
		() =>
			parentField && dataset
				? topLevelGroupNames(dataset.rows, parentField, idField, valueField)
				: [],
		[parentField, dataset, idField, valueField]
	)
	const derivedDepthLevels = useMemo(
		() =>
			parentField && dataset
				? hierarchyDepthLevels(dataset.rows, parentField, idField, valueField)
				: [],
		[parentField, dataset, idField, valueField]
	)

	const { root } = useMemo(
		() =>
			buildHierarchyFromEdges(rowsForChart, {
				parentField: parentField ?? NO_PARENT,
				idField,
				valueField,
			}),
		[rowsForChart, parentField, idField, valueField]
	)

	const tickFont = resolveTextFont(labels.baseFont)
	const textCfg: TextConfig = { ...DEFAULT_TEXT_CONFIG, ...channelConfigs.text }

	// ── Data Labels styling ─────────────────────────────────────────────
	// Hierarchy labels are PLACED by each layout (leaf centers, container
	// rims, arc centroids) but styled by the Data Labels section: `value`
	// picks the leaf text (default: the node's name), `hue` colors labels
	// through the standard override → rule → scale → single-color chain,
	// and `size` scales each label's font across [sizeMin, sizeMax].
	// Every node — container or leaf — composes its text from its LABEL
	// ROW (its row with the name column set to its own name; see
	// `lib/hierarchyLabels.ts`): unset Value = the name, "— none —" = no
	// labels, otherwise the picked variable(s). Row-backed containers
	// resolve color/size against their row too.
	// Field-scale domains come from the FULL dataset so facet panels
	// agree. Color and Size additionally accept the hierarchy-DERIVED
	// sources ("Top-level group" / "Nesting depth" — the label analogue
	// of the mark channels' derived variables), resolved from each
	// node's position in the laid-out tree rather than a row value.
	const labelNameField = hierarchyNameField(parentField, idField)
	const labelSingleField = hierarchySingleLabelField(
		dataLabelsEnc.value,
		labelNameField
	)
	const labelHueField = dataLabelsEnc.hue.field
	const labelSizeField = dataLabelsEnc.size.field
	const labelHueSource: PackedDerivedSource | null =
		dataLabelsEnc.hue.measureSource === "rootGroup" ||
		dataLabelsEnc.hue.measureSource === "depth"
			? dataLabelsEnc.hue.measureSource
			: null
	const labelSizeByDepth = dataLabelsEnc.size.measureSource === "depth"
	// Depth range + top-level group names for the LABEL derived scales —
	// the scaffold's stable dataset-order domains (see `derivedRootNames`
	// below), the same source the mark channels' derived scales use, so
	// label and mark colors stay aligned within a panel AND across facet
	// panels / the sidebar swatches.
	const labelRootNames = derivedRootNames
	const labelMaxDepth = derivedDepthLevels.length
	// Depth is ORDINAL (same reasoning as the mark channels): prefer the
	// theme's sequential ordinal palettes; rootGroup is categorical.
	const labelHueFieldType: FieldType = labelHueSource
		? labelHueSource === "depth"
			? "ordinal"
			: "categorical"
		: dataset && labelHueField
			? effectiveType(dataset, labelHueField, fieldOverrides)
			: "categorical"
	const labelHueScale = (() => {
		if (labelHueSource) {
			const domain =
				labelHueSource === "rootGroup"
					? labelRootNames
					: Array.from({ length: labelMaxDepth }, (_, i) => String(i + 1))
			const { hueConfig, customPalette } = labelHueScaleParts(
				dataLabelsCfg,
				labelHueFieldType,
				channelConfigs
			)
			if (!hueConfig) return null
			return makeHueScale(domain, labelHueFieldType, hueConfig, customPalette)
		}
		if (!labelHueField || !dataset) return null
		const { hueConfig, customPalette } = labelHueScaleParts(
			dataLabelsCfg,
			labelHueFieldType,
			channelConfigs
		)
		if (!hueConfig) return null
		return makeHueScale(
			dataset.rows.map((r) => r[labelHueField]),
			labelHueFieldType,
			hueConfig,
			customPalette
		)
	})()
	// Blank cells are excluded BEFORE numeric coercion — `Number("") === 0`
	// would otherwise drag the domain floor to zero (internal tree nodes
	// carry blank values by convention, so this bites every nested chart).
	const labelSizeValues: number[] =
		labelSizeField && dataset
			? dataset.rows
					.map((r) => r[labelSizeField])
					.filter((v) => String(v ?? "").trim() !== "")
					.map((v) => Number(v))
					.filter((n) => Number.isFinite(n))
			: []
	/** A node's label row (see `hierarchyLabelRow`). `nameFrom` lends a
	 * node another node's name — packed circles hand an anonymous only-child
	 * leaf its group's name, since the two are one drawn circle. */
	const labelRowOf = (
		node: HierarchyLayoutNode,
		nameFrom: HierarchyLayoutNode = node
	): Record<string, unknown> =>
		hierarchyLabelRow(node.data.row, nameFrom.data.label, labelNameField)
	/** The raw value behind a node's label — the single label field's
	 * value on its label row (the name by default). Feeds BOTH Data Labels
	 * conditional-rule features (position and text color), which compare
	 * against the backing value rather than its formatted display form;
	 * sharing it keeps `== Melon` meaning the same thing in both editors.
	 * Multi-variable labels compare per label inside the label layer. */
	const labelBackingValue = (
		node: HierarchyLayoutNode,
		_isLeaf?: boolean,
		nameFrom: HierarchyLayoutNode = node
	): unknown => {
		const v = labelSingleField
			? labelRowOf(node, nameFrom)[labelSingleField]
			: undefined
		return v === "" || v === null ? undefined : v
	}
	/** The labels a node draws (one per composed label with something to
	 * say here; one line for the single-field label). */
	const linesFor = (
		node: HierarchyLayoutNode,
		nameFrom: HierarchyLayoutNode = node
	): HierarchyLabelLine[] =>
		hierarchyLabelLines(
			labelRowOf(node, nameFrom),
			dataLabelsEnc.value,
			dataLabelsCfg,
			labelNameField
		)
	const labelStyle = {
		cfg: dataLabelsCfg,
		/** The name column (null on a flat layout) — what an unset Value
		 * shows. */
		nameField: labelNameField,
		rowFor: labelRowOf,
		linesFor,
		/** A node's label as ONE string — every line joined — for renderers
		 * that draw a single run of text (treemap tiles, arc-wrapped rims)
		 * and for fit checks. `null` = no label. */
		textFor: (
			node: HierarchyLayoutNode,
			_isLeaf?: boolean,
			nameFrom: HierarchyLayoutNode = node
		): string | null => {
			const lines = linesFor(node, nameFrom)
			return lines.length === 0 ? null : lines.map((l) => l.text).join(" ")
		},
		/** The raw value behind `textFor` (see `labelBackingValue`). */
		valueFor: labelBackingValue,
		/** A node's label fill via the Data Labels precedence chain. The
		 * derived sources resolve from tree position (so implicit
		 * containers color too); the field path needs a row — rowless
		 * nodes skip the override / palette stages. Conditional rules test
		 * the label's backing value for EVERY node, so `== Melon` can
		 * single out a container by the name it displays. */
		fillFor: (node: HierarchyLayoutNode): string => {
			const row = node.data.row
			// `{Variable}` rules test the node's own row; implicit
			// containers have none, so those rules skip them.
			const ruleRows = row ? [row] : undefined
			const labelValue = labelBackingValue(
				node,
				node.data.children.length === 0
			)
			if (labelHueSource) {
				const value =
					labelHueSource === "rootGroup"
						? hierarchyRootNameOf(node)
						: String(node.depth)
				const hueColor =
					value !== null && labelHueScale
						? (applyHueScale(labelHueScale, value, labelHueFieldType) ??
							null)
						: null
				return resolveLabelFill(
					dataLabelsCfg,
					value ?? undefined,
					hueColor,
					labelValue,
					ruleRows
				)
			}
			const hueValue = labelHueField && row ? row[labelHueField] : undefined
			const hueColor =
				labelHueScale && hueValue !== undefined
					? (applyHueScale(labelHueScale, hueValue, labelHueFieldType) ??
						null)
					: null
			return resolveLabelFill(
				dataLabelsCfg,
				hueValue,
				hueColor,
				labelValue,
				ruleRows
			)
		},
		/** A node's label font size. "Nesting depth" maps the TOP level to
		 * sizeMax and the deepest to sizeMin — hierarchy labels read big
		 * titles → small leaves; swapping Min/Max inverts. Field-driven
		 * size lerps the row value across [sizeMin, sizeMax]; a BLANK
		 * size cell falls back (coercing "" to 0 would land below
		 * sizeMin). */
		sizeFor: (node: HierarchyLayoutNode): number => {
			if (labelSizeByDepth) {
				if (labelMaxDepth <= 1) {
					return ptToPx((dataLabelsCfg.sizeMin + dataLabelsCfg.sizeMax) / 2)
				}
				const t = (node.depth - 1) / (labelMaxDepth - 1)
				return ptToPx(
					dataLabelsCfg.sizeMax +
						t * (dataLabelsCfg.sizeMin - dataLabelsCfg.sizeMax)
				)
			}
			const raw =
				labelSizeField && node.data.row
					? node.data.row[labelSizeField]
					: undefined
			if (raw === undefined || String(raw ?? "").trim() === "") {
				return ptToPx(dataLabelsCfg.fontSize)
			}
			return resolveLabelSize(raw, dataLabelsCfg, labelSizeValues)
		},
	}
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
	/** Standard leaf hover: id / parent / value / hue fields from the row,
	 *  plus (given the node) the highlight publish — the node's series for
	 *  the legend, its key for the marks. A null row means an implicit
	 *  container — no tooltip to show, but still a node to highlight. */
	const hoverLeaf =
		(row: Record<string, unknown> | null, node?: HierarchyLayoutNode) =>
		(e: React.MouseEvent) => {
			if (row) {
				const fields: TooltipState["fields"] = []
				if (idField) fields.push({ name: idField, value: row[idField] })
				if (parentField)
					fields.push({ name: parentField, value: row[parentField] })
				if (valueField)
					fields.push({ name: valueField, value: row[valueField] })
				const hueField = aestheticScales.hue?.field.name
				if (hueField && hueField !== parentField && hueField !== idField)
					fields.push({ name: hueField, value: row[hueField] })
				setHovered({ clientX: e.clientX, clientY: e.clientY, fields })
			} else {
				// Implicit container (no row): nothing to show, and the tooltip
				// of the leaf the pointer just left must not linger over it.
				setHovered(null)
			}
			if (node) {
				const series = hueSource
					? hierarchyDerivedValueOf(hueSource, node)
					: aestheticScales.hue && row
						? row[aestheticScales.hue.field.name]
						: undefined
				// A node outside every series (a root-level anonymous leaf, an
				// implicit container under a hue FIELD) keys on itself so the
				// hover still lands — no legend entry lights up for it.
				markHover.enter(series ?? node.data.key, node.data.key)
			}
		}

	/** Build the per-node style resolvers. The derived scales' domains are
	 * the scaffold's stable dataset-order lists (`derivedRootNames` /
	 * `derivedDepthLevels`), so the resolvers no longer depend on the laid
	 * out nodes — renderers just call this once inside their marks body. */
	const makeStyleResolvers = () => {
		// Depth is ORDINAL on every channel — discrete, ordered levels the
		// user can set individually (per-level overrides below), not a
		// continuous quantity. Numeric-ordinal unit scales still spread
		// unset levels linearly across min→max, so the range fade remains
		// the zero-config default. Domains are the scaffold's STABLE
		// dataset-order lists (see `derivedRootNames`), not this layout's
		// value-sorted nodes — palette / pattern slots must match the
		// sidebar swatches and hold across facet panels.
		const derivedType = (source: PackedDerivedSource) =>
			source === "rootGroup" ? ("categorical" as const) : ("ordinal" as const)
		const derivedDomainValues = (source: PackedDerivedSource): unknown[] =>
			source === "rootGroup" ? derivedRootNames : derivedDepthLevels
		const derivedValueOf = hierarchyDerivedValueOf
		/** Per-value overrides for a derived sat/bri scale: an explicit
		 * number for this depth level / group name wins over the scale's
		 * even spread. (Opacity doesn't need this wrapper — its categorical
		 * config carries overrides natively.) */
		const withOverrides = (
			scale: UnitScale,
			overrides: Record<string, number> | undefined
		): UnitScale => {
			if (!overrides) return scale
			return (raw) => {
				const explicit = overrides[String(raw)]
				return explicit !== undefined ? explicit : scale(raw)
			}
		}

		const hueDerivedType = derivedType(hueSource ?? "rootGroup")
		const hueDerivedScale = hueSource
			? makeHueScale(
					derivedDomainValues(hueSource),
					hueDerivedType,
					// Both derived sources color through the categorical config
					// shape (palette + per-value overrides); a leftover
					// quantitative config would confuse the scale builder.
					channelConfigs.hue?.kind === "categorical"
						? channelConfigs.hue
						: undefined,
					// Depth levels read as ordered, so prefer the theme's
					// sequential ordinal palettes (mirrors how ordinal FIELDS
					// resolve in useAestheticScales).
					hueSource === "depth"
						? (channelConfigs.ordinalPalette ??
								channelConfigs.categoricalPalette)
						: channelConfigs.categoricalPalette
				)
			: null
		const satDerivedScale = satSource
			? withOverrides(
					makeSaturationScale(
						derivedDomainValues(satSource),
						derivedType(satSource),
						channelConfigs.saturation
					) as UnitScale,
					channelConfigs.saturation?.overrides
				)
			: null
		const briDerivedScale = briSource
			? withOverrides(
					makeBrightnessScale(
						derivedDomainValues(briSource),
						derivedType(briSource),
						channelConfigs.brightness
					) as UnitScale,
					channelConfigs.brightness?.overrides
				)
			: null
		const opaDerivedScale = opaSource
			? (makeOpacityScale(
					derivedDomainValues(opaSource),
					derivedType(opaSource),
					channelConfigs.opacity
				) as UnitScale)
			: null

		/** Per-node stroke — the `outlineHue` channel, through the same
		 * precedence chain scatter marks use (conditional outline rule →
		 * outline scale color → the single `shape.outlineColor`). Any
		 * row-backed mark resolves against its row, so named containers
		 * (e.g. Watermelon) take an outline too; implicit containers have
		 * no row and fall back. */
		const outlineAes = aestheticScales.outlineHue
		const strokeFor = (
			row: Record<string, unknown> | null,
			fill: string
		): string => {
			const rowOutlineValue =
				row && outlineAes ? row[outlineAes.field.name] : null
			return resolveShapeColors({
				hueFill: fill,
				shapeCategoryValue: null,
				shapeConfig: channelConfigs.shape,
				hueMapped: !!hueSource || !!aestheticScales.hue,
				fallbackOutline: outlineColor,
				outlineScaleColor:
					row && outlineAes
						? applyHueScale(
								outlineAes.scale,
								rowOutlineValue,
								outlineAes.field.type
							)
						: null,
				// A `{Variable}` rule tests the row with or without an Outline
				// variable; an implicit rule needs the mapped value.
				outlineRuleColor: row
					? resolveRuleColor(
							channelConfigs.shape?.outlineColorRules,
							rowOutlineValue,
							[row]
						)
					: null,
			}).stroke
		}

		/** Per-node fill + opacity. Mirrors `resolveMarkAesthetics`' chain
		 * (hue → sat/bri modulation → opacity) with each stage swapping in
		 * its derived source when active. Returns null for a container with
		 * no derived color — those keep the fixed wash. */
		const styleFor = (
			node: HierarchyLayoutNode,
			isLeaf: boolean
		): HierarchyMarkStyle | null => {
			const row = node.data.row
			const defaultFill = channelConfigs.defaultFill ?? DEFAULT_FILL

			let fill: string
			/** What an implicit fill rule (`> 0`) compares against: the
			 * derived source's value, else the row's Color value. */
			let fillRuleValue: unknown
			if (hueSource && hueDerivedScale) {
				const value = derivedValueOf(hueSource, node)
				fillRuleValue = value
				fill =
					(value !== null
						? applyHueScale(hueDerivedScale, value, hueDerivedType)
						: null) ?? defaultFill
			} else if (isLeaf) {
				fill = defaultFill
				const hue = aestheticScales.hue
				if (hue && row) {
					fillRuleValue = row[hue.field.name]
					const c = applyHueScale(hue.scale, row[hue.field.name], hue.field.type)
					if (c) fill = c
				}
			} else {
				return null
			}
			// Conditional fill rules, as in `resolveMarkAesthetics`: a match
			// replaces the palette color before modulation. `{Variable}` rules
			// test the node's row; an implicit container has none.
			const fillRuleColor = resolveRuleColor(
				channelConfigs.fillColorRules,
				fillRuleValue,
				row ? [row] : undefined
			)
			if (fillRuleColor) fill = fillRuleColor
			const preModulationFill = fill

			// Modulation + opacity resolve the same way for leaves and
			// containers: derived source → row-backed field mapping →
			// channel default. No automatic container translucency — how
			// nested levels distinguish themselves (depth-driven opacity,
			// brightness, saturation, or none) is the user's call.
			// Mapped-but-unresolvable values fall back to the channel's default
			// level, matching `resolveMarkAesthetics` / `resolveGroupFill` (the
			// same convention hue follows with `defaultFill`).
			const sat = aestheticScales.saturation
			const satUnit =
				(satSource && satDerivedScale
					? satDerivedScale(derivedValueOf(satSource, node))
					: sat && row
						? sat.scale(row[sat.field.name])
						: null) ??
				channelConfigs.defaultSaturation ??
				null
			const bri = aestheticScales.brightness
			const briUnit =
				(briSource && briDerivedScale
					? briDerivedScale(derivedValueOf(briSource, node))
					: bri && row
						? bri.scale(row[bri.field.name])
						: null) ??
				channelConfigs.defaultBrightness ??
				null
			if (satUnit !== null || briUnit !== null) {
				fill = modulateColor(fill, satUnit, briUnit)
			}

			const opa = aestheticScales.opacity
			const baseOpacity =
				(opaSource && opaDerivedScale
					? opaDerivedScale(derivedValueOf(opaSource, node))
					: opa && row
						? opa.scale(row[opa.field.name])
						: null) ??
				channelConfigs.defaultOpacity ??
				DEFAULT_OPACITY
			// Hover highlight: recolor / fade the mark per the hovered legend
			// entry or hovered node (see `nodeHighlight`). The outline half of
			// the highlight is applied by `markStroke`, which owns the stroke.
			const mh = nodeHighlight(node)
			const opacity = baseOpacity * mh.opacityMul
			if (mh.fill) fill = mh.fill

			return { fill, opacity, preModulationFill, fadeMul: mh.opacityMul }
		}

		// ── Pattern resolution ─────────────────────────────────────────────
		// Two sources, mirroring the color chain:
		//  - DERIVED (`pattern.measureSource` = rootGroup / depth): resolved
		//    from tree position, so any styled mark patterns — implicit
		//    containers included when a derived color styles them.
		//  - FIELD: row-backed marks only — leaves everywhere, plus named
		//    containers (which resolve aesthetics against their row, same as
		//    the outline chain).
		// The pattern tile's background is the mark's drawn fill — whether a
		// color varies the marks (field hue OR the derived rootGroup/depth
		// source) or not — unless no color does and the Pattern panel's
		// Background override replaces it (the shared `patternTile` rule);
		// ink pairing keys on the PRE-modulation color per the palette-ink
		// invariant.
		const patternAes = aestheticScales.pattern
		const patternBgOverride = channelConfigs.pattern?.backgroundColor ?? null
		const hueDrivesFill = !!hueSource || !!aestheticScales.hue
		const inkHueType = hueSource
			? derivedType(hueSource)
			: (aestheticScales.hue?.field.type ?? "categorical")
		const resolveNodePattern = (
			category: string,
			catIdx: number,
			style: HierarchyMarkStyle
		): ResolvedPattern | null => {
			const { bgColor, inkKeyColor } = patternTile(
				{ fill: style.fill, preModulationHue: style.preModulationFill },
				hueDrivesFill,
				patternBgOverride
			)
			const huePalette = inkPaletteForHue(channelConfigs, inkHueType)
			const preferredInk = inkForHueColor(
				inkKeyColor,
				huePalette.palette,
				huePalette.inks,
				aestheticScales.themeInkFallback
			)
			return resolvePatternForMark(
				category,
				catIdx,
				bgColor,
				channelConfigs.pattern,
				preferredInk
			)
		}
		/** The `<pattern>` def (or null) for one mark. Renderers use its
		 * `svgId` as the mark fill and collect the specs for `<PatternDefs>`
		 * (which dedupes). */
		const patternFor = (
			node: HierarchyLayoutNode,
			style: HierarchyMarkStyle | null
		): ResolvedPattern | null => {
			if (!style) return null
			if (patternSource) {
				const value =
					patternSource === "rootGroup"
						? hierarchyRootNameOf(node)
						: String(node.depth)
				if (value === null) return null
				const domain =
					patternSource === "rootGroup"
						? derivedRootNames
						: derivedDepthLevels
				const catIdx = domain.indexOf(value)
				if (catIdx === -1) return null
				return resolveNodePattern(value, catIdx, style)
			}
			if (!patternAes) return null
			const row = node.data.row
			if (!row) return null
			const raw = row[patternAes.field.name]
			if (raw === undefined || raw === null || String(raw) === "") return null
			const catStr = String(raw)
			const catIdx = patternAes.categories.indexOf(catStr)
			if (catIdx === -1) return null
			return resolveNodePattern(catStr, catIdx, style)
		}

		/** Mark stroke — every node (leaf, row-backed container, implicit
		 * container) resolves through the SAME outline chain: `outlineHue`
		 * mapping when the node has a row to look it up from, otherwise the
		 * user's single outline color, always at the user's outline width
		 * (0 hides borders entirely). No hidden container rim. The hover
		 * "Outline hovered elements" option wins over all of it for the
		 * hovered node, as on every other mark type — a packed circle has
		 * its own rim, and a hovered treemap tile / sunburst arc reads fine
		 * with one emphasized edge. */
		const markStroke = (
			node: HierarchyLayoutNode,
			style: HierarchyMarkStyle | null
		): { stroke: string; strokeWidth: number } => {
			const mh = nodeHighlight(node)
			if (mh.outline) return { stroke: mh.outline, strokeWidth: mh.outlineWidth }
			const row = node.data.row
			return {
				stroke:
					row && outlineAes
						? strokeFor(row, style?.fill ?? HIERARCHY_PARENT_FILL)
						: outlineColor,
				strokeWidth: outlineWidth,
			}
		}

		return {
			styleFor,
			strokeFor,
			markStroke,
			rootNameOf: hierarchyRootNameOf,
			patternFor,
		}
	}

	return {
		encodings,
		channelConfigs,
		aestheticScales,
		dataset,
		rowsForChart,
		parentField,
		valueField,
		idField,
		root,
		textCfg,
		labelStyle,
		outlineColor,
		outlineWidth,
		coord,
		/** False until a dataset + area field exist — renderers return null. */
		ready: !!dataset && !!valueField,
		tooltip,
		hoverLeaf,
		clearHover,
		makeStyleResolvers,
		inner: props.inner,
	}
}
