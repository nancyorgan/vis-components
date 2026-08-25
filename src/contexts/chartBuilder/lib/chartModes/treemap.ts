import { detectHierarchySignature, resolveHierarchyLayout } from "./hierarchySignature"
import type { ChartModeDef } from "./types"

/** Treemap: the hierarchy encoding signature (`area` + optional
 *  `connection`, no positions — see hierarchySignature.ts) rendered as
 *  nested rectangles instead of packed circles, selected via the
 *  Hierarchy section's Layout picker (`connection.hierarchyLayout`).
 *  Same tree, same derived channel sources, same styling chain — only
 *  the d3 layout call and mark shape differ. */
export const TreemapMode: ChartModeDef = {
	id: "treemap",
	detect: (encodings, _getType, channelConfigs, mapConfig) =>
		detectHierarchySignature(encodings, mapConfig) &&
		resolveHierarchyLayout(channelConfigs) === "treemap",
	legend: {
		hideLengthInThisMode: false,
		hideAngleInThisMode: false,
		// `connection` is the hierarchy key, not a visual series — same
		// reasoning as packed circles / the choropleth region key.
		hideConnectionInThisMode: true,
		// Tile area IS the size encoding — the layout reads it directly, so
		// the Size legend starts off (re-enable via the toggle).
		areaHiddenByDefault: true,
		reverseCategoricalOrder: false,
	},
	facet: {
		supportsSharedMeasureMax: false,
	},
	annotations: {
		xValueChannel: "x",
		yValueChannel: "y",
		polarValueCoords: false,
	},
	canvas: {
		// Axis-less cartesian panel (like packed circles / tile): the
		// renderer passes null position scales so no axes draw.
		coordFamily: "cartesian",
		measureAxis: null,
	},
}
