import { useAtom, useAtomValue } from "jotai"
import { useMemo } from "react"
import {
	DEFAULT_FACET_CONFIG,
	gridPanelAxisOverride,
	migrateProportionalSizing,
	migrateShareValue,
	rowSizingMeaningful,
	type FacetConfig,
	type PanelAxisOverride,
} from "../../../lib/channelConfig"
import {
	facetPanelOptions,
	resolveFacetPanels,
} from "../../../lib/resolveFacetPanels"
import { facetSizingPatch, type FacetSizing } from "../../../lib/facetEdits"
import type { FacetPanelRef } from "../../../lib/facetPanelRef"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { axisFieldsFor, axisRangeIsContinuous } from "../../../lib/axisFields"
import {
	facetAxisMapping,
	type FacetAxisMapping,
} from "../../../lib/facetAxisMapping"
import type { ChartModeDef } from "../../../lib/chartModes/types"
import { effectiveType } from "../../../lib/fieldType"
import type { DatasetView, Encodings, FieldType } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentRenderedPanelInnerDimsAtom,
} from "../../../store/atoms"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { SidebarJumpLink } from "../../../../../components/ui/SidebarJumpLink"
import {
	AxisRangeSection,
	GapInput,
	PanelDimInput,
	ShareAxisRow,
	SizeByCheckboxRow,
	countUniqueFieldValues,
	useClearPanelDimWhenSizing,
	useUniqueFieldValues,
	withBound,
	withBoundInMap,
	withGridPanelBound,
	withGridPanelTicks,
	withTicks,
	withTicksInMap,
} from "./facetSharedControls"
import { FacetPairPickers } from "./FacetPairPickers"

/** Everything that differs between the Rows and Columns subsections of
 *  the two-variable facet panel, as data. The two are exact mirrors of
 *  each other under this renaming — `FacetAxisSubsection` below implements
 *  the shared logic once and reads the axis-specific keys / copy from here. */
type FacetAxisSpec = {
	/** Facet channel this panel configures. */
	facetChannel: "facetRow" | "facetCol"
	/** The facet channel on the perpendicular axis — its unique-value
	 *  count gates per-group sharing and the sizing / override editors. */
	perpFacetChannel: "facetCol" | "facetRow"
	/** facetAxisMapping accessors: which encoding channel this panel's
	 *  axis controls target for the current chart mode, and its label. */
	axisMapKey: "rowAxis" | "colAxis"
	axisLabelKey: "rowAxisLabel" | "colAxisLabel"
	shareKey: "shareY" | "shareX"
	otherShareKey: "shareX" | "shareY"
	/** Polar share override cleared when the user picks a share mode
	 *  here, so the polar runtime picks up the fresh cartesian value via
	 *  migratePolarShareValue's fallback instead of a stale wrap-mode
	 *  pick (user clicked "None" expecting per-panel scales but a
	 *  leftover "all" would still force sharing). */
	polarShareClearKey: "shareR" | "shareAngle"
	sizingKey: "proportionalSizingY" | "proportionalSizingX"
	gapKey: "gapY" | "gapX"
	gapLabel: string
	panelDimKey: "panelHeight" | "panelWidth"
	panelDimLabel: string
	renderedDimKey: "heightPx" | "widthPx"
	overallRangeKey: "overallYRange" | "overallXRange"
	overridesKey: "rowAxisOverrides" | "colAxisOverrides"
	/** Which bounds of a `panelAxisOverrides` entry this axis reads. */
	panelBoundKeys: {
		min: "yMin" | "xMin"
		max: "yMax" | "xMax"
	}
	/** Which custom-ticks list of a `panelAxisOverrides` entry it reads. */
	panelTicksKey: "yTicks" | "xTicks"
	subsectionTitle: string
	perGroupLabel: string
	/** Singular / plural nouns for user-facing copy. */
	noun: "row" | "column"
	nounPlural: "rows" | "columns"
	/** React key prefix for per-value override rows. */
	valueKeyPrefix: string
	/** Hint shown when the chart mode has no axis in this direction. */
	noAxisHint: string
}

const ROW_SPEC: FacetAxisSpec = {
	facetChannel: "facetRow",
	perpFacetChannel: "facetCol",
	axisMapKey: "rowAxis",
	axisLabelKey: "rowAxisLabel",
	shareKey: "shareY",
	otherShareKey: "shareX",
	polarShareClearKey: "shareR",
	sizingKey: "proportionalSizingY",
	gapKey: "gapY",
	gapLabel: "Vertical gap",
	panelDimKey: "panelHeight",
	panelDimLabel: "Panel height",
	renderedDimKey: "heightPx",
	overallRangeKey: "overallYRange",
	overridesKey: "rowAxisOverrides",
	panelBoundKeys: { min: "yMin", max: "yMax" },
	panelTicksKey: "yTicks",
	subsectionTitle: "Rows",
	perGroupLabel: "Per row",
	noun: "row",
	nounPlural: "rows",
	valueKeyPrefix: "y-",
	// Pie mode has no R-like channel — there are no row-axis controls to
	// show. The Columns (angle axis) subsection still renders below.
	noAxisHint: "This chart type has no row axis to configure.",
}

const COL_SPEC: FacetAxisSpec = {
	facetChannel: "facetCol",
	perpFacetChannel: "facetRow",
	axisMapKey: "colAxis",
	axisLabelKey: "colAxisLabel",
	shareKey: "shareX",
	otherShareKey: "shareY",
	polarShareClearKey: "shareAngle",
	sizingKey: "proportionalSizingX",
	gapKey: "gapX",
	gapLabel: "Horizontal gap",
	panelDimKey: "panelWidth",
	panelDimLabel: "Panel width",
	renderedDimKey: "widthPx",
	overallRangeKey: "overallXRange",
	overridesKey: "colAxisOverrides",
	panelBoundKeys: { min: "xMin", max: "xMax" },
	panelTicksKey: "xTicks",
	subsectionTitle: "Columns",
	perGroupLabel: "Per column",
	noun: "column",
	nounPlural: "columns",
	valueKeyPrefix: "x-",
	// Defensive fallback for hypothetical future modes with no col-axis
	// channel — none of the current modes hit this branch (cartesian,
	// radar, and pie all have one), but it keeps parity with the row
	// panel's pie case.
	noAxisHint: "This chart type has no column axis to configure.",
}

/** The Rows / Columns subsection for ONE axis: share picker, sizing
 *  toggle, and range editors. The two-variable panel renders one per axis
 *  (Rows, then Columns); the share modes are grid-wide bits in the single
 *  `facet` config. Returns null when the chart mode has no axis in this
 *  direction (pie rows).
 *
 *  `isOwnAxis` gates the polar "Size panels by unit" toggle: it's a
 *  single config bit, so only the Rows subsection surfaces it (otherwise
 *  a radar panel would show it twice). */
const FacetAxisSubsection = ({
	spec,
	cfg,
	updateCfg,
	encodings,
	overrides,
	dataset,
	mode,
	axisMap,
	panelOptions,
	isOwnAxis,
}: {
	spec: FacetAxisSpec
	cfg: FacetConfig
	updateCfg: (next: Partial<FacetConfig>) => void
	encodings: Encodings
	overrides: Record<string, FieldType>
	dataset: DatasetView | undefined
	mode: ChartModeDef
	axisMap: FacetAxisMapping
	/** Every rendered panel (key + display label + the reference its
	 *  bounds are stored under), from the same resolver PlotCanvas draws
	 *  against — drives the per-panel editor. */
	panelOptions: Array<{ key: string; label: string; ref: FacetPanelRef }>
	isOwnAxis: boolean
}) => {
	// Polar charts (radar / pie): the cartesian "Size … by …" toggle
	// writes proportionalSizingX/Y but the polar runtime reads the
	// dedicated proportionalPanelSizing flag — so the cartesian toggle
	// is a no-op for polar. Detect polar here and render the polar
	// "Size panels by unit" toggle instead. Mirrors what the wrap panel
	// does for polar charts (only one of the two toggles ever surfaces
	// at a time, gated by mode).
	const isPolar = mode.canvas.coordFamily === "polar"

	// The facet field in THIS subsection's direction (may be unmapped
	// when rendering the perpendicular axis — a single row / column still
	// has an axis to share or not across the other direction's panels).
	const ownField = encodings[spec.facetChannel]?.field ?? null
	const perpField = encodings[spec.perpFacetChannel]?.field ?? null

	// ── Everything hook-adjacent is computed unconditionally (before any
	// early-returns) so hook ordering stays stable across renders. ──

	// Unique own-axis facet values (stringified, dataset-encounter order)
	// — drive the per-row / per-column axis bound overrides.
	const ownValues = useUniqueFieldValues(dataset, ownField)

	// Unique-value counts per facet channel gate "Per row" / "Per column"
	// availability (per-group sharing requires 2+ panels in both
	// directions to differ from "All panels").
	const ownCount = countUniqueFieldValues(dataset, ownField)
	const perpCount = countUniqueFieldValues(dataset, perpField)
	const perGroupAvailable = ownCount >= 2 && perpCount >= 2

	// Axis variable type drives the sizing toggle's label and effect.
	// Categorical/ordinal → "by category count"; quant/temporal → "by
	// unit range"; unmapped → hide the toggle entirely. The channel we
	// read depends on chart mode — the cfg share/sizing fields are
	// reused regardless.
	const axisChannel = axisMap[spec.axisMapKey]
	const axisField = axisChannel
		? encodings[axisChannel]?.field ?? null
		: null
	// Range editors AND the sizing toggles gate on the field the axis
	// ACTUALLY reads (Length for a bar's measure axis, which `axisField`
	// above — the raw position encoding — misses); the solver's unit-range
	// weights read the same measure extent.
	const axisIsContinuous = axisRangeIsContinuous(
		mode,
		axisChannel === "x" ? "x" : "y",
		encodings,
		dataset ? (f: string) => effectiveType(dataset, f, overrides) : null,
	)
	const drawnAxisField =
		axisChannel === "x" || axisChannel === "y"
			? axisFieldsFor(mode, encodings)[
					axisChannel === "x" ? "xField" : "yField"
				]
			: axisField
	const drawnAxisType =
		drawnAxisField && dataset
			? effectiveType(dataset, drawnAxisField, overrides)
			: null
	const axisType: FieldType | null = axisIsContinuous
		? "quantitative"
		: drawnAxisType

	const share = migrateShareValue(cfg[spec.shareKey])
	const size = migrateProportionalSizing(
		cfg[spec.sizingKey],
		cfg.proportionalSizing,
		cfg.proportionalSizingByUnit,
	)

	// "Size row heights / column widths by …" shows whenever it can change anything —
	// same helper the wrap panel and the runtime use (see its doc). Under
	// share = none with 2+ panels across, each panel sizes by its own
	// range and shorter ones sit inside their row, bottom-aligned. The
	// helper is symmetric in (own, perpendicular), so it serves both specs.
	const showSizing = rowSizingMeaningful(ownCount, perpCount, share)
	// Name the dimension that changes ("row heights" / "column widths");
	// with a single row (column) the sizing is per panel, so say so.
	const sizingDim = spec.noun === "row" ? "heights" : "widths"
	const sizingNoun = `${ownCount >= 2 ? spec.noun : "panel"} ${sizingDim}`

	// Defensive panel-dim / proportional-sizing invariant. Gated on the
	// subsection actually surfacing its axis controls (the mode has an
	// axis in this direction) so it can't fire from the null-render
	// state.
	useClearPanelDimWhenSizing(
		axisChannel != null && showSizing && size !== "off",
		cfg[spec.panelDimKey],
		() => updateCfg({ [spec.panelDimKey]: null } as Partial<FacetConfig>),
	)

	// No axis in this direction for the current mode (pies on the row
	// axis): nothing to share, size, or range.
	if (axisChannel === null) return null

	const axisLabel = axisMap[spec.axisLabelKey]

	// Sizing is meaningless under share="all" (every panel sees the same
	// categories → uniform weights). When the user enables sizing while
	// share is "all", flip share to the compatible option so the toggle
	// actually does something visible: "perGroup" when the grid is 2D,
	// "none" otherwise. Cartesian only — radar / pie have different share
	// semantics and we leave those alone. Enabling sizing also clears the
	// stored panel dimension (it'd silently override the proportional
	// weights at render time) so the user starts from auto.
	const setSizing = (next: FacetSizing) =>
		updateCfg(
			facetSizingPatch(cfg, spec.sizingKey === "proportionalSizingX" ? "x" : "y", next, {
				flipShare: axisMap.showPanelSize,
				perGroupAvailable,
			})
		)

	// Per-group range editor surfaces when each row / column has a single
	// well-defined axis to bound:
	//   - share === "perGroup": all panels in the group share the axis,
	//     so the per-group bound governs that shared scale.
	//   - share === "none" + perpendicular count === 1: each group holds
	//     a single panel, so per-group == per-panel and the override pins
	//     the panel's bounds directly.
	// Both paths use the same storage; PlotCanvas honors them under both
	// share modes via the same lookup.
	const showValueOverrides =
		axisIsContinuous &&
		(share === "perGroup" || (share === "none" && perpCount === 1))
	// share === "none" + 2+ perpendicular panels: every panel has its own
	// axis and there's no row / column to key a group bound on, so the
	// editor lists each panel and writes `gridPanelAxisOverrides` (row
	// value, then column value — the wrap panel's per-panel editors write
	// `panelAxisOverrides` by facet value). Keeps the rule "a continuous
	// axis can always be bounded, shared or not" consistent across the
	// wrap, row, and column panels.
	const showPanelOverrides =
		axisIsContinuous &&
		share === "none" &&
		perpCount >= 2 &&
		panelOptions.length > 0
	// Overall range surfaces under "All panels" sharing on a continuous
	// axis — lets the user pin the shared scale to a "pretty" floor /
	// ceiling.
	const showOverallRange = share === "all" && axisIsContinuous

	const updateOverallRange = (bound: "min" | "max", raw: string) => {
		const next = withBound(cfg[spec.overallRangeKey], bound, raw)
		if (next) {
			updateCfg({ [spec.overallRangeKey]: next } as Partial<FacetConfig>)
		}
	}

	const updateOverallTicks = (ticks: number[] | undefined) =>
		updateCfg({
			[spec.overallRangeKey]: withTicks(cfg[spec.overallRangeKey], ticks),
		} as Partial<FacetConfig>)

	const updateValueTicks = (value: string, ticks: number[] | undefined) =>
		updateCfg({
			[spec.overridesKey]: withTicksInMap(cfg[spec.overridesKey], value, ticks),
		} as Partial<FacetConfig>)

	const updatePanelTicks = (ref: FacetPanelRef, ticks: number[] | undefined) =>
		updateCfg(withGridPanelTicks(cfg, ref, spec.panelTicksKey, ticks))

	const updateValueOverride = (
		value: string,
		bound: "min" | "max",
		raw: string,
	) => {
		const all = withBoundInMap(cfg[spec.overridesKey], value, bound, raw)
		if (all) updateCfg({ [spec.overridesKey]: all } as Partial<FacetConfig>)
	}

	const updatePanelOverride = (
		ref: FacetPanelRef,
		bound: "min" | "max",
		raw: string,
	) => {
		const patch = withGridPanelBound(cfg, ref, spec.panelBoundKeys[bound], raw)
		if (patch) updateCfg(patch)
	}
	/** The stored bounds for one listed panel. */
	const panelOverrideOf = (ref: FacetPanelRef): PanelAxisOverride | undefined =>
		typeof ref === "string"
			? cfg.panelAxisOverrides?.[ref]
			: gridPanelAxisOverride(cfg, ref.row, ref.col)

	const displayShare = perGroupAvailable
		? share
		: share === "perGroup"
			? "all"
			: share

	return (
		<CollapsibleSubsection title={spec.subsectionTitle}>
			<ShareAxisRow
				label={`Share ${axisLabel}`}
				ariaLabel={`Share ${axisLabel}`}
				value={displayShare}
				perGroupLabel={spec.perGroupLabel}
				perGroupAvailable={perGroupAvailable}
				onChange={(next) => {
					const other = migrateShareValue(cfg[spec.otherShareKey])
					updateCfg({
						[spec.shareKey]: next,
						[spec.otherShareKey]: other,
						// Clear the polar override so the polar runtime picks
						// up THIS cartesian value via migratePolarShareValue's
						// fallback (see spec.polarShareClearKey).
						[spec.polarShareClearKey]: undefined,
					} as Partial<FacetConfig>)
				}}
			/>

			{/* Polar charts use a panel-radius sizing toggle that maps to
			 *  proportionalPanelSizing, NOT the cartesian per-axis sizing
			 *  (which has no effect on radar / pie rendering). Hidden
			 *  under share=all where every panel collapses to the global
			 *  max — same gate as the wrap panel. Own-axis only: it's one
			 *  config bit, not a per-axis one. */}
			{isPolar && isOwnAxis && share !== "all" && (
				<SizeByCheckboxRow
					label="Size panels by unit"
					checked={cfg.proportionalPanelSizing === true}
					onChange={(checked) =>
						updateCfg({ proportionalPanelSizing: checked })
					}
				/>
			)}
			{!isPolar &&
				showSizing &&
				(axisType === "categorical" || axisType === "ordinal") && (
					<SizeByCheckboxRow
						label={`Size ${sizingNoun} by category count`}
						checked={size === "categoryCount"}
						onChange={(checked) =>
							setSizing(checked ? "categoryCount" : "off")
						}
					/>
				)}
			{!isPolar &&
				showSizing &&
				(axisType === "quantitative" || axisType === "temporal") && (
					<SizeByCheckboxRow
						label={`Size ${sizingNoun} by unit range`}
						checked={size === "unit"}
						onChange={(checked) => setSizing(checked ? "unit" : "off")}
					/>
				)}

			{showOverallRange && (
				<AxisRangeSection
					title={`${axisLabel} range`}
					entries={[
						{
							key: "overall",
							min: cfg[spec.overallRangeKey]?.min,
							max: cfg[spec.overallRangeKey]?.max,
							onChange: updateOverallRange,
							ticks: cfg[spec.overallRangeKey]?.ticks,
							onTicksChange: updateOverallTicks,
						},
					]}
					isTemporal={drawnAxisType === "temporal"}
				/>
			)}

			{showValueOverrides && ownValues.length > 0 && (
				<AxisRangeSection
					title={`${axisLabel} range per ${spec.noun}`}
					entries={ownValues.map((v) => ({
						key: `${spec.valueKeyPrefix}${v}`,
						label: v,
						min: cfg[spec.overridesKey]?.[v]?.min,
						max: cfg[spec.overridesKey]?.[v]?.max,
						onChange: (bound, raw) => updateValueOverride(v, bound, raw),
						ticks: cfg[spec.overridesKey]?.[v]?.ticks,
						onTicksChange: (ticks) => updateValueTicks(v, ticks),
					}))}
					isTemporal={drawnAxisType === "temporal"}
				/>
			)}

			{showPanelOverrides && (
				<AxisRangeSection
					collapsible
					title={`${axisLabel} range per panel`}
					entries={panelOptions.map((p) => ({
						key: `${spec.valueKeyPrefix}panel-${p.key}`,
						label: p.label,
						min: panelOverrideOf(p.ref)?.[spec.panelBoundKeys.min],
						max: panelOverrideOf(p.ref)?.[spec.panelBoundKeys.max],
						onChange: (bound, raw) => updatePanelOverride(p.ref, bound, raw),
						ticks: panelOverrideOf(p.ref)?.[spec.panelTicksKey],
						onTicksChange: (ticks) => updatePanelTicks(p.ref, ticks),
					}))}
					isTemporal={drawnAxisType === "temporal"}
				/>
			)}
		</CollapsibleSubsection>
	)
}

/** The Facet panel's two-variable ("Two variables…" — `facetRow` and / or
 *  `facetCol` mapped) body: the Row / Column pickers, then the
 *  Rows subsection (y / r axis — a hint on
 *  pies, which have no row axis), the Columns subsection (x / angle), then
 *  "Panel spacing and sizing": both gaps, the panel width / height (each
 *  hidden while proportional sizing drives that dimension), "Hide empty
 *  panels" when BOTH sides are mapped (the row × column cross-product is
 *  the only source of empty panels), and the facet-titles link. A half
 *  pair (one side mapped) is a row-only / column-only grid and still gets
 *  the full panel. `FacetOptionsPanel` picks this or the wrap body by
 *  which channels are mapped. */
export const FacetGridPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataset = useCurrentDatasetView()
	const renderedPanelDims = useAtomValue(currentRenderedPanelInnerDimsAtom)

	const cfg: FacetConfig = useMemo(
		() => ({ ...DEFAULT_FACET_CONFIG, ...configs.facet }),
		[configs.facet],
	)

	// Rendered panels (key + label) from the resolver PlotCanvas draws
	// against, so per-panel range keys match what the renderer looks up.
	const panelOptions = useMemo(
		() =>
			facetPanelOptions(
				resolveFacetPanels(dataset, encodings, levelOrders, overrides, cfg),
			),
		[dataset, encodings, levelOrders, overrides, cfg],
	)

	const updateCfg = (next: Partial<FacetConfig>) => {
		setConfigs((prev) => ({
			...prev,
			facet: {
				...DEFAULT_FACET_CONFIG,
				...prev.facet,
				...next,
			},
		}))
	}

	const mode = useChartModeDef()
	const axisMap = facetAxisMapping(mode)

	const rowField = encodings.facetRow?.field ?? null
	const colField = encodings.facetCol?.field ?? null
	const rowCount = countUniqueFieldValues(dataset, rowField)
	const colCount = countUniqueFieldValues(dataset, colField)

	// A panel dimension conflicts with proportional sizing on the same
	// axis — hide the input while "Size row heights / column widths by …"
	// is actively driving that dimension (same gate the subsections use).
	const sizingActive = (spec: FacetAxisSpec, own: number, perp: number) =>
		axisMap[spec.axisMapKey] != null &&
		migrateProportionalSizing(
			cfg[spec.sizingKey],
			cfg.proportionalSizing,
			cfg.proportionalSizingByUnit,
		) !== "off" &&
		rowSizingMeaningful(own, perp, migrateShareValue(cfg[spec.shareKey]))
	const rowSizingActive = sizingActive(ROW_SPEC, rowCount, colCount)
	const colSizingActive = sizingActive(COL_SPEC, colCount, rowCount)

	const subsectionProps = {
		cfg,
		updateCfg,
		encodings,
		overrides,
		dataset,
		mode,
		axisMap,
		panelOptions,
	}

	return (
		<div className="vc-option-panel">
			<FacetPairPickers />
			{/* Rows first. When the mode has no row axis (pies) surface a
			 *  brief hint so the empty space isn't confusing; Columns below
			 *  still renders. */}
			{axisMap.rowAxis === null ? (
				<div className="vc-help">{ROW_SPEC.noAxisHint}</div>
			) : (
				<FacetAxisSubsection {...subsectionProps} spec={ROW_SPEC} isOwnAxis />
			)}
			<FacetAxisSubsection
				{...subsectionProps}
				spec={COL_SPEC}
				isOwnAxis={false}
			/>

			<CollapsibleSubsection title="Panel spacing and sizing">
				<GapInput
					label={COL_SPEC.gapLabel}
					value={cfg.gapX}
					defaultValue={DEFAULT_FACET_CONFIG.gapX}
					onChange={(n) => updateCfg({ gapX: n })}
				/>
				<GapInput
					label={ROW_SPEC.gapLabel}
					value={cfg.gapY}
					defaultValue={DEFAULT_FACET_CONFIG.gapY}
					onChange={(n) => updateCfg({ gapY: n })}
				/>
				{axisMap.showPanelSize && !colSizingActive && (
					<PanelDimInput
						label={COL_SPEC.panelDimLabel}
						value={cfg.panelWidth}
						autoPx={renderedPanelDims?.widthPx}
						onCommit={(next) => updateCfg({ panelWidth: next })}
					/>
				)}
				{axisMap.showPanelSize && !rowSizingActive && (
					<PanelDimInput
						label={ROW_SPEC.panelDimLabel}
						value={cfg.panelHeight}
						autoPx={renderedPanelDims?.heightPx}
						onCommit={(next) => updateCfg({ panelHeight: next })}
					/>
				)}
				{rowField != null && colField != null && (
					<SizeByCheckboxRow
						label="Hide empty panels"
						checked={cfg.hideEmptyPanels === true}
						onChange={(checked) => updateCfg({ hideEmptyPanels: checked })}
					/>
				)}
				<SidebarJumpLink
					label="Edit facet titles →"
					target={{ section: "Titles", subsection: "facet-titles" }}
				/>
			</CollapsibleSubsection>
		</div>
	)
}
