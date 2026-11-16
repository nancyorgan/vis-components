import {
	type CaptionConfig,
	type CaptionUnit,
} from "../../../lib/captionConfig"
import { charWidthFactor } from "../../../lib/estimateMargins"
import { ptToPx } from "../../../lib/fontUnit"
import {
	renderMultilineTspans,
	wrapTextToWidth,
} from "../../../lib/multilineText"
import { TITLE_FILL_FALLBACK } from "./SharedText"

/** Vertical gap above and below the caption box within its reserved band. */
const CAPTION_GAP = 8

/** Resolve a caption px/% measure against its basis (canvas width or height). */
const resolveCaptionUnit = (
	value: number,
	unit: CaptionUnit,
	basis: number
): number => (unit === "%" ? (value / 100) * basis : value)

/** The caption box's size, independent of where it's placed. Width defaults
 *  to the full canvas width (auto); height grows to fit the wrapped text
 *  (auto). Measured first so the layout solver can reserve a matching band at
 *  the bottom of the canvas — see `captionReserve`. */
type CaptionBox = {
	width: number
	height: number
	lines: string[]
}

export const measureCaptionBox = (
	caption: CaptionConfig,
	widthBasis: number,
	heightBasis: number
): CaptionBox | null => {
	if (!caption.enabled || caption.text.trim().length === 0) return null
	const fontSize = Math.max(1, ptToPx(caption.fontSize))
	const padding = Math.max(0, caption.padding)
	const lineHeight = fontSize * 1.2

	// Auto width spans the canvas but is inset by a gap on each side so the
	// border (and the box edges) sit INSIDE the SVG rather than clipping against
	// its left/right boundary. An explicit width is honored as-is.
	const width =
		caption.width > 0
			? resolveCaptionUnit(caption.width, caption.widthUnit, widthBasis)
			: Math.max(1, widthBasis - CAPTION_GAP * 2)
	const wrapWidth = Math.max(1, width - padding * 2)
	const lines = wrapTextToWidth(caption.text, wrapWidth, fontSize)
	const autoHeight = padding * 2 + lineHeight * lines.length
	const height =
		caption.height > 0
			? resolveCaptionUnit(caption.height, caption.heightUnit, heightBasis)
			: autoHeight

	return { width: Math.max(1, width), height: Math.max(1, height), lines }
}

/** Vertical space the caption asks for at the bottom of the canvas: the box
 *  plus a gap above and below, plus however far the caption is pushed DOWN
 *  ("Adjust position" Y, resolved against `canvasH`). Fed to the solver as
 *  `extraBottomMargin`, one more ask on the layout's one budget (LAYOUT.md
 *  §2): the plot gives up the room and the caption stays on the canvas.
 *
 *  Pushing a caption down cannot move it — it already sits at the bottom
 *  edge — so, like an x-axis title pushed away from the plot, the offset
 *  becomes room between it and the plot instead (`positionCaptionBox` keeps
 *  the box at the edge). The offset used to be applied to the box alone,
 *  which slid it off the canvas and grew the page into a scrollbar. */
export const captionReservePx = (
	box: CaptionBox | null,
	caption?: CaptionConfig,
	canvasH = 0
): number =>
	box
		? box.height +
			CAPTION_GAP * 2 +
			(caption
				? Math.max(0, resolveCaptionUnit(caption.offsetY, caption.offsetYUnit, canvasH))
				: 0)
		: 0

/** How far to move a span [lo, hi] so it lies inside [0, size]: back in
 *  from whichever edge it passed. A span longer than `size` is pinned at
 *  its start, so its beginning stays readable. */
const shiftIntoView = (lo: number, hi: number, size: number): number => {
	if (hi - lo >= size || lo < 0) return -lo
	return hi > size ? size - hi : 0
}

export type CaptionLayout = {
	left: number
	top: number
	width: number
	height: number
	textX: number
	firstBaseline: number
	textAnchor: "start" | "middle" | "end"
	lines: string[]
}

/** Position a measured caption box within the reserved bottom band. The box
 *  defaults to horizontally centered and pinned to the bottom of the canvas
 *  (`CAPTION_GAP` above the canvas edge); the position adjusters NUDGE it from
 *  there. Percent offsets resolve against canvas width (x) / height (y).
 *
 *  **The caption stays on the canvas.** Sideways and upward nudges move it
 *  until what it DRAWS (`captionDrawnBox`) reaches an edge, and stop there.
 *  A downward nudge does not move it at all: it is the room
 *  `captionReservePx` asked for between the caption and the plot. */
export const positionCaptionBox = (
	caption: CaptionConfig,
	box: CaptionBox,
	canvasW: number,
	canvasH: number
): CaptionLayout => {
	const asked = layoutCaptionAt(
		caption,
		box,
		(canvasW - box.width) / 2 +
			resolveCaptionUnit(caption.offsetX, caption.offsetXUnit, canvasW),
		canvasH -
			box.height -
			CAPTION_GAP +
			Math.min(0, resolveCaptionUnit(caption.offsetY, caption.offsetYUnit, canvasH))
	)
	const drawn = captionDrawnBox(caption, asked)
	const dx = shiftIntoView(drawn.left, drawn.right, canvasW)
	const dy = shiftIntoView(drawn.top, drawn.bottom, canvasH)
	return dx === 0 && dy === 0
		? asked
		: layoutCaptionAt(caption, box, asked.left + dx, asked.top + dy)
}

/** The caption's box and text geometry with the box's corner at (left, top). */
const layoutCaptionAt = (
	caption: CaptionConfig,
	box: CaptionBox,
	left: number,
	top: number
): CaptionLayout => {
	const padding = Math.max(0, caption.padding)
	const fontSize = Math.max(1, ptToPx(caption.fontSize))

	const textAnchor =
		caption.align === "center"
			? "middle"
			: caption.align === "right"
				? "end"
				: "start"
	const textX =
		caption.align === "center"
			? left + box.width / 2
			: caption.align === "right"
				? left + box.width - padding
				: left + padding
	const firstBaseline = top + padding + fontSize

	return {
		left,
		top,
		width: box.width,
		height: box.height,
		textX,
		firstBaseline,
		textAnchor,
		lines: box.lines,
	}
}

/** Whether the caption BOX itself is drawn (a visible background fill or a
 *  border). Without either, only the text ink is visible on the canvas. */
const captionBoxVisible = (caption: CaptionConfig): boolean =>
	caption.backgroundOpacity > 0 ||
	(caption.borderEnabled && caption.borderWidth > 0)

/** The edges of what the caption actually DRAWS. A visible box (background
 *  or border) counts in full; an invisible box — the default — counts only
 *  its text ink, estimated with the same px/char heuristic that wrapped it.
 *  This is what is kept on the canvas: an invisible auto-width box spans the
 *  whole canvas, so holding the BOX in view would leave its text no room to
 *  be nudged at all. */
export const captionDrawnBox = (
	caption: CaptionConfig,
	layout: CaptionLayout
): { left: number; top: number; right: number; bottom: number } => {
	if (captionBoxVisible(caption)) {
		return {
			left: layout.left,
			top: layout.top,
			right: layout.left + layout.width,
			bottom: layout.top + layout.height,
		}
	}
	const fontSize = Math.max(1, ptToPx(caption.fontSize))
	const widestChars = layout.lines.reduce((m, l) => Math.max(m, l.length), 0)
	const widest = widestChars * fontSize * charWidthFactor
	const left =
		layout.textAnchor === "start"
			? layout.textX
			: layout.textAnchor === "middle"
				? layout.textX - widest / 2
				: layout.textX - widest
	// Lines stack 1.2em apart from the first baseline; ascenders rise about
	// 0.8em above the first one and descenders hang a quarter em below the
	// last.
	const lastBaseline = layout.firstBaseline + fontSize * 1.2 * (layout.lines.length - 1)
	return {
		left,
		top: layout.firstBaseline - fontSize * 0.8,
		right: left + widest,
		bottom: lastBaseline + fontSize * 0.25,
	}
}

/** Render the caption box (optional background rect + border + wrapped text)
 *  inside the plot SVG, so it travels with thumbnails and image exports. */
export const CaptionOverlay = ({
	caption,
	layout,
}: {
	caption: CaptionConfig
	layout: CaptionLayout
}) => {
	const hasBg = caption.backgroundOpacity > 0
	const hasBorder = caption.borderEnabled && caption.borderWidth > 0
	return (
		<g data-caption>
			{(hasBg || hasBorder) && (
				<rect
					x={layout.left}
					y={layout.top}
					width={layout.width}
					height={layout.height}
					rx={caption.borderRadius}
					fill={hasBg ? caption.backgroundColor : "none"}
					fillOpacity={hasBg ? caption.backgroundOpacity : undefined}
					stroke={hasBorder ? caption.borderColor : "none"}
					strokeWidth={hasBorder ? caption.borderWidth : undefined}
				/>
			)}
			<text
				x={layout.textX}
				y={layout.firstBaseline}
				textAnchor={layout.textAnchor}
				fontFamily={caption.fontFamily}
				fontSize={ptToPx(caption.fontSize)}
				fontWeight={caption.fontWeight}
				fontStyle={caption.italic ? "italic" : undefined}
				textDecoration={caption.underline ? "underline" : undefined}
				fill={caption.textColor || undefined}
				className={caption.textColor ? undefined : TITLE_FILL_FALLBACK}
			>
				{renderMultilineTspans(layout.lines.join("\n"), layout.textX)}
			</text>
		</g>
	)
}
