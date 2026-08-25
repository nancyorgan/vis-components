import type { Encodings } from "../types"
import type { ChartModeDef } from "./types"

/** `angle` mapped with NO x or y position encoding → one centered pie chart.
 *
 * This is the "classic" single pie case: wedges come from the hue grouping
 * (or a single solid wedge if hue isn't mapped). Multi-pie layouts keep
 * using `pies-x` / `pies-y`, which put the pies into a band along the
 * corresponding axis. The `facet` channel still works orthogonally to all
 * three pie modes, producing small multiples of whichever pie layout is
 * active. */
export const PiesMode: ChartModeDef = {
	id: "pies",
	detect: (encodings: Encodings): boolean => {
		const xMapped = !!encodings.x?.field
		const yMapped = !!encodings.y?.field
		const rMapped = !!encodings.r?.field
		const lengthMapped = !!encodings.length?.field
		const angleMapped = !!encodings.angle?.field
		// `r + angle` is radar's territory — exclude it from pies so the
		// registry ordering picks RadarMode unambiguously.
		return angleMapped && !lengthMapped && !xMapped && !yMapped && !rMapped
	},
	legend: {
		hideLengthInThisMode: false,
		hideAngleInThisMode: true,
		hideConnectionInThisMode: false,
		reverseCategoricalOrder: false,
	},
	facet: {
		supportsSharedMeasureMax: false,
	},
	annotations: {
		// No value axes — the slice angle consumed the measure and there is
		// no positional field; value mode is disabled (polar coordFamily).
		xValueChannel: null,
		yValueChannel: null,
		polarValueCoords: false,
	},
	canvas: {
		coordFamily: "polar",
		measureAxis: null,
		polarUnit: "angleSum",
	},
}
