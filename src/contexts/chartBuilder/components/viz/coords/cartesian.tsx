import type { ReactNode } from "react"

import { Axis } from "../Axes"
import type { AxisConfig } from "../../../lib/channelConfig"
import type {
	FontConfig,
	LabelAlignment,
	TextFontConfig,
} from "../../../lib/labelsConfig"
import type { PlotInner } from "../../../lib/plotLayout"
import type { PositionScale } from "../../../lib/scales"
import type { FieldType } from "../../../lib/types"
import type {
	AxisLayer,
	CartesianScales,
	CoordSystem,
} from "../../../lib/coords/types"

export type CartesianInput = {
	xScale: PositionScale | null
	yScale: PositionScale | null
	xAxisConfig?: AxisConfig
	yAxisConfig?: AxisConfig
	/** Axis title text (usually the field name). */
	xLabel: string
	yLabel: string
	xFieldType: FieldType | null
	yFieldType: FieldType | null
	/** Maximum "meaningful" tick count (clamp for axis config). */
	xMaxTicks?: number
	yMaxTicks?: number
	/** Toggles whether ticks, labels, spine, and title render. Gridlines still
	 * render in the back layer even when this is false — used by faceted
	 * panels to suppress interior axis decorations while keeping gridline
	 * alignment. */
	showXAxis: boolean
	showYAxis: boolean
	tickFont: TextFontConfig
	xAxisTitleFont: FontConfig
	yAxisTitleFont: FontConfig
	/** Per-axis title alignment. Defaults to "center". */
	xAxisTitleAlignment?: LabelAlignment
	yAxisTitleAlignment?: LabelAlignment
	/** When true, render the y-axis title upright instead of rotated -90°. */
	yAxisTitleHorizontal?: boolean
	/** When false, suppress the per-axis title (used by faceted panels so a
	 * single shared title can render outside the panel grid). Defaults true. */
	showXAxisTitle?: boolean
	showYAxisTitle?: boolean
}

/** Pixel position where `scale` crosses the value 0 — the "Set spine at 0"
 * target for the OTHER axis's spine. The flag lives on the axis whose SPINE
 * moves (its panel's checkbox sits with the line it repositions), while the
 * scale/fieldType here are the PERPENDICULAR axis's: y's flag moves the
 * vertical y spine to x = 0 on the x scale, x's flag moves the horizontal x
 * spine to y = 0 on the y scale. Only a quantitative continuous scale yields
 * a position, and only while 0 falls inside the rendered extent — otherwise
 * `undefined` keeps the spine at its plot edge, so the checkbox never makes
 * the spine vanish (e.g. a pinned min above 0). */
const zeroCrossingPx = (
	scale: PositionScale | null,
	fieldType: FieldType | null,
	atZero: boolean | undefined,
	edge0: number,
	edge1: number
): number | undefined => {
	if (!atZero || !scale || fieldType !== "quantitative") return undefined
	// Band / point scales have no meaningful position for the value 0.
	if (typeof (scale as unknown as { ticks?: unknown }).ticks !== "function") {
		return undefined
	}
	const px = (scale as unknown as (v: number) => number)(0)
	if (!Number.isFinite(px)) return undefined
	const lo = Math.min(edge0, edge1)
	const hi = Math.max(edge0, edge1)
	return px >= lo && px <= hi ? px : undefined
}

/** Cartesian coord system: renders one horizontal x-axis and one vertical
 * y-axis around a rectangular inner region using the existing `<Axis>`
 * component. Pass `{ showXAxis: false }` to hide a given axis's decorations
 * while still reserving its margin (see `computePlotLayout`).
 *
 * The factory captures already-built position scales. Because `xScale` and
 * `yScale` must be built against the `inner` rect (resolved by the layout
 * solver), the caller constructs them inside a `CoordFactory` callback so
 * `cartesian(...)` can be invoked once `inner` is known. */
export const cartesian = (input: CartesianInput): CoordSystem => {
	const scales: CartesianScales = {
		xScale: input.xScale,
		yScale: input.yScale,
	}
	// Each axis is told about the perpendicular one (when it renders) so a
	// gridline landing under the opposing spine is dropped rather than
	// blurring against it. Spines draw even when `showXAxis`/`showYAxis` is
	// false (faceted interior panels keep their frame), so presence of the
	// scale + field type is the right gate.
	const xAxisRenders = !!(input.xScale && input.xFieldType)
	const yAxisRenders = !!(input.yScale && input.yFieldType)
	return {
		kind: "cartesian",
		scales,
		renderAxes: (layer: AxisLayer, inner: PlotInner): ReactNode => {
			// "Set spine at 0" — resolved here because only the coord system
			// holds both scales at once. Each flag lives on the axis whose OWN
			// spine moves (the checkbox sits with the line it repositions); the
			// zero comes from the PERPENDICULAR scale: y's flag places the
			// vertical y spine at x = 0, x's flag places the horizontal x
			// spine at y = 0.
			const ySpineAt = zeroCrossingPx(
				input.xScale,
				input.xFieldType,
				input.yAxisConfig?.spineAtZero,
				inner.x0,
				inner.x1
			)
			const xSpineAt = zeroCrossingPx(
				input.yScale,
				input.yFieldType,
				input.xAxisConfig?.spineAtZero,
				inner.y0,
				inner.y1
			)
			return (
				<>
					{input.xScale && input.xFieldType && (
						<Axis
							scale={input.xScale}
							orientation="x"
							inner={inner}
							label={input.xLabel}
							config={input.xAxisConfig}
							fieldType={input.xFieldType}
							maxMeaningfulTicks={input.xMaxTicks}
							tickFont={input.tickFont}
							titleFont={input.xAxisTitleFont}
							showTicksAndLabels={input.showXAxis}
							layer={layer}
							titleAlignment={input.xAxisTitleAlignment}
							showTitle={input.showXAxisTitle ?? true}
							spinePosition={xSpineAt}
							opposingAxis={
								yAxisRenders
									? { config: input.yAxisConfig, spinePosition: ySpineAt }
									: undefined
							}
						/>
					)}
					{input.yScale && input.yFieldType && (
						<Axis
							scale={input.yScale}
							orientation="y"
							inner={inner}
							label={input.yLabel}
							config={input.yAxisConfig}
							fieldType={input.yFieldType}
							maxMeaningfulTicks={input.yMaxTicks}
							tickFont={input.tickFont}
							titleFont={input.yAxisTitleFont}
							showTicksAndLabels={input.showYAxis}
							layer={layer}
							titleAlignment={input.yAxisTitleAlignment}
							yTitleHorizontal={input.yAxisTitleHorizontal}
							showTitle={input.showYAxisTitle ?? true}
							spinePosition={ySpineAt}
							opposingAxis={
								xAxisRenders
									? { config: input.xAxisConfig, spinePosition: xSpineAt }
									: undefined
							}
						/>
					)}
				</>
			)
		},
	}
}
