import type { ComponentType } from "react"

import type { UniversalRendererProps } from "../../lib/chartRendererProps"
import type { ChartMode } from "../../lib/chartMode"
import { AreaPlot } from "./AreaPlot"
import { BarPlot } from "./BarPlot"
import { ChordPlot } from "./ChordPlot"
import { GeoChoroplethPlot } from "./GeoChoroplethPlot"
import { GeoPointPlot } from "./GeoPointPlot"
import { GeoSymbolPlot } from "./GeoSymbolPlot"
import { HexbinPlot } from "./HexbinPlot"
import { PackedCirclesPlot } from "./PackedCirclesPlot"
import { PiePlot } from "./PiePlot"
import { RadarPlot } from "./RadarPlot"
import { SankeyPlot } from "./SankeyPlot"
import { ScatterPlot } from "./ScatterPlot"
import { SunburstPlot } from "./SunburstPlot"
import { TilePlot } from "./TilePlot"
import { TreemapPlot } from "./TreemapPlot"

/** Mode id → renderer component. The mode registry (`lib/chartModes`) is
 *  React-free — it holds detection + declarative traits only — so mode
 *  detection can be imported (by tests, the solver, sidebar hooks) without
 *  dragging the whole renderer tree along. This map is the components-side
 *  binding PlotCanvas dispatches through.
 *
 *  Keyed by the full `ChartMode` union: registering a new mode without a
 *  renderer here is a compile error. Values are typed against
 *  `UniversalRendererProps` (the closed superset PlotCanvas passes), so a
 *  renderer whose props drift from the shared contract fails to compile
 *  here rather than mis-rendering at runtime. */
export const MODE_RENDERERS: Record<
	ChartMode,
	ComponentType<UniversalRendererProps>
> = {
	scatter: ScatterPlot,
	"bars-x": BarPlot,
	"bars-y": BarPlot,
	pies: PiePlot,
	"pies-x": PiePlot,
	"pies-y": PiePlot,
	"areas-x": AreaPlot,
	"areas-y": AreaPlot,
	radar: RadarPlot,
	tile: TilePlot,
	"geo-points": GeoPointPlot,
	"geo-symbols": GeoSymbolPlot,
	"geo-choropleth": GeoChoroplethPlot,
	"packed-circles": PackedCirclesPlot,
	treemap: TreemapPlot,
	sunburst: SunburstPlot,
	chord: ChordPlot,
	sankey: SankeyPlot,
	hexbin: HexbinPlot,
}
