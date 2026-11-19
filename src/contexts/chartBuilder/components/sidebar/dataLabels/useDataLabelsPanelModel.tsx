import { useAtom, useAtomValue } from "jotai"
import { useMemo } from "react"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_FACET_CONFIG,
	effectiveLabelPoints,
	type DataLabelsConfig,
	type EndpointLabelOverrides,
	type FacetConfig,
	type LabelPieceSection,
	type LabelPointsScope,
} from "../../../lib/channelConfig"
import { resolveFlowEndpoints } from "../../../lib/buildFlowGraph"
import { barTotalFieldName } from "../../../lib/barTotalLabel"
import {
	fieldLabelPointsMode,
	labelPieceSplit,
	labelKeysFor,
	labelScopeFor,
	normalizeComposedLabels,
	sectionKeysFor,
	presentPopulations,
	resolveLabelSelection,
} from "../../../lib/dataLabelsSelection"
import { resolveStackModes } from "../../../lib/stackMode"
import { dataLabelsConfigFromTheme } from "../../../lib/themeConfig"
import { effectiveType } from "../../../lib/fieldType"
import { facetPanelOptions, resolveFacetPanels } from "../../../lib/resolveFacetPanels"
import {
	isAreaModeId,
	isBarModeId,
	isComboModeId,
	isHierarchyModeId,
	isPieModeId,
} from "../../../lib/chartModes/families"
import { comboMarksFields, dataLabelLayerFor } from "../../../lib/comboOverlay"
import {
	emptyDataLabelsEncodings,
	type DataLabelsEncodings,
	type FieldType,
} from "../../../lib/types"
import {
	resolveDataLabelPositions,
} from "../../../lib/dataLabelsPosition"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
} from "../../../store/atoms"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { useGeoLabelLevel } from "../../../store/useGeoLabelLevel"
import { Checkbox } from "../../../../../components/ui/Checkbox"
import {
	SCOPE_OPTION,
	labelPointsOptions,
	type ScopeFamily,
} from "./panelOptions"

/** Everything the Data Labels panel's sections share: the label layer's
 *  encodings and config (normalized as the renderer reads them), the
 *  chart-mode gates, the "Which labels" scope wording, the facet panels, and
 *  the composed-label keys the per-label blocks iterate. Computed once by
 *  `DataLabelsPanel` and handed to each section as `m`. */
export const useDataLabelsPanelModel = () => {
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
	// The flow's source / target / weight columns — the same resolution the
	// renderers use (full data set).
	const flowEndpoints = useMemo(
		() =>
			isFlowMode && dataset
				? resolveFlowEndpoints(chartEncodings, chartConfigs.connection, dataset)
				: null,
		[isFlowMode, dataset, chartEncodings, chartConfigs.connection]
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

	return {
		encodings,
		setEncodings,
		chartEncodings,
		merged,
		updateCfg,
		theme,
		themeDefaults,
		overrides,
		chartConfigs,
		vizBackground,
		dataset,
		hueField,
		hueSource,
		sizeByDepth,
		hueFieldType,
		modeDef,
		isGeoMode,
		isTreeMode,
		isRingLabels,
		fineTuningApplies,
		flowGeometry,
		isFlowMode,
		isPolarMode,
		noSeriesEndpoints,
		isBarMode,
		isVerticalBars,
		isComboMode,
		marksLayerName,
		layerFor,
		sideLocksAlignmentFor,
		isAreaMode,
		scopeFamily,
		scopeGrouped,
		scopeLayered,
		scopeOptions,
		showScopeFor,
		effectiveScopeFor,
		whichLabelsOptionsFor,
		barTotalName,
		barTotalOptions,
		chartXField,
		chartYField,
		positionLocked,
		countryNameFormats,
		isFaceted,
		facetOptions,
		selection,
		splitEndpoints,
		splitPopulations,
		patchEndpoint,
		flowEndpoints,
		labelKeys,
		multiFields,
		labelTitles,
		perVariable,
		loneLabelKey,
		styleFields,
		sectionKeys,
		splitToggleFor,
		ownLabelKeys,
		primaryLabel,
		comboIds,
	}
}

export type DataLabelsPanelModel = ReturnType<typeof useDataLabelsPanelModel>
