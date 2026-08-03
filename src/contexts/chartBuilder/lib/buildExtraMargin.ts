import type { ExtraMargin } from "./plotLayout"

/** Combines the three contributions every chart renderer makes to its
 *  `extraMargin` prop into a single shape, taking the `Math.max` of the
 *  per-side candidates so the chart reserves enough room for the most
 *  demanding source.
 *
 *  The three contributions are:
 *   - **own estimate** — produced by `estimateExtraLeftMargin` /
 *     `estimateExtraBottomMargin`, accounting for the chart's own tick
 *     labels and axis title.
 *   - **floor from parent** — `extraMarginFloorLeft` /
 *     `extraMarginFloorBottom`. PlotCanvas sets these so all panels
 *     in a column/row land at the same axis edge, even when each
 *     panel's own estimate is smaller.
 *   - **data-label margins** — produced by `estimateDataLabelMargins`,
 *     reserving space for `<text>` labels that nudge outside the plot
 *     area (xOffset / yOffset overrides).
 *
 *  Top/right are simpler — they only have a data-label contribution
 *  (axis titles never live there). They're still threaded through here
 *  so every renderer emits the same shape.
 *
 *  Centralizing this prevents the silent contract drift the pre-extract
 *  code had — three renderers (ScatterPlot/BarPlot/AreaPlot) each had
 *  their own slightly-different `extraMargin: {...}` block, and one
 *  could quietly start ignoring (e.g.) the dataLabel contribution
 *  without anyone noticing. */
export const buildExtraMargin = ({
	estimate,
	floor,
	dataLabel,
}: {
	/** Per-side margin needed for the chart's own axis content. */
	estimate: { left: number; bottom: number }
	/** Per-side floor enforced by the parent layout (PlotCanvas). */
	floor: { left?: number; bottom?: number }
	/** Per-side margin needed to fit data labels that overflow the
	 *  plot area. */
	dataLabel: { top: number; right: number; bottom: number; left: number }
}): ExtraMargin => ({
	left: Math.max(estimate.left, floor.left ?? 0, dataLabel.left),
	right: dataLabel.right,
	top: dataLabel.top,
	bottom: Math.max(estimate.bottom, floor.bottom ?? 0, dataLabel.bottom),
})
