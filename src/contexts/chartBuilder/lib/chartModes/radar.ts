import type { Encodings } from "../types"
import type { ChartModeDef } from "./types"

/** Radar (spider) chart: `r` + `angle` mapped with NO x or y position
 *  encoding. The `r` channel drives radial distance from the center;
 *  `angle` drives angular position around the center.
 *
 *  When `connection` is also mapped, rows sharing a connection value
 *  group into a closed polygon (sorted by angle). Without `connection`
 *  the chart renders just dots at each (angle, r) point.
 *
 *  Length / hue / opacity / etc. compose as in scatter — radar is the
 *  polar analogue of x+y scatter, not a special mode that overrides
 *  aesthetic channels. */
export const RadarMode: ChartModeDef = {
	id: "radar",
	detect: (encodings: Encodings): boolean => {
		const xMapped = !!encodings.x?.field
		const yMapped = !!encodings.y?.field
		const rMapped = !!encodings.r?.field
		const angleMapped = !!encodings.angle?.field
		return rMapped && angleMapped && !xMapped && !yMapped
	},
	legend: {
		hideLengthInThisMode: false,
		// Angle drives angular position (not a quantitative measure to scale
		// independently), so a legend section for it would be redundant.
		hideAngleInThisMode: true,
		hideConnectionInThisMode: false,
		reverseCategoricalOrder: false,
	},
	facet: {
		supportsSharedMeasureMax: false,
	},
	canvas: {
		coordFamily: "polar",
		measureAxis: null,
		polarUnit: "rAxisMax",
		// RadarPlot draws value-mode circle / line-segment annotations itself
		// (polar coords); the canvas annotation layer must skip them.
		valueAnnotationsInRenderer: true,
	},
}
