import { useId, useMemo } from "react"

import type { TextFontConfig } from "../../chartBuilder/lib/labelsConfig"
import { PATTERN_PALETTE } from "../../chartBuilder/lib/patterns"
import type { Theme } from "../../chartBuilder/lib/types"
import {
	buildThemeSamplerModel,
	dasharrayOf,
	type SamplerGradient,
	type SamplerPalette,
} from "../lib/themePreviewModel"

/** Same surface as `ThemePreview` so the two sit side by side in the editor. */
const W = 400
const H = 300

// Fixed template geometry — layout only, never a theme value. Two columns:
// palettes and gradients down the left, patterns / marks / annotations /
// labels down the right. Rows stack from a cursor so a theme with one
// palette doesn't leave a hole where the other five would go.
const MARGIN = 16
const GUTTER = 12
const COL_W = (W - MARGIN * 2 - GUTTER) / 2
const LEFT_X0 = MARGIN
const RIGHT_X0 = MARGIN + COL_W + GUTTER
/** Section captions are set in the theme's text font at a fixed small
 *  size: they name the rows, they aren't the type specimen (the bar chart
 *  is). */
const CAPTION_SIZE = 10
const CAPTION_GAP = 6
const SECTION_GAP = 12
const CHIP_H = 10
const CHIP_GAP = 2
const ROW = CHIP_H + 4
const MAX_CATEGORICAL_ROWS = 4
const MAX_ORDINAL_ROWS = 6
const MAX_GRADIENT_ROWS = 4
const MAX_CHIPS = 12
const TILE_H = 24
const TILE_GAP = 6
const TILES_PER_ROW = 3

const caption = (t: TextFontConfig) => ({
	fontFamily: t.family,
	fontSize: CAPTION_SIZE,
	fontWeight: t.weight,
	fill: t.color,
})

const PaletteRow = ({
	palette,
	x0,
	y,
}: {
	palette: SamplerPalette
	x0: number
	y: number
}) => {
	const colors = palette.colors.slice(0, MAX_CHIPS)
	const chipW = (COL_W - CHIP_GAP * (colors.length - 1)) / colors.length
	return (
		<g>
			{colors.map((color, i) => {
				// Position is the identity: the same color can appear twice.
				const x = x0 + i * (chipW + CHIP_GAP)
				return (
					<rect
						key={x}
						x={x}
						y={y}
						width={chipW}
						height={CHIP_H}
						rx={1.5}
						fill={color}
					/>
				)
			})}
		</g>
	)
}

/** The editor's second live preview: a sampler of everything the card's
 *  bar chart leaves out. Every categorical and ordinal palette (default
 *  first), every gradient as a ramp, the pattern set on its background and
 *  on the default palette's own colors with their pattern inks, the default
 *  mark beside the connection / regression / distribution strokes, the
 *  three annotation kinds, and the data-label, legend-swatch and leader-
 *  line styles. Same fixed-template idea as `ThemePreview`: only the
 *  theme's values change. */
export const ThemeSamplerPreview = ({
	theme,
	name,
	className,
}: {
	theme: Theme
	name: string
	className?: string
}) => {
	const m = useMemo(() => buildThemeSamplerModel(theme), [theme])
	// Several previews share one page; def ids must not collide.
	const uid = useId()
	const gradientId = (g: SamplerGradient) => `${uid}-g-${g.id}`
	const patternId = (i: number) => `${uid}-p${i}`

	// ---- Left column: palettes and gradients, stacked from a cursor ----
	const categorical = m.categoricalPalettes.slice(0, MAX_CATEGORICAL_ROWS)
	const ordinal = m.ordinalPalettes.slice(0, MAX_ORDINAL_ROWS)
	const gradients = m.gradients.slice(0, MAX_GRADIENT_ROWS)

	let y = MARGIN + CAPTION_SIZE
	const categoricalCaptionY = y
	y += CAPTION_GAP
	const categoricalRowsY = y
	y += categorical.length * ROW + SECTION_GAP + CAPTION_SIZE
	const ordinalCaptionY = y
	y += CAPTION_GAP
	const ordinalRowsY = y
	y += ordinal.length * ROW + SECTION_GAP + CAPTION_SIZE
	const gradientCaptionY = y
	y += CAPTION_GAP
	const gradientRowsY = y

	// ---- Right column: fixed rows ----
	const patternsCaptionY = MARGIN + CAPTION_SIZE
	const tilesY = patternsCaptionY + CAPTION_GAP
	const tileW = (COL_W - TILE_GAP * (TILES_PER_ROW - 1)) / TILES_PER_ROW
	const marksCaptionY = tilesY + TILE_H * 2 + TILE_GAP + SECTION_GAP + CAPTION_SIZE
	const marksY = marksCaptionY + CAPTION_GAP + 12
	const annotationsCaptionY = marksY + 14 + SECTION_GAP + CAPTION_SIZE
	const annotationsY = annotationsCaptionY + CAPTION_GAP
	const annotationH = 26
	const labelsCaptionY = annotationsY + annotationH + SECTION_GAP + CAPTION_SIZE
	const labelsY = labelsCaptionY + CAPTION_GAP + 10

	// Pattern tiles: the first row on the pattern background with the
	// global ink, the second on the default palette's colors with the ink
	// the theme pairs with each (per-hue override, else the global ink).
	const defaultPalette = m.categoricalPalettes[0]
	const tiles = PATTERN_PALETTE.slice(0, TILES_PER_ROW * 2).map((def, i) => {
		const onHue = i >= TILES_PER_ROW
		const hueIdx = (i - TILES_PER_ROW) % (defaultPalette?.colors.length ?? 1)
		return {
			def,
			background:
				onHue && defaultPalette
					? defaultPalette.colors[hueIdx] ?? m.pattern.background
					: m.pattern.background,
			ink:
				onHue && defaultPalette
					? defaultPalette.inks[hueIdx] ?? m.pattern.ink
					: m.pattern.ink,
		}
	})

	const markCx = RIGHT_X0 + 12
	const textBoxX = RIGHT_X0 + 82
	const boxW = 70

	return (
		<svg
			viewBox={`0 0 ${W} ${H}`}
			className={className}
			role="img"
			aria-label={`Sampler of the ${name} theme`}
			focusable="false"
		>
			<defs>
				{gradients.map((g) => (
					<linearGradient key={g.id} id={gradientId(g)} x1="0" x2="1" y1="0" y2="0">
						{g.stops.map((s) => (
							<stop key={s.offset} offset={s.offset} stopColor={s.color} />
						))}
					</linearGradient>
				))}
				{tiles.map(({ def, background, ink }, i) => (
					<pattern
						key={def.id}
						id={patternId(i)}
						patternUnits="userSpaceOnUse"
						width={def.size}
						height={def.size}
					>
						<rect width={def.size} height={def.size} fill={background} />
						{def.render(ink)}
					</pattern>
				))}
			</defs>

			{m.background && (
				<rect x={0} y={0} width={W} height={H} fill={m.background} />
			)}

			{/* ---- Left column ---- */}
			<text x={LEFT_X0} y={categoricalCaptionY} {...caption(m.text)}>
				Categorical palettes
			</text>
			{categorical.map((p, i) => (
				<PaletteRow
					key={p.id}
					palette={p}
					x0={LEFT_X0}
					y={categoricalRowsY + i * ROW}
				/>
			))}

			<text x={LEFT_X0} y={ordinalCaptionY} {...caption(m.text)}>
				Ordinal palettes
			</text>
			{ordinal.map((p, i) => (
				<PaletteRow
					key={p.id}
					palette={p}
					x0={LEFT_X0}
					y={ordinalRowsY + i * ROW}
				/>
			))}

			<text x={LEFT_X0} y={gradientCaptionY} {...caption(m.text)}>
				Gradients
			</text>
			{gradients.map((g, i) => (
				<rect
					key={g.id}
					x={LEFT_X0}
					y={gradientRowsY + i * ROW}
					width={COL_W}
					height={CHIP_H}
					rx={2}
					fill={`url(#${gradientId(g)})`}
				/>
			))}

			{/* ---- Right column ---- */}
			<text x={RIGHT_X0} y={patternsCaptionY} {...caption(m.text)}>
				Patterns
			</text>
			{tiles.map(({ def }, i) => (
				<rect
					key={def.id}
					x={RIGHT_X0 + (i % TILES_PER_ROW) * (tileW + TILE_GAP)}
					y={tilesY + Math.floor(i / TILES_PER_ROW) * (TILE_H + TILE_GAP)}
					width={tileW}
					height={TILE_H}
					rx={2}
					fill={`url(#${patternId(i)})`}
				/>
			))}

			{/* Default mark, connection line, regression line + band,
			 *  distribution overlay */}
			<text x={RIGHT_X0} y={marksCaptionY} {...caption(m.text)}>
				Marks
			</text>
			<circle
				cx={markCx}
				cy={marksY}
				r={m.mark.radius}
				fill={m.mark.fill}
				fillOpacity={m.mark.opacity}
				stroke={m.outline.width > 0 ? m.outline.color : undefined}
				strokeWidth={m.outline.width > 0 ? m.outline.width : undefined}
			/>
			{m.connection.thickness > 0 && (
				<polyline
					points={`${RIGHT_X0 + 32},${marksY + 8} ${RIGHT_X0 + 50},${marksY - 6} ${RIGHT_X0 + 66},${marksY + 3} ${RIGHT_X0 + 82},${marksY - 8}`}
					fill="none"
					stroke={m.connection.color}
					strokeWidth={m.connection.thickness}
					strokeLinejoin="round"
				/>
			)}
			<rect
				x={RIGHT_X0 + 94}
				y={marksY - 7}
				width={50}
				height={14}
				fill={m.regression.ciFill}
				fillOpacity={0.25}
			/>
			<line
				x1={RIGHT_X0 + 94}
				x2={RIGHT_X0 + 144}
				y1={marksY + 4}
				y2={marksY - 4}
				stroke={m.regression.stroke}
				strokeWidth={1.5}
			/>
			<line
				x1={RIGHT_X0 + 154}
				x2={RIGHT_X0 + COL_W}
				y1={marksY}
				y2={marksY}
				stroke={m.distribution.stroke}
				strokeWidth={1}
			/>
			<rect
				x={RIGHT_X0 + 159}
				y={marksY - 8}
				width={COL_W - 164}
				height={16}
				fill={m.distribution.fill}
				stroke={m.distribution.stroke}
				strokeWidth={1}
			/>
			<line
				x1={RIGHT_X0 + 166}
				x2={RIGHT_X0 + 166}
				y1={marksY - 8}
				y2={marksY + 8}
				stroke={m.distribution.stroke}
				strokeWidth={1.5}
			/>

			{/* Rectangle annotation, text annotation with its box, line */}
			<text x={RIGHT_X0} y={annotationsCaptionY} {...caption(m.text)}>
				Annotations
			</text>
			<rect
				x={RIGHT_X0}
				y={annotationsY}
				width={boxW}
				height={annotationH}
				fill={m.box.backgroundColor}
				fillOpacity={m.box.backgroundOpacity}
				stroke={m.box.borderColor}
				strokeOpacity={m.box.borderOpacity}
				strokeWidth={m.box.borderThickness}
				strokeDasharray={dasharrayOf(m.box.borderDash, m.box.borderDasharray)}
			/>
			<text
				x={RIGHT_X0 + boxW / 2}
				y={annotationsY + annotationH / 2 + m.box.textFontSize * 0.35}
				textAnchor="middle"
				fontFamily={m.box.textFontFamily}
				fontSize={m.box.textFontSize}
				fontWeight={m.box.textFontWeight}
				fill={m.box.textColor}
			>
				Note
			</text>
			<rect
				x={textBoxX}
				y={annotationsY}
				width={boxW}
				height={annotationH}
				rx={m.textBox.cornerRadius}
				fill={m.textBox.backgroundColor}
				fillOpacity={m.textBox.backgroundOpacity}
				stroke={m.textBox.borderColor}
				strokeOpacity={m.textBox.borderOpacity}
				strokeWidth={m.textBox.borderThickness}
				strokeDasharray={dasharrayOf(
					m.textBox.borderDash,
					m.textBox.borderDasharray
				)}
			/>
			<text
				x={textBoxX + boxW / 2}
				y={annotationsY + annotationH / 2 + m.textBox.textFontSize * 0.35}
				textAnchor="middle"
				fontFamily={m.textBox.textFontFamily}
				fontSize={m.textBox.textFontSize}
				fontWeight={m.textBox.textFontWeight}
				fill={m.textBox.textColor}
			>
				Callout
			</text>
			<line
				x1={RIGHT_X0 + COL_W - 8}
				x2={RIGHT_X0 + COL_W - 8}
				y1={annotationsY}
				y2={annotationsY + annotationH}
				stroke={m.line.lineColor}
				strokeOpacity={m.line.lineOpacity}
				strokeWidth={m.line.lineThickness}
				strokeDasharray={dasharrayOf(m.line.lineDash, m.line.lineDasharray)}
			/>

			{/* Data label, standalone legend swatch, map leader line */}
			<text x={RIGHT_X0} y={labelsCaptionY} {...caption(m.text)}>
				Labels
			</text>
			<text
				x={RIGHT_X0}
				y={labelsY + m.dataLabels.size * 0.35}
				fontFamily={m.dataLabels.family}
				fontSize={m.dataLabels.size}
				fontWeight={m.dataLabels.weight}
				fontStyle={m.dataLabels.italic ? "italic" : undefined}
				textDecoration={m.dataLabels.underline ? "underline" : undefined}
				fill={m.dataLabels.color}
			>
				42
			</text>
			<circle
				cx={RIGHT_X0 + 52}
				cy={labelsY}
				r={7}
				fill={m.legendSwatch.color}
				stroke={m.legendSwatch.stroke}
				strokeWidth={1.5}
			/>
			<text
				x={RIGHT_X0 + 64}
				y={labelsY + m.text.size * 0.35}
				fontFamily={m.text.family}
				fontSize={m.text.size}
				fontWeight={m.text.weight}
				fill={m.text.color}
			>
				Size
			</text>
			<circle
				cx={RIGHT_X0 + 108}
				cy={labelsY + 8}
				r={3}
				fill={m.dataLabels.color}
			/>
			<line
				x1={RIGHT_X0 + 108}
				y1={labelsY + 8}
				x2={RIGHT_X0 + 124}
				y2={labelsY - 4}
				stroke={m.leaderLine.color}
				strokeWidth={m.leaderLine.width}
			/>
			<text
				x={RIGHT_X0 + 128}
				y={labelsY - 4 + m.dataLabels.size * 0.35}
				fontFamily={m.dataLabels.family}
				fontSize={m.dataLabels.size}
				fontWeight={m.dataLabels.weight}
				fill={m.dataLabels.color}
			>
				Region
			</text>
		</svg>
	)
}
