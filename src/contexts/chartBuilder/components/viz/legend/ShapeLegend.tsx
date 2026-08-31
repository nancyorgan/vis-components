import { DEFAULT_SHAPE_CONFIG } from "../../../lib/channelConfig"
import { GlyphMark, resolveGlyph, stripNudge } from "../../../lib/customGlyphs"
import { orderCategories, uniqueValues } from "../../../lib/legendSections"
import { makeShapeIndexer } from "../../../lib/scales"
import { renderEntryList } from "./swatches"
import type { LegendProps } from "./types"

export const ShapeLegend = ({
	type,
	values,
	configs,
	pinnedOrder,
	legendFillColor,
	legendStrokeColor,
	orientation = "vertical",
	defaultSwatchOpacity = 1,
	entryColumns,
	swatchSize,
}: LegendProps & {
	legendFillColor: string | null | undefined
	legendStrokeColor: string | null | undefined
	defaultSwatchOpacity?: number
	/** Glyph radius (px) from the Legend panel's Shape swatch size control
	 *  (`swatchSizes.shape`). `null` / undefined = the historical 5. */
	swatchSize?: number | null
}) => {
	const unique = orderCategories(uniqueValues(values, type), type, pinnedOrder)
	const indexer = makeShapeIndexer(values, type, configs.shape)
	const outlineColor =
		configs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor
	const fillOverrides = configs.shape?.fillOverrides ?? {}
	const strokeOverrides = configs.shape?.strokeOverrides ?? {}
	// Fallback fill/stroke for the legend swatches. The legend doesn't
	// know which hue color to inherit when shape and hue encode different
	// fields (no single answer), so we read a user-set legend-level color
	// or fall back to a default.
	//
	// Default fill is NEUTRAL LIGHT GRAY (#9ca3af, ~Tailwind gray-400).
	// The historic default was a light blue (#4f8eda) which made the
	// legend look like the shape was encoding a color, even when no hue
	// channel was mapped — a neutral default makes the lack of a color
	// encoding visually obvious.
	//
	// Default stroke is a DARK contrast (#1f2937). The chart's
	// `outlineColor` defaults to "#ffffff" (white) so chart marks contrast
	// against colored fills, but a white stroke against a white legend
	// background disappears entirely — that was a separate bug.
	const fallbackFill = legendFillColor ?? "#9ca3af"
	const fallbackStroke = legendStrokeColor ?? "#1f2937"
	void outlineColor
	const isHorizontal = orientation === "horizontal"
	const cellClass = isHorizontal
		? "flex flex-shrink-0 items-center gap-1.5"
		: "flex items-center gap-2"
	const labelClass = isHorizontal ? "whitespace-nowrap" : "min-w-0 truncate"
	// Swatch-size control: radius of each glyph; the box grows with it so
	// larger glyphs don't clip (16px floor keeps the default look unchanged).
	const r = swatchSize ?? 5
	const side = Math.max(16, (r + 3) * 2)
	const rows = unique.map((v) => {
		const idx = indexer(v)
		const fillOverride = fillOverrides[v]
		const fill =
			fillOverride === "none" ? "none" : (fillOverride ?? fallbackFill)
		const stroke = strokeOverrides[v] ?? fallbackStroke
		return (
			<div key={v} className={cellClass}>
				<svg
					width={side}
					height={side}
					viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`}
					aria-hidden="true"
					className="flex-shrink-0"
				>
					<GlyphMark
						// Swatches render centered — nudged text glyphs would sit
						// off-center in (or clip out of) the box.
						glyph={stripNudge(resolveGlyph(idx, configs.shape?.customGlyphs))}
						r={r}
						fill={fill}
						fillOpacity={fill === "none" ? 0 : defaultSwatchOpacity}
						stroke={stroke}
						strokeWidth={1}
					/>
				</svg>
				<span className={labelClass} title={v}>
					{v}
				</span>
			</div>
		)
	})
	return isHorizontal ? (
		<div className="flex flex-row flex-nowrap items-center gap-3">{rows}</div>
	) : (
		renderEntryList(rows, entryColumns)
	)
}
