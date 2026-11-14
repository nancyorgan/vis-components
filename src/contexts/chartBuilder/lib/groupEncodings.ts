import type { GroupChannel, GroupEncoding } from "./aggregators/stacks"
import type { FieldType } from "./types"

/** The channels that split an aggregated mark into slices, in the order
 *  their values key a slice (stable slice-key tuples). */
export const GROUP_CHANNEL_ORDER: readonly GroupChannel[] = [
	"hue",
	"outlineHue",
	"saturation",
	"brightness",
	"pattern",
	"opacity",
]

/** The mapped channel scales this reads — structurally the relevant part of
 *  `AestheticScales` (store/useAestheticScales), kept minimal so this
 *  module stays free of the store. */
type GroupScales = Partial<
	Record<GroupChannel, { field: { name: string; type: FieldType } } | null | undefined>
>

/** The group encodings an aggregating renderer (bars, pies) slices its
 *  marks by: one per MAPPED group channel, in `GROUP_CHANNEL_ORDER`.
 *
 *  One list for every renderer. Bars and pies each built their own, and the
 *  pie's had drifted: it left out the outline color, so a variable mapped to
 *  Color → Slice outline reached the legend but never the slices. */
export const aestheticGroupEncodings = (scales: GroupScales): GroupEncoding[] =>
	GROUP_CHANNEL_ORDER.flatMap((channel) => {
		const mapped = scales[channel]
		return mapped
			? [{ channel, field: mapped.field.name, type: mapped.field.type }]
			: []
	})
