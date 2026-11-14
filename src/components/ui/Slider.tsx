import { useId } from "react"

import { combine as c } from "../../lib/cls"

import { LABEL_COL } from "./LabeledField"
import { NumberInput } from "./NumberInput"

/** A bounded value: a slider, with the number beside it in a box that can
 *  be typed into.
 *
 *  Every option with a fixed range — an opacity, a saturation or brightness
 *  level, a smoothing amount, a multiplier — is one of these, so they look
 *  and behave the same wherever they appear. (Unbounded values, pixel sizes
 *  above all, stay number boxes.) The slider is for dragging to a look; the
 *  box is for an exact value, and steps with its arrows or the arrow keys.
 *
 *  `percent` shows a 0–1 value as 0–100 %; `suffix` names any other unit
 *  ("×"). The label names the slider; the box is "{label} value" to a
 *  screen reader. */
export const Slider = ({
	label,
	value,
	onChange,
	min,
	max,
	step,
	percent = false,
	suffix,
	changed = false,
	disabled = false,
	labelClassName = LABEL_COL,
	labelTitle,
	className,
}: {
	label: string
	value: number
	onChange: (next: number) => void
	min: number
	max: number
	step: number
	/** The value is a fraction (0–1) shown as a percent. */
	percent?: boolean
	/** Unit after the number, when it is not a percent ("×"). */
	suffix?: string
	/** Emphasize the label: the value differs from its default. */
	changed?: boolean
	/** Greyed out, the box showing "—": the option is switched off. */
	disabled?: boolean
	/** Label column classes; the shared sidebar column by default. Pass
	 *  `"sr-only"` when a visible label sits elsewhere in the row. */
	labelClassName?: string
	/** Hover text for the label, for one that may be cut short (a category
	 *  name in a per-category list). */
	labelTitle?: string
	className?: string
}) => {
	const id = useId()
	const factor = percent ? 100 : 1
	// What the box shows, at the step's precision (0.05 → 5 %, 0.1 → "1.5").
	const decimals = (String(Number((step * factor).toFixed(6))).split(".")[1] ?? "").length
	const shown = Number((value * factor).toFixed(decimals))
	const clamped = (n: number): number => Math.min(max, Math.max(min, n))
	return (
		<div className={c("flex items-center gap-2 text-sm", className)}>
			<label
				htmlFor={id}
				title={labelTitle}
				className={c(
					"shrink-0",
					labelClassName,
					changed && "font-semibold !text-vc-section-header"
				)}
			>
				{label}
			</label>
			<input
				id={id}
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(Number(e.target.value))}
				className="min-w-0 flex-1 disabled:opacity-50"
			/>
			<NumberInput
				label={`${label} value`}
				labelClassName="sr-only"
				value={disabled ? null : shown}
				placeholder={disabled ? "—" : undefined}
				min={Number((min * factor).toFixed(6))}
				max={Number((max * factor).toFixed(6))}
				step={Number((step * factor).toFixed(6))}
				clamp
				disabled={disabled}
				// Back to stored units, without the float noise of the division.
				onChange={(n) => onChange(clamped(Number((n / factor).toFixed(6))))}
				inputClassName="w-14"
				suffix={percent ? "%" : suffix}
			/>
		</div>
	)
}
