import { forwardRef } from "react"
import { combine as c } from "../../lib/cls"

// The app's button: filled brand purple by default, with compact, theme and
// danger variants.

export type ButtonProps = Omit<JSX.IntrinsicElements["button"], "ref"> & {
	compact?: boolean
	themeBase?: boolean
	themeInfo?: boolean
	/** Destructive / warning action — red fill AND red edges. Use this
	 * instead of overriding the background through `className`: the filled
	 * style paints brand-colored top and bottom BORDERS, so a background-only
	 * override leaves a red button with purple edges. */
	danger?: boolean
	/** Soft warning — pink fill. For "proceed anyway" choices that deserve
	 * a nudge but aren't destructive (e.g. editing already-published
	 * content). `danger` stays for deletes. */
	caution?: boolean
}

const spacing = {
	compact: "rounded-control px-3 py-1.5 text-sm shadow",
	regular: "rounded-control px-6 py-2 text-sm shadow",
}

// No `disabled:opacity-60` here: the brand fill paints its own light-purple
// disabled colors (styles/tailwind/Button.css).
const filled =
	"bg-brand-text-aa bg-stone-900 text-white transition-all hover:shadow-lg hover:bg-stone-700 disabled:cursor-not-allowed dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"

// There is deliberately NO outline / secondary variant: every non-destructive
// action button in the app is this filled brand purple (Nancy, 2026-09-15).
// On/off state controls use the .vc-toggle-* classes in vis-components.css.

// `bg-error-text-aa` (styles/tailwind/Button.css) is the red sibling of
// `bg-brand-text-aa` — it owns fill, both edge colors, hover/active, dark
// mode, and the disabled gray, so nothing here needs restating.
const dangerStyles =
	"bg-error-text-aa transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"

// `bg-caution-text-aa` is the pink sibling (same file).
const cautionStyles =
	"bg-caution-text-aa transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	function Button(
		{ className, compact, danger, caution, themeInfo, ...p },
		ref
	) {
		const sizeClass = compact ? spacing.compact : spacing.regular
		const themeClass = danger
			? dangerStyles
			: caution
				? cautionStyles
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
