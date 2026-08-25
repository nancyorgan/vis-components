import type { Encodings } from "../types"
import type { ChartModeDef } from "./types"

/** `y + length + connection` (no x, no angle) → areas with categories along y.
 * Stacks by hue when hue is mapped (same aggregation as bars). */
export const AreasYMode: ChartModeDef = {
	id: "areas-y",
	detect: (encodings: Encodings): boolean => {
		const xMapped = !!encodings.x?.field
		const yMapped = !!encodings.y?.field
		const lengthMapped = !!encodings.length?.field
		const angleMapped = !!encodings.angle?.field
		const connectionMapped = !!encodings.connection?.field
		return (
			yMapped && !xMapped && lengthMapped && !angleMapped && connectionMapped
		)
	},
	legend: {
		hideLengthInThisMode: true,
		hideAngleInThisMode: false,
		hideConnectionInThisMode: false,
		// Horizontal areas stack LEFT→RIGHT (first value at the left), so a
		// top-down legend in discovery order already matches the stack. Only the
		// vertical variant (areas-x, first value at the bottom) needs reversing.
		reverseCategoricalOrder: false,
	},
	facet: {
		supportsSharedMeasureMax: true,
	},
	annotations: {
		// The horizontal value axis is the measure (length), not x.
		xValueChannel: "length",
		yValueChannel: "y",
		polarValueCoords: false,
	},
	canvas: {
		coordFamily: "cartesian",
		measureAxis: "x",
		// Horizontal areas bind the measure via `length` only (no x fallback
		// -- x is the measure PIXEL axis, not a measure field source).
		resolveMeasureField: (encodings) => encodings.length?.field ?? null,
	},
}
