// Hexbin renderer: a continuous×continuous scatter binned onto a hex
// lattice, cells filled through the quantitative hue gradient over
// [0, maxCount] and styled like every other body (opacity, saturation,
// brightness, pattern, outline — see the cell loop). Binning happens in DATA space (lib/hexbins.ts) so the
// Legend derives the same domain from data alone; this component's only
// jobs are the axis scales and the affine lattice→pixel mapping (cells
// tile exactly, hexagons stretch to the plot's aspect ratio).
import { useAtomValue } from "jotai"
import { buildPatternDefs, type FillInput } from "../../lib/buildPatternDefs"
import { DEFAULT_FILL } from "../../lib/channelConfig"
import { combinedGroupValues } from "../../lib/combinedGroupValues"
import { dateColumnText } from "../../lib/rawTextByTime"
import type { UniversalRendererProps } from "../../lib/chartRendererProps"
import { cartesian } from "./coords"
import { effectiveType } from "../../lib/fieldType"
import { HEXBIN_COUNT_LABEL } from "../../lib/hexbinMeasure"
import {
	DEFAULT_HEXBIN_BIN_COUNT,
	hexCornerOffsets,
	resolveHexbinCells,
} from "../../lib/hexbins"
import { markOutlineResolver } from "../../lib/markOutline"
import {
	layerFillProp,
	resolveLayerColor,
	type GroupValues,
} from "../../lib/resolveLayerColor"
import { resolveTextFont, resolveTitleFont } from "../../lib/labelsConfig"
import {
	makeHueScale,
	makePositionScale,
	maxMeaningfulTicks,
	overrideLinearDomain,
} from "../../lib/scales"
import {
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	renderedLabelsAtom,
} from "../../store/atoms"
import {
	renderChannelConfigsAtom,
} from "../../store/renderConfigs"
import { useAestheticScales, type AestheticScales } from "../../store/useAestheticScales"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

import { Plot, type CoordFactory } from "./Plot"

export const HexbinPlot = (props: UniversalRendererProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(renderChannelConfigsAtom)
	const labels = useAtomValue(renderedLabelsAtom)
	const dataset = useCurrentDatasetView()
	const aestheticScales = useAestheticScales()

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

	// A hex cell is a BODY like a bar or a heatmap cell, so it takes the same
	// options through the same pipeline (`resolveLayerColor`). Its Color is
	// its point count through the count gradient; every other channel takes
	// the combined value of the rows that fell in the cell — the mean of a
	// numeric variable, the most common level of a discrete one.
	const cellScales: AestheticScales | null = hueScale
		? {
				...aestheticScales,
				hue: {
					scale: hueScale,
					field: { name: HEXBIN_COUNT_LABEL, type: "quantitative" },
				},
			}
		: null
	const defaultFill = channelConfigs.defaultFill ?? DEFAULT_FILL
	const patternBgOverride = channelConfigs.pattern?.backgroundColor ?? null
	// The configured default pattern applies to cells as it does to bars.
	const patternOptions = { includeDefaultPattern: true }
	const cellFills: Array<FillInput & { groupValues: GroupValues }> = (
		hex?.cells ?? []
	).map((c) => {
		const rows = c.rows.flatMap((i) => {
			const row = rowsForChart[i]
			return row ? [row] : []
		})
		return {
			rows,
			// The count is the cell's own; `combinedGroupValues` fills in the rest.
			groupValues: combinedGroupValues(
				rows,
				{ ...aestheticScales, hue: null },
				{ hue: c.count }
			),
		}
	})
	const patternDefs = cellScales
		? buildPatternDefs(
				cellFills,
				cellScales,
				channelConfigs,
				defaultFill,
				patternBgOverride,
				patternOptions
			)
		: []
	const outlineFor = markOutlineResolver(channelConfigs, aestheticScales)

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
			xDomainPinned: props.xMinOverride != null && props.xMaxOverride != null,
			yDomainPinned: props.yMinOverride != null && props.yMaxOverride != null,
			xRawText: xField && xType === "temporal" ? dateColumnText(rowsForXScale, xField) : undefined,
			yRawText: yField && yType === "temporal" ? dateColumnText(rowsForYScale, yField) : undefined,
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
		<Plot inner={props.inner} coord={coord} patternDefs={patternDefs}>
			{({ inner }) => {
				if (!hex || !cellScales) return null
				const plotW = inner.x1 - inner.x0
				const plotH = inner.y1 - inner.y0
				const corners = hexCornerOffsets(hex.radius)
				// Cell borders follow the universal mark outline: thickness
				// (Size → Cell outline, seeded from the theme; 0 hides), color,
				// shading and opacity through `lib/markOutline`.
				return (
					<g>
						{hex.cells.map((c, cellIdx) => {
							const input = cellFills[cellIdx]
							const rows = input?.rows ?? []
							const layer = resolveLayerColor({
								groupValues: input?.groupValues ?? { hue: c.count },
								defaultFill,
								patternBgOverride,
								aestheticScales: cellScales,
								channelConfigs,
								patternOptions,
								rows,
							})
							const outline = outlineFor(rows[0] ?? {}, { color: layer.outline })
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
									/* `vc-hexbin-cell` is a marker for tests / user CSS, not
									   styling — there is deliberately no CSS rule for it. */
									className="vc-hexbin-cell"
									d={d}
									fill={layerFillProp(layer)}
									// Full opacity sets no attribute, as before.
									fillOpacity={layer.opacity === 1 ? undefined : layer.opacity}
									stroke={outline.strokeWidth > 0 ? outline.stroke : "none"}
									strokeOpacity={
										outline.strokeWidth > 0 && outline.strokeOpacity !== 1
											? outline.strokeOpacity
											: undefined
									}
									strokeWidth={outline.strokeWidth}
								/>
							)
						})}
					</g>
				)
			}}
		</Plot>
	)
}
