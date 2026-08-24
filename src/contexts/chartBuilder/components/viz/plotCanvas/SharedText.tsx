import type { TextRect } from "../../../lib/facetLayoutSolver"
import { renderMultilineTspans } from "../../../lib/multilineText"

export const TITLE_FILL_FALLBACK = "fill-stone-700 dark:fill-stone-300"

/** Render a TextRect as an SVG <text> at its spec coordinates. Handles
 *  rotation (-90 for rotated y-titles) and multi-line text. */
export const SharedText = ({
	rect,
	text,
	fontFamily,
	fontSize,
	fontWeight,
	fill,
	weight,
	italic,
	underline,
	angleDeg,
}: {
	rect: TextRect
	text: string
	fontFamily?: string
	fontSize?: number
	fontWeight?: number
	fill?: string
	/** User-chosen numeric font weight. When set it overrides `fontWeight`
	 * (the renderer's default for this slot), so a weight picked in the Labels
	 * panel trumps e.g. the axis title's default 500. */
	weight?: number
	italic?: boolean
	underline?: boolean
	/** User-chosen rotation in degrees about the anchor point (facet-title
	 * Orientation). Ignored when the rect carries its own structural
	 * `rotation` (the -90 rotated y-title). */
	angleDeg?: number
}) => {
	const transform =
		rect.rotation === -90
			? `rotate(-90, ${rect.x}, ${rect.y})`
			: angleDeg
				? `rotate(${angleDeg}, ${rect.x}, ${rect.y})`
				: undefined
	return (
		<text
			x={rect.x}
			y={rect.y}
			textAnchor={rect.textAnchor}
			transform={transform}
			fontFamily={fontFamily}
			fontSize={fontSize}
			fontWeight={weight ?? fontWeight}
			fontStyle={italic ? "italic" : undefined}
			textDecoration={underline ? "underline" : undefined}
			fill={fill}
			className={fill ? undefined : TITLE_FILL_FALLBACK}
		>
			{renderMultilineTspans(text, rect.x)}
		</text>
	)
}
