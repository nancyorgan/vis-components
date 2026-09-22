import { useMemo } from "react"

import type { FontConfig, TextFontConfig } from "../../chartBuilder/lib/labelsConfig"
import type { Theme } from "../../chartBuilder/lib/types"
import { buildThemePreviewModel } from "../lib/themePreviewModel"

/** Fixed drawing surface. 4:3 like the library's visual thumbnails, sized
 *  so theme font sizes (px, after the pt→px conversion) read the way they
 *  do on a small real chart rather than towering over a 200px card. */
const W = 400
const H = 300

// The template's fixed geometry — every number here is layout, never a
// theme value. Bars, ticks and legend entries are placeholders; what the
// theme contributes is color, stroke and type.
const PAD = 24
const PLOT_X0 = 52
const PLOT_X1 = 264
const PLOT_Y0 = 96
const PLOT_Y1 = 226
const LEGEND_X0 = 284
const LEGEND_X1 = W - PAD
/** One bar per palette color, up to this many. */
const MAX_BARS = 6
const BAR_HEIGHTS = [0.55, 0.9, 0.4, 0.72, 0.3, 0.62]
const TICKS = ["A", "B", "C", "D", "E", "F"]

const fontAttrs = (f: FontConfig | TextFontConfig) => ({
	fontFamily: f.family,
	fontSize: f.size,
	fontWeight: f.weight,
	fontStyle: f.italic ? "italic" : undefined,
	textDecoration: f.underline ? "underline" : undefined,
	fill: f.color,
})

/** Abstract preview of a theme: one fixed bar chart — title, subtitle, one
 *  bar per color for the first six colors of the default categorical
 *  palette, gridlines / spines / tick labels, an axis title and a legend
 *  keyed to the bars — filled in from the theme's own fonts and colors.
 *  Drawn live as inline SVG, so a new or edited theme previews itself with
 *  no thumbnail to generate or store; user Google Fonts show because the
 *  app registers them at boot. `name` is the theme's name, set in the
 *  theme's own title font so the card doubles as a type specimen. */
export const ThemePreview = ({
	theme,
	name,
	className,
}: {
	theme: Theme
	name: string
	className?: string
}) => {
	const m = useMemo(() => buildThemePreviewModel(theme), [theme])

	const titleX =
		m.titleAlignment === "left"
			? PAD
			: m.titleAlignment === "right"
				? W - PAD
				: W / 2
	const titleAnchor =
		m.titleAlignment === "left"
			? "start"
			: m.titleAlignment === "right"
				? "end"
				: "middle"
	const titleY = PAD + m.fonts.title.size
	const subtitleY = titleY + m.fonts.subtitle.size + 4

	// One bar per palette color: a three-color palette draws three bars.
	const barCount = Math.min(MAX_BARS, m.palette.length)
	const heights = BAR_HEIGHTS.slice(0, barCount)
	const slot = (PLOT_X1 - PLOT_X0) / barCount
	const barW = slot * 0.68
	const plotH = PLOT_Y1 - PLOT_Y0

	const tickLabelY = PLOT_Y1 + m.fonts.text.size + 6
	const axisTitleY = tickLabelY + m.fonts.axisTitle.size + 8

	// The legend lists the bars' series, as many rows as fit beside the
	// plot at the theme's legend text size.
	const legendTitleY = PLOT_Y0 + m.fonts.legendTitle.size
	const legendRow = Math.max(m.fonts.legendText.size, 10) + 8
	const legendFirstRowY = legendTitleY + 12
	const legendRowsThatFit = Math.floor(
		(PLOT_Y1 - legendFirstRowY) / legendRow
	)
	const legendCount = Math.max(1, Math.min(barCount, legendRowsThatFit))
	const legendBottom = legendFirstRowY + legendRow * (legendCount - 1) + 12

	return (
		<svg
			viewBox={`0 0 ${W} ${H}`}
			className={className}
			role="img"
			aria-label={`Preview of the ${name} theme`}
			// Keep every placeholder glyph out of the accessibility tree; the
			// label above says what the picture is.
			focusable="false"
		>
			{m.background && (
				<rect x={0} y={0} width={W} height={H} fill={m.background} />
			)}

			{/* Title tier */}
			<text
				x={titleX}
				y={titleY}
				textAnchor={titleAnchor}
				{...fontAttrs(m.fonts.title)}
			>
				{name}
			</text>
			<text
				x={titleX}
				y={subtitleY}
				textAnchor={titleAnchor}
				{...fontAttrs(m.fonts.subtitle)}
			>
				Subtitle
			</text>

			{/* Gridlines — drawn before the bars, like the real plot. */}
			{m.yGridline.thickness > 0 &&
				[0.25, 0.5, 0.75, 1].map((f) => {
					const y = PLOT_Y1 - plotH * f
					return (
						<line
							key={f}
							x1={PLOT_X0}
							x2={PLOT_X1}
							y1={y}
							y2={y}
							stroke={m.yGridline.color}
							strokeWidth={m.yGridline.thickness}
						/>
					)
				})}
			{m.xGridline.thickness > 0 &&
				heights.map((_, i) => {
					const x = PLOT_X0 + slot * (i + 1)
					return i === heights.length - 1 ? null : (
						<line
							key={x}
							x1={x}
							x2={x}
							y1={PLOT_Y0}
							y2={PLOT_Y1}
							stroke={m.xGridline.color}
							strokeWidth={m.xGridline.thickness}
						/>
					)
				})}

			{/* Bars in the default categorical palette, one per color */}
			{heights.map((h, i) => {
				const x = PLOT_X0 + slot * i + (slot - barW) / 2
				const barH = plotH * h
				return (
					<rect
						key={TICKS[i]}
						x={x}
						y={PLOT_Y1 - barH}
						width={barW}
						height={barH}
						fill={m.palette[i]}
						fillOpacity={m.defaultOpacity}
						stroke={m.outline.width > 0 ? m.outline.color : undefined}
						strokeWidth={m.outline.width > 0 ? m.outline.width : undefined}
					/>
				)
			})}

			{/* Spines */}
			{m.xSpine.thickness > 0 && (
				<line
					x1={PLOT_X0}
					x2={PLOT_X1}
					y1={PLOT_Y1}
					y2={PLOT_Y1}
					stroke={m.xSpine.color}
					strokeWidth={m.xSpine.thickness}
				/>
			)}
			{m.ySpine.thickness > 0 && (
				<line
					x1={PLOT_X0}
					x2={PLOT_X0}
					y1={PLOT_Y0}
					y2={PLOT_Y1}
					stroke={m.ySpine.color}
					strokeWidth={m.ySpine.thickness}
				/>
			)}

			{/* Tick labels in the text font */}
			{[0, 0.5, 1].map((f) => (
				<text
					key={f}
					x={PLOT_X0 - 8}
					y={PLOT_Y1 - plotH * f + m.fonts.text.size * 0.35}
					textAnchor="end"
					{...fontAttrs(m.fonts.text)}
				>
					{Math.round(f * 100)}
				</text>
			))}
			{heights.map((_, i) => (
				<text
					key={TICKS[i]}
					x={PLOT_X0 + slot * i + slot / 2}
					y={tickLabelY}
					textAnchor="middle"
					{...fontAttrs(m.fonts.text)}
				>
					{TICKS[i]}
				</text>
			))}
			<text
				x={(PLOT_X0 + PLOT_X1) / 2}
				y={axisTitleY}
				textAnchor="middle"
				{...fontAttrs(m.fonts.axisTitle)}
			>
				Axis title
			</text>

			{/* Legend */}
			{m.legendBackground && (
				<rect
					x={LEGEND_X0 - 8}
					y={PLOT_Y0 - 8}
					width={LEGEND_X1 - LEGEND_X0 + 16}
					height={legendBottom - PLOT_Y0 + 4}
					rx={4}
					fill={m.legendBackground}
				/>
			)}
			<text
				x={LEGEND_X0}
				y={legendTitleY}
				{...fontAttrs(m.fonts.legendTitle)}
			>
				Legend
			</text>
			{heights.slice(0, legendCount).map((_, i) => {
				const y = legendFirstRowY + legendRow * i
				return (
					<g key={TICKS[i]}>
						<rect
							x={LEGEND_X0}
							y={y}
							width={10}
							height={10}
							rx={2}
							fill={m.palette[i]}
							fillOpacity={m.defaultOpacity}
							stroke={m.outline.width > 0 ? m.outline.color : undefined}
							strokeWidth={m.outline.width > 0 ? m.outline.width : undefined}
						/>
						<text
							x={LEGEND_X0 + 16}
							y={y + 5 + m.fonts.legendText.size * 0.35}
							{...fontAttrs(m.fonts.legendText)}
						>
							Series {TICKS[i]}
						</text>
					</g>
				)
			})}
		</svg>
	)
}
