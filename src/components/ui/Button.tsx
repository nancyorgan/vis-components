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
	/** Destructive / warning action — red fill AND red edges. Use this
	 * instead of overriding the background through `className`: the filled
	 * style paints brand-colored top and bottom BORDERS, so a background-only
	 * override leaves a red button with purple edges. */
	danger?: boolean
}

const spacing = {
	compact: "rounded-sm px-3 py-1.5 text-sm shadow",
	regular: "rounded-sm px-6 py-2 text-sm shadow",
}

const filled =
	"bg-brand-text-aa bg-stone-900 text-white transition-all hover:shadow-lg hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"

const outlineStyles =
	"border border-stone-700 bg-transparent text-stone-800 transition-all hover:bg-stone-800 hover:text-white hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-500 dark:text-stone-300 dark:hover:bg-stone-700"

// `bg-error-text-aa` (styles/tailwind/Button.css) is the red sibling of
// `bg-brand-text-aa` — it owns fill, both edge colors, hover/active, dark
// mode, and the disabled gray, so nothing here needs restating.
const dangerStyles =
	"bg-error-text-aa transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	function Button({ className, compact, outline, danger, themeInfo, ...p }, ref) {
		const sizeClass = compact ? spacing.compact : spacing.regular
		// Outline wins over danger: a bordered red button is a different
		// affordance, and no caller asks for one today.
		const themeClass = outline
			? outlineStyles
			: danger
				? dangerStyles
				: filled
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
