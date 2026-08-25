import type { Encodings } from "../types"
import type { ChartModeDef, FieldTypeLookup } from "./types"
import type { ChannelConfigs } from "../channelConfig"

/** `x + length` (no y, no angle) → bars with categories along x-axis.
 *
 * Also activates as a HISTOGRAM: a quantitative `x` (no y, no angle) with the
 * x-axis histogram toggle on. No length is required — the renderer bins x and
 * counts rows per bin. The toggle is what distinguishes a histogram from the
 * strip-plot/scatter that a lone quantitative axis otherwise produces. */
export const BarsXMode: ChartModeDef = {
	id: "bars-x",
	detect: (
		encodings: Encodings,
		getType?: FieldTypeLookup,
		channelConfigs?: ChannelConfigs
	): boolean => {
		const xMapped = !!encodings.x?.field
		const yMapped = !!encodings.y?.field
		const lengthMapped = !!encodings.length?.field
		const angleMapped = !!encodings.angle?.field
		if (angleMapped || yMapped || !xMapped) return false
		if (lengthMapped) return true
		// Histogram: quantitative x + toggle on, no measure needed.
		const histogramOn = channelConfigs?.x?.histogram?.enabled === true
		const xField = encodings.x?.field
		return (
			histogramOn && !!xField && getType?.(xField) === "quantitative"
		)
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
		// Vertical bars: categories on x, continuous measure on y. The measure
		// lives on the length channel — bars-x detection requires y unmapped.
		measureAxis: "y",
		resolveMeasureField: (encodings) => encodings.length?.field ?? null,
		// A negative length points the bar the other way off the zero
		// baseline instead of collapsing it.
		supportsNegativeMeasure: true,
	},
}
