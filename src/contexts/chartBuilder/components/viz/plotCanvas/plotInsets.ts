import type { FacetLayoutSpec } from "../../../lib/facetLayoutSolver"
import type { PlotInsets } from "../../../lib/plotLayout"

/** Where a solved layout's plot sits in its canvas: the distance from each
 *  canvas edge to the union of every panel's plot rect (a faceted grid is
 *  one plot here). Whole pixels. `null` for a layout with no panels.
 *
 *  This is what the legend aligns to. It used to assume the base margins
 *  plus its own copy of the title-band rule, which holds only until the
 *  solver grows a margin — long tick labels, a nudged title, a facet strip
 *  — and then the legend sat beside where the plot used to be. */
export const plotInsetsOf = (spec: FacetLayoutSpec): PlotInsets | null => {
	if (spec.panels.length === 0) return null
	let left = Infinity
	let top = Infinity
	let right = -Infinity
	let bottom = -Infinity
	for (const { inner } of spec.panels) {
		left = Math.min(left, inner.x)
		top = Math.min(top, inner.y)
		right = Math.max(right, inner.x + inner.width)
		bottom = Math.max(bottom, inner.y + inner.height)
	}
	return {
		top: Math.round(top),
		left: Math.round(left),
		right: Math.round(spec.canvas.width - right),
		bottom: Math.round(spec.canvas.height - bottom),
	}
}
