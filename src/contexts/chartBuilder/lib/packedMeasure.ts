// Packed-circles derived channel sources — the circle-packing sibling of
// `histogramMeasure.ts`. In packed mode the hierarchy yields two values no
// dataset column carries (and that a denormalized Root / Depth column could
// silently contradict): each node's OUTERMOST ancestor group and its
// nesting depth. The Fill color menu offers "Top-level group"
// (`measureSource: "rootGroup"`) and the Saturation / Brightness / Opacity
// menus offer "Depth" (`measureSource: "depth"`).

import { buildHierarchyFromEdges } from "./buildHierarchy"
import type { Encoding, EncodingChannel } from "./types"

export type PackedDerivedSource = "rootGroup" | "depth"

/** The chart modes that render the shared hierarchy encoding signature
 * (see chartModes/hierarchySignature.ts). Everything mode-gated for
 * packed circles — the Hierarchy section, derived channel options, the
 * proportional size legend — applies to all three. */
export const HIERARCHY_MODE_IDS = [
	"packed-circles",
	"treemap",
	"sunburst",
] as const

export const isHierarchyModeId = (id: string): boolean =>
	(HIERARCHY_MODE_IDS as readonly string[]).includes(id)

/** The chart modes that render the flow reading of the same signature —
 * directed edges (connection = source, `flowTargetField` = target) instead
 * of a tree. Derived channel sources (rootGroup / depth) stay tree-only. */
export const FLOW_MODE_IDS = ["chord", "sankey"] as const

export const isFlowModeId = (id: string): boolean =>
	(FLOW_MODE_IDS as readonly string[]).includes(id)

/** Trees + flows: every mode where `connection` is a structural KEY (which
 * node a row attaches to) rather than a drawn line — the gate the
 * Connection panel uses to swap line styling for the Structure section. */
export const isStructureModeId = (id: string): boolean =>
	isHierarchyModeId(id) || isFlowModeId(id)

/** Reserved `<select>` option values for the packed-circles derived
 * choices. Prefixed so they can't collide with a dataset column name —
 * onChange handlers compare against these BEFORE treating the value as a
 * field name (mirrors `MEASURE_OPTION_VALUE` in histogramMeasure.ts). */
export const PACKED_MEASURE_OPTION_VALUE: Record<PackedDerivedSource, string> =
	{
		rootGroup: "__pack_measure__rootGroup",
		depth: "__pack_measure__depth",
	}

export const PACKED_DERIVED_LABELS: Record<PackedDerivedSource, string> = {
	rootGroup: "Top-level group",
	depth: "Nesting depth",
}

/** The channels whose dropdowns offer the derived variables. Both sources
 * fit all five: "Top-level group" is categorical (hue palette; per-group
 * opacity overrides; sat/bri spread groups evenly across their min→max;
 * pattern glyphs auto-cycle per group), "Nesting depth" is ordinal
 * (discrete levels — per-level colors / ranges / glyphs). */
export const PACKED_DERIVED_CHANNELS = [
	"hue",
	"opacity",
	"saturation",
	"brightness",
	"pattern",
] as const

/** The channel's active packed-derived source, or null. Reads the shared
 * `measureSource` slot but only the packed values — histogram sources
 * (count/density) pass through as null here. */
export const packedSourceOf = (
	encoding: Encoding | undefined
): PackedDerivedSource | null =>
	encoding?.measureSource === "rootGroup" ||
	encoding?.measureSource === "depth"
		? encoding.measureSource
		: null

/** Derived options a channel's dropdown should offer. Empty outside packed
 * mode or without a mapped connection — no groups means nothing to derive
 * (a flat pack is uniformly depth 1). One list shared by the encoding
 * shelf and the option panels' "Vary by" selects so they can't drift. */
export const packedDerivedOptions = (
	channel: EncodingChannel,
	isPackedMode: boolean,
	connectionMapped: boolean
): Array<{ value: string; label: string; source: PackedDerivedSource }> => {
	if (!isPackedMode || !connectionMapped) return []
	if (!(PACKED_DERIVED_CHANNELS as readonly string[]).includes(channel))
		return []
	return (["rootGroup", "depth"] as const).map((source) => ({
		value: PACKED_MEASURE_OPTION_VALUE[source],
		label: PACKED_DERIVED_LABELS[source],
		source,
	}))
}

/** Reverse lookup: the derived source for a reserved option value, or null
 * when the value is a plain field name / empty. */
export const packedSourceForOptionValue = (
	value: string
): PackedDerivedSource | null =>
	value === PACKED_MEASURE_OPTION_VALUE.rootGroup
		? "rootGroup"
		: value === PACKED_MEASURE_OPTION_VALUE.depth
			? "depth"
			: null

/** The top-level group names — the domain of the "Top-level group" color
 * scale, in tree order. Used by the sidebar's per-group override swatches;
 * the renderer derives the same names from the packed layout's depth-1
 * nodes. Anonymous root-level leaves (blank parent) have no name and take
 * the default fill instead of a palette slot. */
export const topLevelGroupNames = (
	rows: ReadonlyArray<Record<string, unknown>>,
	parentField: string,
	idField: string | null,
	valueField: string | null,
): string[] =>
	buildHierarchyFromEdges(rows, { parentField, idField, valueField })
		.root.children.map((n) => n.label)
		.filter((l) => l !== "")

/** The depth levels present in the tree, as ordered strings ("1" =
 * top-level … maxDepth). The domain of the "Nesting depth" variable —
 * depth is ORDINAL (discrete, ordered levels), so it colors through the
 * ordinal palettes rather than a gradient, and the sidebar shows one
 * override swatch per level keyed by these strings. */
export const hierarchyDepthLevels = (
	rows: ReadonlyArray<Record<string, unknown>>,
	parentField: string,
	idField: string | null,
	valueField: string | null,
): string[] => {
	const { root } = buildHierarchyFromEdges(rows, {
		parentField,
		idField,
		valueField,
	})
	let max = 0
	const walk = (node: typeof root, depth: number): void => {
		if (depth > max) max = depth
		for (const child of node.children) walk(child, depth + 1)
	}
	walk(root, 0)
	return Array.from({ length: max }, (_, i) => String(i + 1))
}
