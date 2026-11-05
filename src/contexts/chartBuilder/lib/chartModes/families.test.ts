import { describe, expect, it } from "vitest"

// Import `../chartMode` first to prime the module graph in the order that
// avoids a circular-init between types.ts, channels.ts, and atoms.ts (same
// as registry.test.ts).
import "../chartMode"
import type { ChartMode } from "../chartMode"
import {
	isAreaModeId,
	isBarModeId,
	isFlowModeId,
	isHierarchyModeId,
	isPieModeId,
	isStructureModeId,
} from "./families"
import { MODE_REGISTRY } from "./index"
import type { ChartModeDef } from "./types"

const ALL_IDS = MODE_REGISTRY.map((m) => m.id as ChartMode)

/** The ids a predicate selects, in registry order. */
const selected = (pred: (m: ChartModeDef) => boolean): ChartMode[] =>
	MODE_REGISTRY.filter(pred).map((m) => m.id as ChartMode)

/** Same, for an id-level family predicate. */
const selectedIds = (pred: (id: string) => boolean): ChartMode[] =>
	ALL_IDS.filter(pred)

describe("mode families", () => {
	it("covers every registered mode exactly once in the expected family", () => {
		// Added 2026-10-26: the bar + marks combos are bar charts with a
		// scatter marks layer on top (same aggregation, gap, stack modes).
		expect(selectedIds(isBarModeId)).toEqual([
			"bars-x",
			"bars-y",
			"combo-x",
			"combo-y",
		])
		expect(selectedIds(isAreaModeId)).toEqual(["areas-x", "areas-y"])
		expect(selectedIds(isPieModeId)).toEqual(["pies", "pies-x", "pies-y"])
		expect(selectedIds(isHierarchyModeId)).toEqual([
			"treemap",
			"sunburst",
			"packed-circles",
		])
		expect(selectedIds(isFlowModeId)).toEqual(["chord", "sankey"])
		expect(selectedIds(isStructureModeId)).toEqual([
			"treemap",
			"sunburst",
			"chord",
			"sankey",
			"packed-circles",
		])
	})

	it("families agree with the traits that describe the same lineage", () => {
		for (const mode of MODE_REGISTRY) {
			// Bars / areas are the measure-axis modes; areas are the layer
			// connection role; hierarchy + flow are the structural-key,
			// layout-sized modes.
			expect(
				isBarModeId(mode.id) || isAreaModeId(mode.id),
				mode.id,
			).toBe(mode.canvas.measureAxis !== null)
			expect(isAreaModeId(mode.id), mode.id).toBe(
				mode.canvas.connectionRole === "layer",
			)
			expect(isPieModeId(mode.id), mode.id).toBe(
				mode.canvas.polarUnit === "angleSum",
			)
		}
	})
})

/** Every sidebar gate converted from a mode-id comparison to a trait /
 * family predicate, with the id list the comparison used to spell out.
 * The table proves each predicate selects EXACTLY those modes across the
 * whole registry — behavior is unchanged for every current mode — and
 * documents, for a new mode, which traits each gate reads. */
const CONVERTED_GATES: {
	gate: string
	was: ChartMode[]
	now: (m: ChartModeDef) => boolean
}[] = [
	{
		gate: "Shape panel: Default-shape glyph picker hidden (glyphs inert)",
		was: ["bars-x", "bars-y", "tile", "hexbin"],
		now: (m) => m.canvas.shapeRole === "cell",
	},
	{
		gate: "Shape panel: violin / box outline width; Pattern panel: regression dash; usePureDensityCurve",
		was: ["scatter"],
		now: (m) => m.canvas.statOverlays,
	},
	{
		gate: 'Tooltip panel: line chart "Only at points"; Connection panel: scatter-only sections',
		// Added 2026-10-26: the combos' marks layer joins into lines like scatter.
		was: ["combo-x", "combo-y", "scatter"],
		now: (m) => m.canvas.connectionRole === "line",
	},
	{
		gate: "Connection / Color / Pattern panels: radar polygon",
		was: ["radar"],
		now: (m) => m.canvas.connectionRole === "polygon",
	},
	{
		gate: "Connection panel: draws connection lines (scatter | areas | radar)",
		was: ["areas-x", "areas-y", "radar", "combo-x", "combo-y", "scatter"],
		now: (m) =>
			m.canvas.connectionRole === "line" ||
			m.canvas.connectionRole === "layer" ||
			m.canvas.connectionRole === "polygon",
	},
	{
		gate: "Connection panel: line-or-area (scatter | areas)",
		was: ["areas-x", "areas-y", "combo-x", "combo-y", "scatter"],
		now: (m) =>
			m.canvas.connectionRole === "line" || isAreaModeId(m.id),
	},
	{
		gate: "Color panel: linked outline, independent outline hidden (areas | radar)",
		was: ["areas-x", "areas-y", "radar"],
		now: (m) => isAreaModeId(m.id) || m.canvas.connectionRole === "polygon",
	},
	{
		gate: 'Connection panel: chord ring "Show axis"',
		was: ["chord"],
		now: (m) => m.canvas.flowGeometry === "ring",
	},
	{
		gate: "Angle panel: radar Spokes / Spoke labels + dial wording",
		was: ["radar"],
		now: (m) => m.canvas.polarAxes?.angle === true,
	},
	{
		gate: 'Maps section: "Fill regions with no data" toggle + matched-region auto-fit',
		was: ["geo-choropleth"],
		now: (m) => m.canvas.geo?.marks === "regions",
	},
	{
		gate: 'Maps section: "Show basemap" toggle',
		was: ["geo-points", "geo-symbols"],
		now: (m) => m.canvas.geo?.marks === "symbols",
	},
	{
		gate: "Maps section: X = longitude / Y = latitude hint",
		was: ["geo-points"],
		now: (m) => m.canvas.geo?.position === "lonLat",
	},
	{
		gate: "Area panel: Scale-by only (layout-computed radii)",
		was: ["packed-circles"],
		now: (m) => m.canvas.areaRole === "layoutRadius",
	},
	{
		gate: "Area panel: proportional-size note",
		was: ["treemap", "sunburst", "chord", "sankey"],
		now: (m) => m.canvas.areaRole === "proportional",
	},
	{
		gate: "Data labels: position rows locked to the chart's x / y (tile)",
		was: ["tile"],
		now: (m) => m.labels.positionLockedToAxes,
	},
	{
		gate: "Data labels: ring placement (sunburst Angle + ring-relative R)",
		was: ["sunburst"],
		now: (m) => m.labels.placement === "ring",
	},
	{
		gate: "Data labels: fine-tuning stands down (layout draws its own labels)",
		// Packed circles moved onto the shared label layer 2026-11-05.
		was: ["treemap"],
		now: (m) => m.labels.placement === "layout",
	},
	{
		gate: 'Data labels: no per-series endpoints ("Which labels" hidden)',
		was: [
			"geo-points",
			"geo-symbols",
			"geo-choropleth",
			"sunburst",
			// Added 2026-10-19: flows label nodes by flow direction instead.
			"chord",
			"sankey",
			// Added 2026-11-05: packed labels now reach the label panel's
			// selection block, and a pack has no series ends.
			"packed-circles",
		],
		now: (m) => !m.labels.seriesEndpoints,
	},
	{
		gate: 'Data labels: packed-circles "Text position" subsection',
		was: ["packed-circles"],
		now: (m) => m.labels.containerRimLabels,
	},
	{
		gate: "Data labels: vertical bars (Placement wording, side locks alignment)",
		was: ["bars-x", "combo-x"],
		now: (m) => isBarModeId(m.id) && m.canvas.measureAxis === "y",
	},
	{
		gate: 'Data labels: pies along a band ("Of each" scope = Pie)',
		was: ["pies-x", "pies-y"],
		now: (m) =>
			isPieModeId(m.id) && (m.canvas.cartesianAxes.x || m.canvas.cartesianAxes.y),
	},
]

describe("sidebar gates converted from mode ids to traits", () => {
	it.each(CONVERTED_GATES)("$gate", ({ was, now }) => {
		// Registry order on both sides so the diff reads as a plain list.
		const expected = ALL_IDS.filter((id) => was.includes(id))
		expect(expected, "every listed id is a registered mode").toHaveLength(
			was.length,
		)
		expect(selected(now)).toEqual(expected)
	})
})
