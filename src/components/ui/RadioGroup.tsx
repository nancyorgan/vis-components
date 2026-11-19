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

/** ONE radio button with its label to the right — the radio sibling of
 *  `Checkbox`. Every radio renders through this or `RadioGroup` (never a
 *  raw `<input type="radio">`), so all radio rows look identical. Use
 *  `RadioGroup` when the options are a plain list; use `Radio` when an
 *  option is conditional or carries its own controls underneath. Give the
 *  radios of one choice the same `name`. `align="start"` sits the button
 *  on the first line of a label that wraps or stacks. */
export const Radio = ({
	id,
	label,
	checked,
	onChange,
	disabled,
	name,
	value,
	align = "center",
	className,
}: {
	id?: string
	label: ReactNode
	checked: boolean
	/** Fires when this radio becomes the selected one. */
	onChange: () => void
	disabled?: boolean
	name?: string
	value?: string
	align?: "center" | "start"
	className?: string
}) => {
	const generatedId = useId()
	const inputId = id ?? generatedId
	const input = (
		<input
			id={inputId}
			type="radio"
			name={name}
			value={value}
			checked={checked}
			onChange={() => onChange()}
			disabled={disabled}
			className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
		/>
	)
	return (
		<div
			className={c(
				"flex gap-2 text-sm",
				align === "start" ? "items-start" : "items-center",
				className
			)}
		>
			{align === "start" ? (
				// text-sm line height, so the button centers on line one.
				<span className="flex h-5 items-center">{input}</span>
			) : (
				input
			)}
			<label
				htmlFor={inputId}
				className={c(
					"cursor-pointer vc-text",
					align === "start" && "min-w-0 flex-1",
					disabled && "cursor-not-allowed opacity-60"
				)}
			>
				{label}
			</label>
		</div>
	)
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
	align = "center",
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
	/** Where each button sits against its label: centered on it (the
	 *  default, right for a one-line label), or on the FIRST line of a
	 *  label that wraps — the button is boxed to the line height. */
	align?: "center" | "start"
	className?: string
	/** Replaces the legend's default bottom margin (`mb-1`) — `mb-0` for a
	 *  screen-reader-only legend, which still takes its margin inside the
	 *  fieldset otherwise. */
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
			<legend className={c(legendClassName ?? "mb-1", "vc-text")}>
				{legend}
			</legend>
			{options.map((opt) => {
				const optionId = `${groupId}-${opt.value}`
				const input = (
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
				)
				return (
					<div
						key={opt.value}
						className={c(
							"flex gap-2",
							align === "start" ? "items-start" : "items-center"
						)}
					>
						{align === "start" ? (
							// text-sm line height, so the button centers on line one.
							<span className="flex h-5 items-center">{input}</span>
						) : (
							input
						)}
						<label
							htmlFor={optionId}
							className={c(
								"cursor-pointer vc-text",
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
