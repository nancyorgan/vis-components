import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_FACET_CONFIG,
	migrateProportionalSizing,
	migrateShareValue,
	type FacetConfig,
} from "../../../lib/channelConfig"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { facetAxisMapping } from "../../../lib/facetAxisMapping"
import { effectiveType } from "../../../lib/fieldType"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentRenderedPanelInnerDimsAtom,
} from "../../../store/atoms"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
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
} from "./facetSharedControls"

/** Everything that differs between the facetRow and facetCol option
 *  panels, as data. The two panels are exact mirrors of each other under
 *  this renaming — `FacetAxisOptionsPanel` below implements the shared
 *  logic once and reads the axis-specific keys / copy from here. */
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
	subsectionTitle: string
	perGroupLabel: string
	/** Singular / plural nouns for user-facing copy. */
	noun: "row" | "column"
	nounPlural: "rows" | "columns"
	/** React key prefix for per-value override rows. */
	valueKeyPrefix: string
	/** Hint shown when the facet channel isn't mapped. */
	emptyHint: string
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
	gapLabel: "Gap Y",
	panelDimKey: "panelHeight",
	panelDimLabel: "Panel height",
	renderedDimKey: "heightPx",
	overallRangeKey: "overallYRange",
	overridesKey: "rowAxisOverrides",
	subsectionTitle: "Rows",
	perGroupLabel: "Per row",
	noun: "row",
	nounPlural: "rows",
	valueKeyPrefix: "y-",
	emptyHint:
		"Map a categorical field to Facet (row) to control row-specific layout options.",
	// Pie mode has no R-like channel — the row panel has no axis-specific
	// controls to show; point the user at the col panel instead.
	noAxisHint:
		"This chart type has no row axis to configure. Use the column panel for angle-axis options.",
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
	gapLabel: "Gap X",
	panelDimKey: "panelWidth",
	panelDimLabel: "Panel width",
	renderedDimKey: "widthPx",
	overallRangeKey: "overallXRange",
	overridesKey: "colAxisOverrides",
	subsectionTitle: "Columns",
	perGroupLabel: "Per column",
	noun: "column",
	nounPlural: "columns",
	valueKeyPrefix: "x-",
	emptyHint:
		"Map a categorical field to Facet (col) to control column-specific layout options.",
	// Defensive fallback for hypothetical future modes with no col-axis
	// channel — none of the current modes hit this branch (cartesian,
	// radar, and pie all have one), but it keeps parity with the row
	// panel's pie case.
	noAxisHint: "This chart type has no column axis to configure.",
}

/** Shared implementation of the facetRow / facetCol option panels.
 *  Hosts only the controls for the panel's own axis — share, gap,
 *  panel dimension, the sizing toggle, and per-group axis bound
 *  overrides. Which encoding channel that axis targets depends on the
 *  chart mode (y / x for cartesian, r / angle for radar, none / angle
 *  for pies) — see `facetAxisMapping`. The wrap panel
 *  (`FacetOptionsPanel`) surfaces both axes at once. */
export const FacetAxisOptionsPanel = ({ axis }: { axis: "row" | "col" }) => {
	const spec = axis === "row" ? ROW_SPEC : COL_SPEC
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	const renderedPanelDims = useAtomValue(currentRenderedPanelInnerDimsAtom)

	const cfg: FacetConfig = {
		...DEFAULT_FACET_CONFIG,
		...configs.facet,
	}

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
	const axisMap = facetAxisMapping(mode.id)
	// Polar charts (radar / pie): the cartesian "Size … by …" toggle
	// writes proportionalSizingX/Y but the polar runtime reads the
	// dedicated proportionalPanelSizing flag — so the cartesian toggle
	// is a no-op for polar. Detect polar here and render the polar
	// "Size panels by unit" toggle instead. Mirrors what the wrap panel
	// does for polar charts (only one of the two toggles ever surfaces
	// at a time, gated by mode).
	const isPolar =
		mode.id === "radar" ||
		mode.id === "pies" ||
		mode.id === "pies-x" ||
		mode.id === "pies-y"

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
	const axisType =
		axisField && dataset ? effectiveType(dataset, axisField, overrides) : null
	const axisIsContinuous =
		axisType === "quantitative" || axisType === "temporal"

	const share = migrateShareValue(cfg[spec.shareKey], cfg.shareAxes)
	const size = migrateProportionalSizing(
		cfg[spec.sizingKey],
		cfg.proportionalSizing,
		cfg.proportionalSizingByUnit,
	)

	// "Size rows/columns by …" only makes sense when each row / column
	// has a single well-defined axis characteristic. Mirrors wrap-panel's
	// gate ([[feedback-size-by-toggle-gating]]):
	//   - perpendicular count == 1 + share=none → each group is one panel
	//   - perpendicular count >= 2 + share=perGroup → the group shares
	// Everything else collapses to uniform weights or is ambiguous.
	const showSizing =
		ownCount >= 2 &&
		((perpCount === 1 && share === "none") ||
			(perpCount >= 2 && share === "perGroup"))

	// Defensive panel-dim / proportional-sizing invariant. Gated on the
	// panel actually surfacing its axis controls (field mapped + the mode
	// has an axis in this direction) so it can't fire from the hint-only
	// early-return states.
	useClearPanelDimWhenSizing(
		ownField != null &&
			axisChannel != null &&
			showSizing &&
			size !== "off",
		cfg[spec.panelDimKey],
		() => updateCfg({ [spec.panelDimKey]: null } as Partial<FacetConfig>),
	)

	// Empty state: nothing meaningful to configure if the facet channel
	// isn't mapped yet. Mirror the wrap panel's "map a field" hint copy.
	if (!ownField) {
		return (
			<div className="vc-option-panel text-sm text-th-electric-indigo-700 dark:text-stone-400">
				{spec.emptyHint}
			</div>
		)
	}

	// No axis in this direction for the current mode (pies on the row
	// panel). Keep the gap input (panel layout still applies) and surface
	// a brief hint so the empty space isn't confusing.
	if (axisChannel === null) {
		return (
			<div className="vc-option-panel flex flex-col gap-3">
				<div className="text-sm text-th-electric-indigo-700 dark:text-stone-400">
					{spec.noAxisHint}
				</div>
				<GapInput
					label={spec.gapLabel}
					value={cfg[spec.gapKey]}
					defaultValue={DEFAULT_FACET_CONFIG[spec.gapKey]}
					onChange={(n) =>
						updateCfg({ [spec.gapKey]: n } as Partial<FacetConfig>)
					}
				/>
			</div>
		)
	}

	const axisLabel = axisMap[spec.axisLabelKey]
	const axisLabelLower = axisLabel.toLowerCase()

	// Sizing is meaningless under share="all" (every panel sees the same
	// categories → uniform weights). When the user enables sizing while
	// share is "all", flip share to the compatible option so the toggle
	// actually does something visible: "perGroup" when the grid is 2D,
	// "none" otherwise. Cartesian only — radar / pie have different share
	// semantics and we leave those alone. Enabling sizing also clears the
	// stored panel dimension (it'd silently override the proportional
	// weights at render time) so the user starts from auto.
	const setSizing = (next: "off" | "categoryCount" | "unit") => {
		const patch = { [spec.sizingKey]: next } as Partial<FacetConfig>
		if (next !== "off" && axisMap.showPanelSize && share === "all") {
			patch[spec.shareKey] = perGroupAvailable ? "perGroup" : "none"
		}
		if (next !== "off") patch[spec.panelDimKey] = null
		updateCfg(patch)
	}

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

	const updateValueOverride = (
		value: string,
		bound: "min" | "max",
		raw: string,
	) => {
		const all = withBoundInMap(cfg[spec.overridesKey], value, bound, raw)
		if (all) updateCfg({ [spec.overridesKey]: all } as Partial<FacetConfig>)
	}

	// The help text depends on which path activated the editor: under
	// "perGroup" it pins the group's SHARED scale; under "none" with one
	// perpendicular panel it pins each group's single panel directly.
	const valueRangeHelp =
		share === "perGroup"
			? `Blank = auto from each ${spec.noun}'s data.`
			: "Blank = auto from each panel's data."

	const displayShare = perGroupAvailable
		? share
		: share === "perGroup"
			? "all"
			: share

	return (
		<div className="vc-option-panel flex flex-col gap-3">
			<CollapsibleSubsection title={spec.subsectionTitle}>
				<ShareAxisRow
					label={`Share ${axisLabelLower}`}
					ariaLabel={`Share ${axisLabel}`}
					value={displayShare}
					perGroupLabel={spec.perGroupLabel}
					perGroupAvailable={perGroupAvailable}
					onChange={(next) => {
						const other = migrateShareValue(
							cfg[spec.otherShareKey],
							cfg.shareAxes,
						)
						updateCfg({
							[spec.shareKey]: next,
							[spec.otherShareKey]: other,
							shareAxes: next === "all" && other === "all",
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
				 *  max — same gate as the wrap panel. */}
				{isPolar && share !== "all" && (
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
							label={`Size ${spec.nounPlural} by category count`}
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
							label={`Size ${spec.nounPlural} by unit range`}
							checked={size === "unit"}
							onChange={(checked) => setSizing(checked ? "unit" : "off")}
						/>
					)}

				{showOverallRange && (
					<AxisRangeSection
						title={`${axisLabel} range`}
						help={`Blank = auto-fit. Set a bound to pin the shared ${axisLabelLower} (e.g. min = 0).`}
						entries={[
							{
								key: "overall",
								min: cfg[spec.overallRangeKey]?.min,
								max: cfg[spec.overallRangeKey]?.max,
								onChange: updateOverallRange,
							},
						]}
					/>
				)}

				{showValueOverrides && ownValues.length > 0 && (
					<AxisRangeSection
						title={`${axisLabel} range per ${spec.noun}`}
						help={valueRangeHelp}
						entries={ownValues.map((v) => ({
							key: `${spec.valueKeyPrefix}${v}`,
							label: v,
							min: cfg[spec.overridesKey]?.[v]?.min,
							max: cfg[spec.overridesKey]?.[v]?.max,
							onChange: (bound, raw) => updateValueOverride(v, bound, raw),
						}))}
					/>
				)}
			</CollapsibleSubsection>

			<CollapsibleSubsection title="Custom sizing">
				<GapInput
					label={spec.gapLabel}
					value={cfg[spec.gapKey]}
					defaultValue={DEFAULT_FACET_CONFIG[spec.gapKey]}
					onChange={(n) =>
						updateCfg({ [spec.gapKey]: n } as Partial<FacetConfig>)
					}
				/>

				{/* Panel dimension conflicts with proportional sizing — hide it
				 *  when "Size rows/columns by …" is actively driving sizes. */}
				{axisMap.showPanelSize && !(showSizing && size !== "off") && (
					<PanelDimInput
						label={spec.panelDimLabel}
						value={cfg[spec.panelDimKey]}
						autoPx={renderedPanelDims?.[spec.renderedDimKey]}
						onCommit={(next) =>
							updateCfg({
								[spec.panelDimKey]: next,
							} as Partial<FacetConfig>)
						}
					/>
				)}

				{/* Grid mode only (both facet channels mapped) — the row × col
				 *  cross-product is the only source of empty panels. ownField is
				 *  already non-null here (the map-a-field hint early-returns
				 *  above), so the perpendicular channel is the whole gate. One
				 *  code site, same config bit: the control mirrors into both
				 *  the row and col panels by design. */}
				{perpField != null && (
					<SizeByCheckboxRow
						label="Hide empty panels"
						checked={cfg.hideEmptyPanels === true}
						onChange={(checked) => updateCfg({ hideEmptyPanels: checked })}
					/>
				)}
			</CollapsibleSubsection>
		</div>
	)
}
