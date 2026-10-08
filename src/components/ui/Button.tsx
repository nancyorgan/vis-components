import { forwardRef } from "react"
import { combine as c } from "../../lib/cls"

// The app's action button. How it looks lives in src/styles/components.css under
// "Buttons" (.vc-btn, .vc-btn-compact, .vc-btn-primary, .vc-btn-danger).

export type ButtonProps = Omit<JSX.IntrinsicElements["button"], "ref"> & {
	compact?: boolean
	themeBase?: boolean
	themeInfo?: boolean
	/** Destructive / warning action — red fill AND red edges. Use this
	 * instead of overriding the background through `className`: the filled
	 * style paints brand-colored top and bottom BORDERS, so a background-only
	 * override leaves a red button with purple edges. */
	danger?: boolean
}

// There is deliberately NO outline / secondary variant: every non-destructive
// action button in the app is this filled brand purple (Nancy, 2026-09-15).
// On/off state controls use the .vc-toggle-* classes in components.css.

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	function Button({ className, compact, danger, themeInfo, ...p }, ref) {
		return (
			<button
				ref={ref}
				type="button"
				className={c(
					"vc-btn",
					compact && "vc-btn-compact",
					danger ? "vc-btn-danger" : "vc-btn-primary",
					className
				)}
				{...p}
			/>
		)
	}
)
