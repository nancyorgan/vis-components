import {
	migratePolarShareValue,
	type ChannelConfigs,
	type FacetConfig,
} from "../../../lib/channelConfig"
import type { ChartModeDef } from "../../../lib/chartModes/types"
import { binnedCounts, computeHistogramBins } from "../../../lib/histogramBins"
import {
	panelFacetValues,
	type FacetPanels,
} from "../../../lib/resolveFacetPanels"
import { resolveStackModes } from "../../../lib/stackMode"
import type { Encodings, FieldType } from "../../../lib/types"
import { computePanelMeasureMax, panelGroupKeys } from "./panelGrouping"

/** For bar / area charts under shared measure-axis modes ("all" or
 *  "perGroup"), pre-compute each panel's shared measure max. Pooling rows
 *  then aggregating in the renderer summed same-category values across
 *  panels and inflated the axis. Aggregating panel-by-panel and taking
 *  the max here keeps the shared axis tight to the largest actual panel.
 *  Returns an empty map for non-bar/area modes or share mode "none".
 *  Pure and cheap enough that PlotCanvas calls it unmemoized once per
 *  render, exactly like the inline block it replaces. */
export const computeGroupMeasureMax = ({
	mode,
	measureAxis,
	shareXMode,
	shareYMode,
	encodings,
	channelConfigs,
	panelData,
	getType,
}: {
	mode: ChartModeDef
	measureAxis: ChartModeDef["canvas"]["measureAxis"]
	shareXMode: "none" | "perGroup" | "all"
	shareYMode: "none" | "perGroup" | "all"
	encodings: Encodings
	channelConfigs: ChannelConfigs
	panelData: FacetPanels
	getType: (fieldName: string) => FieldType | undefined
}): Map<string, number> => {
const isBarOrArea = measureAxis !== null
const isVerticalBarOrArea = measureAxis === "y"
const groupMeasureMaxByKey = new Map<string, number>()
if (isBarOrArea) {
	const measureShareMode = isVerticalBarOrArea ? shareYMode : shareXMode
	if (measureShareMode !== "none") {
		const categoryField = isVerticalBarOrArea
			? encodings.x?.field ?? null
			: encodings.y?.field ?? null
		const panelMeasureMax = new Map<string, number>()

		// Histogram: there's no measure field — the measure is the COUNT of
		// rows per bin. Bin the POOLED rows so every panel shares the same
		// edges, then each panel's measure max is its largest per-bin count.
		const catChannel = isVerticalBarOrArea ? "x" : "y"
		const histogramCfg = channelConfigs[catChannel]?.histogram
		const isHistogram =
			!!histogramCfg?.enabled &&
			!!categoryField &&
			getType(categoryField) === "quantitative"

		if (isHistogram && categoryField) {
			const isDensity = histogramCfg?.mode === "density"
			const pooled = panelData.values.flatMap(
				(k) => panelData.rowsByValue.get(k) ?? []
			)
			const binning = computeHistogramBins(
				pooled.map((r) => r[categoryField]),
				histogramCfg?.binCount ?? 10,
				undefined,
				{
					min: channelConfigs[catChannel]?.min ?? null,
					max: channelConfigs[catChannel]?.max ?? null,
				}
			)
			panelData.values.forEach((key) => {
				const panelRows = panelData.rowsByValue.get(key) ?? []
				const counts = binning
					? binnedCounts(
							panelRows.map((r) => r[categoryField]),
							binning
						)
					: new Map<string, number>()
				const maxCount =
					counts.size > 0 ? Math.max(0, ...counts.values()) : 0
				// Density: bars are bin shares (count / panel total), so the
				// panel max is the largest share (≤1). The shared-axis floor
				// below (Math.max(1, …)) then pins the density axis to 0–1,
				// matching the non-faceted path's computeBarMeasureMax.
				const panelTotal = [...counts.values()].reduce((a, b) => a + b, 0)
				panelMeasureMax.set(
					key,
					isDensity && panelTotal > 0 ? maxCount / panelTotal : maxCount
				)
			})
		} else {
			// Measure field: each mode declares its own fallback chain
			// (areas read `length` first) via canvas.resolveMeasureField.
			const measureField =
				mode.canvas.resolveMeasureField?.(encodings) ?? null
			const modes = resolveStackModes(channelConfigs, encodings)
			const groupModeFields = modes
				.filter((m) => m.mode === "group")
				.map((m) => encodings[m.channel]?.field)
				.filter((f): f is string => !!f)
			panelData.values.forEach((key) => {
				const panelRows = panelData.rowsByValue.get(key) ?? []
				panelMeasureMax.set(
					key,
					computePanelMeasureMax(
						panelRows,
						categoryField,
						measureField,
						modes,
						groupModeFields,
					)
				)
			})
		}
		if (measureShareMode === "all") {
			const allMax = Math.max(1, ...panelMeasureMax.values())
			for (const key of panelData.values)
				groupMeasureMaxByKey.set(key, allMax)
		} else {
			// perGroup: vertical bars/areas share Y per row; horizontal
			// share X per col. Group by the dimension perpendicular to
			// the measure axis, keyed by share-group key (facet value in
			// grid mode — compaction moves panels off their layout row).
			const groupMax = new Map<string, number>()
			panelData.values.forEach((key, i) => {
				const { rowKey, colKey } = panelGroupKeys(panelData, key, i)
				const groupKey = isVerticalBarOrArea ? rowKey : colKey
				const v = panelMeasureMax.get(key) ?? 1
				const cur = groupMax.get(groupKey) ?? 0
				if (v > cur) groupMax.set(groupKey, v)
			})
			panelData.values.forEach((key, i) => {
				const { rowKey, colKey } = panelGroupKeys(panelData, key, i)
				const groupKey = isVerticalBarOrArea ? rowKey : colKey
				groupMeasureMaxByKey.set(key, groupMax.get(groupKey) ?? 1)
			})
		}
	}
}
	return groupMeasureMaxByKey
}

/** "Size panels by unit" for polar (radar / pie): compute a 0..1
 *  scale per panel that the renderer multiplies into its drawn
 *  radius. The largest-unit panel = 1.0; smaller panels render
 *  proportionally smaller.
 *
 *    Radar: unit = panel's effective max R (override.max wins over
 *                  data max, mirroring how RadarPlot itself derives
 *                  the r-scale domain — otherwise a user pinning R
 *                  to [0, 1] on every panel would see panels still
 *                  sized by their data max, contradicting the pin)
 *    Pie:   unit = panel's slice total (sum of `length` values)
 *
 *  Reference (the 1.0 panel) is the max unit across ALL panels —
 *  independent of shareR / shareAngle so users can read panel
 *  magnitudes off the visual regardless of share mode.
 *  Returns an empty map when the feature is off (non-polar, single
 *  panel, or the toggle disabled). Pure, called unmemoized per render. */
export const computePanelRadiusScale = ({
	isPolar,
	isFaceted,
	facetCfg,
	encodings,
	panelData,
	mode,
}: {
	isPolar: boolean
	isFaceted: boolean
	facetCfg: FacetConfig
	encodings: Encodings
	panelData: FacetPanels
	mode: ChartModeDef
}): Map<string, number> => {
const panelRadiusScale = new Map<string, number>()
if (isPolar && facetCfg.proportionalPanelSizing === true && isFaceted) {
	const rField = encodings.r?.field ?? null
	// Pies carry their slice values on the ANGLE channel (see PiePlot's
	// `measureField = encodings.angle.field`), not `length`. Reading
	// `length` here left `unit` at 0 for every pie panel, so maxUnit was
	// 0 and panelRadiusScale stayed empty — "size pies by unit" silently
	// did nothing.
	const pieMeasureField = encodings.angle?.field ?? null
	// Resolve the R-axis share mode once for the radar branch — the
	// per-panel override lookup mirrors the renderer's path at line
	// ~1664 so the SIZE math and the SCALE math agree on which
	// override wins.
	const shareRModeForSize = isPolar
		? migratePolarShareValue(
				facetCfg.shareR,
				facetCfg.shareY,
				facetCfg.shareAxes,
				"R",
			)
		: undefined
	const cols = panelData.grid.cols
	const resolveROverride = (
		key: string,
		idx: number,
		row: number,
		col: number,
	): { min?: number; max?: number } | undefined => {
		if (mode.canvas.polarUnit !== "rAxisMax") return undefined
		// Grid mode keys per-row / per-col overrides by ORIGINAL facet
		// value (compaction moves panels off their layout position);
		// wrap keys by layout index, as before. `__all__` placeholder
		// values still mean "no key" → fall back to the index string.
		const fv = panelFacetValues(panelData, key, idx)
		const rowKey =
			panelData.mode === "grid"
				? fv.rowValue !== null && fv.rowValue !== "__all__"
					? fv.rowValue
					: undefined
				: String(row)
		const colKey =
			panelData.mode === "grid"
				? fv.colValue !== null && fv.colValue !== "__all__"
					? fv.colValue
					: undefined
				: String(col)
		const polarPanelKey =
			panelData.mode === "wrap" ? key : `${row}|${col}`
		return shareRModeForSize === "all"
			? facetCfg.overallRRange
			: shareRModeForSize === "perRow"
				? facetCfg.rowRAxisOverrides?.[rowKey ?? String(row)]
				: shareRModeForSize === "perCol"
					? facetCfg.colRAxisOverrides?.[colKey ?? String(col)]
					: facetCfg.panelRAxisOverrides?.[polarPanelKey]
	}
	const panelUnit = new Map<string, number>()
	panelData.values.forEach((key, i) => {
		const panelRows = panelData.rowsByValue.get(key) ?? []
		let unit = 0
		if (mode.canvas.polarUnit === "rAxisMax" && rField) {
			let dataMax = 0
			for (const r of panelRows) {
				const raw = r[rField]
				const n = typeof raw === "number" ? raw : Number(raw)
				if (Number.isFinite(n) && n > dataMax) dataMax = n
			}
			const row = Math.floor(i / cols)
			const col = i % cols
			const override = resolveROverride(key, i, row, col)
			// Effective max: override.max wins (matches the r-scale
			// domain RadarPlot builds via buildRScale's rMaxOverride).
			// `dataMax` is the floor so an undefined override still
			// gives a sensible weight.
			unit = override?.max ?? dataMax
		} else if (mode.canvas.polarUnit === "angleSum" && pieMeasureField) {
			// Pies: the panel's "unit" is the sum of its slice values
			// (the angle measure). No equivalent R-range override exists
			// for pie modes — use the raw data sum.
			for (const r of panelRows) {
				const raw = r[pieMeasureField]
				const n = typeof raw === "number" ? raw : Number(raw)
				if (Number.isFinite(n) && n > 0) unit += n
			}
		}
		panelUnit.set(key, unit)
	})
	// For radar, fold per-panel units into share groups so the
	// drawn-radius math matches the R-scale-sharing math:
	//   - shareR = "all":     every panel uses the global max → all
	//                          panels render at the same size (1.0).
	//   - shareR = "perRow":  panels in a row use that row's max →
	//                          rows differ in size, panels within a
	//                          row are uniform (their R scales are
	//                          the same).
	//   - shareR = "perCol":  symmetric for columns.
	//   - shareR = "none":    keep per-panel units (existing behavior).
	// Pies don't have an R axis to share, so this regrouping doesn't
	// apply — leave their per-panel slice totals as-is.
	if (mode.canvas.polarUnit === "rAxisMax" && shareRModeForSize !== "none") {
		if (shareRModeForSize === "all") {
			const globalMax = Math.max(0, ...panelUnit.values())
			for (const key of panelData.values) panelUnit.set(key, globalMax)
		} else if (shareRModeForSize === "perRow") {
			// Group by share-group key (facet value in grid mode) so the
			// size groups match the R-scale share groups under compaction.
			const rowMax = new Map<string, number>()
			panelData.values.forEach((key, i) => {
				const { rowKey } = panelGroupKeys(panelData, key, i)
				const u = panelUnit.get(key) ?? 0
				const cur = rowMax.get(rowKey) ?? 0
				if (u > cur) rowMax.set(rowKey, u)
			})
			panelData.values.forEach((key, i) => {
				const { rowKey } = panelGroupKeys(panelData, key, i)
				panelUnit.set(key, rowMax.get(rowKey) ?? 0)
			})
		} else if (shareRModeForSize === "perCol") {
			const colMax = new Map<string, number>()
			panelData.values.forEach((key, i) => {
				const { colKey } = panelGroupKeys(panelData, key, i)
				const u = panelUnit.get(key) ?? 0
				const cur = colMax.get(colKey) ?? 0
				if (u > cur) colMax.set(colKey, u)
			})
			panelData.values.forEach((key, i) => {
				const { colKey } = panelGroupKeys(panelData, key, i)
				panelUnit.set(key, colMax.get(colKey) ?? 0)
			})
		}
	}
	const maxUnit = Math.max(0, ...panelUnit.values())
	if (maxUnit > 0) {
		for (const [key, unit] of panelUnit) {
			panelRadiusScale.set(key, unit / maxUnit)
		}
	}
}
	return panelRadiusScale
}
