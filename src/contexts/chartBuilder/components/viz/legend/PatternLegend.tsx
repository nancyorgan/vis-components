import { DEFAULT_FILL } from "../../../lib/channelConfig"
import { resolveDashGapColor } from "../../../lib/dashPatterns"
import { orderCategories } from "../../../lib/legendSections"
import { PatternTile } from "../../../lib/patternDefs"
import {
	segmentDashArray,
	type SegmentPatternContext,
} from "../../../lib/segmentPattern"
import {
	inkForHueColor,
	inkPaletteForHue,
	patternCategoriesFor,
	resolvePatternForMark,
} from "../../../lib/patterns"
import { polygonPatternView } from "../../../lib/resolveLayerColor"
import { LEGEND_SWATCH_OUTLINE } from "../../../lib/previewInk"
import { useThemeInkFallback } from "../../../store/useThemeInkFallback"
import {
	EntryHoverWrap,
	renderEntryList,
	SegmentSwatchLine,
	SwatchCell,
} from "./swatches"
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
	polygonPatternFill = false,
	segmentSwatch = null,
}: ReversibleLegendProps & {
	defaultSwatchOpacity?: number
	/** Filled radar: tiles mirror the separate "Polygon fill" picks
	 *  (`pattern.polygonOverrides`, opt-in per category) instead of the
	 *  point-fill overrides. */
	polygonPatternFill?: boolean
	/** Scatter line segments: each swatch is a segment at the chart's
	 *  thickness — stroked with the tile (fill mode) or dashed (dash mode),
	 *  as the marks are. Null = the rectangle tiles. */
	segmentSwatch?: SegmentPatternContext | null
}) => {
	const rawCategories = patternCategoriesFor(values, type)
	const patternCfg = polygonPatternFill
		? polygonPatternView(configs).pattern
		: configs.pattern
	// Preserve the original palette index so colors/patterns stay stable even
	// when we reorder (pinned field order) or reverse the display order.
	const entries = orderCategories(rawCategories, type, pinnedOrder).map((v) => ({
		v,
		i: rawCategories.indexOf(v),
	}))
	const display = reverseCategorical ? [...entries].reverse() : entries
	// A standalone pattern section draws with no hue, so its tiles sit on
	// what the marks draw: the Background override when set, else the mark's
	// default fill — and the ink pairs on that color through the palette,
	// exactly as `resolvePatternDefForItem` does for the marks.
	const bgColor = configs.defaultFill ?? DEFAULT_FILL
	const themeInkFallback = useThemeInkFallback()
	const huePalette = inkPaletteForHue(configs, "categorical")
	const preferredInk = inkForHueColor(
		bgColor,
		huePalette.palette,
		huePalette.inks,
		themeInkFallback
	)
	const isHorizontal = orientation === "horizontal"
	// `vc-legend-hentry` / `vc-legend-label` let a fixed-width legend
	// (`.vc-legend-fixed-width`) shrink the cell and wrap the label.
	const cellClass = isHorizontal
		? "vc-legend-hentry flex flex-shrink-0 items-center gap-1.5"
		: "flex items-center gap-2"
	const labelClass = isHorizontal
		? "vc-legend-label whitespace-nowrap"
		: "min-w-0 truncate"
	// Segment DASH mode: the swatch is the plain-colored segment carrying
	// the category's dash (the same resolution the marks use), over the gap
	// ink when "Fill dash gaps" is on (auto on: a standalone pattern legend
	// means Pattern doesn't share hue's variable).
	const segmentDashSwatch = (
		v: string,
		segment: SegmentPatternContext
	): React.ReactNode => {
		const segmentColor = configs.defaultFill ?? DEFAULT_FILL
		const dashArray = segmentDashArray({
			patternValue: v,
			domain: rawCategories,
			patternCfg: configs.pattern,
			connectionCfg: configs.connection,
		})
		const gapFill = configs.connection?.dashGapFill ?? true
		const gapColor =
			gapFill && dashArray !== null
				? resolveDashGapColor({
						overrideKeys: [],
						patternValue: v,
						hueColor: null,
						lineColor: segmentColor,
						overrides: configs.connection?.dashAlternateColors ?? {},
						singleOverride: configs.connection?.dashGapColor ?? null,
						inkColors: configs.pattern?.inkColors ?? {},
						palette: huePalette.palette,
						patternInks: huePalette.inks,
						themeInkFallback,
						defaultInk: configs.defaultPatternInk ?? configs.patternInkColor ?? null,
					})
				: null
		return (
			<SegmentSwatchLine
				segment={{ ...segment, dashArray, gapColor }}
				stroke={segmentColor}
				opacity={defaultSwatchOpacity}
			/>
		)
	}
	const rows = display.map(({ v, i }) => {
				if (segmentSwatch?.mode === "dash") {
					return (
						<EntryHoverWrap key={v} field={highlightField} value={v}>
							<div className={cellClass}>
								<SwatchCell>{segmentDashSwatch(v, segmentSwatch)}</SwatchCell>
								<span className={labelClass} title={v}>
									{v}
								</span>
							</div>
						</EntryHoverWrap>
					)
				}
				const resolved = resolvePatternForMark(
					v,
					i,
					bgColor,
					patternCfg,
					preferredInk,
					polygonPatternFill
				)
				// When the category is opted out via PATTERN_NONE, render a plain
				// background-colored swatch (no pattern overlay) so the legend
				// matches what the chart draws.
				if (resolved === null) {
					return (
						<EntryHoverWrap key={v} field={highlightField} value={v}>
							<div className={cellClass}>
								<SwatchCell>
									{segmentSwatch ? (
										<SegmentSwatchLine
											segment={{ ...segmentSwatch, dashArray: null, gapColor: null }}
											stroke={bgColor}
											opacity={defaultSwatchOpacity}
										/>
									) : (
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
									)}
								</SwatchCell>
								<span className={labelClass} title={v}>
									{v}
								</span>
							</div>
						</EntryHoverWrap>
					)
				}
				const { paletteIdx, inkColor, svgId, scale, rotation } = resolved
				const patId = `legend-${svgId}`
				const tile = (
					<PatternTile
						id={patId}
						paletteIdx={paletteIdx}
						bgColor={bgColor}
						inkColor={inkColor}
						scale={scale}
						rotation={rotation}
					/>
				)
				return (
					<EntryHoverWrap key={v} field={highlightField} value={v}>
						<div className={cellClass}>
							<SwatchCell>
								{segmentSwatch ? (
									// Fill mode: the tile paints the segment's stroke.
									<SegmentSwatchLine
										segment={{ ...segmentSwatch, dashArray: null, gapColor: null }}
										stroke={`url(#${patId})`}
										opacity={defaultSwatchOpacity}
										defs={tile}
									/>
								) : (
								<svg
									width={20}
									height={14}
									aria-hidden="true"
									className="flex-shrink-0"
									opacity={defaultSwatchOpacity}
								>
									<defs>{tile}</defs>
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
								)}
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
