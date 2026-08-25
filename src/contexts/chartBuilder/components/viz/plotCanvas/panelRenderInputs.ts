import {
	migratePolarShareValue,
	type ChannelConfigs,
	type FacetConfig,
} from "../../../lib/channelConfig"
import type { ChartModeDef } from "../../../lib/chartModes/types"
import type { SolverPanelOutput } from "../../../lib/facetLayoutSolver"
import {
	panelFacetValues,
	type FacetPanels,
} from "../../../lib/resolveFacetPanels"
import type { FieldType } from "../../../lib/types"
import { panelGroupKeys } from "./panelGrouping"

/** Per-panel render inputs for the panel render loop: the share-aware
 *  scale-row sources for each axis, the per-panel numeric domain overrides
 *  (per-group row/col overrides → overall ranges → legacy wrap per-panel
 *  overrides → axis-config min/max, plus the measure-axis translation for
 *  bar / area renderers), and the polar R overrides + radius scale. Returns
 *  exactly the locals the rendererProps assembly and JSX below the loop
 *  consume; everything else stays internal. Pure and cheap enough that
 *  PlotCanvas calls it unmemoized once per panel per render, exactly like
 *  the inline block it replaces. */
export const resolvePanelRenderInputs = ({
	p,
	panelData,
	isPolar,
	shareXMode,
	shareYMode,
	allDatasetRows,
	colRowsByColKey,
	rowRowsByRowKey,
	measureAxis,
	axisFields,
	channelConfigs,
	facetCfg,
	groupMeasureMaxByKey,
	groupMeasureMinByKey,
	panelRadiusScale,
}: {
	p: SolverPanelOutput
	panelData: FacetPanels
	isPolar: boolean
	shareXMode: "none" | "perGroup" | "all"
	shareYMode: "none" | "perGroup" | "all"
	allDatasetRows: Array<Record<string, string>>
	colRowsByColKey: Map<string, Array<Record<string, unknown>>>
	rowRowsByRowKey: Map<string, Array<Record<string, unknown>>>
	measureAxis: ChartModeDef["canvas"]["measureAxis"]
	axisFields: {
		xField: string | null
		yField: string | null
		xType: FieldType | null
		yType: FieldType | null
	}
	channelConfigs: ChannelConfigs
	facetCfg: FacetConfig
	groupMeasureMaxByKey: Map<string, number>
	/** Shared measure-axis FLOOR per panel (see `computeGroupMeasureMin`).
	 *  Empty for modes that floor the measure axis at zero. */
	groupMeasureMinByKey: Map<string, number>
	panelRadiusScale: Map<string, number>
}) => {
	// Share-group keys + original facet values for this panel.
	// `values` is row-major, so the layout (row, col) recovers the
	// panel's index; panelGroupKeys / panelFacetValues then key by
	// facet VALUE in grid mode (compaction moves panels, so layout
	// position lies) and by layout position elsewhere.
	const panelIdx = p.row * panelData.grid.cols + p.col
	const { rowKey: panelRowKey, colKey: panelColKey } =
		panelGroupKeys(panelData, p.key, panelIdx)
	const panelFV = panelFacetValues(panelData, p.key, panelIdx)
	// When share-axes is on, scales must be built from a wider
	// row source than just this panel's filtered rows so the
	// axis spans the unified extent across the sharing group
	// — that's what "shared axis" means per APPLICATION.md
	// §5.2. Without this, each panel uses its own scale and
	// shareX merely suppresses label rendering on non-bottom
	// rows, leaving the visible bottom-row labels showing
	// only THAT panel's range.
	//   "all"      → full dataset's rows
	//   "perGroup" → all rows in this panel's COLUMN (x) /
	//                ROW (y)
	//   "none"     → undefined (renderer falls back to the
	//                panel's own rows via rowsOverride)
	// Polar charts (radar / pie) read the polar share modes,
	// which support per-row AND per-col grouping for each axis
	// (R + angle) independently. For everything else we keep
	// the cartesian shareX / shareY → row-or-col grouping
	// mapping (shareY=perGroup → row, shareX=perGroup → col).
	const resolveByShare = (
		mode: "none" | "perRow" | "perCol" | "all",
	) =>
		mode === "all"
			? allDatasetRows
			: mode === "perRow"
				? rowRowsByRowKey.get(panelRowKey) ?? undefined
				: mode === "perCol"
					? colRowsByColKey.get(panelColKey) ?? undefined
					: undefined
	const xScaleRows = isPolar
		? resolveByShare(
				migratePolarShareValue(
					facetCfg.shareAngle,
					facetCfg.shareX,
					facetCfg.shareAxes,
					"angle",
				),
			)
		: shareXMode === "all"
			? allDatasetRows
			: shareXMode === "perGroup"
				? colRowsByColKey.get(panelColKey) ?? undefined
				: undefined
	const yScaleRows = isPolar
		? resolveByShare(
				migratePolarShareValue(
					facetCfg.shareR,
					facetCfg.shareY,
					facetCfg.shareAxes,
					"R",
				),
			)
		: shareYMode === "all"
			? allDatasetRows
			: shareYMode === "perGroup"
				? rowRowsByRowKey.get(panelRowKey) ?? undefined
				: undefined
	// Per-group axis-range overrides (Phase 2 refinement).
	// Surfaced as inputs in Facet (row) / Facet (col) panels
	// only when shareY/shareX === "perGroup" AND the variable
	// is continuous; the same gate applies here so we don't
	// silently constrain scales for a hidden control.
	// The MEASURE axis of a bar/area chart is always continuous, even
	// when no field drives it directly — e.g. a histogram's count
	// axis (bars-x → measure on Y) has no `length` field, so
	// `axisFields.yType` is null. Treat it as continuous so its
	// min/max (and other continuous controls) apply.
	const yIsMeasureAxis = measureAxis === "y"
	const xIsMeasureAxis = measureAxis === "x"
	const yIsContinuous =
		axisFields.yType === "quantitative" ||
		axisFields.yType === "temporal" ||
		yIsMeasureAxis
	const xIsContinuous =
		axisFields.xType === "quantitative" ||
		axisFields.xType === "temporal" ||
		xIsMeasureAxis
	const rowValueForPanel =
		panelData.mode === "grid"
			? panelFV.rowValue ?? undefined
			: undefined
	const colValueForPanel =
		panelData.mode === "grid"
			? panelFV.colValue ?? undefined
			: undefined
	// Group-axis overrides: grid mode keys by facet value (e.g.
	// "Ideal"); wrap mode keys by layout row/col INDEX as string
	// ("0", "1", …) because wrap layout rows don't have a value.
	// Both modes consult the same `rowAxisOverrides` /
	// `colAxisOverrides` maps — keys never collide because grid
	// values are real names while wrap keys are bare integers.
	const yPerGroupKey =
		panelData.mode === "grid"
			? rowValueForPanel !== undefined &&
				rowValueForPanel !== "__all__"
				? rowValueForPanel
				: undefined
			: String(p.row)
	const xPerGroupKey =
		panelData.mode === "grid"
			? colValueForPanel !== undefined &&
				colValueForPanel !== "__all__"
				? colValueForPanel
				: undefined
			: String(p.col)
	// Row-axis override applies under:
	//   - shareY === "perGroup": pins the row's shared scale.
	//   - shareY === "none" + grid mode + cols === 1: each row
	//     is a single panel, so the row override = per-panel
	//     bound (the row/col sidebar exposes the editor under
	//     this case too).
	// Wrap mode shareY=none uses `panelAxisOverrides` via
	// `legacyPanelOverride` below, not this map.
	const rowOverrideApplies =
		shareYMode === "perGroup" ||
		(shareYMode === "none" &&
			panelData.mode === "grid" &&
			panelData.grid.cols === 1)
	const colOverrideApplies =
		shareXMode === "perGroup" ||
		(shareXMode === "none" &&
			panelData.mode === "grid" &&
			panelData.grid.rows === 1)
	const yGroupOverride =
		rowOverrideApplies && yIsContinuous && yPerGroupKey != null
			? facetCfg.rowAxisOverrides?.[yPerGroupKey]
			: undefined
	const xGroupOverride =
		colOverrideApplies && xIsContinuous && xPerGroupKey != null
			? facetCfg.colAxisOverrides?.[xPerGroupKey]
			: undefined
	// Overall axis range: applies under share=="all" with a
	// continuous axis. Lets the user pin the shared scale to a
	// "pretty" start (e.g. 0) or fixed upper bound.
	const yOverallOverride =
		shareYMode === "all" && yIsContinuous
			? facetCfg.overallYRange
			: undefined
	const xOverallOverride =
		shareXMode === "all" && xIsContinuous
			? facetCfg.overallXRange
			: undefined
	// Wrap-mode legacy per-panel overrides keyed by the single
	// facet value (== p.key). Preserved as-is so saved visuals
	// keep working; in grid mode we ignore this branch.
	const legacyPanelOverride =
		panelData.mode === "wrap"
			? facetCfg.panelAxisOverrides?.[p.key]
			: undefined
	// Per-encoding base bounds from the X / Y axis option panels.
	// Lowest precedence — facet-level overrides above win where set,
	// but on single-panel charts (and faceted panels without a more
	// specific override) these are the only source. Only consulted
	// on continuous axes; `null`/absent coerces to undefined so the
	// renderer falls through to auto-fit. (`?? undefined` turns a
	// stored `null` into `undefined`.)
	const xCfgMin = xIsContinuous
		? channelConfigs.x?.min ?? undefined
		: undefined
	const xCfgMax = xIsContinuous
		? channelConfigs.x?.max ?? undefined
		: undefined
	const yCfgMin = yIsContinuous
		? channelConfigs.y?.min ?? undefined
		: undefined
	const yCfgMax = yIsContinuous
		? channelConfigs.y?.max ?? undefined
		: undefined
	const xMinOverride =
		xGroupOverride?.min ??
		xOverallOverride?.min ??
		legacyPanelOverride?.xMin ??
		xCfgMin
	const xMaxOverride =
		xGroupOverride?.max ??
		xOverallOverride?.max ??
		legacyPanelOverride?.xMax ??
		xCfgMax
	const yMinOverride =
		yGroupOverride?.min ??
		yOverallOverride?.min ??
		legacyPanelOverride?.yMin ??
		yCfgMin
	const yMaxOverride =
		yGroupOverride?.max ??
		yOverallOverride?.max ??
		legacyPanelOverride?.yMax ??
		yCfgMax
	// Bar / Area renderers consume a single "measure axis"
	// bound (the quantitative axis). bars-x / areas-x → y is
	// the measure axis; bars-y / areas-y → x is the measure
	// axis. Translate the per-axis overrides here so the
	// renderer doesn't have to know about modes.
	// User-set per-group min wins; otherwise fall back to the share group's
	// floor, so every panel on a shared measure axis sits on the same
	// baseline even when only some of them hold negative values. Empty map
	// (zero-floored modes) → undefined → the renderer's own floor.
	const sharedGroupMin = groupMeasureMinByKey.get(p.key)
	const measureMinOverride =
		measureAxis === "y"
			? yMinOverride ?? sharedGroupMin
			: measureAxis === "x"
				? xMinOverride ?? sharedGroupMin
				: undefined
	// User-set per-group min/max wins; otherwise fall back to the
	// shared-group max computed above (so an unset override on a
	// shared axis still gets the correct tighter bound, not the
	// inflated pooled-aggregation value).
	const sharedGroupMax = groupMeasureMaxByKey.get(p.key)
	const measureMaxOverride =
		measureAxis === "y"
			? yMaxOverride ?? sharedGroupMax
			: measureAxis === "x"
				? xMaxOverride ?? sharedGroupMax
				: undefined
	// Polar R-axis overrides. Mirrors the cartesian Y override
	// resolution above but reads dedicated polar-specific
	// fields (overallRRange, rowRAxisOverrides, etc.) so
	// switching between cartesian and polar modes doesn't
	// cross-pollute settings.
	const shareRMode = isPolar
		? migratePolarShareValue(
				facetCfg.shareR,
				facetCfg.shareY,
				facetCfg.shareAxes,
				"R",
			)
		: undefined
	const polarPanelKey =
		panelData.mode === "wrap" ? p.key : `${p.row}|${p.col}`
	const rRangeOverride: { min?: number; max?: number } | undefined =
		!isPolar
			? undefined
			: shareRMode === "all"
				? facetCfg.overallRRange
				: shareRMode === "perRow"
					? facetCfg.rowRAxisOverrides?.[
							yPerGroupKey ?? String(p.row)
						]
					: shareRMode === "perCol"
						? facetCfg.colRAxisOverrides?.[
								xPerGroupKey ?? String(p.col)
							]
						: facetCfg.panelRAxisOverrides?.[polarPanelKey]
	const rMinOverride = rRangeOverride?.min
	const rMaxOverride = rRangeOverride?.max
	const radiusScale = panelRadiusScale.get(p.key)
	return {
		panelFV,
		xScaleRows,
		yScaleRows,
		xMinOverride,
		xMaxOverride,
		yMinOverride,
		yMaxOverride,
		measureMinOverride,
		measureMaxOverride,
		rMinOverride,
		rMaxOverride,
		radiusScale,
	}
}
