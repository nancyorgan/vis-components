import { useId, type ReactNode } from "react"
import { combine as c } from "../../lib/cls"

import { LabeledField } from "./LabeledField"

export type SelectInputOption<V extends string> = {
	value: V
	label: ReactNode
	disabled?: boolean
}

/** Labeled `<select>` bound to a controlled value, with options expressed
 *  as a typed array. Generates the `<label htmlFor>` association
 *  automatically.
 *
 *  Generic over the value union so callers get exhaustive type checks on
 *  both the options array AND the `onChange` callback's `next` arg —
 *  catches typos like `value="auot"` at compile time. */
export const SelectInput = <V extends string>({
	id,
	label,
	value,
	options,
	onChange,
	disabled,
	className,
	selectClassName,
	labelClassName,
	inline,
	changed,
}: {
	id?: string
	label: ReactNode
	value: V
	options: ReadonlyArray<SelectInputOption<V>>
	onChange: (next: V) => void
	disabled?: boolean
	className?: string
	selectClassName?: string
	labelClassName?: string
	inline?: boolean
	/** Shows the per-line "changed" dot in front of the label. */
	changed?: boolean
}) => {
	const generatedId = useId()
	const inputId = id ?? generatedId

	return (
		<LabeledField
			id={inputId}
			label={label}
			className={className}
			labelClassName={labelClassName}
			inline={inline}
			changed={changed}
		>
			<select
				id={inputId}
				value={value}
				onChange={(e) => onChange(e.target.value as V)}
				disabled={disabled}
				className={c(
					"min-w-0 rounded-sm border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 transition-colors outline-none hover:border-stone-400 focus:border-stone-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:hover:border-stone-600 dark:focus:border-stone-500",
					selectClassName
				)}
			>
				{options.map((opt) => (
					<option key={opt.value} value={opt.value} disabled={opt.disabled}>
						{opt.label}
					</option>
				))}
			</select>
		</LabeledField>
	)
}
