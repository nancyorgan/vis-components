import { useAtom, useAtomValue } from "jotai"
import { facetPairMapped } from "../../../lib/facetEncoding"
import { FacetGridPanel } from "./FacetGridPanel"
import { FacetPairPickers } from "./FacetPairPickers"
import {
	DEFAULT_FACET_CONFIG,
	migrateProportionalSizing,
	rowSizingMeaningful,
	colSizingMeaningful,
	migratePolarShareValue,
	migrateShareValue,
	type FacetConfig,
} from "../../../lib/channelConfig"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { SidebarJumpLink } from "../../../../../components/ui/SidebarJumpLink"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { axisFieldsFor, axisRangeIsContinuous } from "../../../lib/axisFields"
import { isPieModeId } from "../../../lib/chartModes/families"
import { facetGridPatch, facetSizingPatch, type FacetSizing } from "../../../lib/facetEdits"
import { facetAxisMapping } from "../../../lib/facetAxisMapping"
import { effectiveType } from "../../../lib/fieldType"
import { resolveFacetGrid } from "../../../lib/resolveFacetGrid"
import { uniqueFieldValues } from "../../../lib/uniqueFieldValues"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentRenderedPanelInnerDimsAtom,
	facetPairOpenAtom,
} from "../../../store/atoms"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import {
	AxisRangeSection,
	GapInput,
	PanelDimInput,
	PolarShareAxisPicker,
	ShareAxisRow,
	SizeByCheckboxRow,
	useClearPanelDimWhenSizing,
	withBound,
	withBoundInMap,
	withPanelBound,
	withPanelTicks,
	withTicks,
	withTicksInMap,
} from "./facetSharedControls"

/** The Facet row's one options panel. Which body renders follows the
 *  stored channels the row writes (lib/facetEncoding): the pair
 *  (`facetRow` / `facetCol`, "Two variables…") gets the grid body —
 *  Row / Column pickers first, then data-determined rows ×
 *  columns, strips, Hide empty panels — and a single variable (`facet`)
 *  gets the wrap body below — user-set Dimension, titles above each
 *  panel. Share modes, sizing, gaps, panel size and the range editors
 *  are the same `FacetConfig` either way. A pair just chosen with
 *  nothing mapped yet shows only the pickers. */
export const FacetOptionsPanel = () => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const pairOpen = useAtomValue(facetPairOpenAtom)
	if (facetPairMapped(encodings)) return <FacetGridPanel />
	if (pairOpen && !encodings.facet?.field) {
		return (
			<div className="vc-option-panel">
				<FacetPairPickers />
				<p className="vc-help">
					Pick a variable for rows, for columns, or one of each.
				</p>
			</div>
		)
	}
	if (!encodings.facet?.field) {
		return (
			<div className="vc-option-panel vc-help">
				Map a categorical or ordinal variable to Facet to split the chart
				into panels — one variable wraps into a grid you size; Two
				variables… lays one out by rows and the other by columns.
			</div>
		)
	}
	return <FacetWrapPanel />
}

/** Single-variable (wrap) body: the user sets the grid's rows / columns,
 *  share modes read per LAYOUT row / column, and every panel carries its
 *  own title. */
const FacetWrapPanel = () => {
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

	// Commit a min/max override for one panel. Empty input clears that bound;
	// when every bound on a panel is cleared, drop its entry entirely.
	const updatePanelAxis = (
		panelValue: string,
		bound: "xMin" | "xMax" | "yMin" | "yMax",
		raw: string,
	) => {
		const all = withPanelBound(cfg.panelAxisOverrides, panelValue, bound, raw)
		if (all) updateCfg({ panelAxisOverrides: all })
	}
	// "Custom breaks" for one panel; `undefined` unchecks.
	const updatePanelTicks = (
		panelValue: string,
		field: "xTicks" | "yTicks",
		ticks: number[] | undefined,
	) =>
		updateCfg({
			panelAxisOverrides: withPanelTicks(
				cfg.panelAxisOverrides,
				panelValue,
				field,
				ticks,
			),
		})

	const fieldName = encodings.facet?.field ?? null
	const type =
		dataset && fieldName
			? effectiveType(dataset, fieldName, overrides)
			: "categorical"
	const values =
		dataset && fieldName
			? uniqueFieldValues(dataset.rows, fieldName, { type })
			: []
	const facetCount = values.length
	const grid = resolveFacetGrid(facetCount, cfg.rows, cfg.cols)

	const effectiveRows = grid.rows
	const effectiveCols = grid.cols
	const perGroupAvailable = effectiveRows >= 2 && effectiveCols >= 2

	const mode = useChartModeDef()
	const axisMap = facetAxisMapping(mode)
	// Polar charts (radar / pie) have a different geometry: R + angle
	// instead of x / y. The wrap panel restructures to show R-axis and
	// angle-axis share pickers as flat top-level controls (no Rows /
	// Columns subheaders), a "Size panels by unit" toggle that scales
	// each panel's radius rather than its row/col extent, and no
	// panel-width / panel-height inputs (polar plots fill a square
	// per cell).
	const isPolar = mode.canvas.coordFamily === "polar"
	const isPie = isPieModeId(mode.id)

	// Resolved axis types drive the "size by …" copy: continuous axis →
	// "unit range"; categorical / ordinal → "category count". Unmapped or
	// unknown → hide the toggle entirely (no meaningful weight to apply).
	// Mode-aware like the solver's weights: a bar's measure axis reads
	// Length (or a histogram count), not its raw position channel.
	const axisKind = (
		channel: string | null,
	): "categorical" | "continuous" | null => {
		if (!channel || !dataset) return null
		const getType = (f: string) => effectiveType(dataset, f, overrides)
		let field = encodings[channel as keyof typeof encodings]?.field ?? null
		if (channel === "x" || channel === "y") {
			if (axisRangeIsContinuous(mode, channel, encodings, getType))
				return "continuous"
			const fields = axisFieldsFor(mode, encodings)
			field = channel === "x" ? fields.xField : fields.yField
		}
		const type = field ? getType(field) : null
		if (type === "categorical" || type === "ordinal") return "categorical"
		if (type === "quantitative" || type === "temporal") return "continuous"
		return null
	}
	const colKind = axisKind(axisMap.colAxis)
	const rowKind = axisKind(axisMap.rowAxis)
	const colAxisIsCategorical = colKind === "categorical"
	const colAxisIsContinuous = colKind === "continuous"
	const rowAxisIsCategorical = rowKind === "categorical"
	const rowAxisIsContinuous = rowKind === "continuous"

	const sizeX = migrateProportionalSizing(
		cfg.proportionalSizingX,
		cfg.proportionalSizing,
		cfg.proportionalSizingByUnit,
	)
	const sizeY = migrateProportionalSizing(
		cfg.proportionalSizingY,
		cfg.proportionalSizing,
		cfg.proportionalSizingByUnit,
	)
	const shareX = migrateShareValue(cfg.shareX)
	const shareY = migrateShareValue(cfg.shareY)
	// Polar share modes — independent of shareX/Y but migrate from
	// them when unset for back-compat with saved cartesian-style
	// settings on polar charts.
	const shareR = migratePolarShareValue(
		cfg.shareR,
		cfg.shareY,
		"R",
	)
	const shareAngle = migratePolarShareValue(
		cfg.shareAngle,
		cfg.shareX,
		"angle",
	)
	// "Per row" / "Per column" options need the grid to be 2D —
	// multiple panels per row to share AND multiple rows to
	// differentiate (or vice versa for per-col). Same condition as
	// the cartesian perGroup check.
	const perRowAvailable = perGroupAvailable
	const perColAvailable = perGroupAvailable

	// "Size row heights / column widths by …" shows whenever it can change anything
	// (see the helper doc). Under share = none every panel sizes by its own
	// range: the row takes its tallest panel's height and shorter panels
	// sit inside their cell, bottom-aligned. (The condition lives in
	// channelConfig so PlotCanvas gates its panel-dim overrides on exactly
	// the same shapes.) Labels name the dimension that changes ("row
	// heights" / "column widths"); a single row / column reads as
	// "panel heights" / "panel widths".
	const showRowSizing = rowSizingMeaningful(grid.rows, grid.cols, shareY)
	const showColSizing = colSizingMeaningful(grid.rows, grid.cols, shareX)
	const rowSizingNoun = grid.rows >= 2 ? "row heights" : "panel heights"
	const colSizingNoun = grid.cols >= 2 ? "column widths" : "panel widths"

	// Invariant: a stored panel width / height must not coexist with
	// active proportional sizing on the same axis (see the hook's doc).
	useClearPanelDimWhenSizing(showRowSizing && sizeY !== "off", cfg.panelHeight, () =>
		updateCfg({ panelHeight: null }),
	)
	useClearPanelDimWhenSizing(showColSizing && sizeX !== "off", cfg.panelWidth, () =>
		updateCfg({ panelWidth: null }),
	)

	// Range editors only render for continuous (quantitative / temporal)
	// axes — categorical / ordinal axes have no meaningful min/max bounds.
	// The gate keys off the field the axis ACTUALLY reads (Length for a
	// vertical bar's y axis; always continuous on the measure axis), not
	// the raw position encoding — the same gate the sizing toggles use.
	// `axisRangeIsContinuous` is trait-driven (an axis the mode doesn't draw
	// is never continuous), so a mode-id allowlist in front of it would only
	// subtract — it did, silently dropping hexbin's editors.
	const getType = dataset
		? (field: string) => effectiveType(dataset, field, overrides)
		: null
	// Date axes read and print their custom tick values as dates.
	const drawnAxisFields = axisFieldsFor(mode, encodings)
	const xIsTemporal =
		!!drawnAxisFields.xField && getType?.(drawnAxisFields.xField) === "temporal"
	const yIsTemporal =
		!!drawnAxisFields.yField && getType?.(drawnAxisFields.yField) === "temporal"
	const yRangeApplicable =
		fieldName != null &&
		values.length > 0 &&
		axisRangeIsContinuous(mode, "y", encodings, getType)
	const xRangeApplicable =
		fieldName != null &&
		values.length > 0 &&
		axisRangeIsContinuous(mode, "x", encodings, getType)
	// What range-editor kind to show on each axis based on share mode:
	//   shareY = none      → per-panel ranges (one min/max per facet value)
	//   shareY = perGroup  → per-row ranges (one per layout row)
	//   shareY = all       → one overall range
	// Mirror for X.
	const yRangeKind: "none" | "panel" | "row" | "overall" = !yRangeApplicable
		? "none"
		: shareY === "none"
			? "panel"
			: shareY === "perGroup" && perGroupAvailable
				? "row"
				: "overall"
	const xRangeKind: "none" | "panel" | "col" | "overall" = !xRangeApplicable
		? "none"
		: shareX === "none"
			? "panel"
			: shareX === "perGroup" && perGroupAvailable
				? "col"
				: "overall"

	// Commit a range edit into one of the keyed override maps. The
	// cartesian maps (`rowAxisOverrides` / `colAxisOverrides`) are keyed
	// by stringified layout index here — same maps grid mode uses for
	// facet-value-keyed overrides; the two keyings can't collide (facet
	// values are real names, indices are bare integers). The R-axis maps
	// are kept separate from the cartesian ones so a cartesian↔polar
	// mode flip doesn't cross-pollute settings.
	const updateOverrideMap = (
		mapKey:
			| "rowAxisOverrides"
			| "colAxisOverrides"
			| "rowRAxisOverrides"
			| "colRAxisOverrides"
			| "panelRAxisOverrides",
	) =>
		(entryKey: string, bound: "min" | "max", raw: string) => {
			const map = cfg[mapKey] as
				| Record<string, { min?: number; max?: number }>
				| undefined
			const all = withBoundInMap(map, entryKey, bound, raw)
			if (all) updateCfg({ [mapKey]: all } as Partial<FacetConfig>)
		}
	const updateRowAxisOverride = updateOverrideMap("rowAxisOverrides")
	const updateColAxisOverride = updateOverrideMap("colAxisOverrides")
	const updateRRowOverride = updateOverrideMap("rowRAxisOverrides")
	const updateRColOverride = updateOverrideMap("colRAxisOverrides")
	const updateRPanelOverride = updateOverrideMap("panelRAxisOverrides")
	const updateOverallRange = (
		axis: "y" | "x" | "r",
		bound: "min" | "max",
		raw: string,
	) => {
		const key =
			axis === "y"
				? "overallYRange"
				: axis === "x"
					? "overallXRange"
					: "overallRRange"
		const next = withBound(cfg[key], bound, raw)
		if (next) updateCfg({ [key]: next } as Partial<FacetConfig>)
	}
	// "Custom breaks" on the cartesian range entries (the polar R
	// editors don't offer them).
	const updateOverallTicks = (axis: "y" | "x", ticks: number[] | undefined) => {
		const key = axis === "y" ? "overallYRange" : "overallXRange"
		updateCfg({ [key]: withTicks(cfg[key], ticks) })
	}
	const updateGroupTicks = (
		mapKey: "rowAxisOverrides" | "colAxisOverrides",
		entryKey: string,
		ticks: number[] | undefined,
	) =>
		updateCfg({ [mapKey]: withTicksInMap(cfg[mapKey], entryKey, ticks) })

	// Individual cap: no single axis can exceed the number of facets.
	const maxPerAxis = Math.max(1, facetCount)

	// Enabling proportional sizing clears the stored panel dimension on that
	// axis (it would silently override the weights at render time). A wrap
	// grid never flips the share setting.
	const setSizing = (axis: "x" | "y", next: FacetSizing) =>
		updateCfg(facetSizingPatch(cfg, axis, next, { flipShare: false, perGroupAvailable: false }))

	// Commit a new value for one axis. The other axis SNAPS up to the
	// smallest value that keeps every facet fitted — so e.g. with 5 facets
	// and rows=1, cols becomes 5 (the only legal cols); typing cols=4
	// snaps rows to 2 (yielding a 2×4 grid with one empty cell). When the
	// other axis is already large enough we leave it alone, which lets a
	// user keep an intentionally over-allocated grid (e.g. 3×3 for 5
	// facets) intact while editing the dimension they care about.
	const commitAxis = (
		axis: "rows" | "cols",
		raw: string,
	): Partial<FacetConfig> | null => {
		if (raw.trim() === "") return { [axis]: null }
		return facetGridPatch(cfg, axis, Number.parseInt(raw, 10), facetCount)
	}

	return (
		<div className="vc-option-panel">
			{/* ─── Dimension ───────────────────────────────────────────── */}
			{/* Blank = auto grid. The placeholder shows the resolved auto
			 *  count, and the first spinner click / arrow key steps from it
			 *  rather than from 1. */}
			<CollapsibleSubsection title="Dimension" tipAnchor="facet-dimension">
				<NumberInput
					label="Rows"
					labelClassName={LABEL_COL}
					min={1}
					max={maxPerAxis}
					step={1}
					clamp
					value={cfg.rows ?? null}
					placeholder={String(grid.rows)}
					onChange={(n) => {
						const patch = commitAxis("rows", String(n))
						if (patch) updateCfg(patch)
					}}
					onClear={() => updateCfg({ rows: null })}
				/>
				<NumberInput
					label="Columns"
					labelClassName={LABEL_COL}
					min={1}
					max={maxPerAxis}
					step={1}
					clamp
					value={cfg.cols ?? null}
					placeholder={String(grid.cols)}
					onChange={(n) => {
						const patch = commitAxis("cols", String(n))
						if (patch) updateCfg(patch)
					}}
					onClear={() => updateCfg({ cols: null })}
				/>
			</CollapsibleSubsection>

			{/* ─── Polar: R axis (radar only — pies have no R channel) ───
			 *  Its own subheader: the Share-R picker, then (for the active
			 *  share mode) a divider + R-range editor. The Angle-axis
			 *  subheader and the "Size panels by unit" toggle follow below.
			 *  The cartesian Rows / Columns sections are skipped under
			 *  `isPolar`. */}
			{isPolar && !isPie && (
				<CollapsibleSubsection title="R axis">
					<div className="flex items-start gap-2 text-sm">
						<span className={`shrink-0 pt-1 ${LABEL_COL}`}>
							Share R axis
						</span>
						<div>
							<PolarShareAxisPicker
								value={
									!perGroupAvailable && (shareR === "perRow" || shareR === "perCol")
										? "all"
										: shareR
								}
								perRowAvailable={perRowAvailable}
								perColAvailable={perColAvailable}
								ariaLabel="Share R axis"
								onChange={(next) => updateCfg({ shareR: next })}
							/>
						</div>
					</div>

					{/* "Size panels by unit" — scales each panel's drawn radius
					 *  proportionally to its R range. The largest-unit panel
					 *  renders at full size; others shrink linearly. Hidden under
					 *  shareR="all" — the runtime collapses all panels to the same
					 *  global max, so the toggle would be a no-op. */}
					{shareR !== "all" && (
						<SizeByCheckboxRow
							label="Size panels by unit"
							checked={cfg.proportionalPanelSizing === true}
							onChange={(checked) =>
								updateCfg({ proportionalPanelSizing: checked })
							}
						/>
					)}

					{/* R-axis range editor — a divider plus min/max bounds for
					 *  the active share mode. Surfaces under continuous R only. */}
					{rowAxisIsContinuous && shareR === "all" && (
						<AxisRangeSection
							title="R axis range"
							entries={[
								{
									key: "overall-r",
									min: cfg.overallRRange?.min,
									max: cfg.overallRRange?.max,
									onChange: (bound, raw) =>
										updateOverallRange("r", bound, raw),
								},
							]}
						/>
					)}

					{rowAxisIsContinuous &&
						shareR === "perRow" &&
						perRowAvailable && (
							<AxisRangeSection
								title="R axis range per row"
								entries={Array.from({ length: grid.rows }, (_, r) => ({
									key: `rrow-${r}`,
									label: `Row ${r + 1}`,
									min: cfg.rowRAxisOverrides?.[String(r)]?.min,
									max: cfg.rowRAxisOverrides?.[String(r)]?.max,
									onChange: (bound, raw) =>
										updateRRowOverride(String(r), bound, raw),
								}))}
							/>
						)}

					{rowAxisIsContinuous &&
						shareR === "perCol" &&
						perColAvailable && (
							<AxisRangeSection
								title="R axis range per column"
								entries={Array.from({ length: grid.cols }, (_, c) => ({
									key: `rcol-${c}`,
									label: `Column ${c + 1}`,
									min: cfg.colRAxisOverrides?.[String(c)]?.min,
									max: cfg.colRAxisOverrides?.[String(c)]?.max,
									onChange: (bound, raw) =>
										updateRColOverride(String(c), bound, raw),
								}))}
							/>
						)}

					{rowAxisIsContinuous &&
						shareR === "none" &&
						fieldName &&
						values.length > 0 && (
							<AxisRangeSection
								collapsible
								title="R axis range per panel"
								entries={values.map((v) => ({
									key: `rpanel-${v}`,
									label: v,
									min: cfg.panelRAxisOverrides?.[v]?.min,
									max: cfg.panelRAxisOverrides?.[v]?.max,
									onChange: (bound, raw) =>
										updateRPanelOverride(v, bound, raw),
								}))}
							/>
						)}

				</CollapsibleSubsection>
			)}

			{/* ─── Polar: Angle axis ─────────────────────────────────────
			 *  Its own subheader holding the Share-angle picker. Shown for
			 *  radar and pies — the angle channel exists in both. */}
			{isPolar && (
				<CollapsibleSubsection title="Angle axis">
					<div className="flex items-start gap-2 text-sm">
						<span className={`shrink-0 pt-1 ${LABEL_COL}`}>
							Share Angle axis
						</span>
						<div>
							<PolarShareAxisPicker
								value={
									!perGroupAvailable &&
									(shareAngle === "perRow" || shareAngle === "perCol")
										? "all"
										: shareAngle
								}
								perRowAvailable={perRowAvailable}
								perColAvailable={perColAvailable}
								ariaLabel="Share Angle axis"
								onChange={(next) => updateCfg({ shareAngle: next })}
							/>
						</div>
					</div>

					{/* Pies have no R axis to share, so their "Size panels by unit"
					 *  toggle (scaling each panel's radius by its slice total)
					 *  lives here under the angle axis. */}
					{isPie && (
						<SizeByCheckboxRow
							label="Size panels by unit"
							checked={cfg.proportionalPanelSizing === true}
							onChange={(checked) =>
								updateCfg({ proportionalPanelSizing: checked })
							}
						/>
					)}
				</CollapsibleSubsection>
			)}

			{/* ─── Rows (Y / R axis controls) ──────────────────────────── */}
			{!isPolar && axisMap.rowAxis !== null && (
				<CollapsibleSubsection title="Rows">

					<ShareAxisRow
						label={`Share ${axisMap.rowAxisLabel}`}
						ariaLabel={`Share ${axisMap.rowAxisLabel}`}
						value={
							perGroupAvailable
								? shareY
								: shareY === "perGroup"
									? "all"
									: shareY
						}
						perGroupLabel="Per row"
						perGroupAvailable={perGroupAvailable}
						onChange={(next) => {
							updateCfg({
								shareX,
								shareY: next,
							})
						}}
					/>

					{showRowSizing && rowAxisIsCategorical && (
						<SizeByCheckboxRow
							label={`Size ${rowSizingNoun} by category count`}
							checked={sizeY === "categoryCount"}
							onChange={(checked) => setSizing("y", checked ? "categoryCount" : "off")}
						/>
					)}
					{showRowSizing && rowAxisIsContinuous && (
						<SizeByCheckboxRow
							label={`Size ${rowSizingNoun} by unit range`}
							checked={sizeY === "unit"}
							onChange={(checked) => setSizing("y", checked ? "unit" : "off")}
						/>
					)}

					{yRangeKind === "overall" && (
						<AxisRangeSection
							title="Y axis range"
							entries={[
								{
									key: "overall-y",
									min: cfg.overallYRange?.min,
									max: cfg.overallYRange?.max,
									onChange: (bound, raw) =>
										updateOverallRange("y", bound, raw),
									ticks: cfg.overallYRange?.ticks,
									onTicksChange: (ticks) => updateOverallTicks("y", ticks),
								},
							]}
							isTemporal={yIsTemporal}
						/>
					)}

					{yRangeKind === "row" && (
						<AxisRangeSection
							title="Y axis range per row"
							entries={Array.from({ length: grid.rows }, (_, r) => ({
								key: `yrow-${r}`,
								label: `Row ${r + 1}`,
								min: cfg.rowAxisOverrides?.[String(r)]?.min,
								max: cfg.rowAxisOverrides?.[String(r)]?.max,
								onChange: (bound, raw) =>
									updateRowAxisOverride(String(r), bound, raw),
								ticks: cfg.rowAxisOverrides?.[String(r)]?.ticks,
								onTicksChange: (ticks) =>
									updateGroupTicks("rowAxisOverrides", String(r), ticks),
							}))}
							isTemporal={yIsTemporal}
						/>
					)}

					{yRangeKind === "panel" && (
						<AxisRangeSection
							collapsible
							title="Y axis range per panel"
							entries={values.map((v) => ({
								key: `y-${v}`,
								label: v,
								min: cfg.panelAxisOverrides[v]?.yMin,
								max: cfg.panelAxisOverrides[v]?.yMax,
								onChange: (bound, raw) =>
									updatePanelAxis(v, bound === "min" ? "yMin" : "yMax", raw),
								ticks: cfg.panelAxisOverrides[v]?.yTicks,
								onTicksChange: (ticks) => updatePanelTicks(v, "yTicks", ticks),
							}))}
							isTemporal={yIsTemporal}
						/>
					)}
				</CollapsibleSubsection>
			)}

			{/* ─── Columns (X / angle axis controls) ───────────────────── */}
			{!isPolar && axisMap.colAxis !== null && (
				<CollapsibleSubsection title="Columns">

					<ShareAxisRow
						label={`Share ${axisMap.colAxisLabel}`}
						ariaLabel={`Share ${axisMap.colAxisLabel}`}
						value={
							perGroupAvailable
								? shareX
								: shareX === "perGroup"
									? "all"
									: shareX
						}
						perGroupLabel="Per column"
						perGroupAvailable={perGroupAvailable}
						onChange={(next) => {
							updateCfg({
								shareX: next,
								shareY,
							})
						}}
					/>

					{showColSizing && colAxisIsCategorical && (
						<SizeByCheckboxRow
							label={`Size ${colSizingNoun} by category count`}
							checked={sizeX === "categoryCount"}
							onChange={(checked) => setSizing("x", checked ? "categoryCount" : "off")}
						/>
					)}
					{showColSizing && colAxisIsContinuous && (
						<SizeByCheckboxRow
							label={`Size ${colSizingNoun} by unit range`}
							checked={sizeX === "unit"}
							onChange={(checked) => setSizing("x", checked ? "unit" : "off")}
						/>
					)}

					{xRangeKind === "overall" && (
						<AxisRangeSection
							title="X axis range"
							entries={[
								{
									key: "overall-x",
									min: cfg.overallXRange?.min,
									max: cfg.overallXRange?.max,
									onChange: (bound, raw) =>
										updateOverallRange("x", bound, raw),
									ticks: cfg.overallXRange?.ticks,
									onTicksChange: (ticks) => updateOverallTicks("x", ticks),
								},
							]}
							isTemporal={xIsTemporal}
						/>
					)}

					{xRangeKind === "col" && (
						<AxisRangeSection
							title="X axis range per column"
							entries={Array.from({ length: grid.cols }, (_, c) => ({
								key: `xcol-${c}`,
								label: `Column ${c + 1}`,
								min: cfg.colAxisOverrides?.[String(c)]?.min,
								max: cfg.colAxisOverrides?.[String(c)]?.max,
								onChange: (bound, raw) =>
									updateColAxisOverride(String(c), bound, raw),
								ticks: cfg.colAxisOverrides?.[String(c)]?.ticks,
								onTicksChange: (ticks) =>
									updateGroupTicks("colAxisOverrides", String(c), ticks),
							}))}
							isTemporal={xIsTemporal}
						/>
					)}

					{xRangeKind === "panel" && (
						<AxisRangeSection
							collapsible
							title="X axis range per panel"
							entries={values.map((v) => ({
								key: `x-${v}`,
								label: v,
								min: cfg.panelAxisOverrides[v]?.xMin,
								max: cfg.panelAxisOverrides[v]?.xMax,
								onChange: (bound, raw) =>
									updatePanelAxis(v, bound === "min" ? "xMin" : "xMax", raw),
								ticks: cfg.panelAxisOverrides[v]?.xTicks,
								onTicksChange: (ticks) => updatePanelTicks(v, "xTicks", ticks),
							}))}
							isTemporal={xIsTemporal}
						/>
					)}
				</CollapsibleSubsection>
			)}

			{/* ─── Panel spacing and sizing ──────────────────────────────────────── */}
			<CollapsibleSubsection title="Panel spacing and sizing">
				<GapInput
					label="Horizontal gap"
					value={cfg.gapX}
					defaultValue={DEFAULT_FACET_CONFIG.gapX}
					onChange={(n) => updateCfg({ gapX: n })}
				/>
				<GapInput
					label="Vertical gap"
					value={cfg.gapY}
					defaultValue={DEFAULT_FACET_CONFIG.gapY}
					onChange={(n) => updateCfg({ gapY: n })}
				/>
				{axisMap.showPanelSize &&
					(() => {
						// Hide a panel-size input when the perpendicular sizing
						// toggle would otherwise fight it: an explicit panel
						// width / height can't coexist with proportional sizing
						// on the same axis. Mirrors what the runtime does
						// (panelWidth / panelHeight bypass proportional weight)
						// — surface only the input that's still meaningful.
						const showWidth = !(showColSizing && sizeX !== "off")
						const showHeight = !(showRowSizing && sizeY !== "off")
						if (!showWidth && !showHeight) return null
						return (
							<>
								{showWidth && (
									<PanelDimInput
										label="Panel width"
										value={cfg.panelWidth}
										autoPx={renderedPanelDims?.widthPx}
										onCommit={(next) => updateCfg({ panelWidth: next })}
									/>
								)}
								{showHeight && (
									<PanelDimInput
										label="Panel height"
										value={cfg.panelHeight}
										autoPx={renderedPanelDims?.heightPx}
										onCommit={(next) => updateCfg({ panelHeight: next })}
									/>
								)}
							</>
						)
					})()}
				<SidebarJumpLink
					label="Edit facet titles →"
					target={{ section: "Titles", subsection: "facet-titles" }}
				/>
			</CollapsibleSubsection>
		</div>
	)
}
