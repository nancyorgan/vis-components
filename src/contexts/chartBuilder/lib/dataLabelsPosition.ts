import type { DataLabelsEncodings, Encodings } from "./types"

/** The Data Labels position channels that inherit the chart's own mapping. */
export const DATA_LABEL_POSITION_CHANNELS = ["x", "y", "angle"] as const
export type DataLabelPositionChannel =
	(typeof DATA_LABEL_POSITION_CHANNELS)[number]

/** Data labels almost always sit where the marks do, so an UNSET label
 *  position (X / Y, or Angle on a pie) follows the chart's own
 *  encoding of that channel — live, so re-mapping the chart's X moves the
 *  labels with it. A field the user picks on the Data Labels shelf wins;
 *  "— none —" there is stored as `none: true` (an unset slot already means
 *  "inherit") and keeps the slot empty. Labels still need a Value before
 *  they draw, so the inherited position alone shows nothing. */
export const resolveDataLabelPositions = (
	labels: DataLabelsEncodings,
	chart: Pick<Encodings, DataLabelPositionChannel>,
): DataLabelsEncodings => {
	let out = labels
	for (const ch of DATA_LABEL_POSITION_CHANNELS) {
		const slot = labels[ch] as DataLabelsEncodings[typeof ch] | undefined
		if (slot?.field || slot?.none) continue
		const inherited = chart[ch]?.field ?? null
		if (!inherited) continue
		if (out === labels) out = { ...labels }
		out[ch] = { field: inherited }
	}
	return out
}

type BarChartEncodings = Pick<Encodings, "x" | "y" | "length" | "angle" | "connection">

/** The value axis of a bar chart: `"y"` for vertical bars (X + Length),
 *  `"x"` for horizontal ones (Y + Length). `null` for anything else: nothing
 *  on Length, fields on both X and Y (a combo, a vector field), a pie, an
 *  area chart (Connection over X / Y + Length). */
export const barValueAxis = (chart: BarChartEncodings): "x" | "y" | null => {
	if (!chart.length?.field || chart.angle?.field || chart.connection?.field) return null
	const x = !!chart.x?.field
	const y = !!chart.y?.field
	if (x === y) return null
	return x ? "y" : "x"
}

const labelValueSet = (labels: DataLabelsEncodings): boolean =>
	!!labels.value?.field ||
	(labels.value?.multiField === true && (labels.value.fields?.length ?? 0) > 0)

/** Data labels on bars draw at once: when the labels have a value on a bar
 *  chart and the value-axis position is unset, it takes the Length variable
 *  (Y on vertical bars, X on horizontal), the position that sits each label
 *  on its bar. A position already set (a field, or "— none —") stays, as
 *  does every non-bar chart. Same object when nothing changes. Run at the
 *  moment labels get a value (the panel's Value pick, a settings patch). */
export const withBarLabelPosition = (
	labels: DataLabelsEncodings,
	chart: BarChartEncodings
): DataLabelsEncodings => {
	const axis = barValueAxis(chart)
	if (!axis || !labelValueSet(labels)) return labels
	const slot = labels[axis] as DataLabelsEncodings[typeof axis] | undefined
	if (slot?.field || slot?.none) return labels
	return { ...labels, [axis]: { field: chart.length?.field ?? null } }
}

/** The note a program gets when its bar labels took the Length variable as
 *  their position: where they draw and the setting that moves them. */
export const barLabelPositionNote = (
	axis: "x" | "y",
	lengthField: string,
	position: string
): string =>
	`data labels sit on the bars (dataLabelsEncodings.${axis} = "${lengthField}"); dataLabelsConfig.barLabelPosition places them on each bar (now "${position}"; options "center", "inside-base", "inside-end", "outside-end")`
