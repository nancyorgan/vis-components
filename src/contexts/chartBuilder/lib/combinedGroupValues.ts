import { GROUP_CHANNEL_ORDER } from "./groupEncodings"
import type { GroupChannel } from "./aggregators/stacks"
import { parseNumericCell } from "./scales"
import type { FieldType } from "./types"

/** The most frequent value of a list (on a tie, the one that reaches the
 *  top count first), or `null` when it is empty. */
export const modeValue = (values: string[]): string | null => {
	if (values.length === 0) return null
	const counts = new Map<string, number>()
	let bestKey = values[0] as string
	let bestCount = 0
	for (const v of values) {
		const next = (counts.get(v) ?? 0) + 1
		counts.set(v, next)
		if (next > bestCount) {
			bestCount = next
			bestKey = v
		}
	}
	return bestKey
}

/** ONE value of `field` for a mark that combines `rows`: the MEAN for a
 *  quantitative field (blank cells are missing data, not zeros), the most
 *  common value otherwise. `null` when no row carries a value. The rule a
 *  heatmap cell's color already followed, made available to every channel. */
export const combinedValue = (
	rows: ReadonlyArray<Record<string, unknown>>,
	field: string,
	type: FieldType
): string | number | null => {
	if (type === "quantitative") {
		let sum = 0
		let n = 0
		for (const row of rows) {
			const v = parseNumericCell(row[field])
			if (v !== null) {
				sum += v
				n += 1
			}
		}
		return n > 0 ? sum / n : null
	}
	return modeValue(
		rows
			.map((row) => row[field])
			.filter((v) => v !== undefined && v !== null && String(v) !== "")
			.map(String)
	)
}

/** The mapped channel scales this reads — structurally the relevant part of
 *  `AestheticScales`, kept minimal so the module stays free of the store. */
type ChannelFields = Partial<
	Record<GroupChannel, { field: { name: string; type: FieldType } } | null | undefined>
>

/** The value each mapped group channel takes for a mark that combines many
 *  rows and is NOT split by them — a heatmap cell, a hex cell. (Bars and
 *  slices split by these channels instead, so each of theirs has one value
 *  by construction.) Channels in `given` keep the value the caller already
 *  worked out (a heatmap cell's Color aggregate, a hex cell's point count);
 *  a channel with no value in the rows is left out, so the mark falls back
 *  to that channel's default like any unresolved value. */
export const combinedGroupValues = (
	rows: ReadonlyArray<Record<string, unknown>>,
	scales: ChannelFields,
	given: Partial<Record<GroupChannel, string | number | null | undefined>> = {}
): Partial<Record<GroupChannel, string | number | null | undefined>> => {
	const out: Partial<Record<GroupChannel, string | number | null | undefined>> = {
		...given,
	}
	for (const channel of GROUP_CHANNEL_ORDER) {
		if (channel in given) continue
		const mapped = scales[channel]
		if (!mapped) continue
		const value = combinedValue(rows, mapped.field.name, mapped.field.type)
		if (value !== null) out[channel] = value
	}
	return out
}
