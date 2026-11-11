import { useAtom, useAtomValue } from "jotai"
import { useMemo } from "react"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_FACET_CONFIG,
	effectiveLabelPoints,
	type DataLabelsConfig,
	type EndpointLabelOverrides,
	type FacetConfig,
	type FieldBarPlacement,
	type FieldLabelLayout,
	type FieldPolarPlacement,
	type LabelPieceSection,
	type LabelPointsMode,
	type LabelPointsScope,
	type LabelPositionRule,
} from "../../lib/channelConfig"
import { resolveHierarchyIdField } from "../../lib/buildHierarchy"
import { hierarchyNameField } from "../../lib/hierarchyLabels"
import { buildFlowGraph, resolveFlowEndpoints } from "../../lib/buildFlowGraph"
import {
	effectiveFlowLabelNodes,
	everyNodeSendsAndReceives,
	flowLabelFieldNames,
	flowLabelNodeOptions,
	flowNodeTotals,
	flowRedundantLabelFields,
	type FlowLabelNodes,
} from "../../lib/flowNodeLabels"
import { barTotalFieldName } from "../../lib/barTotalLabel"
import { seedLabelTextPalette } from "../../lib/dataLabelsHue"
import { BAR_TOTAL_SEED, valueFieldsPatch } from "../../lib/dataLabelsValueFields"
import {
	POPULATION_LABEL,
	fieldLabelPointsMode,
	labelPieceSplit,
	labelFacetKeysFor,
	labelKeysFor,
	labelScopeFor,
	normalizeComposedLabels,
	labelEntry,
	sectionKeysFor,
	presentPopulations,
	resolveLabelSelection,
} from "../../lib/dataLabelsSelection"
import { resolveStackModes } from "../../lib/stackMode"
import {
	dataLabelsConfigFromTheme,
} from "../../lib/themeConfig"
import { effectiveType } from "../../lib/fieldType"
import {
	facetPanelOptions,
	resolveFacetPanels,
} from "../../lib/resolveFacetPanels"
import type { FacetPanelRef } from "../../lib/facetPanelRef"
import {
	PACKED_DERIVED_LABELS,
	PACKED_MEASURE_OPTION_VALUE,
	hierarchyDepthLevels,
	packedSourceForOptionValue,
	topLevelGroupNames,
} from "../../lib/packedMeasure"
import {
	isAreaModeId,
	isBarModeId,
	isComboModeId,
	isHierarchyModeId,
	isPieModeId,
} from "../../lib/chartModes/families"
import { comboMarksFields, dataLabelLayerFor } from "../../lib/comboOverlay"
import {
	emptyDataLabelsEncodings,
	type DataLabelsEncodings,
	type FieldType,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
} from "../../store/atoms"
import { useChartModeDef } from "../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import { useGeoLabelLevel } from "../../store/useGeoLabelLevel"

import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import {
	LABEL_COL,
	LABEL_COL_NESTED,
} from "../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../components/ui/SelectInput"
import { Segmented } from "../../../../components/ui/Segmented"
import { Checkbox } from "../../../../components/ui/Checkbox"
import { AlignmentControl } from "./LabelsPanel"
import { FacetScopeControl } from "./FacetScopeControl"
import { DataLabelChannelRow } from "./dataLabels/DataLabelChannelRow"
import {
	DATA_LABEL_POSITION_CHANNELS,
	resolveDataLabelPositions,
	withBarLabelPosition,
} from "../../lib/dataLabelsPosition"
import { LabelColorPanel } from "./dataLabels/LabelColorPanel"
import { PositionRulesEditor } from "./dataLabels/PositionRulesEditor"
import { SizePanel } from "./dataLabels/SizePanel"
import { TextBackgroundPanel } from "./dataLabels/TextBackgroundPanel"
import { TextPositionPanel } from "./dataLabels/TextPositionPanel"
import { TextPropertiesPanel } from "./dataLabels/TextPropertiesPanel"
import { SingleValuePanel, ValuePanel } from "./dataLabels/ValuePanel"
import type { DataLabelsChannel } from "./dataLabels/shared"

/** Sentinel option value for the Value dropdown's "Multiple variables…"
 *  choice. Distinct from any field name and from "" (— none —) so the
 *  onChange handler can switch the `value` encoding into multi-field mode
 *  (which leaves `value.field` null and drives text off `value.fields`). */
const DATA_LABELS_MULTI_VALUE = "__multiple__"
// "Characters" (wrap width) default — also its reset target.
const DEFAULT_WRAP_CHARS = DEFAULT_DATA_LABELS_CONFIG.wrapMaxChars ?? 20

/** "Which labels" choices — shared by the single-field select and the
 *  per-variable selects of multi-field mode. With the scope select showing
 *  beneath ("Of each: Series / Group / Stack") the choices drop their
 *  tail so the two selects read as one sentence ("scope"); elsewhere the
 *  tail says what the ends run over — "per series", or "wedge" on a lone
 *  pie, where the ends always run over each pie's wedges from the arc
 *  start (the renderer pins the scope there; see `buildPieAnchors`). */
type LabelPointsTail = "scope" | "series" | "wedge"
const labelPointsOptions = (
	tail: LabelPointsTail
): ReadonlyArray<{ value: LabelPointsMode; label: string }> => {
	const suffix =
		tail === "scope" ? "" : tail === "wedge" ? " wedge" : " per series"
	return [
		{ value: "all", label: "All labels" },
		{ value: "first", label: `First${suffix}` },
		{ value: "last", label: `Last${suffix}` },
		{ value: "first-last", label: `First and last${suffix}` },
	]
}

/** What the series ends run over (`DataLabelsConfig.labelPointsScope`),
 *  worded per chart family. Only the scopes the chart supports are
 *  offered: "Group" needs a group-mode channel (bars only), "Stack" / "Pie"
 *  a layering channel (stack / overlay on bars and areas; the wedge
 *  channel on pies). The stored value is "stack" for pies too — a pie's
 *  wedges are its layers. */
type ScopeFamily = "bars" | "areas" | "pies"
const SCOPE_OPTION: Record<ScopeFamily, Record<LabelPointsScope, string>> = {
	bars: { series: "Series", group: "Group", stack: "Stack" },
	areas: { series: "Series", group: "Group", stack: "Stack" },
	pies: { series: "Series", group: "Group", stack: "Pie" },
}
const SCOPE_HELP: Record<ScopeFamily, Record<LabelPointsScope, string>> = {
	bars: {
		series: "The first and last bar of each series along the axis.",
		group: "The first and last bar inside each group.",
		stack: "The bottom and top layer of each stack.",
	},
	areas: {
		series: "The first and last point of each layer along the axis.",
		group: "",
		stack: "The bottom and top layer at each point.",
	},
	pies: {
		series: "The same wedge on the first and last pie.",
		group: "",
		stack: "The first and last wedge of each pie.",
	},
}

const CHANNEL_LABEL: Record<DataLabelsChannel, string> = {
	x: "X position",
	y: "Y position",
	angle: "Angle",
	geography: "Geography",
	value: "Value",
	hue: "Color",
	size: "Size",
}

/** Sidebar section that lets the user encode an independent label layer
 * on top of the main visualization. The layer's encodings are stored in
 * `currentDataLabelsEncodingsAtom`; appearance + offsets + scale knobs
 * live in `currentDataLabelsConfigAtom`. */
/** Measure-axis placement options ("Vertical" on vertical bars). */
const BAR_POSITION_OPTIONS: {
	value: NonNullable<DataLabelsConfig["barLabelPosition"]>
	label: string
}[] = [
	{ value: "center", label: "Center of bar (default)" },
	{ value: "inside-base", label: "Inside, near base" },
	{ value: "inside-end", label: "Inside, near end" },
	{ value: "outside-end", label: "Outside the end of the bar" },
]

/** Side options, named by orientation: left / right of a vertical bar,
 *  above / below a horizontal one. */
const barSideOptions = (
	isVerticalBars: boolean
): { value: NonNullable<DataLabelsConfig["barLabelSide"]>; label: string }[] => [
	{ value: "center", label: "Centered on the bar (default)" },
	{ value: "before", label: isVerticalBars ? "Left of the bar" : "Above the bar" },
	{ value: "after", label: isVerticalBars ? "Right of the bar" : "Below the bar" },
]

export const DataLabelsPanel = () => {
	const [storedEncodings, setEncodings] = useAtom(
		currentDataLabelsEncodingsAtom
	)
	// Defensive merge: persisted state from before the `text` → `value`
	// rename (or any future channel addition) wouldn't have all keys, so
	// reads like `encodings.value.field` would crash. Spreading defaults
	// underneath guarantees every channel slot exists.
	// Unset position rows show the chart's own X / Y (Angle / R on a pie)
	// selected — what the labels inherit (`resolveDataLabelPositions`).
	// Writes stay functional over the stored atom, so the inherited field is
	// never persisted unless the user picks it.
	const chartEncodings = useAtomValue(currentEncodingsAtom)
	const encodings: DataLabelsEncodings = resolveDataLabelPositions(
		{ ...emptyDataLabelsEncodings(), ...storedEncodings },
		chartEncodings,
	)
	const [cfg, setCfg] = useAtom(currentDataLabelsConfigAtom)
	// Normalized like the layer: a visual saved before composed labels gets
	// its label list derived from the legacy state, so the panel shows the
	// same labels the chart draws; the first edit persists it.
	const merged: DataLabelsConfig = normalizeComposedLabels(
		{ ...DEFAULT_DATA_LABELS_CONFIG, ...cfg },
		encodings.value.fields ?? []
	)
	// Resolve the LIVE theme (same fallback chain as LabelColorPanel) so the
	// font-size / weight / style reset links compare against — and reset to —
	// the theme's data-label defaults rather than the hardcoded constants.
	const theme = useCurrentTheme()
	const themeDefaults = dataLabelsConfigFromTheme(theme)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const chartConfigs = useAtomValue(currentChannelConfigsAtom)
	// The visualization's own background (null = transparent canvas → white)
	// is the default fill for the text-background rect, so labels mask the
	// gridlines they sit over by blending into the chart surface.
	const vizBackground = chartConfigs.backgroundColor ?? "#ffffff"
	const dataset = useCurrentDatasetView()
	const hueField = encodings.hue.field
	// Hierarchy-derived label sources (tree layouts): Color can vary by
	// "Top-level group" (categorical) or "Nesting depth" (ordinal), Size
	// by depth. Stored as `measureSource` on the slot, mirroring the main
	// shelf's derived variables.
	const hueSource = encodings.hue.measureSource ?? null
	const sizeByDepth = encodings.size.measureSource === "depth"
	// Resolve the hue field's effective type so the Color panel can show
	// the right picker — categorical palettes for discrete fields,
	// gradient list for quantitative / temporal. Derived sources carry
	// their own type (depth is ordinal, group names categorical).
	const hueFieldType: FieldType | null = hueSource
		? hueSource === "depth"
			? "ordinal"
			: "categorical"
		: dataset && hueField
			? effectiveType(dataset, hueField, overrides)
			: null

	// Resolve the mode via the shared hook — it folds in field types, channel
	// configs AND the map config, so config-gated modes (histograms) and geo
	// modes both detect exactly like the render path.
	const modeDef = useChartModeDef()
	const chartMode = modeDef.id
	// Every per-mode decision below reads the mode's declared `labels` /
	// `canvas` traits or a mode family — never a mode id.
	//
	// A heatmap is the one chart where label positions MUST match the
	// chart's encoding — every cell is keyed by (chart.x, chart.y), so
	// encoding a third field as the label's x or y would produce nonsense.
	// We restrict the dropdowns to just the chart's x/y fields so the user
	// can't pick anything misleading. (Unset rows inherit the chart's x/y,
	// so both start filled.)
	const positionLocked = modeDef.labels.positionLockedToAxes
	// Maps: labels anchor to REGIONS, not to x/y fields — the position rows
	// are replaced by a single "Geography" row (the field whose values join
	// to map regions; labels center on each matched region's centroid). The
	// per-series "Which labels" selection has no meaning on a map.
	const isGeoMode = modeDef.canvas.coordFamily === "geo"
	// Tree layouts (packed circles / treemap / sunburst): labels are PLACED
	// by the layout (leaf centers, container rims, arc centroids), so the
	// position rows stand down — Value, Color, Size, and Text Properties
	// still apply. The treemap draws its labels itself, so the position /
	// overlap / background fine-tuning stands down there. Packed circles
	// and the sunburst hand their anchors to the shared label layer, so they
	// keep the full fine-tuning set (the sunburst's polar nudges included,
	// like a pie).
	// Which of those applies is the mode's declared `labels.placement`.
	const isTreeMode = isHierarchyModeId(chartMode)
	const isRingLabels = modeDef.labels.placement === "ring"
	const fineTuningApplies = modeDef.labels.placement !== "layout"
	// Flow diagrams (chord / sankey): labels sit beside each NODE (outside
	// the chord ring, beside a sankey rect), so the X / Y rows grey out;
	// everything else applies through the shared label layer. "Which labels"
	// becomes the by-flow-direction node selection, and Value / Size also
	// offer the flow-only values (Flow in / Flow out / Node total).
	const flowGeometry = modeDef.canvas.flowGeometry
	const isFlowMode = flowGeometry !== undefined
	// Pie family — labels are placed in polar terms (distance from center +
	// angular nudge) rather than the cartesian X/Y pixel offsets that make
	// no sense around a wedge.
	const isPolarMode = isPieModeId(chartMode)
	// No per-series endpoints: regions on a map, nodes in a sunburst. The
	// "Which labels" selection is hidden AND skipped by the renderer there.
	const noSeriesEndpoints = !modeDef.labels.seriesEndpoints
	// Bar charts (incl. histograms, which are bars over binned categories) are
	// the only mode where "Bar position" (label placement along the measure
	// axis) applies — gate the control on it.
	const isBarMode = isBarModeId(chartMode)
	// The two bar placements sit under a "Placement" group header, named by
	// the screen direction they move labels in, so they swap with
	// orientation: on vertical bars the measure-axis placement is
	// "Vertical" and the category-axis side is "Horizontal"; on horizontal
	// bars the reverse. The side's options follow suit (left / right of a
	// vertical bar, above / below a horizontal one). On vertical bars a side
	// also fixes the text alignment (the label hangs away from the bar), so
	// the Alignment controls would be inert — they hide while a side is set.
	// Vertical bars = the bar mode whose measure runs on the y axis.
	const isVerticalBars = isBarMode && modeDef.canvas.measureAxis === "y"
	// Separate variables each resolve their own side (their entry, else the
	// layer's) — the lock is per variable there, layer-wide otherwise.
	const sideFor = (field: string | null) =>
		(field === null ? undefined : merged.fieldBarPlacements?.[field]?.side) ??
		merged.barLabelSide ??
		"center"
	// Bar + marks combo (§3.3): each label annotates the bars or the marks
	// (`fieldLayers`, else by the variables it shows). A label on the marks
	// takes no bar placement — the Placement group hides for it and a stored
	// side neither locks its alignment nor counts as a change.
	const isComboMode = isComboModeId(chartMode)
	const marksFields = comboMarksFields(chartMode, chartEncodings, chartConfigs)
	const marksLayerName = chartEncodings.connection?.field ? "Line" : "Points"
	const layerFor = (key: string | null, fields: ReadonlyArray<string>) =>
		isComboMode ? dataLabelLayerFor(merged, key, fields, marksFields) : "bars"
	const sideLocksAlignmentFor = (field: string | null) =>
		isBarMode &&
		isVerticalBars &&
		sideFor(field) !== "center" &&
		layerFor(field, field === null ? [] : [field]) !== "marks"
	// Area charts get the same placements along each layer's measure extent
	// ("Layer position"), plus the layer's top edge as the default.
	const isAreaMode = isAreaModeId(chartMode)
	// "Of each" scope for the series ends. Shown only where it can change
	// anything: bars grouped (a group-mode channel) or layered (stack /
	// overlay), stacked areas, or several pies with a wedge channel — AND
	// some "Which labels" choice is not "All labels". A channel mapped to
	// the x field colors marks without forming groups or layers, so it
	// doesn't count. A single pie has no series across pies, so the scope
	// stands down there: the renderer runs the ends over each pie's wedges
	// (the only unit that can select anything) and "Which labels" reads
	// "First wedge" / "Last wedge" — the pies that line up along a band are
	// the ones drawing a category axis.
	const piesAlongBand =
		isPolarMode &&
		(modeDef.canvas.cartesianAxes.x || modeDef.canvas.cartesianAxes.y)
	const scopeFamily: ScopeFamily | null = isBarMode
		? "bars"
		: isAreaMode
			? "areas"
			: piesAlongBand
				? "pies"
				: null
	const stackModes = resolveStackModes(chartConfigs, chartEncodings).filter(
		(m) => chartEncodings[m.channel]?.field !== chartEncodings.x?.field
	)
	const scopeGrouped =
		scopeFamily === "bars" && stackModes.some((m) => m.mode === "group")
	const scopeLayered =
		scopeFamily === "bars"
			? stackModes.some((m) => m.mode !== "group")
			: stackModes.length > 0
	// The chart can express a scope at all (something to group or layer by);
	// whether the select SHOWS is then per label — a label on "All labels"
	// has no series ends to scope.
	const scopeApplies =
		scopeFamily !== null && (scopeGrouped || scopeLayered)
	const scopeWording = SCOPE_OPTION[scopeFamily ?? "bars"]
	const scopeOptions = (
		["series", "group", "stack"] as const satisfies readonly LabelPointsScope[]
	)
		.filter((sc) =>
			sc === "group" ? scopeGrouped : sc === "stack" ? scopeLayered : true
		)
		.map((sc) => ({ value: sc, label: scopeWording[sc] }))
	/** Does this label's "Of each" select show? `null` = the single-field
	 *  label (and the layer-wide fallback). */
	// A label on the combo's marks ranks its ends per Connection series like
	// a line chart's, so the bar scopes don't apply to it.
	const labelFieldsFor = (key: string | null): ReadonlyArray<string> =>
		key === null
			? [encodings.value.field ?? encodings.x.field ?? encodings.y.field].filter(
					(f): f is string => !!f
				)
			: (labelKeysFor(merged, encodings.value).pieces[key] ?? [])
	const showScopeFor = (key: string | null): boolean =>
		scopeApplies &&
		layerFor(key, labelFieldsFor(key)) !== "marks" &&
		(key === null
			? effectiveLabelPoints(merged)
			: fieldLabelPointsMode(merged, key)) !== "all"
	// A stored scope whose channel is gone reads as "series" (the renderer
	// falls back the same way); the stored value is left alone.
	const effectiveScopeFor = (key: string | null): LabelPointsScope => {
		const stored = labelScopeFor(merged, key)
		return scopeOptions.some((o) => o.value === stored) ? stored : "series"
	}
	// "First / last" drop their "per series" tail where the scope select
	// spells the unit out beneath them, so the two read as one sentence. A
	// lone pie (not along a band) has no series to run across — the ends
	// run over its wedges, and the choices say so.
	const whichLabelsOptionsFor = (key: string | null) =>
		labelPointsOptions(
			showScopeFor(key) ? "scope" : isPolarMode && !piesAlongBand ? "wedge" : "series"
		)
	// Bars layered by a channel (stack / overlay) carry a BAR TOTAL — the sum
	// of a bar's layers — offered under Value as a derived variable
	// (`lib/barTotalLabel.ts`; the bars' Node total), exactly where the Stack
	// scope is. It stays listed while mapped, so a Stack → Group toggle
	// doesn't empty the Value row; a data set column of that name wins.
	const barTotalName = barTotalFieldName(
		(dataset?.fields ?? []).map((f) => f.name)
	)
	const barTotalPicked =
		barTotalName !== null &&
		(encodings.value.field === barTotalName ||
			(encodings.value.fields ?? []).includes(barTotalName))
	const barTotalOptions =
		barTotalName !== null &&
		((scopeFamily === "bars" && scopeLayered) || barTotalPicked)
			? [{ value: barTotalName, label: barTotalName }]
			: []
	const chartXField = chartEncodings.x?.field ?? null
	const chartYField = chartEncodings.y?.field ?? null

	// Countries-level geo labels get the "Full country name" preset in the
	// Label-format dropdowns (region labels can spell out the atlas's
	// abbreviated names — "Dem. Rep. Congo" → "Democratic Republic of the
	// Congo"). The level is auto-detected from the label layer's own
	// geography field, same as the render join (useGeoLabelLevel); the
	// option never appears outside geo modes, so other chart types keep
	// their dropdown unchanged.
	const geoLabelLevel = useGeoLabelLevel(
		isGeoMode ? (encodings.geography?.field ?? null) : null
	)
	const countryNameFormats = isGeoMode && geoLabelLevel === "countries"

	const updateCfg = (next: Partial<DataLabelsConfig>) =>
		setCfg({ ...merged, ...next })

	// Facet panels for the current chart — the same resolver PlotCanvas
	// renders against (and the annotations panel lists), so the keys the
	// "Apply to all facets" picker stores match the rendered panels. Unfaceted
	// charts (`mode === "single"`) hide the control.
	const facetCfg = useMemo<FacetConfig>(
		() => ({ ...DEFAULT_FACET_CONFIG, ...chartConfigs.facet }),
		[chartConfigs.facet]
	)
	const facetPanels = useMemo(
		() =>
			resolveFacetPanels(
				dataset,
				chartEncodings,
				levelOrders,
				overrides,
				facetCfg
			),
		[dataset, chartEncodings, levelOrders, overrides, facetCfg]
	)
	const isFaceted = facetPanels.mode !== "single"
	const facetOptions = useMemo(
		() => facetPanelOptions(facetPanels),
		[facetPanels]
	)

	// The label POPULATIONS the current selection renders (all / first /
	// last — lib/dataLabelsSelection): single-field reads them off "Which
	// labels"; multi-field off the per-field selects. Two or more populations
	// split the label-text, alignment, and position controls into one block
	// per population — the only case where several label sets coexist. The
	// series-end blocks read effective values (override ?? base) and write
	// into the endpoint override blocks. Geo modes (and sunbursts) never
	// split: the selection is hidden AND skipped there (no series), so a
	// stored endpoint mode from a previous chart must not split the controls.
	const selection = resolveLabelSelection(merged, encodings.value, {
		seriesless: noSeriesEndpoints,
	})
	const splitEndpoints = selection.split
	const splitPopulations = presentPopulations(selection)
	const patchEndpoint = (
		key: "firstLabel" | "lastLabel",
		p: Partial<EndpointLabelOverrides>
	) => updateCfg({ [key]: { ...(merged[key] ?? {}), ...p } })
	// Per-label "Which labels" (multi-field mode), keyed by the composed
	// label's id.
	const setFieldLabelPoints = (key: string, mode: LabelPointsMode) =>
		updateCfg({
			fieldLabelPoints: { ...(merged.fieldLabelPoints ?? {}), [key]: mode },
		})
	// Per-label "Of each" and "Apply to all facets", same keying: each composed
	// label's series ends can run over a different unit and it can be kept
	// to its own facet panels. The single-field label writes the layer-wide
	// fields instead (there's one label to place).
	const setLabelScope = (key: string, scope: LabelPointsScope) =>
		updateCfg({
			fieldLabelPointsScope: {
				...(merged.fieldLabelPointsScope ?? {}),
				[key]: scope,
			},
		})
	const setLabelFacetKeys = (key: string, next: FacetPanelRef[] | null) =>
		updateCfg({
			fieldFacetKeys: { ...(merged.fieldFacetKeys ?? {}), [key]: next },
		})

	// One composed label's selection block. `null` = the single-field label,
	// which writes the layer-wide fields (and is what the per-label entries
	// fall back to). Nothing here applies without series ends AND without
	// facets, which is when `selectionControlsApply` is false.
	const selectionControlsApply = !noSeriesEndpoints || isFaceted
	// Whether the "Label selection" subsection has anything to show — the
	// union of its children's own gates (flow "Which labels", the per-label
	// selection block, map leader lines). An unfaceted sunburst has none, so
	// the subsection is skipped rather than rendered empty.
	const labelSelectionHasContent =
		Boolean(flowGeometry) || selectionControlsApply || isGeoMode
	const labelSelectionChanged = (key: string): boolean =>
		merged.fieldLabelPoints?.[key] != null ||
		merged.fieldLabelPointsScope?.[key] != null ||
		merged.fieldFacetKeys?.[key] != null
	const labelSelectionControls = (key: string | null) => (
		<>
			{!noSeriesEndpoints && (
				<>
					<SelectInput
						label="Which labels"
						labelClassName={LABEL_COL}
						value={
							key === null
								? effectiveLabelPoints(merged)
								: fieldLabelPointsMode(merged, key)
						}
						options={whichLabelsOptionsFor(key)}
						onChange={(mode: LabelPointsMode) =>
							key === null
								? updateCfg({ labelPoints: mode })
								: setFieldLabelPoints(key, mode)
						}
					/>
					{showScopeFor(key) && (
						<>
							<SelectInput
								label="Of each"
								labelClassName={LABEL_COL}
								value={effectiveScopeFor(key)}
								options={scopeOptions}
								onChange={(scope: LabelPointsScope) =>
									key === null
										? updateCfg({ labelPointsScope: scope })
										: setLabelScope(key, scope)
								}
							/>
							<p className="vc-help">
								{SCOPE_HELP[scopeFamily ?? "bars"][effectiveScopeFor(key)]}
							</p>
						</>
					)}
				</>
			)}
			{/* Faceted charts only: which panels draw this label. Checked (the
			 *  default, stored as null) = every panel; unchecking lists the
			 *  facets so the user ticks the ones that keep it. Hidden — and
			 *  ignored by the renderer — when not faceted. */}
			{isFaceted && (
				<FacetScopeControl
					label="Apply to all facets"
					facetKeys={
						key === null ? merged.facetKeys : labelFacetKeysFor(merged, key)
					}
					facetOptions={facetOptions}
					onChange={(next) =>
						key === null
							? updateCfg({ facetKeys: next })
							: setLabelFacetKeys(key, next)
					}
				/>
			)}
		</>
	)

	// Multi-field label variables: the Size / Text / Box
	// panels add one block per variable when there are two or
	// more (one variable has nothing to differ from). Same gate as the Color
	// panel's per-variable slots.
	// The label KEYS the per-label sections iterate (`labelKeysFor`): one
	// per composed label (the text boxes under Value → Compose labels),
	// titled by its variables ("A", "A + B"). Two or more labels → every
	// section splits per label; a lone label uses the layer-wide controls
	// (the layer reads its own entries first, then the layer's).
	const labelKeys = labelKeysFor(merged, encodings.value)
	const multiFields = labelKeys.keys
	const labelTitles = labelKeys.titles
	const perVariable = multiFields.length > 1
	// A LONE composed label's bar Placement is its own entry — read over the
	// layer-wide pair, written in place of it — as its Label selection
	// already is: the renderer honors a label's entry first, and a checked
	// Bar total arrives with one. The single-field label (`null`) keeps the
	// layer-wide pair.
	const loneLabelKey =
		encodings.value.multiField === true && multiFields.length === 1
			? (multiFields[0] ?? null)
			: null
	const primaryPlacement: FieldBarPlacement =
		loneLabelKey === null
			? {}
			: (merged.fieldBarPlacements?.[loneLabelKey] ?? {})
	const primaryPosition =
		primaryPlacement.position ?? merged.barLabelPosition ?? "center"
	const primarySide = primaryPlacement.side ?? merged.barLabelSide ?? "center"
	const setPrimaryPlacement = (p: FieldBarPlacement) =>
		loneLabelKey === null
			? updateCfg({
					...(p.position ? { barLabelPosition: p.position } : {}),
					...(p.side ? { barLabelSide: p.side } : {}),
				})
			: updateCfg({
					fieldBarPlacements: {
						...(merged.fieldBarPlacements ?? {}),
						[loneLabelKey]: { ...primaryPlacement, ...p },
					},
				})
	// Same for a lone composed label's Angle / R pair on a pie: its own
	// entry over the layer-wide pair, written in place of it.
	const primaryPolar: FieldPolarPlacement =
		loneLabelKey === null
			? {}
			: (merged.fieldPolarPlacements?.[loneLabelKey] ?? {})
	const primaryPolarAngle = primaryPolar.angle ?? merged.polarLabelAngle ?? 0
	const primaryPolarRadius =
		primaryPolar.radius ?? merged.polarLabelRadius ?? 100
	const setPrimaryPolar = (p: FieldPolarPlacement) =>
		loneLabelKey === null
			? updateCfg({
					...(p.angle !== undefined ? { polarLabelAngle: p.angle } : {}),
					...(p.radius !== undefined ? { polarLabelRadius: p.radius } : {}),
				})
			: updateCfg({
					fieldPolarPlacements: {
						...(merged.fieldPolarPlacements ?? {}),
						[loneLabelKey]: { ...primaryPolar, ...p },
					},
				})
	const sideLocksAlignment = sideLocksAlignmentFor(loneLabelKey)
	// The primary label's combo layer: a lone composed label keys by its id,
	// the single-field label by its value field (the renderer's rule).
	const primaryLayerKey =
		loneLabelKey ??
		encodings.value.field ??
		encodings.x.field ??
		encodings.y.field ??
		null
	const primaryLayerFields =
		loneLabelKey !== null
			? (labelKeys.pieces[loneLabelKey] ?? [])
			: primaryLayerKey !== null
				? [primaryLayerKey]
				: []
	const primaryOnMarks =
		isComboMode && layerFor(primaryLayerKey, primaryLayerFields) === "marks"
	const layerControl = (key: string, fields: ReadonlyArray<string>) => (
		<div className="flex items-center gap-2 text-sm">
			<span className={LABEL_COL}>Show on</span>
			<Segmented
				ariaLabel="Show labels on"
				value={layerFor(key, fields)}
				segments={[
					{ key: "bars", label: "Bars" },
					{ key: "marks", label: marksLayerName },
				]}
				onChange={(layer) =>
					updateCfg({
						fieldLayers: { ...(merged.fieldLayers ?? {}), [key]: layer },
					})
				}
			/>
		</div>
	)
	// "Split into individual variables": a label naming two or more
	// variables can style each one separately under Color / Size / Text
	// properties — a bold series name beside an unbolded value, a value
	// coloured by sign inside an otherwise black label. The label still
	// POSITIONS as one; only these three sections expand.
	const labelPieces = labelKeys.pieces
	const splittable = (key: string) => (labelPieces[key]?.length ?? 0) > 1
	// A LONE combined label takes the per-label block too (Color always
	// showed one) — otherwise its split toggle would have nowhere to live.
	const styleFields =
		perVariable || (multiFields.length === 1 && splittable(multiFields[0]))
			? multiFields
			: []
	/** The keys one label's controls write to in a section: its pieces when
	 *  that section is split, else the label itself. */
	const sectionKeys = (section: LabelPieceSection) => (key: string) =>
		sectionKeysFor(merged, key, labelPieces[key] ?? [], section)
	const setPieceSplit = (
		key: string,
		section: LabelPieceSection,
		next: boolean
	) =>
		updateCfg({
			pieceSplits: {
				...(merged.pieceSplits ?? {}),
				[key]: { ...(merged.pieceSplits?.[key] ?? {}), [section]: next },
			},
		})
	/** The toggle a section renders above one label's controls — nothing for
	 *  a label with a single variable (it IS the whole label). */
	const splitToggleFor = (section: LabelPieceSection) => (key: string) =>
		splittable(key) ? (
			<Checkbox
				label="Split into individual variables"
				checked={labelPieceSplit(merged, key, section)}
				onChange={(next) => setPieceSplit(key, section, next)}
			/>
		) : null
	// Per-label Adjust-position subsections, or the layer-wide controls.
	const ownLabelKeys = perVariable ? multiFields : []
	const primaryLabel = !perVariable
	// A label keyed by a variable's name (the default `{A}` label) has that
	// variable's value to compare rules against; a hand-added label (a
	// combination) has no single value — its rules compare against the
	// layer's backing value.
	const comboIds = new Set(
		multiFields.filter((k) => !(encodings.value.fields ?? []).includes(k))
	)
	// "Changed" dot for the Position and alignment subsection —
	// lights when ANY control inside deviates from its default. Mode-gated
	// values (polar nudges, bar position, endpoint overrides) only count when
	// their controls are visible: a stored deviation the current panel can't
	// clear must not light the dot.
	const endpointPositionEdited = (o: EndpointLabelOverrides | undefined) =>
		o?.alignment != null || o?.xOffset != null || o?.yOffset != null
	// Separate variables: the layer-wide alignment / angle / wrap / overlap /
	// nudge / bar-placement controls hide (each variable has its own), so
	// only the per-variable entries count there.
	const anyOwn = (map: Record<string, unknown> | undefined) =>
		ownLabelKeys.some((k) => map?.[k] != null)
	const positionChanged =
		anyOwn(merged.fieldAlignments) ||
		anyOwn(merged.fieldLayouts) ||
		anyOwn(merged.fieldOffsets) ||
		(isBarMode && anyOwn(merged.fieldBarPlacements)) ||
		(isComboMode &&
			(anyOwn(merged.fieldLayers) ||
				(primaryLabel &&
					primaryLayerKey !== null &&
					merged.fieldLayers?.[primaryLayerKey] != null))) ||
		(primaryLabel &&
			((!sideLocksAlignment && (merged.alignment ?? "center") !== "center") ||
				(merged.textAngle ?? 0) !== 0 ||
				merged.wrapText === true ||
				merged.avoidOverlaps === true ||
				merged.xOffset !== 0 ||
				merged.yOffset !== 0 ||
				(isBarMode && !primaryOnMarks && primaryPosition !== "center") ||
				(isBarMode && !primaryOnMarks && primarySide !== "center"))) ||
		ownLabelKeys.some(
			(k) => (merged.fieldPositionRules?.[k]?.length ?? 0) > 0
		) ||
		(primaryLabel && (merged.positionRules ?? []).length > 0) ||
		(isAreaMode && (merged.areaLabelPosition ?? "edge") !== "edge") ||
		(isPolarMode && anyOwn(merged.fieldPolarPlacements)) ||
		(isPolarMode &&
			primaryLabel &&
			(primaryPolarAngle !== 0 || primaryPolarRadius !== 100)) ||
		(isRingLabels &&
			((merged.polarLabelAngle ?? 0) !== 0 ||
				(merged.ringLabelRadius ?? 50) !== 50)) ||
		(splitEndpoints &&
			((selection.present.first && endpointPositionEdited(merged.firstLabel)) ||
				(selection.present.last && endpointPositionEdited(merged.lastLabel))))

	// Sibling subsection dots, same model: any visible control non-default.
	// (The labelPoints select is hidden — and inert — in geo modes, so a
	// stored deviation must not light the dot there. Leader lines are
	// geo-only: the color/thickness inputs are gated behind the toggle, so
	// the toggle alone decides their contribution — like Text Background.)
	const selectionChanged =
		(flowGeometry !== undefined &&
			effectiveFlowLabelNodes(merged.flowLabelNodes, flowGeometry) !== "all") ||
		selection.present.first ||
		selection.present.last ||
		(isFaceted &&
			(merged.facetKeys != null ||
				multiFields.some((k) => merged.fieldFacetKeys?.[k] != null))) ||
		(isGeoMode && merged.leaderLines === true)
	const textPositionChanged = (merged.arcWrapLevels ?? []).length > 0
	// Text Properties compares against the THEME's data-label defaults — the
	// same baseline the panel's reset links restore. With per-variable
	// blocks (which replace the layer-wide controls) any variable's own
	// entry lights it.
	const textPropertiesChanged = styleFields.length > 0
		? styleFields.some((k) =>
				sectionKeys("text")(k).some(
					(kk) =>
						Object.keys(labelEntry(merged, "fieldFonts", kk) ?? {}).length > 0
				)
			)
		: merged.fontFamily !== themeDefaults.fontFamily ||
			merged.fontWeight !== themeDefaults.fontWeight ||
			(merged.italic ?? false) !== (themeDefaults.italic ?? false) ||
			(merged.underline ?? false) !== (themeDefaults.underline ?? false)
	// Every other background control is gated behind the toggle, so the
	// toggle alone decides the dot (stored-but-hidden values don't count);
	// per-variable blocks light it when any variable's background is on.
	const textBackgroundChanged = perVariable
		? multiFields.some(
				(f) =>
					(merged.fieldBackgrounds?.[f]?.textBackground ??
						merged.textBackground) === true
			)
		: merged.textBackground === true

	// Coloring labels BY a categorical variable starts from the theme's
	// designated TEXT palette rather than the chart's mark palette: these are
	// words on the canvas, and the mark palette's lighter slots don't survive
	// at text size. Only seeds when no palette has been picked for this
	// layer — a palette already chosen (including "Match chart colors") is
	// the user's, and re-mapping Color never overwrites it. The dropdown
	// below re-picks, "Match chart colors" included.
	const seedTextPalette = () => {
		const seeded = seedLabelTextPalette(merged, theme)
		if (seeded) updateCfg(seeded)
	}

	const setField = (channel: DataLabelsChannel, fieldName: string) => {
		// Reserved option values = the hierarchy-derived sources. Writing
		// the slot fresh clears the other member (field ↔ measureSource
		// mutual exclusivity, like the main shelf).
		const derived = packedSourceForOptionValue(fieldName)
		if (derived) {
			setEncodings((prev) => ({
				...prev,
				[channel]: { field: null, measureSource: derived },
			}))
			// "Top-level group" names are categorical; "Nesting depth" is
			// ordinal and keeps its ordered ramp.
			if (channel === "hue" && derived === "rootGroup") seedTextPalette()
			return
		}
		const newField = fieldName === "" ? null : fieldName
		if (
			channel === "hue" &&
			newField !== null &&
			dataset &&
			effectiveType(dataset, newField, overrides) === "categorical"
		) {
			seedTextPalette()
		}
		// Position rows inherit the chart's mapping when unset, so "— none —"
		// there is recorded as `none` — an unset slot would inherit again.
		const isPosition = (DATA_LABEL_POSITION_CHANNELS as readonly string[]).includes(
			channel,
		)
		setEncodings((prev) => ({
			...prev,
			[channel]:
				isPosition && newField === null
					? { field: null, none: true }
					: { field: newField },
		}))
	}

	// The Value row is special: besides picking a single field it can switch
	// into multi-field mode (the "Multiple variables…" sentinel), which keeps
	// `value.field` null and drives the label off `value.fields` + template.
	const setValueField = (v: string) => {
		if (v === DATA_LABELS_MULTI_VALUE) {
			// Flows and trees label their nodes by name by default: an empty
			// checklist begins with the name column, as if the user had
			// checked it.
			if (
				defaultValueField &&
				(encodings.value.fields ?? []).length === 0
			) {
				setValueFields([defaultValueField])
				return
			}
			setEncodings((prev) => ({
				...prev,
				value: { field: null, multiField: true, fields: prev.value?.fields ?? [] },
			}))
			return
		}
		// On bars, a Value with no value-axis position sits each label on
		// its bar: the position takes the Length variable (lib).
		setEncodings((prev) =>
			withBarLabelPosition(
				{
					...prev,
					value: {
						field: v === "" ? null : v,
						multiField: false,
						fields: prev.value?.fields ?? [],
						// Flows and trees: "— none —" is a deliberate "no labels",
						// distinct from the unset default (the node names).
						...(defaultValueField && v === "" ? { none: true } : {}),
					},
				},
				chartEncodings
			)
		)
		// A total reads as the bar's once per bar, past its end: a fresh Bar
		// total starts on the last layer of each stack, outside its end —
		// movable like any label.
		if (barTotalName !== null && v === barTotalName) updateCfg(BAR_TOTAL_SEED)
	}
	const setValueFields = (fields: string[]) => {
		const prev = encodings.value.fields ?? []
		setEncodings((p) =>
			withBarLabelPosition(
				{ ...p, value: { field: null, multiField: true, fields } },
				chartEncodings
			)
		)
		// The labels follow the checklist (and a newly checked Bar total seeds
		// its placement): see `valueFieldsPatch`. This persists the list on
		// the first change, legacy-derived or not.
		updateCfg(valueFieldsPatch(merged, prev, fields, barTotalName))
	}

	const allEligible = dataset?.fields ?? []
	// The flow's source / target / weight columns — the same resolution the
	// renderers use (full data set).
	const flowEndpoints = useMemo(
		() =>
			isFlowMode && dataset
				? resolveFlowEndpoints(chartEncodings, chartConfigs.connection, dataset)
				: null,
		[isFlowMode, dataset, chartEncodings, chartConfigs.connection]
	)
	// Flow diagrams: an unset Value is the source column (the node names),
	// shown selected so its Label format is right there; "— none —" is the
	// explicit `none` (no node labels).
	const flowSourceField = flowEndpoints?.sourceField ?? null
	// The target and weight columns only repeat the names / Flow out on a
	// node, so the Value and Size lists leave them out (unless picked).
	const flowRedundant = flowEndpoints
		? flowRedundantLabelFields(flowEndpoints, [
				encodings.value.field,
				encodings.size.field,
				...(encodings.value.fields ?? []),
			])
		: new Set<string>()
	const labelTextEligible = allEligible.filter((f) => !flowRedundant.has(f.name))
	// Tree layouts (packed circles / treemap / sunburst) likewise: an unset
	// Value is the column that names the nodes — the id column when the
	// tree nests by id, else the connection column (see
	// `lib/hierarchyLabels.ts`, which the renderers use too).
	const treeNameField = useMemo(() => {
		if (!isTreeMode || !dataset) return null
		const parentField = chartEncodings.connection?.field ?? null
		if (!parentField) return null
		const idField = resolveHierarchyIdField(
			chartConfigs.connection?.hierarchyIdField ?? null,
			dataset.rows,
			dataset.fields.map((f) => f.name),
			parentField,
			chartEncodings.area?.field ?? null
		)
		return hierarchyNameField(parentField, idField)
	}, [isTreeMode, dataset, chartEncodings, chartConfigs.connection])
	/** What an unset Value shows: the node names on flows and trees. */
	const defaultValueField = isFlowMode
		? flowSourceField
		: isTreeMode
			? treeNameField
			: null
	const valueFieldShown: string | null =
		encodings.value.field ??
		(!encodings.value.multiField && encodings.value.none !== true
			? defaultValueField
			: null)
	// Flow-only values (Flow in / Flow out / Node total) listed with the
	// dataset's variables under Value and Size; a column already using one
	// of the names keeps it.
	const flowFieldOptions = isFlowMode
		? flowLabelFieldNames(allEligible.map((f) => f.name)).map((name) => ({
				value: name,
				label: name,
			}))
		: []
	// Chord nodes usually both send and receive, which makes Senders,
	// Receivers and All nodes the same set — said in a hint so the select
	// doesn't look broken. Over the full data set (the sankey breaks cycles
	// per panel, but the ring draws every edge).
	const flowSameSet = useMemo(() => {
		if (flowGeometry !== "ring" || !dataset || !flowEndpoints) return false
		const { sourceField, targetField, valueField } = flowEndpoints
		if (!sourceField || !targetField || !valueField) return false
		const { nodes, edges } = buildFlowGraph(dataset.rows, {
			sourceField,
			targetField,
			valueField,
		})
		return everyNodeSendsAndReceives(flowNodeTotals(nodes, edges))
	}, [flowGeometry, dataset, flowEndpoints])
	const tileXEligible = chartXField
		? allEligible.filter((f) => f.name === chartXField)
		: []
	const tileYEligible = chartYField
		? allEligible.filter((f) => f.name === chartYField)
		: []
	const xEligible = positionLocked ? tileXEligible : allEligible
	const yEligible = positionLocked ? tileYEligible : allEligible

	// Derived options for the Color / Size dropdowns — tree layouts with a
	// mapped connection only (a flat pack is uniformly depth 1, and there
	// are no groups to derive). Size offers depth only: group names are
	// categorical, and a font size needs an ordered value.
	const connectionMapped = !!chartEncodings.connection?.field
	const labelDerivedHueOptions =
		isTreeMode && connectionMapped
			? [
					{
						value: PACKED_MEASURE_OPTION_VALUE.rootGroup,
						label: PACKED_DERIVED_LABELS.rootGroup,
					},
					{
						value: PACKED_MEASURE_OPTION_VALUE.depth,
						label: PACKED_DERIVED_LABELS.depth,
					},
				]
			: []
	const labelDerivedSizeOptions =
		isTreeMode && connectionMapped
			? [
					{
						value: PACKED_MEASURE_OPTION_VALUE.depth,
						label: PACKED_DERIVED_LABELS.depth,
					},
				]
			: []
	// Override-swatch values for a derived Color: group names / depth
	// levels from the same tree the renderer builds (id column resolved
	// identically), so the swatch list matches the drawn labels.
	const derivedHueValues = (() => {
		if (!hueSource || !dataset || !isTreeMode) return undefined
		const parentField = chartEncodings.connection?.field ?? null
		if (!parentField) return undefined
		const areaField = chartEncodings.area?.field ?? null
		const idField = resolveHierarchyIdField(
			chartConfigs.connection?.hierarchyIdField ?? null,
			dataset.rows,
			dataset.fields.map((f) => f.name),
			parentField,
			areaField
		)
		return hueSource === "rootGroup"
			? topLevelGroupNames(dataset.rows, parentField, idField, areaField)
			: hierarchyDepthLevels(dataset.rows, parentField, idField, areaField)
	})()

	// Packed circles' "Wrap label around" checkboxes: one per CONTAINER depth
	// (levels that draw grouping circles — every hierarchy level except the
	// deepest, which is all leaves). Derived from the same tree the renderer
	// builds so the checkbox list tracks the drawn nesting.
	const hasContainerRimLabels = modeDef.labels.containerRimLabels
	const containerWrapLevels = (() => {
		if (!hasContainerRimLabels || !dataset) return []
		const parentField = chartEncodings.connection?.field ?? null
		if (!parentField) return []
		const areaField = chartEncodings.area?.field ?? null
		const idField = resolveHierarchyIdField(
			chartConfigs.connection?.hierarchyIdField ?? null,
			dataset.rows,
			dataset.fields.map((f) => f.name),
			parentField,
			areaField
		)
		return hierarchyDepthLevels(dataset.rows, parentField, idField, areaField)
			.slice(0, -1)
			.map(Number)
			.filter((n) => Number.isFinite(n))
	})()
	// Shown (inside Position and alignment) only with levels to wrap.
	const showWrapLevels = hasContainerRimLabels && containerWrapLevels.length > 0

	return (
		<div className="flex flex-col gap-2">

			{/* Channel mapping rows lead the panel and sit OUTSIDE the purple
			 *  box — choosing what each label encodes (position, value, color,
			 *  size) is the primary action and reads as its own list; the
			 *  selection / overlap / position fine-tuning lives in the purple
			 *  group below. */}

			{/* Maps anchor labels to REGIONS — one Geography row replaces the
			 *  cartesian X/Y rows. Its field joins to map regions at its own
			 *  auto-detected level, independent of the map's region field, so
			 *  a county map can carry state-level labels.
			 *  Pies position labels in polar terms — one Angle row replaces
			 *  the cartesian X/Y rows (there is no R row: labels sit at the
			 *  wedge midpoint and the R% nudge under "Adjust position" moves
			 *  them radially). */}
			{isTreeMode ? null : isGeoMode ? (
				<DataLabelChannelRow
					channel="geography"
					label={CHANNEL_LABEL.geography}
					value={encodings.geography?.field ?? null}
					onChange={(v) => setField("geography", v)}
					eligible={allEligible}
				/>
			) : isPolarMode ? (
				<DataLabelChannelRow
					channel="angle"
					label={CHANNEL_LABEL.angle}
					value={encodings.angle.field}
					onChange={(v) => setField("angle", v)}
					eligible={allEligible}
				/>
			) : (
				<>
					<DataLabelChannelRow
						channel="x"
						label={CHANNEL_LABEL.x}
						value={encodings.x.field}
						onChange={(v) => setField("x", v)}
						eligible={xEligible}
						disabled={isFlowMode}
					/>

					<DataLabelChannelRow
						channel="y"
						label={CHANNEL_LABEL.y}
						value={encodings.y.field}
						onChange={(v) => setField("y", v)}
						eligible={yEligible}
						disabled={isFlowMode}
					/>
				</>
			)}

			<DataLabelChannelRow
				channel="value"
				label={CHANNEL_LABEL.value}
				value={
					encodings.value.multiField ? DATA_LABELS_MULTI_VALUE : valueFieldShown
				}
				onChange={setValueField}
				eligible={labelTextEligible}
				derivedOptions={[...flowFieldOptions, ...barTotalOptions]}
				extraOptions={[
					{ value: DATA_LABELS_MULTI_VALUE, label: "Multiple variables…" },
				]}
			>
				{/* Multi-field mode gets the full arrangement panel; a mapped
				 *  single field gets just its Label format (same per-field
				 *  spec store, so a format survives switching modes). Unmapped
				 *  single mode still has nothing to configure — `null` (not
				 *  `false`) keeps that row chevron-less. */}
				{encodings.value.multiField ? (
					<ValuePanel
						cfg={merged}
						onChange={updateCfg}
						fields={encodings.value.fields ?? []}
						allFields={[
							...labelTextEligible.map((f) => f.name),
							...flowFieldOptions.map((o) => o.value),
							...barTotalOptions.map((o) => o.value),
						]}
						onFieldsChange={setValueFields}
						countryNames={countryNameFormats}
					/>
				) : valueFieldShown ? (
					<SingleValuePanel
						field={valueFieldShown}
						cfg={merged}
						onChange={updateCfg}
						countryNames={countryNameFormats}
					/>
				) : null}
			</DataLabelChannelRow>

			<DataLabelChannelRow
				channel="hue"
				label={CHANNEL_LABEL.hue}
				value={
					hueSource
						? PACKED_MEASURE_OPTION_VALUE[hueSource]
						: encodings.hue.field
				}
				onChange={(v) => setField("hue", v)}
				eligible={allEligible}
				derivedOptions={labelDerivedHueOptions}
			>
				<LabelColorPanel
					cfg={merged}
					onChange={updateCfg}
					hueField={hueField}
					hueFieldType={hueFieldType}
					dataset={dataset}
					chartConfigs={chartConfigs}
					valuesOverride={derivedHueValues}
					multiFields={multiFields}
					titles={labelTitles}
					splitToggle={splitToggleFor("color")}
					keysFor={sectionKeys("color")}
				/>
			</DataLabelChannelRow>

			<DataLabelChannelRow
				channel="size"
				label={CHANNEL_LABEL.size}
				value={
					sizeByDepth
						? PACKED_MEASURE_OPTION_VALUE.depth
						: encodings.size.field
				}
				onChange={(v) => setField("size", v)}
				eligible={labelTextEligible}
				derivedOptions={[...labelDerivedSizeOptions, ...flowFieldOptions]}
			>
				<SizePanel
					cfg={merged}
					onChange={updateCfg}
					themeDefaults={themeDefaults}
					sizeMapped={sizeByDepth || Boolean(encodings.size.field)}
					multiFields={styleFields}
					titles={labelTitles}
					splitToggle={splitToggleFor("size")}
					keysFor={sectionKeys("size")}
				/>
			</DataLabelChannelRow>

			{/* One purple panel wraps the layer-wide fine-tuning so it reads as
			 *  a single group, distinct from the per-channel mappings above. */}
			<div className="vc-option-panel">
			{/* Layer-wide selection: which labels to keep (and, on faceted
			 *  charts / maps, where). Grouped under their own subsection so
			 *  they read as a distinct concern from the per-channel mappings
			 *  above. Overlap avoidance lives with the other placement knobs
			 *  under "Position and alignment". */}
			{/* Selection / overlap / position controls act on the shared label
			 *  layer's positioned labels — inert for the self-drawn treemap
			 *  labels, so they stand down there (as does Text Background,
			 *  which that renderer doesn't draw). Packed circles and the
			 *  sunburst render through the layer, so they keep them. */}
			{fineTuningApplies && (
			<>
			{labelSelectionHasContent && (
			<CollapsibleSubsection
				title="Label selection"
				changed={selectionChanged}
			>
				<div className="flex flex-col gap-2">
				{/* One block per composed label: which anchors it draws at
				 *  ("Which labels" + the "Of each" unit its series ends run
				 *  over) and which facet panels it draws on. Each label keeps
				 *  its own — the `{value}` label can sit on the last bar of
				 *  every STACK across all panels while a `{series}` label sits
				 *  on the last bar of each SERIES in one panel only. A lone
				 *  composed label skips the subheader (nothing to tell apart);
				 *  a single-field mapping writes the layer-wide fields.
				 *  Per-series endpoints are meaningless on a map or a sunburst
				 *  (no series) — the renderer skips them there, so only the
				 *  facet scope shows. */}
				{/* Flow diagrams: which NODES get a label, by flow direction —
				 *  one choice for every label (nodes have no series to rank). */}
				{flowGeometry && (
					<>
						<SelectInput
							label="Which labels"
							labelClassName={LABEL_COL}
							value={effectiveFlowLabelNodes(
								merged.flowLabelNodes,
								flowGeometry
							)}
							options={flowLabelNodeOptions(flowGeometry)}
							onChange={(mode: FlowLabelNodes) =>
								updateCfg({ flowLabelNodes: mode })
							}
						/>
						<p className="vc-help">
							{flowGeometry === "columns"
								? "First senders have no incoming flow; last receivers have no outgoing flow."
								: flowSameSet
									? "Every node here both sends and receives, so these options label the same nodes."
									: "Senders have outgoing flow; receivers have incoming flow."}
						</p>
					</>
				)}
				{!selectionControlsApply ? null : encodings.value.multiField ? (
					multiFields.length === 0 ? null : perVariable ? (
						multiFields.map((key) => (
							<CollapsibleSubsection
								key={key}
								title={labelTitles[key] ?? key}
								changed={labelSelectionChanged(key)}
							>
								{labelSelectionControls(key)}
							</CollapsibleSubsection>
						))
					) : (
						// A lone composed label: the controls bound to its key.
						labelSelectionControls(multiFields[0])
					)
				) : (
					labelSelectionControls(null)
				)}
				{/* Maps only: leader lines connect a displaced label (offset or
				 *  overlap-nudged) back to its region's centroid. Defaults come
				 *  from the theme's Maps section. */}
				{isGeoMode && (
					<>
						<Checkbox
							label="Show leader lines"
							checked={merged.leaderLines === true}
							onChange={(leaderLines) => updateCfg({ leaderLines })}
						/>
						{merged.leaderLines === true && (
							<>
								<div className="ml-6 flex flex-col gap-2 text-sm">
									{/* Reset links restore the THEME's Maps-section stroke
									 *  (the same baseline new charts seed from). */}
									<div className="flex flex-wrap items-center gap-2">
										<ColorInput
											label="Line color"
											labelClassName={LABEL_COL_NESTED}
											value={
												merged.leaderLineColor ??
												themeDefaults.leaderLineColor ??
												"#999999"
											}
											onChange={(leaderLineColor) =>
												updateCfg({ leaderLineColor })
											}
										/>
										{merged.leaderLineColor !==
											themeDefaults.leaderLineColor && (
											<ResetLink
												onClick={() =>
													updateCfg({
														leaderLineColor: themeDefaults.leaderLineColor,
													})
												}
											/>
										)}
									</div>
									<div className="flex items-center gap-2">
										<NumberInput
											label="Thickness"
											labelClassName={LABEL_COL_NESTED}
											value={merged.leaderLineWidth ?? 1}
											min={0}
											step={0.5}
											onChange={(leaderLineWidth) =>
												updateCfg({ leaderLineWidth })
											}
											inputClassName="w-16"
											suffix="px"
										/>
										{merged.leaderLineWidth !==
											themeDefaults.leaderLineWidth && (
											<ResetLink
												onClick={() =>
													updateCfg({
														leaderLineWidth: themeDefaults.leaderLineWidth,
													})
												}
											/>
										)}
									</div>
								</div>
							</>
						)}
					</>
				)}
				</div>
			</CollapsibleSubsection>
			)}

			<CollapsibleSubsection
				title="Position and alignment"
				changed={positionChanged || (showWrapLevels && textPositionChanged)}
			>
				<div className="flex flex-col gap-2">
				{/* Packed circles only: per-container-level choice between the
				 *  default inside-the-rim placement and wrapping the group name
				 *  around the OUTSIDE of the circle on an arc. Leads the section:
				 *  it decides where a container's label sits at all, before any
				 *  alignment or nudge applies. */}
				{showWrapLevels && (
					<>
						<TextPositionPanel
							cfg={merged}
							onChange={updateCfg}
							levels={containerWrapLevels}
						/>
						<hr className="border-stone-200 dark:border-stone-700" />
					</>
				)}
				{/* Separate labels (Combine variables unchecked): every variable is
				 *  its own label, so each gets its OWN subsection holding the
				 *  whole set — alignment, angle, wrapping, overlap avoidance, bar
				 *  placement, and the X / Y nudge. Effective values shown (the
				 *  variable's entry, else the layer's); writes go to the
				 *  variable's entry. The layer-wide controls below hide in this
				 *  mode; position rules stay layer-wide (they key on values). */}
				{ownLabelKeys.map((name) => {
						const ownLayout = merged.fieldLayouts?.[name] ?? {}
						const ownOffsets = merged.fieldOffsets?.[name] ?? {}
						const ownPlacement = merged.fieldBarPlacements?.[name] ?? {}
						const ownPolar = merged.fieldPolarPlacements?.[name] ?? {}
						const ownAlignment = merged.fieldAlignments?.[name]
						const patchLayout = (p: FieldLabelLayout) =>
							updateCfg({
								fieldLayouts: {
									...(merged.fieldLayouts ?? {}),
									[name]: { ...ownLayout, ...p },
								},
							})
						const patchOffsets = (p: { xOffset?: number; yOffset?: number }) =>
							updateCfg({
								fieldOffsets: {
									...(merged.fieldOffsets ?? {}),
									[name]: { ...ownOffsets, ...p },
								},
							})
						const patchPlacement = (p: FieldBarPlacement) =>
							updateCfg({
								fieldBarPlacements: {
									...(merged.fieldBarPlacements ?? {}),
									[name]: { ...ownPlacement, ...p },
								},
							})
						const patchPolar = (p: FieldPolarPlacement) =>
							updateCfg({
								fieldPolarPlacements: {
									...(merged.fieldPolarPlacements ?? {}),
									[name]: { ...ownPolar, ...p },
								},
							})
						const polarAngle = ownPolar.angle ?? merged.polarLabelAngle ?? 0
						const polarRadius = ownPolar.radius ?? merged.polarLabelRadius ?? 100
						const angle = ownLayout.textAngle ?? merged.textAngle ?? 0
						const wrap = ownLayout.wrapText ?? merged.wrapText === true
						const avoid =
							ownLayout.avoidOverlaps ?? merged.avoidOverlaps === true
						const ownRules = merged.fieldPositionRules?.[name] ?? []
						const setRules = (next: LabelPositionRule[]) => {
							const all = { ...(merged.fieldPositionRules ?? {}) }
							if (next.length === 0) delete all[name]
							else all[name] = next
							updateCfg({ fieldPositionRules: all })
						}
						const ownOnMarks =
							isComboMode && layerFor(name, labelKeys.pieces[name] ?? []) === "marks"
						const changed =
							ownAlignment != null ||
							Object.keys(ownLayout).length > 0 ||
							ownOffsets.xOffset != null ||
							ownOffsets.yOffset != null ||
							ownRules.length > 0 ||
							(isComboMode && merged.fieldLayers?.[name] != null) ||
							(isBarMode && !ownOnMarks && Object.keys(ownPlacement).length > 0) ||
							(isPolarMode && Object.keys(ownPolar).length > 0)
						const measureSelect = (
							<SelectInput
								label={isVerticalBars ? "Vertical" : "Horizontal"}
								labelClassName={LABEL_COL}
								value={
									ownPlacement.position ?? merged.barLabelPosition ?? "center"
								}
								options={BAR_POSITION_OPTIONS}
								onChange={(position) => patchPlacement({ position })}
							/>
						)
						const sideSelect = (
							<SelectInput
								label={isVerticalBars ? "Horizontal" : "Vertical"}
								labelClassName={LABEL_COL}
								value={ownPlacement.side ?? merged.barLabelSide ?? "center"}
								options={barSideOptions(isVerticalBars)}
								onChange={(side) => patchPlacement({ side })}
							/>
						)
						return (
							<CollapsibleSubsection
								key={name}
								title={labelTitles[name] ?? name}
								changed={changed}
							>
								{isComboMode && layerControl(name, labelKeys.pieces[name] ?? [])}
								{/* Beside a vertical bar the side sets the alignment. */}
								{!sideLocksAlignmentFor(name) && (
									<div className="flex items-center gap-2 text-sm">
										<span className={LABEL_COL}>Align</span>
										<AlignmentControl
											outward={isPolarMode || isRingLabels}
											value={ownAlignment ?? merged.alignment ?? "center"}
											onChange={(alignment) =>
												updateCfg({
													fieldAlignments: {
														...(merged.fieldAlignments ?? {}),
														[name]: alignment,
													},
												})
											}
										/>
									</div>
								)}
								<div className="flex items-center gap-2">
									<NumberInput
										label="Angle"
										labelClassName={LABEL_COL}
										value={angle}
										min={-90}
										max={90}
										step={1}
										clamp
										onChange={(textAngle) => patchLayout({ textAngle })}
										inputClassName="w-16"
										suffix="°"
									/>
									{angle !== 0 && (
										<ResetLink onClick={() => patchLayout({ textAngle: 0 })} />
									)}
								</div>
								<Checkbox
									label="Wrap text"
									checked={wrap}
									onChange={(wrapText) => patchLayout({ wrapText })}
								/>
								{wrap && (
									<div className="ml-6 flex items-center gap-2 text-sm">
										<NumberInput
											label="Characters"
											labelClassName={LABEL_COL_NESTED}
											value={ownLayout.wrapMaxChars ?? merged.wrapMaxChars ?? DEFAULT_WRAP_CHARS}
											min={1}
											step={1}
											onChange={(wrapMaxChars) => patchLayout({ wrapMaxChars })}
											inputClassName="w-16"
										/>
										{(ownLayout.wrapMaxChars ?? merged.wrapMaxChars ?? DEFAULT_WRAP_CHARS) !==
											DEFAULT_WRAP_CHARS && (
											<ResetLink
												onClick={() => patchLayout({ wrapMaxChars: DEFAULT_WRAP_CHARS })}
											/>
										)}
									</div>
								)}
								<Checkbox
									label="Avoid overlapping labels"
									checked={avoid}
									onChange={(avoidOverlaps) => patchLayout({ avoidOverlaps })}
								/>
								{isBarMode && !ownOnMarks && (
									<div className="vc-divider-group">
										<span className="vc-group-header">Placement</span>
										{isVerticalBars ? measureSelect : sideSelect}
										{isVerticalBars ? sideSelect : measureSelect}
									</div>
								)}
								<div className="vc-divider-group">
									<span className="vc-group-header">Adjust position</span>
									{/* On a pie each variable has its own Angle / R, above the
									 *  X / Y nudge as in the layer-wide group: the radius is
									 *  what puts the name at the rim and the value in the wedge
									 *  (a pixel nudge pushes a top wedge's label outward and a
									 *  bottom wedge's inward). */}
									{isPolarMode && (
										<>
											<div className="flex items-center gap-2">
												<NumberInput
													label="Angle"
													labelClassName={LABEL_COL}
													value={polarAngle}
													step={5}
													onChange={(angle) => patchPolar({ angle })}
													inputClassName="w-16"
													suffix="°"
												/>
												{polarAngle !== 0 && (
													<ResetLink onClick={() => patchPolar({ angle: 0 })} />
												)}
											</div>
											<div className="flex items-center gap-2">
												<NumberInput
													label="R"
													labelClassName={LABEL_COL}
													value={polarRadius}
													min={0}
													max={200}
													step={5}
													onChange={(radius) => patchPolar({ radius })}
													inputClassName="w-16"
													suffix="%"
												/>
												{polarRadius !== 100 && (
													<ResetLink onClick={() => patchPolar({ radius: 100 })} />
												)}
											</div>
										</>
									)}
									<div className="flex items-center gap-2">
										<NumberInput
											label="X"
											labelClassName={LABEL_COL}
											value={ownOffsets.xOffset ?? merged.xOffset}
											step={1}
											onChange={(xOffset) => patchOffsets({ xOffset })}
											inputClassName="w-16"
											suffix="px"
										/>
										{(ownOffsets.xOffset ?? merged.xOffset) !== 0 && (
											<ResetLink onClick={() => patchOffsets({ xOffset: 0 })} />
										)}
									</div>
									<div className="flex items-center gap-2">
										<NumberInput
											label="Y"
											labelClassName={LABEL_COL}
											value={-(ownOffsets.yOffset ?? merged.yOffset)}
											step={1}
											onChange={(n) => patchOffsets({ yOffset: -n })}
											inputClassName="w-16"
											suffix="px"
										/>
										{(ownOffsets.yOffset ?? merged.yOffset) !== 0 && (
											<ResetLink onClick={() => patchOffsets({ yOffset: 0 })} />
										)}
									</div>
									{/* This label's own rules, under its own header —
									 *  each label positions on its own, so each gets its
									 *  own "+ Add rule". */}
									<PositionRulesEditor
										rules={ownRules}
										onChange={setRules}
										baseXOffset={ownOffsets.xOffset ?? merged.xOffset}
										baseYOffset={ownOffsets.yOffset ?? merged.yOffset}
										ruleLabel={labelTitles[name] ?? name}
										help={
											comboIds.has(name) ? undefined : (
												<>
													Compared against each label&apos;s{" "}
													<strong>{name}</strong> value.
												</>
											)
										}
									/>
								</div>
							</CollapsibleSubsection>
						)
					})}
				{!primaryLabel ? null : sideLocksAlignment ? null : splitEndpoints ? (
					<div className="flex flex-col gap-2">
						{/* One alignment per population — effective value shown; the
						 *  all-labels row writes the base, the series ends write their
						 *  endpoint override blocks. */}
						{splitPopulations.map((pop) => (
							<div key={pop} className="flex items-center gap-2 text-sm">
								<span className={LABEL_COL}>{POPULATION_LABEL[pop]}</span>
								<AlignmentControl
									outward={isPolarMode || isRingLabels}
									value={
										(pop === "all"
											? merged.alignment
											: (merged[`${pop}Label`]?.alignment ??
												merged.alignment)) ?? "center"
									}
									onChange={(alignment) =>
										pop === "all"
											? updateCfg({ alignment })
											: patchEndpoint(`${pop}Label`, { alignment })
									}
								/>
							</div>
						))}
					</div>
				) : (
					<div className="flex items-center gap-2 text-sm">
						<span className={LABEL_COL}>Align</span>
						{/* Pies and sunburst rings add the fourth, "outward", option:
						 *  text hangs away from the center, so a label on the left
						 *  ends at its anchor and one on the right starts there. */}
						<AlignmentControl
							outward={isPolarMode || isRingLabels}
							value={merged.alignment ?? "center"}
							onChange={(alignment) => updateCfg({ alignment })}
						/>
					</div>
				)}
				{/* Same convention as the axes' tick-label Angle: positive =
				 *  clockwise, ±90°. Rotates each label around its anchor point. */}
				{primaryLabel && (
				<>
				<div className="flex items-center gap-2">
					<NumberInput
						label="Angle"
						labelClassName={LABEL_COL}
						value={merged.textAngle ?? 0}
						min={-90}
						max={90}
						step={1}
						clamp
						onChange={(textAngle) => updateCfg({ textAngle })}
						inputClassName="w-16"
						suffix="°"
					/>
					{(merged.textAngle ?? 0) !== 0 && (
						<ResetLink onClick={() => updateCfg({ textAngle: 0 })} />
					)}
				</div>
				<hr className="border-stone-200 dark:border-stone-700" />
				<Checkbox
					label="Wrap text"
					checked={merged.wrapText === true}
					onChange={(wrapText) => updateCfg({ wrapText })}
				/>
				{merged.wrapText === true && (
					<div className="ml-6 flex items-center gap-2 text-sm">
						<NumberInput
							label="Characters"
							labelClassName={LABEL_COL_NESTED}
							value={merged.wrapMaxChars ?? DEFAULT_WRAP_CHARS}
							min={1}
							step={1}
							onChange={(wrapMaxChars) => updateCfg({ wrapMaxChars })}
							inputClassName="w-16"
						/>
						{(merged.wrapMaxChars ?? DEFAULT_WRAP_CHARS) !== DEFAULT_WRAP_CHARS && (
							<ResetLink
								onClick={() => updateCfg({ wrapMaxChars: DEFAULT_WRAP_CHARS })}
							/>
						)}
					</div>
				)}
				{/* Collision handling sits with the other placement knobs: it
				 *  moves labels, so it belongs beside wrap / nudges rather than
				 *  with the selection of WHICH labels render. */}
				<Checkbox
					label="Avoid overlapping labels"
					checked={merged.avoidOverlaps === true}
					onChange={(avoidOverlaps) => updateCfg({ avoidOverlaps })}
				/>
				</>
				)}
				{isComboMode && primaryLabel && primaryLayerKey !== null && (
					<div className="vc-divider-group">
						{layerControl(primaryLayerKey, primaryLayerFields)}
						<p className="vc-help">
							Whether the labels sit on the bars or on the {marksLayerName.toLowerCase()}.
						</p>
					</div>
				)}
				{isBarMode && primaryLabel && !primaryOnMarks && (
					<div className="vc-divider-group">
						<span className="vc-group-header">Placement</span>
						<SelectInput
							label={isVerticalBars ? "Vertical" : "Horizontal"}
							labelClassName={LABEL_COL}
							value={primaryPosition}
							options={BAR_POSITION_OPTIONS}
							onChange={(position) => setPrimaryPlacement({ position })}
						/>
						<SelectInput
							label={isVerticalBars ? "Horizontal" : "Vertical"}
							labelClassName={LABEL_COL}
							value={primarySide}
							options={barSideOptions(isVerticalBars)}
							onChange={(side) => setPrimaryPlacement({ side })}
						/>
					</div>
				)}
				{isAreaMode && (
					<>
						<SelectInput
							label="Layer position"
							labelClassName={LABEL_COL}
							value={
								(merged.areaLabelPosition ?? "edge") as NonNullable<
									DataLabelsConfig["areaLabelPosition"]
								>
							}
							options={[
								{ value: "edge", label: "On the top edge (default)" },
								{ value: "center", label: "Center of layer" },
								{ value: "inside-base", label: "Inside, near base" },
								{ value: "inside-end", label: "Inside, near end" },
								{ value: "outside-end", label: "Outside the top edge" },
							]}
							onChange={(areaLabelPosition) => updateCfg({ areaLabelPosition })}
						/>
					</>
				)}
				{(primaryLabel || isRingLabels) && (
					<div className="vc-divider-group">
						<span className="vc-group-header">Adjust position</span>
						{/* Angle / R are polar-only — they only make sense around a pie,
						 *  so they're hidden for cartesian charts. The X/Y pixel nudge
						 *  below applies to every chart type, pies included. With
						 *  separate variables the pair moves into each variable's block
						 *  above (`fieldPolarPlacements`); a lone composed label reads
						 *  and writes its own entry, like its bar Placement. */}
						{isPolarMode && primaryLabel && (
							<>
								<div className="flex flex-col gap-2 text-sm">
									<div className="flex items-center gap-2">
										<NumberInput
											label="Angle"
											labelClassName={LABEL_COL}
											value={primaryPolarAngle}
											step={5}
											onChange={(angle) => setPrimaryPolar({ angle })}
											inputClassName="w-16"
											suffix="°"
										/>
										{primaryPolarAngle !== 0 && (
											<ResetLink onClick={() => setPrimaryPolar({ angle: 0 })} />
										)}
									</div>
									<div className="flex items-center gap-2">
										<NumberInput
											label="R"
											labelClassName={LABEL_COL}
											value={primaryPolarRadius}
											min={0}
											max={200}
											step={5}
											onChange={(radius) => setPrimaryPolar({ radius })}
											inputClassName="w-16"
											suffix="%"
										/>
										{primaryPolarRadius !== 100 && (
											<ResetLink onClick={() => setPrimaryPolar({ radius: 100 })} />
										)}
									</div>
								</div>
							</>
						)}
						{/* Sunburst: same Angle nudge; R is RING-relative (percent across
						 *  the ring's thickness) since each ring sits at its own radius. */}
						{isRingLabels && (
							<>
								<div className="flex flex-col gap-2 text-sm">
									<div className="flex items-center gap-2">
										<NumberInput
											label="Angle"
											labelClassName={LABEL_COL}
											value={merged.polarLabelAngle ?? 0}
											step={5}
											onChange={(polarLabelAngle) => updateCfg({ polarLabelAngle })}
											inputClassName="w-16"
											suffix="°"
										/>
										{(merged.polarLabelAngle ?? 0) !== 0 && (
											<ResetLink onClick={() => updateCfg({ polarLabelAngle: 0 })} />
										)}
									</div>
									<div className="flex items-center gap-2">
										<NumberInput
											label="R"
											labelClassName={LABEL_COL}
											value={merged.ringLabelRadius ?? 50}
											min={0}
											max={200}
											step={5}
											onChange={(ringLabelRadius) => updateCfg({ ringLabelRadius })}
											inputClassName="w-16"
											suffix="%"
										/>
										{(merged.ringLabelRadius ?? 50) !== 50 && (
											<ResetLink onClick={() => updateCfg({ ringLabelRadius: 50 })} />
										)}
									</div>
								</div>
							</>
						)}
						{!primaryLabel ? null : splitEndpoints ? (
							<>
								{/* One X/Y pair per population — effective values shown; the
								 *  all-labels pair writes the base offsets, the series ends
								 *  write their endpoint override blocks. */}
								{splitPopulations.map((pop) => {
									const patch = (p: { xOffset?: number; yOffset?: number }) =>
										pop === "all"
											? updateCfg(p)
											: patchEndpoint(`${pop}Label`, p)
									const xValue =
										pop === "all"
											? merged.xOffset
											: (merged[`${pop}Label`]?.xOffset ?? merged.xOffset)
									const yValue =
										pop === "all"
											? merged.yOffset
											: (merged[`${pop}Label`]?.yOffset ?? merged.yOffset)
									// Reset: the all-labels pair back to 0; a series end back to
									// inheriting the all-labels pair (its override cleared).
									const ownOf = (k: "xOffset" | "yOffset") =>
										pop === "all" ? null : (merged[`${pop}Label`]?.[k] ?? null)
									const xChanged =
										pop === "all" ? merged.xOffset !== 0 : ownOf("xOffset") != null
									const yChanged =
										pop === "all" ? merged.yOffset !== 0 : ownOf("yOffset") != null
									const resetPop = (k: "xOffset" | "yOffset") =>
										pop === "all"
											? updateCfg({ [k]: 0 })
											: patchEndpoint(`${pop}Label`, { [k]: null })
									return (
										<div key={pop} className="flex flex-col gap-2">
											<span className="text-sm vc-muted">
												{POPULATION_LABEL[pop]}
											</span>
											<div className="ml-6 flex flex-col gap-2 text-sm">
												<div className="flex items-center gap-2">
													<NumberInput
														label="X"
														labelClassName={LABEL_COL_NESTED}
														value={xValue}
														step={1}
														onChange={(xOffset) => patch({ xOffset })}
														inputClassName="w-16"
														suffix="px"
													/>
													{xChanged && <ResetLink onClick={() => resetPop("xOffset")} />}
												</div>
												<div className="flex items-center gap-2">
													<NumberInput
														label="Y"
														labelClassName={LABEL_COL_NESTED}
														value={-yValue}
														step={1}
														onChange={(n) => patch({ yOffset: -n })}
														inputClassName="w-16"
														suffix="px"
													/>
													{yChanged && <ResetLink onClick={() => resetPop("yOffset")} />}
												</div>
											</div>
										</div>
									)
								})}
							</>
						) : (
							<div className="flex flex-col gap-2 text-sm">
								<div className="flex items-center gap-2">
									<NumberInput
										label="X"
										labelClassName={LABEL_COL}
										value={merged.xOffset}
										step={1}
										onChange={(xOffset) => updateCfg({ xOffset })}
										inputClassName="w-16"
										suffix="px"
									/>
									{merged.xOffset !== 0 && (
										<ResetLink onClick={() => updateCfg({ xOffset: 0 })} />
									)}
								</div>
								<div className="flex items-center gap-2">
									<NumberInput
										label="Y"
										labelClassName={LABEL_COL}
										value={-merged.yOffset}
										step={1}
										onChange={(n) => updateCfg({ yOffset: -n })}
										inputClassName="w-16"
										suffix="px"
									/>
									{merged.yOffset !== 0 && (
										<ResetLink onClick={() => updateCfg({ yOffset: 0 })} />
									)}
								</div>
							</div>
						)}
						{/* The ARRANGED label's rules. With the variables separate there is
						 *  no arranged label, and every own label carries its rules in its
						 *  own subsection above. */}
						{primaryLabel && (
							<PositionRulesEditor
								rules={merged.positionRules ?? []}
								onChange={(positionRules) => updateCfg({ positionRules })}
								baseXOffset={merged.xOffset}
								baseYOffset={merged.yOffset}
								nested={splitEndpoints}
							/>
						)}
					</div>
				)}
				</div>
			</CollapsibleSubsection>
			</>
			)}

			<CollapsibleSubsection title="Text" changed={textPropertiesChanged}>
				<TextPropertiesPanel
					cfg={merged}
					onChange={updateCfg}
					themeDefaults={themeDefaults}
					multiFields={styleFields}
					titles={labelTitles}
					splitToggle={splitToggleFor("text")}
					keysFor={sectionKeys("text")}
				/>
			</CollapsibleSubsection>

			{fineTuningApplies && (
			<CollapsibleSubsection title="Box" changed={textBackgroundChanged}>
				<TextBackgroundPanel
					cfg={merged}
					onChange={updateCfg}
					vizBackground={vizBackground}
					multiFields={perVariable ? multiFields : []}
					titles={labelTitles}
				/>
			</CollapsibleSubsection>
			)}
			</div>
		</div>
	)
}
