import {
	DEFAULT_PATTERN_ROTATION,
	DEFAULT_PATTERN_SCALE,
	PATTERN_ROTATION_MAX,
	PATTERN_ROTATION_MIN,
	PATTERN_ROTATION_STEP,
	PATTERN_SCALE_MAX,
	PATTERN_SCALE_MIN,
	PATTERN_SCALE_STEP,
} from "../../../../lib/channelConfig"

import { ColorInput } from "../../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../../components/ui/ResetLink"

import { ColorRow } from "../glyphShared"

import type { PatternPanel } from "./usePatternPanel"

/** One Scale or Rotate row: a number box with its own reset link once a
 *  value is set (emptying the box resets it too). `context` names the row
 *  for assistive tech only ("Scale for north"), so every box has a distinct
 *  name. */
const NumberRow = ({
	label,
	context,
	labelClassName,
	value,
	onChange,
	onClear,
	min,
	max,
	step,
	placeholder,
	suffix,
}: {
	label: string
	context?: string
	labelClassName?: string
	value: number | null
	onChange: (next: number) => void
	onClear: () => void
	min: number
	max: number
	step: number
	placeholder: string
	suffix?: string
}) => (
	// flex-wrap like ColorRow: a squeezed row drops the reset link under
	// the box instead of pushing past the sheet edge.
	<div className="flex flex-wrap items-center gap-2 text-sm">
		<NumberInput
			label={
				context ? (
					<>
						{label}
						<span className="sr-only"> for {context}</span>
					</>
				) : (
					label
				)
			}
			labelClassName={labelClassName ?? "vc-text"}
			value={value}
			onChange={onChange}
			onClear={onClear}
			min={min}
			max={max}
			step={step}
			clamp
			placeholder={placeholder}
			suffix={suffix}
			className="contents"
		/>
		{value !== null && (
			<ResetLink
				onClick={onClear}
				ariaLabel={`Reset ${label.toLowerCase()}${context ? ` for ${context}` : ""}`}
			/>
		)}
	</div>
)

/** The Scale and Rotate rows under a pattern's Ink color, one line each.
 *  Scale: ×0 to ×4 in tenths, typed values clamp into the range; blank =
 *  the ×1 default, shown as the placeholder so the spinner's first step
 *  moves off ×1 rather than off 0. Rotate: −180° to 180° by 1°; blank =
 *  0°. */
export const ScaleRotateRows = ({
	context,
	labelClassName,
	value,
	onChange,
	onClear,
	rotation,
	onRotationChange,
	onRotationClear,
}: {
	context?: string
	labelClassName?: string
	value: number | null
	onChange: (next: number) => void
	onClear: () => void
	rotation: number | null
	onRotationChange: (next: number) => void
	onRotationClear: () => void
}) => (
	<>
		<NumberRow
			label="Scale"
			context={context}
			labelClassName={labelClassName}
			value={value}
			onChange={onChange}
			onClear={onClear}
			min={PATTERN_SCALE_MIN}
			max={PATTERN_SCALE_MAX}
			step={PATTERN_SCALE_STEP}
			placeholder={String(DEFAULT_PATTERN_SCALE)}
		/>
		<NumberRow
			label="Rotate"
			context={context}
			labelClassName={labelClassName}
			value={rotation}
			onChange={onRotationChange}
			onClear={onRotationClear}
			min={PATTERN_ROTATION_MIN}
			max={PATTERN_ROTATION_MAX}
			step={PATTERN_ROTATION_STEP}
			placeholder={String(DEFAULT_PATTERN_ROTATION)}
			suffix="°"
		/>
	</>
)

/** One category's Ink color picker. Inherit mode: no per-category ink = the
 *  hue-paired / default ink, which `ink` already resolves to (previewed in
 *  the swatch). A picked ink has its reset beside it, like the Scale and
 *  Rotate under it. `target` says which ink map the picker writes. */
export const CategoryInkPicker = ({
	v,
	ink,
	hasInk,
	target,
}: {
	v: string
	ink: string
	hasInk: boolean
	target: {
		set: (value: string, color: string) => void
		reset: (value: string) => void
		ariaKind: string
	}
}) => (
	<div className="flex flex-wrap items-center gap-2 text-sm">
		<ColorInput
			label="Ink color"
			labelClassName={LABEL_COL}
			value={hasInk ? ink : null}
			onChange={(color) => target.set(v, color)}
			onClear={() => target.reset(v)}
			placeholder={ink}
			pickerLabel={`Pick palette ${target.ariaKind.toLowerCase()} color for ${v}`}
			className="contents"
		/>
		{hasInk && (
			<ResetLink
				ariaLabel={`Reset ${target.ariaKind.toLowerCase()} ink color for ${v}`}
				onClick={() => target.reset(v)}
			/>
		)}
	</div>
)

/** Ink + scale + rotation for the default (no Pattern variable) fill
 *  pattern. In compound mode these live inside the "Point fill" subsection
 *  (alongside the pattern swatches they recolor); in fill mode they trail
 *  the default pattern row. `showFillRow` is false in dashOnly, so nothing
 *  renders. */
export const FillColorRows = ({ p }: { p: PatternPanel }) => {
	const { configs, setConfigs, cfg, updateCfg } = p
	if (p.defaultPatternIdx === null || !p.showFillRow) return null
	return (
		<>
			{/* Inherit mode: no pick = the palette-paired / theme ink
			 *  (`resetInk`), previewed in the swatch. */}
			<ColorRow
				label="Ink color"
				value={configs.defaultPatternInk ?? null}
				onChange={(c) =>
					setConfigs((prev) => ({
						...prev,
						defaultPatternInk: c,
					}))
				}
				onClear={() =>
					setConfigs((prev) => ({
						...prev,
						defaultPatternInk: null,
					}))
				}
				clearLabel="reset"
				placeholder={p.resetInk}
			/>
			<ScaleRotateRows
				labelClassName={LABEL_COL}
				value={cfg.defaultScale ?? null}
				onChange={(n) => updateCfg({ defaultScale: n })}
				onClear={() => updateCfg({ defaultScale: null })}
				rotation={cfg.defaultRotation ?? null}
				onRotationChange={(n) => updateCfg({ defaultRotation: n })}
				onRotationClear={() => updateCfg({ defaultRotation: null })}
			/>
		</>
	)
}
