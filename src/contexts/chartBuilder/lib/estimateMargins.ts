/** Heuristics that grow plot margins to fit long axis labels and titles.
 *
 * The ideal solution measures DOM text via `getBBox` after rendering and
 * re-lays out, but that's a 2-pass dance with hydration / SSR pitfalls. The
 * pragmatic alternative — used here — estimates pixel widths from the
 * character count + font size with a per-family multiplier. Sans-serif at
 * `fontSize` averages ~0.55px per character; throwing in a small base of
 * 4px for letter spacing gives results within ±10% for most strings.
 *
 * That accuracy is more than enough to solve the user-visible problem
 * ("long y-axis labels get cut off"). When the estimate is slightly off,
 * the chart simply has a bit more or less padding than strictly needed —
 * never a hard cutoff. */

/** Character-width heuristics come in two tiers, and the difference is
 *  deliberate — do not collapse them into one number.
 *
 *  `charWidthFactor` (0.55) is the CENTERED estimate: the average px-per-char
 *  for a generic sans-serif. Use it where being wrong in either direction is
 *  cheap and symmetric — reserving margin space, wrapping, ellipsis
 *  truncation, auto label angles. Overshoot means slightly extra padding;
 *  undershoot means slightly less.
 *
 *  `charWidthConservativeFactor` (0.6) is a DELIBERATE OVERESTIMATE, for
 *  fit / overlap GATING where the two error directions are not symmetric —
 *  data-label overlap nudging (`lib/dataLabelsLayout`) and hierarchy label
 *  fit checks (`components/viz/useHierarchyScaffold`). There a false
 *  positive is harmless (labels get nudged apart, or a label that would
 *  just barely have fit is skipped) while a false negative is visible
 *  breakage (overlapping labels, text spilling out of its mark). */

/** Average px-per-char for a generic sans-serif at the given font size. */
export const charWidthFactor = 0.55

/** Intentionally-high px-per-char for fit / overlap gating. See the note
 *  above: this is NOT a better estimate than `charWidthFactor`, it is a
 *  safety margin. */
export const charWidthConservativeFactor = 0.6

/** Estimate the rendered pixel width of a text string at a given font size.
 *  Strings containing newlines are treated as a single line — callers that
 *  render multi-line text (via `renderMultilineTspans`) should use
 *  `estimateLongestLineWidth` instead, since the BOUNDING-BOX width of a
 *  multi-line block is the widest line, not the sum of all characters. */
export const estimateTextWidth = (text: string, fontSize: number): number =>
	text.length * fontSize * charWidthFactor + 4

/** Estimate the pixel width of the WIDEST line in a multi-line string.
 *  Use this when reserving horizontal margin for text that will be
 *  rendered as stacked `<tspan>` lines (`renderMultilineTspans`) — the
 *  bounding box is the widest line, not the joined string. */
export const estimateLongestLineWidth = (
	text: string,
	fontSize: number
): number => {
	if (!text) return 0
	const lines = text.split("\n")
	let max = 0
	for (const line of lines) {
		const w = estimateTextWidth(line, fontSize)
		if (w > max) max = w
	}
	return max
}

/** The single longest LINE across a set of (possibly multi-line) labels.
 *  Wrapped tick labels arrive here as `\n`-joined strings, and their
 *  rendered bounding box is the widest line — so margin math must pick
 *  the longest line, not the longest joined string. Plain single-line
 *  labels behave exactly as before. */
const longestLineIn = (labels: readonly string[]): string => {
	let longest = ""
	for (const label of labels) {
		for (const line of label.split("\n")) {
			if (line.length > longest.length) longest = line
		}
	}
	return longest
}

/** Max line count across a set of labels — 1 for plain labels; wrapped
 *  (`\n`-joined) labels contribute their stacked-line count, which the
 *  bottom-chrome math multiplies into the vertical reserve. */
const maxLineCountIn = (labels: readonly string[]): number => {
	let max = 1
	for (const label of labels) {
		const n = label.split("\n").length
		if (n > max) max = n
	}
	return max
}

/** Estimate the pixels of left margin needed so the longest y-axis label
 * (horizontal bars, scatter with categorical y, etc.) renders fully.
 *
 * The "default" left margin in `plotLayout.ts` is 76px — enough for short
 * numeric tick labels plus a vertical y-axis title. For long category
 * names ("Cardiothoracic Surgery", say) we need to add the extra width.
 *
 * Returns an *additive* delta in px — `0` means the default is already
 * sufficient. The caller adds this onto the base margin. */
export const estimateExtraLeftMargin = ({
	yLabels,
	yLabelFontSize,
	yLabelMaxWidthPx,
	yTitleRotated,
	yTitleText,
	yTitleFontSize,
	baseMarginPx = 76,
}: {
	/** Tick labels that will appear on the y-axis. */
	yLabels: readonly string[]
	yLabelFontSize: number
	/** Pre-measured (canvas.measureText) width of the widest label, when
	 *  available. The 0.55-char heuristic below underestimates real
	 *  rendered widths by 10-20% on common fonts, which manifested as
	 *  long y-labels clipping at the canvas left edge. Caller passes
	 *  this when they've measured. */
	yLabelMaxWidthPx?: number
	/** True when the y-axis title is drawn rotated (the default). False when
	 * the user has set "horizontal y-axis title". */
	yTitleRotated: boolean
	yTitleText: string
	yTitleFontSize: number
	/** The base left margin the solver ACTUALLY reserves before this floor is
	 *  added. Defaults to `BASE_MARGIN.left` (76) — the cartesian reserve.
	 *  Polar modes that still draw a cartesian axis (pies-y) collapse the
	 *  base to `POLAR_MARGIN.left` (8), so they must pass 8 here; otherwise
	 *  the returned floor (a delta above 76) under-reserves by 68px and the
	 *  y-tick labels clip. */
	baseMarginPx?: number
}): number => {
	if (yLabels.length === 0 && !yTitleText) return 0
	const labelPx =
		yLabelMaxWidthPx && yLabelMaxWidthPx > 0
			? yLabelMaxWidthPx
			: estimateTextWidth(longestLineIn(yLabels), yLabelFontSize)
	const titlePx = (() => {
		if (!yTitleText) return 0
		// Rotated y-title takes one line-height worth of horizontal width
		// (~fontSize). Horizontal y-title takes the WIDEST LINE's width
		// (not total string length — multi-line titles render as stacked
		// `<tspan>` rows whose bounding box equals the widest line).
		// Plus a small gap between the longest tick label and the title.
		if (yTitleRotated) return yTitleFontSize + 24
		return estimateLongestLineWidth(yTitleText, yTitleFontSize) + 16
	})()
	// For a HORIZONTAL y-title, Axes.tsx positions it at
	// `inner.x0 - dynamicGap`, where dynamicGap has a floor of
	// `40 + tickFontSize`. When `yLabels` is empty here (e.g. a
	// quantitative axis — ScatterPlot doesn't include numeric ticks
	// in this list because they're scale-generated later), our `labelPx`
	// is ~4 and we'd undercount the margin needed for the gap. Floor the
	// label-area allowance at that same value so quant-axis horizontal
	// titles don't overflow the SVG's left edge.
	const labelAreaAllowance = yTitleRotated
		? labelPx
		: Math.max(labelPx, 40 + yLabelFontSize)
	// Floor is a delta above whatever base the solver already reserves
	// (`baseMarginPx`). We shouldn't shrink — only grow.
	const needed = labelAreaAllowance + titlePx + 24 // breathing room
	return Math.max(0, needed - baseMarginPx)
}

/** Estimate the pixels of bottom margin needed so the longest x-axis label
 * renders fully. Rotated labels (config.tickLabelAngle ≠ 0) need vertical
 * room equal to (label-width × |sin(angle)|) + a tick + title slot. */
export const estimateExtraBottomMargin = ({
	xLabels,
	xLabelFontSize,
	xLabelAngleDeg,
	xLabelMaxWidthPx,
	xTitleText,
	xTitleFontSize,
	xTitleLineCount,
	baseMarginPx = 64,
}: {
	xLabels: readonly string[]
	xLabelFontSize: number
	xLabelAngleDeg: number
	/** Pre-measured width; preferred over the char-count estimate when
	 *  available. See `estimateExtraLeftMargin` for the rationale. */
	xLabelMaxWidthPx?: number
	xTitleText: string
	xTitleFontSize: number
	/** How many lines the x-axis title spans (0 = no title; 1 = one line; 2+
	 * for multi-line titles set via the line-break textarea). */
	xTitleLineCount: number
	/** The base bottom margin the solver ACTUALLY reserves before this floor
	 *  is added. Defaults to `BASE_MARGIN.bottom` (64). Polar modes that draw
	 *  a cartesian x-axis (pies-x) collapse the base to `POLAR_MARGIN.bottom`
	 *  (8), so they must pass 8 here or the x-tick labels clip. */
	baseMarginPx?: number
}): number => {
	if (xLabels.length === 0 && !xTitleText) return 0
	const labelW =
		xLabelMaxWidthPx && xLabelMaxWidthPx > 0
			? xLabelMaxWidthPx
			: estimateTextWidth(longestLineIn(xLabels), xLabelFontSize)
	// Vertical space the rotated label occupies. At 0°, the label is
	// horizontal — its on-screen height is the full line-box (font size
	// × 1.4 for ascender + descender + leading) times the line count
	// (wrapped labels stack). At 90° / -90° it's vertical — height
	// collapses to fontSize and width becomes labelW.
	// Linear-interpolate via sin / cos. Using `fontSize` alone (no 1.4)
	// underestimated for unrotated labels and let descenders clip
	// through the bottom reserve under larger title fonts.
	const sin = Math.abs(Math.sin((xLabelAngleDeg * Math.PI) / 180))
	const cos = Math.abs(Math.cos((xLabelAngleDeg * Math.PI) / 180))
	const labelVerticalPx =
		labelW * sin + xLabelFontSize * 1.4 * maxLineCountIn(xLabels) * cos
	// Multiplier 1.4 (not 1.2) accounts for the FULL line-box height —
	// ascender + descender + small leading. With 1.2 the bottom reserve
	// fit only the ascender, and the descender of the title's last line
	// poked 2–3px past the SVG with larger title fonts (a theme with a
	// 15px axis-title font triggered the regression).
	const titlePx = xTitleText ? xTitleFontSize * 1.4 * xTitleLineCount + 6 : 0
	const tickReserve = 10 // tick mark + small gap before label
	// Gap between the tick-label band and the x-axis title (matches
	// `TITLE_LABEL_GAP_PX` in facetLayoutSolver). Without this term the
	// reserve fit only [tick + labels + title] back-to-back, but the
	// solver POSITIONS the title at `plotBottom + gap`, which puts the
	// title's bottom edge a few px past `BASE_MARGIN.bottom` — visible
	// as the title clipping into whatever sits below the canvas
	// (e.g. the data table). User-reported May 2026.
	const titleLabelGap = xTitleText ? 25 : 0
	const needed = tickReserve + labelVerticalPx + titleLabelGap + titlePx + 8
	// Floor is a delta above whatever base the solver already reserves.
	return Math.max(0, needed - baseMarginPx)
}

/** Pixels needed below a panel's plot rect to render just the x-axis tick
 *  marks and tick labels — NO axis-title space. Used for interior rows
 *  under shareX=OFF, where every panel draws its own x-axis but only the
 *  shared x-title sits below the grid (reserved by the bottom row's
 *  chrome). Without this, interior rows would each over-reserve enough
 *  space for a phantom title that never renders. */
export const estimateInteriorBottomChrome = ({
	xLabels,
	xLabelFontSize,
	xLabelAngleDeg,
	xLabelMaxWidthPx,
}: {
	xLabels: readonly string[]
	xLabelFontSize: number
	xLabelAngleDeg: number
	xLabelMaxWidthPx?: number
}): number => {
	if (xLabels.length === 0) return 0
	const labelW =
		xLabelMaxWidthPx && xLabelMaxWidthPx > 0
			? xLabelMaxWidthPx
			: estimateTextWidth(longestLineIn(xLabels), xLabelFontSize)
	const sin = Math.abs(Math.sin((xLabelAngleDeg * Math.PI) / 180))
	const cos = Math.abs(Math.cos((xLabelAngleDeg * Math.PI) / 180))
	const labelVerticalPx =
		labelW * sin + xLabelFontSize * 1.4 * maxLineCountIn(xLabels) * cos
	const tickReserve = 10
	return tickReserve + labelVerticalPx + 8
}

/** Mirror of `estimateInteriorBottomChrome` for the left side. Pixels
 *  needed to render just the y-axis tick marks and tick labels — NO
 *  y-title space. Used for interior columns under shareY=OFF.
 *
 *  Uses the same `labelW + 24` formula as `estimateExtraLeftMargin`
 *  with no title so that leftmost-column chrome and interior-column
 *  chrome match exactly when there's no y-title — keeps axes aligned
 *  across all columns in that case. */
export const estimateInteriorLeftChrome = ({
	yLabels,
	yLabelFontSize,
	yLabelMaxWidthPx,
}: {
	yLabels: readonly string[]
	yLabelFontSize: number
	/** Pre-measured width; preferred over the char-count estimate when
	 *  available. See `estimateExtraLeftMargin` for the rationale. */
	yLabelMaxWidthPx?: number
}): number => {
	if (yLabels.length === 0) return 0
	const labelW =
		yLabelMaxWidthPx && yLabelMaxWidthPx > 0
			? yLabelMaxWidthPx
			: estimateTextWidth(longestLineIn(yLabels), yLabelFontSize)
	return labelW + 24
}
