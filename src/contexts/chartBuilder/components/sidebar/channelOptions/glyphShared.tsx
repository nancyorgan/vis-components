import { DASH_CYCLE, dashArrayFor } from "../../../lib/dashPatterns"
import { PatternTile } from "../../../lib/patternDefs"
import {
	CHIP_BG,
	CHIP_INK,
	CHIP_INK_SELECTED,
	CHIP_STROKE,
	CHIP_STROKE_SELECTED,
} from "../../../lib/previewInk"
import { symbolPath } from "../../../lib/scales"
import { combine as c } from "../../../../../lib/cls"

import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { ResetLink } from "../../../../../components/ui/ResetLink"

export const PREVIEW_SIZE = 20

/** Class string for the gray glyph swatch chips — the shape / dash / pattern
 *  pickers, the legend swatch-shape picker, the map no-data pattern row and
 *  the theme editor's default-shape row. These chips are the documented GRAY
 *  exception to the purple `<Button>` rule, so this is the one copy of the
 *  look. `extra` carries the per-use sizing: `"w-7"` for a glyph chip,
 *  `"px-2 text-sm"` for a text chip ("None" / "Custom" / "Blank"). */
export const swatchChipClass = (selected: boolean, extra?: string) =>
	c(
		"flex h-7 items-center justify-center rounded border transition-colors",
		selected
			? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
			: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400",
		extra
	)

export const ShapeGlyph = ({ idx, selected }: { idx: number; selected: boolean }) => (
	<svg
		width={PREVIEW_SIZE}
		height={PREVIEW_SIZE}
		viewBox={`${-PREVIEW_SIZE / 2} ${-PREVIEW_SIZE / 2} ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
		aria-hidden="true"
	>
		<path
			d={symbolPath(idx, 5)}
			fill={selected ? "currentColor" : CHIP_INK}
			fillOpacity={0.9}
		/>
	</svg>
)

export const LineDashGlyph = ({
	idx,
	selected,
}: {
	idx: number
	selected: boolean
	inkColor?: string
	bgColor?: string
	/** Accepted so the dash glyph is interchangeable with `PatternGlyph` in
	 *  the swatch rows; dashes have no tile to zoom or turn. */
	scale?: number | null
	rotation?: number | null
}) => {
	const pattern = DASH_CYCLE[idx % DASH_CYCLE.length] ?? "solid"
	const strokeDashArray = dashArrayFor(pattern) ?? undefined
	// Dashes preview neutral — line color is owned by hue, not ink.
	const strokeColor = selected ? CHIP_INK_SELECTED : CHIP_INK
	return (
		<svg
			width={PREVIEW_SIZE}
			height={PREVIEW_SIZE}
			viewBox={`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
			aria-hidden="true"
		>
			<line
				x1={2}
				y1={PREVIEW_SIZE / 2}
				x2={PREVIEW_SIZE - 2}
				y2={PREVIEW_SIZE / 2}
				stroke={strokeColor}
				strokeWidth={2}
				strokeLinecap="round"
				strokeDasharray={strokeDashArray}
			/>
		</svg>
	)
}

export const PatternGlyph = ({
	idx,
	selected,
	inkColor: inkColorProp,
	bgColor = CHIP_BG,
	scale,
	rotation,
}: {
	idx: number
	selected: boolean
	inkColor?: string
	bgColor?: string
	/** Tile zoom previewed in the chip (the category's Scale pick); ×1 when
	 *  unset — so the chips show the pattern as the marks will draw it. */
	scale?: number | null
	/** Tile rotation previewed in the chip (the category's Rotate pick);
	 *  0° when unset. */
	rotation?: number | null
}) => {
	const inkColor = inkColorProp ?? (selected ? CHIP_INK_SELECTED : CHIP_INK)
	// Background is part of the id: chips differing only in background (per-
	// category hue colors) would otherwise share one def and all paint the
	// first chip's background. Scale and rotation likewise.
	const uniqueId = `glyph-pat-${idx}-${selected ? "sel" : "off"}-${inkColor.replaceAll(/[^a-zA-Z0-9]/g, "")}-${bgColor.replaceAll(/[^a-zA-Z0-9]/g, "")}-x${String(scale ?? 1).replace(".", "p")}-r${String(rotation ?? 0).replace(".", "p").replace("-", "n")}`
	return (
		<svg width={PREVIEW_SIZE} height={PREVIEW_SIZE} aria-hidden="true">
			<defs>
				<PatternTile
					id={uniqueId}
					paletteIdx={idx}
					bgColor={bgColor}
					inkColor={inkColor}
					scale={scale}
					rotation={rotation}
				/>
			</defs>
			<rect
				x={0}
				y={0}
				width={PREVIEW_SIZE}
				height={PREVIEW_SIZE}
				fill={`url(#${uniqueId})`}
				stroke={selected ? CHIP_STROKE_SELECTED : CHIP_STROKE}
				strokeWidth={0.5}
			/>
		</svg>
	)
}

/** Spoken names for the SHAPE_PALETTE entries (lib/scales.ts), same order.
 *  Chips draw the shape, so their accessible name has to come from here. */
export const SHAPE_NAMES = [
	"Circle",
	"Square",
	"Triangle",
	"Diamond",
	"Cross",
	"Star",
] as const

export const shapeName = (idx: number): string =>
	SHAPE_NAMES[idx % SHAPE_NAMES.length] ?? `Shape ${idx + 1}`

type CategoryRowProps = {
	value: string
	paletteSize: number
	activeIdx: number
	hasAnyOverride: boolean
	Glyph: React.ComponentType<{ idx: number; selected: boolean }>
	onPick: (idx: number) => void
	onReset: () => void
	/** Extra chips appended after the palette (the shape rows' custom-glyph
	 *  chips + "+" chip). Rendered inside the same flex-wrap row. */
	extraChips?: React.ReactNode
}

/** One palette row per category. The reset link clears every override the
 *  category has accumulated — shape choice AND fill / stroke color overrides
 *  — so the user has a single way to "go back to defaults" instead of
 *  hunting down per-attribute reset links. */
export const CategoryRow = ({
	value,
	paletteSize,
	activeIdx,
	hasAnyOverride,
	Glyph,
	onPick,
	onReset,
	extraChips,
}: CategoryRowProps) => (
	<div className="flex flex-col gap-1 text-sm">
		<div className="flex items-center justify-between gap-2">
			<span
				className="min-w-0 flex-1 truncate vc-text"
				title={value}
			>
				{value}
			</span>
			{hasAnyOverride && <ResetLink onClick={onReset} />}
		</div>
		<div className="flex flex-wrap gap-1">
			{Array.from({ length: paletteSize }, (_, idx) => {
				const selected = idx === activeIdx
				return (
					<button
						key={idx}
						type="button"
						onClick={() => onPick(idx)}
						aria-pressed={selected}
						aria-label={`${shapeName(idx)} for ${value}`}
						className={swatchChipClass(selected, "w-7")}
					>
						<Glyph idx={idx} selected={selected} />
					</button>
				)
			})}
			{extraChips}
		</div>
	</div>
)

/** `ColorInput` in its inherit mode plus a trailing reset link — the pattern
 *  panel's ink / background rows. `onClear` restores the default (emptying
 *  the hex box does the same through the primitive); `placeholder` is the
 *  inherited hex a null `value` previews. */
export const ColorRow = ({
	label,
	value,
	onChange,
	onClear,
	clearLabel = "reset",
	placeholder,
	className,
}: {
	label: string
	value: string | null
	onChange: (c: string) => void
	onClear?: () => void
	clearLabel?: string
	placeholder?: string
	className?: string
}) => (
	// flex-wrap: only bites when the row is squeezed (a phone-width menu
	// sheet) — the reset link then drops under the swatch instead of pushing
	// the row past the sheet edge.
	<div
		className={`flex flex-wrap items-center gap-2 text-sm${className ? ` ${className}` : ""}`}
	>
		<ColorInput
			label={label}
			labelClassName={LABEL_COL}
			value={value}
			onChange={onChange}
			onClear={onClear}
			placeholder={placeholder}
			className="contents"
		/>
		{onClear && value !== null && (
			<ResetLink onClick={onClear} label={clearLabel} />
		)}
	</div>
)
