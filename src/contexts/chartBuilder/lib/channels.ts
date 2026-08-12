import type { EncodingChannel, FieldType } from "./types"

/** Pure, component-free channel metadata. Options-panel lookups live on
 * the components side (`components/sidebar/channelOptions/channelPanels`)
 * so lib stays React-free and importing this metadata never pulls the
 * sidebar tree (panel components import types, so having them in this
 * module would also form a cycle). */
export type ChannelDef = {
	id: EncodingChannel
	label: string
	accepts: readonly FieldType[]
	conflictsWith?: readonly EncodingChannel[]
	legendCandidate: boolean
	legendOrder?: number
	shelfOrder: number
}

const ALL: readonly FieldType[] = [
	"quantitative",
	"categorical",
	"temporal",
	"ordinal",
]
const QUANTITATIVE_LIKE: readonly FieldType[] = ["quantitative", "ordinal"]
const DISCRETE_LIKE: readonly FieldType[] = ["categorical", "ordinal"]

/** Single source of truth for encoding-channel metadata. Adding a channel is
 * one entry here (plus one entry in `CHANNEL_PANELS` in
 * `components/sidebar/channelOptions/channelPanels` for the options-panel
 * component); the sidebar shelf order, legend order,
 * field-type compatibility, and mutual-exclusion rules all derive from this
 * record. */
export const CHANNELS: Record<EncodingChannel, ChannelDef> = {
	x: {
		id: "x",
		label: "X position",
		accepts: ALL,
		legendCandidate: false,
		shelfOrder: 0,
	},
	y: {
		id: "y",
		label: "Y position",
		accepts: ALL,
		legendCandidate: false,
		shelfOrder: 1,
	},
	r: {
		id: "r",
		label: "R position",
		accepts: ALL,
		conflictsWith: ["x", "y"],
		legendCandidate: false,
		shelfOrder: 1.5,
	},
	facet: {
		id: "facet",
		label: "Facet (wrap)",
		accepts: DISCRETE_LIKE,
		conflictsWith: ["facetRow", "facetCol"],
		legendCandidate: false,
		shelfOrder: 2,
	},
	facetRow: {
		id: "facetRow",
		label: "Facet (row)",
		accepts: DISCRETE_LIKE,
		legendCandidate: false,
		shelfOrder: 2.1,
	},
	facetCol: {
		id: "facetCol",
		label: "Facet (col)",
		accepts: DISCRETE_LIKE,
		legendCandidate: false,
		shelfOrder: 2.2,
	},
	hue: {
		id: "hue",
		label: "Color",
		accepts: ALL,
		legendCandidate: true,
		legendOrder: 0,
		shelfOrder: 3,
	},
	outlineHue: {
		id: "outlineHue",
		label: "Outline color",
		accepts: ALL,
		// Coexists with hue by design (fill vs. outline are independent color
		// dimensions), so no `conflictsWith`. Surfaced inside the Shape panel
		// rather than as its own shelf row (see HIDDEN_FROM_MAIN_SHELF), but it
		// is a first-class channel so it gets a legend section for free.
		legendCandidate: true,
		legendOrder: 0.5,
		shelfOrder: 3.5,
	},
	length: {
		id: "length",
		label: "Length",
		accepts: ALL,
		conflictsWith: ["shape", "area"],
		legendCandidate: true,
		legendOrder: 5,
		shelfOrder: 4,
	},
	connection: {
		id: "connection",
		label: "Connection",
		accepts: DISCRETE_LIKE,
		legendCandidate: false,
		shelfOrder: 5,
	},
	opacity: {
		id: "opacity",
		label: "Opacity",
		accepts: ALL,
		legendCandidate: true,
		legendOrder: 4,
		shelfOrder: 6,
	},
	area: {
		id: "area",
		label: "Area",
		accepts: QUANTITATIVE_LIKE,
		conflictsWith: ["length"],
		legendCandidate: true,
		legendOrder: 3,
		shelfOrder: 7,
	},
	shape: {
		id: "shape",
		label: "Shape",
		accepts: DISCRETE_LIKE,
		conflictsWith: ["length"],
		legendCandidate: true,
		legendOrder: 1,
		shelfOrder: 8,
	},
	angle: {
		id: "angle",
		label: "Angle",
		accepts: ALL,
		legendCandidate: true,
		legendOrder: 6,
		shelfOrder: 9,
	},
	saturation: {
		id: "saturation",
		label: "Saturation",
		accepts: ALL,
		// On its own field, saturation gets a legend section (swatches =
		// the aux swatch color modulated by each category's level), same as
		// opacity. Sharing a field with another group channel still folds it
		// into that field's combined section.
		legendCandidate: true,
		legendOrder: 4.1,
		shelfOrder: 10,
	},
	brightness: {
		id: "brightness",
		label: "Brightness",
		accepts: ALL,
		// See saturation above — same solo-section behavior.
		legendCandidate: true,
		legendOrder: 4.2,
		shelfOrder: 11,
	},
	pattern: {
		id: "pattern",
		label: "Pattern",
		accepts: DISCRETE_LIKE,
		legendCandidate: true,
		legendOrder: 2,
		shelfOrder: 12,
	},
	text: {
		id: "text",
		label: "Text",
		accepts: ALL,
		legendCandidate: false,
		shelfOrder: 13,
	},
}

/** Ordered list of channel ids, sorted by shelfOrder. Replaces the
 * hand-maintained ALL_ENCODING_CHANNELS array. */
export const ALL_ENCODING_CHANNELS: readonly EncodingChannel[] = [
	...(Object.values(CHANNELS) as ChannelDef[]),
]
	.sort((a, b) => a.shelfOrder - b.shelfOrder)
	.map((c) => c.id)

/** Channels that should appear as sections in the Legend, sorted by
 * legendOrder. */
export const LEGEND_CANDIDATE_CHANNELS: readonly EncodingChannel[] = (
	Object.values(CHANNELS) as ChannelDef[]
)
	.filter((c) => c.legendCandidate)
	.sort((a, b) => (a.legendOrder ?? 999) - (b.legendOrder ?? 999))
	.map((c) => c.id)

/** Per-channel accepted field types. Convenience lookup. */
export const channelAccepts = (
	channel: EncodingChannel,
	type: FieldType
): boolean => CHANNELS[channel].accepts.includes(type)

/** Symmetric conflict check. A conflict exists when EITHER channel lists the
 * other in its `conflictsWith` array. This tolerates either-directional
 * declarations in CHANNELS. */
export const channelsConflict = (
	a: EncodingChannel,
	b: EncodingChannel
): boolean => {
	const aConf = CHANNELS[a].conflictsWith ?? []
	const bConf = CHANNELS[b].conflictsWith ?? []
	return aConf.includes(b) || bConf.includes(a)
}

/** For a given channel, all OTHER channels that conflict with it (computed
 * symmetrically). Useful for building the mutual-exclusion confirmation
 * dialog. */
export const conflictsFor = (
	channel: EncodingChannel
): readonly EncodingChannel[] =>
	(Object.values(CHANNELS) as ChannelDef[])
		.filter((c) => c.id !== channel && channelsConflict(channel, c.id))
		.map((c) => c.id)
