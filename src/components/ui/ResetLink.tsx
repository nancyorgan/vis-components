/** Small inline "reset" link, rendered only when a control differs from its
 *  default. The shared home for the idiom previously copy-pasted across the
 *  sidebar panels (LabelsPanel / CaptionPanel / OpacityOptionsPanel / …).
 *  `underline` covers the second in-tree variant of the same link;
 *  `className` appends extra classes (e.g. `self-start` so the link doesn't
 *  stretch inside a flex column); `ariaLabel` names the link for tests and
 *  screen readers when several resets share a panel. */
export const ResetLink = ({
	onClick,
	underline = false,
	label = "reset",
	className,
	ariaLabel,
}: {
	onClick: () => void
	underline?: boolean
	label?: string
	className?: string
	ariaLabel?: string
}) => (
	<button
		type="button"
		onClick={onClick}
		aria-label={ariaLabel}
		className={
			"text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white" +
			(underline ? " underline" : "") +
			(className ? ` ${className}` : "")
		}
	>
		{label}
	</button>
)
