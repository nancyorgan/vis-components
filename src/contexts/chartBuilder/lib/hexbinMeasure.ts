// Hexbin derived channel source — the hexbin sibling of packedMeasure.ts /
// histogramMeasure.ts. When x and y are both quantitative, the hue dropdown
// offers "Point count" (`measureSource: "hexCount"`); picking it is what
// switches the chart into hexbin mode (see chartModes/hexbin.ts).
import type { FieldTypeLookup } from "./chartModes/types"
import type { Encoding, EncodingChannel, Encodings } from "./types"

export type HexbinDerivedSource = "hexCount"

/** Reserved `<select>` option value — prefixed so it can't collide with a
 * dataset column name. onChange handlers compare against this BEFORE
 * treating the value as a field name (mirrors MEASURE_OPTION_VALUE /
 * PACKED_MEASURE_OPTION_VALUE). */
export const HEXBIN_MEASURE_OPTION_VALUE = "__hexbin_measure__hexCount"

export const HEXBIN_COUNT_LABEL = "Point count"

/** The channel's active hexbin source, or null. Reads the shared
 * `measureSource` slot but only the hexbin value — histogram/packed sources
 * pass through as null here. */
export const hexbinSourceOf = (
	encoding: Encoding | undefined
): HexbinDerivedSource | null =>
	encoding?.measureSource === "hexCount" ? "hexCount" : null

/** The encoding signature that makes hexbinning meaningful: x and y both
 * mapped and quantitative. Without a type lookup we can't verify, so the
 * safe default is false (the option just isn't offered). */
export const hexbinEligible = (
	encodings: Encodings,
	getType?: FieldTypeLookup
): boolean => {
	const xField = encodings.x?.field
	const yField = encodings.y?.field
	if (!xField || !yField || !getType) return false
	return (
		getType(xField) === "quantitative" && getType(yField) === "quantitative"
	)
}

/** Derived options a channel's dropdown should offer — hue only, and only
 * over a continuous×continuous position pair. One list shared by the
 * encoding shelf and the Color panel's "Vary by" select so they can't
 * drift. */
export const hexbinDerivedOptions = (
	channel: EncodingChannel,
	encodings: Encodings,
	getType?: FieldTypeLookup
): Array<{ value: string; label: string }> =>
	channel === "hue" && hexbinEligible(encodings, getType)
		? [{ value: HEXBIN_MEASURE_OPTION_VALUE, label: HEXBIN_COUNT_LABEL }]
		: []

/** Reverse lookup: the derived source for a reserved option value, or null
 * when the value is a plain field name / empty. */
export const hexbinSourceForOptionValue = (
	value: string
): HexbinDerivedSource | null =>
	value === HEXBIN_MEASURE_OPTION_VALUE ? "hexCount" : null
