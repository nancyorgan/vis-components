import { forwardRef } from "react"
import { combine as c } from "../../lib/cls"

// Generic text input. Its look is .vc-field in src/styles/components.css
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
				"vc-field vc-placeholder-fainter min-w-0 px-2 py-1 text-sm",
				className
			)}
			{...p}
		/>
	)
})
