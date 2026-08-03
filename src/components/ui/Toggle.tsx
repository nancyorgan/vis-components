import { useId, type ReactNode } from "react"
import { combine as c } from "../../lib/cls"

/** Checkbox-style toggle with a properly-associated label. Differs from
 *  `LabeledField` because the label sits to the RIGHT of the checkbox
 *  (the conventional layout) — `LabeledField` puts the label on the
 *  left, which would feel wrong for a toggle. */
export const Toggle = ({
	id,
	label,
	checked,
	onChange,
	disabled,
	className,
	changed,
}: {
	id?: string
	label: ReactNode
	checked: boolean
	onChange: (next: boolean) => void
	disabled?: boolean
	className?: string
	/** Shows the per-line "changed" dot in front of the toggle. */
	changed?: boolean
}) => {
	const generatedId = useId()
	const inputId = id ?? generatedId
	return (
		<div className={c("flex items-center gap-2 text-sm", className)}>
			<input
				id={inputId}
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				disabled={disabled}
				className="cursor-pointer rounded border-stone-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700"
			/>
			<label
				htmlFor={inputId}
				className={c(
					"cursor-pointer text-stone-700 dark:text-stone-300",
					disabled && "cursor-not-allowed opacity-60",
					changed && "font-semibold !text-vc-section-header"
				)}
			>
				{label}
			</label>
		</div>
	)
}
