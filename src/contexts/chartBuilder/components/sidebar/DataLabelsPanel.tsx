import { useAtom, useAtomValue } from "jotai"
import { useMemo } from "react"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_FACET_CONFIG,
	effectiveLabelPoints,
	type DataLabelsConfig,
	type EndpointLabelOverrides,
	type FacetConfig,
	type LabelPointsMode,
	type LabelPointsScope,
} from "../../lib/channelConfig"
import { resolveHierarchyIdField } from "../../lib/buildHierarchy"
import {
	POPULATION_LABEL,
	defaultSharedTemplate,
	fieldLabelPointsMode,
	presentPopulations,
	resolveLabelSelection,
} from "../../lib/dataLabelsSelection"
import { resolveStackModes } from "../../lib/stackMode"
import { dataLabelsConfigFromTheme } from "../../lib/themeConfig"
import { effectiveType } from "../../lib/fieldType"
import {
	facetPanelOptions,
	resolveFacetPanels,
} from "../../lib/resolveFacetPanels"
import {
	PACKED_DERIVED_LABELS,
	PACKED_MEASURE_OPTION_VALUE,
	hierarchyDepthLevels,
	isHierarchyModeId,
	packedSourceForOptionValue,
	topLevelGroupNames,
} from "../../lib/packedMeasure"
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
import { Toggle } from "../../../../components/ui/Toggle"
import { AlignmentControl } from "./LabelsPanel"
import { FacetScopeControl } from "./FacetScopeControl"
import { DataLabelChannelRow } from "./dataLabels/DataLabelChannelRow"
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

/** "Which labels" choices — shared by the single-field select and the
 *  per-variable selects of multi-field mode. With the scope select showing
 *  beneath ("Of each: Series / Group / Stack") the choices drop their
 *  "per series" tail so the two selects read as one sentence; elsewhere
 *  the tail says what the ends run over. */
const labelPointsOptions = (
	withScope: boolean
): ReadonlyArray<{ value: LabelPointsMode; label: string }> => [
	{ value: "all", label: "All labels" },
	{ value: "first", label: withScope ? "First" : "First per series" },
	{ value: "last", label: withScope ? "Last" : "Last per series" },
	{
		value: "first-last",
		label: withScope ? "First and last" : "First and last per series",
	},
]

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
	r: "R",
	geography: "Geography",
	value: "Value",
	hue: "Color",
	size: "Size",
}

/** Sidebar section that lets the user encode an independent label layer
 * on top of the main visualization. The layer's encodings are stored in
 * `currentDataLabelsEncodingsAtom`; appearance + offsets + scale knobs
 * live in `currentDataLabelsConfigAtom`. */
export const DataLabelsPanel = () => {
	const [storedEncodings, setEncodings] = useAtom(
		currentDataLabelsEncodingsAtom
	)
	// Defensive merge: persisted state from before the `text` → `value`
	// rename (or any future channel addition) wouldn't have all keys, so
	// reads like `encodings.value.field` would crash. Spreading defaults
	// underneath guarantees every channel slot exists.
	const encodings: DataLabelsEncodings = {
		...emptyDataLabelsEncodings(),
		...storedEncodings,
	}
	const [cfg, setCfg] = useAtom(currentDataLabelsConfigAtom)
	const merged: DataLabelsConfig = { ...DEFAULT_DATA_LABELS_CONFIG, ...cfg }
	// Resolve the LIVE theme (same fallback chain as LabelColorPanel) so the
	// font-size / weight / style reset links compare against — and reset to —
	// the theme's data-label defaults rather than the hardcoded constants.
	const theme = useCurrentTheme()
	const themeDefaults = dataLabelsConfigFromTheme(theme)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const chartEncodings = useAtomValue(currentEncodingsAtom)
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
	// Tile (categorical × categorical heatmap) is the only chart type where
	// label positions MUST match the chart's encoding — every cell is keyed
	// by (chart.x, chart.y), so encoding a third field as the label's x or
	// y would produce nonsense. When the user picks one position we
	// auto-fill the other, and we restrict the dropdowns to just the
	// chart's x/y fields so the user can't pick anything misleading.
	const isTileMode = chartMode === "tile"
	// Maps: labels anchor to REGIONS, not to x/y fields — the position rows
	// are replaced by a single "Geography" row (the field whose values join
	// to map regions; labels center on each matched region's centroid). The
	// per-series "Which labels" selection has no meaning on a map.
	const isGeoMode = modeDef.canvas.coordFamily === "geo"
	// Tree layouts (packed circles / treemap / sunburst): labels are PLACED
	// by the layout (leaf centers, container rims, arc centroids), so the
	// position rows stand down — Value, Color, Size, and Text Properties
	// still apply. Packed circles / treemap draw their labels themselves, so
	// the position / overlap / background fine-tuning stands down there too.
	// The sunburst hands its arc anchors to the shared label layer, so it
	// keeps the full fine-tuning set (polar nudges included, like a pie).
	// Chord / sankey label styling is a follow-up; their panel is unchanged.
	const isTreeMode = isHierarchyModeId(chartMode)
	const isSunburstMode = chartMode === "sunburst"
	const fineTuningApplies = !isTreeMode || isSunburstMode
	// Pie family — labels are placed in polar terms (distance from center +
	// angular nudge) rather than the cartesian X/Y pixel offsets that make
	// no sense around a wedge.
	const isPolarMode =
		chartMode === "pies" || chartMode === "pies-x" || chartMode === "pies-y"
	// No per-series endpoints: regions on a map, nodes in a sunburst. The
	// "Which labels" selection is hidden AND skipped by the renderer there.
	const noSeriesEndpoints = isGeoMode || isSunburstMode
	// Bar charts (incl. histograms, which are bars over binned categories) are
	// the only mode where "Bar position" (label placement along the measure
	// axis) applies — gate the control on it.
	const isBarMode = chartMode === "bars-x" || chartMode === "bars-y"
	// "Of each" scope for the series ends. Shown only where it can change
	// anything: bars grouped (a group-mode channel) or layered (stack /
	// overlay), stacked areas, or several pies with a wedge channel — AND
	// some "Which labels" choice is not "All labels". A channel mapped to
	// the x field colors marks without forming groups or layers, so it
	// doesn't count. A single pie has no series across pies, so the scope
	// stands down there (every wedge is its own series, as before).
	const scopeFamily: ScopeFamily | null = isBarMode
		? "bars"
		: chartMode === "areas-x" || chartMode === "areas-y"
			? "areas"
			: chartMode === "pies-x" || chartMode === "pies-y"
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
	const anyEndpointChoice = encodings.value.multiField
		? (encodings.value.fields ?? []).some(
				(f) => fieldLabelPointsMode(merged, f) !== "all"
			)
		: effectiveLabelPoints(merged) !== "all"
	const showScope =
		scopeFamily !== null && (scopeGrouped || scopeLayered) && anyEndpointChoice
	const scopeWording = SCOPE_OPTION[scopeFamily ?? "bars"]
	const scopeOptions = (
		["series", "group", "stack"] as const satisfies readonly LabelPointsScope[]
	)
		.filter((sc) =>
			sc === "group" ? scopeGrouped : sc === "stack" ? scopeLayered : true
		)
		.map((sc) => ({ value: sc, label: scopeWording[sc] }))
	// A stored scope whose channel is gone reads as "series" (the renderer
	// falls back the same way); the stored value is left alone.
	const storedScope = merged.labelPointsScope ?? "series"
	const effectiveScope: LabelPointsScope = scopeOptions.some(
		(o) => o.value === storedScope
	)
		? storedScope
		: "series"
	const whichLabelsOptions = labelPointsOptions(showScope)
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
	// "Label all facets" picker stores match the rendered panels. Unfaceted
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
	// The shared "Label text" box pre-fills with the checked fields and
	// follows the checklist / per-field selection WHILE it's still that auto
	// default (or empty) — never once the user has hand-edited it. Returns
	// the patch to apply alongside a selection change.
	const syncedTemplate = (
		nextCfg: DataLabelsConfig,
		nextFields: string[]
	): Partial<DataLabelsConfig> => {
		const prevFields = encodings.value.fields ?? []
		const current = merged.labelTemplate ?? ""
		const prevAuto = defaultSharedTemplate(selection, prevFields)
		if (current !== "" && current !== prevAuto) return {}
		const nextSelection = resolveLabelSelection(
			nextCfg,
			{ multiField: true, fields: nextFields },
			{ seriesless: noSeriesEndpoints }
		)
		return { labelTemplate: defaultSharedTemplate(nextSelection, nextFields) }
	}
	// Per-field "Which labels" (multi-field mode). Writes the field's mode
	// and re-syncs the shared label text with the populations that result.
	const setFieldLabelPoints = (field: string, mode: LabelPointsMode) => {
		const nextCfg: DataLabelsConfig = {
			...merged,
			fieldLabelPoints: { ...(merged.fieldLabelPoints ?? {}), [field]: mode },
		}
		updateCfg({
			fieldLabelPoints: nextCfg.fieldLabelPoints,
			...syncedTemplate(nextCfg, encodings.value.fields ?? []),
		})
	}

	// "Changed" dot for the Position Adjustment and Alignment subsection —
	// lights when ANY control inside deviates from its default. Mode-gated
	// values (polar nudges, bar position, endpoint overrides) only count when
	// their controls are visible: a stored deviation the current panel can't
	// clear must not light the dot.
	const endpointPositionEdited = (o: EndpointLabelOverrides | undefined) =>
		o?.alignment != null || o?.xOffset != null || o?.yOffset != null
	const positionChanged =
		(merged.alignment ?? "center") !== "center" ||
		(merged.textAngle ?? 0) !== 0 ||
		merged.wrapText === true ||
		merged.xOffset !== 0 ||
		merged.yOffset !== 0 ||
		(merged.positionRules ?? []).length > 0 ||
		(isBarMode && (merged.barLabelPosition ?? "center") !== "center") ||
		(isPolarMode &&
			((merged.polarLabelAngle ?? 0) !== 0 ||
				(merged.polarLabelRadius ?? 100) !== 100)) ||
		(isSunburstMode &&
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
		selection.present.first ||
		selection.present.last ||
		merged.avoidOverlaps === true ||
		(isFaceted && merged.facetKeys != null) ||
		(isGeoMode && merged.leaderLines === true)
	const textPositionChanged = (merged.arcWrapLevels ?? []).length > 0
	// Text Properties compares against the THEME's data-label defaults — the
	// same baseline the panel's reset links restore.
	const textPropertiesChanged =
		merged.fontFamily !== themeDefaults.fontFamily ||
		merged.fontWeight !== themeDefaults.fontWeight ||
		(merged.italic ?? false) !== (themeDefaults.italic ?? false) ||
		(merged.underline ?? false) !== (themeDefaults.underline ?? false)
	// Every other background control is gated behind the toggle, so the
	// toggle alone decides the dot (stored-but-hidden values don't count).
	const textBackgroundChanged = merged.textBackground === true

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
			return
		}
		const newField = fieldName === "" ? null : fieldName
		setEncodings((prev) => {
			const next = { ...prev, [channel]: { field: newField } }
			if (isTileMode && newField !== null) {
				if (channel === "x" && chartYField && !prev.y?.field) {
					next.y = { field: chartYField }
				} else if (channel === "y" && chartXField && !prev.x?.field) {
					next.x = { field: chartXField }
				}
			}
			return next
		})
	}

	// The Value row is special: besides picking a single field it can switch
	// into multi-field mode (the "Multiple variables…" sentinel), which keeps
	// `value.field` null and drives the label off `value.fields` + template.
	const setValueField = (v: string) => {
		if (v === DATA_LABELS_MULTI_VALUE) {
			const fields = encodings.value.fields ?? []
			const current = merged.labelTemplate ?? ""
			setEncodings((prev) => ({
				...prev,
				value: { field: null, multiField: true, fields: prev.value?.fields ?? [] },
			}))
			// Pre-fill the template so the box opens on a working arrangement.
			if (current === "" && fields.length > 0) {
				updateCfg(syncedTemplate(merged, fields))
			}
			return
		}
		setEncodings((prev) => ({
			...prev,
			value: {
				field: v === "" ? null : v,
				multiField: false,
				fields: prev.value?.fields ?? [],
			},
		}))
	}
	const setValueFields = (fields: string[]) => {
		// Keep the template in sync with the checklist WHILE it's still the
		// auto default (or empty) — so checking/unchecking updates the
		// pre-filled arrangement — but never once the user has hand-edited it.
		setEncodings((prev) => ({
			...prev,
			value: { field: null, multiField: true, fields },
		}))
		const patch = syncedTemplate(merged, fields)
		if (Object.keys(patch).length > 0) updateCfg(patch)
	}

	const allEligible = dataset?.fields ?? []
	const tileXEligible = chartXField
		? allEligible.filter((f) => f.name === chartXField)
		: []
	const tileYEligible = chartYField
		? allEligible.filter((f) => f.name === chartYField)
		: []
	const xEligible = isTileMode ? tileXEligible : allEligible
	const yEligible = isTileMode ? tileYEligible : allEligible

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

	// Packed circles' "Text Position" checkboxes: one per CONTAINER depth
	// (levels that draw grouping circles — every hierarchy level except the
	// deepest, which is all leaves). Derived from the same tree the renderer
	// builds so the checkbox list tracks the drawn nesting.
	const isPackedMode = chartMode === "packed-circles"
	const containerWrapLevels = (() => {
		if (!isPackedMode || !dataset) return []
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

	return (
		<div className="flex flex-col gap-2">

			{/* Channel mapping rows lead the panel and sit OUTSIDE the purple
			 *  box — choosing what each label encodes (position, value, color,
			 *  size) is the primary action and reads as its own list; the
			 *  selection / overlap / position fine-tuning lives in the purple
			 *  group below. */}

			{/* Tree layouts have no position rows at all — placement comes from
			 *  the pack / treemap / partition layout. */}
			{isTreeMode && (
				<p className="vc-help">
					{isSunburstMode
						? "Labels sit on each arc that can hold them; fine-tune placement under Position Adjustment. "
						: "Labels are placed by the layout (leaf centers, container rims). "}
					Value, Color, and Size apply — Value defaults to each row&apos;s
					name from the ID column.
				</p>
			)}
			{/* Maps anchor labels to REGIONS — one Geography row replaces the
			 *  cartesian X/Y rows. Its field joins to map regions at its own
			 *  auto-detected level, independent of the map's region field, so
			 *  a county map can carry state-level labels.
			 *  Pies position labels in polar terms — Angle + R replace the
			 *  cartesian X/Y rows. These are plain mapping dropdowns; the
			 *  placement nudges (Angle°, R%) live under "Adjust position". */}
			{isTreeMode ? null : isGeoMode ? (
				<DataLabelChannelRow
					channel="geography"
					label={CHANNEL_LABEL.geography}
					value={encodings.geography?.field ?? null}
					onChange={(v) => setField("geography", v)}
					eligible={allEligible}
				/>
			) : isPolarMode ? (
				<>
					<DataLabelChannelRow
						channel="angle"
						label={CHANNEL_LABEL.angle}
						value={encodings.angle.field}
						onChange={(v) => setField("angle", v)}
						eligible={allEligible}
					/>

					<DataLabelChannelRow
						channel="r"
						label={CHANNEL_LABEL.r}
						value={encodings.r.field}
						onChange={(v) => setField("r", v)}
						eligible={allEligible}
					/>
				</>
			) : (
				<>
					<DataLabelChannelRow
						channel="x"
						label={CHANNEL_LABEL.x}
						value={encodings.x.field}
						onChange={(v) => setField("x", v)}
						eligible={xEligible}
					/>

					<DataLabelChannelRow
						channel="y"
						label={CHANNEL_LABEL.y}
						value={encodings.y.field}
						onChange={(v) => setField("y", v)}
						eligible={yEligible}
					/>
				</>
			)}

			<DataLabelChannelRow
				channel="value"
				label={CHANNEL_LABEL.value}
				value={
					encodings.value.multiField
						? DATA_LABELS_MULTI_VALUE
						: encodings.value.field
				}
				onChange={setValueField}
				eligible={allEligible}
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
						allFields={allEligible.map((f) => f.name)}
						onFieldsChange={setValueFields}
						selection={selection}
						countryNames={countryNameFormats}
					/>
				) : encodings.value.field ? (
					<SingleValuePanel
						field={encodings.value.field}
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
					multiFields={
						encodings.value.multiField ? (encodings.value.fields ?? []) : []
					}
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
				eligible={allEligible}
				derivedOptions={labelDerivedSizeOptions}
			>
				<SizePanel
					cfg={merged}
					onChange={updateCfg}
					themeDefaults={themeDefaults}
					sizeMapped={sizeByDepth || Boolean(encodings.size.field)}
					depthNote={sizeByDepth}
				/>
			</DataLabelChannelRow>

			{/* One purple panel wraps the layer-wide fine-tuning so it reads as
			 *  a single group, distinct from the per-channel mappings above. */}
			<div className="vc-option-panel">
			{/* Layer-wide toggles: which labels to keep and how to handle
			 *  collisions. Grouped under their own subsection so they read as
			 *  a distinct concern from the per-channel mappings above. */}
			{/* Selection / overlap / position controls act on the shared label
			 *  layer's positioned labels — inert for the self-drawn packed /
			 *  treemap labels, so they stand down there (as does Text
			 *  Background, which those renderers don't draw). The sunburst
			 *  renders through the layer, so it keeps them. */}
			{fineTuningApplies && (
			<>
			<CollapsibleSubsection
				title="Label selection and overlap"
				changed={selectionChanged}
			>
				<div className="flex flex-col gap-2">
				{/* Per-series endpoint selection is meaningless on a map or a
				 *  sunburst (no series) — the renderer skips it there, so the
				 *  control hides. Multi-field labels get one select PER
				 *  selected variable: each variable joins the label populations
				 *  its choice names (a value on every label, the series name on
				 *  the last, …), and the Value / position controls split per
				 *  population when more than one results. */}
				{!noSeriesEndpoints &&
					(encodings.value.multiField ? (
						(encodings.value.fields ?? []).length === 0 ? (
							<p className="vc-help">
								Check fields under Value to choose which labels each one
								appears on.
							</p>
						) : (
							<>
								<span className="vc-group-header">Which labels</span>
								{(encodings.value.fields ?? []).map((field) => (
									<SelectInput
										key={field}
										label={field}
										labelClassName={LABEL_COL}
										value={fieldLabelPointsMode(merged, field)}
										options={whichLabelsOptions}
										onChange={(mode: LabelPointsMode) =>
											setFieldLabelPoints(field, mode)
										}
									/>
								))}
							</>
						)
					) : (
						<SelectInput
							label="Which labels"
							labelClassName={LABEL_COL}
							value={effectiveLabelPoints(merged)}
							options={whichLabelsOptions}
							onChange={(labelPoints: LabelPointsMode) =>
								updateCfg({ labelPoints })
							}
						/>
					))}
				{showScope && (
					<>
						<SelectInput
							label="Of each"
							labelClassName={LABEL_COL}
							value={effectiveScope}
							options={scopeOptions}
							onChange={(labelPointsScope: LabelPointsScope) =>
								updateCfg({ labelPointsScope })
							}
						/>
						<p className="vc-help">
							{SCOPE_HELP[scopeFamily ?? "bars"][effectiveScope]}
						</p>
					</>
				)}
				<Toggle
					label="Avoid overlapping labels"
					className="mt-1"
					checked={merged.avoidOverlaps === true}
					onChange={(avoidOverlaps) => updateCfg({ avoidOverlaps })}
				/>
				{/* Faceted charts only: which panels draw labels. Checked (the
				 *  default, stored as null) = every panel; unchecking lists the
				 *  facets so the user ticks the ones that keep their labels.
				 *  Hidden — and ignored by the renderer — when not faceted. */}
				{isFaceted && (
					<FacetScopeControl
						label="Label all facets"
						facetKeys={merged.facetKeys}
						facetOptions={facetOptions}
						onChange={(facetKeys) => updateCfg({ facetKeys })}
					/>
				)}
				{/* Maps only: leader lines connect a displaced label (offset or
				 *  overlap-nudged) back to its region's centroid. Defaults come
				 *  from the theme's Maps section. */}
				{isGeoMode && (
					<>
						<Toggle
							label="Draw leader lines"
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
								<p className="vc-help">
									Lines connect a label back to its region when an offset or
									overlap avoidance moves it off the region&apos;s center.
								</p>
							</>
						)}
					</>
				)}
				</div>
			</CollapsibleSubsection>

			<CollapsibleSubsection
				title="Position Adjustment and Alignment"
				changed={positionChanged}
			>
				<div className="flex flex-col gap-2">
				{splitEndpoints ? (
					<div className="flex flex-col gap-2">
						{/* One alignment per population — effective value shown; the
						 *  all-labels row writes the base, the series ends write their
						 *  endpoint override blocks. */}
						{splitPopulations.map((pop) => (
							<div key={pop} className="flex items-center gap-2 text-sm">
								<span className={LABEL_COL}>{POPULATION_LABEL[pop]}</span>
								<AlignmentControl
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
						<span className={LABEL_COL}>
							Alignment
						</span>
						<AlignmentControl
							value={merged.alignment ?? "center"}
							onChange={(alignment) => updateCfg({ alignment })}
						/>
					</div>
				)}
				{/* Same convention as the axes' tick-label Angle: positive =
				 *  clockwise, ±90°. Rotates each label around its anchor point. */}
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
				<Toggle
					label="Wrap text"
					checked={merged.wrapText === true}
					onChange={(wrapText) => updateCfg({ wrapText })}
				/>
				{merged.wrapText === true && (
					<div className="ml-6 flex items-center gap-2 text-sm">
						<NumberInput
							label="Characters"
							labelClassName={LABEL_COL_NESTED}
							value={merged.wrapMaxChars ?? 20}
							min={1}
							step={1}
							onChange={(wrapMaxChars) => updateCfg({ wrapMaxChars })}
							inputClassName="w-16"
						/>
					</div>
				)}
				{isBarMode && (
					<>
						<SelectInput
							label="Bar position"
							labelClassName={LABEL_COL}
							value={
								(merged.barLabelPosition ?? "center") as NonNullable<
									DataLabelsConfig["barLabelPosition"]
								>
							}
							options={[
								{ value: "center", label: "Center of bar (default)" },
								{ value: "inside-base", label: "Inside, near base" },
								{ value: "inside-end", label: "Inside, near end" },
								{ value: "outside-end", label: "Outside the end of the bar" },
							]}
							onChange={(barLabelPosition) => updateCfg({ barLabelPosition })}
						/>
						<p className="vc-help">
							Where labels sit along the bar&apos;s measure axis.
						</p>
					</>
				)}
				<hr className="border-stone-200 dark:border-stone-700" />
				<span className="vc-group-header">Adjust position</span>
				{/* Angle / R are polar-only — they only make sense around a pie,
				 *  so they're hidden for cartesian charts. The X/Y pixel nudge
				 *  below applies to every chart type, pies included. */}
				{isPolarMode && (
					<>
						<div className="flex items-center gap-2 text-sm">
							<NumberInput
								label="Angle"
								labelClassName="w-12 vc-muted"
								value={merged.polarLabelAngle ?? 0}
								step={5}
								onChange={(polarLabelAngle) => updateCfg({ polarLabelAngle })}
								inputClassName="w-16"
								suffix="°"
							/>
							<NumberInput
								label="R"
								labelClassName="w-8 vc-muted"
								value={merged.polarLabelRadius ?? 100}
								min={0}
								max={200}
								step={5}
								onChange={(polarLabelRadius) => updateCfg({ polarLabelRadius })}
								inputClassName="w-16"
								suffix="%"
							/>
						</div>
						<p className="vc-help">
							Angle rotates every label off its slice&apos;s midpoint (positive =
							clockwise). R is the distance from each pie&apos;s center as a percent
							of its radius — 100% is the border, lower pulls labels inside the
							wedge, higher pushes them outside.
						</p>
					</>
				)}
				{/* Sunburst: same Angle nudge; R is RING-relative (percent across
				 *  the ring's thickness) since each ring sits at its own radius. */}
				{isSunburstMode && (
					<>
						<div className="flex flex-col gap-2 text-sm">
							<NumberInput
								label="Angle"
								labelClassName={LABEL_COL}
								value={merged.polarLabelAngle ?? 0}
								step={5}
								onChange={(polarLabelAngle) => updateCfg({ polarLabelAngle })}
								inputClassName="w-16"
								suffix="°"
							/>
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
						</div>
						<p className="vc-help">
							Angle rotates every label off its arc&apos;s midpoint (positive =
							clockwise). R is the label&apos;s position across its ring as a
							percent of the ring&apos;s thickness — 50% is the middle, 0% the
							inner edge, 100% the outer edge, higher pushes labels outside the
							ring.
						</p>
					</>
				)}
				{splitEndpoints ? (
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
							return (
								<div key={pop} className="flex flex-col gap-2">
									<span className="text-sm vc-muted">
										{POPULATION_LABEL[pop]}
									</span>
									<div className="ml-6 flex flex-col gap-2 text-sm">
										<NumberInput
											label="X"
											labelClassName={LABEL_COL_NESTED}
											value={xValue}
											step={1}
											onChange={(xOffset) => patch({ xOffset })}
											inputClassName="w-16"
											suffix="px"
										/>
										<NumberInput
											label="Y"
											labelClassName={LABEL_COL_NESTED}
											value={-yValue}
											step={1}
											onChange={(n) => patch({ yOffset: -n })}
											inputClassName="w-16"
											suffix="px"
										/>
									</div>
								</div>
							)
						})}
					</>
				) : (
					<div className="flex flex-col gap-2 text-sm">
						<NumberInput
							label="X"
							labelClassName={LABEL_COL}
							value={merged.xOffset}
							step={1}
							onChange={(xOffset) => updateCfg({ xOffset })}
							inputClassName="w-16"
							suffix="px"
						/>
						<NumberInput
							label="Y"
							labelClassName={LABEL_COL}
							value={-merged.yOffset}
							step={1}
							onChange={(n) => updateCfg({ yOffset: -n })}
							inputClassName="w-16"
							suffix="px"
						/>
					</div>
				)}
				<PositionRulesEditor cfg={merged} onChange={updateCfg} />
				</div>
			</CollapsibleSubsection>
			</>
			)}

			{/* Packed circles only: per-container-level choice between the
			 *  default inside-the-rim placement and wrapping the group name
			 *  around the OUTSIDE of the circle on an arc. */}
			{isPackedMode && (
				<CollapsibleSubsection title="Text Position" changed={textPositionChanged}>
					<TextPositionPanel
						cfg={merged}
						onChange={updateCfg}
						levels={containerWrapLevels}
					/>
				</CollapsibleSubsection>
			)}

			<CollapsibleSubsection title="Text Properties" changed={textPropertiesChanged}>
				<TextPropertiesPanel
					cfg={merged}
					onChange={updateCfg}
					themeDefaults={themeDefaults}
				/>
			</CollapsibleSubsection>

			{fineTuningApplies && (
			<CollapsibleSubsection title="Text Background" changed={textBackgroundChanged}>
				<TextBackgroundPanel
					cfg={merged}
					onChange={updateCfg}
					vizBackground={vizBackground}
				/>
			</CollapsibleSubsection>
			)}
			</div>
		</div>
	)
}
