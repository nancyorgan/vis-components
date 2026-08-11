import type { ReactNode } from "react"

import { estimateLongestLineWidth } from "./estimateMargins"
import type { LabelAlignment } from "./labelsConfig"
import { renderMultilineTspans, wrapTextToWidth } from "./multilineText"

/** Tick-label wrapping (the per-axis "Wrap text" toggle).
 *
 *  The wrap WIDTH depends on the axis:
 *   - x-axis labels wrap to the per-tick slot width — the horizontal space
 *     the axis provides each tick (`inner width / tick count`), shaved by
 *     `TICK_WRAP_SLOT_FRACTION` so adjacent labels keep a small gap.
 *   - y-axis and radar r-axis labels have no natural slot (the left margin
 *     is elastic), so they wrap to a fixed font-relative max width
 *     (`tickWrapMaxPx`) — the point of wrapping there is to CAP how much
 *     horizontal space long labels claim.
 *
 *  Both the renderers (Axes.tsx / radial.tsx) and the layout-side
 *  pre-wrapping (PlotCanvas panel inputs) go through these helpers so the
 *  reserved chrome and the rendered lines agree. */

/** Fraction of the per-tick slot an x-axis label may fill before wrapping —
 *  same 90% idea as `FIT_THRESHOLD` in `autoLabelAngle.ts`, so a label that
 *  JUST fits its slot isn't broken. */
export const TICK_WRAP_SLOT_FRACTION = 0.9

/** Max wrap width for tick labels on axes without a per-tick slot (y, r).
 *  ~8em: at the default 10px tick font that's ~14 characters per line —
 *  wide enough that typical numeric / short labels never wrap, narrow
 *  enough that long category names fold instead of eating the plot. */
export const tickWrapMaxPx = (fontSize: number): number => fontSize * 8

/** Wrap a tick label to fit `maxPx`, returning a `\n`-joined multi-line
 *  string (the form `renderMultilineTspans` / `estimateLongestLineWidth`
 *  consume). Wraps on spaces and after internal hyphens; a single word too
 *  long for a line is hard-broken mid-word. Labels that already fit come back unchanged.
 *  A non-positive `maxPx` (e.g. an empty axis's 0 band width) is a no-op
 *  rather than a one-character-per-line explosion. */
export const wrapTickLabel = (
	text: string,
	maxPx: number,
	fontSize: number
): string => {
	if (maxPx <= 0) return text
	return wrapTextToWidth(text, maxPx, fontSize, { breakWords: true }).join("\n")
}

/** The line alignment a block anchor produces on its own: every line of a
 *  wrapped label is anchored at the same `x`, so anchor "start" reads as
 *  left-aligned lines, "middle" as centered, "end" as right-aligned. */
export const naturalAlignForAnchor = (
	anchor: "start" | "middle" | "end"
): LabelAlignment =>
	anchor === "start" ? "left" : anchor === "middle" ? "center" : "right"

/** The natural alignment of an axis's wrapped tick labels — what renders
 *  when no explicit `wrapTickLabelAlign` is stored. Mirrors the anchor
 *  rules in Axes.tsx / radial.tsx: y labels anchor "end" against the axis
 *  (right), r labels anchor "start" at the spoke (left), and x labels
 *  anchor "middle" under the tick (center) — EXCEPT when rotated by an
 *  explicit angle, which flips the anchor to keep text away from the
 *  axis: negative angles anchor "end" (right), positive "start" (left).
 *  (The categorical auto-rotate is suppressed while wrapping, so the
 *  stored angle IS the effective one.)
 *
 *  The panel's alignment buttons MUST resolve their default through this
 *  — assuming "center" for a rotated x axis made "Center" store
 *  `undefined`, which the renderer resolved back to the anchor's natural
 *  (right), so Center and Right rendered identically. */
export const naturalWrapAlignFor = (
	channel: "x" | "y" | "r",
	tickLabelAngle: number
): LabelAlignment => {
	if (channel === "y") return "right"
	if (channel === "r") return "left"
	if (tickLabelAngle < 0) return "right"
	if (tickLabelAngle > 0) return "left"
	return "center"
}

/** Render a tick label with the chosen ALIGNMENT — wrapped or not.
 *
 *  Wrapped (multi-line) labels: the block keeps its position relative to the
 *  tick — `x` and `blockAnchor` describe where the single-line label would
 *  sit (centered under an x tick, right edge against the y axis, left edge
 *  at the radar spoke) — and only the lines WITHIN the block move. For a
 *  non-natural alignment we estimate the block width (widest line, same
 *  0.55-char heuristic the wrap itself uses), locate the block's edges from
 *  the anchor, and anchor every line at the chosen edge / center via a
 *  per-tspan `text-anchor`.
 *
 *  Single-line labels align within the axis's shared label COLUMN instead
 *  (their own block is exactly one line, so within-block alignment would be
 *  a no-op): the caller passes `columnWidth` — the widest label on the axis
 *  — and the label anchors at the chosen edge of that column. Axes with no
 *  column (x: each label just sits at its tick) pass 0, which degenerates
 *  to aligning AT the anchor point — left starts the label at its tick.
 *
 *  The natural alignment short-circuits to the plain render, so the width
 *  estimates (and their ±10% error) never affect the default appearance. */
export const renderWrappedTickLabel = ({
	label,
	x,
	blockAnchor,
	align,
	fontSize,
	verticallyCentered,
	columnWidth,
}: {
	label: string
	/** Anchor x of the single-line label (the `<text>` element's own x). */
	x: number
	/** The `<text>` element's `textAnchor` — how the block hangs off `x`. */
	blockAnchor: "start" | "middle" | "end"
	/** User-picked alignment; absent = the anchor's natural alignment. */
	align: LabelAlignment | undefined
	fontSize: number
	/** See `renderMultilineTspans` — for baseline-middle callers. */
	verticallyCentered: boolean
	/** Shared label-column width for SINGLE-LINE alignment (widest label on
	 *  the axis; 0 = align at the anchor point). Omitted → single-line
	 *  labels ignore `align` (legacy wrap-only behavior). */
	columnWidth?: number
}): ReactNode => {
	const naturalAlign = naturalAlignForAnchor(blockAnchor)
	const effective = align ?? naturalAlign
	// Anchor every line at the chosen edge / center of a `w`-wide block
	// hanging off `x` per `blockAnchor`.
	const alignedRender = (w: number): ReactNode => {
		const blockLeft =
			blockAnchor === "start" ? x : blockAnchor === "middle" ? x - w / 2 : x - w
		const lineX =
			effective === "left"
				? blockLeft
				: effective === "center"
					? blockLeft + w / 2
					: blockLeft + w
		const lineAnchor =
			effective === "left" ? "start" : effective === "center" ? "middle" : "end"
		return renderMultilineTspans(label, lineX, { verticallyCentered, lineAnchor })
	}
	if (!label.includes("\n")) {
		if (effective === naturalAlign || columnWidth === undefined) return label
		return alignedRender(columnWidth)
	}
	if (effective === naturalAlign) {
		return renderMultilineTspans(label, x, { verticallyCentered })
	}
	return alignedRender(estimateLongestLineWidth(label, fontSize))
}
