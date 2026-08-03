import { AreasXMode } from "./areasX"
import { AreasYMode } from "./areasY"
import { BarsXMode } from "./barsX"
import { BarsYMode } from "./barsY"
import { ChordMode } from "./chord"
import { GeoChoroplethMode } from "./geoChoropleth"
import { GeoPointsMode } from "./geoPoints"
import { GeoSymbolsMode } from "./geoSymbols"
import { HexbinMode } from "./hexbin"
import { PackedCirclesMode } from "./packedCircles"
import { PiesMode } from "./pies"
import { SunburstMode } from "./sunburst"
import { TreemapMode } from "./treemap"
import { PiesXMode } from "./piesX"
import { PiesYMode } from "./piesY"
import { RadarMode } from "./radar"
import { SankeyMode } from "./sankey"
import { ScatterMode } from "./scatter"
import { TileMode } from "./tile"
import type { ChartModeDef } from "./types"

/** Registered modes in detection-precedence order. The first whose
 * `detect()` returns true wins. Scatter is the fallback (detect always
 * true) and must be last.
 *
 * Areas appear BEFORE bars because `x + length + connection` must resolve to
 * areas-x (more specific) rather than bars-x (which matches any `x + length`
 * regardless of connection). The three pie modes (`pies`, `pies-x`,
 * `pies-y`) are mutually exclusive via their x/y-mapping constraints, so
 * their relative order within this list is immaterial. */
export const MODE_REGISTRY: readonly ChartModeDef[] = [
	AreasXMode,
	AreasYMode,
	BarsXMode,
	BarsYMode,
	PiesMode,
	PiesXMode,
	PiesYMode,
	RadarMode,
	TileMode,
	GeoPointsMode,
	GeoSymbolsMode,
	GeoChoroplethMode,
	// After the geo modes: `connection + area` with no x/y is the bubble
	// map when the chart is geographic; otherwise five config-gated
	// siblings claim the same signature (and the bare `area`-only one) —
	// three trees (treemap / sunburst / packed circles) and two flows
	// (chord / sankey), mutually exclusive via `connection.hierarchyLayout`
	// (see hierarchySignature.ts), so their relative order is immaterial.
	TreemapMode,
	SunburstMode,
	ChordMode,
	SankeyMode,
	PackedCirclesMode,
	// Gated on the reserved `hue.measureSource === "hexCount"`, so it can't
	// shadow any earlier mode; before scatter only because scatter is the
	// always-true fallback.
	HexbinMode,
	ScatterMode,
]

export type { ChartModeDef } from "./types"
