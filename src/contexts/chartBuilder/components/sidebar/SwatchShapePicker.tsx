import { CHIP_INK } from "../../lib/previewInk"
import type { LegendSwatchShape } from "../../lib/labelsConfig"
import { SHAPE_PALETTE, symbolPath } from "../../lib/scales"

const PREVIEW_SIZE = 20

/** Every glyph a legend swatch can take: the rounded rectangle, a line
 *  segment, then the shape palette. */
const SWATCH_SHAPE_OPTIONS: LegendSwatchShape[] = [
	null,
	"line",
	...SHAPE_PALETTE.map((_, i) => i),
]

const swatchShapeName = (shape: LegendSwatchShape): string =>
	shape === null
		? "Rectangle"
		: shape === "line"
			? "Line segment"
			: `Shape ${shape + 1}`

/** Preview glyph for the swatch shape picker. `null` renders the default
 *  rounded rectangle, `"line"` a short line segment, otherwise the matching
 *  `SHAPE_PALETTE` symbol. */
const SwatchShapeGlyph = ({
	idx,
	selected,
}: {
	idx: LegendSwatchShape
	selected: boolean
}) => {
	const fill = selected ? "currentColor" : CHIP_INK
	if (idx === null) {
		return (
			<svg
				width={PREVIEW_SIZE}
				height={PREVIEW_SIZE}
				viewBox={`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
				aria-hidden="true"
			>
				<rect
					x={4}
					y={6}
					width={12}
					height={8}
					rx={1.5}
					fill={fill}
					fillOpacity={0.9}
				/>
			</svg>
		)
	}
	if (idx === "line") {
		return (
			<svg
				width={PREVIEW_SIZE}
				height={PREVIEW_SIZE}
				viewBox={`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
				aria-hidden="true"
			>
				<line
					x1={3}
					y1={PREVIEW_SIZE / 2}
					x2={PREVIEW_SIZE - 3}
					y2={PREVIEW_SIZE / 2}
					stroke={fill}
					strokeOpacity={0.9}
					strokeWidth={2.5}
					strokeLinecap="round"
				/>
			</svg>
		)
	}
	return (
		<svg
			width={PREVIEW_SIZE}
			height={PREVIEW_SIZE}
			viewBox={`${-PREVIEW_SIZE / 2} ${-PREVIEW_SIZE / 2} ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
			aria-hidden="true"
		>
			<path d={symbolPath(idx, 5)} fill={fill} fillOpacity={0.9} />
		</svg>
	)
}

/** The row of glyph buttons that picks a legend swatch shape — shared by
 *  the Legend panel (per-section, per-visual) and the theme editor (the
 *  default every section starts from). Gray toggles, like every glyph
 *  swatch picker. `defaultShape` marks the theme's default in the button
 *  title so the per-visual picker says what "back to default" means. */
export const SwatchShapePicker = ({
	value,
	onChange,
	defaultShape,
}: {
	value: LegendSwatchShape
	onChange: (shape: LegendSwatchShape) => void
	defaultShape?: LegendSwatchShape
}) => (
	<div className="flex flex-wrap gap-1">
		{SWATCH_SHAPE_OPTIONS.map((opt) => {
			const selected = value === opt
			const name = swatchShapeName(opt)
			const isDefault = defaultShape !== undefined && opt === defaultShape
			const label = isDefault ? `${name} (theme default)` : name
			return (
				<button
					key={opt === null ? "rect" : String(opt)}
					type="button"
					onClick={() => onChange(opt)}
					aria-pressed={selected}
					aria-label={label}
					title={label}
					className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
						selected
							? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
							: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
					}`}
				>
					<SwatchShapeGlyph idx={opt} selected={selected} />
				</button>
			)
		})}
	</div>
)
