import { detectHierarchySignature, resolveHierarchyLayout } from "./hierarchySignature"
import type { ChartModeDef } from "./types"

/** Packed circles: `area` is the only mapped channel with any positional
 *  meaning — no x/y/r/angle/length — so the circles have nowhere to be but
 *  packed. Each row is a circle sized by its `area` value; mapping
 *  `connection` nests the circles one level under their connection value
 *  (and, with an id field configured on the connection channel, recursively
 *  — see `lib/buildHierarchy.ts`).
 *
 *  The DEFAULT hierarchy layout: treemap / sunburst / chord / sankey share
 *  this encoding signature and win only when the Structure section's Layout
 *  picker says so (`connection.hierarchyLayout` — see hierarchySignature.ts).
 *
 *  Registered after the geo modes: `connection + area` with no x/y under
 *  geographic coords is the bubble map (GeoSymbolsMode gates on mapConfig),
 *  so the signature explicitly stands down when the chart is geographic. */
export const PackedCirclesMode: ChartModeDef = {
	id: "packed-circles",
	detect: (encodings, _getType, channelConfigs, mapConfig) =>
		detectHierarchySignature(encodings, mapConfig) &&
		resolveHierarchyLayout(channelConfigs) === "pack",
	legend: {
		hideLengthInThisMode: false,
		hideAngleInThisMode: false,
		// `connection` is the hierarchy key (which container each row nests
		// in), not a visual series — same reasoning as the choropleth's
		// region key. The group circles themselves are the "legend".
		hideConnectionInThisMode: true,
		// Circle area IS the size encoding — the layout reads it directly, so
		// the Size legend starts off (re-enable via the toggle).
		areaHiddenByDefault: true,
		reverseCategoricalOrder: false,
	},
	facet: {
		supportsSharedMeasureMax: false,
	},
	canvas: {
		// Axis-less cartesian panel (like tile): the renderer passes null
		// position scales so no axes draw; the pack layout fills the inner
		// rect. Not "polar" — that would demand a polarUnit for the
		// size-panels-by-unit machinery this mode doesn't participate in.
		coordFamily: "cartesian",
		measureAxis: null,
	},
}
