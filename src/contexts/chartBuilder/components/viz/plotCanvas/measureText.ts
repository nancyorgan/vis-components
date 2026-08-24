/** Reusable canvas context for text measurement. Created lazily so we
 *  don't allocate during SSR. Subsequent measurements reuse the same
 *  context (cheap), only re-setting the font when it changes. */
let _measureCtx: CanvasRenderingContext2D | null = null
const getMeasureContext = (): CanvasRenderingContext2D | null => {
	if (typeof document === "undefined") return null
	if (!_measureCtx) {
		const canvas = document.createElement("canvas")
		_measureCtx = canvas.getContext("2d")
	}
	return _measureCtx
}

/** Measure the widest label in `labels` using canvas measureText with
 *  the chart's actual tick-font. Returns 0 when the canvas API isn't
 *  available (SSR / non-DOM env) — the solver then falls back to its
 *  character-count estimate. Accurate widths matter for y-title
 *  positioning: the title sits a fixed gap from the rendered label
 *  edge, so a 30% over-estimate (the 0.55-char-width heuristic on
 *  narrow fonts) shows up as visible "weird gap" between title and
 *  labels (user-reported May 2026).
 *
 *  Multi-line (wrapped, `\n`-joined) labels measure their widest LINE —
 *  the rendered bounding box of stacked tspans is the widest line. */
export const measureMaxLabelWidth = (
	labels: readonly string[],
	fontFamily: string | null | undefined,
	fontSize: number,
	fontWeight?: number,
	italic?: boolean,
): number => {
	const ctx = getMeasureContext()
	if (!ctx || labels.length === 0) return 0
	// Match the RENDERED font — weight and style included. Omitting the
	// weight made a 600-weight "$140,000" measure narrower than it draws,
	// so the reserved right margin landed on the glyph edge and clipped the
	// last character. Canvas font shorthand: `[style] [weight] size family`.
	const stylePrefix = italic ? "italic " : ""
	const weightPrefix = fontWeight ? `${fontWeight} ` : ""
	ctx.font = `${stylePrefix}${weightPrefix}${fontSize}px ${fontFamily ?? "sans-serif"}`
	let max = 0
	for (const label of labels) {
		for (const line of label.split("\n")) {
			const w = ctx.measureText(line).width
			if (w > max) max = w
		}
	}
	return max
}
