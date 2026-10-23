/** What a chart spec can say, read from the same tables the editor uses:
 *  channels and the field types they take (CHANNELS), and the chart
 *  families with the channels each variation fills (the quick-start
 *  decision tree). */

import { CHANNELS, conflictsFor } from "../channels"
import type { StackMode } from "../channelConfig"
import {
	QUICK_START_CHART_TYPES,
	QUICK_START_VARIATIONS,
	type QuickStartChartType,
	type QuickStartVariation,
} from "../quickStartVariations"
import type { EncodingChannel, FieldType } from "../types"
import { SPEC_CHANNELS, type SpecChannel } from "./chartSpec"
import { FAMILY_MODES, GEO_NEEDS, OPTIONAL_CHANNELS } from "./composeVisual"

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
			/** Channels in `channels` a spec may leave out. */
			optional?: readonly SpecChannel[]
			/** Channels the variation fills from another channel's field. */
			sameFieldAs?: Partial<Record<EncodingChannel, EncodingChannel>>
			stack?: StackMode
			/** A map or flow variation: where the fields it needs go. */
			note?: string
		}>
	}>
	fieldTypes: readonly FieldType[]
}

/** The channels a map variation's geo mode fills from detected fields,
 *  which the quick-start variation leaves out of `channels`. */
const GEO_CHANNELS: Record<
	NonNullable<QuickStartVariation["geo"]>,
	Partial<Record<EncodingChannel, readonly FieldType[]>>
> = {
	choropleth: { connection: CHANNELS.connection.accepts },
	symbols: { connection: CHANNELS.connection.accepts },
	points: { x: ["quantitative"], y: ["quantitative"] },
}

/** Where a flow variation's fields go; the target resolves as in
 *  `resolveFlowTargetField`. */
const FLOW_NOTE =
	`edge sources on "connection", edge weights on "area"; the target field in settings.channelConfigs.connection.flowTargetField, else a field sharing values with the sources, else the first other categorical field`

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
			const optional = OPTIONAL_CHANNELS[family]?.filter((c) => c in v.channels) ?? []
			const sameFieldAs: Partial<Record<EncodingChannel, EncodingChannel>> = {}
			if (v.connectionFrom) sameFieldAs.connection = v.connectionFrom
			if (v.hueFrom) sameFieldAs.hue = v.hueFrom
			return {
				name: v.name,
				channels: v.geo ? { ...GEO_CHANNELS[v.geo], ...v.channels } : v.channels,
				...(optional.length > 0 ? { optional } : {}),
				...(Object.keys(sameFieldAs).length > 0 ? { sameFieldAs } : {}),
				...(v.stackMode ? { stack: v.stackMode } : {}),
				...(v.geo ? { note: GEO_NEEDS[v.geo] } : v.requiresFlowTarget ? { note: FLOW_NOTE } : {}),
			}
		}),
	})),
	fieldTypes: ["quantitative", "categorical", "temporal", "ordinal"],
})
