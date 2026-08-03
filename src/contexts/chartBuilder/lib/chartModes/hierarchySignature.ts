import type { ChannelConfigs } from "../channelConfig"
import type { MapConfig } from "../mapConfig"
import type { Encodings } from "../types"

/** The one encoding signature ALL FIVE hierarchy/flow layouts share:
 *  `area` is the only positional-ish channel mapped — no x/y/r/angle/
 *  length — and the chart isn't geographic (`connection + area` under
 *  geographic coords is the bubble map). Which layout renders it — three
 *  trees (packed circles / treemap / sunburst) or two flows (chord /
 *  sankey) — is config, not encodings: all five are visually different
 *  arrangements of the SAME mapping, so `connection.hierarchyLayout`
 *  gates the mode the way the histogram toggle gates bars. */
export const detectHierarchySignature = (
	encodings: Encodings,
	mapConfig?: MapConfig
): boolean => {
	if (mapConfig?.coordSystem === "geographic") return false
	return (
		!!encodings.area?.field &&
		!encodings.x?.field &&
		!encodings.y?.field &&
		!encodings.r?.field &&
		!encodings.angle?.field &&
		!encodings.length?.field
	)
}

/** The active hierarchy layout from config. Absent = packed circles
 *  (the original mode — saved visuals predating treemap/sunburst keep
 *  rendering unchanged). Callers that omit channelConfigs resolve to
 *  "pack" too, the safe default. */
export const resolveHierarchyLayout = (
	channelConfigs?: ChannelConfigs
): "pack" | "treemap" | "sunburst" | "chord" | "sankey" =>
	channelConfigs?.connection?.hierarchyLayout ?? "pack"
