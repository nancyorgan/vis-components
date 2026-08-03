import type { ReactNode } from "react"

import { Axis } from "../../components/viz/Axes"
import type { AxisConfig } from "../channelConfig"
import type {
	FontConfig,
	LabelAlignment,
	TextFontConfig,
} from "../labelsConfig"
import type { PlotInner } from "../plotLayout"
import type { PositionScale } from "../scales"
import type { FieldType } from "../types"
import type { AxisLayer, CartesianScales, CoordSystem } from "./types"

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
	return {
		kind: "cartesian",
		scales,
		renderAxes: (layer: AxisLayer, inner: PlotInner): ReactNode => (
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
					/>
				)}
			</>
		),
	}
}
