import type { Encodings } from "../types"
import type { ChartModeDef, FieldTypeLookup } from "./types"

/** Both x and y must be categorical/ordinal for a tile chart to make sense
 * — heatmaps need discrete bins on both axes. A quantitative y with hue
 * is a scatter (or strip plot), not a heatmap. */
const isDiscreteAxis = (
	encodings: Encodings,
	axis: "x" | "y",
	getType: FieldTypeLookup
): boolean => {
	const fieldName = encodings[axis]?.field
	if (!fieldName) return false
	const t = getType(fieldName)
	return t === "categorical" || t === "ordinal"
}

/** A heatmap-style tile chart. Detects when:
 *   - both `x` and `y` are mapped AND categorical/ordinal,
 *   - at least one of `hue` or `text` is mapped,
 *   - no glyph-implying aesthetics are mapped (length, angle, shape, area,
 *     opacity, connection).
 *
 * The categorical-axis requirement keeps strip plots (categorical x +
 * quantitative y + hue) and scatter+hue charts from getting auto-promoted
 * into heatmaps. To "go back to points" inside a tile, the user maps any
 * size-implying channel (e.g. area) — that adds a glyph attribute and
 * drops the chart back to scatter.
 *
 * When the caller can't supply field types, tile detection is skipped —
 * scatter is the safer fallback than misidentifying a chart as a heatmap. */
export const TileMode: ChartModeDef = {
	id: "tile",
	detect: (encodings: Encodings, getType?: FieldTypeLookup): boolean => {
		if (!getType) return false
		if (!isDiscreteAxis(encodings, "x", getType)) return false
		if (!isDiscreteAxis(encodings, "y", getType)) return false
		const hue = !!encodings.hue?.field
		const text = !!encodings.text?.field
		if (!hue && !text) return false
		const glyphAttrMapped =
			!!encodings.length?.field ||
			!!encodings.angle?.field ||
			!!encodings.shape?.field ||
			!!encodings.area?.field ||
			!!encodings.opacity?.field ||
			!!encodings.connection?.field
		return !glyphAttrMapped
	},
	legend: {
		hideLengthInThisMode: false,
		hideAngleInThisMode: false,
		hideConnectionInThisMode: false,
		reverseCategoricalOrder: false,
	},
	facet: {
		supportsSharedMeasureMax: false,
	},
	annotations: {
		xValueChannel: "x",
		yValueChannel: "y",
		polarValueCoords: false,
	},
	canvas: {
		coordFamily: "cartesian",
		measureAxis: null,
	},
}
