import { detectHierarchySignature, resolveHierarchyLayout } from "./hierarchySignature"
import type { ChartModeDef } from "./types"

/** Sunburst: the hierarchy encoding signature (`area` + optional
 *  `connection`, no positions — see hierarchySignature.ts) rendered as
 *  concentric arc rings (d3 partition), selected via the Hierarchy
 *  section's Layout picker (`connection.hierarchyLayout`). Same tree,
 *  same derived channel sources, same styling chain as packed circles /
 *  treemap.
 *
 *  Canvas traits are CARTESIAN, not polar, even though the marks are
 *  arcs: the renderer owns its own polar geometry (like the radar/pie
 *  renderers own theirs) but has no r/angle encodings, no R-axis, and
 *  no meaningful `polarUnit` for size-panels-by-unit — declaring polar
 *  would engage plumbing this mode can't honor. */
export const SunburstMode: ChartModeDef = {
	id: "sunburst",
	detect: (encodings, _getType, channelConfigs, mapConfig) =>
		detectHierarchySignature(encodings, mapConfig) &&
		resolveHierarchyLayout(channelConfigs) === "sunburst",
	legend: {
		hideLengthInThisMode: false,
		hideAngleInThisMode: false,
		hideConnectionInThisMode: true,
		// Arc sweep IS the size encoding — the layout reads it directly, so
		// the Size legend starts off (re-enable via the toggle).
		areaHiddenByDefault: true,
		reverseCategoricalOrder: false,
	},
	facet: {
		supportsSharedMeasureMax: false,
	},
	canvas: {
		coordFamily: "cartesian",
		measureAxis: null,
	},
}
