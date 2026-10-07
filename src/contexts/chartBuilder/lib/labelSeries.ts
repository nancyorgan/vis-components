// Series identity + in-series rank for the data-label "Which labels"
// endpoint selection on aggregated charts (bars, areas, pies), per the
// layer-wide scope `DataLabelsConfig.labelPointsScope`.
//
// The label layer tags each series' first / last anchor; what a "series"
// IS depends on the scope:
//
//   - "series": the same slice position across categories (the same layer
//     of every stack, the same wedge of every pie, the same sub-band of
//     every band). Key = every stack / group channel value EXCEPT channels
//     mapped to the category field itself — hue = x colors each bar but
//     forms no series across bars. No distinguishing channel → "" (one
//     implicit group → the layer's single-survivor rule). Rank = category
//     position along the axis (or the pie's order).
//   - "group": the bars inside one category band (bars only — areas and
//     pies have no side-by-side sub-bands). Key = category + the
//     measure-axis (stack / overlay) channel values, so every layer of the
//     first sub-band gets a "first"; rank = sub-band index.
//   - "stack": one physical bar's layers / one area column's layers / one
//     pie's wedges. Key = category + group-channel values (+ sign side on
//     a mirrored / diverging bar, each side being its own stack); rank =
//     layer order from the baseline (wedge order from the arc start).
//
// A scope whose channel isn't mapped (no group-mode channel for "group",
// nothing on the measure axis for "stack") falls back to "series" — the
// sidebar shows the same fallback.

import type { LabelPointsScope } from "./channelConfig"
import type { GroupChannel } from "./legendSections"
import {
	mappedStackChannels,
	type StackChannel,
	type StackModeEntry,
} from "./stackMode"
import type { Encodings } from "./types"

/** Unit separator — can't collide with a data value. */
const SERIES_SEP = String.fromCharCode(0x1f)

/** Which mapped channels subdivide the category axis (`group`) and which
 *  layer along the measure axis (`layer`: stack + overlay). */
export type LabelSeriesChannels = {
	group: readonly StackChannel[]
	layer: readonly StackChannel[]
}

/** Bars: split the resolved stack modes by layout role. */
export const labelSeriesChannelsFromModes = (
	modes: readonly StackModeEntry[]
): LabelSeriesChannels => ({
	group: modes.filter((m) => m.mode === "group").map((m) => m.channel),
	layer: modes.filter((m) => m.mode !== "group").map((m) => m.channel),
})

/** Areas and pies: every mapped stack channel forms a layer (a wedge);
 *  neither family has side-by-side groups. */
export const labelSeriesChannelsFromEncodings = (
	encodings: Encodings
): LabelSeriesChannels => ({ group: [], layer: mappedStackChannels(encodings) })

/** The scope that actually applies: a scope whose channel isn't mapped
 *  reads as "series". Channels mapped to the category field don't count
 *  (they color without grouping or layering). */
const effectiveLabelScope = (
	scope: LabelPointsScope,
	channels: LabelSeriesChannels,
	categoryField: string | null,
	encodings?: Encodings
): LabelPointsScope => {
	const real = (chans: readonly StackChannel[]) =>
		chans.some((ch) => encodings?.[ch]?.field !== categoryField)
	if (scope === "group" && !real(channels.group)) return "series"
	if (scope === "stack" && !real(channels.layer)) return "series"
	return scope
}

export type LabelSeriesInput = {
	category: string
	groupValues: Partial<Record<GroupChannel, string>>
	/** Position along the category axis (band position, pie index). */
	categoryRank: number
	/** Sub-band index inside the band (bars); 0 elsewhere. */
	leafIndex: number
	/** Layer order from the baseline / wedge order from the arc start. */
	layerIndex: number
	/** True for the negative side of a diverging / mirrored stack. */
	negative?: boolean
}

export const labelSeriesResolver = (
	scope: LabelPointsScope,
	channels: LabelSeriesChannels,
	categoryField: string | null,
	encodings?: Encodings
): ((input: LabelSeriesInput) => { series: string; rank: number }) => {
	const effective = effectiveLabelScope(scope, channels, categoryField, encodings)
	const seriesChannels = [...channels.group, ...channels.layer].filter(
		(ch) => encodings?.[ch]?.field !== categoryField
	)
	const keyOf = (
		gv: Partial<Record<GroupChannel, string>>,
		chans: readonly StackChannel[]
	): string => chans.map((ch) => gv[ch] ?? "").join(SERIES_SEP)
	return ({ category, groupValues, categoryRank, leafIndex, layerIndex, negative }) => {
		if (effective === "group") {
			return {
				series: `${category}${SERIES_SEP}${keyOf(groupValues, channels.layer)}`,
				rank: leafIndex,
			}
		}
		if (effective === "stack") {
			const side = negative ? "-" : "+"
			return {
				series: `${category}${SERIES_SEP}${keyOf(groupValues, channels.group)}${SERIES_SEP}${side}`,
				rank: layerIndex,
			}
		}
		return { series: keyOf(groupValues, seriesChannels), rank: categoryRank }
	}
}
