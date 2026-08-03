import { forwardRef } from "react"
import { combine as c } from "../../lib/cls"

// Locally-styled button that mirrors the look of @th/react-app's Button without
// pulling in its tailwind.macro dependency. Keeps vis-components decoupled from
// the external-ui build toolchain.

export type ButtonProps = Omit<JSX.IntrinsicElements["button"], "ref"> & {
	compact?: boolean
	outline?: boolean
	themeBase?: boolean
	themeInfo?: boolean
}

const spacing = {
	compact: "rounded-sm px-3 py-1.5 text-sm shadow",
	regular: "rounded-sm px-6 py-2 text-sm shadow",
}

const filled =
	"bg-brand-text-aa bg-stone-900 text-white transition-all hover:shadow-lg hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"

const outlineStyles =
	"border border-stone-700 bg-transparent text-stone-800 transition-all hover:bg-stone-800 hover:text-white hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-500 dark:text-stone-300 dark:hover:bg-stone-700"

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	function Button({ className, compact, outline, themeInfo, ...p }, ref) {
		const sizeClass = compact ? spacing.compact : spacing.regular
		const themeClass = outline ? outlineStyles : filled
		return (
			<button
				ref={ref}
				type="button"
				className={c(
					"inline-block font-medium tracking-wider",
					sizeClass,
					themeClass,
					className
				)}
				{...p}
			/>
		)
	}
)
