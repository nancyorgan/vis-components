import type { Encodings } from "../types"
import type { ChartModeDef, FieldTypeLookup } from "./types"
import type { ChannelConfigs } from "../channelConfig"

/** `y + length` (no x, no angle) → bars with categories along y-axis.
 *
 * Also activates as a horizontal HISTOGRAM: a quantitative `y` (no x, no
 * angle) with the y-axis histogram toggle on. No length is required — the
 * renderer bins y and counts rows per bin. */
export const BarsYMode: ChartModeDef = {
	id: "bars-y",
	detect: (
		encodings: Encodings,
		getType?: FieldTypeLookup,
		channelConfigs?: ChannelConfigs
	): boolean => {
		const xMapped = !!encodings.x?.field
		const yMapped = !!encodings.y?.field
		const lengthMapped = !!encodings.length?.field
		const angleMapped = !!encodings.angle?.field
		if (angleMapped || xMapped || !yMapped) return false
		if (lengthMapped) return true
		// Histogram: quantitative y + toggle on, no measure needed.
		const histogramOn = channelConfigs?.y?.histogram?.enabled === true
		const yField = encodings.y?.field
		return histogramOn && !!yField && getType?.(yField) === "quantitative"
	},
	legend: {
		hideLengthInThisMode: true,
		hideAngleInThisMode: false,
		hideConnectionInThisMode: false,
		// Horizontal bars stack LEFT→RIGHT: the first-encountered value sits at
		// the left, so a top-down legend in discovery order already reads
		// left-to-right along the bar. Reversing (as vertical bars do, where the
		// first value is at the BOTTOM) would flip the legend against the stack.
		reverseCategoricalOrder: false,
	},
	facet: {
		supportsSharedMeasureMax: true,
	},
	canvas: {
		coordFamily: "cartesian",
		// Horizontal bars: categories on y, continuous measure on x. The measure
		// lives on the length channel — bars-y detection requires x unmapped.
		measureAxis: "x",
		resolveMeasureField: (encodings) => encodings.length?.field ?? null,
	},
}
