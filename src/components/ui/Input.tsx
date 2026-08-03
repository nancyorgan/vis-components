import { forwardRef } from "react"
import { combine as c } from "../../lib/cls"

// Generic text input with the same Tailwind treatment used across the app
// (folder rename, save bar). Keeps form styling consistent.

export type InputProps = Omit<JSX.IntrinsicElements["input"], "ref">

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
	{ className, type = "text", ...p },
	ref
) {
	return (
		<input
			ref={ref}
			type={type}
			className={c(
				"min-w-0 rounded-sm border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 transition-colors outline-none placeholder:text-stone-400 hover:border-stone-400 focus:border-stone-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:placeholder:text-stone-500 dark:hover:border-stone-600 dark:focus:border-stone-500",
				className
			)}
			{...p}
		/>
	)
})
