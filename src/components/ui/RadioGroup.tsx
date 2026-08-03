import { useId, type ReactNode } from "react"
import { combine as c } from "../../lib/cls"

export type RadioGroupOption<V extends string> = {
	value: V
	label: ReactNode
	/** Optional decoration (swatch, icon) rendered to the right of the
	 *  label. Useful for color-pick radios that show what each option
	 *  represents visually. */
	trailing?: ReactNode
	disabled?: boolean
}

/** Labeled radio group bound to a controlled value. Generic over the
 *  option-value union so callers get exhaustive type checks on both the
 *  options array AND the `onChange` callback's `next` arg.
 *
 *  Each radio is wired via a shared `name` attribute (auto-generated
 *  through `useId()` for stability across renders) so the browser
 *  enforces single-selection semantics natively — no JS bookkeeping
 *  needed. Clicking any option's label fires the corresponding radio
 *  via `htmlFor`, so the entire row is a click target. */
export const RadioGroup = <V extends string>({
	id,
	legend,
	value,
	options,
	onChange,
	disabled,
	orientation = "vertical",
	className,
	legendClassName,
}: {
	/** Optional id for the group's `name` attribute. Auto-generated when
	 *  omitted. */
	id?: string
	/** Visible legend above the radio rows. Use a stable string (or
	 *  `sr-only`-styled node) so the group has an accessible name. */
	legend: ReactNode
	value: V
	options: ReadonlyArray<RadioGroupOption<V>>
	onChange: (next: V) => void
	disabled?: boolean
	/** Lay options vertically (stacked rows, the default) or horizontally
	 *  (e.g. an "On / Off / Auto" tri-state). */
	orientation?: "vertical" | "horizontal"
	className?: string
	legendClassName?: string
}) => {
	const generatedId = useId()
	const groupId = id ?? generatedId

	return (
		<fieldset
			className={c(
				orientation === "vertical"
					? "flex flex-col gap-1 text-sm"
					: "flex flex-row gap-3 text-sm",
				disabled && "opacity-60",
				className
			)}
			disabled={disabled}
		>
			<legend
				className={c(
					"mb-1 text-stone-600 dark:text-stone-400",
					legendClassName
				)}
			>
				{legend}
			</legend>
			{options.map((opt) => {
				const optionId = `${groupId}-${opt.value}`
				return (
					<div key={opt.value} className="flex items-center gap-2">
						<input
							id={optionId}
							type="radio"
							name={groupId}
							value={opt.value}
							checked={value === opt.value}
							onChange={() => onChange(opt.value)}
							disabled={opt.disabled}
							className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
						/>
						<label
							htmlFor={optionId}
							className={c(
								"cursor-pointer text-stone-700 dark:text-stone-300",
								opt.disabled && "cursor-not-allowed opacity-60"
							)}
						>
							{opt.label}
						</label>
						{opt.trailing}
					</div>
				)
			})}
		</fieldset>
	)
}
