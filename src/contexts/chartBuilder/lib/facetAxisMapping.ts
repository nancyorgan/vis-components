import type { ChartModeDef } from "./chartModes/types"
import type { EncodingChannel } from "./types"

/** What the "row-axis" and "col-axis" controls in the facet options
 *  panels mean for a given chart mode. The row panel surfaces share /
 *  size / range controls for the channel mapped to the chart's vertical
 *  axis; the col panel surfaces the same for the horizontal axis.
 *
 *  Cartesian charts (scatter, bars, areas, tile, hexbin) have x and y as
 *  the natural axes. Radar charts use angle (around the circle) and r
 *  (radial distance) — there's no horizontal/vertical, but we map
 *  r→row (it's the dimension you'd typically share or scale by) and
 *  angle→col. Pie charts have only angle; the row panel has no
 *  axis-specific controls to show. Modes that draw no axis at all (geo,
 *  the structure layouts) get neither — their panels have nothing to
 *  share or range, only a size. */
export type FacetAxisMapping = {
	/** Channel that the Facet panel's Rows axis controls target.
	 *  null means the row panel has no axis to control (pie). */
	rowAxis: EncodingChannel | null
	/** Channel that the Facet panel's Columns axis controls target.
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
	colAxisLabel: "Angle axis",
	showPanelSize: false,
}

const PIE_MAPPING: FacetAxisMapping = {
	rowAxis: null,
	colAxis: "angle",
	rowAxisLabel: "",
	colAxisLabel: "Angle axis",
	showPanelSize: false,
}

const CARTESIAN_MAPPING: FacetAxisMapping = {
	rowAxis: "y",
	colAxis: "x",
	rowAxisLabel: "Y axis",
	colAxisLabel: "X axis",
	showPanelSize: true,
}

/** Axis-less panels (geo, packed circles / treemap / sunburst / chord /
 *  sankey): nothing to share or range, but width / height still apply. */
const AXISLESS_MAPPING: FacetAxisMapping = {
	rowAxis: null,
	colAxis: null,
	rowAxisLabel: "",
	colAxisLabel: "",
	showPanelSize: true,
}

/** Trait-driven: polar modes split on whether they have an R axis
 *  (`polarUnit`), everything else on whether it draws cartesian axes. */
export const facetAxisMapping = (
	mode: Pick<ChartModeDef, "canvas">,
): FacetAxisMapping => {
	const { coordFamily, polarUnit, cartesianAxes } = mode.canvas
	if (coordFamily === "polar")
		return polarUnit === "rAxisMax" ? RADAR_MAPPING : PIE_MAPPING
	if (!cartesianAxes.x && !cartesianAxes.y) return AXISLESS_MAPPING
	return CARTESIAN_MAPPING
}
