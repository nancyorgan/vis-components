/** Resolves what an axis title should display, applying the three-way
 *  precedence shared by every chart renderer:
 *
 *    1. SUPPRESSED — the parent (PlotCanvas in faceted mode) has set
 *       `showXAxisTitle: false` / `showYAxisTitle: false` because a
 *       single shared title is drawn outside the panel grid. Returns
 *       empty so the margin estimate doesn't reserve space for a title
 *       that never renders.
 *
 *    2. EXPLICIT — the user set `labels.xAxisTitle` (or `yAxisTitle`)
 *       in the labels panel. Their text wins.
 *
 *    3. FALLBACK — the field name (or, for bars/areas, the aggregation
 *       orientation's measure-or-category field). Calculated by the
 *       caller and passed in.
 *
 *  Returns a string suitable both for rendering the title `<text>` and
 *  for feeding `estimateExtraBottomMargin` / `estimateExtraLeftMargin`,
 *  so both stay in lockstep — diverging them was a frequent class of
 *  bug pre-extraction. */
export const resolveAxisTitleText = ({
	suppressed,
	explicitTitle,
	fallback,
}: {
	/** True when the renderer should not draw the title at all.
	 *  Typically `props.showXAxisTitle === false`. */
	suppressed: boolean
	/** User-provided title text from the labels panel. Empty string or
	 *  falsy values fall through to `fallback`. */
	explicitTitle: string | null | undefined
	/** Derived default (field name, measure field, etc.). The caller
	 *  resolves this because it depends on chart-type-specific shape
	 *  (e.g., BarPlot picks based on aggregation orientation). */
	fallback: string
}): string => {
	if (suppressed) return ""
	if (explicitTitle) return explicitTitle
	return fallback
}
