/** What a chart spec can say, read from the same tables the editor uses:
 *  channels and the field types they take (CHANNELS), and the chart
 *  families with the channels each variation fills (the quick-start
 *  decision tree). */

import type { StackMode } from "../channelConfig"
import { CHANNELS, conflictsFor } from "../channels"
import { QUICK_START_VARIATIONS, type QuickStartChartType } from "../quickStartVariations"
import type { EncodingChannel, FieldType } from "../types"
import {
	DEFERRED_FAMILIES,
	EDIT_KEYS,
	SPEC_CHANNELS,
	SPEC_FAMILIES,
	SPEC_KEYS,
	type SpecChannel,
} from "./chartSpec"
import { FAMILY_MODES, OPTIONAL_CHANNELS } from "./composeVisual"

export type ChartVocabulary = {
	/** The keys a spec takes, each with what it says. */
	spec: Readonly<Record<string, string>>
	/** The spec keys an edit takes; in an edit a channel set to null is
	 *  unmapped and an axis bound set to null is cleared. */
	editKeys: readonly string[]
	channels: Array<{
		channel: SpecChannel
		label: string
		accepts: readonly FieldType[]
		conflictsWith: readonly EncodingChannel[]
	}>
	families: Array<{
		family: QuickStartChartType
		modes: readonly string[]
		variations: Array<{
			name: string
			channels: Partial<Record<EncodingChannel, readonly FieldType[]>>
			/** Channels in `channels` a spec may leave out. */
			optional?: readonly SpecChannel[]
			/** Channels the variation fills from another channel's field. */
			sameFieldAs?: Partial<Record<EncodingChannel, EncodingChannel>>
			stack?: StackMode
		}>
	}>
	/** Families the editor draws that a spec can't make yet. */
	editorOnlyFamilies: readonly QuickStartChartType[]
	fieldTypes: readonly FieldType[]
}

export const chartVocabulary = (): ChartVocabulary => ({
	spec: SPEC_KEYS,
	editKeys: EDIT_KEYS,
	channels: SPEC_CHANNELS.map((channel) => ({
		channel,
		label: CHANNELS[channel].label,
		accepts: CHANNELS[channel].accepts,
		conflictsWith: conflictsFor(channel),
	})),
	families: SPEC_FAMILIES.map((family) => ({
		family,
		modes: FAMILY_MODES[family] ?? [],
		variations: QUICK_START_VARIATIONS[family].map((v) => {
			const optional = OPTIONAL_CHANNELS[family]?.filter((c) => c in v.channels) ?? []
			const sameFieldAs: Partial<Record<EncodingChannel, EncodingChannel>> = {}
			if (v.connectionFrom) sameFieldAs.connection = v.connectionFrom
			if (v.hueFrom) sameFieldAs.hue = v.hueFrom
			return {
				name: v.name,
				channels: v.channels,
				...(optional.length > 0 ? { optional } : {}),
				...(Object.keys(sameFieldAs).length > 0 ? { sameFieldAs } : {}),
				...(v.stackMode ? { stack: v.stackMode } : {}),
			}
		}),
	})),
	editorOnlyFamilies: DEFERRED_FAMILIES,
	fieldTypes: ["quantitative", "categorical", "temporal", "ordinal"],
})
