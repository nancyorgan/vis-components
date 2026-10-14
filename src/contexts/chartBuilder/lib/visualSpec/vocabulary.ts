/** What a chart spec can say, read from the same tables the editor uses:
 *  channels and the field types they take (CHANNELS), and the chart
 *  families with the channels each variation fills (the quick-start
 *  decision tree). A chart name that isn't a family here isn't one Zafiro
 *  knows. */

import { CHANNELS, conflictsFor } from "../channels"
import type { StackMode } from "../channelConfig"
import {
	QUICK_START_CHART_TYPES,
	QUICK_START_VARIATIONS,
	type QuickStartChartType,
} from "../quickStartVariations"
import type { EncodingChannel, FieldType } from "../types"
import { SPEC_CHANNELS, type SpecChannel } from "./chartSpec"
import { FAMILY_MODES } from "./composeVisual"

export type ChartVocabulary = {
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
			/** Channels the variation fills from another channel's field. */
			sameFieldAs?: Partial<Record<EncodingChannel, EncodingChannel>>
			stack?: StackMode
		}>
	}>
	fieldTypes: readonly FieldType[]
}

export const chartVocabulary = (): ChartVocabulary => ({
	channels: SPEC_CHANNELS.map((channel) => ({
		channel,
		label: CHANNELS[channel].label,
		accepts: CHANNELS[channel].accepts,
		conflictsWith: conflictsFor(channel),
	})),
	families: QUICK_START_CHART_TYPES.map((family) => ({
		family,
		modes: FAMILY_MODES[family],
		variations: QUICK_START_VARIATIONS[family].map((v) => {
			const sameFieldAs: Partial<Record<EncodingChannel, EncodingChannel>> = {}
			if (v.connectionFrom) sameFieldAs.connection = v.connectionFrom
			if (v.hueFrom) sameFieldAs.hue = v.hueFrom
			return {
				name: v.name,
				channels: v.channels,
				...(Object.keys(sameFieldAs).length > 0 ? { sameFieldAs } : {}),
				...(v.stackMode ? { stack: v.stackMode } : {}),
			}
		}),
	})),
	fieldTypes: ["quantitative", "categorical", "temporal", "ordinal"],
})
