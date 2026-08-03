import type { EncodingChannel } from "./types"

/** What the "row-axis" and "col-axis" controls in the facet options
 *  panels mean for a given chart mode. The row panel surfaces share /
 *  size / range controls for the channel mapped to the chart's vertical
 *  axis; the col panel surfaces the same for the horizontal axis.
 *
 *  Cartesian charts (scatter, bars, areas, tile) have x and y as the
 *  natural axes. Radar charts use angle (around the circle) and r
 *  (radial distance) — there's no horizontal/vertical, but we map
 *  r→row (it's the dimension you'd typically share or scale by) and
 *  angle→col. Pie charts have only angle; the row panel has no
 *  axis-specific controls to show. */
export type FacetAxisMapping = {
	/** Channel that the Facet (row) panel's axis controls target.
	 *  null means the row panel has no axis to control (pie). */
	rowAxis: EncodingChannel | null
	/** Channel that the Facet (col) panel's axis controls target.
	 *  null means the col panel has no axis to control. */
	colAxis: EncodingChannel | null
	/** User-facing axis label for the row panel (e.g. "Y axis", "R axis"). */
	rowAxisLabel: string
	/** User-facing axis label for the col panel. */
	colAxisLabel: string
	/** Whether the panel-size (width/height) inputs apply to this mode.
	 *  Radar / pie charts render as a single circle per panel — there's
	 *  no separate width vs height to set. Cartesian charts have
	 *  independent dimensions. */
	showPanelSize: boolean
}

const RADAR_MAPPING: FacetAxisMapping = {
	rowAxis: "r",
	colAxis: "angle",
	rowAxisLabel: "R axis",
	colAxisLabel: "angle axis",
	showPanelSize: false,
}

const PIE_MAPPING: FacetAxisMapping = {
	rowAxis: null,
	colAxis: "angle",
	rowAxisLabel: "",
	colAxisLabel: "angle axis",
	showPanelSize: false,
}

const CARTESIAN_MAPPING: FacetAxisMapping = {
	rowAxis: "y",
	colAxis: "x",
	rowAxisLabel: "Y axis",
	colAxisLabel: "X axis",
	showPanelSize: true,
}

export const facetAxisMapping = (modeId: string): FacetAxisMapping => {
	if (modeId === "radar") return RADAR_MAPPING
	if (modeId === "pies" || modeId === "pies-x" || modeId === "pies-y")
		return PIE_MAPPING
	return CARTESIAN_MAPPING
}
