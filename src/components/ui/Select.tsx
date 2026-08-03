import { forwardRef } from "react"
import { combine as c } from "../../lib/cls"

// Generic select dropdown with the same Tailwind treatment as inline selects
// elsewhere in the app. Pass <option>s as children.

export type SelectProps = Omit<JSX.IntrinsicElements["select"], "ref">

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
	function Select({ className, children, ...p }, ref) {
		return (
			<select
				ref={ref}
				className={c(
					"min-w-0 rounded-sm border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 transition-colors outline-none hover:border-stone-400 focus:border-stone-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:hover:border-stone-600 dark:focus:border-stone-500",
					className
				)}
				{...p}
			>
				{children}
			</select>
		)
	}
)
