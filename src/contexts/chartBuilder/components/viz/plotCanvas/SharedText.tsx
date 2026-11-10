import type { TextRect } from "../../../lib/facetLayoutSolver"
import { renderMultilineTspans, type TextPrefix } from "../../../lib/multilineText"

export const TITLE_FILL_FALLBACK = "fill-stone-700 dark:fill-stone-300"

/** Render a TextRect as an SVG <text> at its spec coordinates. Handles
 *  rotation (-90 for rotated y-titles) and multi-line text, which stacks UP
 *  from the last line when the rect is flagged `growUp`. */
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
	prefix,
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
	 * Angle). Ignored when the rect carries its own structural `rotation`
	 * (the -90 rotated y-title, a vertical side-placed facet title). */
	angleDeg?: number
	/** Styled run in front of the first line (chart-title prefix); shares
	 * the line's text chunk so `rect.textAnchor` aligns both together. */
	prefix?: TextPrefix
}) => {
	const transform =
		rect.rotation !== 0
			? `rotate(${rect.rotation}, ${rect.x}, ${rect.y})`
			: angleDeg
				? `rotate(${angleDeg}, ${rect.x}, ${rect.y})`
				: undefined
	// Upright side-placed facet titles anchor their line box to the panel
	// edge they align to (`TextRect.verticalAnchor`); everything else keeps
	// the alphabetic baseline.
	const dominantBaseline =
		rect.verticalAnchor === "top"
			? "hanging"
			: rect.verticalAnchor === "middle"
				? "middle"
				: rect.verticalAnchor === "bottom"
					? "auto"
					: undefined
	return (
		<text
			x={rect.x}
			y={rect.y}
			textAnchor={rect.textAnchor}
			transform={transform}
			dominantBaseline={dominantBaseline}
			fontFamily={fontFamily}
			fontSize={fontSize}
			fontWeight={weight ?? fontWeight}
			fontStyle={italic ? "italic" : undefined}
			textDecoration={underline ? "underline" : undefined}
			fill={fill}
			className={fill ? undefined : TITLE_FILL_FALLBACK}
			pointerEvents="none"
		>
			{renderMultilineTspans(text, rect.x, {
				prefix,
				growUp: rect.growUp,
				fontSize,
			})}
		</text>
	)
}
