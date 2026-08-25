import type { Encodings } from "../types"
import type { ChartModeDef, FieldTypeLookup } from "./types"

/** `x + length + connection` (no y, no angle) → areas with categories
 * along x. Stacks by hue when hue is mapped (same aggregation as bars).
 *
 * Area-mode is OPT-IN via the `length` encoding: dropping a field on
 * length signals "this is the area's measure, render as a filled
 * region." The previous behavior auto-routed `x + y + connection + hue`
 * to areas-x — which surprised users who'd built a line chart with
 * `x + y + connection`, added hue to color the lines, and watched the
 * chart silently flip to area mode. Adding hue should color the lines,
 * not change the chart type. Users who actually want an area chart now
 * explicitly map length instead of y. */
export const AreasXMode: ChartModeDef = {
	id: "areas-x",
	// getType is no longer needed (the y-based detection that consulted
	// it is gone), but keep it in the signature for ChartModeDef compat.
	detect: (encodings: Encodings, _getType?: FieldTypeLookup): boolean => {
		const xMapped = !!encodings.x?.field
		const yMapped = !!encodings.y?.field
		const lengthMapped = !!encodings.length?.field
		const angleMapped = !!encodings.angle?.field
		const connectionMapped = !!encodings.connection?.field
		if (angleMapped || !connectionMapped || !xMapped) return false
		// Only the length-based form qualifies as area now: x + length +
		// connection, no y. With y mapped, we fall through to scatter
		// (line chart) — regardless of whether hue is mapped.
		return lengthMapped && !yMapped
	},
	legend: {
		hideLengthInThisMode: true,
		hideAngleInThisMode: false,
		hideConnectionInThisMode: false,
		reverseCategoricalOrder: true,
	},
	facet: {
		supportsSharedMeasureMax: true,
	},
	annotations: {
		// The vertical value axis is the measure (length), not y.
		xValueChannel: "x",
		yValueChannel: "length",
		polarValueCoords: false,
	},
	canvas: {
		coordFamily: "cartesian",
		measureAxis: "y",
		// Areas read `length` first, then fall back to `y` (the length-less
		// areas-x form binds the measure to y directly).
		resolveMeasureField: (encodings) =>
			encodings.length?.field ?? encodings.y?.field ?? null,
	},
}
