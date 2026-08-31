import { orderCategories } from "../../../lib/legendSections"
import {
	PATTERN_PALETTE,
	patternCategoriesFor,
	resolvePatternForCategory,
} from "../../../lib/patterns"
import { LEGEND_SWATCH_OUTLINE } from "../../../lib/previewInk"
import { EntryHoverWrap, renderEntryList, SwatchCell } from "./swatches"
import type { ReversibleLegendProps } from "./types"

export const PatternLegend = ({
	type,
	values,
	configs,
	pinnedOrder,
	reverseCategorical,
	orientation = "vertical",
	defaultSwatchOpacity = 1,
	entryColumns,
	highlightField,
}: ReversibleLegendProps & { defaultSwatchOpacity?: number }) => {
	const rawCategories = patternCategoriesFor(values, type)
	// Preserve the original palette index so colors/patterns stay stable even
	// when we reorder (pinned field order) or reverse the display order.
	const entries = orderCategories(rawCategories, type, pinnedOrder).map((v) => ({
		v,
		i: rawCategories.indexOf(v),
	}))
	const display = reverseCategorical ? [...entries].reverse() : entries
	const bgColor = configs.pattern?.backgroundColor ?? "#e2e8f0"
	const isHorizontal = orientation === "horizontal"
	const cellClass = isHorizontal
		? "flex flex-shrink-0 items-center gap-1.5"
		: "flex items-center gap-2"
	const labelClass = isHorizontal ? "whitespace-nowrap" : "min-w-0 truncate"
	const rows = display.map(({ v, i }) => {
				const resolved = resolvePatternForCategory(
					v,
					i,
					configs.pattern,
					bgColor
				)
				// When the category is opted out via PATTERN_NONE, render a plain
				// background-colored swatch (no pattern overlay) so the legend
				// matches what the chart draws.
				if (resolved === null) {
					return (
						<EntryHoverWrap key={v} field={highlightField} value={v}>
							<div className={cellClass}>
								<SwatchCell>
									<svg
										width={20}
										height={14}
										aria-hidden="true"
										className="flex-shrink-0"
										opacity={defaultSwatchOpacity}
									>
										<rect
											x={0}
											y={0}
											width={20}
											height={14}
											fill={bgColor}
											stroke={LEGEND_SWATCH_OUTLINE}
											strokeWidth={0.5}
										/>
									</svg>
								</SwatchCell>
								<span className={labelClass} title={v}>
									{v}
								</span>
							</div>
						</EntryHoverWrap>
					)
				}
				const { paletteIdx, inkColor, svgId } = resolved
				const def = PATTERN_PALETTE[paletteIdx % PATTERN_PALETTE.length]
				const patId = `legend-${svgId}`
				return (
					<EntryHoverWrap key={v} field={highlightField} value={v}>
						<div className={cellClass}>
							<SwatchCell>
								<svg
									width={20}
									height={14}
									aria-hidden="true"
									className="flex-shrink-0"
									opacity={defaultSwatchOpacity}
								>
									<defs>
										<pattern
											key={patId}
											id={patId}
											patternUnits="userSpaceOnUse"
											width={def.size}
											height={def.size}
										>
											<rect
												x={0}
												y={0}
												width={def.size}
												height={def.size}
												fill={bgColor}
											/>
											{def.render(inkColor)}
										</pattern>
									</defs>
									<rect
										x={0}
										y={0}
										width={20}
										height={14}
										fill={`url(#${patId})`}
										stroke={LEGEND_SWATCH_OUTLINE}
										strokeWidth={0.5}
									/>
								</svg>
							</SwatchCell>
							<span className={labelClass} title={v}>
								{v}
							</span>
						</div>
					</EntryHoverWrap>
				)
			})
	return isHorizontal ? (
		<div className="flex flex-row flex-nowrap items-center gap-3">{rows}</div>
	) : (
		renderEntryList(rows, entryColumns)
	)
}
