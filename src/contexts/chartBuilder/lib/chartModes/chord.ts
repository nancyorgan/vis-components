import { detectHierarchySignature, resolveHierarchyLayout } from "./hierarchySignature"
import type { ChartModeDef } from "./types"

/** Chord: the shared no-positions signature (`area` + connection — see
 *  hierarchySignature.ts) read as a directed FLOW graph rather than a
 *  tree: each row is an edge connection → `flowTargetField`, ribbon
 *  thickness ∝ `area`. Selected via the Structure section's Layout picker
 *  like treemap / sunburst. Cartesian canvas traits for the same reason
 *  as sunburst: the renderer owns its own polar geometry but has no
 *  r/angle encodings and no meaningful `polarUnit`. */
export const ChordMode: ChartModeDef = {
	id: "chord",
	detect: (encodings, _getType, channelConfigs, mapConfig) =>
		detectHierarchySignature(encodings, mapConfig) &&
		resolveHierarchyLayout(channelConfigs) === "chord",
	legend: {
		hideLengthInThisMode: false,
		hideAngleInThisMode: false,
		hideConnectionInThisMode: true,
		// Ribbon thickness IS the size encoding here — the diagram reads it
		// directly, so the Size legend starts off (re-enable via the toggle).
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
