import { DASH_CYCLE, dashArrayFor } from "../../../lib/dashPatterns"
import { PATTERN_PALETTE } from "../../../lib/patterns"
import {
	CHIP_BG,
	CHIP_INK,
	CHIP_INK_SELECTED,
	CHIP_STROKE,
	CHIP_STROKE_SELECTED,
} from "../../../lib/previewInk"
import { symbolPath } from "../../../lib/scales"

import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { ResetLink } from "../../../../../components/ui/ResetLink"

export const PREVIEW_SIZE = 20

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
}: {
	idx: number
	selected: boolean
	inkColor?: string
	bgColor?: string
}) => {
	const def = PATTERN_PALETTE[idx % PATTERN_PALETTE.length]
	const inkColor = inkColorProp ?? (selected ? CHIP_INK_SELECTED : CHIP_INK)
	const uniqueId = `glyph-${def.id}-${selected ? "sel" : "off"}-${inkColor.replaceAll(/[^a-zA-Z0-9]/g, "")}`
	return (
		<svg width={PREVIEW_SIZE} height={PREVIEW_SIZE} aria-hidden="true">
			<defs>
				<pattern
					id={uniqueId}
					patternUnits="userSpaceOnUse"
					width={def.size}
					height={def.size}
				>
					<rect width={def.size} height={def.size} fill={bgColor} />
					{def.render(inkColor)}
				</pattern>
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
				className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-300"
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
						className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
							selected
								? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
								: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
						}`}
					>
						<Glyph idx={idx} selected={selected} />
					</button>
				)
			})}
			{extraChips}
		</div>
	</div>
)

/** Color row local to this panel that wraps the shared `ColorInput`
 *  with an optional inline "clear" button. The clearable semantics are
 *  GlyphPickerPanel-specific (per-shape stroke/fill overrides can be
 *  null = "inherit from defaults") so they don't belong in the shared
 *  primitive. */
export const ColorRow = ({
	label,
	value,
	onChange,
	onClear,
	clearLabel = "clear",
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
	<div
		className={`flex items-center gap-2 text-sm${className ? ` ${className}` : ""}`}
	>
		<ColorInput
			label={label}
			labelClassName={LABEL_COL}
			value={value ?? "#000000"}
			onChange={onChange}
			className="contents"
		/>
		{onClear && value !== null && (
			<ResetLink onClick={onClear} label={clearLabel} />
		)}
	</div>
)
