import { forwardRef } from "react"
import { combine as c } from "../../lib/cls"

export type IconButtonProps = Omit<JSX.IntrinsicElements["button"], "ref"> & {
	/** Darken on hover without a background — for an icon inside a row that
	 *  already highlights on hover. */
	quiet?: boolean
}

/** THE button for a control that shows only an icon or glyph (remove ×,
 *  move ▲▼, collapse, rename). Owns the muted color, hover, radius and the
 *  disabled look (`.vc-icon-button` in vis-components.css); pass only size
 *  and padding in `className` (`px-1`, `h-5 w-5 flex items-center
 *  justify-center`). Name it with a short `title` (the hover label) or an
 *  `aria-label`. A button that shows a word is `Button` or a text link, not
 *  this. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
	function IconButton({ className, quiet, ...p }, ref) {
		return (
			<button
				ref={ref}
				type="button"
				className={c(quiet ? "vc-icon-button-quiet" : "vc-icon-button", className)}
				{...p}
			/>
		)
	}
)
