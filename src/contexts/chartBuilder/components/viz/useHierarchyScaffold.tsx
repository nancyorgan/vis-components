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
	formatSingleLabel,
	labelHueScaleParts,
	resolveLabelFill,
	resolveLabelSize,
} from "../../lib/dataLabelsStyle"
import { effectiveType } from "../../lib/fieldType"
import { resolveTextFont } from "../../lib/labelsConfig"
import {
	hierarchyDepthLevels,
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
	currentLabelsAtom,
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

export type HierarchyMarkStyle = {
	fill: string
	opacity: number
	/** The hue-chain color BEFORE sat/bri modulation. Pattern-ink lookups
	 * match against the theme palette's exact swatch hexes, so they must
	 * key on this (see `PatternDefItem.preModulationHue`). */
	preModulationFill: string
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
	const labels = useAtomValue(currentLabelsAtom)
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
	// Containers always show their NAME — a container aggregates many
	// rows, so a mapped value field doesn't apply — but take the styling
	// (row-backed containers resolve color/size against their row).
	// Field-scale domains come from the FULL dataset so facet panels
	// agree. Color and Size additionally accept the hierarchy-DERIVED
	// sources ("Top-level group" / "Nesting depth" — the label analogue
	// of the mark channels' derived variables), resolved from each
	// node's position in the laid-out tree rather than a row value.
	const labelValueField = dataLabelsEnc.value.field
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
	/** The depth-1 ancestor's name — what "Top-level group" varies by
	 * (label twin of makeStyleResolvers' rootNameOf). */
	const labelRootNameOf = (node: HierarchyLayoutNode): string | null => {
		let a = node
		while (a.depth > 1 && a.parent) a = a.parent
		return a.data.label || null
	}
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
	const labelStyle = {
		cfg: dataLabelsCfg,
		/** A node's label text. Leaves show the mapped value field's row
		 * value (formatted per the field's Label format spec, falling back
		 * to the decimals option), defaulting to the node's name;
		 * containers always name themselves. `null` = no label (blank
		 * value / anonymous leaf with nothing mapped). */
		textFor: (node: HierarchyLayoutNode, isLeaf: boolean): string | null => {
			const d = node.data
			if (isLeaf && labelValueField && d.row) {
				return formatSingleLabel(
					d.row[labelValueField],
					dataLabelsCfg.fieldFormats?.[labelValueField],
					dataLabelsCfg.decimals
				)
			}
			return d.label || null
		},
		/** A node's label fill via the Data Labels precedence chain. The
		 * derived sources resolve from tree position (so implicit
		 * containers color too); the field path needs a row — rowless
		 * nodes take the single fallback color. */
		fillFor: (node: HierarchyLayoutNode): string => {
			const row = node.data.row
			const labelValue =
				labelValueField && row ? row[labelValueField] : undefined
			if (labelHueSource) {
				const value =
					labelHueSource === "rootGroup"
						? labelRootNameOf(node)
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
					labelValue
				)
			}
			if (!row) return dataLabelsCfg.color
			const hueValue = labelHueField ? row[labelHueField] : undefined
			const hueColor =
				labelHueScale && hueValue !== undefined
					? (applyHueScale(labelHueScale, hueValue, labelHueFieldType) ??
						null)
					: null
			return resolveLabelFill(dataLabelsCfg, hueValue, hueColor, labelValue)
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
	const clearHover = () => setHovered(null)
	/** Standard leaf hover: id / parent / value / hue fields from the row. */
	const hoverLeaf =
		(row: Record<string, unknown>) => (e: React.MouseEvent) => {
			const fields: TooltipState["fields"] = []
			if (idField) fields.push({ name: idField, value: row[idField] })
			if (parentField)
				fields.push({ name: parentField, value: row[parentField] })
			if (valueField) fields.push({ name: valueField, value: row[valueField] })
			const hueField = aestheticScales.hue?.field.name
			if (hueField && hueField !== parentField && hueField !== idField)
				fields.push({ name: hueField, value: row[hueField] })
			setHovered({ clientX: e.clientX, clientY: e.clientY, fields })
		}

	/** Build the per-node style resolvers. The derived scales' domains are
	 * the scaffold's stable dataset-order lists (`derivedRootNames` /
	 * `derivedDepthLevels`), so the resolvers no longer depend on the laid
	 * out nodes — renderers just call this once inside their marks body. */
	const makeStyleResolvers = () => {
		/** The depth-1 ancestor's name — what "Top-level group" varies by.
		 * A root-level anonymous leaf has no name → channel fallback. */
		const rootNameOf = (node: HierarchyLayoutNode): string | null => {
			let a = node
			while (a.depth > 1 && a.parent) a = a.parent
			return a.data.label || null
		}
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
		const derivedValueOf = (
			source: PackedDerivedSource,
			node: HierarchyLayoutNode
		): unknown => (source === "rootGroup" ? rootNameOf(node) : node.depth)
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
				outlineRuleColor:
					row && outlineAes
						? resolveRuleColor(
								channelConfigs.shape?.outlineColorRules,
								rowOutlineValue
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
			if (hueSource && hueDerivedScale) {
				const value = derivedValueOf(hueSource, node)
				fill =
					(value !== null
						? applyHueScale(hueDerivedScale, value, hueDerivedType)
						: null) ?? defaultFill
			} else if (isLeaf) {
				fill = defaultFill
				const hue = aestheticScales.hue
				if (hue && row) {
					const c = applyHueScale(hue.scale, row[hue.field.name], hue.field.type)
					if (c) fill = c
				}
			} else {
				return null
			}
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
			// Legend-hover highlight: recolor / fade a leaf per the hovered
			// legend entry. Containers (no row) resolve to the neutral result, so
			// they never change. (Outline isn't applied here — hierarchy cells
			// share edges, so a per-cell outline would read as noise.)
			const mh = rowHighlight(legendHighlight, row ?? {})
			const opacity = baseOpacity * mh.opacityMul
			if (mh.fill) fill = mh.fill

			return { fill, opacity, preModulationFill }
		}

		// ── Pattern resolution ─────────────────────────────────────────────
		// Two sources, mirroring the color chain:
		//  - DERIVED (`pattern.measureSource` = rootGroup / depth): resolved
		//    from tree position, so any styled mark patterns — implicit
		//    containers included when a derived color styles them.
		//  - FIELD: row-backed marks only — leaves everywhere, plus named
		//    containers (which resolve aesthetics against their row, same as
		//    the outline chain).
		// The pattern tile's background is the mark's drawn fill when a color
		// varies the marks (field hue OR the derived rootGroup/depth source),
		// else the Pattern panel's background color; ink pairing keys on the
		// PRE-modulation color per the palette-ink invariant.
		const patternAes = aestheticScales.pattern
		const patternBg = channelConfigs.pattern?.backgroundColor ?? "#e2e8f0"
		const hueDrivesFill = !!hueSource || !!aestheticScales.hue
		const inkHueType = hueSource
			? derivedType(hueSource)
			: (aestheticScales.hue?.field.type ?? "categorical")
		const resolveNodePattern = (
			category: string,
			catIdx: number,
			style: HierarchyMarkStyle
		): ResolvedPattern | null => {
			const bgColor = hueDrivesFill ? style.fill : patternBg
			const huePalette = inkPaletteForHue(channelConfigs, inkHueType)
			const preferredInk = inkForHueColor(
				hueDrivesFill ? style.preModulationFill : patternBg,
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
						? rootNameOf(node)
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
		 * (0 hides borders entirely). No hidden container rim. */
		const markStroke = (
			node: HierarchyLayoutNode,
			style: HierarchyMarkStyle | null
		): { stroke: string; strokeWidth: number } => {
			const row = node.data.row
			return {
				stroke:
					row && outlineAes
						? strokeFor(row, style?.fill ?? HIERARCHY_PARENT_FILL)
						: outlineColor,
				strokeWidth: outlineWidth,
			}
		}

		return { styleFor, strokeFor, markStroke, rootNameOf, patternFor }
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
