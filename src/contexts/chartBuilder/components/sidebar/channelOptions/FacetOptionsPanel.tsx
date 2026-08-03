import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_FACET_CONFIG,
	migrateProportionalSizing,
	rowSizingMeaningful,
	colSizingMeaningful,
	migratePolarShareValue,
	migrateShareValue,
	type FacetConfig,
	type PanelAxisOverride,
} from "../../../lib/channelConfig"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { facetAxisMapping } from "../../../lib/facetAxisMapping"
import { effectiveType } from "../../../lib/fieldType"
import { resolveFacetGrid } from "../../../lib/resolveFacetGrid"
import { parseValue } from "../../../lib/scales"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentRenderedPanelInnerDimsAtom,
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
} from "./facetSharedControls"

type OverridableAxis = "x" | "y"

const getOverridableAxes = (modeId: string): OverridableAxis[] => {
	if (modeId === "scatter") return ["x", "y"]
	if (modeId === "bars-x" || modeId === "areas-x") return ["y"]
	if (modeId === "bars-y" || modeId === "areas-y") return ["x"]
	return []
}


export const FacetOptionsPanel = () => {
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
		bound: keyof PanelAxisOverride,
		raw: string,
	) => {
		const current: PanelAxisOverride = cfg.panelAxisOverrides[panelValue] ?? {}
		const next: PanelAxisOverride = { ...current }
		if (raw.trim() === "") {
			delete next[bound]
		} else {
			const n = Number(raw)
			if (!Number.isFinite(n)) return
			next[bound] = n
		}
		const allOverrides = { ...cfg.panelAxisOverrides }
		const stillHasAny =
			next.xMin !== undefined ||
			next.xMax !== undefined ||
			next.yMin !== undefined ||
			next.yMax !== undefined
		if (stillHasAny) {
			allOverrides[panelValue] = next
		} else {
			delete allOverrides[panelValue]
		}
		updateCfg({ panelAxisOverrides: allOverrides })
	}

	const fieldName = encodings.facet?.field ?? null
	const type =
		dataset && fieldName
			? effectiveType(dataset, fieldName, overrides)
			: "categorical"
	const values =
		dataset && fieldName
			? [
					...new Set(
						dataset.rows
							.map((r) => parseValue(r[fieldName], type))
							.filter((v) => v !== null)
							.map(String),
					),
				]
			: []
	const facetCount = values.length
	const grid = resolveFacetGrid(facetCount, cfg.rows, cfg.cols)

	const effectiveRows = grid.rows
	const effectiveCols = grid.cols
	const perGroupAvailable = effectiveRows >= 2 && effectiveCols >= 2

	const mode = useChartModeDef()
	const overridableAxes = getOverridableAxes(mode.id)
	const axisMap = facetAxisMapping(mode.id)
	// Polar charts (radar / pie) have a different geometry: R + angle
	// instead of x / y. The wrap panel restructures to show R-axis and
	// angle-axis share pickers as flat top-level controls (no Rows /
	// Columns subheaders), a "Size panels by unit" toggle that scales
	// each panel's radius rather than its row/col extent, and no
	// panel-width / panel-height inputs (polar plots fill a square
	// per cell).
	const isPolar =
		mode.id === "radar" ||
		mode.id === "pies" ||
		mode.id === "pies-x" ||
		mode.id === "pies-y"
	const isPie =
		mode.id === "pies" || mode.id === "pies-x" || mode.id === "pies-y"

	// Resolved axis types drive the "size by …" copy: continuous axis →
	// "unit range"; categorical / ordinal → "category count". Unmapped or
	// unknown → hide the toggle entirely (no meaningful weight to apply).
	const colAxisField = axisMap.colAxis
		? encodings[axisMap.colAxis]?.field ?? null
		: null
	const colAxisType =
		colAxisField && dataset
			? effectiveType(dataset, colAxisField, overrides)
			: null
	const colAxisIsCategorical =
		colAxisType === "categorical" || colAxisType === "ordinal"
	const colAxisIsContinuous =
		colAxisType === "quantitative" || colAxisType === "temporal"
	const rowAxisField = axisMap.rowAxis
		? encodings[axisMap.rowAxis]?.field ?? null
		: null
	const rowAxisType =
		rowAxisField && dataset
			? effectiveType(dataset, rowAxisField, overrides)
			: null
	const rowAxisIsCategorical =
		rowAxisType === "categorical" || rowAxisType === "ordinal"
	const rowAxisIsContinuous =
		rowAxisType === "quantitative" || rowAxisType === "temporal"

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
	const shareX = migrateShareValue(cfg.shareX, cfg.shareAxes)
	const shareY = migrateShareValue(cfg.shareY, cfg.shareAxes)
	// Polar share modes — independent of shareX/Y but migrate from
	// them when unset for back-compat with saved cartesian-style
	// settings on polar charts.
	const shareR = migratePolarShareValue(
		cfg.shareR,
		cfg.shareY,
		cfg.shareAxes,
		"R",
	)
	const shareAngle = migratePolarShareValue(
		cfg.shareAngle,
		cfg.shareX,
		cfg.shareAxes,
		"angle",
	)
	// "Per row" / "Per column" options need the grid to be 2D —
	// multiple panels per row to share AND multiple rows to
	// differentiate (or vice versa for per-col). Same condition as
	// the cartesian perGroup check.
	const perRowAvailable = perGroupAvailable
	const perColAvailable = perGroupAvailable

	// "Size rows by …" assigns ONE weight per row, so it only makes sense
	// when each row has a well-defined Y characteristic:
	//   - grid.cols == 1 + shareY = none  → each row is a single panel
	//     with its own Y → row weight = that panel's range. ✓
	//   - grid.cols >= 2 + shareY = perGroup → each row shares a Y across
	//     its panels → row weight = the shared range. ✓
	// Everything else collapses to uniform weights (all panels same Y under
	// "all"; all rows same range under 1-col + share=all) OR makes the
	// per-row weight ambiguous (multiple panels per row each with their own
	// Y under "none" + 2D grid) — user-reported the latter: a 2×2 wrap
	// with shareY=none sized rows by the MAX panel range, so a row holding
	// a 0–3 panel and a 0–4 panel got one height when the user expected
	// each panel to size independently. Per-panel sizing would need a
	// solver rewrite; for now we just hide the toggle in that case.
	// (The condition lives in channelConfig so PlotCanvas gates its
	// panel-dim overrides on exactly the same shapes — see the helper doc.)
	const showRowSizing = rowSizingMeaningful(grid.rows, grid.cols, shareY)
	const showColSizing = colSizingMeaningful(grid.rows, grid.cols, shareX)

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
	const yRangeApplicable =
		fieldName != null &&
		values.length > 0 &&
		overridableAxes.includes("y") &&
		(rowAxisIsContinuous ?? false)
	const xRangeApplicable =
		fieldName != null &&
		values.length > 0 &&
		overridableAxes.includes("x") &&
		(colAxisIsContinuous ?? false)
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

	// Individual cap: no single axis can exceed the number of facets.
	const maxPerAxis = Math.max(1, facetCount)

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
		const n = Number.parseInt(raw, 10)
		if (!Number.isFinite(n) || n < 1) return null
		if (n > maxPerAxis) return null
		const otherKey: "rows" | "cols" = axis === "rows" ? "cols" : "rows"
		const other = otherKey === "cols" ? cfg.cols : cfg.rows
		const minLegalOther = Math.max(1, Math.ceil(facetCount / n))
		if (other == null || other < minLegalOther) {
			return { [axis]: n, [otherKey]: minLegalOther }
		}
		return { [axis]: n }
	}

	// When the wrap channel isn't mapped, surface only the empty-state
	// hint. Same pattern the row / col panels use. Without this gate the
	// wrap panel's sharing / sizing / range controls would still be
	// interactive — they all write to the same `cfg.facet` config the row
	// and col panels read, so user-reported edits made here could shadow
	// or conflict with whichever facet channel is actually mapped.
	if (!fieldName) {
		return (
			<div className="vc-option-panel text-sm text-th-electric-indigo-700 dark:text-stone-400">
				Map a categorical field to Facet (wrap) to split the chart into
				panels.
			</div>
		)
	}

	return (
		<div className="vc-option-panel flex flex-col gap-3">
			{/* ─── Dimension ───────────────────────────────────────────── */}
			<CollapsibleSubsection title="Dimension">
				<label className="flex items-center gap-2 pl-1 text-sm">
					<span className="w-24 text-stone-600 dark:text-stone-400">Rows</span>
					<input
						type="number"
						min={1}
						max={maxPerAxis}
						step={1}
						value={cfg.rows ?? ""}
						placeholder={String(grid.rows)}
						onChange={(e) => {
							const patch = commitAxis("rows", e.target.value)
							if (patch) updateCfg(patch)
						}}
						className="w-20 rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
					/>
				</label>
				<label className="mt-2 flex items-center gap-2 pl-1 text-sm">
					<span className="w-24 text-stone-600 dark:text-stone-400">Columns</span>
					<input
						type="number"
						min={1}
						max={maxPerAxis}
						step={1}
						value={cfg.cols ?? ""}
						placeholder={String(grid.cols)}
						onChange={(e) => {
							const patch = commitAxis("cols", e.target.value)
							if (patch) updateCfg(patch)
						}}
						className="w-20 rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
					/>
				</label>
			</CollapsibleSubsection>

			{/* ─── Polar: R axis (radar only — pies have no R channel) ───
			 *  Its own subheader: the Share-R picker, then (for the active
			 *  share mode) a divider + R-range editor. The Angle-axis
			 *  subheader and the "Size panels by unit" toggle follow below.
			 *  The cartesian Rows / Columns sections are skipped under
			 *  `isPolar`. */}
			{isPolar && !isPie && (
				<CollapsibleSubsection title="R axis">
					<div className="flex items-start gap-2 pl-1 text-sm">
						<span className="w-24 shrink-0 pt-1 text-stone-600 dark:text-stone-400">
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
							className="pl-1"
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
							className="pl-1"
							title="R axis range"
							help="Blank = auto-fit. Set a bound to pin the shared R axis (e.g. min = 0)."
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
								className="pl-1"
								title="R axis range per row"
								help="Blank = auto from each row's data."
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
								className="pl-1"
								title="R axis range per column"
								help="Blank = auto from each column's data."
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
								className="pl-1"
								title="R axis range per panel"
								help="Blank = auto from each panel's data."
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
					<div className="flex items-start gap-2 pl-1 text-sm">
						<span className="w-24 shrink-0 pt-1 text-stone-600 dark:text-stone-400">
							Share angle axis
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
								ariaLabel="Share angle axis"
								onChange={(next) => updateCfg({ shareAngle: next })}
							/>
						</div>
					</div>

					{/* Pies have no R axis to share, so their "Size panels by unit"
					 *  toggle (scaling each panel's radius by its slice total)
					 *  lives here under the angle axis. */}
					{isPie && (
						<SizeByCheckboxRow
							className="pl-1"
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
						className="pl-1"
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
								shareAxes: shareX === "all" && next === "all",
							})
						}}
					/>

					{showRowSizing && rowAxisIsCategorical && (
						<SizeByCheckboxRow
							className="pl-1"
							label="Size rows by category count"
							checked={sizeY === "categoryCount"}
							onChange={(checked) =>
								updateCfg({
									proportionalSizingY: checked ? "categoryCount" : "off",
									// Enabling proportional row sizing makes a stored
									// panelHeight stale (it'd silently override the
									// proportional weights at render time). Clear it
									// so the user starts from auto.
									...(checked ? { panelHeight: null } : {}),
								})
							}
						/>
					)}
					{showRowSizing && rowAxisIsContinuous && (
						<SizeByCheckboxRow
							className="pl-1"
							label="Size rows by unit range"
							checked={sizeY === "unit"}
							onChange={(checked) =>
								updateCfg({
									proportionalSizingY: checked ? "unit" : "off",
									...(checked ? { panelHeight: null } : {}),
								})
							}
						/>
					)}

					{yRangeKind === "overall" && (
						<AxisRangeSection
							className="pl-1"
							title="Y axis range"
							help="Blank = auto-fit. Set a bound to pin the shared Y axis (e.g. min = 0)."
							entries={[
								{
									key: "overall-y",
									min: cfg.overallYRange?.min,
									max: cfg.overallYRange?.max,
									onChange: (bound, raw) =>
										updateOverallRange("y", bound, raw),
								},
							]}
						/>
					)}

					{yRangeKind === "row" && (
						<AxisRangeSection
							className="pl-1"
							title="Y axis range per row"
							help="Blank = auto from each row's data."
							entries={Array.from({ length: grid.rows }, (_, r) => ({
								key: `yrow-${r}`,
								label: `Row ${r + 1}`,
								min: cfg.rowAxisOverrides?.[String(r)]?.min,
								max: cfg.rowAxisOverrides?.[String(r)]?.max,
								onChange: (bound, raw) =>
									updateRowAxisOverride(String(r), bound, raw),
							}))}
						/>
					)}

					{yRangeKind === "panel" && (
						<AxisRangeSection
							className="pl-1"
							title="Y axis range per panel"
							help="Blank = auto from each panel's data."
							entries={values.map((v) => ({
								key: `y-${v}`,
								label: v,
								min: cfg.panelAxisOverrides[v]?.yMin,
								max: cfg.panelAxisOverrides[v]?.yMax,
								onChange: (bound, raw) =>
									updatePanelAxis(v, bound === "min" ? "yMin" : "yMax", raw),
							}))}
						/>
					)}
				</CollapsibleSubsection>
			)}

			{/* ─── Columns (X / angle axis controls) ───────────────────── */}
			{!isPolar && axisMap.colAxis !== null && (
				<CollapsibleSubsection title="Columns">

					<ShareAxisRow
						className="pl-1"
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
								shareAxes: next === "all" && shareY === "all",
							})
						}}
					/>

					{showColSizing && colAxisIsCategorical && (
						<SizeByCheckboxRow
							className="pl-1"
							label="Size columns by category count"
							checked={sizeX === "categoryCount"}
							onChange={(checked) =>
								updateCfg({
									proportionalSizingX: checked ? "categoryCount" : "off",
									// Clear panelWidth on enable — see the symmetric
									// note on the row-sizing handler above.
									...(checked ? { panelWidth: null } : {}),
								})
							}
						/>
					)}
					{showColSizing && colAxisIsContinuous && (
						<SizeByCheckboxRow
							className="pl-1"
							label="Size columns by unit range"
							checked={sizeX === "unit"}
							onChange={(checked) =>
								updateCfg({
									proportionalSizingX: checked ? "unit" : "off",
									...(checked ? { panelWidth: null } : {}),
								})
							}
						/>
					)}

					{xRangeKind === "overall" && (
						<AxisRangeSection
							className="pl-1"
							title="X axis range"
							help="Blank = auto-fit. Set a bound to pin the shared X axis (e.g. min = 0)."
							entries={[
								{
									key: "overall-x",
									min: cfg.overallXRange?.min,
									max: cfg.overallXRange?.max,
									onChange: (bound, raw) =>
										updateOverallRange("x", bound, raw),
								},
							]}
						/>
					)}

					{xRangeKind === "col" && (
						<AxisRangeSection
							className="pl-1"
							title="X axis range per column"
							help="Blank = auto from each column's data."
							entries={Array.from({ length: grid.cols }, (_, c) => ({
								key: `xcol-${c}`,
								label: `Column ${c + 1}`,
								min: cfg.colAxisOverrides?.[String(c)]?.min,
								max: cfg.colAxisOverrides?.[String(c)]?.max,
								onChange: (bound, raw) =>
									updateColAxisOverride(String(c), bound, raw),
							}))}
						/>
					)}

					{xRangeKind === "panel" && (
						<AxisRangeSection
							className="pl-1"
							title="X axis range per panel"
							help="Blank = auto from each panel's data."
							entries={values.map((v) => ({
								key: `x-${v}`,
								label: v,
								min: cfg.panelAxisOverrides[v]?.xMin,
								max: cfg.panelAxisOverrides[v]?.xMax,
								onChange: (bound, raw) =>
									updatePanelAxis(v, bound === "min" ? "xMin" : "xMax", raw),
							}))}
						/>
					)}
				</CollapsibleSubsection>
			)}

			{/* ─── Custom sizing ──────────────────────────────────────── */}
			<CollapsibleSubsection title="Custom sizing">
				<GapInput
					className="pl-1"
					label="Gap X"
					value={cfg.gapX}
					defaultValue={DEFAULT_FACET_CONFIG.gapX}
					onChange={(n) => updateCfg({ gapX: n })}
				/>
				<GapInput
					className="mt-2 pl-1"
					label="Gap Y"
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
										className="pl-1"
										label="Panel width"
										value={cfg.panelWidth}
										autoPx={renderedPanelDims?.widthPx}
										onCommit={(next) => updateCfg({ panelWidth: next })}
									/>
								)}
								{showHeight && (
									<PanelDimInput
										className="pl-1"
										label="Panel height"
										value={cfg.panelHeight}
										autoPx={renderedPanelDims?.heightPx}
										onCommit={(next) => updateCfg({ panelHeight: next })}
									/>
								)}
								<p className="pl-1 text-xs text-stone-600 dark:text-stone-400">
									Leave blank to auto-size by Rows / Cols / proportional
									settings. When set, the canvas grows and scrolls if needed to
									honor the exact pixel dimensions.
								</p>
							</>
						)
					})()}
			</CollapsibleSubsection>
		</div>
	)
}
