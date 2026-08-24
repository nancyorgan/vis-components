import {
	type CaptionConfig,
	type CaptionUnit,
} from "../../../lib/captionConfig"
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

/** Vertical space the caption reserves at the bottom of the canvas (box height
 *  plus a gap above and below). Fed to the solver as `extraBottomMargin` so the
 *  plot shrinks and the caption never pushes content past the viewport. */
export const captionReservePx = (box: CaptionBox | null): number =>
	box ? box.height + CAPTION_GAP * 2 : 0

type CaptionLayout = {
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
 *  there. Percent offsets resolve against canvas width (x) / height (y). */
export const positionCaptionBox = (
	caption: CaptionConfig,
	box: CaptionBox,
	canvasW: number,
	canvasH: number
): CaptionLayout => {
	const padding = Math.max(0, caption.padding)
	const fontSize = Math.max(1, ptToPx(caption.fontSize))

	const defaultLeft = (canvasW - box.width) / 2
	const defaultTop = canvasH - box.height - CAPTION_GAP
	const left =
		defaultLeft +
		resolveCaptionUnit(caption.offsetX, caption.offsetXUnit, canvasW)
	const top =
		defaultTop +
		resolveCaptionUnit(caption.offsetY, caption.offsetYUnit, canvasH)

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
				fill={caption.textColor || undefined}
				className={caption.textColor ? undefined : TITLE_FILL_FALLBACK}
			>
				{renderMultilineTspans(layout.lines.join("\n"), layout.textX)}
			</text>
		</g>
	)
}
