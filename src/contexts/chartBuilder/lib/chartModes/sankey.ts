import { detectHierarchySignature, resolveHierarchyLayout } from "./hierarchySignature"
import type { ChartModeDef } from "./types"

/** Sankey: the shared no-positions signature (`area` + connection — see
 *  hierarchySignature.ts) read as a directed FLOW graph rather than a
 *  tree: each row is an edge connection → `flowTargetField`, link
 *  thickness ∝ `area`, with links flowing left → right through d3-sankey
 *  columns. Selected via the Structure section's Layout picker like
 *  treemap / sunburst. d3-sankey requires an acyclic graph, so the
 *  renderer breaks cycles first: self-loops and greedily-chosen
 *  back-edges drop, with an in-plot notice counting the hidden flows.
 *  Canvas traits are plainly cartesian — the layout IS rectangular
 *  columns and links, nothing polar — with no measure axis: link widths
 *  come from the flow values, not an axis scale. */
export const SankeyMode: ChartModeDef = {
	id: "sankey",
	detect: (encodings, _getType, channelConfigs, mapConfig) =>
		detectHierarchySignature(encodings, mapConfig) &&
		resolveHierarchyLayout(channelConfigs) === "sankey",
	legend: {
		hideLengthInThisMode: false,
		hideAngleInThisMode: false,
		hideConnectionInThisMode: true,
		// Link thickness IS the size encoding — the diagram reads it
		// directly, so the Size legend starts off (re-enable via the toggle).
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
		coordFamily: "cartesian",
		measureAxis: null,
	},
}
