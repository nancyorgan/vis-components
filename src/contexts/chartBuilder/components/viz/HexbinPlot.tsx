// Hexbin renderer: a continuous×continuous scatter binned onto a hex
// lattice, cells filled through the quantitative hue gradient over
// [0, maxCount]. Binning happens in DATA space (lib/hexbins.ts) so the
// Legend derives the same domain from data alone; this component's only
// jobs are the axis scales and the affine lattice→pixel mapping (cells
// tile exactly, hexagons stretch to the plot's aspect ratio).
import { useAtomValue } from "jotai"
import { DEFAULT_SHAPE_CONFIG } from "../../lib/channelConfig"
import type { UniversalRendererProps } from "../../lib/chartRendererProps"
import { cartesian } from "./coords"
import { effectiveType } from "../../lib/fieldType"
import {
	DEFAULT_HEXBIN_BIN_COUNT,
	hexCornerOffsets,
	resolveHexbinCells,
} from "../../lib/hexbins"
import { resolveTextFont, resolveTitleFont } from "../../lib/labelsConfig"
import {
	applyHueScale,
	makeHueScale,
	makePositionScale,
	maxMeaningfulTicks,
	overrideLinearDomain,
} from "../../lib/scales"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

import { Plot, type CoordFactory } from "./Plot"

export const HexbinPlot = (props: UniversalRendererProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const labels = useAtomValue(currentLabelsAtom)
	const dataset = useCurrentDatasetView()

	const rowsForChart = props.rowsOverride ?? dataset?.rows ?? []
	const rowsForXScale =
		props.scalesRowsOverrideX ?? props.scalesRowsOverride ?? rowsForChart
	const rowsForYScale =
		props.scalesRowsOverrideY ?? props.scalesRowsOverride ?? rowsForChart

	const xField = encodings.x?.field ?? null
	const yField = encodings.y?.field ?? null
	const xType =
		xField && dataset ? effectiveType(dataset, xField, overrides) : null
	const yType =
		yField && dataset ? effectiveType(dataset, yField, overrides) : null

	// Defensive: this renderer only mounts in hexbin mode, but a stale mount
	// during an encoding transition shouldn't crash.
	const active =
		!!xField &&
		!!yField &&
		xType === "quantitative" &&
		yType === "quantitative"

	const binCount = channelConfigs.hexbin?.binCount ?? DEFAULT_HEXBIN_BIN_COUNT
	const hex = active
		? resolveHexbinCells(
				rowsForChart.map((r) => r[xField]),
				rowsForChart.map((r) => r[yField]),
				binCount,
				{ min: props.xMinOverride, max: props.xMaxOverride },
				{ min: props.yMinOverride, max: props.yMaxOverride },
				{
					domainXRaw: rowsForXScale.map((r) => r[xField]),
					domainYRaw: rowsForYScale.map((r) => r[yField]),
				}
			)
		: null
	const hueScale = hex
		? makeHueScale([0, hex.maxCount], "quantitative", channelConfigs.hue)
		: null

	const xRaw = active ? rowsForXScale.map((r) => r[xField]) : null
	const yRaw = active ? rowsForYScale.map((r) => r[yField]) : null
	const xMaxTicks = xRaw ? maxMeaningfulTicks(xRaw, "quantitative") : undefined
	const yMaxTicks = yRaw ? maxMeaningfulTicks(yRaw, "quantitative") : undefined

	// Coord factory — same construction as ScatterPlot's quantitative branch;
	// hexbins.ts replicates this domain math (extent → nice → user bounds),
	// so the lattice lands exactly on the axes these scales draw.
	const coord: CoordFactory = (inner) => {
		const xScale =
			active && xRaw
				? overrideLinearDomain(
						makePositionScale(xRaw, "quantitative", [inner.x0, inner.x1]),
						"quantitative",
						props.xMinOverride,
						props.xMaxOverride
					)
				: null
		const yScale =
			active && yRaw
				? overrideLinearDomain(
						makePositionScale(yRaw, "quantitative", [inner.y1, inner.y0]),
						"quantitative",
						props.yMinOverride,
						props.yMaxOverride
					)
				: null
		return cartesian({
			xScale,
			yScale,
			xAxisConfig: channelConfigs.x,
			yAxisConfig: channelConfigs.y,
			xLabel: labels.xAxisTitle ?? xField ?? "",
			yLabel: labels.yAxisTitle ?? yField ?? "",
			xFieldType: xType,
			yFieldType: yType,
			xMaxTicks,
			yMaxTicks,
			showXAxis: props.showXAxis !== false,
			showYAxis: props.showYAxis !== false,
			showXAxisTitle: props.showXAxisTitle ?? true,
			showYAxisTitle: props.showYAxisTitle ?? true,
			tickFont: resolveTextFont(labels.baseFont),
			xAxisTitleFont: resolveTitleFont(
				labels.baseFont,
				"secondary",
				labels.fontOverrides?.xAxisTitle
			),
			yAxisTitleFont: resolveTitleFont(
				labels.baseFont,
				"secondary",
				labels.fontOverrides?.yAxisTitle
			),
			xAxisTitleAlignment: labels.titleAlignments?.xAxisTitle,
			yAxisTitleAlignment: labels.titleAlignments?.yAxisTitle,
			yAxisTitleHorizontal: labels.yAxisTitleHorizontal,
		})
	}

	return (
		<Plot inner={props.inner} coord={coord}>
			{({ inner }) => {
				if (!hex || !hueScale) return null
				const plotW = inner.x1 - inner.x0
				const plotH = inner.y1 - inner.y0
				const corners = hexCornerOffsets(hex.radius)
				// Cell borders follow the universal mark outline (the Shape
				// panel's color/width, seeded from the theme; width 0 hides) —
				// same chain BarPlot and the hierarchy renderers use.
				const outlineColor =
					channelConfigs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor
				const outlineWidth =
					channelConfigs.shape?.outlineWidth ?? DEFAULT_SHAPE_CONFIG.outlineWidth
				return (
					<g>
						{hex.cells.map((c) => {
							// Normalized center → pixels (y inverted). Corner offsets
							// scale PER-AXIS — the lattice's affine image still tiles.
							const px = inner.x0 + c.cx * plotW
							const py = inner.y1 - c.cy * plotH
							const d =
								corners
									.map(
										([dx, dy], j) =>
											`${j === 0 ? "M" : "L"}${px + dx * plotW},${py + dy * plotH}`
									)
									.join("") + "Z"
							return (
								<path
									// Lattice centers are unique per cell and stable
									// across re-renders — a proper key, unlike the index.
									key={`${c.cx},${c.cy}`}
									className="vc-hexbin-cell"
									d={d}
									fill={
										applyHueScale(hueScale, c.count, "quantitative") ?? "none"
									}
									stroke={outlineWidth > 0 ? outlineColor : "none"}
									strokeWidth={outlineWidth}
								/>
							)
						})}
					</g>
				)
			}}
		</Plot>
	)
}
