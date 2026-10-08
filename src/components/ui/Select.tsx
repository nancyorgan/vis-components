import { forwardRef } from "react"
import { combine as c } from "../../lib/cls"

// Generic select dropdown. Its look is .vc-field in src/styles/components.css
// elsewhere in the app. Pass <option>s as children.

export type SelectProps = Omit<JSX.IntrinsicElements["select"], "ref">

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
	function Select({ className, children, ...p }, ref) {
		return (
			<select
				ref={ref}
				className={c(
					"vc-field min-w-0 px-2 py-1 text-sm",
					className
				)}
				{...p}
			>
				{children}
			</select>
		)
	}
)
